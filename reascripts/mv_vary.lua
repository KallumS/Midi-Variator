--[[ Midi Variator - making a variation of some music.

     Pure Lua: no reaper., no ImGui. The notes arrive as plain tables, in
     quarter notes counted from the bar line at or before the item:

       { pitch = 60, start = 0.0, len = 1.0, vel = 100, chan = 0 }

     with the source around them:

       { notes, lead, beats, barBeats, pulse }

     `lead` is where the item starts (0 when it starts on a bar line) and
     `beats` where it ends, both in the same quarter notes, so the engine's
     bars and beats are the project's.

     The one rule everything here keeps: A VARIATION IS ALWAYS MADE FROM THE
     ORIGINAL. `vary` takes the original and a seed and nothing else, so the
     twentieth variation is exactly as close to the original as the first -
     nothing accumulates. That is the Nordic Noir way with a motif: it keeps
     coming back, a little different each time, never wandering off.

     How small is small:

       - A handful of changes to the notes themselves (`budget`), at most one
         to any one moment of the music, and never more than 30% of it.
       - Each of those is one musical move a player might make: a note nudged
         a step within the key, a note repeated or tied, a beat anticipated,
         a passing note or a grace note added, a note left out, a chord
         revoiced, rolled or coloured.
       - Then, lightly, over everything: timing, velocity and length, the way
         nobody plays a phrase twice exactly alike.
]]

local M = {}

------------------------------------------------------------------------------
-- Settings the engine is tuned with. Every musical judgement is here.
------------------------------------------------------------------------------

-- Notes struck within this many quarter notes of each other are one moment:
-- a chord. A 64th - tight enough that a fast run is not read as a chord.
M.ONSET = 0.07

-- The finest grid a rhythm is read on, coarsest first. The first one that at
-- least GRID_SHARE of the notes start on is the music's grid.
M.GRIDS = { 1, 0.5, 1 / 3, 0.25, 1 / 6, 0.125 }
M.GRID_SHARE = 0.9

-- Rhythm changes move by the grid, but never by more than an eighth: a tune
-- in plain quarter notes is varied with eighths, not with whole beats.
M.MAX_UNIT = 0.5

-- How many changes a variation gets, at full amount: one, plus one for every
-- CHANGES_PER notes. Never more than CAP_SHARE of the notes.
M.CHANGES_PER = 8
M.CAP_SHARE = 0.3

-- Feel, at full amount. Timing is a spread in quarter notes (0.012 is about
-- 6ms at 120bpm; TIMING_MAX about 15ms). Velocity is in MIDI steps. Length
-- is a share of the note.
M.TIMING_SD, M.TIMING_MAX, M.TIMING_CHORD = 0.012, 0.03, 0.004
M.VEL_JITTER, M.VEL_SWELL, M.VEL_WHOLE = 5, 7, 3
M.LEN_WHOLE, M.LEN_NOTE = 0.08, 0.08

-- The furthest a "step" may go, in semitones. In a seven-note scale a step
-- is one or two; in a pentatonic or blues scale up to three; with only the
-- original's own notes to use, a three-note motif could otherwise "step" a
-- fifth. A major third is the most that still sounds like a neighbour.
M.MAX_STEP = 4

-- The shortest note anything leaves behind, in quarter notes.
M.MIN_LEN = 0.03

-- The channel General MIDI keeps for drums (0-based). Drum notes are sounds,
-- not pitches, so nothing moves their pitch.
M.DRUM_CHANNEL = 9

-- What can change, as the window names them, and the moves each allows.
-- `w` is how often a move is tried against the others in its kind.
M.KINDS = {
  { key = "notes",   name = "Notes",           moves = { { "neighbour", 4 }, { "octave", 0.7 } } },
  { key = "rhythm",  name = "Rhythm",          moves = { { "split", 1.5 }, { "shift", 1.5 }, { "join", 1 } } },
  { key = "add",     name = "Add notes",       moves = { { "passing", 2 }, { "grace", 1 }, { "pickup", 1 }, { "fill", 2 }, { "ghost", 2 } } },
  { key = "remove",  name = "Leave notes out", moves = { { "drop", 2 }, { "thin", 2 } } },
  { key = "chords",  name = "Chords",          moves = { { "revoice", 2 }, { "roll", 1 }, { "colour", 1 } } },
}
M.FEELS = {
  { key = "timing",   name = "Timing" },
  { key = "velocity", name = "Velocity" },
  { key = "lengths",  name = "Lengths" },
}
M.FOCUS = { "Anywhere", "Towards the end", "Towards the start" }

-- The options a caller starts from. Every kind and feel is on.
function M.defaults()
  local o = { amount = 0.35, focus = 1, keepEnds = true, grow = false }
  for _, k in ipairs(M.KINDS) do o[k.key] = true end
  for _, f in ipairs(M.FEELS) do o[f.key] = true end
  return o
end

------------------------------------------------------------------------------
-- Randomness
--
-- A fixed generator (Park and Miller's), so a seed always gives the same
-- variation: the preview in the window is exactly what gets made.
------------------------------------------------------------------------------

function M.random(seed)
  local s = math.floor(math.abs(seed or 1)) % 2147483646 + 1
  return function()
    s = s * 48271 % 2147483647
    return (s - 1) / 2147483646
  end
end

-- A seed for the i-th variation of the j-th item in a batch.
function M.seedFor(base, i, j)
  return (math.floor(base) + (i or 0) * 7919 + (j or 0) * 104729) % 2147483646
end

local function between(r, lo, hi) return lo + (hi - lo) * r() end
local function coin(r, p) return r() < (p or 0.5) end
-- Roughly bell-shaped, -1.5..1.5, standard deviation 0.5 - three uniforms.
local function bell(r) return r() + r() + r() - 1.5 end

-- One of `items`, chosen in proportion to `weights`.
local function choose(r, items, weights)
  local total = 0
  for i = 1, #items do total = total + (weights and weights[i] or 1) end
  if total <= 0 then return nil end
  local x = r() * total
  for i = 1, #items do
    x = x - (weights and weights[i] or 1)
    if x < 0 then return items[i], i end
  end
  return items[#items], #items
end

------------------------------------------------------------------------------
-- Reading the original
------------------------------------------------------------------------------

local function byStart(a, b)
  if math.abs(a.start - b.start) > 1e-9 then return a.start < b.start end
  if a.pitch ~= b.pitch then return a.pitch < b.pitch end
  return (a.chan or 0) < (b.chan or 0)
end

local function noteEnd(n) return n.start + n.len end

local function copyNote(n)
  return { pitch = n.pitch, start = n.start, len = n.len, vel = n.vel or 100, chan = n.chan or 0 }
end

function M.copyNotes(notes)
  local out = {}
  for i, n in ipairs(notes) do out[i] = copyNote(n) end
  table.sort(out, byStart)
  return out
end

local function isDrum(n) return (n.chan or 0) == M.DRUM_CHANNEL end

-- The grid the rhythm sits on: the coarsest that nearly every note starts on.
function M.grid(notes)
  if #notes == 0 then return 0.25 end
  for _, g in ipairs(M.GRIDS) do
    local on = 0
    for _, n in ipairs(notes) do
      local off = n.start / g - math.floor(n.start / g + 0.5)
      if math.abs(off * g) < 0.02 then on = on + 1 end
    end
    if on >= M.GRID_SHARE * #notes then return g end
  end
  return M.GRIDS[#M.GRIDS]
end

-- How strong a moment is: 3 on the bar line, 2 on a counted beat, 1 halfway
-- between beats, 0 anywhere else.
function M.strength(t, barBeats, pulse)
  local function on(unit)
    local x = t / unit
    return math.abs(x - math.floor(x + 0.5)) * unit < 0.02
  end
  if on(barBeats) then return 3 end
  if on(pulse) then return 2 end
  if on(pulse / 2) then return 1 end
  return 0
end

--[[  Which notes a changed note may land on.

      Not simply "the key": the key finder is tuned on tunes that end at
      home, and a piece that ends on a half cadence (A minor ending on E
      major) reads as E minor, whose F# is nowhere in the music. What a
      variation needs is the seven notes the music is actually made of, so
      the scale is the seven-note set that covers the most of the music's
      time, and the key finder only breaks ties between sets that cover it
      equally (D minor's notes D E F G A fit F major's set and C major's; the
      key finder says which).

      scale: the seven pitch classes, for chord colours, which must be diatonic.
      pcs:   those plus every note the original plays, for melody steps, so a
             tune's raised seventh or blue note stays available.
      key:   for spelling note names. ]]
local function scaleOf(notes, T, first, last)
  local pcs, pitched, weight = {}, {}, {}
  for _, n in ipairs(notes) do
    if not isDrum(n) then
      pitched[#pitched + 1] = n
      pcs[n.pitch % 12] = true
      weight[n.pitch % 12] = (weight[n.pitch % 12] or 0) + math.max(n.len, 0.25)
    end
  end
  if not T or #pitched == 0 then return pcs, pcs, nil end

  local best, bestCover
  for _, cand in ipairs(T.detectKey(pitched, first, last)) do
    local k = T.key(cand.root, cand.scale)
    local cover = 0
    for pc, w in pairs(weight) do if k.pcs[pc] then cover = cover + w end end
    if not bestCover or cover > bestCover + 1e-9 then best, bestCover = k, cover end
  end
  local scale = {}
  for pc in pairs(best.pcs) do scale[pc] = true; pcs[pc] = true end
  return scale, pcs, best
end

--[[  Everything the moves need to know about the original, worked out once.

      events: the moments something is struck, in order, each
              { start, notes (low to high), top, bass, strength, pos }
      pcs:    the pitch classes a changed note may land on
      key:    how note names are spelled: the key heard (nil for drums)
      unit:   the step rhythm changes move by
      lo, hi: the range of the pitched notes
      heardKey: the key it seems to be in, whatever is picked (nil for drums)
      played: the pitch classes the original plays

      `pick`, if given, replaces what was heard - see `prepare`. Then
      `key` spells note names in the picked scale and `picked` is it. ]]
function M.analyse(src, T, pick)
  local notes = M.copyNotes(src.notes)
  local an = { events = {}, lo = 127, hi = 0, count = #notes }
  for _, n in ipairs(notes) do
    local last = an.events[#an.events]
    if last and n.start - last.start <= M.ONSET then
      last.notes[#last.notes + 1] = n
    else
      an.events[#an.events + 1] = { start = n.start, notes = { n } }
    end
    if not isDrum(n) then an.lo, an.hi = math.min(an.lo, n.pitch), math.max(an.hi, n.pitch) end
  end

  local span = math.max((src.beats or 0) - (src.lead or 0), 1e-9)
  for i, e in ipairs(an.events) do
    table.sort(e.notes, function(a, b) return a.pitch < b.pitch end)
    e.index = i
    e.top, e.bass = e.notes[#e.notes], e.notes[1]
    e.strength = M.strength(e.start, src.barBeats or 4, src.pulse or 1)
    e.pos = math.max(0, math.min(1, (e.start - (src.lead or 0)) / span))
    e.drum = isDrum(e.top)
  end

  local first = an.events[1]
  local last = an.events[#an.events]
  an.scale, an.pcs, an.key = scaleOf(notes, T,
    first and first.top.pitch % 12, last and last.bass.pitch % 12)
  an.heardKey = an.key          -- what it heard, whatever is picked below

  -- What the window asked for instead of what was heard (see `prepare`).
  local played = {}
  for _, n in ipairs(notes) do if not isDrum(n) then played[n.pitch % 12] = true end end
  an.played = played
  if pick and pick.own then
    an.scale, an.pcs = played, played
  elseif pick and pick.root and T then
    local sc = M.pickedScale(T, pick.root, pick.scale)
    an.scale, an.key, an.picked = sc.pcs, sc, sc
    -- The original's own notes stay allowed. After a pivot they are all
    -- in the scale anyway; without one, they are what it still plays.
    an.pcs = {}
    for pc in pairs(sc.pcs) do an.pcs[pc] = true end
    for pc in pairs(played) do an.pcs[pc] = true end
  end

  an.grid = M.grid(notes)
  an.unit = math.min(an.grid, M.MAX_UNIT)
  an.drums = an.hi < an.lo
  return an
end

------------------------------------------------------------------------------
-- Picking a scale
--
-- The scales are ScaleView for REAPER's, its SCALES table copied UNCHANGED
-- from reascripts/ScaleView Pro.lua at commit e31a6e8, so the tools agree
-- on what a scale is and how its notes are spelled. A change belongs in
-- ScaleView first. Roots are mv_theory's (ScaleView's eighteen, spelled).
------------------------------------------------------------------------------

local SCALES = {
  {name = "Major",            intervals = {0, 2, 4, 5, 7, 9, 11},
                              letters   = {0, 1, 2, 3, 4, 5,  6}},
  {name = "Minor (Natural)",  intervals = {0, 2, 3, 5, 7, 8, 10},
                              letters   = {0, 1, 2, 3, 4, 5,  6}},
  {name = "Harmonic Minor",   intervals = {0, 2, 3, 5, 7, 8, 11},
                              letters   = {0, 1, 2, 3, 4, 5,  6}},
  {name = "Ionian",           intervals = {0, 2, 4, 5, 7, 9, 11},
                              letters   = {0, 1, 2, 3, 4, 5,  6}},
  {name = "Dorian",           intervals = {0, 2, 3, 5, 7, 9, 10},
                              letters   = {0, 1, 2, 3, 4, 5,  6}},
  {name = "Phrygian",         intervals = {0, 1, 3, 5, 7, 8, 10},
                              letters   = {0, 1, 2, 3, 4, 5,  6}},
  {name = "Lydian",           intervals = {0, 2, 4, 6, 7, 9, 11},
                              letters   = {0, 1, 2, 3, 4, 5,  6}},
  {name = "Mixolydian",       intervals = {0, 2, 4, 5, 7, 9, 10},
                              letters   = {0, 1, 2, 3, 4, 5,  6}},
  {name = "Aeolian",          intervals = {0, 2, 3, 5, 7, 8, 10},
                              letters   = {0, 1, 2, 3, 4, 5,  6}},
  {name = "Major Pentatonic", intervals = {0, 2, 4, 7, 9},
                              letters   = {0, 1, 2, 4, 5}},
  {name = "Minor Pentatonic", intervals = {0, 3, 5, 7, 10},
                              letters   = {0, 2, 3, 4,  6}},
  {name = "Major Blues",      intervals = {0, 2, 3, 4, 7, 9},
                              letters   = {0, 1, 2, 2, 4, 5}},
  {name = "Minor Blues",      intervals = {0, 3, 5, 6, 7, 10},
                              letters   = {0, 2, 3, 4, 4,  6}},
  {name = "Whole Tone",       intervals = {0, 2, 4, 6, 8, 10},
                              letters   = {0, 1, 2, 3, 4,  5}},
  {name = "Diminished Whole-Half", intervals = {0, 2, 3, 5, 6, 8, 9, 11},
                                   letters   = {0, 1, 2, 3, 4, 5, 5,  6}},
  {name = "Diminished Half-Whole", intervals = {0, 1, 3, 4, 6, 7, 9, 10},
                                   letters   = {0, 1, 2, 2, 3, 4, 5,  6}},
}
M.SCALES = SCALES

function M.scaleIndex(name)
  for i, sc in ipairs(SCALES) do if sc.name == name then return i end end
end

local LETTER_PC = { 0, 2, 4, 5, 7, 9, 11 }
local LETTERS   = { "C", "D", "E", "F", "G", "A", "B" }
local ACCIDENT  = { [-2] = "bb", [-1] = "b", [0] = "", [1] = "#", [2] = "x" }

--[[  A scale picked in the window: `root` indexes mv_theory's ROOTS and
      `scale` indexes SCALES. Shaped like an mv_theory key - pcs[pc],
      names[pc], label - so note names are spelled by it: C minor's third
      is Eb, not D#. Notes outside it lean whichever way the scale does. ]]
function M.pickedScale(T, rootIdx, scaleIdx)
  local root, sc = T.ROOTS[rootIdx], SCALES[scaleIdx]
  local tonic = T.rootPc(root)
  local s = { root = rootIdx, scale = scaleIdx, tonic = tonic, pcs = {}, names = {},
              label = root.name .. " " .. sc.name }
  local sharps, flats = 0, 0
  for i, iv in ipairs(sc.intervals) do
    local pc = (tonic + iv) % 12
    local letter = (root.letter + sc.letters[i]) % 7
    local offset = ((pc - LETTER_PC[letter + 1] + 6) % 12) - 6
    s.pcs[pc] = true
    if ACCIDENT[offset] then
      s.names[pc] = LETTERS[letter + 1] .. ACCIDENT[offset]
      if offset > 0 then sharps = sharps + 1 elseif offset < 0 then flats = flats + 1 end
    end
  end
  local outside = flats > sharps and T.FLAT_NAMES or T.SHARP_NAMES
  for pc = 0, 11 do s.names[pc] = s.names[pc] or outside[pc + 1] end
  return s
end

--[[  The original brought into a picked scale - the pivot. Each note outside
      it moves to the nearest note inside it; when two are equally near, to
      the one on the same letter, so C major into C minor makes E into Eb
      (the third stays a third) rather than F. Drums are left alone. Two
      notes landing on one pitch at once become one.

      `from` spells the original (the key it was heard in). Returns the
      notes and what moved: { { from = pc, to = pc, count }, ... }. ]]
function M.fit(notes, scale, from)
  local out, moved = {}, {}
  for _, n in ipairs(notes) do
    local c = copyNote(n)
    local pc = n.pitch % 12
    if not isDrum(n) and not scale.pcs[pc] then
      local up, down
      for d = 1, 11 do
        if not up and scale.pcs[(pc + d) % 12] then up = d end
        if not down and scale.pcs[(pc - d) % 12] then down = d end
      end
      local d
      if up and down and up == down then
        local letter = from and from.names[pc] and from.names[pc]:sub(1, 1)
        d = (letter and scale.names[(pc + up) % 12]:sub(1, 1) == letter) and up or -down
      elseif up and (not down or up < down) then d = up
      elseif down then d = -down end
      if d and n.pitch + d >= 0 and n.pitch + d <= 127 then
        c.pitch, c.fitted = n.pitch + d, true
        moved[pc] = moved[pc] or { from = pc, to = (pc + d) % 12, count = 0 }
        moved[pc].count = moved[pc].count + 1
      end
    end
    out[#out + 1] = c
  end

  table.sort(out, byStart)
  local last, keep = {}, {}
  for _, n in ipairs(out) do
    local k = n.chan * 128 + n.pitch
    local p = last[k]
    if p and (p.fitted or n.fitted) and noteEnd(p) > n.start + 1e-9 then
      if math.abs(p.start - n.start) < 1e-9 then
        p.len = math.max(p.len, n.len)   -- one note where two landed
        n.dead = true
      else
        p.len = n.start - p.start
        if p.len < M.MIN_LEN then p.dead = true end
      end
    end
    if not n.dead then last[k] = n end
  end
  for _, n in ipairs(out) do
    if not n.dead then
      keep[#keep + 1] = { pitch = n.pitch, start = n.start, len = n.len, vel = n.vel, chan = n.chan }
    end
  end
  local list = {}
  for _, m in pairs(moved) do list[#list + 1] = m end
  table.sort(list, function(a, b) return a.from < b.from end)
  return keep, list
end

-- "E -> Eb, A -> Ab": what fitting moved, in the two keys' own spellings.
function M.describeFit(moved, from, scale)
  local parts = {}
  for _, m in ipairs(moved) do
    local a = from and from.names[m.from] or tostring(m.from)
    parts[#parts + 1] = a .. " -> " .. scale.names[m.to]
  end
  return table.concat(parts, ", ")
end

--[[  The source a batch of variations is made from, and its analysis.

      pick = nil            the scale is heard from the notes (decision 0004)
      pick = { own = true } changes use only the notes the original plays
      pick = { root, scale, fit }
                            a scale chosen in the window. With `fit`, the
                            original is first brought into it (`fit`), so
                            the variations pivot to the new scale; without,
                            the original's own notes stay and only the
                            changes use the new scale.

      The source returned is a copy with the fitted notes; everything else
      - the item, and the TRUE original kept inside variations - is the
      source's own. The analysis carries `fitted` (what moved) and the key
      the original was heard in. ]]
function M.prepare(src, T, pick)
  if not (pick and pick.root and pick.fit and T) then
    local an = M.analyse(src, T, pick)
    an.fitted = {}
    return src, an
  end
  local heard = M.analyse(src, T)
  local sc = M.pickedScale(T, pick.root, pick.scale)
  local notes, moved = M.fit(src.notes, sc, heard.heardKey)
  local out = {}
  for k, x in pairs(src) do out[k] = x end
  out.notes = notes
  local an = M.analyse(out, T, pick)
  an.fitted, an.heardKey, an.played = moved, heard.heardKey, heard.played
  return out, an
end

------------------------------------------------------------------------------
-- Naming what changed, for the window
------------------------------------------------------------------------------

-- General MIDI's names for the drums people actually use.
M.DRUM_NAMES = {
  [35] = "kick", [36] = "kick", [37] = "side stick", [38] = "snare", [39] = "clap",
  [40] = "snare", [41] = "low tom", [42] = "closed hi-hat", [43] = "low tom",
  [44] = "pedal hi-hat", [45] = "mid tom", [46] = "open hi-hat", [47] = "mid tom",
  [48] = "high tom", [49] = "crash", [50] = "high tom", [51] = "ride", [53] = "ride bell",
  [54] = "tambourine", [56] = "cowbell", [57] = "crash", [59] = "ride",
}

function M.noteName(an, pitch, T, drum)
  if drum then return M.DRUM_NAMES[pitch] or ("drum " .. pitch) end
  local name
  if T and an.key then name = T.noteName(an.key, pitch % 12)
  elseif T then name = T.SHARP_NAMES[pitch % 12 + 1]
  else name = tostring(pitch % 12) end
  return name .. (pitch // 12 - 1)
end

function M.where(t, barBeats, pulse)
  local bar = math.floor(t / barBeats + 1e-6)
  local beat = (t - bar * barBeats) / pulse + 1
  beat = math.floor(beat * 100 + 0.5) / 100
  local b = (beat == math.floor(beat)) and ("%d"):format(beat) or ("%g"):format(beat)
  return ("Bar %d, beat %s"):format(bar + 1, b)
end

------------------------------------------------------------------------------
-- The moves
--
-- Each move works on `v`, the variation being built:
--   v.notes     the working notes (copies of the original's)
--   v.an        the analysis of the original
--   v.touched   events already changed - one change per moment, at most
--   v.r         the random generator
-- and returns a description of what it did, or nil if it found nowhere it
-- could do it. A move only ever changes the one moment it chose (and, where
-- it has to, how long the note before it lasts).
------------------------------------------------------------------------------

-- The next pitch up (dir 1) or down (dir -1) that belongs to the key.
local function step(pcs, p, dir)
  local q = p + dir
  for _ = 1, 12 do
    if q < 0 or q > 127 or math.abs(q - p) > M.MAX_STEP then return nil end
    if pcs[q % 12] then return q end
    q = q + dir
  end
  return nil
end

-- A minor second, major seventh or minor ninth: the intervals that grind.
local function harsh(a, b)
  local d = math.abs(a - b) % 12
  return d == 1 or d == 11
end

-- True if `pitch` at [t0, t1) would grind against something else sounding,
-- where `note` (the one being changed) did not.
local function clashes(v, note, pitch, t0, t1)
  for _, o in ipairs(v.notes) do
    if o ~= note and not o.gone and not isDrum(o)
       and o.start < t1 - 1e-6 and noteEnd(o) > t0 + 1e-6 then
      if harsh(pitch, o.pitch) and not (note and harsh(note.pitch, o.pitch)) then return true end
      if o.pitch == pitch then return true end
    end
  end
  return false
end

local function protected(v, e)
  return v.opts.keepEnds and (e.index == 1 or e.index == #v.an.events)
end

-- How much a moment invites change: where it is in the phrase, as the focus
-- setting asks, times whatever the move itself cares about.
local function focusWeight(v, e)
  local f = v.opts.focus or 1
  if f == 2 then return 0.15 + 1.85 * e.pos * e.pos end
  if f == 3 then return 0.15 + 1.85 * (1 - e.pos) * (1 - e.pos) end
  return 1
end

-- The moments a move may use: not already changed, not protected (unless
-- the move leaves the moment itself alone), passing `test`.
--
-- In a series, `v.history` counts what the earlier variations changed, so a
-- moment already changed is less likely to be picked again and the same move
-- on the same moment much less likely: twenty variations spread their
-- changes over the phrase instead of bending the same note twenty times.
-- Each is still made from the original; the history only steers the dice.
local function candidates(v, test, weight, allowProtected)
  local list, weights = {}, {}
  local h = v.history or {}
  for _, e in ipairs(v.an.events) do
    if not v.touched[e] and (allowProtected or not protected(v, e)) and test(e) then
      local w = focusWeight(v, e) * (weight and weight(e) or 1)
      w = w / (1 + 2 * (h["@" .. e.index] or 0))
      if h[v.move .. "@" .. e.index] then w = w * 0.25 end
      list[#list + 1] = e
      weights[#weights + 1] = w
    end
  end
  return list, weights
end

local function pickEvent(v, test, weight, allowProtected)
  local list, weights = candidates(v, test, weight, allowProtected)
  if #list == 0 then return nil end
  v.chosen = choose(v.r, list, weights)
  return v.chosen
end

local function add(v, n)
  n.added = true
  v.notes[#v.notes + 1] = n
  return n
end

local function live(e)
  local out = {}
  for _, n in ipairs(e.notes) do if not n.gone then out[#out + 1] = n end end
  return out
end

local function pitched(e) return not e.drum end
local function isChord(e)
  local k = 0
  for _, n in ipairs(e.notes) do if not isDrum(n) then k = k + 1 end end
  return k >= 3
end
-- A note's name - a pitch, or for a drum, the drum. `p` may be a note (its
-- current pitch) or a bare pitch.
local function nameOf(v, p)
  if type(p) == "table" then return M.noteName(v.an, p.pitch, v.T, isDrum(p)) end
  return M.noteName(v.an, p, v.T)
end
local function at(v, t) return M.where(t, v.src.barBeats, v.src.pulse) end
local function nextEvent(v, e) return v.an.events[e.index + 1] end
local function prevEvent(v, e) return v.an.events[e.index - 1] end

local MOVES = {}

-- A note moved one step up or down the key. The commonest variation of all:
-- the same shape, one note bent.
function MOVES.neighbour(v)
  local e = pickEvent(v, pitched, function(e) return e.strength == 3 and 0.5 or 1 end)
  if not e then return nil end
  local n = e.top
  local dirs = coin(v.r) and { 1, -1 } or { -1, 1 }
  local below = e.notes[#e.notes - 1]
  for _, dir in ipairs(dirs) do
    local q = step(v.an.pcs, n.pitch, dir)
    if q and (not below or q > below.pitch)
       and q >= v.an.lo - 2 and q <= v.an.hi + 2
       and not clashes(v, n, q, n.start, noteEnd(n)) then
      local was = n.pitch
      n.pitch = q
      v.touched[e] = true
      return ("%s: %s moved %s to %s"):format(at(v, e.start), nameOf(v, was),
                                             dir > 0 and "up" or "down", nameOf(v, q))
    end
  end
  return nil
end

-- One note an octave away. Kept inside the range the original already uses,
-- so it never leaves the register.
function MOVES.octave(v)
  local e = pickEvent(v, function(e) return pitched(e) and #e.notes == 1 end)
  if not e then return nil end
  local n = e.top
  for _, d in ipairs(coin(v.r) and { 12, -12 } or { -12, 12 }) do
    local q = n.pitch + d
    if q >= v.an.lo and q <= v.an.hi and not clashes(v, n, q, n.start, noteEnd(n)) then
      local was = n.pitch
      n.pitch = q
      v.touched[e] = true
      return ("%s: %s %s an octave"):format(at(v, e.start), nameOf(v, was), d > 0 and "up" or "down")
    end
  end
  return nil
end

-- A long note (or chord) struck twice instead of held.
function MOVES.split(v)
  local u = v.an.unit
  local e = pickEvent(v, function(e)
    for _, n in ipairs(e.notes) do if n.len < 2 * u - 1e-6 then return false end end
    return true
  end)
  if not e then return nil end
  local shortest = math.huge
  for _, n in ipairs(e.notes) do shortest = math.min(shortest, n.len) end
  local cut = math.max(u, math.floor(shortest / 2 / u + 0.5) * u)
  if cut > shortest - u + 1e-6 then cut = shortest - u end
  for _, n in ipairs(live(e)) do
    local second = copyNote(n)
    second.start = n.start + cut
    second.len = noteEnd(n) - second.start
    second.vel = math.floor(n.vel * 0.88 + 0.5)
    n.len = cut
    add(v, second)
  end
  v.touched[e] = true
  if e.drum then return ("%s: %s hit twice"):format(at(v, e.start), nameOf(v, e.top)) end
  if #e.notes > 1 then return ("%s: chord struck again halfway"):format(at(v, e.start)) end
  return ("%s: %s repeated instead of held"):format(at(v, e.start), nameOf(v, e.top))
end

-- A moment moved a step earlier (anticipated - "pushed") or later, keeping
-- where it ends. Whatever was leading into it is shortened or held to meet it.
function MOVES.shift(v)
  local u = v.an.unit
  local e = pickEvent(v, function(e) return e.index > 1 end)
  if not e then return nil end
  local prev, nxt = prevEvent(v, e), nextEvent(v, e)
  local dirs = coin(v.r, 0.6) and { -1, 1 } or { 1, -1 }
  for _, dir in ipairs(dirs) do
    local ns = e.start + dir * u
    local ok = ns > prev.start + u * 0.5 - 1e-6
    for _, n in ipairs(e.notes) do
      if noteEnd(n) - ns < u * 0.5 then ok = false end
    end
    if nxt and ns >= nxt.start - 1e-6 then ok = false end
    if protected(v, prev) then
      -- The note before is one of the protected ones: it may not be cut short.
      for _, n in ipairs(prev.notes) do if noteEnd(n) > ns + 1e-6 then ok = false end end
    end
    if ok then
      local old = e.start
      -- Notes that ran up to this moment follow it: cut short, or held on.
      for _, o in ipairs(v.notes) do
        if not o.gone and o.start < old - 1e-6 then
          local oe = noteEnd(o)
          if dir < 0 and oe > ns + 1e-6 and oe <= old + 0.05 then
            if ns - o.start < M.MIN_LEN * 2 then ok = false end
          end
        end
      end
      if ok then
        for _, o in ipairs(v.notes) do
          if not o.gone and o.start < old - 1e-6 then
            local oe = noteEnd(o)
            if dir < 0 and oe > ns + 1e-6 and oe <= old + 0.05 then o.len = ns - o.start
            elseif dir > 0 and math.abs(oe - old) <= 0.05 then o.len = ns - o.start end
          end
        end
        for _, n in ipairs(e.notes) do
          local ne = noteEnd(n)
          n.start = n.start + (ns - old)
          n.len = ne - n.start
        end
        v.touched[e], v.touched[prev] = true, true
        return ("%s: %s"):format(at(v, old), dir < 0 and "comes in early (anticipated)"
                                                      or "comes in late (held back)")
      end
    end
  end
  return nil
end

-- Two notes of the same pitch, one after the other, tied into one.
function MOVES.join(v)
  local e = pickEvent(v, function(e)
    local nx = nextEvent(v, e)
    return nx and not e.drum and #e.notes == 1 and #nx.notes == 1 and not v.touched[nx]
       and not protected(v, nx) and nx.top.pitch == e.top.pitch
       and nx.start - noteEnd(e.top) <= v.an.unit + 1e-6
  end)
  if not e then return nil end
  local nx = nextEvent(v, e)
  e.top.len = noteEnd(nx.top) - e.top.start
  nx.top.gone = true
  v.touched[e], v.touched[nx] = true, true
  return ("%s: two %ss tied into one"):format(at(v, e.start), nameOf(v, e.top.pitch))
end

-- A passing note: the last part of a note given to the step between it and
-- the next note, where the tune leaps.
function MOVES.passing(v)
  local u = v.an.unit
  local e = pickEvent(v, function(e)
    local nx = nextEvent(v, e)
    if not nx or e.drum or nx.drum then return false end
    local d = math.abs(nx.top.pitch - e.top.pitch)
    return d >= 3 and d <= 9 and e.top.len >= 2 * u - 1e-6
       and noteEnd(e.top) >= nx.start - 0.05
  end)
  if not e then return nil end
  local n, nx = e.top, nextEvent(v, e).top
  local dir = nx.pitch > n.pitch and 1 or -1
  local q = step(v.an.pcs, n.pitch, dir)
  if not q or (dir > 0 and q >= nx.pitch) or (dir < 0 and q <= nx.pitch) then return nil end
  local t = noteEnd(n) - u
  if clashes(v, n, q, t, noteEnd(n)) then return nil end
  local p = copyNote(n)
  p.pitch, p.start, p.len = q, t, u
  p.vel = math.floor(n.vel * 0.85 + 0.5)
  n.len = t - n.start
  add(v, p)
  v.touched[e] = true
  return ("%s: passing note %s added on the way to %s"):format(at(v, t), nameOf(v, q), nameOf(v, nx.pitch))
end

-- A grace note: a quick neighbour just before a note, taken from the end of
-- the note before it.
function MOVES.grace(v)
  local u = v.an.unit
  local g = math.min(u / 2, 0.25)
  local e = pickEvent(v, function(e)
    if e.index == 1 or e.drum then return false end
    local pv = prevEvent(v, e)
    if v.touched[pv] then return false end
    for _, n in ipairs(pv.notes) do
      if noteEnd(n) > e.start - g + 1e-6 then
        if protected(v, pv) or (e.start - g) - n.start < g - 1e-6 then return false end
      end
    end
    return true
  end, nil, true)
  if not e then return nil end
  local n, pv = e.top, prevEvent(v, e)
  local dirs = coin(v.r, 0.6) and { 1, -1 } or { -1, 1 }
  for _, dir in ipairs(dirs) do
    local q = step(v.an.pcs, n.pitch, dir)
    if q and not clashes(v, nil, q, e.start - g, e.start) then
      for _, o in ipairs(pv.notes) do
        if noteEnd(o) > e.start - g then o.len = e.start - g - o.start end
      end
      local gn = copyNote(n)
      gn.pitch, gn.start, gn.len = q, e.start - g, g
      gn.vel = math.floor(n.vel * 0.8 + 0.5)
      add(v, gn)
      v.touched[e], v.touched[pv] = true, true
      return ("%s: grace note %s before the %s"):format(at(v, e.start), nameOf(v, q), nameOf(v, n.pitch))
    end
  end
  return nil
end

-- A pickup: a short note in a rest, stepping into the note after it.
function MOVES.pickup(v)
  local u = v.an.unit
  -- Where the last sound before each moment ends, in one sweep: a long
  -- piece has thousands of notes, and asking each moment separately made
  -- this move alone take most of a second.
  local live, silentFrom = {}, {}
  for _, o in ipairs(v.notes) do if not o.gone then live[#live + 1] = o end end
  table.sort(live, function(a, b) return a.start < b.start end)
  local k, latest = 1, 0
  for _, e in ipairs(v.an.events) do
    while live[k] and live[k].start < e.start - 1e-6 do
      latest = math.max(latest, noteEnd(live[k]))
      k = k + 1
    end
    silentFrom[e] = latest
  end
  local e = pickEvent(v, function(e)
    if e.index == 1 or e.drum then return false end
    return e.start - silentFrom[e] >= 2 * u - 1e-6
  end, nil, true)
  if not e then return nil end
  local n, pv = e.top, prevEvent(v, e)
  local from = pv.top.pitch
  local dir = (n.pitch > from) and -1 or 1       -- approach from the side the tune comes from
  local q = step(v.an.pcs, n.pitch, dir)
  if not q or clashes(v, nil, q, e.start - u, e.start) then return nil end
  local pn = copyNote(n)
  pn.pitch, pn.start, pn.len = q, e.start - u, u
  pn.vel = math.floor(n.vel * 0.8 + 0.5)
  add(v, pn)
  v.touched[e] = true
  return ("%s: pickup note %s leading in"):format(at(v, pn.start), nameOf(v, q))
end

-- A ghost note, for drums: a quiet extra hit of one of this moment's drums,
-- halfway to the next moment - the hi-hat sixteenth or ghosted snare a
-- drummer drops in without thinking.
function MOVES.ghost(v)
  local u = v.an.unit
  local e = pickEvent(v, function(e)
    local nx = nextEvent(v, e)
    return e.drum and nx and nx.start - e.start >= u - 1e-6
  end, nil, true)
  if not e then return nil end
  local t = e.start + (nextEvent(v, e).start - e.start) / 2
  local n = e.notes[1]
  for _, o in ipairs(e.notes) do if o.vel < n.vel then n = o end end   -- the quietest: hat or snare, not kick
  local gn = copyNote(n)
  gn.start, gn.len = t, math.min(n.len, (nextEvent(v, e).start - t))
  gn.vel = math.max(1, math.floor(n.vel * 0.55 + 0.5))
  add(v, gn)
  v.touched[e] = true
  return ("%s: ghost %s added"):format(at(v, t), nameOf(v, n))
end

-- A chord filled out: one of its own notes doubled in another octave, inside
-- the chord, so the top and the bass stay where they were.
function MOVES.fill(v)
  local e = pickEvent(v, function(e) return pitched(e) and #e.notes >= 2 end)
  if not e then return nil end
  local have, pcs = {}, {}
  for _, n in ipairs(e.notes) do have[n.pitch], pcs[n.pitch % 12] = true, true end
  local options = {}
  -- Not a note that grinds against anything: a Cmaj7's B doubled low
  -- against its C bass is mud, where its C, E or G doubled is warmth.
  local lens = {}
  for _, n in ipairs(e.notes) do lens[#lens + 1] = n.len end
  table.sort(lens)
  local len = lens[(#lens + 1) // 2]
  for q = e.bass.pitch + 3, e.top.pitch - 3 do
    if pcs[q % 12] and not have[q] and not clashes(v, nil, q, e.bass.start, e.bass.start + len) then
      local near = false
      for _, n in ipairs(e.notes) do if math.abs(n.pitch - q) < 3 then near = true end end
      if not near then options[#options + 1] = q end
    end
  end
  if #options == 0 then return nil end
  local q = choose(v.r, options)
  local vel = 0
  for _, n in ipairs(e.notes) do vel = vel + n.vel end
  local fn = copyNote(e.bass)
  fn.pitch, fn.len = q, len
  fn.vel = math.floor(vel / #e.notes * 0.85 + 0.5)
  add(v, fn)
  v.touched[e] = true
  return ("%s: chord filled out with %s"):format(at(v, e.start), nameOf(v, q))
end

-- A note left out - the weakest-placed, shortest ones first. Sometimes the
-- note before is held over the gap instead of leaving a rest.
function MOVES.drop(v)
  local left = 0
  for _, n in ipairs(v.notes) do if not n.gone then left = left + 1 end end
  if left <= 3 then return nil end
  local u = v.an.unit
  -- A single note, or one drum out of several struck together.
  local e = pickEvent(v, function(e) return #e.notes == 1 or e.drum end, function(e)
    local w = ({ [0] = 1.5, 1.0, 0.6, 0.3 })[e.strength]
    if e.top.len <= u + 1e-6 then w = w * 1.5 end
    return w
  end)
  if not e then return nil end
  local n = e.top
  for _, o in ipairs(e.notes) do if o.vel < n.vel then n = o end end   -- the quietest drum
  n.gone = true
  v.touched[e] = true
  local pv = prevEvent(v, e)
  local text = ("%s: %s left out"):format(at(v, e.start), nameOf(v, n))
  if #e.notes == 1 and not e.drum and pv and not v.touched[pv] and not protected(v, pv) and #pv.notes == 1
     and math.abs(noteEnd(pv.top) - n.start) <= 0.05 and coin(v.r, 0.6) then
    pv.top.len = noteEnd(n) - pv.top.start
    v.touched[pv] = true
    text = text .. (", %s held over it"):format(nameOf(v, pv.top.pitch))
  end
  return text
end

-- A chord thinned: an inner note taken out, a doubled one if there is one.
-- The bass and the top note stay.
function MOVES.thin(v)
  local e = pickEvent(v, isChord)
  if not e then return nil end
  local count, inner, weights = {}, {}, {}
  for _, n in ipairs(e.notes) do count[n.pitch % 12] = (count[n.pitch % 12] or 0) + 1 end
  for i = 2, #e.notes - 1 do
    local n = e.notes[i]
    inner[#inner + 1] = n
    weights[#weights + 1] = count[n.pitch % 12] > 1 and 3 or 1
  end
  local n = choose(v.r, inner, weights)
  if not n then return nil end
  n.gone = true
  v.touched[e] = true
  return ("%s: chord thinned, %s left out"):format(at(v, e.start), nameOf(v, n.pitch))
end

-- A chord revoiced: an inner note moved an octave, staying between the bass
-- and the top so the outline of the music does not change.
function MOVES.revoice(v)
  local e = pickEvent(v, isChord)
  if not e then return nil end
  local have = {}
  for _, n in ipairs(e.notes) do have[n.pitch] = true end
  local options = {}
  for i = 2, #e.notes - 1 do
    local n = e.notes[i]
    for _, d in ipairs({ 12, -12 }) do
      local q = n.pitch + d
      if q > e.bass.pitch and q < e.top.pitch and not have[q]
         and not clashes(v, n, q, n.start, noteEnd(n)) then
        options[#options + 1] = { n = n, q = q }
      end
    end
  end
  if #options == 0 then return nil end
  local o = choose(v.r, options)
  local was = o.n.pitch
  o.n.pitch = o.q
  v.touched[e] = true
  return ("%s: chord revoiced, %s moved %s to %s"):format(at(v, e.start), nameOf(v, was),
    o.q > was and "up" or "down", nameOf(v, o.q))
end

-- A chord rolled - its notes struck one after another, like a strum or a
-- harp, over no more than a sixteenth.
function MOVES.roll(v)
  local e = pickEvent(v, isChord)
  if not e then return nil end
  local notes = live(e)
  local up = coin(v.r, 0.7)
  local gap = math.min(0.25 / #notes, v.an.unit / 4)
  for k, n in ipairs(notes) do
    local i = up and (k - 1) or (#notes - k)
    local ne = noteEnd(n)
    n.start = n.start + i * gap
    n.len = ne - n.start
  end
  v.touched[e] = true
  return ("%s: chord rolled %s"):format(at(v, e.start), up and "upwards" or "downwards")
end

-- A chord coloured: an inner note moved a step (a third to a fourth makes a
-- sus chord, a root to a second an add9), if it grinds against nothing.
function MOVES.colour(v)
  local e = pickEvent(v, isChord)
  if not e then return nil end
  local pcs = {}
  for _, n in ipairs(e.notes) do pcs[n.pitch % 12] = true end
  local options = {}
  for i = 2, #e.notes - 1 do
    local n = e.notes[i]
    for _, dir in ipairs({ 1, -1 }) do
      local q = step(v.an.scale, n.pitch, dir)
      if q and q > e.notes[i - 1].pitch and q < e.notes[i + 1].pitch and not pcs[q % 12]
         and not clashes(v, n, q, n.start, noteEnd(n)) then
        options[#options + 1] = { n = n, q = q }
      end
    end
  end
  if #options == 0 then return nil end
  local o = choose(v.r, options)
  local was = o.n.pitch
  o.n.pitch = o.q
  v.touched[e] = true
  return ("%s: chord coloured, %s to %s"):format(at(v, e.start), nameOf(v, was), nameOf(v, o.q))
end

M.MOVES = MOVES

------------------------------------------------------------------------------
-- Feel
------------------------------------------------------------------------------

local function applyFeel(v, s)
  local r, o = v.r, v.opts
  if s <= 0 then return end
  local span = math.max(v.src.beats - v.src.lead, 1e-9)

  if o.timing then
    -- Each moment moves as one, so a chord stays a chord; its notes get a
    -- hair of their own on top.
    local shift = {}
    for _, n in ipairs(v.notes) do
      local key = n.event or n
      if not shift[key] then
        local d = bell(r) * 2 * M.TIMING_SD * s
        shift[key] = math.max(-M.TIMING_MAX * s, math.min(M.TIMING_MAX * s, d))
      end
      n.start = n.start + shift[key] + (r() - 0.5) * 2 * M.TIMING_CHORD * s
    end
  end

  if o.velocity then
    -- A whole-phrase lift or drop, a slow swell across it, and a little per
    -- note. The accents of the original stay where they were.
    local whole = bell(r) * 2 * M.VEL_WHOLE * s
    local cycles, phase = between(r, 0.5, 1.5), between(r, 0, 2 * math.pi)
    for _, n in ipairs(v.notes) do
      local x = (n.start - v.src.lead) / span
      local swell = M.VEL_SWELL * s * math.sin(2 * math.pi * cycles * x + phase)
      n.vel = n.vel + whole + swell + (r() - 0.5) * 2 * M.VEL_JITTER * s
    end
  end

  if o.lengths then
    -- Played a touch more legato or more detached overall, and each note a
    -- little its own. A note may grow only up to the next moment: a chord
    -- held a little longer must not ring on into the next chord, where its
    -- B would grind against the new chord's C.
    local starts = {}
    for _, n in ipairs(v.notes) do if not n.gone then starts[#starts + 1] = n.start end end
    table.sort(starts)
    local function nextStart(t)
      local lo, hi = 1, #starts + 1
      while lo < hi do
        local mid = (lo + hi) // 2
        if starts[mid] > t then hi = mid else lo = mid + 1 end
      end
      return starts[lo] or math.huge
    end
    local whole = 1 + (r() - 0.5) * 2 * M.LEN_WHOLE * s
    for _, n in ipairs(v.notes) do
      local was = noteEnd(n)
      n.len = n.len * whole * (1 + (r() - 0.5) * 2 * M.LEN_NOTE * s)
      local limit = math.max(was, nextStart(n.start + M.ONSET))
      if noteEnd(n) > limit then n.len = limit - n.start end
    end
  end
end

-- Leaves the notes playable: inside the item, no note shorter than MIN_LEN,
-- no two notes of one pitch on one channel overlapping, velocities 1-127.
-- An overlap the original itself has (two notes it plays exactly as written)
-- is left as it is: a variation does not correct the music it varies.
local function tidy(v)
  local out, same = {}, {}
  for _, n in ipairs(v.notes) do
    if not n.gone then
      local s = math.max(n.start, v.src.lead)
      local e = math.min(noteEnd(n), v.src.beats)
      if e - s >= M.MIN_LEN - 1e-9 then
        local t = {
          pitch = math.max(0, math.min(127, math.floor(n.pitch + 0.5))),
          start = s, len = e - s,
          vel = math.max(1, math.min(127, math.floor(n.vel + 0.5))),
          chan = n.chan or 0,
        }
        local o = n.orig
        same[t] = o and o.pitch == t.pitch and o.start == t.start and o.len == t.len
        out[#out + 1] = t
      end
    end
  end
  table.sort(out, byStart)
  local lastOf, keep = {}, {}
  for _, n in ipairs(out) do
    local k = n.chan * 128 + n.pitch
    local prev = lastOf[k]
    if prev and noteEnd(prev) > n.start + 1e-9 and not (same[prev] and same[n]) then
      prev.len = n.start - prev.start
      if prev.len < M.MIN_LEN then prev.dead = true end
    end
    lastOf[k] = n
  end
  for _, n in ipairs(out) do if not n.dead then keep[#keep + 1] = n end end
  return keep
end

------------------------------------------------------------------------------
-- Making a variation
------------------------------------------------------------------------------

-- How many changes to make: `want` on average, never more than `cap`.
function M.budget(amount, count)
  if amount <= 0 or count == 0 then return 0, 0 end
  local want = amount * (1 + count / M.CHANGES_PER)
  local cap = math.max(1, math.ceil(count * M.CAP_SHARE))
  return want, cap
end

--[[  One variation of the original `src`, analysed as `an`.

      opts: amount (0-1), focus (1-3), keepEnds, and each kind and feel key
            (notes, rhythm, add, remove, chords, timing, velocity, lengths)
            true or false.
      seed: which variation - the same seed always gives the same one.

      history: optional, shared by a series (see `candidates`); added to.

      Returns { notes = {...}, changes = { "Bar 2, beat 3: ...", ... } },
      the changes in the order they happen in the music. ]]
function M.vary(src, an, opts, seed, T, history)
  local r = M.random(seed)
  local v = { src = src, an = an, opts = opts, r = r, T = T, touched = {}, notes = {},
              history = history, move = "" }

  -- Working copies of the original's notes, each remembering its moment.
  local copyOf = {}
  for _, e in ipairs(an.events) do
    local copies = {}
    for i, n in ipairs(e.notes) do
      local c = copyNote(n)
      c.event, c.orig = e, n
      copies[i] = c
      v.notes[#v.notes + 1] = c
    end
    copyOf[e] = copies
  end
  -- The analysis's own events point at the copies while the moves run, so
  -- the original's notes are never touched.
  local saved = {}
  for _, e in ipairs(an.events) do
    saved[e] = { notes = e.notes, top = e.top, bass = e.bass }
    e.notes = copyOf[e]
    e.top, e.bass = e.notes[#e.notes], e.notes[1]
  end

  local amount = math.max(0, math.min(1, opts.amount or 0))
  local want, cap = M.budget(amount, an.count)
  local changes = {}
  local goal = 0
  if want > 0 then goal = math.min(cap, math.max(1, math.floor(want + r()))) end

  local kinds, kindWeights = {}, {}
  for _, k in ipairs(M.KINDS) do
    if opts[k.key] then
      kinds[#kinds + 1] = k
      kindWeights[#kindWeights + 1] = 1
    end
  end

  local tries = 0
  while #changes < goal and #kinds > 0 and tries < 40 do
    tries = tries + 1
    local kind = choose(r, kinds, kindWeights)
    local names, ws = {}, {}
    for _, m in ipairs(kind.moves) do names[#names + 1] = m[1]; ws[#ws + 1] = m[2] end
    local name = choose(r, names, ws)
    v.move, v.chosen = name, nil
    local said = MOVES[name](v)
    if said then
      local e = v.chosen
      changes[#changes + 1] = { text = said, move = name, kind = kind.key, at = e.start, event = e.index }
      if history then
        history["@" .. e.index] = (history["@" .. e.index] or 0) + 1
        history[name .. "@" .. e.index] = (history[name .. "@" .. e.index] or 0) + 1
      end
    end
  end

  for _, e in ipairs(an.events) do
    e.notes, e.top, e.bass = saved[e].notes, saved[e].top, saved[e].bass
  end

  applyFeel(v, math.sqrt(amount))
  local notes = tidy(v)
  table.sort(changes, function(a, b) return a.at < b.at end)
  local texts = {}
  for i, c in ipairs(changes) do texts[i] = c.text end
  return { notes = notes, changes = texts, moves = changes }
end

--[[  A run of variations, each made from the original - never from the one
      before it. With `grow`, the first ones are gentler and the last one
      gets the full amount, so a repeated motif can build. `history` may be
      passed in to carry on from an earlier batch of the same original. ]]
function M.series(src, an, opts, baseSeed, count, T, j, history)
  local out = {}
  history = history or {}
  for i = 1, count do
    local o = opts
    if opts.grow and count > 1 then
      o = {}
      for k, x in pairs(opts) do o[k] = x end
      o.amount = opts.amount * (0.4 + 0.6 * (i - 1) / (count - 1))
    end
    out[i] = M.vary(src, an, o, M.seedFor(baseSeed, i - 1, j), T, history)
  end
  return out
end

--[[  How much of the original a variation keeps: the share of the original's
      notes still there at the same pitch, starting within a sixteenth of
      where they did. ]]
function M.likeness(original, variation)
  if #original == 0 then return 1 end
  local byPitch = {}
  for _, b in ipairs(variation) do
    byPitch[b.pitch] = byPitch[b.pitch] or {}
    table.insert(byPitch[b.pitch], b)
  end
  local used, kept = {}, 0
  for _, a in ipairs(original) do
    for _, b in ipairs(byPitch[a.pitch] or {}) do
      if not used[b] and math.abs(b.start - a.start) <= 0.13 then
        used[b] = true
        kept = kept + 1
        break
      end
    end
  end
  return kept / #original
end

------------------------------------------------------------------------------
-- Keeping the original inside a variation
--
-- Every variation item carries its original's notes, so a variation of a
-- variation is really a fresh variation of the original, and the original
-- can always be put back. Positions are stored from the item's own start,
-- so they hold wherever the item is moved.
------------------------------------------------------------------------------

local function num(x)
  local s = ("%.6f"):format(x):gsub("0+$", ""):gsub("%.$", "")
  return s
end

-- notes: from the item's start. Returns one line of text.
function M.encode(notes, length, name, index)
  local parts = { "MV1", num(length), tostring(index or 0),
                  ((name or ""):gsub("[|\n\r]", " ")) }
  local body = {}
  for _, n in ipairs(notes) do
    body[#body + 1] = table.concat({ n.pitch, num(n.start), num(n.len), n.vel or 100, n.chan or 0 }, ",")
  end
  return table.concat(parts, "|") .. "|" .. table.concat(body, ";")
end

-- The opposite of encode. Returns notes, length, name, index - or nil for
-- anything that is not something encode wrote.
function M.decode(text)
  if type(text) ~= "string" or text:sub(1, 4) ~= "MV1|" then return nil end
  local length, index, name, body = text:match("^MV1|([^|]*)|([^|]*)|([^|]*)|(.*)$")
  length, index = tonumber(length), tonumber(index)
  if not length or not index then return nil end
  local notes = {}
  for chunk in body:gmatch("[^;]+") do
    local p, s, l, vel, c = chunk:match("^(%-?%d+),([^,]+),([^,]+),(%d+),(%d+)$")
    p, s, l, vel, c = tonumber(p), tonumber(s), tonumber(l), tonumber(vel), tonumber(c)
    if not (p and s and l and vel and c) then return nil end
    notes[#notes + 1] = { pitch = p, start = s, len = l, vel = vel, chan = c }
  end
  return notes, length, name, index
end

return M
