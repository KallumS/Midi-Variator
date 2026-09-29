# Midi Variator

A REAPER script that makes **small variations of a MIDI clip** - the way a
Nordic Noir score keeps returning to the same motif, a little different
each time.

Import a melody, a chord part, a piano part or a drum beat, and it makes
copies that each change a few small things: a note bent one step, a beat
pushed early, a passing note slipped in, a chord revoiced, a note left out,
a touch of different feel. You choose how much may change and what.

**Every variation is made from the original.** Make twenty in a row and the
twentieth is exactly as close to the original as the first - they never
drift off, because none of them is made from the one before it. The
original is kept inside every variation, so you can always vary it again or
put it back.

## Installing

**1. Install ReaImGui.** The script will not start without it.

In REAPER: Extensions -> ReaPack -> Browse packages, search for `ReaImGui`,
right-click it and Install. Then Extensions -> ReaPack -> Apply changes, and
restart REAPER.

If you have no ReaPack, get it from [reapack.com](https://reapack.com), put
the file it gives you in `UserPlugins` inside the resource path below, restart,
and then do the above.

**2a. The easy way - ReaPack.** In REAPER,
Extensions -> ReaPack -> Import repositories, and paste exactly this:

```
https://raw.githubusercontent.com/KallumS/Midi-Variator/main/index.xml
```

Then Extensions -> ReaPack -> Browse packages, find Midi Variator, install,
and skip to *Using it*. It has to be that URL, ending in `index.xml` - the
repository's web page will not work. (It works once this version is merged
into `main`.)

**2b. By hand - put all four files in one folder under Scripts.**

Options -> Show REAPER resource path in explorer/finder, then into `Scripts/`.
Make a folder and put these four in it together:

```
Scripts/Midi Variator/
  Midi Variator.lua
  mv_theory.lua
  mv_vary.lua
  mv_place.lua
```

They are all in the [`reascripts`](reascripts) folder of this repository.

**3. Load it.** Actions -> Show action list -> New action -> Load ReaScript,
and pick `Midi Variator.lua`. Put it on a toolbar or a key if you like: its
button lights up while the window is open.

## Using it

1. **Get your MIDI in.** Drag a `.mid` file onto a track (or record
   something). REAPER turns it into a MIDI item.
2. **Select that item** and run Midi Variator. If the window is already
   open, press **Use selected items**.
3. **Choose what may change** (step 2 in the window) - see below.
4. **Look at the preview.** The picture shows your original in grey and the
   variation in yellow, with a list of exactly what changed underneath
   ("Bar 3, beat 2: F4 moved up to G4"). Use **<** and **>** to look through
   the whole set, and **New set** for a different set.
5. Press **Make 4 variations** (or however many you chose). They go on the
   same track straight after your original, one after another.

It is all one undo step: Ctrl+Z (Cmd+Z) takes a whole batch back.

### What may change

| Control | What it does |
| --- | --- |
| **How much** | From 0% (exact copies) to 100% ("bold, still recognisable"). It tells you roughly how many changes that means for your clip - at the default 35%, about one or two changes in a short phrase. Even at 100%, most of the original stays exactly as it was. |
| **Notes** | A note moved one step up or down the key, or now and then an octave (never beyond the range your clip already uses). |
| **Rhythm** | A long note struck twice instead of held, two repeated notes tied into one, or a note (or chord) coming in a little early - "pushed", as in pop and jazz - or a little late. |
| **Add notes** | A passing note filling in a leap, a quick grace note, a pickup note leading into a note after a rest, an extra note in a chord, or - for drums - a quiet "ghost" hit. |
| **Leave notes out** | A weak note left out (sometimes the note before rings on over the gap instead), or a chord thinned by one inner note. |
| **Chords** | A chord revoiced (an inner note moved an octave), rolled like a strum, or coloured (a note moved a step - a third to a fourth makes a "sus" chord). Only shown when your clip has chords. |
| **Timing, Velocity, Lengths** | The "feel": each moment a few milliseconds early or late, a little louder or softer with a gentle swell across the phrase, notes held a touch longer or shorter. Switch these off if you want the notes to stay exactly on the grid. |
| **Where** | *Anywhere*, *Towards the end* or *Towards the start*. **Towards the end** is the classic way to vary a repeated motif: it starts the same and answers differently. |
| **Keep the first and last notes** | The notes that open and close the phrase stay exactly as they are, so every variation is recognisably the same motif. On by default. |
| **How many** | 1 to 16 variations in one go. |
| **Grow across the series** | The first variations change less and the last the full amount, so a repeated motif builds. Each is still made from the original. |

A switch that is **on is yellow**, off is grey.

### The rules it follows, so the changes stay small and musical

- **At most one change to any one moment** of the music, and never more
  than about a third of the notes changed, however high you set *How much*.
- **Changed notes stay in the key** - it works out which seven notes your
  music is built from, and also allows any note your original actually
  plays (so a minor tune's raised 7th stays available).
- **Nothing new grinds.** A changed note is never put a semitone against
  something sounding at the same time, unless the original already had
  that clash.
- **Drums keep their drums.** Anything on MIDI channel 10 is treated as
  drums: no drum is ever changed into a different drum.
- **A series spreads out.** In a batch of variations, a note already changed
  in one is less likely to be changed in the next, so twenty variations
  don't all bend the same note.

### Varying copies you already have

If you have already laid out your phrase several times (copied and pasted
along the timeline), select all the copies and press **Vary selected in
place**. Each copy becomes a new variation of its own original, where it
sits. Press it again for a different roll of the dice - it always starts
from the original, never from the last roll.

Pasted copies are often "pooled" (REAPER's ghost copies, where editing one
edits them all). Midi Variator notices and replaces each one with its own
independent item, so varying one copy never changes the others.

### Putting the original back

Select any variations and press **Put back the original** (it appears when
a selected item is a variation). They play the original again, and can be
varied again later.

### Several items at once

Select a melody and its chords on different tracks together, and each is
varied on its own track, with the variations lined up bar for bar.

## If something goes wrong

**It says it needs ReaImGui.** The extension is not installed, or REAPER has
not been restarted since it was.

**It says "Select a MIDI item first".** Click the item in the arrange view
so it is highlighted, then press **Use selected items**. Audio items are not
MIDI - it needs a MIDI item.

**It cannot find `mv_vary.lua`** (or another `mv_` file). The four files
are not all in the same folder.

**The variations are too different / not different enough.** Turn **How
much** down or up, or switch off the kinds of change you don't want. For
the smallest possible variations: *How much* around 15%, *Keep the first
and last notes* on, *Where: Towards the end*.

**The timing feels loose.** Switch **Timing** off - then every note that
isn't deliberately changed stays exactly where it was.

## For developers

Everything musical is plain Lua with no REAPER in it, and is tested outside
REAPER:

```
tools/test.sh               # every test suite
lua5.4 tools/demo.lua       # what it does to the test tunes, printed
lua5.4 tools/demo.lua noir 8 0.6   # one tune, 8 variations, at 60%
```

[`CLAUDE.md`](CLAUDE.md) explains how it is put together and why;
[`docs/decisions`](docs/decisions) records the choices that shaped it.
