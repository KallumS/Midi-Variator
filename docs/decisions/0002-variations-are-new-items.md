# 0002. Variations are new items, never copies of the original

Taken 2026-09-29. Stands.

## Context

The obvious way to make a variation is to duplicate the original item and
change its notes. But a duplicate may share the original's MIDI: a pooled
("ghost") copy edits every copy at once, and an item that plays a `.mid` file
from disk shares that file with every other item that plays it. Changing the
copy would change the original - the one thing this tool must never do.

## Decision

Every variation is a new, empty MIDI item made with `CreateNewMIDIItemInProj`
and filled by the script: the variation's notes, the original's CCs (pedal,
pitch bend) in the same places, and the original's colour and volume.

## Consequences

A variation is always independent, whatever the original is. It does not
carry the original item's take FX, item FX or extra takes - those are rare on
imported MIDI, and the track's instrument (where the sound comes from) is
untouched because the variation is on the same track. CC curve shapes and
text/sysex events are not copied (imported `.mid` files have no curve
shapes).

## Alternatives

**Duplicate by state chunk, then un-pool** (give `POOLEDEVTS` a new GUID).
Keeps everything, but depends on chunk details REAPER does not document, and
does nothing for a `.mid` file on disk. Rejected.

**Duplicate with REAPER's own action, then "remove from pool".** Depends on
the user's preference for pooling duplicates and on action IDs. Rejected.
