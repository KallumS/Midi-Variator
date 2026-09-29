# 0005. An item is rewritten in place only when nothing else shares its MIDI

Taken 2026-09-29. Stands.

## Context

*Vary selected in place* and *Put back the original* change items where they
sit - often a row of pasted copies of one phrase. Pasted copies are commonly
pooled, and an item may play a `.mid` file on disk or loop a short source.
Rewriting such an item's notes would rewrite every copy, the file, or every
pass of the loop at once.

## Decision

`Place.canRewrite` checks the item's state chunk for `POOLEDEVTS` (pooled)
and a `FILE` line in its MIDI source (on disk), and whether it loops past its
source's end. If none applies, the notes are rewritten in the item itself:
unmuted notes replaced, muted notes and CCs left, its FX and name kept.
Otherwise the item is replaced by a new one in the same place (decision
0002) and the old one deleted.

## Consequences

Varying one copy never changes another. An item that is replaced loses any
item-level extras (take FX, extra takes); an item rewritten in place keeps
them. Both keep the original inside, so either can be put back.

## Alternatives

**Always replace.** Simpler, but throws away take FX and extra takes on
items that did not need it. Rejected.

**Always rewrite in place.** Changes other copies of pooled items. Rejected.
