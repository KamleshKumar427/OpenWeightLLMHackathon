# Selko — Make Any Webpage Accessible

> Working name. _Selko_ comes from the Finnish _selkokieli_ ("plain language"). We can change it.

A Chrome extension that makes any webpage more accessible, as the user needs it. Users can pick a ready-made preset ("High contrast", "Simplify this page", "Describe images") or type a plain request like _"make this easier to read for someone with dyslexia"_. The extension uses open models hosted on LUMI to understand the page and change it in place.

Built for the **LUMI AI Hackathon**.

---

## 1. The Problem

- Most of the web still fails basic accessibility checks: images without alt text, low-contrast text, form fields without labels, unclear buttons, and dense jargon.
- Existing accessibility tools only do one thing each. A contrast tool doesn't explain jargon, and a screen reader can't fix a badly built page.
- People's needs are different and often overlap. Someone with low vision, someone with dyslexia, an older user, a non-native speaker, and someone with ADHD each need different changes, sometimes several at once.
- Website owners fix accessibility slowly, if they fix it at all. Users can't wait for them.

## 2. The Solution

A browser extension that puts the **user in control** of accessibility on **any** site:

1. **Presets.** One-click fixes for common needs.
2. **Free-text prompt.** The user describes what they need in their own words, and the AI works out which changes to make.
3. **AI that understands the page.** It reads the page's structure, text and images, then makes targeted changes: rewriting text, adding descriptions, restyling, and repairing semantics.
4. **Safe and reversible.** Every change can be previewed, toggled and undone. The original page is never lost.

## 3. Target Users

| User                              | Typical needs                                                        |
| --------------------------------- | -------------------------------------------------------------------- |
| Low vision                        | Larger text, high contrast, image descriptions, zoom-friendly layout |
| Colour blindness                  | Recoloured charts and status colours, colour info shown as text      |
| Dyslexia / reading difficulties   | Readable font, more spacing, shorter sentences, simplified wording   |
| Cognitive / ADHD                  | Focus mode, less clutter, summaries, step-by-step breakdowns         |
| Screen reader users               | Missing alt text, labels, landmarks and headings added               |
| Motor impairments                 | Bigger click targets, better keyboard navigation                     |
| Older users / non-native speakers | Plain language, translation, explanations of jargon                  |

## 4. Core Features

### 4.1 Presets (one click)

Some presets need no AI at all, so they apply instantly. Others call a model.

| Preset                    | What it does                                                                   | Uses AI?            |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------- |
| **High Contrast**         | Enforces WCAG AA/AAA contrast and recolours low-contrast text                  | No (rule-based)     |
| **Larger Text & Spacing** | Scales fonts and increases line, letter and paragraph spacing                  | No                  |
| **Dyslexia Friendly**     | Readable font, left-aligned text, no justification, spacing                    | No                  |
| **Reduce Motion**         | Stops animations, autoplay, carousels and parallax                             | No                  |
| **Colour-Blind Mode**     | Colour filters, plus text labels where meaning depends on colour               | Partly              |
| **Focus / Reading Mode**  | Strips ads, sidebars and popups so only the main content remains               | Yes                 |
| **Simplify Text**         | Rewrites paragraphs in plain language (like _selkokieli_)                      | Yes                 |
| **Summarise Page**        | Short summary at the top of the page                                           | Yes                 |
| **Describe Images**       | Generates alt text for images that have none                                   | Yes (vision)        |
| **Explain Charts**        | Turns charts and infographics into a text description or data table            | Yes (vision)        |
| **Fix Page Semantics**    | Adds missing labels, ARIA roles, landmarks, button names and heading structure | Yes                 |
| **Translate (FI ⇄ EN)**   | Translates page content in place                                               | Yes                 |
| **Read Aloud**            | Text-to-speech for the page or the selected text                               | No (Web Speech API) |

Presets can be **combined** (e.g. Dyslexia Friendly + Simplify Text) and saved as a **personal profile** that applies automatically on every site, or only on chosen sites.

### 4.2 Free-text Prompt

A text box where the user describes what they need, for example:

- _"I'm colour blind. Make the red and green status labels distinguishable."_
- _"Explain this insurance page like I'm 12."_
- _"Make the buttons bigger and remove everything except the article."_
- _"What does this chart show?"_
- _"Selitä tämä sivu selkokielellä."_ (Explain this page in plain Finnish.)

The AI reads the prompt and the page, then returns a **plan of changes**. The extension shows a short preview ("I will: increase the font size, recolour 4 labels, hide 3 sidebars") and applies it.

### 4.3 Ask About the Page

A small chat panel for questions about the current page, e.g. _"What's the deadline on this form?"_ or _"Which button submits the application?"_ Answers can point to and highlight the relevant element on the page.

### 4.4 Accessibility Report (bonus)

A quick audit of the current page: issues found, which ones the extension fixed, and a score before and after. Useful for the demo, and for developers who want to see what their site is missing.

## 5. How We Use the LUMI Models

Each task goes to the model best suited for it:

| Model                                  | Strengths                                                      | Role in the extension                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LumiOpen/Llama-Poro-2-70B-Instruct** | Strong instruction following, very good in Finnish and English | **Main language model:** understanding the user's prompt, simplifying text, summarising, translating, plain-language Finnish (_selkokieli_), page Q&A          |
| **LumiOpen/Poro-34B-chat**             | Finnish, English and code; smaller and faster                  | **Fast, lighter tasks:** short rewrites, button and label naming, quick translations, fallback when the 70B model is busy                                      |
| **Qwen/Qwen3-Coder-Next**              | Built for coding agents                                        | **Page-change planner:** reads the simplified DOM and outputs a structured list of changes (CSS rules, ARIA attributes, element hide/show, layout fixes)       |
| **Qwen/Qwen3.6-27B** (vision-language) | Understands images                                             | **Vision tasks:** alt text for images, describing charts, infographics and icons, and reviewing screenshots for visual problems (low contrast, cramped layout) |

### Model Router

A small router in the backend decides which model(s) to call:

```
User request / preset
        │
        ▼
   ┌──────────┐
   │  Router  │── visual content? ─────────▶ Qwen3.6-27B (vision)
   └──────────┘── change layout/styles? ──▶ Qwen3-Coder-Next
        │       ── rewrite/explain text? ──▶ Poro-2-70B (or Poro-34B for small jobs)
        ▼
  Combined change plan ──▶ Extension applies it to the page
```

A free-text prompt can trigger several models. For example, _"make this page easier for my grandma"_ may produce a coder plan (bigger text and buttons, less clutter) together with Poro rewrites (simpler wording).

## 6. Architecture

```
┌─────────────────────────── Chrome Extension (Manifest V3) ───────────────────────────┐
│                                                                                       │
│  Side Panel / Popup UI      Content Script                    Service Worker          │
│  - presets                  - reads the page (simplified DOM, - talks to backend       │
│  - prompt box                 text blocks, images)            - caching               │
│  - preview / undo           - applies change plan             - user profiles         │
│  - profiles                 - keeps original for undo           (chrome.storage)      │
│                                                                                       │
└──────────────────────────────────────────┬────────────────────────────────────────────┘
                                           │ HTTPS
                                ┌──────────▼──────────┐
                                │   Backend / Proxy   │  - keeps the API keys
                                │  (FastAPI or Node)  │  - model router
                                │                     │  - prompt templates
                                └──────────┬──────────┘  - validates responses
                                           │
                        ┌──────────────────▼──────────────────┐
                        │      Models hosted on LUMI          │
                        │  Poro-2-70B · Poro-34B ·            │
                        │  Qwen3-Coder-Next · Qwen3.6-27B     │
                        └─────────────────────────────────────┘
```

### Key components

1. **Page Extractor (content script).** Builds a compact view of the page that the models can work with: headings, text blocks, links, buttons, form fields and images, each with a stable ID. Scripts, styles and noise are dropped so the request stays small.
2. **Change Plan (structured output).** Models don't send back free-form JavaScript. They return a **JSON plan** using a fixed set of allowed actions:
   ```json
   [
     {
       "action": "setStyle",
       "target": "el-42",
       "css": { "font-size": "20px" }
     },
     {
       "action": "setAttribute",
       "target": "img-7",
       "name": "alt",
       "value": "Bar chart showing..."
     },
     {
       "action": "replaceText",
       "target": "p-13",
       "text": "Simpler version of the paragraph..."
     },
     { "action": "hide", "target": "aside-2" },
     { "action": "injectCSS", "css": "body { line-height: 1.8; }" }
   ]
   ```
   This makes changes **safe** (no arbitrary code runs), **checkable** (the backend validates the schema) and **reversible** (every action has an undo).
3. **Applier and Undo Stack.** The content script applies each action, keeps the original values, and lets the user toggle each change or all of them.
4. **Backend Proxy.** Keeps model credentials out of the extension, routes requests, holds the prompt templates, and validates model output before it reaches the browser.
5. **Profiles.** Saved presets and preferences in `chrome.storage`, with optional auto-apply per site.

## 7. User Flow

1. The user installs the extension and, on first run, picks their needs (e.g. "I have dyslexia", "I prefer plain language"). This creates a **profile**.
2. They open any website. The profile's no-AI presets apply instantly.
3. They open the side panel and either:
   - click a preset (e.g. _Describe Images_), or
   - type a request (e.g. _"Explain this tax form simply"_).
4. The extension shows a **preview** of the planned changes and then applies them, with streaming for longer text rewrites.
5. The user can toggle changes, undo all of them, ask follow-up questions, or save the setup for this site.

## 8. Privacy and Safety

- **Rule-based presets run locally.** Page content is only sent to the backend when an AI feature is used.
- **Sensitive pages are skipped:** the extension won't send content from password fields, payment forms or pages the user has excluded.
- **No arbitrary code execution.** Only the fixed set of plan actions is allowed.
- **Rewrites are labelled.** AI-rewritten or AI-generated text is marked so users know it isn't the original, and they can always view the original.
- **Open models on European infrastructure (LUMI).** A strong point for privacy and data sovereignty.

## 9. Why This Stands Out

- **User-side accessibility.** It works on _any_ site today, without waiting for site owners.
- **Personalised.** Built around one person's mix of needs, not a single fixed fix.
- **Uses all four models,** each for what it does best: language, code and vision.
- **Finnish-first plain language.** Poro makes _selkokieli_ and Finnish ⇄ English support a real feature, which fits LUMI and the local community well.
- **Safe by design.** Changes are structured, checked and reversible.

## 10. Demo Scenario

1. Open a cluttered, poorly accessible page (e.g. a government or news page with images, charts and a long form).
2. Run the **Accessibility Report** and show the issues found.
3. Click **Dyslexia Friendly**: the change is instant, with no AI.
4. Click **Describe Images**: alt text appears and a chart becomes a readable description (Qwen3.6-27B).
5. Type _"Selitä tämä sivu selkokielellä"_: the page is rewritten in plain Finnish (Poro-2-70B).
6. Type _"Make the form easier to use, with bigger buttons and clear labels"_: the layout and labels are fixed (Qwen3-Coder-Next).
7. Run the report again and show the score before and after. Click **Undo all** to show the original page is untouched.

## 11. Stretch Goals

- Voice input for the prompt box (speech-to-text).
- Learning from the user: suggest presets based on what they usually apply.
- Shareable "fix packs" for popular sites, so the community can reuse good change plans.
- Firefox / Edge support.
- A developer mode that turns detected issues into suggested code fixes for site owners (Qwen3-Coder-Next).

## 12. Open Questions

- How are the LUMI models exposed during the hackathon (OpenAI-compatible API? rate limits? latency)? This decides how much we cache and stream.
- How large a page can we send in one request? We may need to split long pages and process them in chunks.
- Which presets do we fully build for the demo, and which do we show as "coming soon"?
- Popup or Chrome Side Panel for the main UI? (The Side Panel is better for chat and keeping the page visible.)
