# 0006. A picked scale pivots the original by nearest note, same letter on a tie

Taken 2026-09-29. Stands. Builds on 0004, which still decides the scale
when nothing is picked.

## Context

Asked for: a key/scale picker, "because the user might want to pivot to a
different scale with the variations", and a switch to stay in the
original's own notes that bypasses detection.

Picking a scale can mean two things. Either the heard scale was wrong and
is being corrected (the changes should use the right notes, the original
should stay as it is), or the music is being taken somewhere new (the
variations should sound in the new scale - the original's notes too).

## Decision

**The picker offers both, with the pivot on by default.** When some of the
original's notes are outside the picked scale, a box - *Bring the original
into this scale* - appears. On, the original is fitted to the scale before
it is varied; off, only the changes use it.

**Fitting moves each outside note to the nearest scale note. A tie goes to
the note on the same letter.** C major into C minor: E is a semitone from
both Eb and F; Eb keeps the letter, so the third stays a third. C minor into
C major: Eb is a semitone from both D and E; E keeps the letter. The rule
works for any root and any of the sixteen scales, needs no table of
"modal mappings", and gives what a musician would write. Two notes that
land on one pitch at once become one. Drums are never fitted.

**The scales are ScaleView's, copied unchanged** with their letter
spellings, so the picker offers what ScaleView offers and C minor is
spelled with flats. Roots are mv_theory's eighteen spelled roots.

**The original kept inside a variation is never the fitted one.** A pivot
is a way to vary, not a change to the original: *Put back the original*
restores the real one, and a later batch can pivot somewhere else.

**Stay in the original's notes** replaces the scale with the pitch classes
the original plays, and hides the picker while on.

**A step is never more than a major third** (`MAX_STEP`). With a
pentatonic, or a three-note motif's own notes, the next scale note can be
a fourth or fifth away - no longer a neighbour.

**The pick belongs to the music**, as Midi Suggester's key does: not saved,
forgotten when a new source is read. Picking the heard key again clears it.

## Consequences

A pivot can change many notes at once - it is the one control that does
not keep changes small, and the window says exactly what moves ("Moved into
C Minor (Natural): E -> Eb, A -> Ab") and shows it in the roll. The
"keeps N%" figure is measured against the true original, so a pivot reads
as the change it is.

A picked scale applies to every selected item alike.

## Alternatives

**Map by scale degree** (third to third, whatever the distance). Needs both
scales to have seven notes, and moves notes further than the nearest-note
rule when the scales differ by more than a mode. Rejected; the letter
tie-break gives the degree mapping wherever the two agree.

**Always round down on a tie.** Right for major into minor, wrong for minor
into major (Eb would become D). Rejected - and the test for it now runs in
both directions, because the first test only ran the one where rounding
down happens to be right.

**Picking only corrects the heard scale (no pivot).** Does not do what was
asked. Kept as the unticked box.
