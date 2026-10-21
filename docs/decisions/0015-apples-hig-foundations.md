# 0015. Apple's HIG Foundations are the standard for the window

Taken 2026-10-15. Stands.

## Context

The user asked for every repository to follow Apple's Human Interface
Guidelines, as Transient Shuffler does, and sent the 19 Foundations pages.
Wording was already done (0014). Checked against the rest, the window fell
short on contrast, text size, control size, the keyboard, colour alone, and
where its messages sat ([`docs/apple-hig-review.md`](../apple-hig-review.md)).

## Decision

The same as Midi Suggester's 0009, so the family's windows behave alike:

- **Contrast.** Every line of text is at least 7:1 on the ground, Apple's
  target for small text in a dark window: secondary text is `#B0B6C0`,
  warnings `#FF9E96`. The house red `#D2483F` and the ramp's `#8A919C` are
  no longer used for words. Disabled text keeps `#8A919C`; Apple exempts it.
- **Text Size** in a View menu: 100%, 125%, 150%, 200%, with Cmd+=, Cmd+- and
  Cmd+0. Every fixed width goes through `px()`, and `fit()` never makes a
  button narrower than its label. Saved with the preferences, clamped on load.
- **The system's sans-serif at 13 points**, the Mac's default size.
- **Controls 28 points tall, 12 apart** (Apple's Mac default size and
  spacing), pushed with the font before `Begin`.
- **Keyboard navigation** (`ConfigFlags_NavEnableKeyboard`), its ring in the
  near-white `#F2F4F7`: yellow means *on*, and a focused control need not be.
- **Not colour alone**: a chosen button carries an ink bar under its label.
- **The message at the top**, until dismissed or replaced.

## Consequences

- The window is taller and wider at the same content; rows of choices wrap.
- Every new control goes through `pick()`, so it gets the sizes, the ink and
  the chosen bar for nothing. A fixed width must go through `px()`.
- `tests/hig_mock.lua` (shared with the family) adds the HIG calls to the
  mocked ReaImGui and holds the checks; every rule was broken on purpose and
  the suite failed.
- Not met, because a script can't: VoiceOver, Dynamic Type, Increase
  Contrast, right to left. Escape still closes the window.
- Unverified in REAPER: the zoom keys reaching the window, and which face
  "sans-serif" resolves to.

## Final sweep, 16 October 2026 (1.5)

Every Foundations guideline checked again
([`apple-hig-review.md`](../apple-hig-review.md#final-sweep-16-october-2026)),
with the family's shared decisions and Midi Suggester 1.3's findings:

- **Menus and tooltips a step lighter** (`#2A2F37`, edge `#3A404A`); menu
  bar, highlight and resize corner from the ramp; menu keys `#BFC5CE`.
- **Controls' edges 3:1**: every box and slider (`#8A919C`), the scrollbar
  thumb (`#6D7581`).
- **Rows wrap** (`flowPlace`, `flowWords`), secondary text wraps, a minimum
  window size; a change's whole line is in its tooltip.
- **Escape** lets go first. This reverses "Escape still closes the window"
  above.
- **Asking first** before *New Set*, *Use Selected Items* or closing throws
  unticked boxes away; not on a setting changed (a different batch).
- Bold headings, the item in the title, a line naming the roll's notes, the
  arrows named.
