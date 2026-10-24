const $ = (s) => document.querySelector(s);

// Prices are per 1M tokens. Aitta quotes GPU-hours. An empty price means "unknown": the panel then
// shows tokens only and says "no price set". 0 means "no charge" (the hackathon's own servers).
const AITTA = "https://aitta-api.csc.fi/openai/v1";
const PRESETS = {
  h200: { label: "Hackathon H200", baseUrl: "http://86.50.168.167:9002/v1", model: "Qwen/Qwen3.8-27B-FP8", context: 262144 },
  a100: { label: "Hackathon A100", baseUrl: "http://86.50.168.167:9001/v1", model: "Qwen/Qwen3.8-27B-FP8", context: 262144 },
  "aitta-36": { label: "Aitta Qwen3.6-27B", baseUrl: AITTA, model: "Qwen/Qwen3.6-27B", context: 32768 },
  "aitta-38": { label: "Aitta Qwen3.8-27B", baseUrl: AITTA, model: "Qwen/Qwen3.8-27B", context: 32768 },
  "aitta-coder": { label: "Aitta Qwen3-Coder-Next", baseUrl: AITTA, model: "Qwen/Qwen3-Coder-Next", context: 32768 },
  "aitta-poro": { label: "Aitta Llama-Poro-2-70B-Instruct", baseUrl: AITTA, model: "LumiOpen/Llama-Poro-2-70B-Instruct", context: 8192 },
  "aitta-oss": { label: "Aitta gpt-oss-120b", baseUrl: AITTA, model: "openai/gpt-oss-120b", context: 32768 },
};

const DEFAULT_SETTINGS = {
  baseUrl: PRESETS.h200.baseUrl,
  model: PRESETS.h200.model,
  apiKeys: undefined, // host -> key; see keyMap
  apiKey: "",         // legacy single key, migrated into apiKeys
  noThink: true,
  priceIn: 0,
  priceOut: 0,
  priceUnit: "GPU-h",
  priceOverride: false,
  contextTokens: 0,
};

let state = { profiles: [], options: [], intensity: "balanced", custom: "" };
let tab = null;        // the tab the panel is currently pointing at; follows the user between tabs
let lastStatus;

// ------------------------------------------------------------ tiles

function tile({ id, label }, checked, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "tile";
  wrap.innerHTML = `<input type="checkbox" value="${id}"><span class="face"><span class="lbl"></span><span class="mark" aria-hidden="true"></span></span>`;
  wrap.querySelector(".lbl").textContent = label;
  const input = wrap.querySelector("input");
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked, id));
  return wrap;
}

function renderProfiles() {
  $("#profiles").replaceChildren(
    ...SELKEA.profiles.map((p) => tile(p, state.profiles.includes(p.id), onProfile))
  );
}

function renderOptions() {
  const box = $("#options");
  box.replaceChildren();
  SELKEA.groups.forEach((g) => {
    const h = document.createElement("h3");
    h.className = "section sub-group";
    h.textContent = g.label;
    box.append(h);
    const grid = document.createElement("div");
    grid.className = "grid";
    grid.append(
      ...SELKEA.options
        .filter((o) => o.group === g.id)
        .map((o) => tile(o, state.options.includes(o.id), onOption))
    );
    box.append(grid);
  });
}

function renderIntensity() {
  const box = $("#intensity");
  box.replaceChildren(
    ...SELKEA.intensities.map((i) => {
      const l = document.createElement("label");
      l.title = i.note;
      l.innerHTML = `<input type="radio" name="intensity" value="${i.id}"><span></span>`;
      l.querySelector("span").textContent = i.label;
      const input = l.querySelector("input");
      input.checked = state.intensity === i.id;
      input.addEventListener("change", () => { state.intensity = i.id; save(); });
      return l;
    })
  );
}

function updateCount() {
  const n = state.options.length, p = state.profiles.length;
  const bits = [];
  if (p) bits.push(`${p} profile${p > 1 ? "s" : ""}`);
  if (n) bits.push(`${n} adjustment${n > 1 ? "s" : ""}`);
  if (state.custom.trim()) bits.push("your note");
  $("#count").textContent = bits.length ? "Sending: " + bits.join(" · ") : "Pick a profile, an adjustment, or write a note.";
}

// ------------------------------------------------------------ selection state

function onProfile(on, id) {
  const profile = SELKEA.profiles.find((p) => p.id === id);
  const set = new Set(state.options);
  if (on) {
    state.profiles = [...new Set([...state.profiles, id])];
    profile.defaults.forEach((o) => set.add(o));
  } else {
    state.profiles = state.profiles.filter((p) => p !== id);
    const stillWanted = new Set(
      state.profiles.flatMap((pid) => SELKEA.profiles.find((p) => p.id === pid).defaults)
    );
    profile.defaults.forEach((o) => !stillWanted.has(o) && set.delete(o));
  }
  state.options = [...set];
  renderOptions();
  save();
}

function onOption(on, id) {
  const set = new Set(state.options);
  on ? set.add(id) : set.delete(id);
  state.options = [...set];
  save();
}

let saveTimer;
function save() {
  updateCount();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ selection: state }), 150);
}

// ------------------------------------------------------------ which tab we are on

function pageIsSupported() {
  const url = tab?.url || "";
  return /^(https?:|file:)/.test(url) && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url);
}

function renderSite() {
  let name = "this tab";
  const url = tab?.url || "";
  try {
    if (/^https?:/.test(url)) name = new URL(url).host.replace(/^www\./, "");
    else if (url.startsWith("file:")) name = "a local file";
    else if (url) name = "this page (Chrome blocks extensions here)";
  } catch (_) {}
  $("#siteName").textContent = name;
  const icon = $("#siteIcon");
  if (tab?.favIconUrl && /^https?:/.test(tab.favIconUrl)) {
    icon.src = tab.favIconUrl;
    icon.hidden = false;
  } else {
    icon.hidden = true;
  }
}

// The side panel stays open while you move around, so it re-reads the active tab every time
// you switch tabs or the page loads, and shows that tab's own status.
async function refreshTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (t) tab = t;
  renderSite();
  if (!tab) return;
  const key = "status:" + tab.id;
  renderStatus((await chrome.storage.session.get(key))[key]);
}

// ------------------------------------------------------------ status, results, compare

function syncResults() {
  $("#results").hidden = $("#report").hidden && $("#usage").hidden;
}

async function renderUsage(s) {
  const box = $("#usage");
  const u = s?.usage;
  const working = s?.state === "working";
  box.hidden = !u;
  if (u) {
    const { usageTotal } = await chrome.storage.local.get("usageTotal");
    $("#costLabel").textContent = working ? "Cost so far" : "This run cost";
    $("#costBig").textContent = SELKEA_FMT.price(u);
    $("#costTokens").textContent =
      `${SELKEA_FMT.n(u.input)} in · ${SELKEA_FMT.n(u.output)} out · ${u.calls} model call${u.calls === 1 ? "" : "s"}` +
      (u.model ? ` · ${u.model.split("/").pop()}` : "");
    $("#costNote").textContent =
      u.kind === "estimate" ? `Estimated from the ${u.note}. Aitta's own rate shows only after you log in; enter it under Settings → Advanced to use it.`
      : u.kind === "aitta" ? "Aitta's rate for this model (GPU-hours per 1M tokens)."
      : u.kind === "free" ? "Hackathon server: no charge."
      : u.kind === "custom" ? "Using your own prices."
      : "No price is known for this model. Add one under Settings → Advanced.";
    $("#costTotal").textContent = usageTotal ? "All runs: " + SELKEA_FMT.totalText(usageTotal) : "";
  }
  syncResults();
}

function renderReport(s) {
  const r = s?.report;
  $("#report").hidden = !r;
  if (r) {
    const fixed = Math.max(0, r.before - r.after);
    $("#reportScore").textContent = `${r.before} → ${r.after}`;
    $("#reportScore").setAttribute("aria-label", `${r.before} issues before, ${r.after} after`);
    $("#reportSub").textContent =
      r.before === 0 ? "No issues found on this page."
      : r.after === 0 ? "Every issue we can detect is fixed."
      : `${fixed} of ${r.before} issues fixed.`;
    $("#reportBar").style.width = (r.before ? Math.round((fixed / r.before) * 100) : 100) + "%";
    $("#reportRows").replaceChildren(
      ...r.rows.map((row) => {
        const li = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = row.label;
        const val = document.createElement("span");
        val.className = "rv";
        val.innerHTML = `${row.before} → <b>${row.after}</b>`;
        li.append(label, val);
        return li;
      })
    );
  }
  syncResults();
}

// "Adapted / Original" switch: only offered once a run has finished on this tab.
async function renderCompare() {
  const box = $("#compare");
  const show = lastStatus?.state === "done" && !!tab;
  box.hidden = !show;
  if (!show) return;
  const key = "peek:" + tab.id;
  const peeking = !!(await chrome.storage.session.get(key))[key];
  box.querySelector(`input[value="${peeking ? "original" : "adapted"}"]`).checked = true;
}

function renderStatus(s) {
  lastStatus = s;
  renderUsage(s);
  renderReport(s);
  renderCompare();
  const el = $("#status"), go = $("#go");
  el.className = "status";
  const working = s?.state === "working";
  if (!s || (s.state === "idle" && !s.message)) {
    el.textContent = "";
  } else {
    el.textContent = working ? s.step : s.message || "";
    if (working) el.classList.add("working");
    else if (s.state === "error") el.classList.add("error");
    else if (s.warn) el.classList.add("warn");
    else if (s.state === "done") el.classList.add("done");
  }
  go.textContent = working ? "Stop" : "Make this page accessible";
  go.classList.toggle("stop", working);
  $("#undo").disabled = working;
}

// ------------------------------------------------------------ actions

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// One key per server. The Aitta token and the hackathon key are different credentials; keeping
// them apart means switching presets can never send one to the wrong place.
let keyMap = {};
let shownHost = "";
const hostOfField = () => SELKEA_NET.keyHost($("#baseUrl").value.trim());

function effectiveKey(s) {
  const host = SELKEA_NET.keyHost(s.baseUrl);
  return SELKEA_NET.cleanToken(s.apiKeys ? s.apiKeys[host] : s.apiKey);
}

// Save what is in the key box under the host it was typed for.
function stashKey() {
  if (shownHost) keyMap[shownHost] = SELKEA_NET.cleanToken($("#apiKey").value);
}

// Show the key that belongs to the server now in the URL box.
function showKey() {
  shownHost = hostOfField();
  $("#apiKey").value = keyMap[shownHost] || "";
  const hint = $("#keyHint");
  hint.replaceChildren();
  if (SELKEA_NET.isAitta($("#baseUrl").value)) {
    $("#apiKey").placeholder = "Aitta token";
    const a = document.createElement("a");
    a.href = "https://aitta-auth.csc.fi/myToken";
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "aitta-auth.csc.fi/myToken";
    hint.append("Paste only the token (no \"Bearer\"). Make one at ", a, ". It lasts 90 days and belongs to one LUMI project.");
  } else {
    $("#apiKey").placeholder = "Hackathon API key";
    hint.textContent = "Each server has its own key. This one is used only for " + (shownHost || "this server") + ".";
  }
}

function openSettings() {
  $("#settings").hidden = false;
  $("#gear").setAttribute("aria-expanded", "true");
}

// The hackathon and Aitta servers all need a key; say so now instead of failing with a 401.
async function keyIsMissing() {
  const s = await getSettings();
  if (effectiveKey(s)) return false;
  return /aitta-api\.csc\.fi|86\.50\.168\.167/.test(SELKEA_NET.hostOf(s.baseUrl));
}

async function onGo() {
  await refreshTab();
  if (!tab) return;
  if (lastStatus?.state === "working") {
    // Say so right away; the service worker confirms (and clears the state even if it lost the job).
    renderStatus({ ...lastStatus, step: "Stopping…" });
    await chrome.runtime.sendMessage({ cmd: "cancel", tabId: tab.id });
    return;
  }
  if (!pageIsSupported()) {
    renderStatus({ state: "error", message: "Chrome does not let extensions change this kind of page. Switch to a normal website tab and try again." });
    return;
  }
  if (!state.profiles.length && !state.options.length && !state.custom.trim()) {
    renderStatus({ state: "error", message: "Pick at least one profile or adjustment, or write what you need." });
    return;
  }
  const needsModel = !(state.options.length && !state.profiles.length && !state.custom.trim() && state.options.every((o) => o === "bionic"));
  if (needsModel && (await keyIsMissing())) {
    openSettings();
    $("#apiKey").focus();
    renderStatus({ state: "error", message: "Add your API key first: paste it under Settings, then press Save." });
    return;
  }
  state.custom = $("#custom").value;
  await chrome.storage.local.set({ selection: state });
  renderStatus({ state: "working", step: "Starting…" });
  await chrome.runtime.sendMessage({ cmd: "apply", tabId: tab.id, selection: state });
}

// ------------------------------------------------------------ settings

function renderModelLine(s) {
  let host = "";
  try { host = new URL(s.baseUrl).host; } catch (_) {}
  $("#modelLine").textContent = s.model ? `${s.model.split("/").pop()} · ${host}` : "";
}

async function loadSettings() {
  const s = await getSettings();
  $("#baseUrl").value = s.baseUrl;
  $("#model").value = s.model;
  $("#contextTokens").value = s.contextTokens || SELKEA_NET.knownContext(s.model) || "";
  // Migrate the old single key to a per-server key. It belongs to the server that was saved with it.
  keyMap = { ...(s.apiKeys || {}) };
  if (!s.apiKeys && s.apiKey) keyMap[SELKEA_NET.keyHost(s.baseUrl)] = SELKEA_NET.cleanToken(s.apiKey);
  showKey();
  $("#noThink").checked = s.noThink;
  // Prices are automatic. The fields only hold something if the user typed their own.
  $("#priceIn").value = s.priceOverride ? s.priceIn : "";
  $("#priceOut").value = s.priceOverride ? s.priceOut : "";
  $("#priceUnit").value = s.priceOverride ? s.priceUnit : "";
  syncPresetSelect();
  renderModelLine(s);
  renderPriceLine();
}

function readSettings() {
  const inRaw = $("#priceIn").value.trim(), outRaw = $("#priceOut").value.trim();
  stashKey();
  $("#apiKey").value = keyMap[shownHost] || ""; // show the cleaned token (no "Bearer", no quotes)
  return {
    baseUrl: $("#baseUrl").value.trim(),
    model: $("#model").value.trim(),
    apiKeys: { ...keyMap },
    apiKey: keyMap[hostOfField()] || "", // only used for "Test connection"
    noThink: $("#noThink").checked,
    priceIn: Math.max(0, parseFloat(inRaw) || 0),
    priceOut: Math.max(0, parseFloat(outRaw) || 0),
    priceUnit: $("#priceUnit").value.trim() || "GPU-h",
    priceOverride: inRaw !== "" && outRaw !== "",
    contextTokens: Math.max(0, parseInt($("#contextTokens").value, 10) || 0),
  };
}

function settingsMsg(text, isError) {
  const m = $("#settingsMsg");
  m.textContent = text;
  m.classList.toggle("error", !!isError);
}

async function ensureHostAccess(baseUrl) {
  let origin;
  try { origin = new URL(baseUrl).origin + "/*"; } catch (_) { throw new Error("That base URL is not valid."); }
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error("Chrome needs your permission to contact that server.");
}

async function onTest() {
  const s = readSettings();
  settingsMsg("Testing…");
  try {
    await ensureHostAccess(s.baseUrl);
    const r = await chrome.runtime.sendMessage({ cmd: "test", settings: s });
    settingsMsg(r.message, !r.ok || !!r.warn);
  } catch (err) {
    settingsMsg(err.message, true);
  }
}

async function onSave(note) {
  const s = readSettings();
  try {
    await ensureHostAccess(s.baseUrl);
    await chrome.storage.local.set({ settings: s });
    renderModelLine(s);
    renderPriceLine();
    syncPresetSelect();
    settingsMsg(typeof note === "string" ? note : "Saved.");
  } catch (err) {
    settingsMsg(err.message, true);
  }
}

// Every settings field saves itself a moment after it changes, so there is no Save button to forget.
let autosaveTimer;
function scheduleSave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => onSave(), 350);
}

// The price that will be used for what is in the form right now, in one plain sentence.
function renderPriceLine() {
  const s = readSettings();
  const p = SELKEA_PRICE.resolve(s);
  const el = $("#priceLine");
  if (!p) {
    el.textContent = "Price: not known for this model, so runs show tokens only. Add one under Advanced.";
    return;
  }
  if (p.kind === "free") {
    el.textContent = "Price: free (hackathon server).";
    return;
  }
  const money = (x) => (p.unit === "$" ? "$" + x.toFixed(2) : SELKEA_FMT.num(x) + " " + p.unit);
  el.textContent =
    `Price: ${p.kind === "estimate" ? "≈ " : ""}${money(p.in)} in · ${money(p.out)} out per 1M tokens (${p.note}).`;
}

// Keep the model menu showing what the fields actually say.
function syncPresetSelect() {
  const base = $("#baseUrl").value.trim(), model = $("#model").value.trim();
  $("#preset").value = Object.entries(PRESETS).find(([, p]) => p.baseUrl === base && p.model === model)?.[0] || "";
}

// Picking a preset switches model right away; no separate Save needed.
async function onPreset(e) {
  const p = PRESETS[e.target.value];
  if (!p) return;
  stashKey();                       // keep the key typed for the server we are leaving
  $("#baseUrl").value = p.baseUrl;
  showKey();                        // show the key saved for the server we are entering
  $("#model").value = p.model;
  $("#contextTokens").value = p.context || "";
  // A preset brings its own default price, so drop any override typed for the previous model.
  $("#priceIn").value = "";
  $("#priceOut").value = "";
  $("#priceUnit").value = "";
  await onSave(
    keyMap[shownHost]
      ? `Switched to ${p.label}.`
      : `Switched to ${p.label}. Paste this server's key above.`
  );
}

// ------------------------------------------------------------ init

async function init() {
  const { selection } = await chrome.storage.local.get("selection");
  if (selection) state = { ...state, ...selection };

  renderProfiles();
  renderOptions();
  renderIntensity();
  $("#custom").value = state.custom || "";
  $("#custom").addEventListener("input", (e) => { state.custom = e.target.value; save(); });
  updateCount();

  $("#go").addEventListener("click", onGo);
  $("#undo").addEventListener("click", async () => {
    await refreshTab();
    if (tab) await chrome.runtime.sendMessage({ cmd: "revert", tabId: tab.id });
  });
  $("#compare").addEventListener("change", async (e) => {
    if (!tab || e.target.name !== "cmp") return;
    await chrome.runtime.sendMessage({ cmd: "compare", tabId: tab.id, original: e.target.value === "original" });
  });

  $("#gear").addEventListener("click", () => {
    const open = $("#settings").hidden;
    $("#settings").hidden = !open;
    $("#gear").setAttribute("aria-expanded", String(open));
  });
  $("#preset").addEventListener("change", onPreset);
  $("#usageReset").addEventListener("click", () => chrome.storage.local.remove("usageTotal"));
  $("#testBtn").addEventListener("click", onTest);
  $("#siteIcon").addEventListener("error", (e) => { e.target.hidden = true; });
  // Typing a different server URL swaps in the key that belongs to it.
  $("#baseUrl").addEventListener("change", () => { stashKey(); showKey(); });
  $("#apiKey").addEventListener("change", () => { stashKey(); $("#apiKey").value = keyMap[shownHost] || ""; });
  for (const sel of ["#baseUrl", "#model", "#contextTokens", "#priceIn", "#priceOut", "#priceUnit", "#noThink", "#apiKey"]) {
    $(sel).addEventListener("change", scheduleSave);
  }
  for (const sel of ["#model", "#priceIn", "#priceOut", "#priceUnit", "#baseUrl"]) {
    $(sel).addEventListener("input", () => { syncPresetSelect(); renderPriceLine(); });
  }
  await loadSettings();

  // Follow the user around: other tab, new page, background updates.
  chrome.tabs.onActivated.addListener(refreshTab);
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (tab && id === tab.id && (info.status || info.url || info.title || info.favIconUrl)) refreshTab();
  });
  chrome.storage.session.onChanged.addListener((changes) => {
    if (!tab) return;
    if (changes["status:" + tab.id]) renderStatus(changes["status:" + tab.id].newValue);
    if (changes["peek:" + tab.id]) renderCompare();
  });
  chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.usageTotal) renderUsage(lastStatus);
  });

  await refreshTab();
}

init();
