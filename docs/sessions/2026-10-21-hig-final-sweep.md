# Session log - 21 October 2026: the final HIG Foundations sweep (1.5)

Asked across the family: a final sweep of the 19 Foundations pages. Done
after Midi Suggester 1.3, with what it found. The verdict for every
guideline is in [`apple-hig-review.md`](../apple-hig-review.md#final-sweep-16-october-2026);
the decision is a dated section of [0015](../decisions/0015-apples-hig-foundations.md).

## What changed

- Theme: popups `#2A2F37` with a `#3A404A` edge, menu bar `#1B1F25`, menu
  highlight from the ramp, TextDisabled `#BFC5CE` (ImGui's colour for a menu
  item's keys), scrollbar thumb and resize corner `#6D7581`.
- Every box and both sliders drawn with a `#8A919C` edge (`checkbox()`,
  `slider()`).
- `flowPlace()`/`flowWords()`: every row wraps; secondary text wraps; a
  minimum size; a change's full line in its tooltip.
- Esc lets go first; `letGo()` asks before *New Set*, *Use Selected Items*
  or closing throw unticked boxes away.
- Bold headings, the item in the title, a legend under the roll, the arrows
  named, the playhead grown with the text, grid lines on whole pixels.

## Found on the way

- At 200% the Variation row (arrows, likeness, New Set, Audition), the Make
  row and the amount's words ran off the edge.
- The mock's `GetContentRegionAvail` always said the full width; after a
  `SameLine` ImGui gives what is left, and the root and scale rows measured
  from a label were judged against the wrong width until the mock did too.
- `tests/hig_mock.lua` is unchanged: the new checks are in `test_ui.lua`.

## Checks

`tools/test.sh` passes. Fifteen sabotages with `tools/bite.sh`, all BIT:
popup darker, menu keys grey, ImGui's header colours, the old thumb, a
slider with no edge, rows not wrapping, text not wrapping, plain headings, a
plain title, no legend, unnamed arrows, no size limit, Esc always closing,
never asking, New Set never asking.

## Not done

Not run in REAPER: Esc with a menu open, the bold face, the dialog, and
whether the minimum size holds (it does not apply when docked).
