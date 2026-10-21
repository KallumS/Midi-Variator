# 0014. The window's text follows Apple's writing guidelines

Taken 2026-10-14. Stands.

## Context

The user asked for every one of their windows to follow Apple's Human
Interface Guidelines on writing
(developer.apple.com/design/human-interface-guidelines/writing), as Noterator
and Miderator already do (Noterator's decision 0053). This window mixed
sentence-case buttons ("Vary selected in place") with title-case ones, used
" - " and "->" for dashes and arrows, straight quotes, and messages such as
"The item has gone" and "REAPER would not make the items." with no way
forward.

## Decision

One style for each kind of text, the same as Noterator's 0053 and Midi
Suggester's 0008:

- **Buttons, switches, boxes, headings and dialog titles** in title-style
  capitalization, a verb first where they act: **Use Selected Items**, **Make
  4 Variations**, **Vary Selected in Place**, **Put Back the Original**,
  **New Set**, **Stay in the Original's Notes**, **Chord Quality**, **Towards
  the End**, **What May Change**. Articles, short conjunctions and short
  prepositions stay lower case ("Bring the Original into This Scale").
- **An ellipsis (…)** only on something that asks for more before it acts.
  Nothing in this window does.
- **Tooltips, row labels, the status line and the list of changes** in
  sentence case; complete sentences end with a full stop, fragments do not
  ("Bar 2, beat 1: G7 became G9").
- **Messages** say what happened and what to do, without blame or "please":
  "The item is no longer in the project. Select it and click Use Selected
  Items.", "REAPER couldn't make the items. Try again."
- **One word per idea, shared with Midi Suggester**: *Use Selected Items*,
  *Audition* and *Stop*, *Source*, *Scale*, *click* (not "press").
- **Typography**: an em dash between phrases, an en dash in ranges ("Bars
  1–2"), an arrow in the pivot's list ("E → Eb"), curly quotes and
  apostrophes in sentences. Chord symbols and note names stay as they are.
- **Undo history** names are titles too: "Midi Variator: Make Variations".

## What did not change

- ScaleView's scale names, chord symbols (`mv_theory.lua` is Midi Suggester's
  file, copied unchanged), drum names in the change sentences.
- Saved preferences are keyed by `key` and index, so the switch, focus and
  form labels changed without moving anything a user has saved.
- A variation item's name, "Riff - variation 3", is read back by `Place`
  (`baseName`), so its hyphen stays.

## Consequences

- `mv_vary.lua` (switch, focus and form names, change sentences) and
  `mv_place.lua` (undo names, the audition track's name) are vendored into
  Noterator and Miderator, which copy them across.
- New text follows the same rules.
