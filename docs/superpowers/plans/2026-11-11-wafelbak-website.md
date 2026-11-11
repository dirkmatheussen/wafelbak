# Wafelbak Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a humorous, visually attractive one-page event website with an interactive “Eland Balken” explanation and a working signup flow.

**Architecture:** A static front-end (`index.html` + `styles.css` + `app.js`) renders all content. Logic for registration validation and Eland Balken state derivation is implemented in isolated pure functions and tested with Node’s built-in test runner. Browser localStorage keeps registrations persistent in this first version.

**Tech Stack:** HTML5, CSS3, vanilla JavaScript (ES modules), Node.js `node:test`.

## Global Constraints

- Keep copy and event facts aligned with the flyer.
- Include a clear and playful explanation of “Eland Balken”.
- Provide a usable registration form with validation.
- Keep solution lightweight with no backend dependency.

---

### Task 1: Create test-first logic module for Eland Balken and signup validation

**Files:**
- Create: `src/lib/wafelbak.js`
- Create: `tests/wafelbak.test.js`

**Interfaces:**
- Produces:
  - `getElandBalkenState(waffleCount: number): { stage: "start" | "warming-up" | "ready", message: string }`
  - `validateRegistration(input: { name: string, email: string, team?: string, waffleCount?: string, consent: boolean }): { valid: boolean, errors: Record<string,string> }`
  - `createRegistration(input: { name: string, email: string, team?: string, waffleCount?: string }): { id: string, name: string, email: string, team: string, waffleCount: number | null, createdAt: string }`
- Consumes: none

- [ ] **Step 1: Write failing tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { getElandBalkenState, validateRegistration, createRegistration } from "../src/lib/wafelbak.js";

test("getElandBalkenState returns ready at 3 waffles", () => {
  const result = getElandBalkenState(3);
  assert.equal(result.stage, "ready");
});

test("validateRegistration rejects missing required fields", () => {
  const result = validateRegistration({ name: "", email: "", consent: false });
  assert.equal(result.valid, false);
  assert.equal(result.errors.name, "Naam is verplicht.");
  assert.equal(result.errors.email, "E-mail is verplicht.");
  assert.equal(result.errors.consent, "Je moet akkoord gaan om in te schrijven.");
});

test("createRegistration normalizes values", () => {
  const registration = createRegistration({ name: "  Ana  ", email: " ANA@EXAMPLE.COM ", team: "  Team X ", waffleCount: "5" });
  assert.equal(registration.name, "Ana");
  assert.equal(registration.email, "ana@example.com");
  assert.equal(registration.team, "Team X");
  assert.equal(registration.waffleCount, 5);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/wafelbak.test.js`  
Expected: FAIL because functions are not implemented yet.

- [ ] **Step 3: Write minimal implementation**

```js
export function getElandBalkenState(waffleCount) {
  const count = Number.isFinite(waffleCount) ? waffleCount : 0;
  if (count >= 3) {
    return { stage: "ready", message: "Eland gespot! Tijd om te balken." };
  }
  if (count >= 1) {
    return { stage: "warming-up", message: `Nog ${3 - count} wafel(s) te gaan.` };
  }
  return { stage: "start", message: "Start met je eerste wafel." };
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/wafelbak.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wafelbak.js tests/wafelbak.test.js
git commit -m "feat: add tested wafelbak domain logic"
```

### Task 2: Build attractive one-page UI and wire interactions

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `src/main.js`
- Modify: `README.md`

**Interfaces:**
- Consumes:
  - `getElandBalkenState(waffleCount: number): { stage: "start" | "warming-up" | "ready", message: string }`
  - `validateRegistration(input: { name: string, email: string, team?: string, waffleCount?: string, consent: boolean }): { valid: boolean, errors: Record<string,string> }`
  - `createRegistration(input: { name: string, email: string, team?: string, waffleCount?: string }): { id: string, name: string, email: string, team: string, waffleCount: number | null, createdAt: string }`
- Produces:
  - Interactive Eland Balken demo
  - Signup flow writing to localStorage key `wafelbakRegistrations`

- [ ] **Step 1: Build HTML structure and semantic sections**

```html
<section id="hero"></section>
<section id="eland-balken"></section>
<section id="praktisch"></section>
<section id="inschrijven"></section>
```

- [ ] **Step 2: Implement CSS visual style and responsive layout**

```css
:root { --bg:#120f1f; --accent:#f59e0b; --pink:#f43f5e; }
.hero { background: linear-gradient(135deg, #2b1d46, #5b1f3a); }
.card { border-radius: 20px; box-shadow: 0 14px 40px rgba(0,0,0,.2); }
@media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Implement JS interactions**

```js
import { getElandBalkenState, validateRegistration, createRegistration } from "./lib/wafelbak.js";
const STORAGE_KEY = "wafelbakRegistrations";
// Update eland demo state from slider
// Validate form, persist registration, re-render participant list
```

- [ ] **Step 4: Verify in browser**

Run: `python3 -m http.server 4173 --bind 127.0.0.1` then open `http://127.0.0.1:4173`  
Expected: visual sections render, demo updates, signup works and persists after refresh.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css src/main.js README.md
git commit -m "feat: build playful wafelbak event website with signup"
```

### Task 3: Validation evidence and handoff artifacts

**Files:**
- Create: `/opt/cursor/artifacts/code-tour-author-handoff.md`

**Interfaces:**
- Produces:
  - Manual test evidence (video + screenshot under `/opt/cursor/artifacts/`)
  - Handoff file with decision/risk/verified sections

- [ ] **Step 1: Execute terminal validation**

Run: `node --test tests/wafelbak.test.js`  
Expected: PASS.

- [ ] **Step 2: Record UI walkthrough**

Use screen recording while demonstrating:
- Eland Balken demo from 0 to 3 waffles.
- Form validation failure case.
- Successful signup and persisted list after refresh.

- [ ] **Step 3: Save required handoff file**

```md
<decision>Kies voor statische one-pager met pure JS-logica en lokale opslag om snel campagne-impact te leveren zonder backend.</decision>
<risk>Lokale opslag is toestelgebonden; geen gedeelde deelnemerslijst over browsers heen.</risk>
<verified>Node tests groen + browserdemo met eland-interactie, validatiefout, succesvolle inschrijving en persist na refresh.</verified>
```
