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
| `reascripts/mv_theory.lua` | Keys, key finding and **ScaleView Pro's chord reader**: the whole of Midi Suggester's `ms_theory.lua` at `f026d15`, **copied unchanged**. |
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
  `fill`, `ghost` (Add); `drop`, `thin` (Leave out); `revoice`, `roll`
  (Chord voicing, key `chords` - kept so saved preferences still load);
  `quality`, `colour` (Chord quality). Each returns a sentence for the window or nil if it
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

### Picking a scale, pivoting, own notes ([0006](docs/decisions/0006-pick-a-scale-and-pivot.md))

`V.prepare(src, T, pick)` is what the window calls; it returns the source to
vary and its analysis. `pick` is nil (heard, as above), `{ own = true }`
(`scale` and `pcs` are only the pitch classes the original plays), or
`{ root, scale, fit }` - `root` indexes `T.ROOTS`, `scale` indexes
`V.SCALES`, which is **ScaleView's SCALES table copied unchanged** from
`ScaleView Pro.lua` at `e31a6e8` (with its letters, so C minor spells Eb).

- **`fit` is the pivot**: `V.fit` moves each out-of-scale note to the
  nearest scale note; a tie goes to the **same letter** (C minor into C
  major: Eb -> E, not D), and two notes landing on one pitch become one.
  Drums are never fitted. The returned source is a shallow copy with the
  fitted notes - **its `original` is still the true one**, so what is kept
  in a variation and what *Put back* restores never pivots.
- Picked, `an.scale` is the picked scale and `an.pcs` adds the notes the
  (fitted) original plays; `an.key` spells names in the picked scale;
  `an.heardKey` is always what was heard.
- **`M.MAX_STEP` (4)**: `step` never goes further than a major third, or a
  pentatonic or a three-note motif's own notes would "step" a fifth.
- Likeness in the window is measured against the true original, so a pivot
  shows as the change it is.

### Chord quality ([0007](docs/decisions/0007-chord-quality-by-scaleview-pro.md))

**ScaleView Pro is the definitive chord detector** (the user's words;
ScaleView is a simplified version). `mv_theory` is now the whole of
`ms_theory`, whose chord reader is ScaleView Pro's, checked line for line
against `ScaleView Pro.lua` at `e31a6e8`. `T.nameChord(pitches, key)`
returns the symbol, the root's pitch class and the bass's.

- `M.QUALITY_RULES`: each rule has `needs`/`lacks` (intervals above the
  root) and one `add`, `move` (a semitone or tone) or `drop` - the eleventh
  moves and adds. `rub` marks the b9, the one rule allowed a semitone
  inside the chord.
- `plan` never moves or drops the bass, never drops the top, places an
  added note **as high inside the chord as it fits** (low added notes
  muddied the bass: "G7 became DminAdd11/G"), else re-purposes a doubled
  inner note, else - for a block chord only, where the top is not a tune -
  goes just above the top.
- In the scale unless `opts.outside` ("Chord changes may leave the scale").
- A new note may not grind against anything **outside** the chord
  (`outsideClash`); inside, the colour is the point. `test_vary`'s clash
  check therefore ignores notes struck together when a quality changed.
- **A repeated chord changes as one** (`chordRun`): every strike in a row
  with the same notes, so a strummed bar does not get one odd strike.
- The change reads "G7 became G9" in ScaleView Pro's names - which are its
  own ("G7(13)", "DminAdd11/G" for G A D F G). **Never retune them here.**
- `an.chordKey` names chords: the picked scale's key when it is one of
  mv_theory's seven-note scales (so C minor names Eb), else the heard key.

## REAPER, from a script (`mv_place.lua`)

- Every signature was checked in the API docs (attached to the first
  session). `MIDI_InsertCC` has no noSort argument; `MIDI_InsertNote`'s
  last argument is noSort - true for each, one `MIDI_Sort`.
- `tests/reaper_mock.lua` is written **from the documented signatures**,
  and raises on any function it does not have. Add a function to it from
  the docs when the scripts start using one. Like REAPER, it **refuses a
  deleted item or take** in any call but `ValidatePtr2`.
- **Never hold an item across a call that can replace it.** Varying in
  place and putting back can delete items (pooled, file, looped); anything
  listed before must be listed again after. 1.1 held the selection across
  *Vary selected in place* and REAPER raised "MediaItem expected".
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

Four steps - **Source, Scale, What may change, Variations** - numbered by
`heading` itself, so drums (which get no Scale step) number 1, 2, 3 with no
gap. Only step 1 until something is read. **No dead controls**: no Scale
step for drums, no picker while *Stay in the original's notes* is on, no
*Chord changes may leave the scale* unless Chord quality is on and there
are chords, no
*Back to what it heard* until something is picked, no *Bring the original
into this scale* when every note is already in it, no Chords switch
without chords (Chord voicing and Chord quality both), no Notes switch for
drums, no arrows for one variation,
*Vary selected in place* only with MIDI items selected, *Put back the
original* only when a selected item is a variation.

**The preview is what gets made.** `ui.runs` is the batch; *Make* writes
exactly those notes. `test_ui` fixes the clock, works out the seed, makes
the same series itself and compares note for note. A new seed is drawn
after every Make and every Vary in place.

The **picked scale belongs to the item**, like Midi Suggester's key: it is
not saved, and reading a new source forgets it. Picking the heard key again
clears the pick. With several sources, the key shown is the first one that
has a key (drums have none), named. *Vary selected in place* uses the
picked scale too.

Preferences (including *Stay in the original's notes* and *Bring the
original into this scale*) are saved in one ExtState string and clamped on
load; the test loads nonsense to prove it.

## Where it stands

| | |
| --- | --- |
| 1.0 | First version. On `claude/dreamy-maxwell-9q4hfh`, in the index, **not yet merged** and **not yet run in REAPER** - the window has only been driven by the mocked ReaImGui. |
| 1.1 | The Scale step: a root and scale picker (ScaleView's scales), the pivot, *Stay in the original's notes*, and the step limit. Same branch, same caveats. |
| 1.1.1 | Fix: *Vary selected in place* on pooled, file or looped items raised "MediaItem expected". **Found by the user running it in REAPER** - the first real run; everything else "seems to be working well". |
| 1.2 | Chord quality: chords changed to a neighbouring quality, read by ScaleView Pro's reader, in the scale unless allowed out. "Chords" split into *Chord voicing* and *Chord quality*. Not yet run in REAPER. |

**Known limits, all deliberate for now:**

- One scale for the whole item: a piece that modulates is read in one, and
  a picked scale applies to every selected item alike.
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
| `test_vary.lua` | Every fixture at four amounts and forty seeds: small, in key, no new clashes, ends kept, playable. Each switch alone. Twenty in a row. The series memory. Encode/decode. Spelling picked scales; the pivot both ways; every fixture into six scales, fitted and not; own notes; the step limit. ScaleView Pro's names; what G7 may become in and out of the scale; bass kept, no grinding against the tune, repeated chords changed as one; nothing for melodies and drums. |
| `test_place.lua` | Reading (trim, loop, 6/8, mid-bar), making, numbering, placement, varying in place, pooled / file / looped items, putting back, refusals. |
| `test_ui.lua` | The real script against a mocked ReaImGui: preview equals what is made; the Scale step (pivot made and put back, vary in place, own notes, drums); every button clicked from a fresh start in every state, including with a scale picked. |

**Prove a test bites before believing it.** Every rule was broken on
purpose and the suite watched to fail. That found four gaps, each now
closed: the change cap was never reached (a two-note test now reaches it);
the series memory was only half-tested; nothing wrote an item that starts
mid-bar; and a refused batch was never tested with anything already made.
The scale work found two more: the same-letter tie-break was only ever
tested in the direction where "round down" gives the same answer (C major
into C minor), and nothing varied in place with a scale picked. Chord
quality: all five of its rules (bass stays, scale, clash, repeated chords,
top kept) were broken on purpose and each failed the suite.
