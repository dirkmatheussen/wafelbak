# Design Spec — Vliegende Wafelbak Website

## Context and Goal

We build a single-page promotional website based on the flyer for:

- **Vliegend Wafelbak Monster in Absurdistan**
- **Belgisch Kampioenschap Eland Balken**
- **Zondag 27 december, De Mix (Zeugsteeg, Patershol Gent)**
- **Ten voordele van Kom op tegen Kanker**

Primary goal: make a humorous but attractive page that clearly explains the event and gives visitors an easy way to register.

## Approaches Considered

1. **Minimal landing page (static poster + simple form)**  
   Fastest, but too little personality and weak explanation of “Eland Balken”.
2. **Storytelling one-pager with interaction (selected)**  
   Strong visual identity, clear event details, interactive demonstration of the game concept, and straightforward signup flow.
3. **Multi-page mini-site**  
   Rich but unnecessary complexity for this campaign page.

Selected approach: **#2**.

## Information Architecture

Single-page sections:

1. **Hero**: event title, date/location, playful call-to-action.
2. **What is Eland Balken?**: clear rules from flyer + visual demonstration.
3. **Program / practical details**: schedule, jury mention, purpose (charity).
4. **Signup**: registration form with friendly validation.
5. **Live participant list**: immediate feedback after signup.

## UX and Visual Direction

- Bold gradients, rounded cards, warm “waffle” color palette.
- Humorous copy tone while keeping logistics unambiguous.
- Clear CTA buttons and section anchors.
- Motion on key elements (entrance animation for eland demo, subtle hover states).

## Eland Balken Demonstration Design

Interactive simulator:

- Visitor selects how many waffles are “inside” (0..3+).
- UI explains: **“Eerst 3 wafels binnen, dan pas de eland eruit.”**
- Visual progress meter fills with waffle icons.
- Once threshold is reached, an animated “eland” graphic appears with celebratory message.

This turns a cryptic phrase into something memorable and understandable.

## Signup Flow

Form fields:

- Name (required)
- Email (required, pattern check)
- Team / Club (optional)
- Number of waffles you claim you can handle (optional numeric)
- Consent checkbox (required)

Behavior:

- Client-side validation with specific error messages.
- On success: add registration to a local in-browser list (localStorage), clear form, show success state.
- No backend dependency in this first version.

## Data Model (Client-side)

Registration object:

- `id` (timestamp/random)
- `name`
- `email`
- `team`
- `waffleCount`
- `createdAt`

Storage:

- localStorage key `wafelbakRegistrations`

## Error Handling

- Empty required fields: inline messages and focus management.
- Invalid email: inline guidance.
- Storage parse issues: fail gracefully with empty list fallback.

## Testing Strategy

Success criteria:

1. Website loads with attractive layout and complete event information.
2. Eland Balken interactive demo visibly changes state and explains the rule.
3. Signup rejects invalid inputs and accepts valid ones.
4. Successful signup appears in participant list and persists after refresh.

Validation:

- Run local static server.
- Browser walkthrough for happy path and key form validation errors.
- Capture screenshot + demo video as evidence.

## Scope Notes

Out of scope for now:

- Backend storage
- Email confirmations
- Payment or ticketing integration

This keeps delivery fast and focused on campaign conversion.
