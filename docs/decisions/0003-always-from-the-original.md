# 0003. Every variation is made from the original, which it carries inside it

Taken 2026-09-29. Stands.

## Context

"If the user creates 20 variations in a row, the clip will still resemble
the original that was imported rather than being wildly different." A chain
- each variation made from the one before - drifts: twenty small steps add up
to a different tune.

## Decision

`V.vary` is a pure function of **the original** and a seed. Nothing is ever
varied from a variation.

To make that hold after the window is closed, every variation item carries
its original's notes in `P_EXT:MidiVariator` (with the original's name and
the variation's number). Reading an item that carries one gives the engine
the stored original, not the item's current notes. So:

- varying a variation is a fresh variation of the original;
- *Vary selected in place*, pressed again and again, re-rolls from the
  original each time;
- *Put back the original* can always restore it.

A series may carry one thing from variation to variation: which moments
were already changed (`history`), to steer the next one elsewhere. It never
carries notes.

## Consequences

The twentieth variation is exactly as close to the original as the first.
`test_vary` checks it three ways: a seed gives the same variation whatever
was made before it; the last ten of twenty are as close as the first ten;
and every variation of every fixture keeps most of the original's notes
exactly.

If the user edits the original item after making variations, the variations
still carry the old original. That is deliberate - they are variations of
what they were made from - and *Use selected items* on the edited original
starts a new family.

## Alternatives

**A chain, with a pull back towards the original.** Still drifts, just
slower, and "how far from the original is this one?" has no simple answer.
Rejected.
