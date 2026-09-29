# 0001. A ReaScript, not a JSFX

Taken 2026-09-29. Stands.

## Context

The request was "either a ReaScript or JSFX that creates tiny variations of
imported MIDI clips", where every variation must keep referring back to the
original clip.

## Decision

A Lua ReaScript with a ReaImGui window, laid out like Midi Suggester.

- **A variation needs the whole clip at once.** Deciding which note to bend,
  where a passing note fits, or which moment is the phrase's end means
  looking at the phrase as a whole. A script reads the item with
  `MIDI_GetNote`. A JSFX sees MIDI one event at a time as it plays past, and
  cannot see ahead of the playhead.
- **"Refers to the original" needs somewhere to keep the original.** A
  script stores it on the item (`P_EXT`). A JSFX changing MIDI as it plays
  would vary the same notes on every pass, with nothing to store per copy.
- **The result should be MIDI you can see and edit.** A script writes items.
  A JSFX's changes exist only in playback; nothing lands in the project.
- **Testing the music.** The engine is plain Lua, run and checked outside
  REAPER. EEL2 only runs inside it.

Midi Suggester (0001) and Starting Blocks (which retired its JSFX) reached
the same answer for the same reasons.

## Consequences

Variations are made when asked, not live as the music plays. A "different
every time it plays" live humaniser is a different tool; nothing asked for
needs it.

## Alternatives

**JSFX.** Rejected for the reasons above.
