--[[ Midi Variator - everything that talks to REAPER.

     Reading a MIDI item, putting variations of it into the project, and
     rewriting items in place. Nothing here draws, so tests/test_place.lua
     can run it against a REAPER that only records what it is asked to do.

     Every signature used here was checked against REAPER's API
     documentation, not guessed: TimeMap_GetTimeSigAtTime returns
     num, denom, tempo with no retval in front; TimeMap_QNToMeasures returns
     the measure index first and the measure's start and end after it;
     MIDI_InsertCC has no noSort argument, unlike MIDI_InsertNote.

     Every variation is a NEW MIDI item made with CreateNewMIDIItemInProj,
     never a copy of the original item. A copy could share the original's
     MIDI (a pooled "ghost" copy, or a .mid file on disk that both point at),
     and then changing the copy would change the original too. See decision
     0002.
]]

local M = {}

M.OK, M.NOTHING, M.NO_ITEM, M.FAILED = 0, 1, 2, 3

-- Where a variation keeps its original. On the item, so it travels with it.
M.EXT = "P_EXT:MidiVariator"

-- The engine, for keeping an original inside an item (encode/decode).
-- Handed in by whoever loads this file, so this file needs no path.
local V
function M.use(engine) V = engine end

------------------------------------------------------------------------------
-- Reading
------------------------------------------------------------------------------

-- The beat the ear counts in, in quarter notes: a quarter in 4/4, an eighth
-- in 5/8, a dotted quarter in 6/8 and 12/8. (Midi Suggester's rule.)
function M.pulse(num, den)
  if den == 8 and num % 3 == 0 and num > 3 then return 1.5 end
  return 4 / den
end

local function valid(ptr, kind)
  if not ptr then return false end
  if reaper.ValidatePtr2 then return reaper.ValidatePtr2(0, ptr, kind) end
  return true
end

-- The selected MIDI items, in the order REAPER lists them.
function M.selectedItems()
  local items = {}
  for i = 0, reaper.CountSelectedMediaItems(0) - 1 do
    local item = reaper.GetSelectedMediaItem(0, i)
    local take = item and reaper.GetActiveTake(item)
    if take and reaper.TakeIsMIDI(take) then items[#items + 1] = item end
  end
  return items
end

-- The item's source length in quarter notes, for a looped item.
local function sourceQN(take, pos, startQN)
  local len, isQN = reaper.GetMediaSourceLength(reaper.GetMediaItemTake_Source(take))
  if not len or len <= 0 then return nil end
  if isQN then return len end
  return reaper.TimeMap2_timeToQN(0, pos + len) - startQN
end

--[[  Every copy of a take position that the item plays: once, or once per
      pass of the loop for an item stretched past its source's end. Returns
      a function giving, for a PPQ position, the list of positions in
      quarter notes from the item's start. ]]
local function passes(item, take, pos, startQN, lengthQN)
  local L
  if reaper.GetMediaItemInfo_Value(item, "B_LOOPSRC") == 1 then
    L = sourceQN(take, pos, startQN)
    if L and L >= lengthQN - 1e-6 then L = nil end
  end
  return function(ppq)
    local rel = reaper.MIDI_GetProjQNFromPPQPos(take, ppq) - startQN
    if not L then return { rel } end
    local out = {}
    for k = -1, math.ceil(lengthQN / L) + 1 do out[#out + 1] = rel + k * L end
    return out
  end, L
end

-- The unmuted notes the item plays, from its own start, cut to its edges.
local function readNotes(item, take, pos, startQN, lengthQN)
  local at = passes(item, take, pos, startQN, lengthQN)
  local notes = {}
  local _, count = reaper.MIDI_CountEvts(take)
  for i = 0, count - 1 do
    local ok, _, muted, sp, ep, chan, pitch, vel = reaper.MIDI_GetNote(take, i)
    if ok and not muted then
      local len = reaper.MIDI_GetProjQNFromPPQPos(take, ep) - reaper.MIDI_GetProjQNFromPPQPos(take, sp)
      for _, s in ipairs(at(sp)) do
        local a, b = math.max(0, s), math.min(lengthQN, s + len)
        if b - a > 1e-6 then
          notes[#notes + 1] = { pitch = pitch, start = a, len = b - a, vel = vel, chan = chan }
        end
      end
    end
  end
  table.sort(notes, function(a, b)
    if a.start ~= b.start then return a.start < b.start end
    return a.pitch < b.pitch
  end)
  return notes
end

-- The CC, pitch bend, program and aftertouch events the item plays, from
-- its own start, so a variation keeps the original's pedal and bends.
local function readCCs(item, take, pos, startQN, lengthQN)
  local at = passes(item, take, pos, startQN, lengthQN)
  local out = {}
  local _, _, ccs = reaper.MIDI_CountEvts(take)
  for i = 0, (ccs or 0) - 1 do
    local ok, _, muted, ppq, chanmsg, chan, m2, m3 = reaper.MIDI_GetCC(take, i)
    if ok then
      for _, s in ipairs(at(ppq)) do
        if s >= -1e-9 and s < lengthQN - 1e-9 then
          out[#out + 1] = { at = math.max(0, s), muted = muted, chanmsg = chanmsg, chan = chan, m2 = m2, m3 = m3 }
        end
      end
    end
  end
  return out
end

-- A variation's name without its " - variation 3", so a variation of a
-- variation is named after the original, not "... - variation 3 - variation 1".
local function baseName(name)
  name = (name or ""):gsub(" %- variation %d*$", ""):gsub(" %- variation$", "")
  return name ~= "" and name or "MIDI"
end

--[[  One item, ready for the engine.

      If the item is a variation - it carries its original - the notes are
      that ORIGINAL, not what the item plays now. That is what keeps every
      variation a variation of the original.

      Notes are in quarter notes from the bar line at or before the item, as
      the engine wants; `lead` is where the item starts within that bar. ]]
function M.readItem(item)
  local take = reaper.GetActiveTake(item)
  if not take or not reaper.TakeIsMIDI(take) then return nil, M.NO_ITEM end
  local pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
  local len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
  local startQN = reaper.TimeMap2_timeToQN(0, pos)
  local lengthQN = reaper.TimeMap2_timeToQN(0, pos + len) - startQN

  -- A hair past the item's start, so an item that begins exactly on a bar
  -- line is counted in that bar and not the one before it.
  local _, barStart, barEnd = reaper.TimeMap_QNToMeasures(0, startQN + 1e-6)
  local num, den = reaper.TimeMap_GetTimeSigAtTime(0, pos)
  if not num or num <= 0 or not den or den <= 0 then num, den = 4, 4 end
  local barBeats = (barEnd and barStart) and (barEnd - barStart) or 0
  if barBeats <= 0 then barBeats = num * 4 / den end
  barStart = barStart or startQN
  local lead = startQN - barStart

  local _, text = reaper.GetSetMediaItemInfo_String(item, M.EXT, "", false)
  local stored, _, name, index = V.decode(text)
  local notes = stored
  if not notes then
    notes = readNotes(item, take, pos, startQN, lengthQN)
    name, index = reaper.GetTakeName(take), 0
  end
  local original = {}
  for i, n in ipairs(notes) do original[i] = { pitch = n.pitch, start = n.start, len = n.len, vel = n.vel, chan = n.chan } end
  local forEngine = {}
  for i, n in ipairs(notes) do
    forEngine[i] = { pitch = n.pitch, start = n.start + lead, len = n.len, vel = n.vel, chan = n.chan }
  end

  return {
    notes = forEngine, original = original, lead = lead, beats = lead + lengthQN,
    barBeats = barBeats, pulse = M.pulse(num, den), num = num, den = den,
    name = baseName(name), index = index or 0, stored = stored ~= nil,
    item = item, take = take, track = reaper.GetMediaItem_Track(item),
    pos = pos, len = len, startQN = startQN, lengthQN = lengthQN, originQN = barStart,
  }
end

-- Every selected MIDI item, read. Returns the list, or nil and NO_ITEM /
-- NOTHING.
function M.read()
  local items = M.selectedItems()
  if #items == 0 then return nil, M.NO_ITEM end
  local out = {}
  for _, item in ipairs(items) do
    local src = M.readItem(item)
    if src and #src.notes > 0 then out[#out + 1] = src end
  end
  if #out == 0 then return nil, M.NOTHING end
  table.sort(out, function(a, b) return a.startQN < b.startQN end)
  return out
end

------------------------------------------------------------------------------
-- Writing
------------------------------------------------------------------------------

--[[  Where the variations of `src` go: straight after it on its own track,
      one after another, each starting the same distance into its bar as the
      original does. The step is the original's length rounded up to whole
      bars. A place already taken by another item is skipped, so nothing on
      the track is ever covered. Returns positions in quarter notes. ]]
function M.slots(src, count)
  local step = math.max(1, math.ceil(src.lengthQN / src.barBeats - 1e-6)) * src.barBeats
  local taken = {}
  for i = 0, reaper.CountTrackMediaItems(src.track) - 1 do
    local it = reaper.GetTrackMediaItem(src.track, i)
    local p = reaper.GetMediaItemInfo_Value(it, "D_POSITION")
    local l = reaper.GetMediaItemInfo_Value(it, "D_LENGTH")
    taken[#taken + 1] = { reaper.TimeMap2_timeToQN(0, p), reaper.TimeMap2_timeToQN(0, p + l) }
  end
  local out, j = {}, 1
  while #out < count and j < count + 10000 do
    local s = src.startQN + j * step
    local e = s + src.lengthQN
    local free = true
    for _, t in ipairs(taken) do
      if t[1] < e - 1e-6 and t[2] > s + 1e-6 then free = false; break end
    end
    if free then
      out[#out + 1] = s
      taken[#taken + 1] = { s, e }
    end
    j = j + 1
  end
  return out
end

-- The number the next variation of `src` gets: one more than the highest
-- among the variations of the same original already on its track.
function M.nextIndex(src)
  local most = 0
  for i = 0, reaper.CountTrackMediaItems(src.track) - 1 do
    local it = reaper.GetTrackMediaItem(src.track, i)
    local _, text = reaper.GetSetMediaItemInfo_String(it, M.EXT, "", false)
    local _, _, name, index = V.decode(text)
    if name == src.name and index and index > most then most = index end
  end
  return most + 1
end

-- Engine notes (from the bar line) into the take, at the item starting
-- at `atQN`. Unmuted notes already there are replaced; muted ones stay.
local function writeNotes(take, src, notes, atQN)
  local _, count = reaper.MIDI_CountEvts(take)
  for i = count - 1, 0, -1 do
    local ok, _, muted = reaper.MIDI_GetNote(take, i)
    if ok and not muted then reaper.MIDI_DeleteNote(take, i) end
  end
  for _, n in ipairs(notes) do
    local s = atQN + n.start - src.lead
    local sp = reaper.MIDI_GetPPQPosFromProjQN(take, s)
    local ep = reaper.MIDI_GetPPQPosFromProjQN(take, s + n.len)
    -- The last argument is noSort: every note in the batch, then one sort.
    reaper.MIDI_InsertNote(take, false, false, sp, ep, n.chan or 0, n.pitch, n.vel or 100, true)
  end
  reaper.MIDI_Sort(take)
end

local function keepOriginal(item, src, index)
  reaper.GetSetMediaItemInfo_String(item, M.EXT, V.encode(src.original, src.lengthQN, src.name, index), true)
end

--[[  A new item holding `notes`, at `atQN` on the source's track, carrying
      the source's CCs, colour and volume, and its original. ]]
function M.create(src, notes, atQN, index)
  local t0 = reaper.TimeMap2_QNToTime(0, atQN)
  local t1 = reaper.TimeMap2_QNToTime(0, atQN + src.lengthQN)
  local item = reaper.CreateNewMIDIItemInProj(src.track, t0, t1, false)
  if not item then return nil end
  local take = reaper.GetActiveTake(item)
  if valid(src.take, "MediaItem_Take*") and valid(src.item, "MediaItem*") then
    for _, c in ipairs(readCCs(src.item, src.take, src.pos, src.startQN, src.lengthQN)) do
      local ppq = reaper.MIDI_GetPPQPosFromProjQN(take, atQN + c.at)
      reaper.MIDI_InsertCC(take, false, c.muted, ppq, c.chanmsg, c.chan, c.m2, c.m3)
    end
    reaper.SetMediaItemInfo_Value(item, "I_CUSTOMCOLOR", reaper.GetMediaItemInfo_Value(src.item, "I_CUSTOMCOLOR"))
    reaper.SetMediaItemInfo_Value(item, "D_VOL", reaper.GetMediaItemInfo_Value(src.item, "D_VOL"))
  end
  writeNotes(take, src, notes, atQN)
  local name = index > 0 and ("%s - variation %d"):format(src.name, index) or src.name
  reaper.GetSetMediaItemTakeInfo_String(take, "P_NAME", name, true)
  keepOriginal(item, src, index)
  reaper.UpdateItemInProject(item)
  return item
end

local function selectOnly(items)
  reaper.SelectAllMediaItems(0, false)
  for _, it in ipairs(items) do reaper.SetMediaItemSelected(it, true) end
end

local function finish(name, made)
  reaper.PreventUIRefresh(-1)
  reaper.UpdateArrange()
  reaper.Undo_EndBlock(name, -1)
  return made
end

--[[  Variations after each source. `jobs` is a list of { src, list of note
      lists }. One undo step; the new items end up selected, so pressing
      "Vary selected again" re-rolls just them.

      Returns OK and how many were made, or FAILED. ]]
function M.make(jobs)
  reaper.Undo_BeginBlock()
  reaper.PreventUIRefresh(1)
  local made = {}
  for _, job in ipairs(jobs) do
    local at = M.slots(job.src, #job.variations)
    for i, notes in ipairs(job.variations) do
      local item = at[i] and M.create(job.src, notes, at[i], (job.first or 1) + i - 1)
      if not item then
        -- All or nothing: take away what was made, and still close the block.
        for _, it in ipairs(made) do reaper.DeleteTrackMediaItem(reaper.GetMediaItem_Track(it), it) end
        finish("Midi Variator: make variations", nil)
        return M.FAILED, 0
      end
      made[#made + 1] = item
    end
  end
  if #made > 0 then selectOnly(made) end
  finish("Midi Variator: make variations", made)
  return M.OK, #made
end

--[[  Whether an item's notes can be rewritten where they are. Not when its
      MIDI is shared with other items (pooled) or lives in a .mid file on
      disk - rewriting it would rewrite them too - and not when it loops,
      since every pass of the loop would play the same variation. Such an
      item is replaced by a new one instead. ]]
function M.canRewrite(src)
  local _, chunk = reaper.GetItemStateChunk(src.item, "", false)
  chunk = chunk or ""
  if chunk:find("POOLEDEVTS", 1, true) then return false end
  if chunk:find("<SOURCE MIDI%s*\n%s*FILE ") then return false end
  local _, L = passes(src.item, src.take, src.pos, src.startQN, src.lengthQN)
  return L == nil
end

-- `notes` into the item `src` was read from. Returns the item holding them
-- afterwards - the same one, or its replacement.
function M.rewrite(src, notes, index)
  if M.canRewrite(src) then
    writeNotes(src.take, src, notes, src.startQN)
    keepOriginal(src.item, src, index or src.index)
    reaper.UpdateItemInProject(src.item)
    return src.item
  end
  local item = M.create(src, notes, src.startQN, index or src.index)
  if not item then return nil end
  reaper.DeleteTrackMediaItem(src.track, src.item)
  return item
end

--[[  Each item in `items` rewritten with `notesFor(src, k)` - a new
      variation of its original, in place. One undo step. ]]
function M.varyInPlace(items, notesFor)
  if #items == 0 then return M.NO_ITEM, 0 end
  reaper.Undo_BeginBlock()
  reaper.PreventUIRefresh(1)
  local out = {}
  for k, item in ipairs(items) do
    local src = M.readItem(item)
    if src and #src.notes > 0 then
      local it = M.rewrite(src, notesFor(src, k))
      if it then out[#out + 1] = it end
    end
  end
  if #out > 0 then selectOnly(out) end
  finish("Midi Variator: vary in place", out)
  return #out > 0 and M.OK or M.NOTHING, #out
end

-- Each variation in `items` given back its original's notes. Items that
-- are not variations are left alone. One undo step.
function M.restore(items)
  if #items == 0 then return M.NO_ITEM, 0 end
  reaper.Undo_BeginBlock()
  reaper.PreventUIRefresh(1)
  local out = {}
  for _, item in ipairs(items) do
    local src = M.readItem(item)
    if src and src.stored then
      local it = M.rewrite(src, src.notes)
      if it then out[#out + 1] = it end
    end
  end
  if #out > 0 then selectOnly(out) end
  finish("Midi Variator: put back the original", out)
  return #out > 0 and M.OK or M.NOTHING, #out
end

return M
