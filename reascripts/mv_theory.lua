--[[ Midi Variator - keys, finding the key, and naming chords.

     Pure Lua. Nothing in this file touches REAPER or ImGui.

     Everything below the line is copied UNCHANGED from Midi Suggester's
     reascripts/ms_theory.lua at commit 4577b87, comments and all:

       - Keys: ScaleView for REAPER's roots and seven-note scales.
       - Finding the key, with weights tuned on fifteen tunes there.
       - Naming a chord: ScaleView Pro's chord reader - the definitive one;
         ScaleView (not Pro) is a simplified version. Midi Suggester carries
         it unchanged, and its CORE_RANK-to-analyse block is
         reascripts/ScaleView Pro.lua's at f9e2691, verbatim. Since
         ScaleView Pro's df4ea43 it also takes Starting Blocks' chords as
         its dictionary: notes that are a Blocks chord are named on one of
         Blocks' roots for them.
         The variator uses it to find a chord's root before changing its
         quality, and to say what it became ("Bar 2: G7 became G9") in
         ScaleView Pro's own words.

     Do not change or retune anything here: a change belongs in Midi
     Suggester (or, for the chord reader, ScaleView Pro) first, and is then
     copied across. tests/test_vary.lua checks a few of ScaleView's own
     chord names to prove the copy.

     Scale degrees are 0-based (0 is the tonic) because the arithmetic wants
     them that way. Table indices are 1-based, like Lua.
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

------------------------------------------------------------------------------
-- Reading a chord
--
-- Everything from here to `nameChord` is ScaleView Pro's chord reader,
-- copied from `reascripts/ScaleView Pro.lua` at commit f9e2691 - its
-- CORE_RANK table through `analyse`, unchanged, comments and all. The
-- comments are its own and refer to its measurements, which are the reason
-- the weights are what they are. Do not retune them here: a change belongs in
-- ScaleView first, with its corpora, and is then copied across.
-- tests/test_theory.lua holds ScaleView's own expected names to prove the copy.
-- `nameChord` below is Pro's detectChord with the key passed in; its tiebreak
-- (key, then no slash, then rank) is Pro's at the same commit.
------------------------------------------------------------------------------

local CORE_RANK = {
  ["maj/P/none"]  =  1, ["min/P/none"]  =  2,
  ["maj/P/b7"]    =  3, ["min/P/b7"]    =  4, ["maj/P/maj7"] =  5,
  ["min/b/b7"]    =  6, ["min/b/bb7"]   =  7, ["min/b/none"] =  8,
  ["maj/#/none"]  =  9,
  ["sus4/P/none"] = 10, ["sus2/P/none"] = 11,
  ["min/P/maj7"]  = 12,
  ["maj/#/b7"]    = 13, ["maj/b/b7"]    = 14, ["maj/#/maj7"] = 15,
  --[[  maj7b5 belongs in this list and was missing from it. The note above
      says every altered fifth carrying a seventh that musicians play is named
      here - 7b5, aug7, min7b5, maj7#5 - and players write maj7b5 constantly,
      as the Lydian tonic. Without it the quality paid RANK_UNNAMED plus
      RANK_TWICE_ODD, 37 before any slash, and lost to readings with no third
      in them at all: D D# G A read Dsus4b9 rather than D#maj7b5/D. ]]
  ["maj/b/maj7"]  = 16,
  ["sus4/P/b7"]   = 17, ["sus2/P/b7"]   = 18,
  ["sus4/P/maj7"] = 19, ["sus2/P/maj7"] = 20,

  --[[  A missing third is a different chord, not a thinner one, so these sit
      well below anything with a third in it.

      Below, and by more than a slash costs. A third-less shape with a perfect
      fifth is a real voicing - a seventh over a bare fifth is what a guitarist
      plays - but one whose fifth is *also* altered is odd twice over, exactly
      as RANK_TWICE_ODD has it for the qualities that keep their third. Those
      two sit past COST_INVERSION from an unnamed quality with a third in it
      (25), so D E A# reads Bb(b5)/E rather than E7b5(no3), the same way F A B
      reads F(b5) rather than B7b5(no3). The perfect-fifth pair are left where
      they were, which is what keeps C G Bb reading C7(no3). ]]
  ["none/P/b7"]   = 30, ["none/P/maj7"] = 31, ["none/P/none"] = 34,
  ["none/b/maj7"] = 41, ["none/b/b7"]   = 42,
}

--[[  A quality the table does not name is still ranked by the interval that
    decides most about a chord: the third. A real third - major or minor -
    keeps a chord readable however odd the rest of it is, so F A B reads
    F(b5) rather than losing to B7b5(no3), which has no third in it at all.
    A suspension is not a third but a stand-in for one, and a shape with
    neither is the last thing to reach for. ]]
local RANK_UNNAMED   = {maj = 25, min = 25, sus4 = 70, sus2 = 70, none = 90}
--[[  Except that a third only excuses one oddity. Every altered fifth carrying
    a seventh that musicians actually play is named in the table above - 7b5,
    aug7, min7b5, maj7#5 - so a combination that is not there is strange twice
    over, and should not win on the strength of its third alone. Without this
    C D Eb Gb Cb read CminMaj9b5. ]]
local RANK_TWICE_ODD =  12
--[[  A missing fifth is never spoken, but it is not equally unremarkable. A
    seventh chord is routinely voiced without one - that is the standard shell -
    while a triad with no fifth is two notes and a guess, so the two are
    charged differently. ]]
local RANK_NO_FIFTH  =  20  -- a triad that has lost its fifth
local RANK_NO_FIFTH7 =   4  -- a seventh chord voiced as a shell
local RANK_ELEVENTH  =   6  -- a sus4 carrying a seventh and a ninth: C11
local COST_INVERSION =  14  -- naming the bass after a slash
local COST_NATURAL   =   1  -- a ninth/eleventh/thirteenth the number implies
local COST_ADD       =   2  -- one that has to be spelled out as an add
local COST_CLASH     =   6  -- a natural eleventh fighting a major third
local COST_ALTERED   =   5  -- b9, #9, #11, b13 colouring a plain chord
--[[  An alteration that does not belong to the chord it is sitting on costs
    far more, because it usually means the root has been guessed wrong and the
    notes belong to some plainer chord standing on one of the others. A b9, a
    #9 and a b13 are the dominant's alterations: over a minor seventh or a
    plain triad they are not colours a musician hears. A sharpened eleventh is
    the exception - it is at home on almost anything with a perfect fifth -
    and any alteration over a fifth that is already altered is suspect. ]]
local COST_CLASHING  =  18
--[[  A suspension replaces the third rather than decorating it, so it does not
    carry added tones. "sus4 add6 add9" is not a chord anybody writes; those
    notes are an inversion of something with a third in it. ]]
local COST_SUS_EXTRA =  12
local COST_SIXTH     =   4  -- enough that C E A stays Amin/C
--[[  A minor sixth is charged one more than any other, because it is the one
    sixth that is also something else: A C E F# is Amin6 and it is equally the
    half-diminished on its third, F#min7b5. Those two readings tie exactly at
    4, and the half-diminished is the name Scaler prints, the name jazznet's
    labels carry, and the name some 880 analyst labels across DCML and When in
    Rome give it. One point settles the tie without touching any other sixth. ]]
local COST_MIN_SIXTH =   5

--[[  Reading the intervals present into a third, a fifth and a seventh.

    Where both a flattened and a raised fifth are sounding, which one is *the*
    fifth is a real choice and not a lookup, so `preferSharpFive` lets the
    caller ask for the other reading and cost them both. C E F# G# B was named
    Cmaj7b5b13 because the flattened fifth was taken greedily, leaving the G#
    to be described as a b13 over a chord that is not at home with one; read
    the other way round it is Cmaj7#5#11, which costs 14 less. ]]
local function core(has, preferSharpFive)
  local third, fifth, seventh
  local used = {[0] = true}

  if     has[4] then third, used[4] = "maj",  true
  elseif has[3] then third, used[3] = "min",  true
  elseif has[5] then third, used[5] = "sus4", true
  elseif has[2] then third, used[2] = "sus2", true
  else               third = "none" end

  if has[7] then fifth, used[7] = "P", true
  elseif has[6] and has[8] and preferSharpFive then fifth, used[8] = "#", true
  elseif has[6] then fifth, used[6] = "b", true
  elseif has[8] then fifth, used[8] = "#", true
  else               fifth = "none" end

  -- A diminished triad takes the 9 as a doubly flattened seventh.
  if     has[10] then seventh, used[10] = "b7",   true
  elseif has[11] then seventh, used[11] = "maj7", true
  elseif third == "min" and fifth == "b" and has[9] then
                      seventh, used[9]  = "bb7",  true
  else                seventh = "none" end

  return third, fifth, seventh, used
end

-- The name of a core quality. Most are built from their parts; the handful
-- with names of their own are named.
local SPECIAL = {
  ["min/b/none"] = "dim",  ["min/b/bb7"]  = "dim7", ["min/b/b7"] = "min7b5",
  ["maj/#/none"] = "aug",  ["maj/#/b7"]   = "aug7", ["maj/#/maj7"] = "maj7#5",
  ["maj/b/b7"]   = "7b5",  ["min/P/maj7"] = "minMaj7", ["min/none/maj7"] = "minMaj7",
}

local function coreName(third, fifth, seventh)
  local special = SPECIAL[third .. "/" .. fifth .. "/" .. seventh]
  if special then return special end

  local base = (third == "min" and "min") or (third == "sus4" and "sus4")
            or (third == "sus2" and "sus2") or ""
  local sev  = (seventh == "b7" and "7") or (seventh == "bb7" and "dim7")
            or (seventh == "maj7" and (third == "min" and "Maj7" or "maj7")) or ""
  local alt  = (fifth == "b" and "b5") or (fifth == "#" and "#5") or ""

  -- Sevenths are written before a sus, not after it: 7sus4, never sus47.
  local name = (third == "sus4" or third == "sus2") and (sev .. base)
                                                     or (base .. sev)
  name = name .. alt
  -- A bare altered fifth has to be bracketed or the symbol reads as a note
  -- name: C(b5) is a chord on C, Cb5 looks like one on C flat.
  if name == alt and alt ~= "" then name = "(" .. alt .. ")" end
  return name
end

local function rankOf(third, fifth, seventh)
  if fifth == "none" then
    local rank = CORE_RANK[third .. "/P/" .. seventh] or RANK_UNNAMED[third]
    return rank + (seventh == "none" and RANK_NO_FIFTH or RANK_NO_FIFTH7)
  end
  local rank = CORE_RANK[third .. "/" .. fifth .. "/" .. seventh]
  if rank then return rank end
  return RANK_UNNAMED[third] + (seventh ~= "none" and RANK_TWICE_ODD or 0)
end

-- What is left over once the core has taken its notes.
-- interval -> {how it is written, whether it is an alteration, which degree}
local EXTENSION = {
  [1] = {"b9",  true},  [2] = {"9",  false, 9},  [3] = {"#9",  true},
  [5] = {"11",  false, 11}, [6] = {"#11", true}, [8] = {"b13", true},
}

local function analyseAs(has, root, bass, preferSharpFive)
  local third, fifth, seventh, used = core(has, preferSharpFive)
  local rank = rankOf(third, fifth, seventh)
  local name, cost = coreName(third, fifth, seventh), rank

  local naturals, altered, sixth = {}, {}, false
  local asEleventh = false  -- read as an 11 chord, so not a suspension at all
  for i = 1, 11 do
    if has[i] and not used[i] then
      if i == 9 then
        if seventh == "none" then sixth = true else naturals[13] = true end
      else
        local ext = EXTENSION[i]
        if ext and ext[2] then altered[#altered + 1] = ext[1]
        elseif ext then naturals[ext[3]] = true
        else
          -- Only 11 can arrive here: core() always takes 4, 7 and 10 when they
          -- are present, and 9 was dealt with above. So this is the major
          -- seventh left over when a flattened one took the seventh's place.
          altered[#altered + 1] = "maj7"
        end
      end
    end
  end

  if seventh ~= "none" and seventh ~= "bb7" then
    --[[  With a seventh underneath, the highest natural extension names the
        chord - but a stacked number claims everything under it, so it may only
        be used when the ninth is actually being played. Hutchinson's chord
        list (Music Theory for the 21st-Century Classroom, 31.4) prints Cm11
        and Cm7(11) side by side, six noteheads against five: the first has the
        ninth in it, the second does not. So a ninth that is not there is named
        in brackets after the seventh instead of being swallowed by a number.

        A natural eleventh over a major third is the other exception: it
        clashes, so it is bracketed rather than promoted whatever else is
        present. ]]
    --[[  A ninth that has been altered still fills its place in the stack: the
        same list prints C13sus(b9) with six noteheads, the b9 standing where
        the natural ninth would. So a b9 or a #9 lets the number rise too. ]]
    local ninth = naturals[9]
    for _, token in ipairs(altered) do
      if token == "b9" or token == "#9" then ninth = true end
    end

    local number
    if ninth and naturals[13] then number = 13
    elseif ninth and naturals[11] and third ~= "maj" then number = 11
    elseif naturals[9] then number = 9 end

    if third == "sus4" and seventh == "b7" and naturals[9]
       and (fifth == "P" or fifth == "none") then
      -- A sus4 carrying a seventh and a ninth is how an eleventh chord is
      -- voiced - the third is left out precisely because it would clash with
      -- the eleventh - so it is named as one rather than as a suspension.
      name, number, asEleventh = "11", 11, true
      naturals[11] = true
      cost = RANK_ELEVENTH + (fifth == "none" and RANK_NO_FIFTH7 or 0)
    elseif number then
      name = name:gsub("7", tostring(number), 1)
    end

    local spare = {}
    for _, degree in ipairs({9, 11, 13}) do
      if naturals[degree] then
        local implied = number and degree <= number
                        and not (degree == 11 and third == "maj")
        if implied then cost = cost + COST_NATURAL
        else
          cost = cost + (degree == 11 and third == "maj" and COST_CLASH or COST_ADD)
          spare[#spare + 1] = degree
        end
      end
    end
    -- Everything the number did not account for, bracketed as the chord lists
    -- print it: Cm7(11), C7(13), C7(11,13).
    if #spare > 0 then name = name .. "(" .. table.concat(spare, ",") .. ")" end
  else
    -- No seventh, so nothing stacks: everything above the triad is an add.
    if sixth then
      cost = cost + ((third == "min" and fifth == "P") and COST_MIN_SIXTH
                                                        or COST_SIXTH)
      --[[  The sixth stands where a seventh would, so the symbol is rebuilt
          around it rather than having a 6 pasted on the end. An altered fifth
          has to survive that: C Eb G# A is min6#5, and naming it Cmin6 claims
          a perfect fifth that is not being played. ]]
      local mark = (fifth == "b" and "b5") or (fifth == "#" and "#5") or ""
      if naturals[9] and (third == "maj" or third == "min") then
        naturals[9] = nil
        name = (third == "min" and "min6/9" or "6/9") .. mark
        cost = cost + COST_ADD
      elseif third == "min"  then name = "min6" .. mark
      elseif third == "maj"  then name = (fifth == "#" and "aug6") or ("6" .. mark)
      elseif third == "none" then name = "6" .. mark
      else name = name .. "(add6)" end
    end
    --[[  A diminished seventh carrying a ninth is a dim9, not a dim7 with a
        note stuck on the end. The number rises the way it does under every
        other seventh - the bb7 only sat in the "no seventh" branch here
        because it is spelled as a sixth - and Cdim9 is what the chord lists
        and Scaler both print. ]]
    --  Only the spelling changes. It still costs what an added tone costs, so
    --  which reading wins is untouched: this renames, it does not re-rank.
    if seventh == "bb7" and naturals[9] then
      naturals[9] = nil
      name = name:gsub("dim7", "dim9", 1)
      cost = cost + COST_ADD
    end
    for _, degree in ipairs({9, 11, 13}) do
      if naturals[degree] then
        cost = cost + (degree == 11 and third == "maj" and COST_CLASH or COST_ADD)
        name = name .. (name == "" and "add" or "Add") .. degree
      end
    end
  end

  --[[  An alteration is written straight onto the symbol - C7b9, Cmin#11 -
      except where that would read as a note name. "C#11" is a chord on C#,
      so a bare triad says add instead: Cadd#11. ]]
  --[[  Alt 2 differs from Alt here, and only here. Alt asks whether an
      alteration belongs to the chord under it, and only a dominant is at home
      with a b9, a #9 or a b13. Alt 2 also accepts a complete triad - a real
      third with a perfect fifth underneath it - which is what Scaler 3 does:
      given the choice it names the chord that has a whole triad in it and
      hangs the odd notes off that, rather than the thinner reading that needs
      fewer of them. C D Eb Gb Cb is the case that separates them: Alt reads
      D13b9/C, Alt 2 and Scaler read Cbaddb9#9/C. ]]
  local dominant = third == "maj" and seventh == "b7"
  local triad = (third == "maj" or third == "min") and fifth == "P"
  for _, token in ipairs(altered) do
    --[[  A b13 is excluded from the concession, and measurably so. It is the
        one alteration whose note is almost always a chord tone of something
        plainer: E G B with a C in it is Cmaj7 in first inversion, not Emin
        wearing a b13. Letting a complete triad take one cost 207 misnamed
        sonorities across the Bach chorales and 7 points of accuracy on
        inverted jazz voicings, and bought nothing - the chord Alt 2 exists
        for, Cb maj b9 #9, carries a b9 and a #9, not a b13. ]]
    --[[  An altered fifth is no bar on a dominant standing on its own root.
        A b9 or #9 over a b5 or #5 usually means the root has been guessed
        wrong, but over a major third and a flat seventh with the root in the
        bass it is the altered dominant - 7#5b9, 7b5#9, 7b9b13 - which every
        lead sheet writes. Barring it read C7#5b9 as A#min9b5/C. Only from the
        bass, because that is how the chord is played - the bass takes the
        root, the hands take the alterations - and allowing it from an
        inversion as well read F A C G C# over C as Aaug7#9/C, a #9 in the
        bass, and moved 790 names in the sweep where this moves 455. ]]
    local plainFifth = fifth ~= "b" and fifth ~= "#"
    local athome = token ~= "maj7"
                   and ((dominant and (plainFifth or root == bass))
                        or (plainFifth and (token == "#11"
                                            or (triad and token ~= "b13"))))

    --[[  A flattened sixth is a b13 only when a seventh is under it. Without
        one it is an added flat sixth, exactly as a natural sixth is a 6 rather
        than a 13 - "C#(add b6) means a C# major triad with the b6 added"
        (Hutchinson, Music Theory for the 21st-Century Classroom, 31.1-31.2).
        Only the printed name changes: the cost still reads it as a b13, which
        is what keeps E G B C reading Cmaj7/E rather than Emin wearing one. ]]
    --[[  Both sevenths at once is a semitone cluster rather than a colour, and
        it turns up in real music as a passing note against a seventh chord -
        G B D F with an F# over it, 83 voicings across the Beethoven quartets
        and the Chopin mazurkas. Bracket it, or the two seventh names run
        together into "G7maj7", which is not a symbol anybody could read. ]]
    local shown = (token == "b13" and seventh == "none") and "b6"
                  or (token == "maj7" and "(maj7)") or token
    cost = cost + (athome and COST_ALTERED or COST_CLASHING)
    name = name .. ((name == "" and seventh == "none") and "add" or "") .. shown
  end

  if (third == "sus4" or third == "sus2") and not asEleventh then
    local carried = #altered
    for _, degree in ipairs({9, 11, 13}) do
      if naturals[degree] then carried = carried + 1 end
    end
    if sixth then carried = carried + 1 end
    cost = cost + carried * COST_SUS_EXTRA
  end

  --[[  A missing third is the one omission that has to be said out loud, and
      it is said last, so the symbol reads as a chord with a note taken out of
      it: maj7b5(no3), not maj7(no3)b5. A bare fifth with nothing above it is
      the one chord that is only its root and fifth. ]]
  if third == "none" then name = (name == "" and "5" or name .. "(no3)") end

  if root ~= bass then cost = cost + COST_INVERSION end
  -- Two readings can cost the same - Emin6 and C#min7b5 are the same four
  -- notes - so the commoner quality settles it rather than the loop order.
  return name, cost, rank
end

--[[  With both fifths sounding and no perfect one between them, neither is
    obviously the fifth, so both readings are costed and the cheaper wins.
    Everywhere else there is nothing to choose and the second reading is not
    even built. ]]
local function analyse(has, root, bass)
  local name, cost, rank = analyseAs(has, root, bass, false)
  if has[6] and has[8] and not has[7] then
    local altName, altCost, altRank = analyseAs(has, root, bass, true)
    if altCost < cost then return altName, altCost, altRank end
  end
  return name, cost, rank
end

------------------------------------------------------------------------------
-- End of the copy. What follows is ScaleView Pro's `detectChord`, with the
-- one change a port needs: it read the notes held and the key selected from
-- the script's globals, and here both are passed in. With no key it assumes
-- C major, as ScaleView does, and for the same reason: it is what the names
-- fall back to anyway.
------------------------------------------------------------------------------

local ASSUMED = M.key(1, M.MAJOR)

-- A chord root is named from the eighteen spellings ROOTS offers, the roots
-- real keys are built on; anything else falls back to a plain name leaning
-- the way the key does, so no chord symbol carries a double accidental.
local CHORD_ROOT_NAMES = {}
for _, root in ipairs(M.ROOTS) do CHORD_ROOT_NAMES[root.name] = true end

local function chordNoteName(key, pc)
  local name = key.names[pc]
  if CHORD_ROOT_NAMES[name] then return name end
  return (key.flats and M.FLAT_NAMES or M.SHARP_NAMES)[pc + 1]
end
M.chordNoteName = function(key, pc) return chordNoteName(key or ASSUMED, pc % 12) end

-- A doubled first, third or fifth degree of the key claims the bass: E G C C
-- is C, not C/E. It can only remove a slash, never invent one.
local function readAsRootPosition(key, root, bass, voices)
  if root == bass then return true end
  if (voices[root] or 0) < 2 then return false end
  return root == key.degreePc[0] or root == key.degreePc[2] or root == key.degreePc[4]
end

--[[  Blocks' chords: which roots a chord can have - ScaleView Pro's, at
      ScaleView-for-Reaper `df4ea43`. Starting Blocks builds its chords from
      chord types stacked on a root and from the key's own chords on its
      degrees, and is the dictionary: where the notes are a Blocks chord, the
      name is on one of Blocks' roots for them, the reader's cost choosing
      between them. A chord type counts on any root, in any inversion; the
      key's chords on its degrees. Tables copied unchanged from Starting
      Blocks' `sb_engine.lua` at `fc4dd32`, as Pro has them. ]]
local BLOCKS_CHORDS = {
  {0,4,7}, {0,3,7}, {0,3,6}, {0,4,8}, {0,4,6}, {0,7},
  {0,4,7,9}, {0,3,7,9}, {0,4,7,9,14}, {0,3,7,9,14}, {0,4,7,10}, {0,4,7,11},
  {0,3,7,10}, {0,3,7,11}, {0,3,6,10}, {0,3,6,9}, {0,4,8,10}, {0,4,8,11},
  {0,4,6,10}, {0,3,6,11}, {0,4,7,9,10},
  {0,4,7,10,14}, {0,4,7,11,14}, {0,3,7,10,14}, {0,3,7,11,14}, {0,4,7,10,14,17},
  {0,4,7,11,14,17}, {0,3,7,10,14,17}, {0,4,7,10,14,17,21}, {0,4,7,11,14,17,21},
  {0,3,7,10,14,17,21},
  {0,4,7,10,13}, {0,4,7,10,15}, {0,4,7,10,18}, {0,4,7,10,20}, {0,4,8,10,13},
  {0,4,8,10,15}, {0,4,6,10,13}, {0,4,8,10,13,15}, {0,4,7,10,13,21},
  {0,4,7,11,18}, {0,3,6,10,14}, {0,4,8,10,14}, {0,4,6,10,14}, {0,4,7,10,14,18},
  {0,4,8,11,18}, {0,4,6,10,13,21},
  {0,2,7}, {0,5,7}, {0,5,7,10}, {0,5,7,10,14}, {0,5,7,11}, {0,4,7,14},
  {0,3,7,14}, {0,4,5,7}, {0,4,7,17}, {0,4,7,21}, {0,2,4,7}, {0,2,3,7},
  {0,5,10}, {0,5,10,15}, {0,7,14}, {0,2,4}, {0,1,2}, {0,2,4,5},
  {0,6,10,16,21,26}, {0,4,6,7,10,13}, {0,6,10,15}, {0,5,10,15,19}, {0,5,6,7},
  {0,1,6}, {0,6,7}, {0,1,4,5,8,9}, {0,7,9,13,16}, {0,8,11,16,21}, {0,4,10},
  {0,4,6,10}, {0,4,7,10},
}
-- Scale degrees above the one chosen: triad, 7th, 9th, 11th, 13th, 6th,
-- sus2, sus4, 5th.
local BLOCKS_DIATONIC = {
  {0,2,4}, {0,2,4,6}, {0,2,4,6,8}, {0,2,4,6,8,10}, {0,2,4,6,8,10,12},
  {0,2,4,5}, {0,1,4}, {0,3,4}, {0,4},
}

-- A set of pitch classes as a 12-bit mask, read from a root.
local function maskFrom(classes, root)
  local mask = 0
  for pc in pairs(classes) do mask = mask | (1 << ((pc - root) % 12)) end
  return mask
end

-- Every chord type, as the pitch classes it holds above its root.
local BLOCKS_TYPES = {}
for _, shape in ipairs(BLOCKS_CHORDS) do
  local mask = 0
  for _, interval in ipairs(shape) do mask = mask | (1 << (interval % 12)) end
  BLOCKS_TYPES[mask] = true
end

-- The key's own chords, built once per key and kept on it.
local function blocksKeyChords(key)
  if not key.blocksChords then
    local intervals, chords = M.SCALES[key.scale].iv, {}
    local n = #intervals
    local function pitch(degree)
      local octave = degree // n
      return key.tonic + intervals[degree - octave * n + 1] + 12 * octave
    end
    for degree = 0, n - 1 do
      local root = pitch(degree) % 12
      for _, offsets in ipairs(BLOCKS_DIATONIC) do
        local mask = 0
        for _, o in ipairs(offsets) do mask = mask | (1 << (pitch(degree + o) % 12)) end
        chords[mask] = chords[mask] or {}
        chords[mask][root] = true
      end
    end
    key.blocksChords = chords
  end
  return key.blocksChords
end

-- The roots Blocks builds these notes on, or nil if it builds them on none.
local function blocksRoots(classes, key)
  local roots, any = {}, false
  local inKey = blocksKeyChords(key)[maskFrom(classes, 0)] or {}
  for root = 0, 11 do
    if classes[root] and (inKey[root] or BLOCKS_TYPES[maskFrom(classes, root)]) then
      roots[root], any = true, true
    end
  end
  return any and roots or nil
end

--[[  pitches: a list of MIDI note numbers sounding together. Returns the
      symbol, the root's pitch class and the bass's pitch class. Where the
      notes are an interval rather than a chord, the symbol reads them out and
      the root is nil. ]]
function M.nameChord(pitches, key)
  key = key or ASSUMED
  local classes, bassNote, voices = {}, nil, {}
  for _, p in ipairs(pitches) do
    local pc = p % 12
    classes[pc] = true
    voices[pc] = (voices[pc] or 0) + 1
    if not bassNote or p < bassNote then bassNote = p end
  end
  if not bassNote then return nil end
  local bass = bassNote % 12

  local count = 0
  for _ in pairs(classes) do count = count + 1 end
  if count == 1 then return chordNoteName(key, bass), bass, bass end

  local function spellOut()
    local spelled = {}
    for pc = 0, 11 do
      if classes[pc] then spelled[#spelled + 1] = chordNoteName(key, pc) end
    end
    return table.concat(spelled, " ")
  end

  local function slashed(root, name)
    if not readAsRootPosition(key, root, bass, voices) then
      name = name .. "/" .. chordNoteName(key, bass)
    end
    return name
  end

  --[[  A Blocks chord is named on one of Blocks' roots for it, chosen the way
      the reader below chooses - the cheaper reading, then the key, then no
      slash, then the commoner quality - two notes as the reader names two
      notes from a root. ]]
  local blocks = blocksRoots(classes, key)
  if blocks then
    local pick
    for root = 0, 11 do
      if blocks[root] then
        local has = {}
        for pc = 0, 11 do
          if classes[pc] then has[(pc - root) % 12] = true end
        end
        local quality, cost, rank = analyse(has, root, bass)
        if count == 2 then
          quality = (has[7] and "5") or (has[4] and "maj(no5)")
                 or (has[3] and "min(no5)") or quality
        end
        local fit = key.pcs[root] and 100 or 0
        for pc = 0, 11 do
          if classes[pc] and key.pcs[pc] then fit = fit + 1 end
        end
        local slash = root ~= bass
        if not pick or cost < pick.cost
           or (cost == pick.cost and fit > pick.fit)
           or (cost == pick.cost and fit == pick.fit and pick.slash and not slash)
           or (cost == pick.cost and fit == pick.fit and slash == pick.slash
               and rank < pick.rank) then
          pick = { root = root, cost = cost, fit = fit, slash = slash,
                   rank = rank, quality = quality }
        end
      end
    end
    return slashed(pick.root, chordNoteName(key, pick.root) .. pick.quality), pick.root, bass
  end

  -- Two notes are an interval, except a bare fifth and a third.
  if count == 2 then
    for root = 0, 11 do
      if classes[root] and classes[(root + 7) % 12] then
        return slashed(root, chordNoteName(key, root) .. "5"), root, bass
      end
    end
    for root = 0, 11 do
      if classes[root] then
        local quality = (classes[(root + 4) % 12] and "maj")
                     or (classes[(root + 3) % 12] and "min")
        if quality then
          return slashed(root, chordNoteName(key, root) .. quality .. "(no5)"), root, bass
        end
      end
    end
    return spellOut(), nil, bass
  end

  -- Past a certain thickness there is no chord left to find, only a cluster.
  if count > 7 then return spellOut(), nil, bass end

  local best
  for root = 0, 11 do
    if classes[root] then
      local has = {}
      for pc = 0, 11 do
        if classes[pc] then has[(pc - root) % 12] = true end
      end
      local name, cost, rank = analyse(has, root, bass)
      local fit = key.pcs[root] and 100 or 0
      for pc = 0, 11 do
        if classes[pc] and key.pcs[pc] then fit = fit + 1 end
      end
      --[[  After the key, a draw goes to the reading that needs no slash, and
          only then to the commoner quality. C D G Bb over C cost the same as
          C7sus2 and as Gmin add11 over C, and the minor triad's rank won it:
          a slash nobody needed, chosen by a tiebreak. ]]
      local slash = root ~= bass
      if not best or cost < best.cost
         or (cost == best.cost and fit > best.fit)
         or (cost == best.cost and fit == best.fit and best.slash and not slash)
         or (cost == best.cost and fit == best.fit and slash == best.slash
             and rank < best.rank) then
        best = { root = root, name = name, cost = cost, rank = rank, fit = fit,
                 slash = slash }
      end
    end
  end

  return slashed(best.root, chordNoteName(key, best.root) .. best.name), best.root, bass
end

------------------------------------------------------------------------------
-- Roman numerals
--
-- A numeral says where a chord sits in the key, which is the thing a symbol
-- cannot: C G Amin F and G D Emin C are the same progression, I V vi IV.
-- Upper case for a major third, lower case for a minor one, the way every
-- harmony textbook writes them.
------------------------------------------------------------------------------

local NUMERALS = { "I", "II", "III", "IV", "V", "VI", "VII" }

-- The quality of a chord from its intervals above the root (a set), as the
-- two things a numeral shows: its third and fifth, and its seventh.
function M.quality(has)
  local third = has[4] and "maj" or (has[3] and "min") or "none"
  local fifth = has[7] and "P" or (has[6] and "b") or (has[8] and "#") or "P"
  local triad = (third == "min" and fifth == "b" and "dim")
             or (third == "maj" and fifth == "#" and "aug")
             or (third == "min" and "min") or "maj"
  local seventh = (has[10] and "b7") or (has[11] and "maj7")
               or (triad == "dim" and has[9] and "dim7") or "none"
  return triad, seventh
end

--[[  The numeral for a chord on rootPc with the given interval set.

      A root in the key takes its degree. A root outside it is written as the
      nearest degree flattened - bVII, bVI, bIII are the chords borrowed from
      the parallel minor, and that is how they are always written - except a
      root a semitone under the tonic, which is the raised seventh, #vii. ]]
function M.numeral(key, rootPc, has)
  rootPc = rootPc % 12
  local triad, seventh = M.quality(has)
  local base
  local d = key.degree[rootPc]
  if d then
    base = NUMERALS[d + 1]
  elseif (rootPc + 1) % 12 == key.tonic then
    base = "#" .. NUMERALS[7]
  else
    local up = key.degree[(rootPc + 1) % 12]
    if up then base = "b" .. NUMERALS[up + 1]
    else base = "#" .. NUMERALS[(key.degree[(rootPc - 1) % 12] or 0) + 1] end
  end
  if triad == "min" or triad == "dim" then base = base:lower() end
  local mark = (triad == "dim" and (seventh == "b7" and "ø7" or "°"))
            or (triad == "aug" and "+") or ""
  if triad == "dim" and seventh == "dim7" then mark = "°7" end
  local sev = ""
  if triad ~= "dim" then
    sev = (seventh == "b7" and "7") or (seventh == "maj7" and "maj7") or ""
  end
  return base .. mark .. sev
end

return M
