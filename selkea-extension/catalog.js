// Private server details and keys do not live in this code. They come from config.local.js, a file
// that scripts/make-config.mjs generates from .env and git ignores (see .env.example). Without it
// the extension still works with the public LUMI Aitta endpoint and keys you paste in Settings.
var SELKEA_CONFIG = typeof SELKEA_CONFIG !== "undefined" ? SELKEA_CONFIG : { hackathon: null, apiKeys: {} };

// Shared by panel.js (to draw the UI) and background.js (to build the prompt).
// The `needs` / `hint` strings are written for the model, not for the user.
// Small network helpers shared by the panel and the service worker.
const SELKEA_NET = {
  hostOf(url) {
    try { return new URL(url).host; } catch (_) { return ""; }
  },
  // Credentials are keyed by hostname only, so the hackathon key covers every port on that machine.
  keyHost(url) {
    try { return new URL(url).hostname; } catch (_) { return ""; }
  },
  isAitta(url) {
    return /(^|\.)aitta-api\.csc\.fi$/.test(this.keyHost(url));
  },
  // People paste tokens with a "Bearer " prefix, quotes, or a line break in the middle. None of
  // that belongs in the token, and any of it makes the server answer "invalid token".
  cleanToken(t) {
    return String(t || "")
      .replace(/^\s*(authorization:\s*)?bearer\s+/i, "")
      .replace(/["'\s]+/g, "");
  },
  // Context windows we know for certain, used when the Context setting is empty. Poro-2-70B is
  // fine-tuned at 8192 tokens (Hugging Face model card).
  knownContext(model) {
    return { "LumiOpen/Llama-Poro-2-70B-Instruct": 8192 }[String(model).trim()] || 0;
  },
  // Aitta writes model ids in URLs with "~" instead of "/".
  modelPath(id) {
    return String(id).replace(/\//g, "~");
  },
};

// Default prices, per 1M tokens, so nobody has to type any. "aitta" is a rate read off the Aitta web
// UI (GPU-hours, which only shows after login). "estimate" is a public USD list price for the same
// model, used where Aitta's own rate is not available; the panel marks those with a tilde.
const SELKEA_PRICES = {
  "Qwen/Qwen3-Coder-Next":              { in: 0.23, out: 7.76, unit: "GPU-h", kind: "aitta",    note: "Aitta rate" },
  "Qwen/Qwen3.6-27B":                   { in: 0.25, out: 2.0,  unit: "$",     kind: "estimate", note: "OpenRouter list price" },
  "Qwen/Qwen3.8-27B":                   { in: 0.45, out: 3.2,  unit: "$",     kind: "estimate", note: "Alibaba Cloud list price" },
  "openai/gpt-oss-120b":                { in: 0.15, out: 0.6,  unit: "$",     kind: "estimate", note: "OpenRouter list price" },
  "LumiOpen/Llama-Poro-2-70B-Instruct": { in: 0.2,  out: 0.2,  unit: "$",     kind: "estimate", note: "typical 70B Llama price (Poro has no public price)" },
};
const SELKEA_FREE_HOSTS = SELKEA_CONFIG.hackathon ? [SELKEA_CONFIG.hackathon.host] : []; // the hackathon's own servers

const SELKEA_AITTA_URL = "https://aitta-api.csc.fi/openai/v1";

// Where a fresh install points first: the hackathon H200 if it is configured, else public Aitta.
const SELKEA_DEFAULT_SERVER = SELKEA_CONFIG.hackathon
  ? { baseUrl: `http://${SELKEA_CONFIG.hackathon.host}:${SELKEA_CONFIG.hackathon.h200Port}/v1`, model: "Qwen/Qwen3.8-27B-FP8" }
  : { baseUrl: SELKEA_AITTA_URL, model: "Qwen/Qwen3.8-27B" };

const SELKEA_PRICE = {
  // The price to use for these settings: a typed override, else free for the hackathon servers,
  // else the table above, else null (unknown).
  resolve(s) {
    if (s.priceOverride) {
      return { in: Number(s.priceIn) || 0, out: Number(s.priceOut) || 0, unit: (s.priceUnit || "").trim() || "units", kind: "custom", note: "your own price" };
    }
    if (SELKEA_FREE_HOSTS.includes(SELKEA_NET.keyHost(s.baseUrl))) {
      return { in: 0, out: 0, unit: "", kind: "free", note: "hackathon server" };
    }
    const p = SELKEA_PRICES[String(s.model).trim()];
    return p ? { ...p } : null;
  },
};

// Number and cost formatting shared by the panel and the service worker.
const SELKEA_FMT = {
  n: (x) => Math.round(x).toLocaleString("en-US"),
  num(x) {
    if (!x) return "0";
    if (x < 0.0001) return "<0.0001";
    return x.toFixed(x < 0.01 ? 5 : x < 1 ? 4 : 2).replace(/0+$/, "").replace(/\.$/, "");
  },
  // One price for a run: "Free", "≈ $0.0043", "0.0236 GPU-h" or "price unknown".
  price(u) {
    if (u.kind === "free") return "Free";
    if (!u.priced) return "price unknown";
    const tilde = u.kind === "estimate" || u.estimated ? "≈ " : "";
    const cost = this.num(u.cost);
    if (u.unit === "$") return `${tilde}${cost.startsWith("<") ? "<$" + cost.slice(1) : "$" + cost}`;
    return `${tilde}${cost} ${u.unit}`;
  },
  // "9,120 in · 1,850 out · ≈ $0.0043"
  runText(u) {
    return `${this.n(u.input)} in · ${this.n(u.output)} out · ${this.price(u)}`;
  },
  totalText(t) {
    const costs = Object.entries(t.cost || {})
      .filter(([, v]) => v > 0)
      .map(([unit, v]) => (unit === "$" ? `≈ $${this.num(v)}` : `${this.num(v)} ${unit}`));
    return [
      `${t.runs} run${t.runs === 1 ? "" : "s"}`,
      `${this.n(t.input)} in`,
      `${this.n(t.output)} out`,
      costs.length ? costs.join(" + ") : "free or unpriced",
    ].join(" · ");
  },
};

const SELKEA = {
  profiles: [
    {
      id: "blind", label: "Blind / screen reader",
      needs: "Blind or uses a screen reader. Needs every image, button, link and form field to have an accurate text name, correct headings and landmarks, a skip link, and nothing that only works visually.",
      defaults: ["labels", "structure", "summary", "media"],
    },
    {
      id: "lowvision", label: "Low vision",
      needs: "Low vision. Needs strong text contrast, larger text, generous spacing, clearly visible links and focus, and a layout that stays readable when enlarged.",
      defaults: ["contrast", "bigtext", "spacing", "links", "focus"],
    },
    {
      id: "colorblind", label: "Colour blind",
      needs: "Colour blind. Meaning must never depend on colour alone (links, errors, status, charts, buttons); colour choices must stay distinguishable.",
      defaults: ["colorblind", "links", "contrast"],
    },
    {
      id: "dyslexia", label: "Dyslexia",
      needs: "Dyslexia. Needs a clear sans-serif font, wider letter, word and line spacing, short left-aligned lines, no justified or italic text, no dense walls of text.",
      defaults: ["dyslexia_font", "spacing", "reading"],
    },
    {
      id: "cognitive", label: "Cognitive & learning",
      needs: "Cognitive or learning disability. Needs plain simple language, short sentences, clear headings, a short summary, fewer distractions and a predictable layout.",
      defaults: ["plain", "summary", "declutter", "structure", "animations", "reading"],
    },
    {
      id: "adhd", label: "ADHD",
      needs: "ADHD. Needs fewer distractions (ads, popups, sidebars, motion), short chunks of text, a summary at the top and calm visuals.",
      defaults: ["declutter", "animations", "summary", "reading", "calm"],
    },
    {
      id: "seizure", label: "Seizure & epilepsy",
      needs: "Seizure or epilepsy. Needs no flashing or rapid motion, no autoplay media, and calm low-saturation visuals.",
      defaults: ["animations", "media", "calm"],
    },
    {
      id: "motor", label: "Motor impairment",
      needs: "Motor impairment. Needs large click targets, strong focus indicators, working keyboard navigation, skip links, and no tiny controls packed together.",
      defaults: ["targets", "focus", "structure"],
    },
  ],

  groups: [
    { id: "see", label: "Seeing" },
    { id: "read", label: "Reading & understanding" },
    { id: "calm", label: "Focus & calm" },
    { id: "move", label: "Keyboard & screen readers" },
  ],

  options: [
    { id: "contrast", group: "see", label: "Smart contrast",
      hint: "Fix every text/background pair below WCAG AA contrast (AAA for low vision), keeping the site's colour identity where possible." },
    { id: "darkmode", group: "see", label: "Dark mode",
      hint: "Comfortable dark theme: light text on a dark background, no glaring pure-white blocks, images left alone." },
    { id: "bigtext", group: "see", label: "Bigger text",
      hint: "Enlarge text to roughly 125-150% and make sure the layout still works (CSS zoom is supported)." },
    { id: "colorblind", group: "see", label: "Colour-blind safe",
      hint: "Never rely on colour alone: underline links, add text or icon cues to status and errors, use distinguishable colours." },
    { id: "hide_images", group: "see", label: "Hide images",
      hint: "Hide images and decorative graphics (keep logos if they are the only link text). Alt text stays in the page." },

    { id: "spacing", group: "read", label: "Text spacing",
      hint: "line-height at least 1.6, paragraph spacing, letter-spacing about 0.05em, word-spacing about 0.1em." },
    { id: "dyslexia_font", group: "read", label: "Dyslexia-friendly type",
      hint: "Local font stack (Atkinson Hyperlegible, Lexend, Verdana, Tahoma, Arial), no italics, no justified text, left aligned." },
    { id: "links", group: "read", label: "Highlight links",
      hint: "Underline all links and make them stand out by more than colour." },
    { id: "reading", group: "read", label: "Reading column",
      hint: "One readable column about 65 characters wide, centred, generous margins; sidebars de-emphasised." },
    { id: "bionic", group: "read", label: "Bionic reading",
      hint: "The extension itself bolds the first part of every word in paragraphs, after all your changes. Do not do this yourself in CSS or in rewrites." },
    { id: "plain", group: "read", label: "Plain language",
      hint: "Rewrite the page text in short, simple sentences without changing the meaning." },
    { id: "explain", group: "read", label: "Explain hard words",
      hint: "Wrap difficult terms and jargon in <abbr title> with a short plain definition." },
    { id: "summary", group: "read", label: "Add a summary",
      hint: "Insert a short plain-language summary box at the top of the page." },

    { id: "animations", group: "calm", label: "Stop animations",
      hint: "Disable CSS animations, transitions, smooth scrolling and parallax." },
    { id: "media", group: "calm", label: "Pause autoplay",
      hint: "Stop autoplaying video and audio (set pause_media)." },
    { id: "declutter", group: "calm", label: "Hide clutter",
      hint: "Hide ads, cookie and newsletter popups, sticky bars, sidebars and social widgets. Keep content and navigation." },
    { id: "calm", group: "calm", label: "Calm colours",
      hint: "Reduce the saturation and brightness of loud colours." },

    { id: "focus", group: "move", label: "Strong focus ring",
      hint: "3px high-contrast outline on :focus-visible for every interactive element." },
    { id: "targets", group: "move", label: "Bigger click targets",
      hint: "Buttons, links in menus and form controls at least 44x44 CSS px, with spacing between them." },
    { id: "labels", group: "move", label: "Fix labels & alt text",
      hint: "Add missing alt text, accessible names for empty buttons and links, labels for form fields, and the page language." },
    { id: "structure", group: "move", label: "Page structure",
      hint: "Add landmarks (main, nav, header, footer), fix heading levels, add a 'skip to main content' link." },
  ],

  intensities: [
    { id: "light", label: "Light", note: "Gentle changes, keep the design." },
    { id: "balanced", label: "Balanced", note: "Clear improvements." },
    { id: "strong", label: "Strong", note: "Bold changes, accessibility first." },
  ],
};
