# 0013. Audition plays the variation in the original's place, on its own track

Taken 2026-10-07. Stands.

## Context

Asked for: audition a variation before making it. Midi Suggester (its
0004) plays a suggestion on a temporary track with a copy of the source
track's FX, alongside the source. A variation is not heard alongside the
original but **instead of** it.

## Decision

**A temporary item on the original's own track**, at the original's
position, with the original item muted (B_MUTE) while it plays. Same
instrument, sends, volume and routing - a copy of the FX would miss sends
and MIDI routed to another track. The project plays from the first item's
bar to the end of the last; < and > swap the next variation into the
playing items.

**Fixed item lanes** (REAPER 7, I_FREEMODE 2) play only one lane, so there
the variation goes on a temporary track under it with a copy of its FX -
Midi Suggester's way.

Stopping (Stop, REAPER's stop, the end, Make, Vary in place, Put back, Use
selected items, closing) deletes the temporary items and tracks, unmutes
what it muted (not an item the user had muted) and puts the edit cursor
back. Outside any undo block. Everything is marked
`P_EXT:MidiVariatorAudition` ("item", "muted", "track") and swept at
start.

## Consequences

The original's mute is briefly changed in the project; a crash leaves it
muted until the script next starts. It moves the transport and edit cursor
(puts the cursor back), as Midi Suggester's does.

## Alternatives

**Midi Suggester's temporary track everywhere.** Silent where the
instrument is reached by a send or MIDI routing. Kept for fixed lanes only.

**The virtual keyboard** (StuffMIDIMessage). Needs an armed, monitored
track and plays the variation alone. Rejected, as in Midi Suggester.
