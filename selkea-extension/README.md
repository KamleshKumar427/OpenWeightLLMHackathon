# Selkeä – accessibility for any website

*Selkeä* is Finnish for "clear". Open the extension on any page, say who you are and what you
need, and an open-weight LLM edits the page's HTML and CSS so it works for you.

## Install (about 1 minute)

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and choose this folder (`selkea-extension`).
3. Pin the Selkeä icon and click it. A **side panel** opens (it stays open while you switch tabs).
   Click the **⚙**, pick a model preset, and paste your API key / Aitta token. Click **Save**.
4. Open any website (try `test-pages/messy.html` via a local server, or a real page),
   tick a profile, adjust, click **Make this page accessible**.

Reload the extension on `chrome://extensions` after you edit any file. Reload the page too,
because content scripts already on the page do not update by themselves.

**Keys and private servers.** Nothing secret lives in this code. Paste keys into the ⚙ Settings panel, or put them in a git-ignored `.env` at the repo root (copy `.env.example`) and run `node scripts/make-config.mjs`. That writes `selkea-extension/config.local.js`, which the extension reads for the hackathon server address and any keys. Without it the extension offers only the public LUMI Aitta models.

**Permissions:** the extension asks for access to all sites because the side panel has to work on
whichever tab you switch to. Nothing runs on a page until you click the button or use the shortcut,
and nothing is sent anywhere except the page snapshot to the model server you configured.

## What the user sees

| Step | UI |
|---|---|
| 1 | Pick who the page is for: blind, low vision, colour blind, dyslexia, cognitive, ADHD, seizure, motor. Each ticks sensible adjustments. |
| 2 | Tick individual adjustments (contrast, bigger text, plain language, labels, bionic reading, hide clutter…) and a strength: Light / Balanced / Strong. |
| 3 | Optional free text: "Bright backgrounds give me headaches, keep it in Finnish." |

Everything goes to the model, which decides what to do. A small pill on the page shows progress.

After a run you get:

- **Accessibility check:** issues found before and after (low contrast, missing alt text, unnamed
  links and buttons, unlabeled fields, autoplay, missing landmark and language), measured in the
  browser on the finished page. It only counts what automated checks can find.
- **Adapted / Original switch** (also **Show original** on the in-page pill): flips between the two
  versions instantly. No model call; every edit is stored as an undo/redo pair.
- **Highlight:** rewritten text and inserted boxes flash blue for a moment (skipped for the
  "Stop animations" option and the seizure profile).
- **Tokens and cost** for this run and all runs.
- **Stop:** the main button becomes **Stop** while a run is going (the in-page pill has one too). It cancels the
  request at once and keeps whatever was already applied; **Undo** removes it. While a run is going the
  extension keeps its background worker alive, because Chrome would otherwise shut it down during a long
  silent wait (Aitta can take minutes to load a model) and lose track of the job. If that ever happens,
  Stop still clears the stuck "working" state.

### Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| `Alt+Shift+A` | Apply your saved setup to the current tab |
| `Alt+Shift+O` | Switch between the original and adapted page |

Change them at `chrome://extensions/shortcuts`.

## How it works

```
side panel ──apply──▶ background (service worker)
                   1. content.js: snapshot  (compact HTML + measured contrast + counts)
                   2. LLM call #1: needs + snapshot ─▶ JSON patch
                        css · attributes · hide · insert · lang · pause_media · rewrite?
                   3. apply patch to the live page          (CSS via insertCSS)
                   4. self-check: re-measure contrast, ask the model to fix what still fails
                   5. LLM calls #2…n (parallel, 3 at a time): rewrite text blocks
                        (plain language, explain hard words, …) and apply them as they arrive
```

Why a patch and not a whole new page? A rewritten full document would cost tens of thousands
of output tokens, hit the 32k output limit on larger pages, and break the page's JavaScript
(menus, forms, state). Editing the live DOM gives the same visible result, keeps the page
working, and can be undone in one click.

### Options that skip the model

**Bionic reading** is a plain text transform in `content.js` (`applyBionic`): it bolds the first
~45% of each word in paragraphs, list items, quotes and table cells. It leaves menus, headings,
code and form controls alone, runs after any text rewrite so it sees the final wording, and Undo
restores the page exactly. If it is the only thing ticked (no profile, no note), the extension
makes no model call at all, so it is instant and costs nothing.

### Safety

The page text is untrusted and can try to steer the model, so model output is treated as untrusted too:

- CSS: `url()`, `@import`, `@font-face`, `expression()` are stripped.
- HTML: rebuilt from a tag and attribute whitelist; no scripts, forms, iframes, event handlers, `javascript:` links.
- Attributes the model may set: `alt`, `title`, `lang`, `dir`, `for`, `id`, `tabindex` (0/-1), valid ARIA roles, `aria-*`.
- The model cannot hide `<main>`, the `<h1>` area, or anything holding most of the page's text.
- Form values are never sent. Only `origin + path` of the URL is sent, no query string.
- The API key lives in the service worker; the page never sees it.

If the model server cannot be reached, plain CSS presets for the ticked adjustments are applied instead, and the pill says so.

## Using LUMI Aitta

Written from the [Aitta docs](https://docs.lumi-supercomputer.eu/laif/inference/aitta/):

1. Make a token at **aitta-auth.csc.fi/myToken** (log in, pick one of your LUMI projects). It lasts
   90 days and stops working earlier if the project ends.
2. In ⚙ pick an Aitta preset and paste **only the token** (no `Bearer`, no quotes; the extension
   strips those if you include them). Press **Save**, then **Test connection**.
3. The base URL is `https://aitta-api.csc.fi/openai/v1`; the extension sends
   `Authorization: Bearer <token>` to `/chat/completions`.

What the extension does for you, because Aitta is not a plain OpenAI server:

- **One key per server.** The Aitta token and the hackathon key are stored separately and each is
  only ever sent to its own server. Switching presets swaps the key box.
- **Test connection** checks `/worker/<model>`, which needs a valid token and also tells us whether the
  model is already running (a cold model takes minutes to start).
- **Cold start.** Aitta loads a model on demand and sends nothing until it is ready, which "can take
  several minutes". The extension checks whether the model is running, asks Aitta to preload it if
  not, shows "Starting … on LUMI", and waits up to 15 minutes instead of 5.
- **Rate limit.** On HTTP 429 it waits and retries instead of failing.
- **Context window.** Every request is sized to the model's window (⚙ → **Context**): the page snapshot
  is trimmed, the answer budget is capped, and a prompt that cannot fit fails at once with a clear
  message. Llama-Poro-2-70B has only 8192 tokens, so on it a page snapshot is capped at about 6,400
  characters and the model is asked for a short reply. Aitta wraps "too long" and other model
  failures as a generic HTTP 500, so on a 400/422/500 the extension retries twice: without the
  "thinking off" field, then with a 2048-token answer. Pick a larger-context model for long pages.
- **Clear errors.** A rejected or missing token is shown as an error with the fix, never hidden
  behind the fallback presets.
- **Unsupported fields.** If a server refuses the "thinking off" switch, the extension retries once
  without it and remembers that for that server.

Models in the preset list: Qwen3.6-27B, Qwen3.8-27B, Qwen3-Coder-Next, Llama-Poro-2-70B-Instruct and
gpt-oss-120b. Prices: see "Tokens and price" below.

## Tokens and price

You do not set anything up. Pick a model and the price comes with it. During a run the panel shows
**Cost so far** with the tokens used (it ticks up after every model call); when the run ends it shows
**one final price** for that run, plus a small running total.

`cost = input_tokens / 1,000,000 x input price + output_tokens / 1,000,000 x output price`

Default prices (per 1M tokens), kept in `catalog.js`:

| Model | In / out | Where it comes from |
|---|---|---|
| Hackathon H200 / A100 | free | the university's own servers |
| Qwen3-Coder-Next (Aitta) | 0.23 / 7.76 GPU-h | the rate shown in the Aitta web UI |
| Qwen3.6-27B | ≈ $0.25 / $2.00 | OpenRouter list price |
| Qwen3.8-27B | ≈ $0.45 / $3.20 | Alibaba Cloud list price |
| gpt-oss-120b | ≈ $0.15 / $0.60 | OpenRouter list price |
| Llama-Poro-2-70B-Instruct | ≈ $0.20 / $0.20 | typical 70B Llama price; Poro has no public price |

A tilde means an **estimate**. Aitta bills in GPU-hours and publishes the rates only in its logged-in web
UI (the API's model metadata is admin-only), so for everything except Coder-Next the extension uses a
public market price for the same model. If you have Aitta's own numbers, open ⚙ → **Advanced** and fill
in both price fields; they replace the default. Leave them empty to go back to the default.

- If a server does not report token usage, tokens are estimated at about 4 characters each and the price shows a tilde.
- Stopping a run mid-call loses the tokens of the request still in flight, because its answer never arrives.
- Settings save themselves; there is no Save button.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest: side panel, shortcuts, permissions. |
| `catalog.js` | Profiles and adjustments, shared by the UI and the prompt. Add an option here and it appears everywhere. |
| `panel.html/.css/.js` | The side-panel UI: tiles, results, Original/Adapted switch, settings. |
| `background.js` | Prompts, model calls, sanitizing, job orchestration, fallback presets. |
| `content.js` | Snapshot, safe patch application, undo/redo, bionic reading, status pill. |
| `test-pages/messy.html` | A deliberately inaccessible Finnish page for demos. |

## Tested

On `test-pages/messy.html` with Qwen3.8-27B-FP8 on the H200, low-vision + dyslexia profile
(measured in the browser, model calls real):

| | Before | After |
|---|---|---|
| Low-contrast text elements | 15 | 0 |
| Images without alt | 3 | 0 |
| Unnamed links / buttons | 3 | 0 |
| Unlabeled inputs | 3 | 0 |
| Running animations | 2 | 0 |
| `<main>` landmark / page language | no / none | yes / `fi` |

Planning call about 12 s, Finnish text rewrite about 3 s. These came from the page logic and
real model calls run separately; the packaged extension itself was not loaded into Chrome in
that run, so do one end-to-end click-through before the demo.

## Known limits

- The model cannot see images (the 27B config has no image input), so alt text comes from context.
- Pages that redraw their DOM (heavy single-page apps) may undo some edits; press the button again.
- Chrome blocks extensions on `chrome://` pages and the Web Store.
- The side panel needs Chrome 114 or newer.
- Small-context models (Poro-2-70B, 8192 tokens) only see the top of long pages and may need a shorter reply; use a Qwen preset for big pages.
- Most prices are public-market estimates, not Aitta's own GPU-hour rates; see "Tokens and price".
- Text rewrites replace a block's inline markup, so blocks containing buttons or inputs are skipped on purpose.
- All teams share the H200/A100. If calls get slow, switch the preset in ⚙.
