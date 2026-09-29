# 0007. Chord quality changes by rules over ScaleView Pro's reading, one small step each

Taken 2026-09-29. Stands.

## Context

Asked for: "if it detects a chord, could the variation have a chance to
change the chord from its current quality into another? For example, if a
7th chord is detected the variation could change it into an 11th, or
diminished." And, while it was being built: "ScaleView Pro is the
definitive chord detector, ScaleView was a simplified version."

Changing a quality needs the chord's root - C E G Bb changes differently
from the same notes read as something else - and the change is best
described in chord names.

## Decision

**The chord is read by ScaleView Pro's chord reader.** `mv_theory` became
the whole of Midi Suggester's `ms_theory` (it was only the key half), still
copied unchanged. Its chord reader is ScaleView Pro's, and was checked line
for line against `ScaleView Pro.lua` at `e31a6e8`. So a chord is read and
named exactly as in ScaleView Pro and Midi Suggester, and the list of
changes says "G7 became G9" in the same words.

**A change is one rule from a table of neighbouring qualities** - one note
added, moved a semitone or tone, or dropped (the eleventh moves one and
adds one). Each rule says which intervals above the root must and must not
be there. That keeps every change one audible step, the way a player would
recolour a chord, and it makes the table the place to add a quality.

**The chord keeps its footing and outline**: the bass is never moved or
dropped, the top never dropped, and an added note goes as high inside the
chord as it fits.

**In the scale by default.** "Chord changes may leave the scale" lets a
change borrow outside notes - C to Cmin or Caug, G7 to G7b9. That box
exists because the example asked for (7th to diminished) is usually
outside the key: G7 to G7b9 in C major needs Ab.

**7th to diminished is G7 to G7b9**, not G7 to G#dim7. Adding the b9 puts a
diminished seventh chord on top of the root (B D F Ab over G) without moving
the bass, where G#dim7 would move it.

**A chord struck several times in a row changes every time** it is struck.
Changing one strike of four sounds like a wrong note, not a new chord.

**Chord colour is allowed, grinding against the tune is not.** Cmaj7's B
against its C is the point; the same B against a C in the melody would be
a clash. New chord notes are checked against everything sounding outside
the chord.

**"Chords" became two switches**: *Chord voicing* (revoice, roll) and
*Chord quality* (the new move, and the old sus/add9 "colour" move, which
was a quality change all along). Chord voicing keeps the old setting key,
so saved preferences still load.

## Consequences

ScaleView Pro's names are its own: a seventh plus a thirteenth reads
"G7(13)", and G A D F G reads "DminAdd11/G". They are not retuned here.

A changed chord can put the tune's note in a new light - a melody C over a
C chord that becomes Cmaj7 - which is the intent; it never places a new
note a semitone from the tune.

Arpeggiated chords (notes struck one after another) are not read as chords
by the variator's moment-by-moment grouping, so they are not changed.

## Alternatives

**Rebuild the chord from a target quality** (read Cmaj7, write a fresh C9
voicing). Loses the original voicing; a change would no longer be small.
Rejected.

**ScaleView (not Pro)'s simpler detector.** The user named Pro as the
definitive one. Rejected.

**G7 to G#dim7 for "diminished".** Moves the bass a semitone. Rejected in
favour of G7b9, which sounds the same diminished chord over the root.
