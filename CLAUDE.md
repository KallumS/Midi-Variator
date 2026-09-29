# Midi Variator

A ReaScript that makes small variations of a MIDI item - the Nordic Noir
idea of a motif that keeps returning, a little different each time.
ReaImGui for the window. The user is a musician, not a programmer - explain
in those terms.

Built in the same shape as its sister repos, Midi Suggester (closest),
Starting Blocks and ScaleView for REAPER. When in doubt, do what Midi
Suggester does.

## Shape of it

| | |
| --- | --- |
| `reascripts/Midi Variator.lua` | The window and the wiring. ReaImGui lives only here. |
| `reascripts/mv_theory.lua` | Keys and key finding, **copied unchanged** from Midi Suggester's `ms_theory.lua` at `f026d15`. |
| `reascripts/mv_vary.lua` | The engine: reading the original, the moves, feel, keeping the original inside an item. |
| `reascripts/mv_place.lua` | Everything that touches REAPER. |
| `tools/demo.lua` | What the engine does to the test tunes, printed. |
| `docs/decisions/` | Why things are the way they are, one file per decision. |
| `docs/sessions/` | What happened in a session, written at the end of it. |

**`mv_theory` and `mv_vary` never touch `reaper.` or `ImGui.`** They take
plain tables and return plain tables. `mv_place` touches REAPER but not
ImGui, so a mocked `reaper` is enough for it. If a music question needs
`reaper.`, pass the value in.

Notes everywhere are `{ pitch, start, len, vel, chan }` with `start` and
`len` in **quarter notes, counted from the bar line at or before the item**
(Midi Suggester's convention). A source also has `lead` (where the item
starts within that bar), `beats` (where it ends), `barBeats` and `pulse`.
The original kept inside an item is stored **from the item's own start**,
so it holds wherever the item is moved.

## The one rule

**A variation is always made from the original** - never from the
variation before it ([0003](docs/decisions/0003-always-from-the-original.md)).
`V.vary(src, an, opts, seed, T, history)` is a pure function of the
original and a seed. Every variation item carries its original in
`P_EXT:MidiVariator` (`V.encode`/`V.decode`), and `Place.readItem` hands
the engine **that** stored original, not what the item now plays. So
varying a variation, or re-rolling one in place, is a fresh variation of
the original. `test_vary` proves nothing accumulates (thirty variations in
between do not change what a seed gives); `test_place` proves a variation
reads back as its original.

The only thing a series carries from one variation to the next is
`history` - which moments were changed - and it only steers the dice
towards moments not yet changed. The test proves it spreads the changes,
and that the first of a series equals the preview.

## How small is small (`mv_vary.lua`)

Every musical judgement is a named constant at the top of the file.

- **Budget:** `amount * (1 + notes / 8)` changes on average, capped at 30%
  of the notes, and **one change per moment** at most (`v.touched`).
- **Moves** (in `M.KINDS`, each with a weight): `neighbour` and `octave`
  (Notes); `split`, `shift`, `join` (Rhythm); `passing`, `grace`, `pickup`,
  `fill`, `ghost` (Add); `drop`, `thin` (Leave out); `revoice`, `roll`,
  `colour` (Chords). Each returns a sentence for the window or nil if it
  found nowhere to act; the loop tries up to 40 times.
- **Rhythm moves by `unit`**: the music's grid, but never more than an
  eighth, so a tune in quarters is varied in eighths.
- **Protected moments** (Keep the first and last notes): the first and last
  moments are never changed, rolled, or cut short by a neighbour's move.
- **Clash guard** (`clashes`): no new semitone / major 7th / minor 9th
  against anything sounding, and no unison doubling. Chord fills check it
  too - a Cmaj7's B doubled low against its C bass was mud until they did.
- **Feel**, scaled by the square root of the amount: timing moves a whole
  moment together (a chord stays a chord), at most `TIMING_MAX` (about
  15ms); velocity keeps the original's accents; **lengths may grow only up
  to the next moment**, or a held chord rings into the next and grinds.
- **`tidy`** keeps notes inside the item, at least `MIN_LEN` long, and
  trims same-pitch overlaps the variation created - but leaves the
  original's own overlaps as written.
- **Drums** (channel 10, `chan == 9`): no move changes a drum's pitch.
  `drop` takes the quietest drum of a moment; `ghost` adds a quiet hit.

### The scale is not the key ([0004](docs/decisions/0004-the-scale-is-the-seven-notes-used.md))

`an.scale` is the seven-note set covering the most of the music's time;
Midi Suggester's `detectKey` only breaks ties (D minor's notes fit F major's
set and C major's). `an.pcs` adds every pitch class the original plays.
Melody steps use `pcs`; chord colours use `scale`. The piano fixture (A
minor ending on E major) is why: `detectKey` calls it E minor, whose F# is
nowhere in it. **Do not "fix" this by retuning `mv_theory`** - it is a copy.

## REAPER, from a script (`mv_place.lua`)

- Every signature was checked in the API docs (attached to the first
  session). `MIDI_InsertCC` has no noSort argument; `MIDI_InsertNote`'s
  last argument is noSort - true for each, one `MIDI_Sort`.
- `tests/reaper_mock.lua` is written **from the documented signatures**,
  and raises on any function it does not have. Add a function to it from
  the docs when the scripts start using one.
- **Variations are new items** (`CreateNewMIDIItemInProj`), never copies of
  the original ([0002](docs/decisions/0002-variations-are-new-items.md)): a
  copy can share the original's MIDI (pooled, or a `.mid` on disk).
- **In place** ([0005](docs/decisions/0005-rewrite-in-place-only-when-safe.md)):
  an item is rewritten where it is only when `canRewrite` - not pooled
  (`POOLEDEVTS` in its chunk), not a `.mid` file, not looping past its
  source. Otherwise it is replaced by a new item in the same place. Muted
  notes are never deleted.
- **Placement**: after the original on its own track, stepping by the
  original's length rounded up to whole bars, skipping any place already
  taken. Nothing is ever covered.
- Reading unrolls a looped item and cuts notes to the item's edges; the
  CCs (pedal, bends) are copied into each variation.
- Every write is one undo block; a refusal deletes what the batch made and
  still closes its block.

## The window

The house scheme, shared with Starting Blocks, ScaleView and Midi Suggester
- see Starting Blocks' `docs/COLOUR.md`. The UI test holds its rules:
every button wears the dark ink `#14171C`; the theme is popped outside the
`visible` test; a switch that is on is the accent `#FFF200`. The roll draws
**the original grey `#6D7581` and the variation yellow**.

Three numbered steps - **1 Source, 2 What may change, 3 Variations** - and
only step 1 until something is read. **No dead controls**: no Chords switch
without chords, no Notes switch for drums, no arrows for one variation,
*Vary selected in place* only with MIDI items selected, *Put back the
original* only when a selected item is a variation.

**The preview is what gets made.** `ui.runs` is the batch; *Make* writes
exactly those notes. `test_ui` fixes the clock, works out the seed, makes
the same series itself and compares note for note. A new seed is drawn
after every Make and every Vary in place.

Preferences are saved in one ExtState string and clamped on load; the test
loads nonsense to prove it.

## Where it stands

| | |
| --- | --- |
| 1.0 | First version. On `claude/dreamy-maxwell-9q4hfh`, **not yet merged** and **not yet run in REAPER** - the window has only been driven by the mocked ReaImGui. |

**Known limits, all deliberate for now:**

- One scale for the whole item: a piece that modulates is read in one.
- One time signature: `readItem` takes the meter at the item's start.
- CC shapes (bezier curves) are not copied - imported MIDI has none; drawn
  curves come across as steps. Text and sysex events are not copied.
- A variation only ever changes notes; the CCs are the original's.
- Each selected item is varied on its own: a melody and its chords on two
  tracks do not know about each other's changes (a changed melody note is
  checked for clashes against its own item only).
- No audition - the variations are in the project to be played.

**Ideas raised but not started** - the user decides which, if any: audition
a variation before making it (Midi Suggester's temporary-track method);
vary a melody and its chords as one piece; a "motif memory" that lets a
variation deliberately echo an earlier one (an A A' A A'' form); editing the
list of changes (untick one you don't like).

**Publishing a version to ReaPack**: commit and push the code; then add a
new `<version>` block to `index.xml` with every `<source>` pinned to that
commit's hash, check each raw URL returns 200, and commit that separately.
Never edit an existing `<version>`. Bump `Version:` in the script header to
match.

## Tests

```
tools/test.sh
```

| | |
| --- | --- |
| `test_vary.lua` | Every fixture at four amounts and forty seeds: small, in key, no new clashes, ends kept, playable. Each switch alone. Twenty in a row. The series memory. Encode/decode. |
| `test_place.lua` | Reading (trim, loop, 6/8, mid-bar), making, numbering, placement, varying in place, pooled / file / looped items, putting back, refusals. |
| `test_ui.lua` | The real script against a mocked ReaImGui: preview equals what is made, every button clicked from a fresh start in every state. |

**Prove a test bites before believing it.** Every rule was broken on
purpose and the suite watched to fail. That found four gaps, each now
closed: the change cap was never reached (a two-note test now reaches it);
the series memory was only half-tested; nothing wrote an item that starts
mid-bar; and a refused batch was never tested with anything already made.
