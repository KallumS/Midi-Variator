--[[ Reading items and writing variations, against the mocked REAPER.

       lua5.4 tests/test_place.lua
]]

local HERE = (arg and arg[0] or ""):match("^(.*)[/\\]") or "."
local C = dofile(HERE .. "/check.lua")
local ok, eq = C.ok, C.eq
local P = dofile(HERE .. "/reaper_mock.lua")
local F = dofile(HERE .. "/fixtures.lua")
local T = dofile(C.SCRIPTS .. "mv_theory.lua")
local V = dofile(C.SCRIPTS .. "mv_vary.lua")
P.install()
local Place = dofile(C.SCRIPTS .. "mv_place.lua")
Place.use(V)

local function same(a, b, what)
  local function fp(list)
    local out = {}
    for _, n in ipairs(list) do
      out[#out + 1] = ("%d@%.4f+%.4f v%d c%d"):format(n.pitch, n.start, n.len, n.vel, n.chan or 0)
    end
    return table.concat(out, " ")
  end
  return eq(fp(a), fp(b), what)
end

local function balanced(what)
  eq(P.undoDepth, 0, what .. ": undo block closed")
  eq(P.refreshDepth, 0, what .. ": screen refresh put back")
end

-- Engine notes (from the bar line) as item notes (from the item's start).
local function fromItem(src, notes)
  local out = {}
  for i, n in ipairs(notes) do
    out[i] = { pitch = n.pitch, start = n.start - src.lead, len = n.len, vel = n.vel, chan = n.chan or 0 }
  end
  return out
end

------------------------------------------------------------------------------
-- Reading
------------------------------------------------------------------------------

P.reset()
do
  local srcs, why = Place.read()
  eq(srcs, nil, "nothing selected: nothing read")
  eq(why, Place.NO_ITEM, "and says so")

  local tr = P.track("Keys")
  P.selected = { P.item(tr, 0, 4, {}, "empty") }
  srcs, why = Place.read()
  eq(why, Place.NOTHING, "an empty item: nothing to vary")

  P.reset()
  tr = P.track("Keys")
  local item = P.item(tr, 6, 4, {
    { pitch = 60, start = 0, len = 1 },
    { pitch = 62, start = 1, len = 1, muted = true },
    { pitch = 64, start = 3, len = 3 },      -- runs past the item's end
  }, "Motif")
  P.selected = { item }
  srcs = Place.read()
  local s = srcs[1]
  eq(s.lead, 2, "an item two beats into its bar has a lead of 2")
  eq(s.beats, 6, "and ends at 6 counted from that bar line")
  eq(#s.notes, 2, "muted notes are left out")
  eq(s.notes[1].start, 2, "notes are counted from the bar line")
  eq(s.notes[2].len, 1, "and cut at the item's end")
  eq(s.original[1].start, 0, "the original is kept from the item's own start")
  eq(s.name, "Motif", "named after the take")
  ok(not s.stored, "not a variation")

  -- A take that starts part-way into its source.
  P.reset()
  tr = P.track("Keys")
  item = P.item(tr, 0, 4, { { pitch = 60, start = 0, len = 2 }, { pitch = 67, start = 3, len = 2 } },
                "Trimmed", { offs = 1 })
  P.selected = { item }
  s = Place.read()[1]
  eq(#s.notes, 2, "a trimmed item keeps what is inside it")
  eq(s.notes[1].start, 0, "a note started before the item begins at its start")
  eq(s.notes[1].len, 1, "and keeps only what is heard")
  eq(s.notes[2].start, 2, "the rest move with the trim")

  -- A looped item plays its source twice: both passes are read.
  P.reset()
  tr = P.track("Keys")
  item = P.item(tr, 0, 8, { { pitch = 60, start = 0, len = 1 }, { pitch = 64, start = 2, len = 1 } },
                "Loop", { loop = true, srcLen = 4 })
  P.selected = { item }
  s = Place.read()[1]
  eq(#s.notes, 4, "a two-pass loop is read as both passes")
  eq(s.notes[3].start, 4, "the second pass starts where the source repeats")

  -- 6/8: the beat is a dotted quarter, the bar three quarters.
  P.reset()
  P.num, P.den = 6, 8
  tr = P.track("Keys")
  P.selected = { P.item(tr, 0, 3, { { pitch = 60, start = 0, len = 1.5 } }, "Six") }
  s = Place.read()[1]
  eq(s.barBeats, 3, "a 6/8 bar is three quarter notes")
  eq(s.pulse, 1.5, "counted in dotted quarters")
end

------------------------------------------------------------------------------
-- Making variations after the original
------------------------------------------------------------------------------

P.reset()
do
  local tr = P.track("Piano")
  local item = P.item(tr, 0, 16, F.noir, "Noir", {
    color = 0x1FF0000, ccs = { { at = 0, m2 = 64, m3 = 127 }, { at = 3.5, m2 = 64, m3 = 0 } },
  })
  P.selected = { item }
  local src = Place.read()[1]
  local an = V.analyse(src, T)
  local run = V.series(src, an, V.defaults(), 42, 3, T)
  local lists = {}
  for i, r in ipairs(run) do lists[i] = r.notes end
  local result, made = Place.make({ { src = src, variations = lists } })
  eq(result, Place.OK, "made")
  eq(made, 3, "three")
  balanced("make")
  eq(P.undoNames[#P.undoNames], "Midi Variator: make variations", "as one undo step")
  eq(#tr.items, 4, "on the original's track")
  for i = 1, 3 do
    local it = tr.items[i + 1]
    eq(P.posQN(it), 16 * i, ("variation %d starts %d bars on"):format(i, 4 * i))
    eq(it.len, item.len, ("variation %d is as long as the original"):format(i))
    eq(it.take.name, "Noir - variation " .. i, "named for the original and its number")
    same(P.notesOf(it), fromItem(src, lists[i]), ("variation %d holds the notes it was given"):format(i))
    local back = V.decode(it.ext.MidiVariator)
    same(back, fromItem(src, src.notes), ("variation %d carries the original inside it"):format(i))
    eq(#it.take.ccs, 2, "with the original's pedal")
    eq(it.take.ccs[2].ppq, 3.5 * P.PPQ, "in the same place")
    eq(it.color, 0x1FF0000, "and its colour")
    ok(it.take.sorted, "sorted once, after the batch")
  end
  eq(#P.selected, 3, "the new variations are selected")
  ok(P.selected[1] == tr.items[2], "the new ones, not the original")

  -- A variation of a variation is a variation of the original.
  P.selected = { tr.items[3] }
  local again = Place.read()[1]
  ok(again.stored, "a variation knows it is one")
  same(again.notes, src.notes, "and hands the engine its original, not its own notes")
  eq(again.name, "Noir", "named after the original")
  eq(again.index, 2, "and knows its number")

  -- More variations of it go after the ones already there.
  local lists2 = { V.vary(again, V.analyse(again, T), V.defaults(), 7, T).notes }
  result = Place.make({ { src = again, variations = lists2, first = 4 } })
  eq(result, Place.OK, "made again")
  local newest = tr.items[#tr.items]
  eq(P.posQN(newest), 64, "the next free place is taken, nothing covered")
  eq(newest.take.name, "Noir - variation 4", "and numbered on from the others")
  same(V.decode(newest.ext.MidiVariator), fromItem(src, src.notes), "it too carries the first original")
end

-- A place already taken is skipped.
P.reset()
do
  local tr = P.track("Keys")
  local item = P.item(tr, 0, 16, F.twinkle, "Twinkle")
  P.item(tr, 16, 16, F.twinkle, "Something else")
  P.selected = { item }
  local src = Place.read()[1]
  local at = Place.slots(src, 2)
  eq(at[1], 32, "a taken place is skipped")
  eq(at[2], 48, "and the next one used")
end

-- Not a whole number of bars: the step still is.
P.reset()
do
  local tr = P.track("Keys")
  P.selected = { P.item(tr, 0, 14, F.twinkle, "Short") }
  local at = Place.slots(Place.read()[1], 2)
  eq(at[1], 16, "fourteen beats step on by four whole bars")
  eq(at[2], 32, "so every copy starts on the same beat of its bar")

  P.reset()
  tr = P.track("Keys")
  P.selected = { P.item(tr, 2, 4, F.single, "Offbeat") }
  local src = Place.read()[1]
  at = Place.slots(src, 2)
  eq(at[1], 6, "an item starting mid-bar steps on a bar at a time")
  eq(at[2], 10, "keeping its place in the bar")
  Place.make({ { src = src, variations = { src.notes } } })
  same(P.notesOf(tr.items[2]), F.single, "and its notes land where they were in the item, not a bar late")
end

-- REAPER refusing to make an item: nothing left behind.
P.reset()
do
  local tr = P.track("Keys")
  P.selected = { P.item(tr, 0, 16, F.twinkle, "Twinkle") }
  local src = Place.read()[1]
  local result = Place.make({ { src = src, variations = { src.notes, src.notes } } })
  eq(result, Place.OK, "set up")
  local other = P.track("Refuses")
  other.refuses = true
  P.item(other, 0, 16, F.ode, "Ode")
  local before = #tr.items
  -- The first job succeeds, the second is refused: neither is kept.
  result = Place.make({ { src = src, variations = { src.notes } },
                        { src = Place.readItem(other.items[1]), variations = { src.notes } } })
  eq(result, Place.FAILED, "a refusal is reported")
  eq(#tr.items, before, "and leaves nothing half-made, even from the jobs before it")
  balanced("a refusal")
end

------------------------------------------------------------------------------
-- In place, and putting the original back
------------------------------------------------------------------------------

P.reset()
do
  local tr = P.track("Keys")
  local notes = V.copyNotes(F.twinkle)
  notes[#notes + 1] = { pitch = 50, start = 1, len = 1, vel = 90, muted = true }
  local item = P.item(tr, 0, 16, notes, "Twinkle")
  P.selected = { item }
  local original = P.notesOf(item)

  local variation
  local result, count = Place.varyInPlace(Place.selectedItems(), function(src, k)
    variation = V.vary(src, V.analyse(src, T), V.defaults(), 5, T).notes
    return variation
  end)
  eq(result, Place.OK, "varied in place")
  eq(count, 1, "one item")
  balanced("in place")
  eq(#tr.items, 1, "the same item, not a new one")
  ok(tr.items[1] == item, "rewritten where it is")
  local now = P.notesOf(item)
  local muted = 0
  for _, n in ipairs(now) do if n.muted then muted = muted + 1 end end
  eq(muted, 1, "its muted note is left alone")
  eq(#now - muted, #variation, "and the rest is the variation")
  ok(item.ext.MidiVariator ~= nil, "it now carries its original")

  -- Again: still a variation of the ORIGINAL, not of the first variation.
  Place.varyInPlace(Place.selectedItems(), function(src)
    local plain = {}
    for _, n in ipairs(original) do if not n.muted then plain[#plain + 1] = n end end
    same(fromItem(src, src.notes), plain, "varying it again starts from the original")
    return src.notes
  end)

  local result2, restored = Place.restore(Place.selectedItems())
  eq(result2, Place.OK, "put back")
  eq(restored, 1, "one item")
  same(P.notesOf(item), original, "exactly as it was")
  balanced("restore")
  eq(P.undoNames[#P.undoNames], "Midi Variator: put back the original", "as one undo step")

  P.selected = { P.item(tr, 32, 16, F.ode, "Ode") }
  eq(select(1, Place.restore(Place.selectedItems())), Place.NOTHING, "an item that is not a variation has nothing to put back")
  balanced("restore of nothing")
end

-- Items whose MIDI is shared, on disk, or looped are replaced, never
-- rewritten: rewriting would change the other copies (or the file) too.
for _, case in ipairs({
  { "pooled", { pooled = true } },
  { "a .mid file", { file = "/music/motif.mid" } },
  { "looped", { loop = true, srcLen = 8 } },
}) do
  P.reset()
  local tr = P.track("Keys")
  local item = P.item(tr, 0, 16, F.twinkle, "Twinkle", case[2])
  local twin = P.item(tr, 16, 16, F.twinkle, "Twinkle", case[2])
  P.selected = { item }
  local before = P.notesOf(twin)
  local src = Place.readItem(item)
  ok(not Place.canRewrite(src), case[1] .. ": not rewritten in place")
  local result = Place.varyInPlace({ item }, function(s)
    return V.vary(s, V.analyse(s, T), V.defaults(), 3, T).notes
  end)
  eq(result, Place.OK, case[1] .. ": varied")
  ok(not item.alive, case[1] .. ": the old item is replaced")
  local new = P.selected[1]
  ok(new and new.alive and new ~= item, case[1] .. ": by a new one, selected")
  eq(P.posQN(new), 0, case[1] .. ": in the same place")
  same(P.notesOf(twin), before, case[1] .. ": and the other copy is untouched")
  ok(new.ext.MidiVariator ~= nil, case[1] .. ": carrying its original")
  balanced(case[1])
end

C.done()
