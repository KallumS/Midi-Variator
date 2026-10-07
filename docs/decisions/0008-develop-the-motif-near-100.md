# 0008. Near 100%, a stretch of the music may be developed

Taken 2026-10-07. Stands. Changes what 100% means; 0003 (always from the
original) and the small moves below 70% are untouched.

## Context

Asked for: "having the variation slider closer to and at 100% should
introduce larger changes - inverting the notes, transposing the notes,
reversing the order of the notes, expanding the intervals or changing
them". Up to 1.2 every change was one small move on one moment, so 100%
was only "more small changes".

## Decision

**Above `DEVELOP_FROM` (70%) a variation may first develop one stretch** -
whole bars (half bars in music of a bar or less) - by one of six moves, the
ways a motif comes back changed (Hutchinson ch. 11; Good Idea's sequence
and fragment):

- **invert**: the tune mirrored in the scale around its first note (or its
  middle, if that would leave the range);
- **retrograde**: the pitches in reverse order, in the same rhythm;
- **transpose**: everything moved up or down the scale - a sequence. The
  shift is chosen from Good Idea's (a step, a third, a fifth up, ...) and
  an octave either side, whichever stays in range and moves least
  (Good Idea's `bestShift`);
- **stretch** / **squeeze**: the intervals from the first note doubled, or
  halved keeping their direction;
- **fragment**: the first half again a step lower, in place of the second
  (melodies only).

The chance rises from 15% just above 70% to 90% at 100%; the stretch grows
from a bar or two to most of the phrase.

**By scale positions** (a third up is two positions in any seven-note
scale), so a developed tune stays in key; a raised seventh carries its
offset where the scale allows.

**The rhythm stays** (but for fragment, which repeats the first half's), so
the motif is still recognisable by its rhythm.

**With chords, only the tune** is inverted, reversed or stretched - the
highest note struck, if nothing held over sounds above it (a walking bass
under a held chord is not a tune). Each tune note goes to its target, or
the nearest scale note up to two positions away that grinds against
nothing and stays above everything else sounding; failing that it keeps
its pitch, and more than a third kept fails the move. A sequence moves
everything and may add no grinding pair - a scale step is not always the
same size (D under E moved up a step is E under F).

**One change**, covering every moment of the stretch; nothing else changes
inside it. The ends stay when kept. Below 70% develop draws no dice, so
everything gentler is exactly what 1.2 made.

**A switch, Develop the motif**, on by default, shown only above 70% and
never for drums.

## Consequences

At 100% "keeps N% of the original's notes" can be low - a sequenced phrase
keeps its rhythm but none of its pitches. That is what was asked for.

## Alternatives

**A separate "Develop" slider.** One more control for one idea; the user
asked for the amount slider to do it. Rejected.

**Develop the whole piece every time at 100%.** Loses the A/A' contrast
inside a phrase. Rejected: the stretch grows with the amount instead.

**Invert chords too** (mirror every note). A mirrored chord is a different
chord on a different bass, not the same music turned over. Rejected.
