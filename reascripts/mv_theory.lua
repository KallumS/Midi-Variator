--[[ Midi Variator - keys and finding the key.

     Pure Lua. Nothing in this file touches REAPER or ImGui.

     Everything below the line is copied UNCHANGED from Midi Suggester's
     reascripts/ms_theory.lua at commit f026d15 - the "Keys" and "Finding
     the key" sections, comments and all. Those are ScaleView for REAPER's
     roots and scales and a key finder whose weights were tuned on fifteen
     tunes there. Do not retune them here: a change belongs in Midi Suggester
     first, with its tune table, and is then copied across.

     The variator only needs to know which notes are "in the key", so that a
     note nudged up or down a step lands on a note that belongs.
]]
------------------------------------------------------------------------------
local M = {}

------------------------------------------------------------------------------
-- Keys
--
-- ScaleView's roots and scales, so the tools agree on what a key is and what
-- its notes are called. Both spellings of every black key are here plus Cb,
-- because C# major and Db major are the same seven notes written differently.
--
-- Only the seven-note scales are offered. Chords are built by stacking every
-- other scale note, and a five- or six-note scale has no thirds to stack:
-- a "triad" of the minor pentatonic is a pile of fourths.
------------------------------------------------------------------------------

local LETTER_PC  = { 0, 2, 4, 5, 7, 9, 11 }        -- C D E F G A B
local LETTERS    = { "C", "D", "E", "F", "G", "A", "B" }
local ACCIDENTAL = { [-2] = "bb", [-1] = "b", [0] = "", [1] = "#", [2] = "x" }

M.SHARP_NAMES = { "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B" }
M.FLAT_NAMES  = { "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B" }

-- letter is 0-based into LETTERS.
M.ROOTS = {
  { name = "C",  letter = 0, acc =  0 }, { name = "C#", letter = 0, acc =  1 },
  { name = "Db", letter = 1, acc = -1 }, { name = "D",  letter = 1, acc =  0 },
  { name = "D#", letter = 1, acc =  1 }, { name = "Eb", letter = 2, acc = -1 },
  { name = "E",  letter = 2, acc =  0 }, { name = "F",  letter = 3, acc =  0 },
  { name = "F#", letter = 3, acc =  1 }, { name = "Gb", letter = 4, acc = -1 },
  { name = "G",  letter = 4, acc =  0 }, { name = "G#", letter = 4, acc =  1 },
  { name = "Ab", letter = 5, acc = -1 }, { name = "A",  letter = 5, acc =  0 },
  { name = "A#", letter = 5, acc =  1 }, { name = "Bb", letter = 6, acc = -1 },
  { name = "B",  letter = 6, acc =  0 }, { name = "Cb", letter = 0, acc = -1 },
}

-- iv is semitones from the tonic. Every scale here walks the letters in
-- order, so the spelling needs no table of its own.
M.SCALES = {
  { name = "Major",           iv = { 0, 2, 4, 5, 7, 9, 11 } },
  { name = "Minor (Natural)", iv = { 0, 2, 3, 5, 7, 8, 10 } },
  { name = "Harmonic Minor",  iv = { 0, 2, 3, 5, 7, 8, 11 } },
  { name = "Dorian",          iv = { 0, 2, 3, 5, 7, 9, 10 } },
  { name = "Phrygian",        iv = { 0, 1, 3, 5, 7, 8, 10 } },
  { name = "Lydian",          iv = { 0, 2, 4, 6, 7, 9, 11 } },
  { name = "Mixolydian",      iv = { 0, 2, 4, 5, 7, 9, 10 } },
}
M.MAJOR, M.MINOR = 1, 2

function M.rootIndex(name)
  for i, r in ipairs(M.ROOTS) do if r.name == name then return i end end
end
function M.scaleIndex(name)
  for i, s in ipairs(M.SCALES) do if s.name == name then return i end end
end

function M.rootPc(root) return (LETTER_PC[root.letter + 1] + root.acc) % 12 end

-- Spell pitch class pc on the given letter (0-based, any integer), or nil
-- when that would take more than a double accidental.
local function spellAs(letter, pc)
  letter = letter % 7
  local offset = ((pc - LETTER_PC[letter + 1] + 6) % 12) - 6
  local acc = ACCIDENTAL[offset]
  if not acc then return nil end
  return LETTERS[letter + 1] .. acc
end

--[[  A key, built once and handed around.

      pcs[pc] is true for the scale's notes; degree[pc] is which degree a note
      is (0-based); names[pc] is how it is written in this key. The notes
      outside the scale have no spelling of their own, so they lean whichever
      way the key does - exactly as ScaleView names them. ]]
function M.key(rootIdx, scaleIdx)
  local root, scale = M.ROOTS[rootIdx], M.SCALES[scaleIdx]
  local k = {
    root = rootIdx, scale = scaleIdx,
    tonic = M.rootPc(root),
    pcs = {}, degree = {}, degreePc = {}, names = {},
    label = root.name .. " " .. scale.name,
  }
  local sharps, flats = 0, 0
  for d, iv in ipairs(scale.iv) do
    local pc = (k.tonic + iv) % 12
    local name = spellAs(root.letter + d - 1, pc)
    k.pcs[pc], k.degree[pc], k.degreePc[d - 1] = true, d - 1, pc
    k.names[pc] = name
    if name then
      if name:find("#") or name:find("x") then sharps = sharps + 1 end
      if name:find("b", 2) then flats = flats + 1 end   -- skip the letter B
    end
  end
  k.flats = flats > sharps
  local outside = k.flats and M.FLAT_NAMES or M.SHARP_NAMES
  for pc = 0, 11 do
    if not k.names[pc] then k.names[pc] = outside[pc + 1] end
  end
  -- Whether the third above the tonic is major. The chord palette borrows
  -- from the parallel key, and which way it borrows depends on this alone.
  k.majorish = k.pcs[(k.tonic + 4) % 12] == true
  return k
end

-- The pitch class of scale degree d, for any integer d: 7 is the tonic again.
function M.degreePc(key, d) return key.degreePc[d % 7] end

function M.noteName(key, pc) return key.names[pc % 12] end

------------------------------------------------------------------------------
-- Finding the key
--
-- Krumhansl and Kessler's key profiles: how well each of the twelve pitch
-- classes was judged to fit a major and a minor key, measured by listening
-- experiment (Krumhansl, Cognitive Foundations of Musical Pitch, 1990). The
-- notes are counted by how long they sound, and the key whose profile
-- correlates best with that count wins.
--
-- The profiles cannot tell a key from its relative minor very well - the two
-- share all seven notes - so the note a piece ends on settles it, and the note
-- it starts on helps. That is how a musician settles it too.
------------------------------------------------------------------------------

local PROFILE = {
  [M.MAJOR] = { 6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88 },
  [M.MINOR] = { 6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17 },
}

-- How a key on each pitch class is conventionally written: the spelling with
-- fewer accidentals, and the sharp side of the six-and-six tie in major only
-- because F# major is the one more often seen.
local MAJOR_ROOT = { "C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B" }
local MINOR_ROOT = { "C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B" }

--[[  The profiles alone are not enough for a short tune. Ode to Joy's first
      phrase is five notes, C to G, and correlates best with E minor - which
      has no F natural in it, and the phrase has two. So two more things are
      asked, both of them things a musician asks:

        - Is every note in the key? Time spent outside the scale counts
          against it. (The raised seventh does not, in minor: the harmonic
          minor's leading tone is part of a minor key.)
        - Does the tune sit on the key's tonic chord? Time spent on its 1, 3
          and 5 counts for it.

      Measured over fifteen tunes and progressions (see the session log),
      every setting of these weights misses one. This one misses Ode to Joy,
      whose first phrase ends on D - a half cadence, which from the melody
      alone is as good as D minor. The setting that gets Ode right misses
      Happy Birthday instead, which ends on its tonic, and a tune ending on
      its tonic is far the commoner case. The key is always the user's to
      change. ]]
M.KEY_OUTSIDE     = 1.0    -- per share of time on notes outside the scale
M.KEY_TRIAD       = 0.6    -- per share of time on the tonic triad
M.KEY_END_BONUS   = 0.2    -- the last note (or last bass) is the tonic
M.KEY_START_BONUS = 0.05   -- and so is the first

local function correlate(xs, ys)
  local n, mx, my = #xs, 0, 0
  for i = 1, n do mx, my = mx + xs[i], my + ys[i] end
  mx, my = mx / n, my / n
  local sxy, sxx, syy = 0, 0, 0
  for i = 1, n do
    local dx, dy = xs[i] - mx, ys[i] - my
    sxy, sxx, syy = sxy + dx * dy, sxx + dx * dx, syy + dy * dy
  end
  if sxx == 0 or syy == 0 then return 0 end
  return sxy / math.sqrt(sxx * syy)
end

--[[  notes: { {pitch, start, len}, ... }. firstPc / lastPc are the pitch
      classes that open and close the music - the reader decides what those
      are (a melody's first and last notes, a progression's first and last
      bass). Returns the ranked candidates, best first, each
      { root = index into ROOTS, scale = MAJOR or MINOR, score = number }. ]]
function M.detectKey(notes, firstPc, lastPc)
  local hist, total = {}, 0
  for pc = 1, 12 do hist[pc] = 0 end
  for _, n in ipairs(notes) do
    local pc = n.pitch % 12 + 1
    -- A very short note still counts for something: a run of sixteenths is
    -- as much a statement of the key as one long note.
    local w = math.max(n.len, 0.25)
    hist[pc], total = hist[pc] + w, total + w
  end
  if total <= 0 then total = 1 end
  local function at(pc) return hist[pc % 12 + 1] end

  local ranked = {}
  for tonic = 0, 11 do
    for _, mode in ipairs({ M.MAJOR, M.MINOR }) do
      local rotated = {}
      for i = 0, 11 do rotated[i + 1] = PROFILE[mode][(i - tonic) % 12 + 1] end
      local score = correlate(hist, rotated)

      local inScale, outside = {}, 0
      for _, iv in ipairs(M.SCALES[mode].iv) do inScale[(tonic + iv) % 12] = true end
      if mode == M.MINOR then inScale[(tonic + 11) % 12] = true end
      for pc = 0, 11 do if not inScale[pc] then outside = outside + at(pc) end end
      local third = mode == M.MAJOR and 4 or 3
      local triad = at(tonic) + at(tonic + third) + at(tonic + 7)
      score = score - M.KEY_OUTSIDE * outside / total + M.KEY_TRIAD * triad / total

      if lastPc == tonic then score = score + M.KEY_END_BONUS end
      if firstPc == tonic then score = score + M.KEY_START_BONUS end
      local rootName = (mode == M.MAJOR and MAJOR_ROOT or MINOR_ROOT)[tonic + 1]
      ranked[#ranked + 1] = { root = M.rootIndex(rootName), scale = mode, score = score }
    end
  end
  table.sort(ranked, function(a, b)
    if a.score ~= b.score then return a.score > b.score end
    if a.root ~= b.root then return a.root < b.root end
    return a.scale < b.scale
  end)
  return ranked
end


return M
