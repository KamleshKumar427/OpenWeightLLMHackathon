// Shared by popup.js (to draw the UI) and background.js (to build the prompt).
// The `needs` / `hint` strings are written for the model, not for the user.
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
