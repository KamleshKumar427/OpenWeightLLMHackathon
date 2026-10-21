// Selkeä – content script (injected on demand by the service worker).
// Three jobs: (1) turn the live page into a compact snapshot for the model,
// (2) apply the model's patch safely and reversibly, (3) show a small status pill.

(() => {
  if (window.__selkea) return;
  const S = (window.__selkea = { undo: [], hasIds: false });

  // ------------------------------------------------------------ snapshot

  const MAX_HTML_CHARS = 90000;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "LINK", "META", "TEMPLATE", "HEAD", "OBJECT", "EMBED", "BASE"]);
  const VOID_TAGS = new Set(["IMG", "INPUT", "BR", "HR", "WBR"]);
  const KEEP_ATTRS = ["id", "href", "alt", "title", "aria-label", "role", "type", "name", "placeholder", "for", "lang", "tabindex", "aria-hidden", "aria-expanded", "aria-live"];
  const BLOCK_SELECTOR = "p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,dt,figcaption,td,th,summary";
  const INTERACTIVE = "button,input,select,textarea,iframe,video,audio,canvas,form,[onclick],[contenteditable]";

  const isVisible = (el) => !el.checkVisibility || el.checkVisibility({ checkVisibilityCSS: true });
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

  // Ids are stable: elements that already have one keep it, new ones get the next number.
  function assignIds() {
    let n = 0;
    const all = document.body.querySelectorAll("*");
    for (const el of all) {
      const m = /^n(\d+)$/.exec(el.getAttribute("data-a11y-id") || "");
      if (m) n = Math.max(n, +m[1]);
    }
    for (const el of all) {
      if (!el.hasAttribute("data-a11y-id")) el.setAttribute("data-a11y-id", "n" + ++n);
    }
    S.hasIds = true;
  }

  function serialize(el, textLimit) {
    const tag = el.tagName;
    if (SKIP_TAGS.has(tag) || !isVisible(el)) return "";
    const t = tag.toLowerCase();
    let attrs = ` data-a11y-id="${el.getAttribute("data-a11y-id")}"`;

    if (el.id) attrs += ` id="${escAttr(el.id.slice(0, 40))}"`;
    const cls = [...el.classList].slice(0, 3).map((c) => c.slice(0, 30)).join(" ");
    if (cls) attrs += ` class="${escAttr(cls)}"`;
    for (const name of KEEP_ATTRS) {
      if (name === "id") continue;
      let v = el.getAttribute(name);
      if (v == null || (v === "" && name !== "alt")) continue;
      if (name === "href") v = v.slice(0, 80);
      attrs += ` ${name}="${escAttr(v.slice(0, 120))}"`;
    }
    if (tag === "IMG") {
      const src = (el.getAttribute("src") || "").split("?")[0].split("/").pop() || "";
      attrs += ` file="${escAttr(src.slice(0, 40))}" w="${el.naturalWidth || el.width}" h="${el.naturalHeight || el.height}"`;
    }
    if (VOID_TAGS.has(tag)) return `<${t}${attrs}>`;

    if (tag === "SVG" || tag === "svg") {
      const title = el.querySelector("title")?.textContent?.trim() || "";
      return `<svg${attrs}>${esc(title.slice(0, 60))}</svg>`;
    }
    if (tag === "IFRAME") return `<iframe${attrs}></iframe>`;

    let inner = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const txt = node.nodeValue.replace(/\s+/g, " ").trim();
        if (txt) inner += esc(txt.length > textLimit ? txt.slice(0, textLimit) + "…" : txt) + " ";
      } else if (node.nodeType === 1) {
        inner += serialize(node, textLimit);
      }
    }
    return `<${t}${attrs}>${inner.trim()}</${t}>`;
  }

  function snapshotHtml() {
    for (const limit of [400, 160, 80, 40]) {
      const html = serialize(document.body, limit);
      if (html.length <= MAX_HTML_CHARS) return html;
    }
    return serialize(document.body, 40).slice(0, MAX_HTML_CHARS) + "<!-- truncated -->";
  }

  // ------------------------------------------------------------ measurements

  let _ctx;
  const _colorCache = new Map();
  function toRGBA(str) {
    if (_colorCache.has(str)) return _colorCache.get(str);
    if (!_ctx) {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      _ctx = c.getContext("2d", { willReadFrequently: true });
    }
    _ctx.clearRect(0, 0, 1, 1);
    _ctx.fillStyle = "#000";
    _ctx.fillStyle = str;
    _ctx.fillRect(0, 0, 1, 1);
    const d = _ctx.getImageData(0, 0, 1, 1).data;
    const c = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    _colorCache.set(str, c);
    return c;
  }
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const hex = ({ r, g, b }) =>
    "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  function effectiveBackground(el) {
    const layers = [];
    let hasImage = false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none") hasImage = true;
      const c = toRGBA(cs.backgroundColor);
      if (c.a > 0) layers.push(c);
      if (c.a >= 1) break;
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) bg = over(layer, bg);
    return { bg, hasImage };
  }

  function digest() {
    const seen = new Set();
    const fails = [];
    const sizes = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let visited = 0, node;
    while ((node = walker.nextNode()) && visited < 1500) {
      if (!node.nodeValue.trim()) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      if (!isVisible(el)) continue;
      visited++;
      const cs = getComputedStyle(el);
      const px = parseFloat(cs.fontSize);
      sizes.set(Math.round(px), (sizes.get(Math.round(px)) || 0) + 1);
      const { bg, hasImage } = effectiveBackground(el);
      const fg = over(toRGBA(cs.color), bg);
      const r = ratio(fg, bg);
      const large = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
      if (r < (large ? 3 : 4.5)) {
        fails.push({ id: el.getAttribute("data-a11y-id"), fg: hex(fg), bg: hex(bg), ratio: +r.toFixed(2), px: Math.round(px), bgImage: hasImage });
      }
    }
    fails.sort((a, b) => a.ratio - b.ratio);

    const name = (el) =>
      (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || el.querySelector("img[alt]")?.getAttribute("alt") || "").trim();
    const vis = (list) => [...list].filter(isVisible);
    return {
      lang: document.documentElement.lang || null,
      baseFontPx: parseFloat(getComputedStyle(document.body).fontSize),
      textElements: visited,
      lowContrastCount: fails.length,
      lowContrast: fails.slice(0, 50),
      fontSizes: [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([px, n]) => ({ px, n })),
      imagesWithoutAlt: vis(document.querySelectorAll("img:not([alt])")).length,
      linksWithoutName: vis(document.querySelectorAll("a[href]")).filter((a) => !name(a)).length,
      buttonsWithoutName: vis(document.querySelectorAll("button,[role=button]")).filter((b) => !name(b)).length,
      inputsWithoutLabel: vis(document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea")).filter(
        (i) => !i.getAttribute("aria-label") && !i.getAttribute("title") && !(i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)) && !i.closest("label")
      ).length,
      autoplayMedia: document.querySelectorAll("video[autoplay],audio[autoplay]").length,
      runningAnimations: document.getAnimations().length,
      hasMainLandmark: !!document.querySelector("main,[role=main]"),
      headings: vis(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).slice(0, 25).map((h) => h.tagName.toLowerCase()).join(" "),
    };
  }

  // ------------------------------------------------------------ rewritable text blocks

  function collectBlocks() {
    const out = [];
    let chars = 0;
    for (const el of document.body.querySelectorAll(BLOCK_SELECTOR)) {
      if (out.length >= 150 || chars > 60000) break;
      if (el.closest("nav,[role=navigation],script,style")) continue;
      if (el.querySelector(BLOCK_SELECTOR)) continue; // only the innermost block
      if (el.querySelector(INTERACTIVE) || el.closest("[contenteditable]")) continue;
      if (!isVisible(el)) continue;
      const text = el.textContent.replace(/\s+/g, " ").trim();
      if (text.length < 25) continue;
      const html = inlineHtml(el);
      out.push({ id: el.getAttribute("data-a11y-id"), html });
      chars += html.length;
    }
    return out;
  }

  function capture() {
    if (!document.body) throw new Error("This page has no body to adapt.");
    assignIds();
    return {
      url: location.origin + location.pathname,
      title: document.title.slice(0, 120),
      html: snapshotHtml(),
      digest: digest(),
      blocks: collectBlocks(),
    };
  }

  // ------------------------------------------------------------ safe HTML from the model

  const ALLOWED_TAGS = new Set(["A", "ABBR", "B", "STRONG", "I", "EM", "U", "MARK", "SPAN", "BR", "SMALL", "SUB", "SUP", "CODE", "P", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "DIV", "SECTION", "DETAILS", "SUMMARY", "BLOCKQUOTE", "ARTICLE", "ASIDE", "NAV", "HEADER", "FOOTER", "MAIN", "FIGURE", "FIGCAPTION"]);
  const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "SVG", "MATH", "LINK", "META", "TEMPLATE", "NOSCRIPT", "IMG", "VIDEO", "AUDIO", "CANVAS", "BASE"]);
  const OWN_CLASSES = new Set(["selkea-skip", "selkea-summary"]);
  const ROLES = new Set(["banner", "main", "navigation", "contentinfo", "complementary", "region", "search", "form", "article", "button", "link", "heading", "list", "listitem", "img", "presentation", "none", "alert", "status", "dialog", "group", "tab", "tablist", "tabpanel", "menu", "menubar", "menuitem", "separator", "figure", "note", "checkbox", "radio", "switch", "textbox", "combobox", "listbox", "option", "table", "row", "cell", "columnheader", "rowheader", "grid", "tree", "treeitem", "progressbar", "slider", "tooltip", "toolbar"]);

  function safeHref(v) {
    v = String(v).trim();
    if (v.startsWith("#") || v.startsWith("/")) return v;
    try {
      const u = new URL(v, location.href);
      return ["http:", "https:", "mailto:", "tel:"].includes(u.protocol) ? v : "";
    } catch (_) {
      return "";
    }
  }

  function copyAttrs(from, to, tag) {
    for (const { name, value } of from.attributes) {
      const n = name.toLowerCase();
      if (n === "href" && tag === "A") {
        const h = safeHref(value);
        if (h) to.setAttribute("href", h);
      } else if (n === "class") {
        const keep = value.split(/\s+/).filter((c) => OWN_CLASSES.has(c));
        if (keep.length) to.setAttribute("class", keep.join(" "));
      } else if (n === "id") {
        if (/^[\w-]{1,40}$/.test(value)) to.setAttribute("id", value);
      } else if (["title", "lang", "dir"].includes(n) || /^aria-[a-z]+$/.test(n) || (n === "role" && ROLES.has(value))) {
        to.setAttribute(n, value.slice(0, 300));
      }
    }
  }

  function cleanInto(src, dst) {
    for (const n of src.childNodes) {
      if (n.nodeType === 3) {
        dst.appendChild(document.createTextNode(n.nodeValue));
      } else if (n.nodeType === 1) {
        const tag = n.tagName.toUpperCase();
        if (DROP_TAGS.has(tag)) continue;
        if (!ALLOWED_TAGS.has(tag)) { cleanInto(n, dst); continue; }
        const el = document.createElement(tag.toLowerCase());
        copyAttrs(n, el, tag);
        cleanInto(n, el);
        dst.appendChild(el);
      }
    }
  }

  function cleanFragment(html) {
    const parsed = new DOMParser().parseFromString("<body>" + html, "text/html");
    const frag = document.createDocumentFragment();
    cleanInto(parsed.body, frag);
    return frag;
  }

  function inlineHtml(el) {
    const box = document.createElement("div");
    cleanInto(el, box);
    return box.innerHTML.trim();
  }

  // ------------------------------------------------------------ apply

  const byId = (id) => document.querySelector(`[data-a11y-id="${CSS.escape(String(id))}"]`);

  function setAttr(el, name, value) {
    name = String(name).toLowerCase();
    value = String(value);
    const ok =
      /^(alt|title|lang|role|id|for|dir|tabindex)$/.test(name) || /^aria-[a-z]+$/.test(name);
    if (!ok) return false;
    if (name === "tabindex" && !/^(0|-1)$/.test(value)) return false;
    if (name === "id" && !/^[\w-]{1,40}$/.test(value)) return false;
    if (name === "role" && !ROLES.has(value)) return false;
    const prev = el.getAttribute(name);
    el.setAttribute(name, value.slice(0, 300));
    S.undo.push(() => (prev === null ? el.removeAttribute(name) : el.setAttribute(name, prev)));
    return true;
  }

  function removeAttr(el, name) {
    name = String(name).toLowerCase();
    if (!/^(alt|title|role|tabindex|aria-[a-z]+)$/.test(name) || !el.hasAttribute(name)) return false;
    const prev = el.getAttribute(name);
    el.removeAttribute(name);
    S.undo.push(() => el.setAttribute(name, prev));
    return true;
  }

  function safeToHide(el) {
    if (el.matches("html,body,main,[role=main]")) return false;
    if (el.querySelector("main,[role=main],h1")) return false;
    const share = (el.innerText || "").length / Math.max(1, (document.body.innerText || "").length);
    return share < 0.6;
  }

  function applyPatch(p) {
    const stats = { attributes: 0, hidden: 0, inserted: 0, skipped: 0 };

    if (p.lang && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(p.lang)) {
      const root = document.documentElement;
      const prev = root.getAttribute("lang");
      root.setAttribute("lang", p.lang);
      S.undo.push(() => (prev === null ? root.removeAttribute("lang") : root.setAttribute("lang", prev)));
      stats.attributes++;
    }

    for (const a of p.attributes) {
      const el = byId(a.id);
      if (!el) { stats.skipped++; continue; }
      for (const [k, v] of Object.entries(a.set || {})) setAttr(el, k, v) ? stats.attributes++ : stats.skipped++;
      for (const k of a.remove || []) removeAttr(el, k) ? stats.attributes++ : stats.skipped++;
    }

    for (const id of p.hide) {
      const el = byId(id);
      if (!el || !safeToHide(el)) { stats.skipped++; continue; }
      const prev = el.getAttribute("style");
      el.style.setProperty("display", "none", "important");
      S.undo.push(() => (prev === null ? el.removeAttribute("style") : el.setAttribute("style", prev)));
      stats.hidden++;
    }

    for (const ins of p.insert) {
      const frag = cleanFragment(ins.html);
      const nodes = [...frag.children];
      if (!nodes.length) { stats.skipped++; continue; }
      nodes.forEach((n) => n.setAttribute("data-selkea-inserted", ""));
      const where = String(ins.where || "");
      const target = ins.target ? byId(ins.target) : null;
      if (where === "body-start") document.body.prepend(frag);
      else if (where === "body-end") document.body.append(frag);
      else if (where === "before" && target) target.before(frag);
      else if (where === "after" && target) target.after(frag);
      else { stats.skipped++; continue; }
      S.undo.push(() => nodes.forEach((n) => n.remove()));
      stats.inserted++;
    }

    if (p.pause_media) {
      document.querySelectorAll("video,audio").forEach((m) => {
        const hadAutoplay = m.hasAttribute("autoplay");
        m.pause();
        m.removeAttribute("autoplay");
        m.autoplay = false;
        S.undo.push(() => hadAutoplay && m.setAttribute("autoplay", ""));
      });
    }
    return stats;
  }

  function applyRewrite(items) {
    let changed = 0, skipped = 0;
    for (const it of Array.isArray(items) ? items : []) {
      const el = it && typeof it.html === "string" ? byId(it.id) : null;
      if (!el || el.querySelector(INTERACTIVE)) { skipped++; continue; }
      const frag = cleanFragment(it.html);
      if (!frag.textContent.trim()) { skipped++; continue; }
      const old = [...el.childNodes];
      el.replaceChildren(frag);
      S.undo.push(() => el.replaceChildren(...old));
      changed++;
    }
    return { changed, skipped };
  }

  function revert() {
    while (S.undo.length) {
      try { S.undo.pop()(); } catch (_) {}
    }
    document.querySelectorAll("[data-selkea-inserted]").forEach((n) => n.remove());
    if (S.hasIds) {
      document.querySelectorAll("[data-a11y-id]").forEach((n) => n.removeAttribute("data-a11y-id"));
      S.hasIds = false;
    }
    return { ok: true };
  }

  // ------------------------------------------------------------ status pill

  let hideTimer;
  function pill(msg) {
    let host = document.getElementById("selkea-pill-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "selkea-pill-host";
      host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;";
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          :host{all:initial}
          .pill{--bg:rgba(255,255,255,.86);--ink:#1d1d1f;--muted:#6e6e73;--link:#0066cc;--hair:rgba(0,0,0,.12);
            display:flex;align-items:center;gap:12px;max-width:min(400px,calc(100vw - 32px));padding:12px 10px 12px 16px;
            border-radius:18px;background:var(--bg);color:var(--ink);
            font:400 14px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;
            -webkit-backdrop-filter:saturate(180%) blur(22px);backdrop-filter:saturate(180%) blur(22px);
            box-shadow:0 0 0 .5px var(--hair),0 12px 40px rgba(0,0,0,.22)}
          @media (prefers-color-scheme:dark){.pill{--bg:rgba(44,44,46,.86);--ink:#f5f5f7;--muted:#a1a1a6;--link:#2997ff;--hair:rgba(255,255,255,.14)}}
          .icon{flex:none;width:16px;display:grid;place-items:center}
          .spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--muted);border-top-color:transparent;animation:r .8s linear infinite}
          @keyframes r{to{transform:rotate(360deg)}}
          @media (prefers-reduced-motion:reduce){.spin{animation:none}}
          .mark{font-size:15px;line-height:1;color:var(--ink)}
          .pill.error .mark{color:#d70015}
          .pill.warn .mark{color:#b25000}
          .txt{flex:1;min-width:0}
          button{font:600 14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;border:0;border-radius:10px;padding:7px 12px;cursor:pointer;background:transparent;color:var(--link)}
          button:hover{background:rgba(127,127,127,.14)}
          button.close{color:var(--muted);padding:7px 9px;font-weight:500}
          button:focus-visible{outline:3px solid var(--link);outline-offset:1px}
          [hidden]{display:none!important}
        </style>
        <div class="pill" role="status" aria-live="polite">
          <span class="icon"><span class="spin" part="spin"></span><span class="mark" hidden></span></span>
          <span class="txt"></span>
          <button class="undo" hidden>Undo</button>
          <button class="close" aria-label="Dismiss">✕</button>
        </div>`;
      root.querySelector(".undo").addEventListener("click", () => chrome.runtime.sendMessage({ cmd: "revert" }));
      root.querySelector(".close").addEventListener("click", () => host.remove());
      document.documentElement.appendChild(host);
    }
    const root = host.shadowRoot;
    const box = root.querySelector(".pill");
    const working = msg.state === "working";
    box.classList.toggle("error", msg.state === "error");
    box.classList.toggle("warn", !!msg.warn);
    root.querySelector(".spin").hidden = !working;
    const mark = root.querySelector(".mark");
    mark.hidden = working;
    mark.textContent = msg.state === "error" ? "⚠" : "✓";
    root.querySelector(".txt").textContent = working ? msg.step : msg.message || "";
    root.querySelector(".undo").hidden = !(msg.state === "done");
    clearTimeout(hideTimer);
    if (msg.state === "idle") hideTimer = setTimeout(() => host.remove(), 2500);
  }

  // ------------------------------------------------------------ wiring

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      switch (msg.cmd) {
        case "capture": sendResponse(capture()); break;
        case "measure": assignIds(); sendResponse(digest()); break;
        case "apply": sendResponse(applyPatch(msg.patch)); break;
        case "rewrite": sendResponse(applyRewrite(msg.items)); break;
        case "revert": sendResponse(revert()); break;
        case "pill": pill(msg); sendResponse({ ok: true }); break;
      }
    } catch (err) {
      sendResponse({ error: String((err && err.message) || err) });
    }
    return false;
  });
})();
