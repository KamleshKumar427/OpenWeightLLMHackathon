# Selkeä – accessibility for any website

*Selkeä* is Finnish for "clear". Open the extension on any page, say who you are and what you
need, and an open-weight LLM edits the page's HTML and CSS so it works for you.

## Install (about 1 minute)

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and choose this folder (`selkea-extension`).
3. Pin the Selkeä icon, open the popup, click the **⚙** and paste your API key / Aitta token.
   The H200 preset is already filled in. Click **Test connection**, then **Save**.
4. Open any website (try `test-pages/messy.html` via a local server, or a real page),
   tick a profile, adjust, click **Make this page accessible**.

Reload the extension on `chrome://extensions` after you edit any file. Reload the page too,
because content scripts already on the page do not update by themselves.

## What the user sees

| Step | UI |
|---|---|
| 1 | Pick who the page is for: blind, low vision, colour blind, dyslexia, cognitive, ADHD, seizure, motor. Each ticks sensible adjustments. |
| 2 | Tick individual adjustments (contrast, bigger text, plain language, labels, hide clutter…) and a strength: Light / Balanced / Strong. |
| 3 | Optional free text: "Bright backgrounds give me headaches, keep it in Finnish." |

Everything goes to the model, which decides what to do. A small pill on the page shows
progress and has an **Undo** button.

## How it works

```
popup ──apply──▶ background (service worker)
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

### Safety

The page text is untrusted and can try to steer the model, so model output is treated as untrusted too:

- CSS: `url()`, `@import`, `@font-face`, `expression()` are stripped.
- HTML: rebuilt from a tag and attribute whitelist; no scripts, forms, iframes, event handlers, `javascript:` links.
- Attributes the model may set: `alt`, `title`, `lang`, `dir`, `for`, `id`, `tabindex` (0/-1), valid ARIA roles, `aria-*`.
- The model cannot hide `<main>`, the `<h1>` area, or anything holding most of the page's text.
- Form values are never sent. Only `origin + path` of the URL is sent, no query string.
- The API key lives in the service worker; the page never sees it.

If the model server cannot be reached, plain CSS presets for the ticked adjustments are applied instead, and the pill says so.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest. Default servers are pre-approved; any other server asks once. |
| `catalog.js` | Profiles and adjustments, shared by the UI and the prompt. Add an option here and it appears everywhere. |
| `popup.html/.css/.js` | The three-step UI and settings. |
| `background.js` | Prompts, model calls, sanitizing, job orchestration, fallback presets. |
| `content.js` | Snapshot, safe patch application, undo, status pill. |
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
- Text rewrites replace a block's inline markup, so blocks containing buttons or inputs are skipped on purpose.
- All teams share the H200/A100. If calls get slow, switch the preset in ⚙.
