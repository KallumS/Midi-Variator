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
| `reascripts/mv_theory.lua` | Keys, key finding and **ScaleView Pro's chord reader**: the whole of Midi Suggester's `ms_theory.lua` at `6ed412b`, **copied unchanged**. |
| `reascripts/mv_vary.lua` | The engine: reading the original, the moves, feel, keeping the original inside an item. |
| `reascripts/mv_place.lua` | Everything that touches REAPER. |
| `tools/demo.lua` | What the engine does to the test tunes, printed. |
| `tools/bite.sh` | Breaks the code on purpose in a copy and runs a suite: proves a test bites (Good Idea's, with the lupa fallback). |
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
Items varied together carry `part` on each note and `parts` on the source
(see *Together* below).
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
and that the first of a series equals the preview. An echo (*Forms*) is
made from its original's seed, not from the variation it echoes.

## How small is small (`mv_vary.lua`)

Every musical judgement is a named constant at the top of the file.

- **Budget:** `amount * (1 + notes / 8)` changes on average, capped at 30%
  of the notes, and **one change per moment** at most (`v.touched`).
- **Moves** (in `M.KINDS`, each with a weight): `neighbour` and `octave`
  (Notes); `split`, `shift`, `join` (Rhythm); `passing`, `grace`, `pickup`,
  `fill`, `ghost` (Add); `drop`, `thin` (Leave out); `revoice`, `roll`
  (Chord voicing, key `chords` - kept so saved preferences still load);
  `quality`, `colour`, `arpeggio` (Chord quality). Each returns a sentence
  for the window or nil if it found nowhere to act; the loop tries up to 40
  times. `arpeggio` is offered only when `an.broken` has something, so other
  music draws exactly the dice it did in 1.2.
- **Develop** (`M.DEVELOP`, `DEVELOP_FROM` 0.7) runs first, before the
  small moves - see below.
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

### Develop the motif, near 100% ([0008](docs/decisions/0008-develop-the-motif-near-100.md))

Above `DEVELOP_FROM` (70%) a variation may first develop one stretch of
whole bars (half bars for music of a bar or less): `invert`, `retrograde`,
`transpose` (a sequence), `stretch`, `squeeze`, `fragment`
(`M.DEVELOP_MOVES`). Chance `DEVELOP_CHANCE` 15% to 90%, stretch growing
with the amount. **Below 70% develop draws no dice at all** - a test holds
that every gentler variation is exactly 1.2's.

- **Scale positions** (`ladder`, `posOf`, `fromPos`): a third is two
  positions in any seven-note scale; a raised seventh carries its offset.
  Named in steps in seven-note scales ("up a step", not "a semitone").
- **The tune** is the highest note struck at a moment unless something held
  over sounds above it (`m.under` - the walking bass is not a tune). Invert,
  retrograde, stretch and squeeze move only the tune; `placeTune` puts each
  note at its target or the nearest position (up to two away) that grinds
  against nothing and stays above everything else sounding - else it keeps
  its pitch, and more than a third kept fails the move.
- **Transpose** moves everything in the stretch; it may add no grinding
  pair among the moved notes (`harshPairs`: D under E up a step is E under
  F) nor against anything outside. Shift and octave by Good Idea's
  `bestShift`.
- **Range**: within `DEVELOP_ROOM` (5) semitones of the original's.
- **One change**, `from`/`to` on the change record; every moment inside is
  touched. Protected ends stay.
- `v.byTime` (`noteIndex`, `around`) finds what sounds when: without it a
  2,000-note piece took seconds at 100%.

### Chord quality ([0007](docs/decisions/0007-chord-quality-by-scaleview-pro.md))

**ScaleView Pro is the definitive chord detector** (the user's words;
ScaleView is a simplified version). `mv_theory` is now the whole of
`ms_theory`, whose chord reader is ScaleView Pro's - verbatim from
`ScaleView Pro.lua` at `f9e2691`, and `nameChord` diffed against Pro itself
(not the ScaleView plugin) over 481,696 names in eight keys, byte-identical.
`T.nameChord(pitches, key)` returns the symbol, the root's pitch class and the
bass's.

**Re-copied 7 October 2026** for two changes made in Pro, and both change what
the variator does, not only what it prints, because a quality change is
applied from the root the reader finds:

- **A draw goes to the reading with no slash.** G A D F G read `DminAdd11/G`
  and is `G7sus2`, so it now changes the way a suspension does - to `G7`, or
  `Gmin7` out of the scale - where it used to become `G9`, `G11` or
  `Emin7(11)/G` from a D root. In a probe of eleven renamed chords, four
  that got no change at all - the sus4-add9 shape, read before as
  `Amin7(11)/G` and the like - now get `Gadd9` or `Gadd11`.
- **An altered dominant on its own root keeps its alterations.** C7#5b9 read
  `A#min9b5/C` and is `Caug7b9`. `QUALITY_RULES` has no move for an altered
  fifth, so the only rule that fits is C7 -> C (drop the seventh), and it now
  becomes `DbminMaj7/C`. Before, a Bb rule happened to turn the misread chord
  into `C7b9`. A rule that moves the altered fifth back to a perfect one would
  restore that, and is this table's decision, not the reader's.

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
  own ("G7(13)", "G7sus2" for G A D F G - "DminAdd11/G" before October
  2026). **Never retune them here.**
- `an.chordKey` names chords: the picked scale's key when it is one of
  mv_theory's seven-note scales (so C minor names Eb), else the heard key.
- **Arpeggios** ([0009](docs/decisions/0009-arpeggiated-chords-read-by-the-bar.md)):
  `M.brokenChords` finds bars (or halves, when the halves differ) of single
  notes going round a chord - at least `ARP_NOTES` notes, a pitch class
  coming round again, leaps at least half the steps, at most one pair a
  step apart, a chord ScaleView Pro can name. `MOVES.arpeggio` applies the
  same rules to every note: add takes a doubled pitch or every other strike
  of the commonest (C G E G -> C G E B); the lowest note never changes; the
  same arpeggio in neighbouring bars changes with it.

### Unticking a change ([0010](docs/decisions/0010-untick-by-undoing-what-a-change-did.md))

`opts.skip` is a set of change ids (`id` = the order the change was made).
Every move still runs on the same dice; each `record`s what it did, and the
skipped ones are `undo`ne at the end, latest first. Added notes are marked
gone, not removed, so the feel's dice fall the same. **Never re-roll to
untick** - the other changes would move. `moves` lists all, with `skipped`;
`changes` only the kept.

### Forms: motif memory ([0011](docs/decisions/0011-forms-and-echoes.md))

`opts.form` indexes `M.FORMS` (All new, Home between, In pairs, A refrain);
each maps a place to 0 (home: the original, feel only - `opts.home`) or a
variation number. **An echo** uses its original's place, seed, unticked
changes and a copy of the memory as its original found it, with its own
feel seed (`opts.feelSeed`). Echoes and homes add nothing to the memory.
All new is exactly the old series.

### Together ([0012](docs/decisions/0012-items-that-sound-together-vary-as-one.md))

`V.groups(srcs)`: items overlapping in time with the same metre.
`V.combine` puts a group on one timeline from its earliest bar line, each
note carrying `part`; `parts[k]` keeps each item's `lead`, `beats` and
`shift`. `tidy` clips each note to its own part; `copyNote` carries `part`;
a note added to a chord takes the part of the nearest note that is not the
bass (`nearestPart`). `V.split` gives each item its notes back.

## REAPER, from a script (`mv_place.lua`)

- Every signature was checked in the API docs (attached to the first
  session). `MIDI_InsertCC` has no noSort argument; `MIDI_InsertNote`'s
  last argument is noSort - true for each, one `MIDI_Sort`.
- `tests/reaper_mock.lua` is written **from the documented signatures**,
  and raises on any function it does not have. Add a function to it from
  the docs when the scripts start using one. Like REAPER, it **refuses a
  deleted item, take or track** in any call but `ValidatePtr2`. Tracks, FX
  and the transport (1.3) came from Midi Suggester's mock.
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
- **Together**: `slotsTogether` places each item's i-th variation the same
  distance after it, where every track is free; `make` takes `job.at`.
  `varyGroupsInPlace` reads every item first, then rewrites each group;
  `varyInPlace` is it with groups of one.
- **Audition** ([0013](docs/decisions/0013-audition-in-the-originals-place.md)):
  a temporary item **on the original's own track**, the original muted
  (`B_MUTE`, unless the user had muted it), the project playing from the
  first item's bar; `auditionSwap` rewrites the playing items. A track in
  fixed item lanes (`I_FREEMODE` 2) gets a temporary track with a copy of
  its FX instead. Outside any undo block; everything marked
  `P_EXT:MidiVariatorAudition` (`item`, `muted`, `track`) and `sweep`ed at
  start. Stop it before anything that writes (Make, in place, Put back,
  Use selected items) and at exit.

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
are chords or arpeggios, no
*Back to what it heard* until something is picked, no *Bring the original
into this scale* when every note is already in it, no Chord voicing
without chords struck together, no Chord quality without chords or
arpeggios, no Notes switch for drums, no arrows for one variation, no
*Develop the motif* at 70% or below or for drums, no *Form* for one
variation, no *Vary them together* unless selected items overlap,
*Vary selected in place* only with MIDI items selected, *Put back the
original* only when a selected item is a variation.

The list of changes has a **box per change** (label
`text##change<j>.<id>`); unticking writes `ui.skips[j][place]` - the place
an echo echoes - and sets `ui.dirty` directly, because `touched()` clears
every box. **Audition / Stop** sits by New set; the roll draws a playhead.
With items together, the group's changes are listed once, on its first
item, prefixed with every item's name.

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
| 1.3 | Develop the motif near 100%; arpeggiated chords change quality; untick a change; forms (A A' A A''); vary a melody and its chords together; audition. On `claude/inspiring-hawking-mpmyqg`. **Not yet run in REAPER** - audition especially (muting, the transport, fixed lanes) has only met the mock. |

**Known limits, all deliberate for now:**

- One scale for the whole item: a piece that modulates is read in one, and
  a picked scale applies to every selected item alike.
- One time signature: `readItem` takes the meter at the item's start.
- CC shapes (bezier curves) are not copied - imported MIDI has none; drawn
  curves come across as steps. Text and sysex events are not copied.
- A variation only ever changes notes; the CCs are the original's.
- Items are varied together only when they overlap in time and share a
  metre; a group is read in one scale.
- Develop's stretches are whole bars (or half bars); it never develops a
  stretch that starts mid-bar, and a tune's develop is checked against the
  chords of its own group only.
- Arpeggios are read by the bar or half bar: a broken chord that changes
  on a beat inside a half bar is not read.
- Audition stops at the end of the music; it does not loop.

**Ideas raised but not started** - the user decides which, if any:
augmentation and diminution as develop moves (a stretch at half or double
speed); a loop for audition; varying across a modulation (one scale per
item today).

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
| `test_vary.lua` | Every fixture at four amounts and forty seeds: small, in key, no new clashes, ends kept, playable. Each switch alone. Twenty in a row. The series memory. Encode/decode. Spelling picked scales; the pivot both ways; every fixture into six scales, fitted and not; own notes; the step limit. ScaleView Pro's names; what G7 may become in and out of the scale; bass kept, no grinding against the tune, repeated chords changed as one; nothing for melodies and drums. (1.3) Arpeggios: which music has them, Alberti in root position and inversion, repeated bars together, nothing grinding under a held note. Unticking: one leaves the others, all gives the original, the feel untouched. Forms: home, pairs, refrain, echoes' feel and unticks, the memory. Together: groups, combine/split, no grinding between tune and chords (where apart does), every note in its own item, no chord notes on the bass's track. Develop: nothing below 70%, every fixture at 85% and 100% playable and in key, each move doing what it says on Twinkle, the tune only and on top over chords (piano, strummed, walking, a close tune with add9 chords), how often and how long, the series spreading them. |
| `test_place.lua` | Reading (trim, loop, 6/8, mid-bar), making, numbering, placement, varying in place, pooled / file / looped items, putting back, refusals. (1.3) Placing a group together past an item in the way; varying groups in place; audition (in place, muted, swapped, stopped at the end and by REAPER, the user's muted item kept muted, the cursor back, fixed lanes, the crash sweep, a deleted source). |
| `test_ui.lua` | The real script against a mocked ReaImGui: preview equals what is made; the Scale step (pivot made and put back, vary in place, own notes, drums); every button clicked from a fresh start in every state, including with a scale picked. (1.3) Develop's switch and preview at 100%; arpeggios' switches; unticking (made without it, per variation, cleared by a new batch); forms (home made, echo unticks both, clamped); together (previewed as made, lined up past an item in the way, off); audition (swap, Stop, REAPER's stop, Make, close, crash sweep). |

**Prove a test bites before believing it.** Every rule was broken on
purpose and the suite watched to fail. That found four gaps, each now
closed: the change cap was never reached (a two-note test now reaches it);
the series memory was only half-tested; nothing wrote an item that starts
mid-bar; and a refused batch was never tested with anything already made.
The scale work found two more: the same-letter tie-break was only ever
tested in the direction where "round down" gives the same answer (C major
into C minor), and nothing varied in place with a scale picked. Chord
quality: all five of its rules (bass stays, scale, clash, repeated chords,
top kept) were broken on purpose and each failed the suite. 1.3: every
rule of each new feature was broken with `tools/bite.sh`; the misses each
became a test (see the session log of 2026-10-07).
