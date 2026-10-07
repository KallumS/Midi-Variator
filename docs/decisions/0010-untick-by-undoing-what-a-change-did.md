# 0010. Unticking a change undoes what it did; it never re-rolls

Taken 2026-10-07. Stands.

## Context

Asked for: "ticking off individual changes you don't like". The list of
changes needed a box each, and unticking one must leave the rest.

## Decision

**Every move still runs, on the same dice; each records what it did**
(every changed field of every note, and the notes it added), and at the
end **the unticked ones are undone**, latest first. A field a later change
touched again keeps the later change. Added notes are marked gone, not
removed, so the feel - which draws dice note by note - falls on every other
note exactly as before.

A change's id is the order it was made in. The window keeps the unticked
ids per variation (`ui.skips[j][i]`) and passes them through `series`; an
echo (0011) reads the boxes of what it echoes. Any new batch - a setting,
New set, Make - starts with every box ticked.

## Consequences

Untick every change and the variation is the original, note for note (with
the feel off) - the test holds exactly that.

## Alternatives

**Re-roll without the change** (run the moves again, skipping it). Every
change after it would land differently: unticking one would change the
others. Rejected.
