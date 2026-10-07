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
3. **Check the scale** (step 2). It shows the scale it heard in your
   clip. Leave it, or pick another to take your variations there - see
   *The scale* below.
4. **Choose what may change** (step 3) - see below.
5. **Look at the preview.** The picture shows your original in grey and the
   variation in yellow, with a list of exactly what changed underneath
   ("Bar 3, beat 2: F4 moved up to G4"). Use **<** and **>** to look through
   the whole set, and **New set** for a different set. Don't like one of
   the changes? **Untick it** - see *Choosing the changes* below.
6. **Listen.** Press **Audition** to hear the variation in your
   original's place, with the rest of your project - see *Hearing one
   first* below.
7. Press **Make 4 variations** (or however many you chose). They go on the
   same track straight after your original, one after another.

It is all one undo step: Ctrl+Z (Cmd+Z) takes a whole batch back.

### The scale

It listens to your clip and works out which scale it is in ("Heard as
D Minor (Natural)"). Every note a variation changes or adds stays in that
scale - plus any other note your original plays, so a minor tune's raised
7th stays available.

| Control | What it does |
| --- | --- |
| **Root** and **Scale** | Pick a different scale: any of the 18 roots and ScaleView's 16 scales (major and minor, the modes, pentatonics, blues, whole tone, diminished). Picking the one it heard goes back to it. |
| **Bring the original into this scale** | Shown when some of your original's notes are not in the picked scale. **On** (the default): those notes move to the nearest note of the new scale first, so the variations *pivot* - pick C minor for a C major tune and every E becomes Eb, every A becomes Ab. The window lists exactly what moves. **Off**: your original stays as it is, and only the changes use the new scale. |
| **Back to what it heard** | Forget the picked scale. |
| **Stay in the original's notes** | Changes and added notes use **only** the notes your original already plays - nothing new at all. Detection and the picker are set aside while it is on. Good for pentatonic tunes, or anything where one foreign note would stand out. |

Whatever scale you pick, **the original kept inside each variation is
always your real original**, so *Put back the original* restores it exactly
- a pivot never overwrites it.

A "step" to a neighbouring note is never more than a major third, even in
a pentatonic scale or with a three-note motif's own notes.

Drums have no scale, so a drum clip has no Scale step.

### What may change

| Control | What it does |
| --- | --- |
| **How much** | From 0% (exact copies) to 100% ("bold, still recognisable"). It tells you roughly how many changes that means for your clip - at the default 35%, about one or two changes in a short phrase. Up to 70%, most of the original stays exactly as it was; above 70%, *Develop the motif* starts to make bigger changes. |
| **Develop the motif** | Shown above 70%. Now and then a variation takes a stretch of your music and develops it the way a composer brings a motif back: **turned upside down** (inverted - where the tune went up, it goes down), **played in reverse order**, **moved up or down the scale** (a sequence - "the tune moved up a third"), its **intervals widened** (steps become thirds) or **narrowed** (leaps become steps), or **its first half repeated a step lower** in place of the second. The higher the amount, the more often, and the longer the stretch - a bar or two just above 70%, up to most of the phrase at 100%. The rhythm stays, so it is still recognisably your motif; it stays in the scale; with chords under a tune, only the tune is turned or reversed and it stays on top of the chords; nothing new grinds; and the first and last notes stay when *Keep the first and last notes* is on. Switch it off to keep 100% small. Never for drums. |
| **Notes** | A note moved one step up or down the key, or now and then an octave (never beyond the range your clip already uses). |
| **Rhythm** | A long note struck twice instead of held, two repeated notes tied into one, or a note (or chord) coming in a little early - "pushed", as in pop and jazz - or a little late. |
| **Add notes** | A passing note filling in a leap, a quick grace note, a pickup note leading into a note after a rest, an extra note in a chord, or - for drums - a quiet "ghost" hit. |
| **Leave notes out** | A weak note left out (sometimes the note before rings on over the gap instead), or a chord thinned by one inner note. |
| **Chord voicing** | A chord revoiced (an inner note moved an octave) or rolled like a strum. Only shown when your clip has chords. |
| **Chord quality** | A chord changed into a neighbouring kind of chord. The chord is read by ScaleView Pro's chord detector - the same one, so the same names. **Adding a note**: C to Cmaj7, C6 or Cadd9; G7 to G9, G7(13) or G7b9; Cmin7 to Cmin9 or Cmin11; Cdim to Cdim7. **Moving a note**: sus4 and sus2 chords (and back), minor to major and back, Cmin to Cdim, Cmin7 to Cmin7b5, C to Caug, G7 to G11. **Dropping a note**: G7 to G. The bass never moves, and a chord struck several times in a row changes every time it is struck. **Arpeggiated chords too**: a bar (or half bar) of single notes going round a chord - an Alberti bass, a broken-chord accompaniment - is read as that chord and changed the same way: C G E G can become C G E B (Cmaj7), and the same arpeggio bar after bar changes together. The list of changes says what each chord became ("Bar 2, beat 1: G7 became G9", "Bar 3: the arpeggio Amin became Amin7"). Only shown when your clip has chords. |
| **Chord changes may leave the scale** | Shown while *Chord quality* is on. **Off** (the default): a chord only changes into one whose notes are in the scale - in C major, G7 can become G9 or G11, C can become Cmaj7. **On**: it may borrow notes from outside - C can become Cmin or Caug, G7 can become G7b9 (the diminished sound), Amin can become Adim. |
| **Timing, Velocity, Lengths** | The "feel": each moment a few milliseconds early or late, a little louder or softer with a gentle swell across the phrase, notes held a touch longer or shorter. Switch these off if you want the notes to stay exactly on the grid. |
| **Where** | *Anywhere*, *Towards the end* or *Towards the start*. **Towards the end** is the classic way to vary a repeated motif: it starts the same and answers differently. |
| **Keep the first and last notes** | The notes that open and close the phrase stay exactly as they are, so every variation is recognisably the same motif. On by default. |
| **How many** | 1 to 16 variations in one go. |
| **Grow across the series** | The first variations change less and the last the full amount, so a repeated motif builds. Each is still made from the original. |
| **Form** | What comes after your original (A), when you make more than one - motif memory. **All new**: A' A'' A''' ... - a new variation every time. **Home between**: A' A A'' A - your original comes back between the variations, played afresh (only the feel new). **In pairs**: A' A' A'' A'' - each variation stated, then echoed. **A refrain**: A' A'' A' A''' - the first variation keeps coming back between new ones. An echo plays exactly the same changes as the one it echoes, with a feel of its own, the way a player never plays a phrase twice exactly alike. The letters for your batch are shown beside the buttons. |

A switch that is **on is yellow**, off is grey.

### The rules it follows, so the changes stay small and musical

- **At most one change to any one moment** of the music, and never more
  than about a third of the notes changed, however high you set *How much*.
- **Changed notes stay in the key** (unless you let chord changes leave
  the scale) - it works out which seven notes your
  music is built from, and also allows any note your original actually
  plays (so a minor tune's raised 7th stays available).
- **Nothing new grinds.** A changed note is never put a semitone against
  something sounding at the same time, unless the original already had
  that clash. A changed chord may carry its own colour (Cmaj7's B against
  its C is the point of it) but never grinds against the tune over it.
- **Drums keep their drums.** Anything on MIDI channel 10 is treated as
  drums: no drum is ever changed into a different drum.
- **A series spreads out.** In a batch of variations, a note already changed
  in one is less likely to be changed in the next, so twenty variations
  don't all bend the same note.

### Choosing the changes

Every change in the list has a tick box. **Untick one you don't like** and
it is taken out of that variation; every other change - and the feel -
stays exactly as it was, and *Make* makes it without that change. In an
echo (*In pairs*, *A refrain*), unticking a change unticks it in the
variation it echoes too. Changing any setting, **New set** or **Make**
starts a fresh batch with every box ticked.

### Hearing one first

**Audition** plays the variation shown in your original's place: on the
original's own track, through the same instrument, with the rest of the
project playing, from the bar it starts in. Your original is silent while
it plays. Press **<** and **>** while it plays to hear the others in the
batch - each comes straight in. **Stop** (or REAPER's own stop, or reaching
the end) puts everything back: the original unmuted, the edit cursor where
it was. Nothing is added to your project or your undo history.

If the track uses REAPER 7's fixed item lanes (which play only one lane),
the audition plays on a temporary track under it, with a copy of its
effects, instead.

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

### Several items at once - a melody and its chords together

Select a melody and its chords on different tracks together and press
*Use selected items*. When items sound at the same time, a **Vary them
together** switch appears (on by default): they are varied **as one
piece**. A changed melody note never grinds against the chords, a changed
chord never grinds against the tune, the scale is heard from all of them,
and a note added to a chord goes on the chords' track (not the bass's).
Each variation of the melody lands over the same variation of the chords,
lined up bar for bar - in a place free on every track. *Vary selected in
place* does the same for the groups you select.

Switch it off and each item is varied on its own, as before.

## If something goes wrong

**It says it needs ReaImGui.** The extension is not installed, or REAPER has
not been restarted since it was.

**It says "Select a MIDI item first".** Click the item in the arrange view
so it is highlighted, then press **Use selected items**. Audio items are not
MIDI - it needs a MIDI item.

**It cannot find `mv_vary.lua`** (or another `mv_` file). The four files
are not all in the same folder.

**It heard the wrong scale.** Pick the right root and scale in step 2. If
the only difference is a note or two, untick *Bring the original into this
scale* so your original is left exactly as it is.

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
