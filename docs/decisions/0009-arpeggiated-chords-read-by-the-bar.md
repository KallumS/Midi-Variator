# 0009. Arpeggiated chords are read a bar (or half bar) at a time

Taken 2026-10-07. Stands. Extends 0007.

## Context

0007's chord-quality move needs notes struck together; an arpeggio or an
Alberti bass is a chord played one note at a time, and was never changed.
Asked for: "changing arpeggiated chords too".

## Decision

**A window is an arpeggio when**: it is a bar (or each half bar, when the
halves are two different chords); every moment in it is one note; at least
four notes on at least three pitch classes; a pitch class comes round
again (an accompaniment goes round its chord - D F A G is a tune); at
least half as many leaps as steps between successive notes (B G F G is a
G7 arpeggio; a scale is not); at most one pair of its pitch classes a step
apart (E G A B is a tune round Em); and ScaleView Pro's reader finds a
chord. Found in `analyse` (`an.broken`).

**Changed by 0007's rules**, applied to every note of the window: a moved
tone moves wherever it is played; an added tone takes a doubled note (the
highest one that is not the bass) or, with nothing doubled, every other
strike of the note struck most (C G E G becomes C G E B); a dropped tone
becomes the nearest chord note left. The lowest note is the bass and never
changes; protected notes never change; nothing may grind against notes
outside the arpeggio. The same arpeggio in the bars next to it changes
with it.

**Offered only where there are arpeggios**, so for all other music the
dice fall exactly as in 1.2.

The Chord quality switch now shows for arpeggios; Chord voicing (revoice,
roll) still needs chords struck together.

## Alternatives

**Read chords from what is sounding** (overlaps). An Alberti bass's notes
do not overlap, and a melody over held notes would be read as chords.
Rejected.
