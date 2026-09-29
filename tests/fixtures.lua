--[[ Music to test with, written out as notes.

     Each is a list of { pitch, start, len, vel } in quarter notes from the
     first bar line, which is exactly what mv_place hands the engine. The
     tunes are traditional; the progressions are the schemata every pop
     harmony text lists.
]]

local F = {}

local function line(spec, octave)
  -- spec: { {pitch, beats}, ... } laid end to end; pitch nil is a rest.
  local out, t = {}, 0
  for _, s in ipairs(spec) do
    if s[1] then out[#out + 1] = { pitch = s[1] + (octave or 0), start = t, len = s[2], vel = 100 } end
    t = t + s[2]
  end
  return out
end

local function chords(spec, bassOctave)
  -- spec: { { {pitches}, beats }, ... }; the first pitch is doubled an octave
  -- or two down as a bass when bassOctave is given.
  local out, t = {}, 0
  for _, s in ipairs(spec) do
    for _, p in ipairs(s[1]) do
      out[#out + 1] = { pitch = p, start = t, len = s[2], vel = 100 }
    end
    if bassOctave then
      out[#out + 1] = { pitch = s[1][1] - bassOctave, start = t, len = s[2], vel = 100 }
    end
    t = t + s[2]
  end
  return out
end
F.line, F.chords = line, chords

-- Twinkle Twinkle Little Star, first phrase, in C. Four bars of 4/4.
F.twinkle = line({
  { 60, 1 }, { 60, 1 }, { 67, 1 }, { 67, 1 }, { 69, 1 }, { 69, 1 }, { 67, 2 },
  { 65, 1 }, { 65, 1 }, { 64, 1 }, { 64, 1 }, { 62, 1 }, { 62, 1 }, { 60, 2 },
})

-- Ode to Joy, first phrase, in C. Four bars of 4/4, ending on the dominant's
-- note - a half cadence, which a harmoniser ought to be able to hear.
F.ode = line({
  { 64, 1 }, { 64, 1 }, { 65, 1 }, { 67, 1 }, { 67, 1 }, { 65, 1 }, { 64, 1 }, { 62, 1 },
  { 60, 1 }, { 60, 1 }, { 62, 1 }, { 64, 1 }, { 64, 1.5 }, { 62, 0.5 }, { 62, 2 },
})

-- A minor tune: rises through the triad, falls back to its tonic through the
-- raised seventh. Four bars of 4/4.
F.minorTune = line({
  { 69, 1 }, { 72, 1 }, { 76, 2 }, { 74, 1 }, { 72, 1 }, { 71, 2 },
  { 69, 1 }, { 71, 1 }, { 72, 1 }, { 71, 1 }, { 69, 1 }, { 68, 1 }, { 69, 2 },
})

-- I V vi IV in C, block chords a bar each, with a bass an octave down.
F.popChords = chords({
  { { 60, 64, 67 }, 4 }, { { 55, 59, 62 }, 4 }, { { 57, 60, 64 }, 4 }, { { 53, 57, 60 }, 4 },
}, 12)

-- The same progression strummed: each chord struck on every beat.
do
  local spec = {}
  for _, ch in ipairs({ { 60, 64, 67 }, { 59, 62, 67 }, { 60, 64, 69 }, { 60, 65, 69 } }) do
    for _ = 1, 4 do spec[#spec + 1] = { ch, 1 } end
  end
  F.strummed = chords(spec)
end

-- i iv V i in A minor, arpeggiated in eighths with the notes left ringing
-- until the bar ends: no two notes are ever struck together.
do
  local out = {}
  local bars = { { 57, 60, 64, 69 }, { 62, 65, 69, 74 }, { 64, 68, 71, 76 }, { 57, 60, 64, 69 } }
  for b, ch in ipairs(bars) do
    for i = 0, 7 do
      local start = (b - 1) * 4 + i * 0.5
      out[#out + 1] = { pitch = ch[i % 4 + 1], start = start, len = (b * 4) - start, vel = 100 }
    end
  end
  F.arpeggios = out
end

-- ii V I in C with the chords held and a bass walking in quarters under them.
do
  local out = chords({ { { 62, 65, 69, 72 }, 4 }, { { 59, 62, 65, 67 }, 4 }, { { 60, 64, 67, 71 }, 8 } })
  local walk = { 38, 40, 41, 43, 43, 41, 40, 38, 36, 36, 36, 36, 36, 36, 36, 36 }
  for i, p in ipairs(walk) do out[#out + 1] = { pitch = p, start = i - 1, len = 1, vel = 100 } end
  F.walking = out
end


------------------------------------------------------------------------------
-- Added for Midi Variator: the kinds of thing people vary.
------------------------------------------------------------------------------

-- A slow, brooding motif in D minor - the sort a crime drama repeats under
-- every scene. Two bars, played four times: bar 2 answers bar 1.
do
  local bars = {}
  for rep = 0, 3 do
    local o = rep * 8
    for _, s in ipairs({
      { 62, 0, 1.5 }, { 65, 1.5, 0.5 }, { 69, 2, 1 }, { 67, 3, 1 },
      { 65, 4, 1.5 }, { 64, 5.5, 0.5 }, { 62, 6, 2 },
    }) do
      bars[#bars + 1] = { pitch = s[1], start = o + s[2], len = s[3], vel = 90 }
    end
  end
  F.noir = bars
end

-- A piano part: a melody on top of held chords with a bass, everything in
-- one item - what an imported piano MIDI file looks like.
do
  local out = chords({ { { 57, 60, 64 }, 4 }, { { 53, 57, 60 }, 4 }, { { 55, 59, 62 }, 4 }, { { 52, 56, 59 }, 4 } }, 12)
  local tune = line({ { 76, 1 }, { 74, 0.5 }, { 72, 0.5 }, { 71, 2 },
                      { 72, 1 }, { 74, 1 }, { 76, 2 },
                      { 74, 1 }, { 71, 1 }, { 67, 2 },
                      { 68, 1 }, { 71, 1 }, { 76, 2 } })
  for _, n in ipairs(tune) do out[#out + 1] = n end
  F.piano = out
end

-- A drum beat on channel 10 (9 counting from 0): kick, snare, hats in eighths.
do
  local out = {}
  for bar = 0, 1 do
    for i = 0, 7 do
      local t = bar * 4 + i * 0.5
      out[#out + 1] = { pitch = 42, start = t, len = 0.25, vel = 80, chan = 9 }
      if i == 0 or i == 5 then out[#out + 1] = { pitch = 36, start = t, len = 0.25, vel = 110, chan = 9 } end
      if i == 2 or i == 6 then out[#out + 1] = { pitch = 38, start = t, len = 0.25, vel = 105, chan = 9 } end
    end
  end
  F.drums = out
end

-- Triplets: a 12/8-ish feel written in 4/4.
do
  local out = {}
  local ps = { 60, 64, 67, 72, 67, 64, 60, 64, 67, 72, 67, 64 }
  for i, p in ipairs(ps) do out[#out + 1] = { pitch = p, start = (i - 1) / 3, len = 1 / 3, vel = 96 } end
  F.triplets = out
end

-- A fast run in sixteenths, up and down a G major scale.
do
  local out = {}
  local ps = { 67, 69, 71, 72, 74, 76, 78, 79, 78, 76, 74, 72, 71, 69, 67, 67 }
  for i, p in ipairs(ps) do out[#out + 1] = { pitch = p, start = (i - 1) * 0.25, len = 0.25, vel = 100 } end
  F.run = out
end

-- A staccato riff in E minor with rests - somewhere for a pickup to go.
F.riff = line({
  { 64, 0.5 }, { nil, 0.5 }, { 67, 0.5 }, { 64, 0.5 }, { nil, 1 }, { 71, 0.5 }, { 69, 0.5 },
  { 67, 0.5 }, { nil, 0.5 }, { 66, 0.5 }, { 64, 0.5 }, { nil, 1 }, { 62, 0.5 }, { 64, 1.5 },
})

-- A single held note: almost nothing to vary.
F.single = { { pitch = 60, start = 0, len = 4, vel = 100 } }

return F
