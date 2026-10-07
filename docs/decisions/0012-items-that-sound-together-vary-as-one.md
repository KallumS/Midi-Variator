# 0012. Items that sound together are varied as one piece

Taken 2026-10-07. Stands.

## Context

Up to 1.2 each selected item was varied on its own: a changed melody note
could grind against the chords on another track, which it could not see.
Asked for: "vary a melody and its chords together as one piece".

## Decision

**Selected items that overlap in time and share a metre form a group**
(`V.groups`). A group is put on one timeline (`V.combine`), each note
carrying its part, varied once - so the clash guard, the chord reader and
the key all see everything - and split back (`V.split`).

- Each note stays inside its own item (`tidy` clips by part).
- A note added to a chord joins the part of the nearest note that is not
  the bass, so a bass on its own track gets no chord notes.
- Variations are placed together (`Place.slotsTogether`): each item's i-th
  variation the same distance after it, in a place free on every track.
- *Vary selected in place* varies each group as one
  (`Place.varyGroupsInPlace`). Every item is read before any is rewritten
  (CLAUDE.md: never hold an item across a call that can replace it).
- Each item still keeps only its own original.

**A switch, Vary them together**, on by default, shown only when some
selected items overlap.

## Alternatives

**Vary each item alone, then fix clashes across them.** Fixing after the
fact undoes changes the list already promised. Rejected.

**Merge into one item.** Loses the tracks, and so the instruments.
Rejected.
