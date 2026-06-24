---
name: accessibility
description: Apply web accessibility (a11y) best practices when building, reviewing, or fixing UI in packages/web. Covers WCAG 2.1 AA conformance, semantic HTML, correct ARIA usage, keyboard navigation, focus management, color contrast, and forms. Use when writing components, auditing a page for a11y issues, or running automated a11y checks with axe-core + Playwright.
allowed-tools: Bash(npx:*), Bash(npm:*), Bash(playwright-cli:*), Read(*), Edit(*), Write(*), Grep(*), Glob(*)
---

# Web Accessibility (a11y)

Make UI usable by everyone, including keyboard-only, screen-reader, and low-vision users. Target **WCAG 2.1 Level AA**. This project is React 18 + Vite + Tailwind, built heavily on **Radix UI primitives** and `lucide-react` icons — both ship strong a11y defaults *when used correctly*. Most a11y bugs here come from misusing those primitives or layering semantics on top of them.

## Core principles (WCAG POUR → concrete checks)

- **Perceivable**: every control has a programmatically-discernible name; text meets contrast; no info conveyed by color alone.
- **Operable**: everything works from the keyboard; visible focus; no keyboard traps; respect `prefers-reduced-motion`.
- **Understandable**: labels and instructions are clear; errors are announced; consistent naming.
- **Robust**: valid, semantic HTML; correct ARIA roles/states; works with screen readers (NVDA/VoiceOver).

## 1. Prefer semantic HTML over ARIA

The first and cheapest fix is usually "use the right element."

| Need | ✅ Use | ❌ Avoid |
|------|--------|----------|
| Navigate to a URL | `<a href>` | `<div onClick>` / `<span onClick>` |
| Trigger an action | `<button>` | `<div onClick>` |
| Input | `<input>` with `<label>` | `<div>` + custom field |
| Toggle | `<button aria-pressed>` or Radix `Switch` | `<div role="switch">` hand-rolled |
| List | `<ul>`/`<ol>` + `<li>` | `<div>` rows |

> **aria rule of least power:** No ARIA > correct semantic HTML > ARIA. `role="button"` on a `<div>` still won't give you Enter/Space handling, focusability, or disabled semantics for free — a `<button>` does. Only reach for ARIA when no native element fits.

## 2. Use Radix UI correctly (the project's default)

Radix handles role, keyboard, focus traps, and `aria-*` wiring. Your job is to pass the right props and not fight it.

- **Always render the accessible name.** Dialogs/menus/tooltips need a name:
  - `<Dialog.Title>` (or `<DialogPrimitive.Title>`) — required; visually-hide it (`sr-only`) if there's no visible title.
  - `<Tooltip.Content>` should label its trigger via `aria-describedby` only when the tooltip is supplementary, never as the sole label.
- **Never strip keyboard behavior.** Don't add `onKeyDown` handlers that reimplement what Radix already does (Esc to close, arrow navigation in menus, Tab trapping in dialogs).
- **Disabled vs readonly.** Radix disables interactions and adds `aria-disabled`; prefer the component's `disabled` prop over manually intercepting events.
- **Icons-only buttons must be labeled.** `<button><LucideIcon/></button>` is unlabeled. Add `aria-label` (or wrap text in `sr-only`).

## 3. Icons and images (`lucide-react` + `<img>`)

- Decorative icon (next to visible text): `<Icon aria-hidden />` or `<Icon className="...">` with `aria-hidden="true"` so SRs skip it.
- Icon-only control: give it an accessible name — `<button aria-label="Send message"><Send aria-hidden /></button>`.
- Meaningful `<img>`: always `alt` describing purpose. Decorative: `alt=""` (empty), **not** omitted.
- SVGs that convey state: `role="img"` + `<title>` + `aria-labelledby`.

## 4. Keyboard navigation & focus

- **Tab order follows DOM order.** Don't hack `tabIndex` to reorder; reorder the DOM.
- **`tabIndex` rules:** `0` = focusable in flow (use on rare non-native interactive elements); `-1` = focusable programmatically only (for skip targets / focus management); positive `tabIndex` is almost always wrong.
- **Visible focus:** never `outline: none` without a replacement. With Tailwind keep `focus-visible:ring`/`focus-visible:outline`. Remove outline only via `focus:outline-none` when you supply an equivalent ring.
- **Focus management after dynamic changes:**
  - Opening a modal → focus moves into it; closing → focus returns to the trigger (Radix does this; if building custom, mirror it).
  - Route/view change → move focus to an `<h1>` or the main region.
  - Deleting an item → move focus to a sensible neighbor, never leave it dangling.
- **Skip link:** provide `<a href="#main" className="sr-only focus:not-sr-only ...">Skip to content</a>` as the first focusable element; the target needs `id="main"` and often `tabIndex={-1}`.
- **No keyboard traps:** ensure Esc/modals release focus; test that Tab cycles within a dialog and Shift+Tab works.

## 5. Color & contrast

- **AA thresholds:** normal text ≥ 4.5:1, large text (≥24px regular / ≥18.66px bold) ≥ 3:1, UI components & graphical objects ≥ 3:1.
- **Don't rely on color alone** to convey meaning (error/validation/state) — pair with text or an icon.
- **Focus indicators** need ≥ 3:1 contrast against adjacent colors.
- Tailwind tokens: verify rendered pairs, not just the palette. `text-muted-foreground` on `bg-muted` can fail — compute the ratio. When fixing, prefer the existing token scale over hard-coded hex.

## 6. Forms & labels

- Every input has a `<label>` (Radix `Label` or native) associated via `htmlFor`/`id` or by wrapping. Placeholder is **not** a label.
- Required fields: indicate visually *and* with `aria-required="true"` or `required`.
- Errors: connect with `aria-describedby` to the input, use `aria-invalid="true"`, and announce (e.g. `role="alert"` or `aria-live`).
- Group related fields with `<fieldset>`/`<legend>` (radio groups, checkbox groups).

## 7. Dynamic content & live regions

- Messages that appear after an action (toasts, inline validation, new chat messages) need `aria-live`:
  - `aria-live="polite"` for non-urgent updates (default for most notifications).
  - `aria-live="assertive"` only for critical/immediate alerts.
  - Also set `role="status"` (polite) or `role="alert"` (assertive) for robust support.
- Manage the live region node: it should exist in the DOM (possibly empty) before content is injected, so SRs start observing it.

## 8. Page structure & landmarks

Use landmarks so SR users can navigate by region:
- One `<main>` (the skip-link target), one `<h1>` per view.
- `<header>`, `<nav>`, `<footer>`, `<aside>`/`role="complementary"`.
- Heading levels reflect hierarchy — don't skip (`h1` → `h3`), and don't choose a level for its font size (size with Tailwind).
- Repeated nav: `aria-label` to disambiguate (e.g. `aria-label="Main"` vs `aria-label="Footer"`).

## Automated testing (use this — it catches the regressions)

Two complementary layers. Run from the repo root.

### A. Component/unit level — axe-core + Testing Library (vitest)

Install once into `packages/web`:
```bash
npm -w @club/web i -D axe-core
```
```ts
// packages/web/src/<component>.test.tsx
import { axe } from 'axe-core';

test('has no a11y violations', async () => {
  const { container } = render(<MyComponent />);
  // Attach to document so axe can read computed styles
  document.body.innerHTML = '';
  document.body.appendChild(container);
  const results = await axe(container);
  expect(results.violations).toEqual([]);
});
```
Add an axe violation check to component tests for anything user-facing.

### B. Browser/E2E level — axe + Playwright (pairs with the `playwright-cli` skill)

For rendered pages, drive the browser with the **[[playwright-cli]]** skill and run axe against the live DOM — this catches color contrast, landmark, and focus issues that jsdom can't.

```bash
# Verify the dev server is up first
npm run dev:web   # http://localhost:5173
```
```python
# a11y_audit.py — run with the playwright-cli workflow (headless chromium)
from playwright.sync_api import sync_playwright

AXE_JS = "https://unpkg.com/axe-core@latest/axe.min.js"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:5173")
    page.wait_for_load_state("networkidle")
    page.add_script_tag(url=AXE_JS)
    results = page.evaluate("async () => window.axe.run({runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})")
    print("violations:", len(results["violations"]))
    for v in results["violations"]:
        print(f"- [{v['id']}] {v['help']} ({len(v['nodes'])} nodes) → {v['helpUrl']}")
    browser.close()
```
> The playwright-cli skill documents the full reconnaissance-then-action pattern, session management, and screenshot capture — use it to set up and run this script rather than hand-rolling Playwright.

## Quick pre-flight checklist (before "done")

- [ ] All interactive elements are real `<button>`/`<a>`/`<input>` (or correct Radix component)
- [ ] Icon-only buttons have `aria-label`; decorative icons are `aria-hidden`
- [ ] Every input has an associated `<label>`; errors use `aria-describedby` + `aria-invalid`
- [ ] Full keyboard pass: can reach and operate everything; focus is always visible; no traps
- [ ] One `<h1>`; heading order intact; landmarks present; skip link works
- [ ] Contrast meets AA; meaning isn't color-only
- [ ] Toasts/new content use `aria-live`
- [ ] `axe-core` passes with zero WCAG 2.1 AA violations on the changed UI

## Reference

- WCAG 2.1 quick reference: https://www.w3.org/WAI/WCAG21/quickref/
- ARIA Authoring Practices (APG) patterns: https://www.w3.org/WAI/ARIA/apg/
- axe rules catalog: https://dequeuniversity.com/rules/axe
