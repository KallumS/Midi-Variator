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
  { key = "chords",  name = "Chord voicing",   moves = { { "revoice", 2 }, { "roll", 1 } } },
  { key = "quality", name = "Chord quality",   moves = { { "quality", 4 }, { "colour", 1 }, { "arpeggio", 4 } } },
}
M.FEELS = {
  { key = "timing",   name = "Timing" },
  { key = "velocity", name = "Velocity" },
  { key = "lengths",  name = "Lengths" },
}
M.FOCUS = { "Anywhere", "Towards the end", "Towards the start" }

-- The options a caller starts from. Every kind and feel is on.
function M.defaults()
  -- outside: chord-quality changes may use notes outside the scale.
  -- develop: near 100%, a stretch of the music may be developed (below).
  local o = { amount = 0.35, focus = 1, keepEnds = true, grow = false, outside = false, develop = true }
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
  -- `part`: which item of several varied together (M.combine) it is from.
  return { pitch = n.pitch, start = n.start, len = n.len, vel = n.vel or 100, chan = n.chan or 0, part = n.part }
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
    -- Chords are named by mv_theory's reader, which needs one of its own
    -- keys: the picked one where it has it (C minor names Eb, not D#).
    local seven = T.scaleIndex(M.SCALES[pick.scale].name)
    if seven then an.chordKey = T.key(pick.root, seven) end
    -- The original's own notes stay allowed. After a pivot they are all
    -- in the scale anyway; without one, they are what it still plays.
    an.pcs = {}
    for pc in pairs(sc.pcs) do an.pcs[pc] = true end
    for pc in pairs(played) do an.pcs[pc] = true end
  end

  an.chordKey = an.chordKey or an.heardKey
  an.grid = M.grid(notes)
  an.unit = math.min(an.grid, M.MAX_UNIT)
  an.drums = an.hi < an.lo
  an.broken = M.brokenChords(an, src, T)
  return an
end

--[[  Arpeggiated chords: a bar - or half a bar, where its halves are two
      different chords - whose notes, struck one at a time, spell a chord.
      Every moment a single note; at least ARP_NOTES of them on at least
      three different notes, one of which comes round again (an
      accompaniment goes round its chord; a tune like D F A G does not);
      at least half as many leaps as steps between one note and the next
      (B G F G is an arpeggio, a scale is not); at most one pair of its
      notes a step apart; and ScaleView Pro's reader must find a chord.
      Returns { { t0, t1, events = { index, ... } } }. ]]
M.ARP_NOTES = 4

function M.brokenChords(an, src, T)
  local out = {}
  if not T or an.drums then return out end
  local function window(t0, t1)
    local evs, pitches, pcs, k = {}, {}, {}, 0
    local leaps, steps = 0, 0
    for _, e in ipairs(an.events) do
      if e.start >= t0 - 1e-6 and e.start < t1 - 1e-6 then
        if #e.notes ~= 1 or e.drum then return nil end
        evs[#evs + 1] = e.index
        local p = e.notes[1].pitch
        if #pitches > 0 then
          local d = math.abs(p - pitches[#pitches])
          if d == 1 or d == 2 then steps = steps + 1 elseif d >= 3 then leaps = leaps + 1 end
        end
        pitches[#pitches + 1] = p
        if not pcs[p % 12] then pcs[p % 12], k = true, k + 1 end
      end
    end
    if #evs < M.ARP_NOTES or k < 3 or #evs <= k or leaps * 2 < steps or leaps == 0 then return nil end
    -- A chord spelled out has at most one pair of its notes a step apart
    -- (the seventh and root of Amin7: G A). E G A B is a tune round Em.
    local near = 0
    for a in pairs(pcs) do
      for b in pairs(pcs) do
        local d = (b - a) % 12
        if d == 1 or d == 2 then near = near + 1 end
      end
    end
    if near > 1 then return nil end
    local name, root = T.nameChord(pitches, an.chordKey)
    if not root then return nil end
    return { t0 = t0, t1 = t1, events = evs, name = name }
  end
  local bb = src.barBeats or 4
  local first, last = an.events[1], an.events[#an.events]
  if not first then return out end
  for b = math.floor(first.start / bb + 1e-6), math.floor(last.start / bb + 1e-6) do
    local h1 = window(b * bb, b * bb + bb / 2)
    local h2 = window(b * bb + bb / 2, (b + 1) * bb)
    if h1 and h2 and h1.name ~= h2.name then
      out[#out + 1], out[#out + 2] = h1, h2
    else
      local w = window(b * bb, (b + 1) * bb)
      if w then out[#out + 1] = w
      else
        if h1 then out[#out + 1] = h1 end
        if h2 then out[#out + 1] = h2 end
      end
    end
  end
  return out
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
    local k = (n.part or 0) * 2048 + n.chan * 128 + n.pitch
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
      keep[#keep + 1] = { pitch = n.pitch, start = n.start, len = n.len, vel = n.vel, chan = n.chan, part = n.part }
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

-- The part of the note nearest `q` in pitch, the bass aside: a note added
-- to a chord joins the item that plays the chord, not a bass on its own
-- track (unless the bass is all there is).
local function nearestPart(notes, q)
  local lowest, best
  for _, n in ipairs(notes) do if not lowest or n.pitch < lowest.pitch then lowest = n end end
  for _, n in ipairs(notes) do
    if n ~= lowest and (not best or math.abs(n.pitch - q) < math.abs(best.pitch - q)) then best = n end
  end
  return (best or lowest) and (best or lowest).part
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
  fn.part = nearestPart(e.notes, q)
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

--[[  Changing a chord's quality: one small step to a neighbouring chord.

      The chord is read by ScaleView Pro's chord reader (mv_theory.nameChord),
      which gives its root. Each rule says which intervals above the root
      must be there (`needs`) and must not (`lacks`), and then does one
      thing - or, for the eleventh, two:

        add   a new chord tone (C -> C7, Cmaj7, C6, Cadd9; C7 -> C9, C13, C7b9)
        move  a chord tone a semitone or a tone (sus, minor <-> major,
              Cmin -> Cdim, C -> Caug, Cmin7b5 -> Cdim7)
        drop  a chord tone (C7 -> C)

      Every note a rule would add must be in the scale unless the
      "Chord changes may leave the scale" box is ticked (opts.outside).
      The bass is never moved or dropped, and a dropped note is never the
      top one, so the chord keeps its footing and its outline. ]]
M.QUALITY_RULES = {
  { needs = { 0, 4, 7 }, lacks = { 9, 10, 11 }, add = 10 },              -- C -> C7
  { needs = { 0, 3, 7 }, lacks = { 9, 10, 11 }, add = 10 },              -- Cmin -> Cmin7
  { needs = { 0, 4, 7 }, lacks = { 9, 10, 11 }, add = 11 },              -- C -> Cmaj7
  { needs = { 0, 4, 7 }, lacks = { 9, 10, 11 }, add = 9 },               -- C -> C6
  { needs = { 0, 3, 7 }, lacks = { 9, 10, 11 }, add = 9 },               -- Cmin -> Cmin6
  { needs = { 0, 4, 7 }, lacks = { 1, 2, 3 }, add = 2 },                 -- Cadd9, C9, Cmaj9
  { needs = { 0, 3, 7, 10 }, lacks = { 1, 2 }, add = 2 },                -- Cmin7 -> Cmin9
  { needs = { 0, 3, 10 }, lacks = { 4, 5 }, add = 5 },                   -- Cmin7 -> Cmin11
  { needs = { 0, 4, 10 }, lacks = { 8, 9 }, add = 9 },                   -- C7 -> C13
  { needs = { 0, 4, 10 }, lacks = { 1, 2, 3 }, add = 1, rub = true },    -- C7 -> C7b9
  { needs = { 0, 4, 7, 10 }, lacks = { 2, 5 }, move = { 4, 5 }, add = 2 }, -- C7 -> C11
  { needs = { 0, 4, 7 }, lacks = { 5 }, move = { 4, 5 } },               -- C -> Csus4, C7 -> C7sus4
  { needs = { 0, 3, 7 }, lacks = { 5 }, move = { 3, 5 } },               -- Cmin -> Csus4
  { needs = { 0, 4, 7 }, lacks = { 2 }, move = { 4, 2 } },               -- C -> Csus2
  { needs = { 0, 3, 7 }, lacks = { 2 }, move = { 3, 2 } },               -- Cmin -> Csus2
  { needs = { 0, 5, 7 }, lacks = { 3, 4 }, move = { 5, 4 } },            -- Csus4 -> C
  { needs = { 0, 5, 7 }, lacks = { 3, 4 }, move = { 5, 3 } },            -- Csus4 -> Cmin
  { needs = { 0, 2, 7 }, lacks = { 3, 4 }, move = { 2, 4 } },            -- Csus2 -> C
  { needs = { 0, 2, 7 }, lacks = { 3, 4 }, move = { 2, 3 } },            -- Csus2 -> Cmin
  { needs = { 0, 4, 7 }, lacks = { 3 }, move = { 4, 3 } },              -- C -> Cmin
  { needs = { 0, 3, 7 }, lacks = { 4 }, move = { 3, 4 } },               -- Cmin -> C
  { needs = { 0, 3, 7 }, lacks = { 6, 11 }, move = { 7, 6 } },           -- Cmin -> Cdim, Cmin7 -> Cmin7b5
  { needs = { 0, 4, 7 }, lacks = { 8, 9, 10 }, move = { 7, 8 } },        -- C -> Caug
  { needs = { 0, 3, 6 }, lacks = { 9, 10, 11 }, add = 9 },               -- Cdim -> Cdim7
  { needs = { 0, 3, 6 }, lacks = { 9, 10, 11 }, add = 10 },              -- Cdim -> Cmin7b5
  { needs = { 0, 3, 6, 10 }, lacks = { 9 }, move = { 10, 9 } },          -- Cmin7b5 -> Cdim7
  { needs = { 0, 3, 6, 9 }, lacks = { 10 }, move = { 9, 10 } },          -- Cdim7 -> Cmin7b5
  { needs = { 0, 4, 10 }, lacks = {}, drop = 10 },                       -- C7 -> C
  { needs = { 0, 3, 10 }, lacks = {}, drop = 10 },                       -- Cmin7 -> Cmin
  { needs = { 0, 4, 11 }, lacks = {}, drop = 11 },                       -- Cmaj7 -> C
}

local function pitchesOf(e)
  local out = {}
  for _, n in ipairs(e.notes) do if not n.gone and not isDrum(n) then out[#out + 1] = n.pitch end end
  table.sort(out)
  return out
end

-- The same chord struck again and again (a strummed bar) is one chord: it
-- changes as one, or one strike in four would sound like a wrong note.
local function chordRun(v, e)
  local key = table.concat(pitchesOf(e), ",")
  local run = { e }
  for dir = -1, 1, 2 do
    local i = e.index + dir
    while v.an.events[i] do
      local o = v.an.events[i]
      if v.touched[o] or protected(v, o) or table.concat(pitchesOf(o), ",") ~= key then break end
      if dir < 0 then table.insert(run, 1, o) else run[#run + 1] = o end
      i = i + dir
    end
  end
  return run
end

-- Is `q` a pitch the chord can take? Not already there, and - unless the
-- rule is the b9, whose rub is the point - no semitone against a chord note.
local function fits(q, pitches, rub)
  for _, x in ipairs(pitches) do
    if x == q then return false end
    if not rub and math.abs(x - q) == 1 then return false end
  end
  return q >= 0 and q <= 127
end

--[[  How `rule` changes the chord `pitches` (low to high) on `root`: a map
      of old pitch -> new pitch, pitches to add, pitches to drop - or nil if
      it cannot be done without moving the bass or the outline. ]]
local function plan(rule, pitches, root, blockChord)
  local bass, top = pitches[1], pitches[#pitches]
  local moves, adds, drops = {}, {}, {}
  local now = {}
  for i, p in ipairs(pitches) do now[i] = p end

  if rule.move then
    local f, t = rule.move[1], rule.move[2]
    local d = ((t - f + 6) % 12) - 6
    local any = false
    for i, p in ipairs(pitches) do
      if (p - root) % 12 == f then
        if i == 1 then return nil end            -- the bass stays
        moves[p] = p + d
        now[i] = p + d
        any = true
      end
    end
    if not any then return nil end
  end

  if rule.drop then
    for i, p in ipairs(pitches) do
      if (p - root) % 12 == rule.drop then
        if i == 1 or i == #pitches then return nil end   -- bass and top stay
        drops[p] = true
      end
    end
    if #pitches - (function() local k = 0; for _ in pairs(drops) do k = k + 1 end; return k end)() < 3 then
      return nil
    end
  end

  if rule.add then
    local pc = (root + rule.add) % 12
    local others = {}
    for _, p in ipairs(now) do if not drops[p] then others[#others + 1] = p end end
    local place
    -- Inside the chord, as high as it will go: an added ninth or seventh
    -- belongs near the top, where a low one would muddy the bass.
    for q = top - 1, bass + 1, -1 do
      if q % 12 == pc and fits(q, others, rule.rub) then place = q; break end
    end
    -- Or a doubled inner note becomes the new one - the doubled root of a
    -- triad is the note a seventh classically replaces.
    if not place then
      local count = {}
      for _, p in ipairs(others) do count[p % 12] = (count[p % 12] or 0) + 1 end
      for i = 2, #pitches - 1 do
        local p = pitches[i]
        if not moves[p] and count[p % 12] > 1 then
          for d = -6, 6 do
            local q = p + d
            local rest = {}
            for _, x in ipairs(others) do if x ~= p then rest[#rest + 1] = x end end
            if q % 12 == pc and q > bass and q < top and fits(q, rest, rule.rub) then
              moves[p], place = q, nil
              return { moves = moves, adds = adds, drops = drops }
            end
          end
        end
      end
    end
    -- Or, for a block chord with no tune on top of it, just above the top.
    if not place and blockChord then
      for q = top + 1, top + 12 do
        if q % 12 == pc and fits(q, others, rule.rub) then place = q; break end
      end
    end
    if not place then return nil end
    adds[#adds + 1] = place
  end
  return { moves = moves, adds = adds, drops = drops }
end

-- A block chord: every note struck together and held alike, so the top note
-- is part of the chord, not a tune riding on it.
local function isBlock(e)
  local s, l = e.notes[1].start, e.notes[1].len
  for _, n in ipairs(e.notes) do
    if math.abs(n.start - s) > M.ONSET or math.abs(n.len - l) > 0.05 then return false end
  end
  return true
end

function MOVES.quality(v)
  if not v.T or not v.an.chordKey then return nil end
  local e = pickEvent(v, isChord)
  if not e then return nil end
  local pitches = pitchesOf(e)
  local before, root = v.T.nameChord(pitches, v.an.chordKey)
  if not root then return nil end
  local has = {}
  for _, p in ipairs(pitches) do has[(p - root) % 12] = true end

  local rules = {}
  for _, rule in ipairs(M.QUALITY_RULES) do
    local ok = true
    for _, iv in ipairs(rule.needs) do if not has[iv] then ok = false end end
    for _, iv in ipairs(rule.lacks) do if has[iv] then ok = false end end
    if ok and not v.opts.outside then
      local new = {}
      if rule.add then new[#new + 1] = rule.add end
      if rule.move then new[#new + 1] = rule.move[2] end
      for _, iv in ipairs(new) do
        if not v.an.pcs[(root + iv) % 12] then ok = false end
      end
    end
    if ok then rules[#rules + 1] = rule end
  end

  local run = chordRun(v, e)
  local span0, span1 = math.huge, -math.huge
  for _, ev in ipairs(run) do
    for _, n in ipairs(ev.notes) do
      span0, span1 = math.min(span0, n.start), math.max(span1, noteEnd(n))
    end
  end
  local inRun = {}
  for _, ev in ipairs(run) do for _, n in ipairs(ev.notes) do inRun[n] = true end end

  -- Nothing it adds or moves may grind against the tune or anything else
  -- sounding over the chord.
  local function outsideClash(q)
    for _, o in ipairs(v.notes) do
      if not inRun[o] and not o.gone and not isDrum(o)
         and o.start < span1 - 1e-6 and noteEnd(o) > span0 + 1e-6
         and (harsh(q, o.pitch) or q == o.pitch) then
        return true
      end
    end
    return false
  end

  while #rules > 0 do
    local rule, i = choose(v.r, rules)
    table.remove(rules, i)
    local p = plan(rule, pitches, root, isBlock(e))
    local ok = p ~= nil
    if ok then
      for _, q in pairs(p.moves) do if outsideClash(q) then ok = false end end
      for _, q in ipairs(p.adds) do if outsideClash(q) then ok = false end end
    end
    if ok then
      local after = {}
      for _, x in ipairs(pitches) do
        if not p.drops[x] then after[#after + 1] = p.moves[x] or x end
      end
      for _, q in ipairs(p.adds) do after[#after + 1] = q end
      table.sort(after)
      local name = v.T.nameChord(after, v.an.chordKey)
      if name ~= before then
        for _, ev in ipairs(run) do
          local vel, lens = 0, {}
          for _, n in ipairs(ev.notes) do
            if p.drops[n.pitch] then n.gone = true
            elseif p.moves[n.pitch] then n.pitch = p.moves[n.pitch] end
            vel = vel + n.vel
            lens[#lens + 1] = n.len
          end
          table.sort(lens)
          for _, q in ipairs(p.adds) do
            local an = copyNote(ev.bass)
            an.pitch, an.len = q, lens[(#lens + 1) // 2]
            an.part = nearestPart(ev.notes, q)
            an.vel = math.floor(vel / #ev.notes * 0.85 + 0.5)
            add(v, an)
          end
          v.touched[ev] = true
        end
        local times = #run > 1 and (", all %d times it is struck"):format(#run) or ""
        return ("%s: %s became %s%s"):format(at(v, e.start), before, name, times)
      end
    end
  end
  return nil
end

-- "Bar 3" or "Bars 3-4" (or half bars, "Bar 2, second half").
local function spanName(v, t0, t1)
  local bb = v.src.barBeats
  local b0, b1 = math.floor(t0 / bb + 1e-6), math.floor(t1 / bb - 1e-6)
  local half = (t1 - t0) < bb - 1e-6
  if b0 == b1 then
    if half and math.abs(t0 - b0 * bb) > 1e-6 then return ("Bar %d, second half"):format(b0 + 1) end
    if half then return ("Bar %d, first half"):format(b0 + 1) end
    return ("Bar %d"):format(b0 + 1)
  end
  return ("Bars %d-%d"):format(b0 + 1, b1 + 1)
end

--[[  An arpeggiated chord changed in quality: the same rules, applied to
      a chord whose notes come one at a time (M.brokenChords).

        move  every note of that chord tone moves, wherever it is played
        add   a doubled note - not the lowest - becomes the new tone, at
              the nearest pitch that fits (A C E A becomes A C E G: Amin7)
        drop  every note of that tone becomes the nearest chord note left

      The lowest note is the bass and never changes; a protected note (the
      first or last of the phrase) never changes; nothing grinds against
      notes outside the arpeggio. The same arpeggio in the bars straight
      after (or before) changes with it, as a repeated chord does. ]]
function MOVES.arpeggio(v)
  if not v.T or not v.an.chordKey or #v.an.broken == 0 then return nil end
  local evs = v.an.events
  local function pitchesIn(w)
    local ps = {}
    for _, i in ipairs(w.events) do
      local n = evs[i].notes[1]
      if n.gone then return nil end
      ps[#ps + 1] = n.pitch
    end
    return ps
  end
  local function key(w)
    local ps = pitchesIn(w)
    if not ps then return nil end
    return table.concat(ps, ",")
  end

  local list, weights = {}, {}
  local h = v.history or {}
  for wi, w in ipairs(v.an.broken) do
    local free = true
    for _, i in ipairs(w.events) do if v.touched[evs[i]] then free = false end end
    if free and key(w) then
      local e = evs[w.events[1]]
      list[#list + 1] = wi
      weights[#weights + 1] = focusWeight(v, e) / (1 + 2 * (h["arpeggio@" .. e.index] or 0))
    end
  end
  if #list == 0 then return nil end
  local wi = choose(v.r, list, weights)
  local w = v.an.broken[wi]

  -- The run: the same notes in the same order, in the windows next to it.
  local run = { w }
  local k = key(w)
  for dir = -1, 1, 2 do
    local j = wi + dir
    while v.an.broken[j] do
      local o = v.an.broken[j]
      local touching = dir > 0 and math.abs(o.t0 - run[#run].t1) < 1e-6 or math.abs(o.t1 - run[1].t0) < 1e-6
      local free = true
      for _, i in ipairs(o.events) do if v.touched[evs[i]] then free = false end end
      if not touching or not free or key(o) ~= k then break end
      if dir < 0 then table.insert(run, 1, o) else run[#run + 1] = o end
      j = j + dir
    end
  end

  local pitches = pitchesIn(w)
  local set, distinct = {}, {}
  for _, p in ipairs(pitches) do
    if not set[p] then set[p] = true; distinct[#distinct + 1] = p end
  end
  table.sort(distinct)
  local before, root = v.T.nameChord(distinct, v.an.chordKey)
  if not root then return nil end
  local bass = distinct[1]
  local has, count = {}, {}
  for _, p in ipairs(distinct) do has[(p - root) % 12] = true end
  for _, p in ipairs(pitches) do count[p % 12] = (count[p % 12] or 0) + 1 end
  -- How many different pitches carry each pitch class: a doubled one can
  -- give one of its pitches to a new note.
  local spread = {}
  for _, p in ipairs(distinct) do spread[p % 12] = (spread[p % 12] or 0) + 1 end

  local inRun, protectedNote = {}, {}
  local span0, span1 = math.huge, -math.huge
  for _, rw in ipairs(run) do
    for _, i in ipairs(rw.events) do
      local n = evs[i].notes[1]
      inRun[n] = true
      if protected(v, evs[i]) then protectedNote[n] = true end
      span0, span1 = math.min(span0, n.start), math.max(span1, noteEnd(n))
    end
  end
  local function outsideClash(q, n)
    for _, o in ipairs(v.notes) do
      if not inRun[o] and not o.gone and not isDrum(o)
         and o.start < noteEnd(n) - 1e-6 and noteEnd(o) > n.start + 1e-6
         and (harsh(q, o.pitch) or q == o.pitch) then
        return true
      end
    end
    return false
  end

  local rules = {}
  for _, rule in ipairs(M.QUALITY_RULES) do
    local ok = true
    for _, iv in ipairs(rule.needs) do if not has[iv] then ok = false end end
    for _, iv in ipairs(rule.lacks) do if has[iv] then ok = false end end
    if ok and not v.opts.outside then
      local new = {}
      if rule.add then new[#new + 1] = rule.add end
      if rule.move then new[#new + 1] = rule.move[2] end
      for _, iv in ipairs(new) do if not v.an.pcs[(root + iv) % 12] then ok = false end end
    end
    if ok then rules[#rules + 1] = rule end
  end

  while #rules > 0 do
    local rule, ri = choose(v.r, rules)
    table.remove(rules, ri)
    -- old pitch -> new pitch, for every distinct pitch of the arpeggio;
    -- and, for an add with nothing doubled, every other strike of the
    -- note struck most often (C G E G becomes C G E B).
    local map, every, ok = {}, nil, true
    if rule.move then
      local f, t = rule.move[1], rule.move[2]
      local d = ((t - f + 6) % 12) - 6
      local any = false
      for _, p in ipairs(distinct) do
        if (p - root) % 12 == f then
          if p == bass then ok = false end
          map[p], any = p + d, true
        end
      end
      if not any then ok = false end
    end
    if ok and rule.drop then
      local left = {}
      for _, p in ipairs(distinct) do if (p - root) % 12 ~= rule.drop then left[#left + 1] = p end end
      local pcsLeft, kinds = {}, 0
      for _, p in ipairs(left) do if not pcsLeft[p % 12] then pcsLeft[p % 12], kinds = true, kinds + 1 end end
      if kinds < 3 then ok = false end
      for _, p in ipairs(distinct) do
        if ok and (p - root) % 12 == rule.drop then
          if p == bass then ok = false; break end
          local best
          for _, q in ipairs(left) do
            if not best or math.abs(q - p) < math.abs(best - p) or (math.abs(q - p) == math.abs(best - p) and q > best) then
              best = q
            end
          end
          map[p] = best
        end
      end
    end
    local place
    if ok and rule.add then
      local pc = (root + rule.add) % 12
      local now = {}
      for _, p in ipairs(distinct) do now[#now + 1] = map[p] or p end
      -- The highest doubled pitch (not the bass) gives way to the new tone;
      -- with none doubled, every other strike of the commonest one does.
      local given
      for i = #distinct, 2, -1 do
        local p = distinct[i]
        if not map[p] and spread[p % 12] > 1 then given = p; break end
      end
      local struck = {}
      for _, p in ipairs(pitches) do struck[p] = (struck[p] or 0) + 1 end
      local others = {}
      if not given then
        local most = 1
        for i = 2, #distinct do
          local p = distinct[i]
          if not map[p] and struck[p] > most then given, most, every = p, struck[p], true end
        end
      end
      if not given then ok = false
      else
        for _, p in ipairs(now) do if every or p ~= given then others[#others + 1] = p end end
        for d = 0, 6 do
          for _, q in ipairs({ given - d, given + d }) do
            if not place and q % 12 == pc and q > bass and fits(q, others, rule.rub) then place = q end
          end
        end
        if not place then ok = false elseif not every then map[given] = place end
      end
      if ok and every then
        -- Every other strike of `given`, counted through the window.
        every = { pitch = given, to = place }
      end
    end
    if ok and (next(map) or every) then
      -- The window's notes in time order, and what each becomes; every
      -- window of the run plays the same notes, so the same plan fits all.
      local function plan(rw)
        local out, seenGiven = {}, 0
        for k2, i in ipairs(rw.events) do
          local p = evs[i].notes[1].pitch
          local q = map[p] or p
          if every and p == every.pitch then
            seenGiven = seenGiven + 1
            if seenGiven % 2 == 0 then q = every.to end
          end
          out[k2] = q
        end
        return out
      end
      local after, seen = {}, {}
      for _, q in ipairs(plan(w)) do
        if not seen[q] then seen[q] = true; after[#after + 1] = q end
      end
      table.sort(after)
      local name = v.T.nameChord(after, v.an.chordKey)
      if name == before then ok = false end
      for _, rw in ipairs(run) do
        local pl = plan(rw)
        for k2, i in ipairs(rw.events) do
          local n = evs[i].notes[1]
          if pl[k2] ~= n.pitch and (protectedNote[n] or outsideClash(pl[k2], n)) then ok = false end
        end
      end
      if ok then
        for _, rw in ipairs(run) do
          local pl = plan(rw)
          for k2, i in ipairs(rw.events) do evs[i].notes[1].pitch = pl[k2] end
          for _, i in ipairs(rw.events) do v.touched[evs[i]] = true end
        end
        v.chosen = evs[w.events[1]]
        local times = #run > 1 and (", all %d times it is played"):format(#run) or ""
        return ("%s: the arpeggio %s became %s%s"):format(spanName(v, w.t0, w.t1), before, name, times)
      end
    end
  end
  return nil
end

M.MOVES = MOVES

------------------------------------------------------------------------------
-- Developing the motif
--
-- Near the top of the amount slider a variation may do something bigger to
-- one stretch of the music - the ways a composer brings a motif back
-- changed (Hutchinson, ch. 11; Good Idea's sequence and fragment):
--
--   invert      the tune turned upside down, mirrored in the scale
--   retrograde  the notes in reverse order, in the same rhythm
--   transpose   the stretch moved up or down the scale - a sequence
--   stretch     its intervals widened (steps become thirds)
--   squeeze     its intervals narrowed (leaps become steps)
--   fragment    its first half again, a step lower, in place of the rest
--
-- Everything moves by scale positions, so a moved tune stays in the key.
-- The rhythm stays (but for fragment, which repeats the first half's), so
-- the motif is still recognisable by its rhythm. With chords under a tune,
-- only the tune is inverted, reversed or stretched, and each of its notes
-- is nudged to the nearest scale note that does not grind and stays on
-- top; a sequence moves everything. One change, covering every moment in
-- the stretch - nothing else changes inside it.
------------------------------------------------------------------------------

-- Develop starts above this amount, and its chance of happening in a
-- variation rises from the first number just above it to the second at 100%.
M.DEVELOP_FROM = 0.7
M.DEVELOP_CHANCE = { 0.15, 0.9 }
-- How far a developed stretch may leave the original's range, in semitones.
M.DEVELOP_ROOM = 5
M.DEVELOP = { key = "develop", name = "Develop",
              moves = { { "invert", 2 }, { "retrograde", 2 }, { "transpose", 3 },
                        { "stretch", 1.5 }, { "squeeze", 1 }, { "fragment", 1.5 } } }

-- The scale as a ladder of positions: position s is pitch `rung(L, s)`.
-- A third above anything is two positions up, in any seven-note scale.
local function ladder(an)
  local L = {}
  for pc = 0, 11 do if an.scale[pc] then L[#L + 1] = pc end end
  if #L < 2 then
    L = {}
    for pc = 0, 11 do if an.pcs[pc] then L[#L + 1] = pc end end
  end
  return L
end
local function rung(L, s) return (s // #L) * 12 + L[s % #L + 1] end
-- A pitch's position, and how far above it the pitch is (1 for a raised
-- seventh between two scale notes, so it can be carried along).
local function posOf(L, p)
  local oct, pc = p // 12, p % 12
  local i
  for k = #L, 1, -1 do if L[k] <= pc then i = k; break end end
  if not i then oct, i = oct - 1, #L end
  local s = oct * #L + (i - 1)
  return s, p - rung(L, s)
end
-- Back from a position, with the offset kept where the scale allows it.
local function fromPos(v, L, s, off)
  local q = rung(L, s) + (off or 0)
  if off and off ~= 0 and not v.an.pcs[q % 12] then q = q - off end
  return q
end

local INTERVAL_NAMES = { [0] = "", "a semitone", "a step", "a third", "a third", "a fourth",
                         "a tritone", "a fifth", "a sixth", "a sixth", "a seventh", "a seventh", "an octave" }
-- How far a move of `s` positions is, by name: counted in scale steps in a
-- seven-note scale (E to F is a step, not "a semitone"), else by the
-- semitones the first note moved, `d`.
local STEP_NAMES = { "a step", "a third", "a fourth", "a fifth", "a sixth", "a seventh", "an octave" }
local function distance(L, s, d)
  if #L == 7 and STEP_NAMES[math.abs(s)] then return STEP_NAMES[math.abs(s)] end
  return INTERVAL_NAMES[math.min(12, math.abs(d))]
end

-- The moments of [t0, t1) a develop may change, and the pitched notes of
-- each that sound (the tune is the top one).
local function spanMoments(v, t0, t1)
  local out = {}
  for _, e in ipairs(v.an.events) do
    if e.start >= t0 - 1e-6 and e.start < t1 - 1e-6 and not e.drum
       and not v.touched[e] and not protected(v, e) then
      local ns = {}
      for _, n in ipairs(e.notes) do if not n.gone and not isDrum(n) then ns[#ns + 1] = n end end
      if #ns > 0 then
        table.sort(ns, function(a, b) return a.pitch < b.pitch end)
        local m = { e = e, notes = ns, top = ns[#ns] }
        -- A moment whose top note is under something still held from
        -- before (a walking bass under a held chord) is not the tune.
        for _, o in ipairs(v.notes) do
          if not o.gone and not isDrum(o) and o.event ~= e and o.start < e.start - 1e-6
             and noteEnd(o) > e.start + 1e-6 and o.pitch > m.top.pitch then
            m.under = true
          end
        end
        out[#out + 1] = m
      end
    end
  end
  return out
end

local function inRange(v, q)
  return q >= v.an.lo - M.DEVELOP_ROOM and q <= v.an.hi + M.DEVELOP_ROOM and q >= 0 and q <= 127
end

-- How far a set of pitches overshoots the range allowed: 0 if it fits.
local function overshoot(v, qs)
  local over = 0
  for _, q in ipairs(qs) do
    over = math.max(over, (v.an.lo - M.DEVELOP_ROOM) - q, q - (v.an.hi + M.DEVELOP_ROOM))
  end
  return over
end

--[[  New pitches for the tune of a stretch, one per moment, given as scale
      positions (with the offset each note had). Each is placed if it
      grinds against nothing and stays above the rest of its moment;
      otherwise the nearest position that does, up to two away; otherwise
      the note keeps its pitch. Fails, changing nothing, if more than a
      third of the notes could not take their place, or nothing changed. ]]
local function placeTune(v, L, line, targets)
  local was, kept, changed = {}, 0, 0
  local isTune = {}
  for i, m in ipairs(line) do was[i] = m.top.pitch; isTune[m.top] = true end
  for i, m in ipairs(line) do
    local n = m.top
    -- Everything else sounding when it is struck - its own chord, or one
    -- held from before - stays under it.
    local below = -1
    for _, o in ipairs(v.notes) do
      if not isTune[o] and not o.gone and not isDrum(o)
         and o.start <= n.start + M.ONSET and noteEnd(o) > n.start + 1e-6 then
        below = math.max(below, o.pitch)
      end
    end
    local function good(q)
      return inRange(v, q) and q > below
         and not clashes(v, n, q, n.start, noteEnd(n))
    end
    local s, off = targets[i][1], targets[i][2]
    local placed
    for _, d in ipairs({ 0, 1, -1, 2, -2 }) do
      local q = fromPos(v, L, s + d, off)
      if good(q) then placed = q; break end
    end
    if placed then
      if placed ~= n.pitch then changed = changed + 1 end
      n.pitch = placed
    else
      kept = kept + 1
    end
  end
  if changed == 0 or kept * 3 > #line then
    for i, m in ipairs(line) do m.top.pitch = was[i] end
    return false
  end
  return true
end

local DEVELOP = {}

-- The moments of a stretch that carry the tune.
local function tune(line)
  local out = {}
  for _, m in ipairs(line) do if not m.under then out[#out + 1] = m end end
  return out
end

-- The tune mirrored in the scale around its first note - or, if that
-- would leave the range, around its middle.
function DEVELOP.invert(v, L, line)
  line = tune(line)
  if #line < 3 then return nil end
  local pos, lo, hi = {}, math.huge, -math.huge
  for i, m in ipairs(line) do
    local s, off = posOf(L, m.top.pitch)
    pos[i] = { s, off }
    lo, hi = math.min(lo, s), math.max(hi, s)
  end
  local best, bestCost
  for k, axis in ipairs({ pos[1][1], (lo + hi) // 2 }) do
    local qs = {}
    for i, p in ipairs(pos) do qs[i] = fromPos(v, L, 2 * axis - p[1], -p[2]) end
    local cost = overshoot(v, qs) * 100 + (k - 1)
    if not bestCost or cost < bestCost then best, bestCost = axis, cost end
  end
  if bestCost >= 100 then return nil end
  local targets = {}
  for i, p in ipairs(pos) do targets[i] = { 2 * best - p[1], -p[2] } end
  local around = v.T and M.noteName(v.an, line[1].top.pitch, v.T) or "its first note"
  if not placeTune(v, L, line, targets) then return nil end
  if best ~= pos[1][1] then return "the tune turned upside down" end
  return ("the tune turned upside down around its first note, %s"):format(around)
end

-- The notes in reverse order, each keeping the place in the rhythm.
function DEVELOP.retrograde(v, L, line)
  line = tune(line)
  if #line < 3 then return nil end
  local targets = {}
  for i = 1, #line do
    local s, off = posOf(L, line[#line + 1 - i].top.pitch)
    targets[i] = { s, off }
  end
  if not placeTune(v, L, line, targets) then return nil end
  return "the notes played in reverse order, in the same rhythm"
end

-- Intervals from the first note multiplied: widened (x2) or narrowed (x0.5,
-- every step still going the way it went).
local function scaleIntervals(v, L, line, factor)
  line = tune(line)
  if #line < 3 then return nil end
  local pos = {}
  for i, m in ipairs(line) do pos[i] = { posOf(L, m.top.pitch) } end
  local anchor = pos[1][1]
  local function target(p)
    local d = p[1] - anchor
    local nd = d * factor
    if factor < 1 then
      nd = (d > 0) and math.max(1, math.floor(nd + 0.5)) or (d < 0 and math.min(-1, -math.floor(-nd + 0.5)) or 0)
    end
    return anchor + nd
  end
  local targets, qs, differs = {}, {}, false
  for i, p in ipairs(pos) do
    targets[i] = { target(p), p[2] }
    qs[i] = fromPos(v, L, targets[i][1], p[2])
    if targets[i][1] ~= p[1] then differs = true end
  end
  if not differs or overshoot(v, qs) > 0 then return nil end
  return placeTune(v, L, line, targets)
end

function DEVELOP.stretch(v, L, line)
  if not scaleIntervals(v, L, line, 2) then return nil end
  return "its intervals widened - steps become thirds"
end

function DEVELOP.squeeze(v, L, line)
  if not scaleIntervals(v, L, line, 0.5) then return nil end
  return "its intervals narrowed - leaps become steps"
end

-- How many pairs of these notes grind while sounding together, at their
-- pitches now or at `new` pitches. A sequence moves by scale steps, and a
-- step is not always the same size: D under E moved up a step is E under
-- F. So it may not add a grinding pair - inside a chord, or between a
-- held chord and the tune over it.
local function harshPairs(notes, new)
  local k = 0
  for i = 1, #notes do
    for j = i + 1, #notes do
      local a, b = notes[i], notes[j]
      if a.start < noteEnd(b) - 1e-6 and b.start < noteEnd(a) - 1e-6 then
        local pa = new and new[a] or a.pitch
        local pb = new and new[b] or b.pitch
        if harsh(pa, pb) or (new and pa == pb and a.pitch ~= b.pitch) then k = k + 1 end
      end
    end
  end
  return k
end

-- Everything in the stretch moved up or down the scale: a sequence.
-- Chords move with the tune. The shift (or an octave either side of it)
-- that stays in range and moves least is used (Good Idea's bestShift).
function DEVELOP.transpose(v, L, line)
  local inLine = {}
  for _, m in ipairs(line) do for _, n in ipairs(m.notes) do inLine[n] = true end end
  local shifts, weights = { 1, -1, 2, -2, 4, -3 }, { 2, 1.5, 1, 1, 1.5, 1 }
  while #shifts > 0 do
    local k, i = choose(v.r, shifts, weights)
    table.remove(shifts, i); table.remove(weights, i)
    local best, bestCost
    for _, s in ipairs({ k, k - #L, k + #L }) do
      local qs = {}
      for _, m in ipairs(line) do
        for _, n in ipairs(m.notes) do
          local p, off = posOf(L, n.pitch)
          qs[#qs + 1] = fromPos(v, L, p + s, off)
        end
      end
      local cost = overshoot(v, qs) * 100 + math.abs(s)
      if not bestCost or cost < bestCost then best, bestCost = s, cost end
    end
    if best ~= 0 and bestCost < 100 then
      local new, moved = {}, {}
      for _, m in ipairs(line) do
        for _, n in ipairs(m.notes) do
          local p, off = posOf(L, n.pitch)
          new[n] = fromPos(v, L, p + best, off)
          moved[#moved + 1] = n
        end
      end
      local ok = harshPairs(moved, new) <= harshPairs(moved)
      -- Nothing outside the stretch that sounds with it may grind against
      -- the moved notes, or be doubled by one.
      if ok then
        for n, q in pairs(new) do
          for _, o in ipairs(v.notes) do
            if not inLine[o] and not o.gone and not isDrum(o)
               and o.start < noteEnd(n) - 1e-6 and noteEnd(o) > n.start + 1e-6
               and (o.pitch == q or (harsh(q, o.pitch) and not harsh(n.pitch, o.pitch))) then
              ok = false
            end
          end
        end
      end
      if ok then
        local d = new[line[1].top] - line[1].top.pitch
        for n, q in pairs(new) do n.pitch = q end
        local what = #line[1].notes > 1 and "the music" or "the tune"
        return ("%s moved %s %s - a sequence"):format(what, best > 0 and "up" or "down", distance(L, best, d))
      end
    end
  end
  return nil
end

-- The first half of the stretch again, a step lower (or higher), in place
-- of the second half: a melody only, and only where every moment of the
-- stretch is free to change.
function DEVELOP.fragment(v, L, line, t0, t1)
  local half = (t1 - t0) / 2
  if half < v.an.unit * 2 - 1e-6 then return nil end
  for _, e in ipairs(v.an.events) do
    if e.start >= t0 - 1e-6 and e.start < t1 - 1e-6 and (v.touched[e] or protected(v, e) or e.drum) then
      return nil
    end
  end
  local first, second = {}, {}
  for _, m in ipairs(line) do
    if #m.notes > 1 then return nil end
    if m.e.start < t0 + half - 1e-6 then first[#first + 1] = m else second[#second + 1] = m end
  end
  if #first < 2 or #second < 1 then return nil end
  -- Nothing else may be sounding: a melody alone.
  for _, o in ipairs(v.notes) do
    if not o.gone and o.start < t1 - 1e-6 and noteEnd(o) > t0 + 1e-6 then
      local mine = false
      for _, m in ipairs(line) do if m.top == o then mine = true end end
      if not mine then return nil end
    end
  end
  for _, dir in ipairs(coin(v.r, 0.7) and { -1, 1 } or { 1, -1 }) do
    local copies, ok = {}, true
    for _, m in ipairs(first) do
      local n = m.top
      local p, off = posOf(L, n.pitch)
      local c = copyNote(n)
      c.pitch, c.start = fromPos(v, L, p + dir, off), n.start + half
      c.len = math.min(n.len, t1 - c.start)
      if not inRange(v, c.pitch) then ok = false end
      copies[#copies + 1] = c
    end
    if ok then
      for _, m in ipairs(second) do m.top.gone = true end
      -- The first half's last note stops where the copy begins.
      local lens = {}
      for i, m in ipairs(first) do
        lens[i] = m.top.len
        if noteEnd(m.top) > t0 + half + 1e-6 then m.top.len = t0 + half - m.top.start end
      end
      local bad = false
      for _, c in ipairs(copies) do
        if clashes(v, nil, c.pitch, c.start, noteEnd(c)) then bad = true end
      end
      if not bad then
        for _, c in ipairs(copies) do add(v, c) end
        return ("its first half again, %s %s, in place of the second"):format(
          distance(L, dir, copies[1].pitch - first[1].top.pitch), dir < 0 and "lower" or "higher")
      end
      -- Grinds somewhere: put it all back and try the other direction.
      for _, m in ipairs(second) do m.top.gone = nil end
      for i, m in ipairs(first) do m.top.len = lens[i] end
    end
  end
  return nil
end

M.DEVELOP_MOVES = DEVELOP

--[[  One stretch of the music developed. `x` is how far into the develop
      range the amount is, 0 to 1: the further, the longer the stretch -
      a bar or two at first, up to the whole phrase at 100%.

      The stretch is whole bars (half bars for music of a bar or less),
      placed as the Where setting asks. Returns the change, or nil. ]]
function M.developOnce(v, x)
  local an, src = v.an, v.src
  local first, last = an.events[1], an.events[#an.events]
  if not first then return nil end
  local unit = src.barBeats
  local b0 = math.floor(first.start / unit + 1e-6)
  local b1 = math.floor(last.start / unit + 1e-6)
  if b1 - b0 < 1 then unit = unit / 2; b0, b1 = math.floor(first.start / unit + 1e-6), math.floor(last.start / unit + 1e-6) end
  local units = b1 - b0 + 1
  local L = ladder(an)
  if #L < 2 then return nil end
  local h = v.history or {}

  for _ = 1, 4 do
    local most = math.max(1, math.ceil(units * (0.35 + 0.65 * x)))
    local k = math.max(1, (most + 1) // 2 + math.floor(v.r() * (most - (most + 1) // 2 + 1)))
    k = math.min(k, units)
    local starts, ws = {}, {}
    for u = b0, b1 - k + 1 do
      local t0, t1 = u * unit, (u + k) * unit
      local mid = math.max(0, math.min(1, ((t0 + t1) / 2 - src.lead) / math.max(src.beats - src.lead, 1e-9)))
      local w = focusWeight(v, { pos = mid })
      w = w / (1 + 2 * (h["develop@" .. u] or 0))
      starts[#starts + 1], ws[#ws + 1] = u, w
    end
    local u = choose(v.r, starts, ws)
    if u then
      local t0, t1 = u * unit, (u + k) * unit
      local line = spanMoments(v, t0, t1)
      if #line > 0 then
        local names, mw = {}, {}
        for _, m in ipairs(M.DEVELOP.moves) do
          names[#names + 1] = m[1]
          mw[#mw + 1] = m[2] / (1 + 2 * (h[m[1]] or 0))
        end
        while #names > 0 do
          local name, i = choose(v.r, names, mw)
          table.remove(names, i); table.remove(mw, i)
          local said = DEVELOP[name](v, L, line, t0, t1)
          if said then
            for _, m in ipairs(line) do v.touched[m.e] = true end
            for _, e in ipairs(an.events) do
              if e.start >= t0 - 1e-6 and e.start < t1 - 1e-6 and not protected(v, e) then v.touched[e] = true end
            end
            v.chosen = line[1].e
            return ("%s: %s"):format(spanName(v, t0, t1), said), name, u, t0, t1
          end
        end
      end
    end
  end
  return nil
end

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
      -- Inside its own item, when several are varied together.
      local edge = v.src.parts and v.src.parts[n.part or 1] or v.src
      local s = math.max(n.start, edge.lead)
      local e = math.min(noteEnd(n), edge.beats)
      if e - s >= M.MIN_LEN - 1e-9 then
        local t = {
          pitch = math.max(0, math.min(127, math.floor(n.pitch + 0.5))),
          start = s, len = e - s,
          vel = math.max(1, math.min(127, math.floor(n.vel + 0.5))),
          chan = n.chan or 0, part = n.part,
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
    local k = (n.part or 0) * 2048 + n.chan * 128 + n.pitch
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

--[[  Unticking a change.

      The window lists a variation's changes with a box each; unticking
      one takes that change out and leaves every other one exactly as it
      was. So the moves still all run, drawing the same dice, and each
      remembers what it did (`record`); at the end the unticked ones are
      undone (`undo`): their notes back as they were, their added notes
      gone. A note a later change touched again keeps the later change.
      Added notes are marked gone, not removed, so the feel - which draws
      dice note by note - falls on every other note exactly as before. ]]
local FIELDS = { "pitch", "start", "len", "gone" }

local function snapshot(v)
  local snap = { count = #v.notes }
  for i, n in ipairs(v.notes) do snap[i] = { n.pitch, n.start, n.len, n.gone or false } end
  return snap
end

-- What one change did: { { note, field, before, after }, ... } and the
-- notes it added.
local function record(v, snap)
  local diff, added = {}, {}
  for i = 1, snap.count do
    local n = v.notes[i]
    for f, field in ipairs(FIELDS) do
      local now = n[field] or (field == "gone" and false or nil)
      if now ~= snap[i][f] then diff[#diff + 1] = { n, field, snap[i][f], now } end
    end
  end
  for i = snap.count + 1, #v.notes do added[#added + 1] = v.notes[i] end
  return { diff = diff, added = added }
end

local function undo(rec)
  for k = #rec.diff, 1, -1 do
    local d = rec.diff[k]
    local now = d[1][d[2]] or (d[2] == "gone" and false or nil)
    if now == d[4] then d[1][d[2]] = d[3] or nil end
  end
  for _, n in ipairs(rec.added) do n.gone = true end
end

--[[  One variation of the original `src`, analysed as `an`.

      opts: amount (0-1), focus (1-3), keepEnds, and each kind and feel key
            (notes, rhythm, add, remove, chords, timing, velocity, lengths)
            true or false. `skip`, if given, is a set of change ids (each
            change's `id`, the order it was made in) to leave out.
      seed: which variation - the same seed always gives the same one.

      history: optional, shared by a series (see `candidates`); added to.

      Returns { notes = {...}, changes = { "Bar 2, beat 3: ...", ... },
      moves = { { text, move, kind, at, event, id, skipped }, ... } }, the
      changes in the order they happen in the music. `changes` lists only
      the ones kept; `moves` all of them, the unticked marked `skipped`. ]]
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
  -- Unticked changes: each change's doing is recorded, to be undone.
  local skip = opts.skip and next(opts.skip) and opts.skip
  local records = {}
  local goal = 0
  if want > 0 then goal = math.min(cap, math.max(1, math.floor(want + r()))) end
  -- Home: the original again, played afresh - no changes, only the feel.
  if opts.home then goal = 0 end

  local kinds, kindWeights = {}, {}
  for _, k in ipairs(M.KINDS) do
    if opts[k.key] then
      kinds[#kinds + 1] = k
      kindWeights[#kindWeights + 1] = 1
    end
  end

  -- Near 100%, first, perhaps one bigger change: a stretch developed. It
  -- draws no dice at all below DEVELOP_FROM, so everything gentler is
  -- exactly what it was before develop existed.
  if opts.develop and amount > M.DEVELOP_FROM and goal > 0 and not an.drums then
    local x = (amount - M.DEVELOP_FROM) / (1 - M.DEVELOP_FROM)
    local c = M.DEVELOP_CHANCE
    if coin(r, c[1] + (c[2] - c[1]) * x) then
      local snap = skip and snapshot(v)
      local said, name, u, t0, t1 = M.developOnce(v, x)
      if said then
        local e = v.chosen
        changes[#changes + 1] = { text = said, move = name, kind = "develop", at = e.start, event = e.index,
                                  from = t0, to = t1, id = #changes + 1 }
        if snap then records[#changes] = record(v, snap) end
        if history then
          history["develop@" .. u] = (history["develop@" .. u] or 0) + 1
          history[name] = (history[name] or 0) + 1
          history["@" .. e.index] = (history["@" .. e.index] or 0) + 1
        end
      end
    end
  end

  local tries = 0
  while #changes < goal and #kinds > 0 and tries < 40 do
    tries = tries + 1
    local kind = choose(r, kinds, kindWeights)
    local names, ws = {}, {}
    for _, m in ipairs(kind.moves) do
      -- The arpeggio move is offered only where there are arpeggios, so the
      -- dice for everything else fall exactly as they did before it.
      if m[1] ~= "arpeggio" or #an.broken > 0 then names[#names + 1] = m[1]; ws[#ws + 1] = m[2] end
    end
    local name = choose(r, names, ws)
    v.move, v.chosen = name, nil
    local snap = skip and snapshot(v)
    local said = MOVES[name](v)
    if said then
      local e = v.chosen
      changes[#changes + 1] = { text = said, move = name, kind = kind.key, at = e.start, event = e.index,
                                id = #changes + 1 }
      if snap then records[#changes] = record(v, snap) end
      if history then
        history["@" .. e.index] = (history["@" .. e.index] or 0) + 1
        history[name .. "@" .. e.index] = (history[name .. "@" .. e.index] or 0) + 1
      end
    end
  end

  for _, e in ipairs(an.events) do
    e.notes, e.top, e.bass = saved[e].notes, saved[e].top, saved[e].bass
  end

  -- The unticked ones undone, latest first.
  if skip then
    for id = #changes, 1, -1 do
      if skip[id] then undo(records[id]); changes[id].skipped = true end
    end
  end

  -- An echo plays the same changes with a feel of its own.
  if opts.feelSeed then v.r = M.random(opts.feelSeed) end
  applyFeel(v, math.sqrt(amount))
  local notes = tidy(v)
  table.sort(changes, function(a, b) return a.at < b.at end)
  local texts = {}
  for _, c in ipairs(changes) do if not c.skipped then texts[#texts + 1] = c.text end end
  return { notes = notes, changes = texts, moves = changes }
end

--[[  Forms: what a batch plays after the original, A.

      A motif that keeps coming back does not have to come back different
      every time. A form says, for each place in the batch, which
      variation plays there: 0 is home - the original again, played
      afresh, only its feel new - and 1, 2, 3... are the batch's own
      variations, A', A'', A'''. A number that has played before is an
      echo: the same changes, with a feel of its own. ]]
M.FORMS = {
  { name = "All new",      hint = "A new variation every time.",
    slot = function(i) return i end },
  { name = "Home between", hint = "The original comes back between the variations, played afresh.",
    slot = function(i) return i % 2 == 0 and 0 or (i + 1) // 2 end },
  { name = "In pairs",     hint = "Each variation stated, then echoed: the same changes, played afresh.",
    slot = function(i) return (i + 1) // 2 end },
  { name = "A refrain",    hint = "The first variation keeps coming back between new ones.",
    slot = function(i) return i % 2 == 1 and 1 or i // 2 + 1 end },
}

-- "A' A A'' A": the letters a form gives `count` places.
function M.formLetters(form, count)
  local f = M.FORMS[form] or M.FORMS[1]
  local out = {}
  for i = 1, count do
    local k = f.slot(i)
    out[i] = k == 0 and "A" or (k <= 3 and ("A" .. ("'"):rep(k)) or ("A(" .. k .. ")"))
  end
  return table.concat(out, " ")
end

--[[  A run of variations, each made from the original - never from the one
      before it. With `grow`, the first ones are gentler and the last one
      gets the full amount, so a repeated motif can build. `history` may be
      passed in to carry on from an earlier batch of the same original.
      `opts.form` picks a form (M.FORMS; All new when nil). `skips[i]`, if
      given, is the set of changes unticked in the i-th; an echo follows
      the place it echoes, so its own entry is never read.

      Each one carries `home` (it is the original again) or `echo` (the
      place it echoes), for the window. ]]
function M.series(src, an, opts, baseSeed, count, T, j, history, skips)
  local out = {}
  history = history or {}
  local form = M.FORMS[opts.form or 1] or M.FORMS[1]
  local first = {}   -- variation number -> the place it first played
  -- The memory as each first statement found it, so an echo draws the
  -- same dice (a copy each time: an echo adds nothing to it).
  local memoryAt = {}
  local function copy(h) local c = {}; for k, x in pairs(h) do c[k] = x end; return c end
  local function optsAt(i, extra)
    local o = {}
    for k, x in pairs(opts) do o[k] = x end
    if opts.grow and count > 1 then o.amount = opts.amount * (0.4 + 0.6 * (i - 1) / (count - 1)) end
    for k, x in pairs(extra or {}) do o[k] = x end
    return o
  end
  for i = 1, count do
    local k = form.slot(i)
    local seed = M.seedFor(baseSeed, i - 1, j)
    if k == 0 then
      out[i] = M.vary(src, an, optsAt(i, { home = true }), seed, T)
      out[i].home = true
    elseif first[k] then
      -- An echo: the place it echoes, its seed and its unticked changes,
      -- and only the feel its own.
      local f = first[k]
      out[i] = M.vary(src, an, optsAt(f, { skip = skips and skips[f], feelSeed = seed + 1 }),
                      M.seedFor(baseSeed, f - 1, j), T, copy(memoryAt[f]))
      out[i].echo = f
    else
      first[k] = i
      memoryAt[i] = copy(history)
      out[i] = M.vary(src, an, optsAt(i, { skip = skips and skips[i] }), seed, T, history)
    end
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
-- Varying several items as one piece
--
-- A melody on one track and its chords on another, selected together, are
-- one piece of music: a changed melody note must not grind against the
-- chords, a changed chord must not grind against the tune, and the key is
-- heard from both. So the items that overlap in time are put on one
-- timeline (`combine`), each note remembering its part, varied as one, and
-- given back to their items (`split`).
------------------------------------------------------------------------------

-- Items that sound together, in groups: each source joins the group of
-- the one before it if they overlap in time and share a metre. `srcs` are
-- sorted by start, as mv_place reads them, and carry startQN and lengthQN.
-- Returns { { 1, 2 }, { 3 }, ... } - indices into srcs.
function M.groups(srcs)
  local out, last, finish = {}, nil, -math.huge
  for j, s in ipairs(srcs) do
    local first = last and srcs[last[1]]
    if last and s.startQN < finish - 1e-6 and s.barBeats == first.barBeats and s.pulse == first.pulse then
      last[#last + 1] = j
    else
      last = { j }
      out[#out + 1] = last
      finish = -math.huge
    end
    finish = math.max(finish, s.startQN + s.lengthQN)
  end
  return out
end

--[[  The sources of a group on one timeline, from the earliest bar line.
      Each note carries `part` (its source's place in `srcs`); `parts[k]`
      keeps each source's own edges and how far it was moved, for tidy and
      split. The result is a source like any other. ]]
function M.combine(srcs)
  local base = math.huge
  for _, s in ipairs(srcs) do base = math.min(base, s.originQN) end
  local out = { notes = {}, parts = {}, lead = math.huge, beats = -math.huge,
                barBeats = srcs[1].barBeats, pulse = srcs[1].pulse, num = srcs[1].num, den = srcs[1].den }
  for k, s in ipairs(srcs) do
    local shift = s.originQN - base
    out.parts[k] = { lead = s.lead + shift, beats = s.beats + shift, shift = shift }
    out.lead, out.beats = math.min(out.lead, s.lead + shift), math.max(out.beats, s.beats + shift)
    for _, n in ipairs(s.notes) do
      out.notes[#out.notes + 1] = { pitch = n.pitch, start = n.start + shift, len = n.len,
                                    vel = n.vel, chan = n.chan, part = k }
    end
  end
  return out
end

-- A variation of a combined source, given back to its parts: a list of
-- note lists, each on its own source's timeline.
function M.split(notes, combined)
  local out = {}
  for k = 1, #combined.parts do out[k] = {} end
  for _, n in ipairs(notes) do
    local p = combined.parts[n.part or 1]
    table.insert(out[n.part or 1], { pitch = n.pitch, start = n.start - p.shift, len = n.len,
                                     vel = n.vel, chan = n.chan })
  end
  return out
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
