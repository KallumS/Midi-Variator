# 0004. Notes move within the seven notes the music uses, not the detected key

Taken 2026-09-29. Stands.

## Context

A note moved "one step up the key" needs a key. Midi Suggester's
`detectKey` (copied unchanged into `mv_theory`) is tuned on melodies that end
on their home note. The piano fixture - A minor, ending on an E major chord
(a half cadence) - reads as E minor, whose F# appears nowhere in the music.
Stepping in E minor put F#s and, through the E chord's G#, a G# against an F
chord.

## Decision

The scale is the seven-note set that covers the most of the music's time.
`detectKey`'s ranking only breaks ties, where two sets cover the music
equally (D minor's D E F G A fits F major's notes and C major's; the key
finder says D minor, so Bb not B).

- `an.scale` - those seven notes - is used for chord colours, which must be
  diatonic.
- `an.pcs` - those plus every note the original actually plays - is used for
  melody steps, so a minor tune's raised seventh or a blue note stays
  available where the original uses it.

## Consequences

The piano piece now reads as A minor. The variator never needs the key's
name to be right, only its notes; the name shown in the window is for
reassurance. `mv_theory` stays an unchanged copy.

## Alternatives

**Retune `detectKey`.** It is a copy of Midi Suggester's, whose weights were
chosen over fifteen tunes there; a change belongs in Midi Suggester first.
And the question here is different ("which notes?", not "which key?").
Rejected.

**Only the notes the original plays.** Too few for a short motif: a
five-note phrase would have nowhere new to step. Rejected.
