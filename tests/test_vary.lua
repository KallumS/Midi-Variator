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

local function opts(changes)
  local o = V.defaults()
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

local function harshTime(notes)
  -- Time two notes a semitone (or major seventh, minor ninth) apart sound
  -- together, ignoring overlaps too short to hear as a clash.
  local t = 0
  for i = 1, #notes do
    for j = i + 1, #notes do
      local a, b = notes[i], notes[j]
      if (a.chan or 0) ~= 9 and (b.chan or 0) ~= 9 then
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

      if not ok(harshTime(var.notes) <= origHarsh + 1.01,
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

C.done()
