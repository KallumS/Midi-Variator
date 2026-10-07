--[[ The variation engine, on every fixture and many seeds.

     The promises it makes, each checked here:

       - A variation is made from the original, never from the variation
         before it: the twentieth is as close as the first.
       - The changes are small: few, one per moment, in the key, no new
         grinding clashes, inside the item.
       - The first and last notes stay, when asked.
       - Each switch in the window does what it says and nothing else.

       lua5.4 tests/test_vary.lua
]]

local HERE = (arg and arg[0] or ""):match("^(.*)[/\\]") or "."
local C = dofile(HERE .. "/check.lua")
local ok, eq = C.ok, C.eq
local T = dofile(C.SCRIPTS .. "mv_theory.lua")
local V = dofile(C.SCRIPTS .. "mv_vary.lua")
local F = dofile(HERE .. "/fixtures.lua")

local NAMES = { "twinkle", "ode", "minorTune", "popChords", "strummed", "arpeggios", "walking",
                "noir", "piano", "drums", "triplets", "run", "riff", "single" }
local SEEDS = 40

local function source(notes)
  local finish = 0
  for _, n in ipairs(notes) do finish = math.max(finish, n.start + n.len) end
  return { notes = notes, lead = 0, beats = math.ceil(finish / 4 - 1e-9) * 4, barBeats = 4, pulse = 1 }
end

-- Develop (the bigger changes near 100%) is off unless a test turns it on:
-- every older promise is about the small moves, and develop has its own.
local function opts(changes)
  local o = V.defaults()
  o.develop = false
  for k, x in pairs(changes or {}) do o[k] = x end
  return o
end

local function feelOff(o)
  o.timing, o.velocity, o.lengths = false, false, false
  return o
end

local function only(kind, amount)
  local o = feelOff(opts({ amount = amount or 1 }))
  for _, k in ipairs(V.KINDS) do o[k.key] = (k.key == kind) end
  return o
end

local function fingerprint(notes)
  local out = {}
  for _, n in ipairs(notes) do
    out[#out + 1] = ("%d@%.4f+%.4f v%d c%d"):format(n.pitch, n.start, n.len, n.vel, n.chan or 0)
  end
  return table.concat(out, " ")
end

local function harshTime(notes, betweenMomentsOnly, sameChord)
  -- Time two notes a semitone (or major seventh, minor ninth) apart sound
  -- together, ignoring overlaps too short to hear as a clash. With
  -- betweenMomentsOnly, two notes struck together in one chord do not count.
  local t = 0
  for i = 1, #notes do
    for j = i + 1, #notes do
      local a, b = notes[i], notes[j]
      local together = betweenMomentsOnly and math.abs(a.start - b.start) < 0.13
      if sameChord and sameChord(a, b) then together = true end
      if (a.chan or 0) ~= 9 and (b.chan or 0) ~= 9 and not together then
        local d = math.abs(a.pitch - b.pitch) % 12
        if d == 1 or d == 11 then
          local o = math.min(a.start + a.len, b.start + b.len) - math.max(a.start, b.start)
          if o > 0.15 then t = t + o end
        end
      end
    end
  end
  return t
end

------------------------------------------------------------------------------
-- Reading the original
------------------------------------------------------------------------------

do
  local an = V.analyse(source(F.twinkle), T)
  eq(#an.events, 14, "Twinkle: fourteen moments")
  eq(an.grid, 1, "on a quarter-note grid")
  eq(an.unit, 0.5, "varied in eighths")
  eq(an.key.label, "C Major", "in C major")

  an = V.analyse(source(F.popChords), T)
  eq(#an.events, 4, "four chords are four moments")
  eq(#an.events[1].notes, 4, "each with its bass")

  an = V.analyse(source(F.noir), T)
  eq(an.key.label, "D Minor (Natural)", "the noir motif is in D minor")
  ok(an.scale[10] and not an.scale[11], "so its scale has Bb, not B")

  -- A piece in A minor ending on E major (a half cadence) reads as E minor
  -- to a key finder tuned on melodies - and E minor's F# is nowhere in it.
  an = V.analyse(source(F.piano), T)
  ok(not an.pcs[6], "the piano piece's steps never offer an F# it does not play")
  ok(an.pcs[8], "but do offer the G# it does")
  ok(not an.scale[8], "though not for chord colours, which stay diatonic")

  eq(V.analyse(source(F.triplets), T).grid, 1 / 3, "triplets are read as triplets")
  eq(V.analyse(source(F.run), T).grid, 0.25, "a sixteenth run on sixteenths")
  ok(V.analyse(source(F.drums), T).drums, "channel 10 is drums")

  eq(V.strength(0, 4, 1), 3, "the bar line is strongest")
  eq(V.strength(2, 4, 1), 2, "then the beat")
  eq(V.strength(2.5, 4, 1), 1, "then the half beat")
  eq(V.strength(2.25, 4, 1), 0, "then anything else")
  eq(V.strength(1.5, 3, 1.5), 2, "in 6/8 the dotted quarter is the beat")

  eq(V.where(5.5, 4, 1), "Bar 2, beat 2.5", "positions named in bars and beats")
  eq(V.where(0, 4, 1), "Bar 1, beat 1", "from one")
end

------------------------------------------------------------------------------
-- The same seed, the same variation; the original never touched
------------------------------------------------------------------------------

for _, name in ipairs(NAMES) do
  local src = source(F[name])
  local before = fingerprint(V.copyNotes(src.notes))
  local an = V.analyse(src, T)
  local a = V.vary(src, an, opts({ amount = 1 }), 99, T)
  -- Anything in between must not matter: nothing accumulates.
  for s = 1, 30 do V.vary(src, an, opts({ amount = 1 }), s, T) end
  local b = V.vary(src, an, opts({ amount = 1 }), 99, T)
  eq(fingerprint(b.notes), fingerprint(a.notes), name .. ": a seed always gives the same variation")
  eq(table.concat(b.changes, "|"), table.concat(a.changes, "|"), name .. ": with the same changes")
  eq(fingerprint(V.copyNotes(src.notes)), before, name .. ": the original is never changed")
  eq(fingerprint(V.analyse(src, T).events[1].notes), fingerprint(an.events[1].notes),
     name .. ": nor is its analysis")
end

------------------------------------------------------------------------------
-- Every variation of every fixture, at every amount: small and playable
------------------------------------------------------------------------------

local seen = {}
for _, name in ipairs(NAMES) do
  local src = source(F[name])
  local an = V.analyse(src, T)
  local origHarsh = harshTime(src.notes)
  local function key(n) return ("%d@%.9f+%.9f"):format(n.pitch, n.start, n.len) end
  local asWritten = {}
  for _, n in ipairs(src.notes) do asWritten[key(n)] = true end
  local drumPitches = {}
  for _, n in ipairs(src.notes) do if n.chan == 9 then drumPitches[n.pitch] = true end end
  for _, amount in ipairs({ 0.2, 0.35, 0.7, 1 }) do
    local _, cap = V.budget(amount, #src.notes)
    for seed = 1, SEEDS do
      local tag = ("%s at %d%%, seed %d"):format(name, amount * 100, seed)
      local var = V.vary(src, an, opts({ amount = amount }), seed, T)
      for _, c in ipairs(var.moves) do seen[c.move] = true end

      if not ok(#var.changes <= cap, tag .. ": no more changes than the cap") then break end
      local moments = {}
      for _, c in ipairs(var.moves) do
        if not ok(not moments[c.event], tag .. ": one change per moment") then break end
        moments[c.event] = true
      end
      for i = 2, #var.moves do
        if not ok(var.moves[i].at >= var.moves[i - 1].at, tag .. ": changes listed in time order") then break end
      end

      local bad
      for _, n in ipairs(var.notes) do
        if n.start < src.lead - 1e-9 or n.start + n.len > src.beats + 1e-9 then bad = "outside the item" end
        if n.len < V.MIN_LEN - 1e-9 then bad = "too short to hear" end
        if n.vel < 1 or n.vel > 127 or n.vel ~= math.floor(n.vel) then bad = "a velocity MIDI cannot carry" end
        if n.chan == 9 then
          if not drumPitches[n.pitch] then bad = "a drum that was not in the original" end
        elseif not an.pcs[n.pitch % 12] then
          bad = "a note outside the key: " .. n.pitch
        end
      end
      if not ok(not bad, tag .. ": every note playable and in key (" .. tostring(bad) .. ")") then break end

      -- Unless the original itself overlaps them, exactly as written.
      local last = {}
      for _, n in ipairs(var.notes) do
        local k = (n.chan or 0) * 128 + n.pitch
        local p = last[k]
        if p and p.start + p.len > n.start + 1e-9 and not (asWritten[key(p)] and asWritten[key(n)]) then
          bad = "two of one pitch overlapping"
        end
        last[k] = n
      end
      if not ok(not bad, tag .. ": " .. tostring(bad)) then break end

      -- A changed chord quality brings its own colour - Cmaj7's B against
      -- its C is the point - so there the test is that the chord grinds
      -- against nothing else (below). Everywhere else: nothing new grinds.
      local qualityChanged = false
      for _, c in ipairs(var.moves) do if c.kind == "quality" then qualityChanged = true end end
      if not ok(harshTime(var.notes, qualityChanged) <= origHarsh + 1.01,
                tag .. ": no new grinding clash longer than a beat") then break end

      -- Keeps the first and the last: the notes struck there are still
      -- struck there, at the same pitches.
      local first, last = an.events[1], an.events[#an.events]
      for _, e in ipairs({ first, last }) do
        for _, n in ipairs(e.notes) do
          local found = false
          for _, m in ipairs(var.notes) do
            if m.pitch == n.pitch and math.abs(m.start - n.start) < 0.13 then found = true end
          end
          if not ok(found, tag .. ": keeps the first and last notes") then break end
        end
      end

      local like = V.likeness(src.notes, var.notes)
      local floor = amount <= 0.35 and 0.75 or 0.55
      if #src.notes >= 8 and not ok(like >= floor, tag .. (": still sounds like the original (%d%%)"):format(math.floor(like * 100))) then
        break
      end
    end
  end
end

-- The cap bites on short material: two notes never get two changes, even
-- at full amount with the ends unprotected.
do
  local src = source({ { pitch = 60, start = 0, len = 2, vel = 100 }, { pitch = 64, start = 2, len = 2, vel = 100 } })
  local an = V.analyse(src, T)
  local _, cap = V.budget(1, 2)
  eq(cap, 1, "two notes: a cap of one change")
  local most = 0
  for seed = 1, 60 do
    local var = V.vary(src, an, opts({ amount = 1, keepEnds = false }), seed, T)
    most = math.max(most, #var.changes)
  end
  eq(most, 1, "and never more than one")
end

-- Every move gets used somewhere, or its tests above tested nothing.
for name in pairs(V.MOVES) do ok(seen[name], "the " .. name .. " move is reached by some fixture") end

------------------------------------------------------------------------------
-- Twenty in a row still sound like the original
------------------------------------------------------------------------------

for _, name in ipairs({ "noir", "twinkle", "piano", "popChords" }) do
  local src = source(F[name])
  local an = V.analyse(src, T)
  local run = V.series(src, an, opts({ amount = 0.5 }), 777, 20, T)
  eq(#run, 20, name .. ": twenty variations")
  local early, late = 0, 0
  for i = 1, 10 do early = early + V.likeness(src.notes, run[i].notes) end
  for i = 11, 20 do late = late + V.likeness(src.notes, run[i].notes) end
  ok(late >= early - 0.5, ("%s: the last ten are as close as the first ten (%.2f vs %.2f)"):format(name, late / 10, early / 10))
  local distinct = {}
  for i = 1, 20 do distinct[fingerprint(run[i].notes)] = true end
  local k = 0
  for _ in pairs(distinct) do k = k + 1 end
  eq(k, 20, name .. ": and all twenty are different")
end

-- The series spreads its changes: with its memory, twenty variations change
-- more different moments than twenty made without it.
do
  local src = source(F.noir)
  local an = V.analyse(src, T)
  local o = opts({ amount = 0.35 })
  local function spread(run)
    local where = {}
    for _, var in ipairs(run) do
      for _, c in ipairs(var.moves) do where[c.move .. "@" .. c.event] = true end
    end
    local k = 0
    for _ in pairs(where) do k = k + 1 end
    return k
  end
  local withMemory = spread(V.series(src, an, o, 5, 20, T))
  local without = {}
  for i = 1, 20 do without[i] = V.vary(src, an, o, V.seedFor(5, i - 1), T) end
  ok(withMemory > spread(without), ("a series spreads its changes (%d different changes, %d without memory)")
     :format(withMemory, spread(without)))
  eq(fingerprint(V.series(src, an, o, 5, 1, T)[1].notes), fingerprint(without[1].notes),
     "and the first of a series is the variation the preview shows")
end

-- Grow: the first of a series is gentler than the last.
do
  local src = source(F.noir)
  local an = V.analyse(src, T)
  local first, last = 0, 0
  for seed = 1, 20 do
    local run = V.series(src, an, feelOff(opts({ amount = 1, grow = true })), seed, 8, T)
    first, last = first + #run[1].changes, last + #run[8].changes
  end
  ok(first < last, ("growing: the first variations change less (%d changes vs %d)"):format(first, last))
end

------------------------------------------------------------------------------
-- The switches
------------------------------------------------------------------------------

-- Nothing on: an exact copy. Amount 0 with feel on: no changes to the notes.
for _, name in ipairs(NAMES) do
  local src = source(F[name])
  local an = V.analyse(src, T)
  local var = V.vary(src, an, feelOff(opts({ amount = 0 })), 3, T)
  eq(fingerprint(var.notes), fingerprint(V.copyNotes(src.notes)), name .. ": amount 0, feel off - a copy")
  var = V.vary(src, an, opts({ amount = 0 }), 3, T)
  eq(#var.changes, 0, name .. ": amount 0 changes no notes")
  eq(#var.notes, #src.notes, name .. ": and keeps them all")
end

-- Each kind alone does only its own kind of thing.
for _, name in ipairs(NAMES) do
  local src = source(F[name])
  local an = V.analyse(src, T)
  local orig = V.copyNotes(src.notes)
  for seed = 1, 15 do
    local tag = name .. " seed " .. seed
    local var = V.vary(src, an, only("notes"), seed, T)
    eq(#var.notes, #orig, tag .. ": Notes alone adds and removes nothing")
    local moved = 0
    for i, n in ipairs(var.notes) do
      local o = orig[i]
      if o and n.pitch ~= o.pitch then
        moved = moved + 1
        local d = math.abs(n.pitch - o.pitch)
        ok(d <= 2 or d == 12, tag .. ": a note moves a step or an octave, no further")
      end
      if o then ok(math.abs(n.start - o.start) < 1e-9, tag .. ": Notes alone leaves the rhythm alone") end
    end
    ok(moved == #var.changes, tag .. ": each change moves one note")

    var = V.vary(src, an, only("add"), seed, T)
    ok(#var.notes >= #orig, tag .. ": Add notes never takes one away")
    var = V.vary(src, an, only("remove"), seed, T)
    ok(#var.notes <= #orig, tag .. ": Leave notes out never adds one")
    ok(#var.notes >= #orig - #var.changes, tag .. ": one note per change")

    var = V.vary(src, an, only("rhythm"), seed, T)
    local pcsBefore, pcsAfter = {}, {}
    for _, n in ipairs(orig) do pcsBefore[n.pitch] = true end
    for _, n in ipairs(var.notes) do pcsAfter[n.pitch] = true end
    for p in pairs(pcsAfter) do ok(pcsBefore[p], tag .. ": Rhythm alone plays no new pitch") end
  end
end

-- Drums: no pitch ever moves, whatever is switched on.
do
  local src = source(F.drums)
  local an = V.analyse(src, T)
  for seed = 1, 30 do
    local var = V.vary(src, an, feelOff(opts({ amount = 1 })), seed, T)
    for _, c in ipairs(var.moves) do
      ok(c.move ~= "neighbour" and c.move ~= "octave" and c.kind ~= "chords",
         "drums: no pitch or chord moves (" .. c.move .. ")")
    end
  end
end

-- Keep the first and last off: the ends can change too.
do
  local src = source(F.twinkle)
  local an = V.analyse(src, T)
  local touchedEnd = false
  for seed = 1, 200 do
    local var = V.vary(src, an, only("notes"), seed, T)
    for _, c in ipairs(var.moves) do if c.event == 1 or c.event == 14 then touchedEnd = true end end
  end
  ok(not touchedEnd, "kept: the first and last notes never change")
  local o = only("notes"); o.keepEnds = false
  for seed = 1, 200 do
    local var = V.vary(src, an, o, seed, T)
    for _, c in ipairs(var.moves) do if c.event == 1 or c.event == 14 then touchedEnd = true end end
  end
  ok(touchedEnd, "not kept: they can")
end

-- Where: towards the end puts the changes later than towards the start.
do
  local src = source(F.noir)
  local an = V.analyse(src, T)
  local function mean(focus)
    local sum, k = 0, 0
    for seed = 1, 60 do
      local o = opts({ amount = 0.6, focus = focus })
      for _, c in ipairs(V.vary(src, an, o, seed, T).moves) do sum, k = sum + c.at, k + 1 end
    end
    return sum / k
  end
  local toEnd, toStart, anywhere = mean(2), mean(3), mean(1)
  ok(toEnd > anywhere + 2 and anywhere > toStart + 2,
     ("Where moves the changes (start %.1f, anywhere %.1f, end %.1f)"):format(toStart, anywhere, toEnd))
end

-- Feel alone stays inside its limits and changes no pitch or count.
do
  local src = source(F.noir)
  local an = V.analyse(src, T)
  local orig = V.copyNotes(src.notes)
  for seed = 1, 30 do
    local o = opts({ amount = 1 })
    for _, k in ipairs(V.KINDS) do o[k.key] = false end
    o.velocity, o.lengths = false, false
    local var = V.vary(src, an, o, seed, T)
    eq(#var.notes, #orig, "timing alone keeps every note")
    for i, n in ipairs(var.notes) do
      ok(math.abs(n.start - orig[i].start) <= V.TIMING_MAX + V.TIMING_CHORD + 1e-9 or orig[i].start == 0,
         "timing moves a note by no more than " .. V.TIMING_MAX + V.TIMING_CHORD)
    end
    o.timing, o.velocity = false, true
    var = V.vary(src, an, o, seed, T)
    for i, n in ipairs(var.notes) do
      ok(math.abs(n.vel - orig[i].vel) <= 3 * V.VEL_WHOLE + V.VEL_SWELL + V.VEL_JITTER + 1,
         "velocity changes by no more than a few steps")
      eq(n.start, orig[i].start, "velocity alone moves nothing")
    end
    o.velocity, o.lengths = false, true
    var = V.vary(src, an, o, seed, T)
    for i, n in ipairs(var.notes) do
      local ratio = n.len / orig[i].len
      ok(ratio >= (1 - V.LEN_WHOLE) * (1 - V.LEN_NOTE) - 1e-9 and ratio <= (1 + V.LEN_WHOLE) * (1 + V.LEN_NOTE) + 1e-9
         or n.start + n.len >= src.beats - 1e-9, "lengths change by a few percent")
    end
  end
end

------------------------------------------------------------------------------
-- Keeping the original inside a variation
------------------------------------------------------------------------------

do
  local notes = { { pitch = 60, start = 0, len = 1, vel = 100, chan = 0 },
                  { pitch = 64, start = 1 / 3, len = 0.123456, vel = 7, chan = 9 } }
  local text = V.encode(notes, 8, "Motif | with a bar", 3)
  local back, length, name, index = V.decode(text)
  eq(length, 8, "the length comes back")
  eq(index, 3, "and which variation it was")
  eq(name, "Motif   with a bar", "and the name, with the separator made safe")
  eq(#back, 2, "and the notes")
  eq(back[2].chan, 9, "with their channels")
  ok(math.abs(back[2].start - 1 / 3) < 1e-6, "to a millionth of a beat")
  eq(back[2].vel, 7, "and velocities")
  eq(V.decode("nonsense"), nil, "anything else is not read")
  eq(V.decode("MV1|8|0|x|60,0,1"), nil, "nor a damaged note")
  eq(select(1, V.decode(V.encode({}, 4, "", 0)))[1], nil, "an empty original is empty")
  eq(V.likeness(F.twinkle, F.twinkle), 1, "a copy keeps everything")
end

------------------------------------------------------------------------------
-- Picking a scale, pivoting, and staying in the original's notes
------------------------------------------------------------------------------

local function names(sc)
  local out = {}
  for pc = 0, 11 do if sc.pcs[pc] then out[#out + 1] = sc.names[pc] end end
  return table.concat(out, " ")
end
local function picked(root, scale, fit)
  return { root = T.rootIndex(root), scale = V.scaleIndex(scale), fit = fit }
end

do
  eq(#V.SCALES, 16, "ScaleView's sixteen scales")
  eq(names(V.pickedScale(T, T.rootIndex("C"), V.scaleIndex("Minor (Natural)"))), "C D Eb F G Ab Bb",
     "C minor is spelled with flats")
  eq(names(V.pickedScale(T, T.rootIndex("A"), V.scaleIndex("Minor Pentatonic"))), "C D E G A",
     "A minor pentatonic")
  eq(names(V.pickedScale(T, T.rootIndex("C"), V.scaleIndex("Major Blues"))), "C D Eb E G A",
     "C major blues has its Eb and E")
  eq(names(V.pickedScale(T, T.rootIndex("F#"), V.scaleIndex("Major"))), "C# D# E# F# G# A# B",
     "F# major spells E#")
  eq(V.pickedScale(T, T.rootIndex("D"), V.scaleIndex("Dorian")).label, "D Dorian", "labelled")

  -- Pivoting Twinkle from C major to C minor: every E an Eb, every A an Ab.
  local heard = V.analyse(source(F.twinkle), T).heardKey
  local cm = V.pickedScale(T, T.rootIndex("C"), V.scaleIndex("Minor (Natural)"))
  local notes, moved = V.fit(F.twinkle, cm, heard)
  eq(V.describeFit(moved, heard, cm), "E -> Eb, A -> Ab", "C major into C minor: the third and sixth fall")
  eq(#notes, #F.twinkle, "and no note is lost")
  for i, n in ipairs(notes) do
    ok(cm.pcs[n.pitch % 12], "every note is in C minor")
    eq(n.start, F.twinkle[i].start, "none moves in time")
  end
  -- A tie is settled by the letter: E is as near F as Eb, but the third
  -- stays a third.
  ok(moved[1].to == 3, "E becomes Eb, not F")

  -- And back: a C minor tune into C major. Eb is as near D as E; the letter
  -- makes it E, so the minor third becomes the major third, not the second.
  local minor = { { pitch = 60, start = 0, len = 1 }, { pitch = 63, start = 1, len = 1 },
                  { pitch = 67, start = 2, len = 1 }, { pitch = 68, start = 3, len = 1 },
                  { pitch = 70, start = 4, len = 1 }, { pitch = 72, start = 5, len = 3 } }
  local heardMinor = V.analyse(source(minor), T).heardKey
  eq(heardMinor.label, "C Minor (Natural)", "set up: heard in C minor")
  local cmaj = V.pickedScale(T, T.rootIndex("C"), V.scaleIndex("Major"))
  local _, movedUp = V.fit(minor, cmaj, heardMinor)
  eq(V.describeFit(movedUp, heardMinor, cmaj), "Eb -> E, Ab -> A, Bb -> B",
     "C minor into C major: each note rises to its own letter")

  -- Into a pentatonic, the nearest note wins; two notes landing on one
  -- pitch at once become one.
  local cpent = V.pickedScale(T, T.rootIndex("C"), V.scaleIndex("Minor Pentatonic"))
  local chord = { { pitch = 62, start = 0, len = 2, vel = 100, chan = 0 },
                  { pitch = 63, start = 0, len = 1, vel = 90, chan = 0 },
                  { pitch = 67, start = 0, len = 2, vel = 100, chan = 0 } }
  local out = V.fit(chord, cpent, heard)
  eq(#out, 2, "D moves to Eb, which is already there: one Eb")
  eq(out[1].len, 2, "held as long as the longer of the two")

  -- Drums are never fitted.
  local d = V.fit(F.drums, cm, nil)
  eq(fingerprint(d), fingerprint(V.copyNotes(F.drums)), "drums are not moved into a scale")
end

-- Without a pick nothing changes; picking without fitting leaves the
-- original as it is.
do
  local src = source(F.twinkle)
  local same, an = V.prepare(src, T, nil)
  ok(same == src, "nothing picked: the original itself")
  eq(#an.fitted, 0, "and nothing fitted")
  same = V.prepare(src, T, picked("C", "Minor (Natural)", false))
  ok(same == src, "picked but not fitted: the original itself")
  same = V.prepare(src, T, { own = true })
  ok(same == src, "own notes: the original itself")
  -- Picking what was heard fits nothing.
  local back, an2 = V.prepare(src, T, picked("C", "Major", true))
  eq(#an2.fitted, 0, "picking the key it was heard in moves nothing")
  eq(fingerprint(back.notes), fingerprint(V.copyNotes(src.notes)), "so the notes are the original's")
  -- A fitted copy keeps everything else of the source's.
  src.original, src.item = { "the true original" }, "item"
  local fitted = V.prepare(src, T, picked("C", "Minor (Natural)", true))
  ok(fitted ~= src and fitted.original == src.original and fitted.item == "item",
     "a pivoted copy still carries the TRUE original and item")
  ok(src.notes == F.twinkle or fingerprint(src.notes) == fingerprint(F.twinkle), "and the source is untouched")
end

-- Every fixture, pivoted into several scales: every note of every
-- variation in the picked scale. Unfitted: only the original's own notes
-- may be outside it. Own notes: nothing the original does not play.
do
  local PICKS = {
    { "C", "Minor (Natural)" }, { "D", "Dorian" }, { "A", "Minor Pentatonic" },
    { "E", "Phrygian" }, { "C", "Whole Tone" }, { "G", "Major Blues" },
  }
  for _, name in ipairs(NAMES) do
    local src = source(F[name])
    local played = V.analyse(src, T).played
    for _, pk in ipairs(PICKS) do
      local sc = V.pickedScale(T, T.rootIndex(pk[1]), V.scaleIndex(pk[2]))
      local work, an = V.prepare(src, T, picked(pk[1], pk[2], true))
      local loose, anLoose = V.prepare(src, T, picked(pk[1], pk[2], false))
      for seed = 1, 12 do
        local tag = ("%s into %s %s, seed %d"):format(name, pk[1], pk[2], seed)
        local var = V.vary(work, an, opts({ amount = 1 }), seed, T)
        local bad
        for _, n in ipairs(var.notes) do
          if n.chan ~= 9 and not sc.pcs[n.pitch % 12] then bad = n.pitch end
        end
        if not ok(not bad, tag .. ": pivoted, every note in the scale (" .. tostring(bad) .. ")") then break end
        var = V.vary(loose, anLoose, opts({ amount = 1 }), seed, T)
        for _, n in ipairs(var.notes) do
          if n.chan ~= 9 and not sc.pcs[n.pitch % 12] and not played[n.pitch % 12] then bad = n.pitch end
        end
        if not ok(not bad, tag .. ": not pivoted, nothing outside both scale and original") then break end
      end
    end
    local own, anOwn = V.prepare(src, T, { own = true })
    for seed = 1, 20 do
      local var = V.vary(own, anOwn, opts({ amount = 1 }), seed, T)
      local bad
      for _, n in ipairs(var.notes) do
        if n.chan ~= 9 and not played[n.pitch % 12] then bad = n.pitch end
      end
      if not ok(not bad, ("%s, own notes, seed %d: only notes the original plays"):format(name, seed)) then break end
    end
  end
end

-- A step stays a step, whatever the scale: never further than MAX_STEP,
-- even in a pentatonic or with a three-note motif's own notes.
do
  local motif = { { pitch = 60, start = 0, len = 1, vel = 100 }, { pitch = 67, start = 1, len = 1, vel = 100 },
                  { pitch = 72, start = 2, len = 1, vel = 100 }, { pitch = 67, start = 3, len = 1, vel = 100 },
                  { pitch = 60, start = 4, len = 1, vel = 100 }, { pitch = 67, start = 5, len = 1, vel = 100 },
                  { pitch = 72, start = 6, len = 1, vel = 100 }, { pitch = 60, start = 7, len = 1, vel = 100 } }
  for _, pk in ipairs({ { own = true }, picked("C", "Minor Pentatonic", true), picked("C", "Major", true) }) do
    local work, an = V.prepare(source(motif), T, pk)
    for seed = 1, 40 do
      local var = V.vary(work, an, only("notes"), seed, T)
      for i, n in ipairs(var.notes) do
        local d = math.abs(n.pitch - work.notes[i].pitch)
        if not ok(d <= V.MAX_STEP or d == 12, "a step is never more than a major third (" .. d .. ")") then break end
      end
    end
  end
end

------------------------------------------------------------------------------
-- Changing a chord's quality
------------------------------------------------------------------------------

-- The chord reader is ScaleView Pro's, copied unchanged: some of the names
-- ScaleView Pro's own tests assert.
do
  local C4 = 60
  for _, case in ipairs({
    { { C4, C4 + 4, C4 + 7, C4 + 10 }, "C7" }, { { C4, C4 + 4, C4 + 7, C4 + 11 }, "Cmaj7" },
    { { C4, C4 + 3, C4 + 6, C4 + 9 }, "Cdim7" }, { { C4, C4 + 3, C4 + 6, C4 + 10 }, "Cmin7b5" },
    { { C4, C4 + 2, C4 + 4, C4 + 7, C4 + 10 }, "C9" }, { { C4, C4 + 5, C4 + 7 }, "Csus4" },
    { { 52, 55, C4, 71 }, "Cmaj7/E" }, { { 45, C4, 64, 67 }, "Amin7" },
  }) do
    eq((T.nameChord(case[1])), case[2], "ScaleView Pro names " .. case[2])
  end
end

local function qualityOnly(outside)
  local o = only("quality")
  o.outside = outside
  return o
end

local function block(pitches, bars)
  local out = {}
  for b = 0, (bars or 1) - 1 do
    for _, p in ipairs(pitches) do out[#out + 1] = { pitch = p, start = b * 4, len = 4, vel = 100 } end
  end
  return out
end

-- G7 in C major (the bars around it make the key C): what it may become.
do
  local notes = block({ 48, 52, 55, 60 })                                    -- C
  for _, n in ipairs(block({ 43, 59, 62, 65 })) do n.start = n.start + 4; notes[#notes + 1] = n end  -- G7
  for _, n in ipairs(block({ 48, 52, 55, 60 })) do n.start = n.start + 8; notes[#notes + 1] = n end  -- C
  local src = source(notes)
  local an = V.analyse(src, T)
  local seenIn, seenOut = {}, {}
  for seed = 1, 150 do
    for _, c in ipairs(V.vary(src, an, qualityOnly(false), seed, T).moves) do
      if c.move == "quality" then seenIn[c.text:match("became (%S+)")] = true end
    end
    for _, c in ipairs(V.vary(src, an, qualityOnly(true), seed, T).moves) do
      if c.move == "quality" then seenOut[c.text:match("became (%S+)")] = true end
    end
  end
  local function list(t) local o = {}; for k in pairs(t) do o[#o + 1] = k end; table.sort(o); return table.concat(o, " ") end
  -- ScaleView Pro's names: a seventh plus a thirteenth is "G7(13)". The
  -- seventh is this voicing's top note, so it is never dropped.
  ok(seenIn.G9 and seenIn["G7(13)"] and seenIn.G11 and seenIn.G7sus4,
     "in the scale, G7 becomes G9, G7(13), G11 or G7sus4: " .. list(seenIn))
  ok(not seenIn.G, "never G here: its seventh is the top note, and the outline stays")
  ok(not seenIn.G7b9 and not seenIn.Gmin7, "but never G7b9 or Gmin7, whose notes are outside C major")
  ok(seenOut.G7b9, "allowed out of the scale, G7 can become G7b9 - the diminished sound: " .. list(seenOut))
end

-- Every chord fixture, quality alone: the bass never moves, the chord's
-- change grinds against nothing else, and, in the scale, no note leaves it.
for _, name in ipairs({ "popChords", "strummed", "walking", "piano", "arpeggios" }) do
  local src = source(F[name])
  local an = V.analyse(src, T)
  local origHarsh = harshTime(src.notes, true)
  for _, outside in ipairs({ false, true }) do
    for seed = 1, 40 do
      local tag = ("%s, chord quality%s, seed %d"):format(name, outside and " (may leave the scale)" or "", seed)
      local var = V.vary(src, an, qualityOnly(outside), seed, T)
      -- The bass of a chord struck together is its lowest note; of an
      -- arpeggio, the lowest note of the bar.
      local function bassAt(notes, t)
        if name == "arpeggios" then t = math.floor(t / 4) * 4 end
        local lo
        for _, n in ipairs(notes) do
          local at = n.start
          if name == "arpeggios" then at = math.floor(at / 4 + 1e-9) * 4 end
          if math.abs(at - t) < 0.07 then lo = math.min(lo or 999, n.pitch) end
        end
        return lo
      end
      local moved
      for _, e in ipairs(an.events) do
        local was, now = bassAt(src.notes, e.start), bassAt(var.notes, e.start)
        if now and now ~= was then moved = was .. "->" .. now end
      end
      if not ok(not moved, tag .. ": the bass stays (" .. tostring(moved) .. ")") then break end
      -- An arpeggio's notes are one chord, struck one after another: a
      -- changed one's colour (Emaj7's D# over its E) is the point too.
      local changedBar = {}
      for _, c in ipairs(var.moves) do
        if c.move == "arpeggio" then changedBar[math.floor(c.at / 4 + 1e-9)] = true end
      end
      local function sameChord(a, b)
        local ba, bb = math.floor(a.start / 4 + 1e-9), math.floor(b.start / 4 + 1e-9)
        return ba == bb and changedBar[ba]
      end
      if not ok(harshTime(var.notes, true, sameChord) <= origHarsh + 0.26, tag .. ": the new chord grinds against nothing else") then break end
      if not outside then
        local bad
        for _, n in ipairs(var.notes) do if not an.pcs[n.pitch % 12] then bad = n.pitch end end
        if not ok(not bad, tag .. ": every note in the scale") then break end
      end
    end
  end
end

-- A chord struck again and again changes every time it is struck.
do
  local src = source(F.strummed)
  local an = V.analyse(src, T)
  local checked = 0
  for seed = 1, 60 do
    local var = V.vary(src, an, qualityOnly(false), seed, T)
    for _, c in ipairs(var.moves) do
      local times = c.text:match("all (%d+) times")
      if c.move == "quality" and times then
        -- Every moment's notes, as a set; the chosen strike's new chord must
        -- be held by at least that many strikes.
        local at = {}
        for _, n in ipairs(var.notes) do
          local k = math.floor(n.start * 4 + 0.5)
          at[k] = at[k] or {}
          table.insert(at[k], n.pitch)
        end
        local function set(k) local t = at[k] or {}; table.sort(t); return table.concat(t, ",") end
        local target = set(math.floor(c.at * 4 + 0.5))
        local count = 0
        for k in pairs(at) do if set(k) == target then count = count + 1 end end
        ok(count >= tonumber(times), ("a repeated chord changes all %s times (%d)"):format(times, count))
        checked = checked + 1
      end
    end
  end
  ok(checked > 0, "and the strummed fixture has repeated chords changed")
end

-- Arpeggiated chords: which music has them.
local function alberti(chords, bars)
  -- Each chord as bass, top, middle, top in eighths, twice a bar (C G E G).
  local out = {}
  for b, ch in ipairs(chords) do
    for rep = 0, (bars or 1) - 1 do
      for i, k in ipairs({ 1, 3, 2, 3, 1, 3, 2, 3 }) do
        out[#out + 1] = { pitch = ch[k], start = ((b - 1) * (bars or 1) + rep) * 4 + (i - 1) * 0.5, len = 0.5, vel = 90 }
      end
    end
  end
  return out
end
do
  local function broken(notes) return #V.analyse(source(notes), T).broken end
  eq(broken(F.arpeggios), 4, "the arpeggio fixture: a broken chord in every bar")
  eq(broken(alberti({ { 48, 52, 55 }, { 47, 53, 55 }, { 48, 52, 55 } })), 3, "an Alberti bass: one a bar")
  -- Two chords a bar: found in halves.
  local halves = {}
  for b, ch in ipairs({ { 48, 52, 55 }, { 45, 48, 52 } }) do
    for i, k in ipairs({ 1, 2, 3, 2 }) do
      halves[#halves + 1] = { pitch = ch[k], start = (b - 1) * 2 + (i - 1) * 0.5, len = 0.5, vel = 90 }
    end
  end
  eq(broken(halves), 2, "two arpeggios in one bar: found by halves")
  -- A tune that outlines a chord once, up and back down, is a tune: an
  -- accompaniment goes round and round its chord.
  local once = {}
  for i, p in ipairs({ 62, 65, 69, 72, 71, 67, 64, 60 }) do
    once[#once + 1] = { pitch = p, start = (i - 1), len = 1, vel = 90 }
  end
  eq(broken(once), 0, "a tune outlining a chord once is not an accompaniment")
  for _, name in ipairs({ "twinkle", "ode", "minorTune", "noir", "run", "riff", "triplets", "popChords", "piano", "drums" }) do
    local k = broken(F[name])
    ok(name == "triplets" and k >= 0 or k == 0, name .. ": no broken chords found (" .. k .. ")")
  end
end

-- Arpeggios change by the chord-quality rules: the rhythm and the number
-- of notes stay, the lowest note of the bar stays, the change is named in
-- ScaleView Pro's words - and the same arpeggio bar after bar changes as one.
do
  -- C, G7, C/E (its bass the third, E C G C) and C, two bars each.
  local notes = alberti({ { 48, 52, 55 }, { 43, 53, 59 }, { 52, 55, 60 }, { 48, 52, 55 } }, 2)
  local src = source(notes)
  local an = V.analyse(src, T)
  eq(#an.broken, 8, "set up: eight bars of Alberti bass")
  local orig = V.copyNotes(src.notes)
  local seen, together = {}, 0
  for seed = 1, 80 do
    local var = V.vary(src, an, qualityOnly(false), seed, T)
    local tag = "Alberti, seed " .. seed
    eq(#var.notes, #orig, tag .. ": as many notes")
    for i, n in ipairs(var.notes) do
      ok(math.abs(n.start - orig[i].start) < 1e-9 and math.abs(n.len - orig[i].len) < 1e-9, tag .. ": the same rhythm")
      if n.start % 4 < 1e-9 then eq(n.pitch, orig[i].pitch, tag .. ": the bass of each bar stays") end
      ok(an.pcs[n.pitch % 12], tag .. ": in the scale")
    end
    for _, c in ipairs(var.moves) do
      ok(c.move == "arpeggio", tag .. ": an arpeggio change, not another (" .. c.move .. ")")
      local was, now = c.text:match("arpeggio (%S+) became ([^,%s]+)")
      ok(was and now and was ~= now, tag .. ": named before and after: " .. c.text)
      if was then seen[was .. ">" .. now] = true end
      if c.text:find("all 2 times") then
        together = together + 1
        -- Both bars of that chord now play the same notes.
        -- (The bar named is the one picked; its twin is either side.)
        local bar = math.floor(c.at / 4 + 1e-9)
        local by = {}
        for _, n in ipairs(var.notes) do
          local nb = math.floor(n.start / 4 + 1e-9)
          by[nb] = by[nb] or {}
          table.insert(by[nb], n.pitch)
        end
        local mine = table.concat(by[bar], ",")
        local function was(b2)
          local t = {}
          for _, n in ipairs(orig) do if math.floor(n.start / 4 + 1e-9) == b2 then t[#t + 1] = n.pitch end end
          return table.concat(t, ",")
        end
        local twin = (by[bar - 1] and was(bar - 1) == was(bar)) and bar - 1 or bar + 1
        eq(table.concat(by[twin] or {}, ","), mine, tag .. ": a repeated arpeggio changes in both bars")
      end
    end
  end
  ok(together > 0, "repeated arpeggios are changed together")
  ok(seen["C>Cmaj7"] or seen["C>C6"] or seen["C>Cadd9"] or seen["C>Csus4"], "C changes as a chord would")
end

-- An arpeggio under a tune note held over from the bar before: no change
-- may grind against it (C G E G under a held E5 never becomes Csus4,
-- whose F would sit a minor ninth under it).
do
  local notes = { { pitch = 76, start = 0, len = 8, vel = 100 } }
  for _, n in ipairs(alberti({ { 48, 52, 55 }, { 48, 52, 55 } })) do n.start = n.start + 4; notes[#notes + 1] = n end
  local src = source(notes)
  local an = V.analyse(src, T)
  eq(#an.broken, 2, "set up: the arpeggio bars under the held note")
  local changed = 0
  for seed = 1, 80 do
    local var = V.vary(src, an, qualityOnly(true), seed, T)
    changed = changed + #var.moves
    local grind
    for _, n in ipairs(var.notes) do
      if n.pitch ~= 76 and n.start < 8 and (math.abs(76 - n.pitch) % 12 == 1 or math.abs(76 - n.pitch) % 12 == 11) then
        grind = n.pitch
      end
    end
    if not ok(not grind, "seed " .. seed .. ": nothing grinds against the held E (" .. tostring(grind) .. ")") then break end
  end
  ok(changed > 0, "and the arpeggio under it is changed")
end

-- Nothing to change: melodies and drums get no chord-quality change.
for _, name in ipairs({ "twinkle", "noir", "drums", "run", "minorTune", "riff", "ode" }) do
  local src = source(F[name])
  local an = V.analyse(src, T)
  local any = false
  for seed = 1, 20 do
    if #V.vary(src, an, qualityOnly(true), seed, T).moves > 0 then any = true end
  end
  ok(not any, name .. ": no chords, no chord-quality change")
end

------------------------------------------------------------------------------
-- Developing the motif (near 100%)
------------------------------------------------------------------------------

local function developOnly(amount, keepEnds)
  local o = feelOff(opts({ amount = amount or 1, develop = true }))
  for _, k in ipairs(V.KINDS) do o[k.key] = false end
  if keepEnds ~= nil then o.keepEnds = keepEnds end
  return o
end

-- At or below DEVELOP_FROM, develop changes nothing at all: the same seed
-- gives exactly the variation it gave before develop existed.
for _, name in ipairs(NAMES) do
  local src = source(F[name])
  local an = V.analyse(src, T)
  for _, amount in ipairs({ 0.2, 0.35, V.DEVELOP_FROM }) do
    for seed = 1, 10 do
      local off = V.vary(src, an, opts({ amount = amount }), seed, T)
      local on = V.vary(src, an, opts({ amount = amount, develop = true }), seed, T)
      if not eq(fingerprint(on.notes), fingerprint(off.notes),
                ("%s at %d%%, seed %d: develop does nothing below %d%%"):format(
                  name, amount * 100, seed, V.DEVELOP_FROM * 100)) then break end
    end
  end
end

-- Every fixture near and at 100% with develop on: still playable, in key,
-- one change per moment, the ends kept, no new grinding clash, and drums
-- never developed.
local developed = {}
for _, name in ipairs(NAMES) do
  local src = source(F[name])
  local an = V.analyse(src, T)
  local origHarsh = harshTime(src.notes)
  for _, amount in ipairs({ 0.85, 1 }) do
    local _, cap = V.budget(amount, #src.notes)
    for seed = 1, SEEDS do
      local tag = ("%s at %d%% with develop, seed %d"):format(name, amount * 100, seed)
      local var = V.vary(src, an, opts({ amount = amount, develop = true }), seed, T)
      local bad
      local moments, qualityChanged = {}, false
      for _, c in ipairs(var.moves) do
        if moments[c.event] then bad = "two changes on one moment" end
        moments[c.event] = true
        if c.kind == "quality" then qualityChanged = true end
        if c.kind == "develop" then
          developed[c.move] = (developed[c.move] or 0) + 1
          developed[name] = true
          -- Nothing else changes inside the developed stretch.
          for _, d in ipairs(var.moves) do
            if d ~= c and d.at >= c.from - 1e-6 and d.at < c.to - 1e-6 then bad = "a change inside a developed stretch" end
          end
        end
      end
      if #var.changes > cap then bad = "more changes than the cap" end
      for _, n in ipairs(var.notes) do
        if n.start < src.lead - 1e-9 or n.start + n.len > src.beats + 1e-9 then bad = "outside the item" end
        if n.chan ~= 9 and not an.pcs[n.pitch % 12] then bad = "a note outside the key: " .. n.pitch end
        if n.chan ~= 9 and (n.pitch < an.lo - 7 or n.pitch > an.hi + 7) then
          bad = "a note far outside the original's range: " .. n.pitch
        end
      end
      if harshTime(var.notes, qualityChanged) > origHarsh + 1.01 then bad = "a new grinding clash" end
      for _, e in ipairs({ an.events[1], an.events[#an.events] }) do
        for _, n in ipairs(e.notes) do
          local found = false
          for _, m in ipairs(var.notes) do
            if m.pitch == n.pitch and math.abs(m.start - n.start) < 0.13 then found = true end
          end
          if not found then bad = "the first or last note lost" end
        end
      end
      if not ok(not bad, tag .. ": " .. tostring(bad or "fine")) then break end
    end
  end
end
for _, move in ipairs(V.DEVELOP.moves) do
  ok((developed[move[1]] or 0) > 0, "the " .. move[1] .. " develop move is reached by some fixture")
end
ok(not developed.drums, "drums are never developed")

-- How often: never at DEVELOP_FROM, sometimes just above, most of the time
-- at 100% - and the further up, the longer the stretch.
do
  local src = source(F.noir)
  local an = V.analyse(src, T)
  local function share(amount)
    local k, span = 0, 0
    for seed = 1, 200 do
      for _, c in ipairs(V.vary(src, an, opts({ amount = amount, develop = true }), seed, T).moves) do
        if c.kind == "develop" then k, span = k + 1, span + (c.to - c.from) end
      end
    end
    return k / 200, k > 0 and span / k or 0
  end
  local at75, span75 = share(0.75)
  local at100, span100 = share(1)
  ok(at75 > 0.05 and at75 < 0.5, ("just above %d%%, some variations are developed (%.2f)"):format(V.DEVELOP_FROM * 100, at75))
  ok(at100 > 0.6, ("at 100%%, most are (%.2f)"):format(at100))
  ok(span100 > span75 + 2, ("and the stretch grows with the amount (%.1f beats vs %.1f)"):format(span100, span75))
  local off = 0
  for seed = 1, 100 do
    for _, c in ipairs(V.vary(src, an, opts({ amount = 1, develop = false }), seed, T).moves) do
      if c.kind == "develop" then off = off + 1 end
    end
  end
  eq(off, 0, "Develop switched off: never")
end

-- Each develop move does what it says. Twinkle, every other kind off and
-- the ends free, so each variation is one develop move alone on a plain
-- melody: the notes inside the stretch, before and after, compared.
do
  local src = source(F.twinkle)
  local an = V.analyse(src, T)
  local L = {}
  for pc = 0, 11 do if an.scale[pc] then L[#L + 1] = pc end end
  local function pos(p)
    for i = #L, 1, -1 do if L[i] == p % 12 then return (p // 12) * #L + i - 1 end end
  end
  local function inside(notes, c)
    local out = {}
    for _, n in ipairs(notes) do if n.start >= c.from - 1e-6 and n.start < c.to - 1e-6 then out[#out + 1] = n end end
    table.sort(out, function(a, b) return a.start < b.start end)
    return out
  end
  local checked = {}
  for seed = 1, 300 do
    local var = V.vary(src, an, developOnly(1, false), seed, T)
    local c = var.moves[1]
    if c then
      local before, after = inside(src.notes, c), inside(var.notes, c)
      local tag = ("Twinkle, %s (seed %d)"):format(c.move, seed)
      if c.move ~= "fragment" then
        eq(#after, #before, tag .. ": as many notes")
        for i, n in ipairs(after) do
          ok(math.abs(n.start - before[i].start) < 1e-9 and math.abs(n.len - before[i].len) < 1e-9,
             tag .. ": in the same rhythm")
        end
      end
      local P, Q = {}, {}
      for i, n in ipairs(before) do P[i] = pos(n.pitch) end
      for i, n in ipairs(after) do Q[i] = pos(n.pitch) end
      if c.move == "transpose" then
        for i = 2, #Q do eq(Q[i] - P[i], Q[1] - P[1], tag .. ": every note moved by the same steps") end
        ok(Q[1] ~= P[1], tag .. ": and moved")
      elseif c.move == "invert" then
        local axis2 = P[1] + Q[1]
        for i = 2, #Q do eq(P[i] + Q[i], axis2, tag .. ": mirrored around one note") end
      elseif c.move == "retrograde" then
        for i = 1, #Q do eq(after[i].pitch, before[#before + 1 - i].pitch, tag .. ": the pitches in reverse order") end
      elseif c.move == "stretch" then
        for i = 2, #Q do eq(Q[i] - Q[1], 2 * (P[i] - P[1]), tag .. ": every interval from the first doubled") end
      elseif c.move == "squeeze" then
        for i = 2, #Q do
          local a, b = P[i] - P[1], Q[i] - Q[1]
          ok((a == 0 and b == 0) or (a * b > 0 and math.abs(b) <= math.abs(a)),
             tag .. ": every interval the same way, no wider")
        end
      elseif c.move == "fragment" then
        local half = (c.to - c.from) / 2
        local first, second = {}, {}
        for _, n in ipairs(after) do
          if n.start < c.from + half - 1e-6 then first[#first + 1] = n else second[#second + 1] = n end
        end
        eq(#second, #first, tag .. ": the second half as many notes as the first")
        for i, n in ipairs(second) do
          ok(math.abs(n.start - first[i].start - half) < 1e-9, tag .. ": in the first half's rhythm")
          eq(math.abs(pos(n.pitch) - pos(first[i].pitch)), 1, tag .. ": a step away")
        end
      end
      checked[c.move] = true
    end
  end
  for _, move in ipairs(V.DEVELOP.moves) do ok(checked[move[1]], "Twinkle: " .. move[1] .. " checked") end
end

-- With chords under a tune, only the tune is inverted, reversed or
-- stretched: every note that is not the tune stays, and the tune stays on
-- top. The tune is the highest note struck at a moment, if nothing held
-- over from before sounds above it - the walking bass is not a tune.
for _, name in ipairs({ "piano", "strummed", "walking", "popChords" }) do
  local src = source(F[name])
  local an = V.analyse(src, T)
  local tuneNote = {}
  for _, e in ipairs(an.events) do
    local top, under = e.notes[#e.notes], false
    for _, o in ipairs(src.notes) do
      if o.start < e.start - 1e-6 and o.start + o.len > e.start + 1e-6 and o.pitch > top.pitch then under = true end
    end
    if not under then tuneNote[("%d@%.4f"):format(top.pitch, top.start)] = true end
  end
  local seen = 0
  for seed = 1, 120 do
    local var = V.vary(src, an, developOnly(1, false), seed, T)
    local c = var.moves[1]
    if c and c.move ~= "transpose" then
      seen = seen + 1
      local tag = ("%s, %s (seed %d)"):format(name, c.move, seed)
      local have = {}
      for _, n in ipairs(var.notes) do have[("%d@%.4f"):format(n.pitch, n.start)] = true end
      local bad
      for _, n in ipairs(src.notes) do
        local k = ("%d@%.4f"):format(n.pitch, n.start)
        if not tuneNote[k] and not have[k] then bad = "a note under the tune changed" end
      end
      for _, e in ipairs(an.events) do
        local top = e.notes[#e.notes]
        if tuneNote[("%d@%.4f"):format(top.pitch, top.start)] and #e.notes > 1 then
          local hi = -1
          for _, n in ipairs(var.notes) do if math.abs(n.start - e.start) < 1e-6 then hi = math.max(hi, n.pitch) end end
          if hi <= e.notes[#e.notes - 1].pitch then bad = "the tune fell into the chord" end
        end
      end
      if not ok(not bad, tag .. ": " .. tostring(bad or "fine")) then break end
    end
  end
  ok(seen > 0 or name == "popChords", name .. ": its tune is developed (" .. seen .. ")")
end

-- A series spreads its develop moves: with its memory, a series of six at
-- 100% uses more different ones than six made without it.
do
  local src = source(F.noir)
  local an = V.analyse(src, T)
  local o = feelOff(opts({ amount = 1, develop = true }))
  local function kinds(run)
    local seen, k = {}, 0
    for _, var in ipairs(run) do
      for _, c in ipairs(var.moves) do
        if c.kind == "develop" and not seen[c.move] then seen[c.move], k = true, k + 1 end
      end
    end
    return k
  end
  local with, without = 0, 0
  for base = 1, 40 do
    with = with + kinds(V.series(src, an, o, base, 6, T))
    local alone = {}
    for i = 1, 6 do alone[i] = V.vary(src, an, o, V.seedFor(base, i - 1), T) end
    without = without + kinds(alone)
  end
  ok(with > without + 10, ("a series spreads its develop moves (%d kinds, %d without memory)"):format(with, without))
end

-- A tune close over its chords, and chords with a step inside them (Cadd9,
-- Gadd9): the tune never falls into the chord, and a sequence never moves
-- a chord to where its step becomes a semitone (Gadd9 up a third in C is
-- B C F).
do
  local notes = {}
  for b, ch in ipairs({ { 48, 55, 60, 62 }, { 43, 50, 55, 57 }, { 45, 52, 57, 59 }, { 48, 55, 60, 62 } }) do
    for _, p in ipairs(ch) do notes[#notes + 1] = { pitch = p, start = (b - 1) * 4, len = 4, vel = 90 } end
  end
  for i, p in ipairs({ 67, 65, 64, 67, 62, 64, 65, 62, 64, 67, 65, 64, 67, 69, 67, 65 }) do
    notes[#notes + 1] = { pitch = p, start = i - 1, len = 1, vel = 100 }
  end
  local src = source(notes)
  local an = V.analyse(src, T)
  local origHarsh = harshTime(src.notes)
  local moves = {}
  for seed = 1, 150 do
    local var = V.vary(src, an, developOnly(1, false), seed, T)
    local c = var.moves[1]
    if c then
      moves[c.move] = true
      local tag = ("close tune, %s (seed %d)"):format(c.move, seed)
      ok(harshTime(var.notes) <= origHarsh + 1.01, tag .. ": no new grinding, inside a chord or out")
      -- Every tune note (the short ones) above every chord note (held a
      -- bar) sounding when it is struck.
      if c.move ~= "transpose" then
        local fell
        for _, t in ipairs(var.notes) do
          if t.len < 4 - 1e-6 then
            for _, h in ipairs(var.notes) do
              if h.len >= 4 - 1e-6 and h.start <= t.start + 1e-6 and h.start + h.len > t.start + 1e-6
                 and h.pitch >= t.pitch then fell = t.pitch end
            end
          end
        end
        ok(not fell, tag .. ": the tune stays above its chord (" .. tostring(fell) .. ")")
      end
    end
  end
  ok(moves.transpose and moves.invert, "the close tune is inverted and sequenced")
end

C.done()
