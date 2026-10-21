const $ = (s) => document.querySelector(s);

const PRESETS = {
  h200: { baseUrl: "http://86.50.168.167:9002/v1", model: "Qwen/Qwen3.8-27B-FP8" },
  a100: { baseUrl: "http://86.50.168.167:9001/v1", model: "Qwen/Qwen3.8-27B-FP8" },
  aitta: { baseUrl: "https://aitta-api.csc.fi/openai/v1", model: "Qwen/Qwen3.8-27B" },
};

let state = { profiles: [], options: [], intensity: "balanced", custom: "" };
let tab = null;

// ------------------------------------------------------------ rendering

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

// ------------------------------------------------------------ state

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

// ------------------------------------------------------------ status + actions

function renderStatus(s) {
  const el = $("#status"), go = $("#go");
  el.className = "status";
  const working = s?.state === "working";
  if (!s || s.state === "idle" && !s.message) {
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

function pageIsSupported() {
  const url = tab?.url || "";
  return /^(https?:|file:)/.test(url) && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url);
}

async function onGo() {
  const status = (await chrome.storage.session.get("status:" + tab.id))["status:" + tab.id];
  if (status?.state === "working") {
    await chrome.runtime.sendMessage({ cmd: "cancel", tabId: tab.id });
    return;
  }
  if (!pageIsSupported()) {
    renderStatus({ state: "error", message: "Chrome does not let extensions change this kind of page. Open a normal website and try again." });
    return;
  }
  if (!state.profiles.length && !state.options.length && !state.custom.trim()) {
    renderStatus({ state: "error", message: "Pick at least one profile or adjustment, or write what you need." });
    return;
  }
  state.custom = $("#custom").value;
  await chrome.storage.local.set({ selection: state });
  renderStatus({ state: "working", step: "Starting…" });
  await chrome.runtime.sendMessage({ cmd: "apply", tabId: tab.id, selection: state });
}

// ------------------------------------------------------------ settings

async function loadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const s = {
    baseUrl: "http://86.50.168.167:9002/v1",
    model: "Qwen/Qwen3.8-27B-FP8",
    apiKey: "",
    noThink: true,
    ...(settings || {}),
  };
  $("#baseUrl").value = s.baseUrl;
  $("#model").value = s.model;
  $("#apiKey").value = s.apiKey;
  $("#noThink").checked = s.noThink;
  $("#preset").value =
    Object.entries(PRESETS).find(([, p]) => p.baseUrl === s.baseUrl && p.model === s.model)?.[0] || "";
}

const readSettings = () => ({
  baseUrl: $("#baseUrl").value.trim(),
  model: $("#model").value.trim(),
  apiKey: $("#apiKey").value.trim(),
  noThink: $("#noThink").checked,
});

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
    if (!r.ok) return settingsMsg("Could not connect: " + r.error, true);
    settingsMsg(
      r.hasModel
        ? `Connected. Model "${s.model}" is available.`
        : `Connected, but "${s.model}" was not listed. Available: ${r.models.slice(0, 4).join(", ") || "none"}.`,
      !r.hasModel
    );
  } catch (err) {
    settingsMsg(err.message, true);
  }
}

async function onSave() {
  const s = readSettings();
  try {
    await ensureHostAccess(s.baseUrl);
    await chrome.storage.local.set({ settings: s });
    settingsMsg("Saved.");
  } catch (err) {
    settingsMsg(err.message, true);
  }
}

// ------------------------------------------------------------ init

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    await chrome.runtime.sendMessage({ cmd: "revert", tabId: tab.id });
  });

  $("#gear").addEventListener("click", () => {
    const panel = $("#settings");
    panel.hidden = !panel.hidden;
    $("#gear").setAttribute("aria-expanded", String(!panel.hidden));
  });
  $("#preset").addEventListener("change", (e) => {
    const p = PRESETS[e.target.value];
    if (p) { $("#baseUrl").value = p.baseUrl; $("#model").value = p.model; }
  });
  $("#testBtn").addEventListener("click", onTest);
  $("#saveBtn").addEventListener("click", onSave);
  await loadSettings();

  const key = "status:" + tab.id;
  renderStatus((await chrome.storage.session.get(key))[key]);
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes[key]) renderStatus(changes[key].newValue);
  });
}

init();
