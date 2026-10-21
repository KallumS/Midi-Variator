# Session log - 2026-10-14: the window's words

Asked, across all the user's repositories: "ensure the GUI text matches
Apple's suggested conventions (developer.apple.com/design/human-interface-guidelines/writing),
like you've done for Noterator and Miderator." Done with Midi Suggester in the
same session, so the two windows use the same words for the same things.
Recorded as [decision 0014](../decisions/0014-window-text-follows-apples-writing-guidelines.md).

## What changed (1.3.1)

| Before | After |
| --- | --- |
| Use selected items | Use Selected Items |
| Make 4 variations | Make 4 Variations |
| Vary selected in place / Put back the original | Vary Selected in Place / Put Back the Original |
| New set | New Set |
| Stay in the original's notes / Back to what it heard | Stay in the Original's Notes / Back to What It Heard |
| Add notes, Leave notes out, Chord voicing, Chord quality | Add Notes, Leave Notes Out, Chord Voicing, Chord Quality |
| Towards the end; All new, Home between, In pairs, A refrain | Towards the End; All New, Home Between, In Pairs, A Refrain |
| What may change (heading) | What May Change |
| The item has gone - select it and press Use selected items. | The item is no longer in the project. Select it and click Use Selected Items. |
| E -> Eb, Bars 1-2, "the tune moved up a third - a sequence" | E → Eb, Bars 1–2, "… up a third — a sequence" |

Also: the boxes (Bring the Original into This Scale, Chord Changes May Leave
the Scale, Keep the First and Last Notes, Grow Across the Series) in title
style; the line beside "Variation 2 of 4" starts with a capital; the undo
names are titles ("Midi Variator: Make Variations"); the temporary audition
track is "Midi Variator Audition" (found by its marker, not its name); the
ReaImGui-missing message is titled "ReaImGui Needed". The README follows,
and says "click" for a button.

`mv_vary.lua` and `mv_place.lua` are vendored into Noterator and Miderator:
copy them across.

## What was left alone

- `mv_theory.lua` - Midi Suggester's file, ScaleView Pro's reader inside,
  copied unchanged.
- ScaleView's scale names, chord symbols, note and drum names.
- " - variation N" in the names of the items it makes: `Place` reads it back
  to find the original's name.
- The README's prose says "clip" where the window says "item"; the labels it
  quotes now match the window, the prose was left as it is.

## Checks

`tools/test.sh`: every suite passes. The UI test now clicks by the new
labels; one check ("no Notes switch for drums") had matched "Notes" anywhere
in a label and would have seen "Add Notes", so it looks for the exact button.
