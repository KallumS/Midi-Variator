--[[ A REAPER that records instead of doing, for test_place and test_ui.

     Started from Midi Suggester's mock and extended. Written from the API
     documentation's signatures, not from what the scripts expect: a mock
     shaped by the code agrees with the code's bugs.

     Anything the scripts call that is not here raises, so a call to a
     function REAPER does not have fails in the test, not in REAPER. Add a
     function here from the docs when the scripts start using one.

     The project: tracks in a list, items on tracks, notes and CCs in takes
     in PPQ at 960 a quarter, one tempo (120 unless set) and one time
     signature. A take can start part-way into its source (`offs`, in
     quarter notes), loop a source of `srcLen` quarter notes, be `pooled`
     with other items, or read a .mid `file` from disk.
]]

local P = {
  tracks = {}, selected = {},
  tempo = 120, num = 4, den = 4,
  undoDepth = 0, undoNames = {}, refreshDepth = 0,
  ext = {}, calls = {},
}

local PPQ = 960
P.PPQ = PPQ
local function qnPerSec() return P.tempo / 60 end
local function barQN() return P.num * 4 / P.den end

function P.track(name)
  local t = { kind = "track", name = name or "", items = {}, alive = true }
  P.tracks[#P.tracks + 1] = t
  return t
end

-- An item of notes given in quarter notes from its own start (from the
-- source's start when `opts.offs` is set).
function P.item(track, posQN, lenQN, notes, name, opts)
  opts = opts or {}
  local take = { kind = "take", midi = true, notes = {}, ccs = {}, name = name or "", sorted = true,
                 offs = opts.offs or 0, srcLen = opts.srcLen or (opts.offs or 0) + lenQN, alive = true }
  local item = { kind = "item", track = track, pos = posQN / qnPerSec(), len = lenQN / qnPerSec(),
                 take = take, ext = {}, loop = opts.loop and 1 or 0, color = opts.color or 0, vol = 1,
                 pooled = opts.pooled, file = opts.file, alive = true }
  take.item = item
  for _, n in ipairs(notes or {}) do
    take.notes[#take.notes + 1] = {
      sp = n.start * PPQ, ep = (n.start + n.len) * PPQ, pitch = n.pitch,
      vel = n.vel or 100, muted = n.muted or false, chan = n.chan or 0,
    }
  end
  for _, c in ipairs(opts.ccs or {}) do
    take.ccs[#take.ccs + 1] = { ppq = c.at * PPQ, chanmsg = c.chanmsg or 0xB0, chan = c.chan or 0,
                                m2 = c.m2, m3 = c.m3, muted = false }
  end
  track.items[#track.items + 1] = item
  return item
end

local function indexOf(list, x)
  for i, t in ipairs(list) do if t == x then return i end end
end

-- Where PPQ 0 of a take sits, in project quarter notes.
local function takeZeroQN(take) return take.item.pos * qnPerSec() - take.offs end

local function itemParm(item, parm, value)
  local map = { D_POSITION = "pos", D_LENGTH = "len", B_LOOPSRC = "loop",
                I_CUSTOMCOLOR = "color", D_VOL = "vol" }
  local field = map[parm]
  if not field then error("mock has no item parm " .. parm) end
  if value ~= nil then item[field] = value end
  return item[field]
end

-- What GetItemStateChunk would show of the parts the scripts look at.
local function chunkOf(item)
  local lines = { "<ITEM", "POSITION " .. item.pos, "<SOURCE " .. (item.pooled and "MIDIPOOL" or "MIDI") }
  if item.file then
    lines[#lines + 1] = 'FILE "' .. item.file .. '"'
  else
    lines[#lines + 1] = "HASDATA 1 960 QN"
    if item.pooled then lines[#lines + 1] = "POOLEDEVTS {6A7B-POOL}" end
  end
  lines[#lines + 1] = ">"
  lines[#lines + 1] = ">"
  return table.concat(lines, "\n")
end

local api = {
  -- Selection and takes
  CountSelectedMediaItems = function(_) return #P.selected end,
  GetSelectedMediaItem = function(_, i) return P.selected[i + 1] end,
  SelectAllMediaItems = function(_, sel)
    if sel then error("the scripts only ever clear the selection") end
    P.selected = {}
  end,
  SetMediaItemSelected = function(item, sel)
    local i = indexOf(P.selected, item)
    if sel and not i then P.selected[#P.selected + 1] = item end
    if not sel and i then table.remove(P.selected, i) end
  end,
  GetActiveTake = function(item) return item.take end,
  TakeIsMIDI = function(take) return take.midi end,
  GetMediaItemTake_Item = function(take) return take.item end,
  GetMediaItem_Track = function(item) return item.track end,
  GetTakeName = function(take) return take.name end,
  GetMediaItemInfo_Value = function(item, parm) return itemParm(item, parm) end,
  -- boolean SetMediaItemInfo_Value(MediaItem item, string parmname, number newvalue)
  SetMediaItemInfo_Value = function(item, parm, value)
    if type(value) ~= "number" then error("SetMediaItemInfo_Value needs a number") end
    itemParm(item, parm, value)
    return true
  end,
  -- boolean retval, string stringNeedBig = GetSetMediaItemInfo_String(item, parmname, string, set)
  GetSetMediaItemInfo_String = function(item, parm, value, set)
    local key = parm:match("^P_EXT:(.+)$")
    if not key then error("mock has no item string " .. parm) end
    if set then item.ext[key] = value end
    return true, item.ext[key] or ""
  end,
  GetSetMediaItemTakeInfo_String = function(take, parm, value, set)
    if parm ~= "P_NAME" then error("mock has no take string " .. parm) end
    if set then take.name = value end
    return true, take.name
  end,
  -- boolean retval, string str = GetItemStateChunk(MediaItem item, string str, boolean isundo)
  GetItemStateChunk = function(item, str, isundo) return true, chunkOf(item) end,
  GetMediaItemTake_Source = function(take) return { kind = "source", take = take } end,
  -- number retval, boolean lengthIsQN = GetMediaSourceLength(PCM_source source)
  GetMediaSourceLength = function(src) return src.take.srcLen, true end,
  UpdateItemInProject = function(item) item.updated = true end,

  -- Tracks and their items
  CountTrackMediaItems = function(track) return #track.items end,
  GetTrackMediaItem = function(track, i) return track.items[i + 1] end,
  -- boolean DeleteTrackMediaItem(MediaTrack tr, MediaItem it)
  DeleteTrackMediaItem = function(track, item)
    local i = indexOf(track.items, item)
    if not i then error("deleting an item that is not on that track") end
    table.remove(track.items, i)
    item.alive, item.take.alive = false, false
    local s = indexOf(P.selected, item)
    if s then table.remove(P.selected, s) end
    return true
  end,
  CreateNewMIDIItemInProj = function(track, t0, t1, qnIn)
    if qnIn then error("the scripts pass seconds") end
    if track.refuses then return nil end
    local take = { kind = "take", midi = true, notes = {}, ccs = {}, name = "", sorted = true,
                   offs = 0, srcLen = (t1 - t0) * qnPerSec(), alive = true }
    local item = { kind = "item", track = track, pos = t0, len = t1 - t0, take = take, ext = {},
                   loop = 1, color = 0, vol = 1, alive = true }   -- REAPER loops new MIDI items
    take.item = item
    track.items[#track.items + 1] = item
    return item
  end,
  ValidatePtr2 = function(_, ptr, kind)
    if kind == "MediaItem*" then return ptr ~= nil and ptr.kind == "item" and ptr.alive end
    if kind == "MediaItem_Take*" then return ptr ~= nil and ptr.kind == "take" and ptr.alive end
    if kind == "MediaTrack*" then return ptr ~= nil and ptr.kind == "track" and ptr.alive end
    error("mock cannot validate " .. tostring(kind))
  end,

  -- Time
  TimeMap2_timeToQN = function(_, t) return t * qnPerSec() end,
  TimeMap2_QNToTime = function(_, qn) return qn / qnPerSec() end,
  -- integer retval, optional number qnMeasureStart, optional number qnMeasureEnd
  TimeMap_QNToMeasures = function(_, qn)
    local b = barQN()
    local idx = math.floor(qn / b + 1e-9)
    return idx + 1, idx * b, (idx + 1) * b
  end,
  -- integer timesig_num, integer timesig_denom, number tempo: no retval first.
  TimeMap_GetTimeSigAtTime = function(_, _) return P.num, P.den, P.tempo end,

  -- MIDI
  -- integer retval, integer notecnt, integer ccevtcnt, integer textsyxevtcnt
  MIDI_CountEvts = function(take) return 1, #take.notes, #take.ccs, 0 end,
  -- boolean retval, boolean selected, boolean muted, number startppqpos,
  -- number endppqpos, integer chan, integer pitch, integer vel
  MIDI_GetNote = function(take, i)
    local n = take.notes[i + 1]
    if not n then return false end
    return true, false, n.muted, n.sp, n.ep, n.chan, n.pitch, n.vel
  end,
  -- boolean MIDI_DeleteNote(MediaItem_Take take, integer noteidx)
  MIDI_DeleteNote = function(take, i)
    if not take.notes[i + 1] then error("deleting a note that is not there") end
    table.remove(take.notes, i + 1)
    return true
  end,
  -- boolean retval, boolean selected, boolean muted, number ppqpos,
  -- integer chanmsg, integer chan, integer msg2, integer msg3
  MIDI_GetCC = function(take, i)
    local c = take.ccs[i + 1]
    if not c then return false end
    return true, false, c.muted, c.ppq, c.chanmsg, c.chan, c.m2, c.m3
  end,
  -- boolean MIDI_InsertCC(take, selected, muted, ppqpos, chanmsg, chan, msg2, msg3) - no noSort
  MIDI_InsertCC = function(take, sel, muted, ppq, chanmsg, chan, m2, m3, extra)
    if extra ~= nil then error("MIDI_InsertCC takes no ninth argument") end
    take.ccs[#take.ccs + 1] = { ppq = ppq, chanmsg = chanmsg, chan = chan, m2 = m2, m3 = m3, muted = muted }
    return true
  end,
  MIDI_GetProjQNFromPPQPos = function(take, ppq) return takeZeroQN(take) + ppq / PPQ end,
  MIDI_GetPPQPosFromProjQN = function(take, qn) return (qn - takeZeroQN(take)) * PPQ end,
  MIDI_InsertNote = function(take, sel, muted, sp, ep, chan, pitch, vel, noSort)
    if type(pitch) ~= "number" or pitch < 0 or pitch > 127 or pitch ~= math.floor(pitch) then
      error("a pitch MIDI cannot carry: " .. tostring(pitch))
    end
    if type(vel) ~= "number" or vel < 1 or vel > 127 or vel ~= math.floor(vel) then
      error("a velocity MIDI cannot carry: " .. tostring(vel))
    end
    if ep <= sp then error("a note that ends before it starts") end
    take.notes[#take.notes + 1] = { sp = sp, ep = ep, pitch = pitch, vel = vel, chan = chan,
                                    muted = muted, noSort = noSort }
    take.sorted = false
    return true
  end,
  MIDI_Sort = function(take)
    table.sort(take.notes, function(a, b)
      if a.sp ~= b.sp then return a.sp < b.sp end
      return a.pitch < b.pitch
    end)
    take.sorted = true
  end,

  -- Housekeeping
  Undo_BeginBlock = function() P.undoDepth = P.undoDepth + 1 end,
  Undo_EndBlock = function(name, flags)
    P.undoDepth = P.undoDepth - 1
    if P.undoDepth < 0 then error("Undo_EndBlock without a begin") end
    if type(name) ~= "string" or name == "" then error("an undo block needs a name") end
    P.undoNames[#P.undoNames + 1] = name
  end,
  PreventUIRefresh = function(n)
    P.refreshDepth = P.refreshDepth + n
    if P.refreshDepth < 0 then error("PreventUIRefresh went negative") end
  end,
  UpdateArrange = function() end,

  -- Settings
  GetExtState = function(s, k) return P.ext[s .. ":" .. k] or "" end,
  SetExtState = function(s, k, v, persist) P.ext[s .. ":" .. k] = v end,
}

function P.install()
  reaper = setmetatable({}, {
    __index = function(_, k)
      local f = api[k]
      if f == nil then error("the script called reaper." .. tostring(k) .. ", which the mock does not have") end
      return f
    end,
    __newindex = function(_, k, v) api[k] = v end,
  })
  return reaper
end

function P.reset()
  P.tracks, P.selected = {}, {}
  P.tempo, P.num, P.den = 120, 4, 4
  P.undoDepth, P.undoNames, P.refreshDepth = 0, {}, 0
  P.calls = {}
end

-- A take's notes as the engine would see them: quarter notes from the
-- item's start, sorted.
function P.notesOf(item)
  local out = {}
  local zero = takeZeroQN(item.take) - item.pos * qnPerSec()
  for _, n in ipairs(item.take.notes) do
    out[#out + 1] = { pitch = n.pitch, start = zero + n.sp / PPQ, len = (n.ep - n.sp) / PPQ,
                      vel = n.vel, chan = n.chan, muted = n.muted }
  end
  table.sort(out, function(a, b)
    if a.start ~= b.start then return a.start < b.start end
    return a.pitch < b.pitch
  end)
  return out
end

function P.posQN(item) return item.pos * qnPerSec() end

return P
