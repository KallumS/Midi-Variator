--[[
 * ReaScript Name: Midi Variator
 * Description:    Makes small variations of a MIDI item - a note bent, a
 *                 beat anticipated, a passing note, a chord revoiced, a
 *                 touch of feel - each one made from the original, so the
 *                 twentieth still sounds like the first.
 *
 * About:          Import a .mid file (or play something in), select the item,
 *                 and run this. Choose how much may change and what, preview
 *                 the variations against the original, then make them after
 *                 it on the same track. Every variation keeps the original
 *                 inside it, so it can be varied again - from the original -
 *                 or put back.
 *
 *                 Needs ReaImGui, from the ReaTeam Extensions repository.
 * Author:         Kallum Shah
 * Links:          https://github.com/KallumS/Midi-Variator
 * Version:        1.2
 * Provides:
 *   mv_theory.lua
 *   mv_vary.lua
 *   mv_place.lua
--]]

local TITLE   = "Midi Variator"
local SECTION = "MidiVariator"

------------------------------------------------------------------------------
-- Dependencies
------------------------------------------------------------------------------

local imgui_path = reaper.ImGui_GetBuiltinPath and
                   (reaper.ImGui_GetBuiltinPath() .. "/imgui.lua")
if not imgui_path then
  reaper.MB("Midi Variator needs the ReaImGui extension.\n\n" ..
            "Install it with ReaPack, from the ReaTeam Extensions repository.",
            "Missing dependency", 0)
  return
end
local ImGui = dofile(imgui_path)("0.9")

local HERE  = ({ reaper.get_action_context() })[2]:match("^(.*[/\\])")
local T     = dofile(HERE .. "mv_theory.lua")
local V     = dofile(HERE .. "mv_vary.lua")
local Place = dofile(HERE .. "mv_place.lua")
Place.use(V)

------------------------------------------------------------------------------
-- Look
--
-- The house scheme, shared with Starting Blocks, ScaleView and Midi
-- Suggester: a dark cool grey ground, light grey controls, one yellow for
-- whatever is switched on. Every grey is blue-shifted, R < G < B.
------------------------------------------------------------------------------

local THEME = {
  { "Col_Text",              0xDDE1E7FF },
  { "Col_TextDisabled",      0x8A919CFF },
  { "Col_WindowBg",          0x23272EFF },
  { "Col_PopupBg",           0x1B1F25FF },
  { "Col_Border",            0x14171CFF },
  { "Col_FrameBg",           0x1A1D23FF },
  { "Col_FrameBgHovered",    0x22262DFF },
  { "Col_FrameBgActive",     0x2A2F37FF },
  { "Col_TitleBg",           0x1B1F25FF },
  { "Col_TitleBgActive",     0x23272EFF },
  { "Col_TitleBgCollapsed",  0x1B1F25FF },
  { "Col_Button",            0xA9AFBAFF },
  { "Col_ButtonHovered",     0xC0C6CFFF },
  { "Col_ButtonActive",      0x8F96A2FF },
  { "Col_CheckMark",         0xFFF200FF },
  { "Col_SliderGrab",        0xA9AFBAFF },
  { "Col_SliderGrabActive",  0xFFF200FF },
  { "Col_Separator",         0x3A404AFF },
  { "Col_ScrollbarBg",       0x1A1D23FF },
  { "Col_ScrollbarGrab",     0x585F6BFF },
  { "Col_ScrollbarGrabHovered", 0x6D7581FF },
  { "Col_ScrollbarGrabActive",  0xA9AFBAFF },
}

local SELECTED  = 0xFFF200FF   -- the accent: a switch that is on, and the variation's notes
local INK       = 0x14171CFF   -- text on every button, grey or yellow
local STEP      = 0xBFC5CEFF   -- the step numbers
local ROLL_BG   = 0x111419FF
local ROLL_BAR  = 0x3A404AFF
local ROLL_BEAT = 0x1E2228FF
-- The original's notes in the roll: grey, so yellow only ever means the
-- variation - what would be different.
local SOURCE_NOTE = 0x6D7581FF
local DIM       = 0x8A919CFF
local PLAYHEAD  = 0xDDE1E7FF   -- where the audition has got to, in the roll
local WARN      = 0xD2483FFF

-- Shifts a colour towards white or black, keeping its alpha byte.
local function shade(col, amount)
  local a = col % 256
  local b = math.floor(col / 256) % 256
  local g = math.floor(col / 65536) % 256
  local r = math.floor(col / 16777216) % 256
  local function mix(c)
    if amount >= 0 then return math.floor(c + (255 - c) * amount + 0.5) end
    return math.floor(c * (1 + amount) + 0.5)
  end
  return mix(r) * 16777216 + mix(g) * 65536 + mix(b) * 256 + a
end

------------------------------------------------------------------------------
-- State
------------------------------------------------------------------------------

-- Preferences, kept between runs. What the source is belongs to the
-- project, so it is not saved.
local st = { amount = 35, focus = 1, keepEnds = 1, grow = 0, count = 4, own = 0, fit = 1, outside = 0,
             develop = 1, form = 1, together = 1 }
for _, k in ipairs(V.KINDS) do st[k.key] = 1 end
for _, f in ipairs(V.FEELS) do st[f.key] = 1 end

local LIMITS = { amount = { 0, 100 }, focus = { 1, #V.FOCUS }, keepEnds = { 0, 1 },
                 grow = { 0, 1 }, count = { 1, 16 }, own = { 0, 1 }, fit = { 0, 1 },
                 outside = { 0, 1 }, develop = { 0, 1 }, form = { 1, #V.FORMS },
                 together = { 0, 1 } }
for _, k in ipairs(V.KINDS) do LIMITS[k.key] = { 0, 1 } end
for _, f in ipairs(V.FEELS) do LIMITS[f.key] = { 0, 1 } end

local ui = {
  srcs = nil,        -- what Place.read returned
  ans = nil,         -- V.analyse of each: what was heard in it
  pick = nil,        -- { root, scale } picked in the window, or nil for what was heard
  work = nil,        -- each source as varied: the original, or it brought into the picked scale
  prep = nil,        -- the analysis each batch is made from
  seed = 1,
  runs = nil,        -- for each source, the batch of variations previewed
  show = 1,          -- which variation of the batch the roll shows
  histories = {},    -- per original, what earlier batches changed
  skips = {},        -- skips[j][i]: the changes unticked in source j's i-th variation
  dirty = false, status = "", warn = false,
}

local ctx

local function say(text, warn) ui.status, ui.warn = text, warn or false end

local function saveState()
  local out = {}
  for k in pairs(LIMITS) do out[#out + 1] = k .. "=" .. tostring(st[k]) end
  table.sort(out)
  reaper.SetExtState(SECTION, "state", table.concat(out, ";"), true)
end

local function loadState()
  local blob = reaper.GetExtState(SECTION, "state")
  if not blob or blob == "" then return end
  for pair in blob:gmatch("[^;]+") do
    local k, v = pair:match("^(%w+)=(.*)$")
    v = tonumber(v)
    if k and LIMITS[k] and v then
      st[k] = math.max(LIMITS[k][1], math.min(LIMITS[k][2], math.floor(v)))
    end
  end
end

local function newSeed()
  ui.seed = (math.floor(os.time()) * 7 + math.floor(os.clock() * 1000) + ui.seed * 31) % 2147483000 + 1
  ui.skips = {}      -- unticked changes belong to the variations they were in
end

local function options()
  local o = V.defaults()
  o.amount = st.amount / 100
  o.focus = st.focus
  o.keepEnds = st.keepEnds == 1
  o.grow = st.grow == 1
  o.outside = st.outside == 1
  o.develop = st.develop == 1
  o.form = st.form
  for _, k in ipairs(V.KINDS) do o[k.key] = st[k.key] == 1 end
  for _, f in ipairs(V.FEELS) do o[f.key] = st[f.key] == 1 end
  return o
end

-- Which earlier batches of this original changed what, so the next batch
-- spreads its changes. Keyed by the original itself - or, for items varied
-- together, by all of theirs.
local function historyFor(...)
  local keys = {}
  for i, src in ipairs({ ... }) do keys[i] = V.encode(src.original, src.lengthQN, src.name, 0) end
  local key = table.concat(keys, "\n")
  ui.histories[key] = ui.histories[key] or {}
  return ui.histories[key]
end

-- A copy of a history, for previewing without spending it.
local function copyOf(h)
  local out = {}
  for k, x in pairs(h) do out[k] = x end
  return out
end

------------------------------------------------------------------------------
-- Reading and varying
------------------------------------------------------------------------------

local function load(quiet)
  Place.auditionStop()   -- it was playing the last source's variation
  local srcs, why = Place.read()
  if not srcs then
    ui.srcs, ui.ans, ui.runs = nil, nil, nil
    if not quiet then
      say(why == Place.NO_ITEM and "Select a MIDI item first." or "That item has no notes in it.", true)
    end
    return
  end
  ui.srcs, ui.ans, ui.skips = srcs, {}, {}
  for j, src in ipairs(srcs) do ui.ans[j] = V.analyse(src, T) end
  -- A picked scale belongs to the music it was picked for, not to the user.
  ui.pick = nil
  ui.show, ui.dirty = 1, true
  say("")
end

-- What the Scale step asks for, in the engine's terms (see V.prepare).
local function currentPick()
  if st.own == 1 then return { own = true } end
  if ui.pick then return { root = ui.pick.root, scale = ui.pick.scale, fit = st.fit == 1 } end
  return nil
end

-- The first source that has a key (drums have none), and its analysis.
local function heardFirst()
  for j, an in ipairs(ui.ans or {}) do if an.heardKey then return an, ui.srcs[j] end end
end

-- The key heard in the first source, as a root and a ScaleView scale.
local function heardPick()
  local an = heardFirst()
  local k = an and an.heardKey
  if not k then return nil end
  return { root = k.root, scale = V.scaleIndex(T.SCALES[k.scale].name) }
end

-- Some of the sources sound together: there is something to vary as one.
local function canGroup()
  for _, grp in ipairs(ui.srcs and V.groups(ui.srcs) or {}) do if #grp > 1 then return true end end
  return false
end

-- The sources as they are varied: in groups that sound together when Vary
-- them together is on, else each alone.
local function groupsNow()
  if st.together == 1 then return V.groups(ui.srcs) end
  local out = {}
  for j = 1, #ui.srcs do out[j] = { j } end
  return out
end

local function membersOf(grp)
  local out = {}
  for i, j in ipairs(grp) do out[i] = ui.srcs[j] end
  return out
end

local function rebuild()
  ui.dirty = false
  ui.runs, ui.work, ui.prep = {}, {}, {}
  if not ui.srcs then return end
  local o, pk = options(), currentPick()
  ui.groups = groupsNow()
  for _, grp in ipairs(ui.groups) do
    local j0 = grp[1]
    if #grp == 1 then
      local src = ui.srcs[j0]
      ui.work[j0], ui.prep[j0] = V.prepare(src, T, pk)
      ui.runs[j0] = V.series(ui.work[j0], ui.prep[j0], o, ui.seed, st.count, T, j0, copyOf(historyFor(src)),
                             ui.skips[j0])
      -- Measured against the true original, so a pivot shows as the change it is.
      for _, var in ipairs(ui.runs[j0]) do var.like = V.likeness(src.notes, var.notes) end
    else
      -- One piece: varied as one, each item given its own notes back. The
      -- changes are listed once, with the group's first item.
      local members = membersOf(grp)
      local combined = V.combine(members)
      local work, an = V.prepare(combined, T, pk)
      local run = V.series(work, an, o, ui.seed, st.count, T, j0, copyOf(historyFor(table.unpack(members))),
                           ui.skips[j0])
      for i, j in ipairs(grp) do
        ui.work[j], ui.prep[j], ui.runs[j] = ui.srcs[j], an, {}
        for k, var in ipairs(run) do
          local notes = V.split(var.notes, combined)[i]
          ui.runs[j][k] = { notes = notes, home = var.home, echo = var.echo,
                            changes = i == 1 and var.changes or {}, moves = i == 1 and var.moves or {},
                            like = V.likeness(ui.srcs[j].notes, notes), together = #grp }
        end
      end
    end
  end
  if ui.show > st.count then ui.show = 1 end
end

-- A setting changed: a new batch, so nothing in it is unticked yet.
local function touched() ui.dirty = true; ui.skips = {} end

local function hasChords()
  for _, an in ipairs(ui.ans or {}) do
    for _, e in ipairs(an.events) do if #e.notes >= 3 and not e.drum then return true end end
  end
  return false
end

-- Chords played one note at a time: Chord quality changes them too.
local function hasArpeggios()
  for _, an in ipairs(ui.ans or {}) do if #an.broken > 0 then return true end end
  return false
end

local function allDrums()
  for _, an in ipairs(ui.ans or {}) do if not an.drums then return false end end
  return true
end

-- Develop can happen: high enough on the slider, and something with pitches.
local function canDevelop()
  return st.amount > V.DEVELOP_FROM * 100 + 1e-9 and not allDrums()
end

local function sourcesAlive()
  for _, src in ipairs(ui.srcs or {}) do
    if not reaper.ValidatePtr2(0, src.item, "MediaItem*") then return false end
  end
  return true
end

local function plural(n, word) return ("%d %s%s"):format(n, word, n == 1 and "" or "s") end

-- The notes the roll shows, one list per source: what an audition plays.
local function shownLists()
  local out = {}
  for j in ipairs(ui.srcs) do out[j] = ui.runs[j][ui.show].notes end
  return out
end

local function makeThem()
  Place.auditionStop()
  if not sourcesAlive() then
    load(true)
    say("The item has gone - select it and press Use selected items.", true)
    return
  end
  local jobs = {}
  for _, grp in ipairs(ui.groups) do
    -- Items varied together go to places worked out together.
    local at = #grp > 1 and Place.slotsTogether(membersOf(grp), st.count)
    for i, j in ipairs(grp) do
      local src = ui.work[j]
      local lists = {}
      for k, var in ipairs(ui.runs[j]) do lists[k] = var.notes end
      -- The working copy carries the TRUE original: that is what is kept.
      jobs[#jobs + 1] = { src = src, variations = lists, first = Place.nextIndex(src), at = at and at[i] }
    end
    -- What this batch changed steers the next one.
    local h = historyFor(table.unpack(membersOf(grp)))
    for _, var in ipairs(ui.runs[grp[1]]) do
      for _, c in ipairs(var.moves) do
        if not c.skipped and not var.echo then
          h["@" .. c.event] = (h["@" .. c.event] or 0) + 1
          h[c.move .. "@" .. c.event] = (h[c.move .. "@" .. c.event] or 0) + 1
        end
      end
    end
  end
  local result, made = Place.make(jobs)
  if result ~= Place.OK then
    say("REAPER would not make the items.", true)
    return
  end
  say(("Made %s after \"%s\". They are selected: Vary selected in place re-rolls them."):format(
      plural(made, "variation"), ui.srcs[1].name))
  newSeed()
  ui.show, ui.dirty = 1, true
end

local function varySelected()
  Place.auditionStop()
  local o, pk = options(), currentPick()
  local items = Place.selectedItems()
  local result, count = Place.varyGroupsInPlace(items, function(srcs, k)
    if #srcs == 1 then
      local work, an = V.prepare(srcs[1], T, pk)
      return { V.vary(work, an, o, V.seedFor(ui.seed, k, 97), T, historyFor(srcs[1])).notes }
    end
    local combined = V.combine(srcs)
    local work, an = V.prepare(combined, T, pk)
    local var = V.vary(work, an, o, V.seedFor(ui.seed, k, 97), T, historyFor(table.unpack(srcs)))
    return V.split(var.notes, combined)
  end, st.together == 1)
  newSeed()
  if result ~= Place.OK then say("Select the MIDI items to vary first.", true); return end
  -- Re-read replaced sources first: reading clears the status line.
  if not sourcesAlive() then load(true) end
  say(("Varied %s in place, each from its own original."):format(plural(count, "item")))
  ui.dirty = true
end

local function restoreSelected()
  Place.auditionStop()
  local result, count = Place.restore(Place.selectedItems())
  if result ~= Place.OK then say("None of the selected items is a variation.", true); return end
  if not sourcesAlive() then load(true) end
  say(("Put the original back in %s."):format(plural(count, "item")))
end

------------------------------------------------------------------------------
-- Widgets
------------------------------------------------------------------------------

local function pushTheme()
  for _, c in ipairs(THEME) do ImGui.PushStyleColor(ctx, ImGui[c[1]], c[2]) end
end
local function popTheme() ImGui.PopStyleColor(ctx, #THEME) end

-- A button that is on takes the accent; every button, on or not, takes the
-- dark ink, because both fills are far lighter than the window's own text.
local function pick(label, selected, width)
  local pushed = 1
  if selected then
    ImGui.PushStyleColor(ctx, ImGui.Col_Button, SELECTED)
    ImGui.PushStyleColor(ctx, ImGui.Col_ButtonHovered, shade(SELECTED, 0.18))
    ImGui.PushStyleColor(ctx, ImGui.Col_ButtonActive, shade(SELECTED, -0.18))
    pushed = 4
  end
  ImGui.PushStyleColor(ctx, ImGui.Col_Text, INK)
  local hit = ImGui.Button(ctx, label, width or 0, 0)
  ImGui.PopStyleColor(ctx, pushed)
  return hit
end

-- The steps number themselves: drums have no Scale step, and the steps
-- after it close up rather than skip a number.
local stepNo = 0
local function heading(text)
  stepNo = stepNo + 1
  ImGui.PushStyleColor(ctx, ImGui.Col_Text, STEP)
  ImGui.Text(ctx, tostring(stepNo))
  ImGui.PopStyleColor(ctx, 1)
  ImGui.SameLine(ctx, 0, 10)
  ImGui.SeparatorText(ctx, text)
end

local function stepGap() ImGui.Dummy(ctx, 16, 22) end

local function tip(text)
  if text and ImGui.IsItemHovered(ctx) then ImGui.SetTooltip(ctx, text) end
end

local function dim(text)
  ImGui.PushStyleColor(ctx, ImGui.Col_Text, DIM)
  ImGui.Text(ctx, text)
  ImGui.PopStyleColor(ctx, 1)
end

local LABEL_W = 110
local function label(text)
  dim(text)
  ImGui.SameLine(ctx, LABEL_W)
end

-- A switch: on is yellow. Returns true when clicked.
local function switch(key, name, hint, width)
  ImGui.PushID(ctx, key)
  local hit = pick(name, st[key] == 1, width)
  ImGui.PopID(ctx)
  tip(hint)
  if hit then st[key] = 1 - st[key]; touched() end
end

------------------------------------------------------------------------------
-- The roll
------------------------------------------------------------------------------

local function pianoRoll(layers, beats, barBeats, width, height, playhead)
  local dl = ImGui.GetWindowDrawList(ctx)
  local x, y = ImGui.GetCursorScreenPos(ctx)
  ImGui.InvisibleButton(ctx, "##roll", width, height)
  ImGui.DrawList_AddRectFilled(dl, x, y, x + width, y + height, ROLL_BG, 3)
  beats = math.max(beats or 0, 1e-9)

  local b = 0
  while b <= beats + 1e-9 do
    local gx = x + width * (b / beats)
    ImGui.DrawList_AddLine(dl, gx, y, gx, y + height,
                           (b % barBeats < 1e-9) and ROLL_BAR or ROLL_BEAT, 1)
    b = b + 1
  end

  local lo, hi = 200, -1
  for _, layer in ipairs(layers) do
    for _, n in ipairs(layer[1]) do lo, hi = math.min(lo, n.pitch), math.max(hi, n.pitch) end
  end
  if hi < 0 then return end
  if hi - lo < 11 then
    lo = math.max(0, math.floor((lo + hi) / 2) - 6)
    hi = lo + 12
  end
  local rowh = height / (hi - lo + 1)
  for _, layer in ipairs(layers) do
    for _, n in ipairs(layer[1]) do
      local nx = x + width * (n.start / beats)
      local nw = math.max(2, width * (n.len / beats) - 1)
      local ny = y + height - (n.pitch - lo + 1) * rowh
      ImGui.DrawList_AddRectFilled(dl, nx, ny, nx + nw, ny + math.max(2, rowh - 1), layer[2], 1)
    end
  end
  if playhead then
    local px = x + width * playhead
    ImGui.DrawList_AddLine(dl, px, y, px, y + height, PLAYHEAD, 1)
  end
end

-- Every source's notes on one timeline, from the first one's bar line.
local function together(listOf)
  local base = ui.srcs[1].originQN
  local out, finish = {}, 0
  for j, src in ipairs(ui.srcs) do
    local shift = src.originQN - base
    for _, n in ipairs(listOf(j)) do
      out[#out + 1] = { pitch = n.pitch, start = n.start + shift, len = n.len }
    end
    finish = math.max(finish, shift + src.beats)
  end
  return out, finish
end

------------------------------------------------------------------------------
-- The three steps
------------------------------------------------------------------------------

local function drawSource()
  heading("Source")
  if pick("Use selected items", false, 170) then load() end
  tip("Select one or more MIDI items in the arrange view - an imported .mid file\n" ..
      "is one - then press this. Each is varied on its own track.")
  if not ui.srcs then
    dim("Import a .mid file onto a track, select the item it makes, and press the button.")
    return
  end
  -- Only when some of them sound at the same time.
  if canGroup() then
    ImGui.SameLine(ctx)
    switch("together", "Vary them together",
           "The items that sound at the same time - a melody on one track and its\n" ..
           "chords on another - are varied as one piece: a changed melody note\n" ..
           "never grinds against the chords, a changed chord never against the\n" ..
           "tune, the key is heard from all of them, and each variation of one\n" ..
           "lines up with the same variation of the others.\n" ..
           "Off: each item is varied on its own.", 170)
  end
  for j, src in ipairs(ui.srcs) do
    if j > 4 then dim(("and %d more"):format(#ui.srcs - 4)); break end
    local an = ui.ans[j]
    local bars = math.floor((src.beats - src.lead) / src.barBeats + 0.5)
    local what = an.drums and "drums" or (an.key and an.key.label or "")
    dim(("\"%s\"   %s of %d/%d, %s, %s"):format(src.name, plural(math.max(bars, 1), "bar"),
        src.num, src.den, plural(#src.notes, "note"), what))
    if src.stored then
      ImGui.SameLine(ctx, 0, 12)
      dim("- a variation; new ones start from its original")
    end
  end
end

local SCALE_ROW = 6   -- scale buttons to a row

local function pickScale(root, scale)
  local h = heardPick()
  if h and h.root == root and h.scale == scale then ui.pick = nil   -- back to what was heard
  else ui.pick = { root = root, scale = scale } end
  touched()
end

local function drawScale()
  heading("Scale")
  local an, from = heardFirst()
  local heard = an.heardKey

  switch("own", "Stay in the original's notes",
         "Changed and added notes use only the notes the original already\n" ..
         "plays - nothing new at all. The scale below is set aside.", 0)
  if st.own == 1 then
    local names = {}
    for pc = 0, 11 do
      if an.played[pc] then names[#names + 1] = T.noteName(heard, pc) end
    end
    ImGui.SameLine(ctx, 0, 14)
    dim("Changes use only " .. table.concat(names, " ") .. ".")
    return
  end
  ImGui.SameLine(ctx, 0, 14)
  dim(("Heard as %s%s."):format(heard.label, #ui.srcs > 1 and (" in \"" .. from.name .. "\"") or ""))

  local cur = ui.pick or heardPick()
  label("Root")
  ImGui.PushID(ctx, "root")
  for i, r in ipairs(T.ROOTS) do
    if i > 1 then ImGui.SameLine(ctx) end
    ImGui.PushID(ctx, i)
    if pick(r.name, cur.root == i, 34) then pickScale(i, cur.scale) end
    ImGui.PopID(ctx)
  end
  ImGui.PopID(ctx)

  label("Scale")
  ImGui.PushID(ctx, "scale")
  for i, sc in ipairs(V.SCALES) do
    if i > 1 then
      if (i - 1) % SCALE_ROW == 0 then ImGui.Dummy(ctx, 1, 1); ImGui.SameLine(ctx, LABEL_W)
      else ImGui.SameLine(ctx) end
    end
    ImGui.PushID(ctx, i)
    if pick(sc.name, cur.scale == i, 150) then pickScale(cur.root, i) end
    ImGui.PopID(ctx)
  end
  ImGui.PopID(ctx)

  if not ui.pick then
    dim("Pick another scale to take the variations there.")
    return
  end
  if pick("Back to what it heard", false, 200) then ui.pick = nil; touched(); return end
  tip("Forget the picked scale and use the one heard in the music.")

  local sc = V.pickedScale(T, ui.pick.root, ui.pick.scale)
  local outside = 0
  for _, src in ipairs(ui.srcs) do
    for _, n in ipairs(src.notes) do
      if (n.chan or 0) ~= V.DRUM_CHANNEL and not sc.pcs[n.pitch % 12] then outside = outside + 1 end
    end
  end
  if outside == 0 then
    dim(("Every note of the original is in %s already; the changes use its notes."):format(sc.label))
    return
  end
  local changed, v = ImGui.Checkbox(ctx, "Bring the original into this scale", st.fit == 1)
  if changed then st.fit = v and 1 or 0; touched() end
  tip("On: the original's notes outside the scale move to its nearest note\n" ..
      "first - C major into C minor makes every E an Eb - so the variations\n" ..
      "pivot to the new scale. Off: the original stays as it is, and only\n" ..
      "the changes use the new scale.")
  local fitted = {}
  for _, p in ipairs(ui.prep or {}) do if #p.fitted > #fitted then fitted = p.fitted end end
  if st.fit == 1 and #fitted > 0 then
    dim(("Moved into %s: %s."):format(sc.label, V.describeFit(fitted, heard, sc)))
  elseif st.fit == 0 then
    dim(("%s of the original outside %s stay as they are; the changes use %s."):format(
        plural(outside, "note"), sc.label, sc.label))
  end
end

local MAX_LINES = 10   -- changes listed for one variation

local AMOUNT_WORDS = { { 0, "none - exact copies" }, { 1, "a whisper" }, { 21, "subtle" },
                       { 46, "noticeable" }, { 71, "bold, still recognisable" } }

local function drawChanges()
  heading("What may change")

  label("How much")
  ImGui.SetNextItemWidth(ctx, 240)
  local changed, v = ImGui.SliderInt(ctx, "##amount", st.amount, 0, 100, "%d%%")
  if changed then st.amount = math.max(0, math.min(100, v)); touched() end
  tip("How far each variation strays from the original. Even at 100% most of\n" ..
      "the original stays exactly as it was.")
  ImGui.SameLine(ctx, 0, 14)
  local words = AMOUNT_WORDS[1][2]
  for _, w in ipairs(AMOUNT_WORDS) do if st.amount >= w[1] then words = w[2] end end
  local want = V.budget(st.amount / 100, #ui.srcs[1].notes)
  if st.amount > 0 then
    local about = math.max(1, math.floor(want + 0.5))
    words = ("%s - about %s in %d notes"):format(words, plural(about, "change"), #ui.srcs[1].notes)
  end
  if canDevelop() and st.develop == 1 then words = words .. ", and now and then a stretch developed" end
  dim(words)

  local hints = {
    notes = "A note moved one step up or down the key (or, now and then, an octave).",
    rhythm = "A long note struck twice, two notes tied into one, or a beat\n" ..
             "anticipated (pushed early) or held back.",
    add = "A passing note, a grace note, a pickup into a note, a chord filled\n" ..
          "out, or - for drums - a ghost note.",
    remove = "A weak note left out (sometimes the note before is held over it),\n" ..
             "or a chord thinned.",
    chords = "A chord revoiced (an inner note moved an octave) or rolled like a strum.",
    quality = "A chord changed to a neighbouring quality, read by ScaleView Pro:\n" ..
              "C to Cmaj7, C6 or Cadd9; G7 to G9, G13, G11 or G7b9; Cmin to Cmin7\n" ..
              "or Cdim; a sus chord, or one resolved. The bass stays where it is,\n" ..
              "and a chord struck several times in a row changes every time.\n" ..
              "Arpeggiated chords too: C G E G can become C G E B (Cmaj7).",
    timing = "Each moment a few milliseconds early or late, as a player would be.",
    velocity = "A little louder or softer, with a gentle swell across the phrase.",
    lengths = "Notes held a touch longer or shorter.",
  }

  label("Changes")
  local first = true
  for _, k in ipairs(V.KINDS) do
    -- Voicing needs chords struck together; quality takes arpeggios too.
    local shown = not ((k.key == "chords" and not hasChords())
                    or (k.key == "quality" and not hasChords() and not hasArpeggios())
                    or (k.key == "notes" and allDrums()))
    if shown then
      if not first then ImGui.SameLine(ctx) end
      switch(k.key, k.name, hints[k.key])
      first = false
    end
  end

  -- Only while Chord quality is on and there are chords for it to change.
  if st.quality == 1 and (hasChords() or hasArpeggios()) then
    ImGui.Dummy(ctx, 1, 1)
    ImGui.SameLine(ctx, LABEL_W)
    local c, v = ImGui.Checkbox(ctx, "Chord changes may leave the scale", st.outside == 1)
    if c then st.outside = v and 1 or 0; touched() end
    tip("Off: a chord only changes into one whose notes are in the scale -\n" ..
        "in C major, G7 can become G9 or G13, C can become Cmaj7 or C6.\n" ..
        "On: it may borrow notes from outside - C can become Cmin or Caug,\n" ..
        "G7 can become G7b9, Amin can become Adim.")
  end

  -- Only near the top of the slider, where it can happen, and not for drums.
  if canDevelop() then
    ImGui.Dummy(ctx, 1, 1)
    ImGui.SameLine(ctx, LABEL_W)
    switch("develop", "Develop the motif",
           "Near 100%, now and then a variation takes a stretch of the music - a\n" ..
           "bar or two, or at 100% most of it - and develops it the way a composer\n" ..
           "brings a motif back: turned upside down, played in reverse order, moved\n" ..
           "up or down the scale (a sequence), its intervals widened or narrowed, or\n" ..
           "its first half repeated a step lower. The rhythm stays, so it is still\n" ..
           "recognisable, and the first and last notes stay when kept.")
  end

  label("Feel")
  for i, f in ipairs(V.FEELS) do
    if i > 1 then ImGui.SameLine(ctx) end
    switch(f.key, f.name, hints[f.key], 90)
  end

  label("Where")
  for i, name in ipairs(V.FOCUS) do
    if i > 1 then ImGui.SameLine(ctx) end
    ImGui.PushID(ctx, "focus" .. i)
    if pick(name, st.focus == i, 0) then st.focus = i; touched() end
    ImGui.PopID(ctx)
    tip(({ "Changes may land anywhere in the phrase.",
           "Changes gather towards the end - the phrase starts the same and\n" ..
           "answers differently, the classic way to vary a repeated motif.",
           "Changes gather towards the start." })[i])
  end

  local c1, keep = ImGui.Checkbox(ctx, "Keep the first and last notes", st.keepEnds == 1)
  if c1 then st.keepEnds = keep and 1 or 0; touched() end
  tip("The notes that open and close the phrase stay exactly as they are,\n" ..
      "so every variation is recognisably the same motif.")
end

local function drawVariations()
  heading("Variations")

  label("How many")
  ImGui.SetNextItemWidth(ctx, 240)
  local changed, v = ImGui.SliderInt(ctx, "##count", st.count, 1, 16, "%d")
  if changed then st.count = math.max(1, math.min(16, v)); touched() end
  ImGui.SameLine(ctx, 0, 14)
  local c2, grow = ImGui.Checkbox(ctx, "Grow across the series", st.grow == 1)
  if c2 then st.grow = grow and 1 or 0; touched() end
  tip("The first variations change less and the last the full amount, so a\n" ..
      "repeated motif builds. Each is still made from the original.")

  -- The form: what comes after the original, A. Only with something to
  -- arrange.
  if st.count > 1 then
    label("Form")
    for i, f in ipairs(V.FORMS) do
      if i > 1 then ImGui.SameLine(ctx) end
      ImGui.PushID(ctx, "form" .. i)
      if pick(f.name, st.form == i, 0) then st.form = i; touched() end
      ImGui.PopID(ctx)
      tip(f.hint .. "\nAfter the original: " .. V.formLetters(i, st.count))
    end
    ImGui.SameLine(ctx, 0, 14)
    dim("A  " .. V.formLetters(st.form, st.count))
  end
  -- Anything changed above, this frame or in step 2, is previewed now.
  if ui.dirty then rebuild() end

  if st.count > 1 then
    if pick("<", false, 28) then ui.show = (ui.show - 2) % st.count + 1 end
    ImGui.SameLine(ctx)
  end
  ImGui.Text(ctx, ("Variation %d of %d"):format(ui.show, st.count))
  if st.count > 1 then
    ImGui.SameLine(ctx)
    if pick(">", false, 28) then ui.show = ui.show % st.count + 1 end
  end
  local runs = ui.runs
  local shown = {}
  local like, total = 0, 0
  for j, run in ipairs(runs) do
    shown[j] = run[ui.show]
    like = like + shown[j].like * #ui.srcs[j].notes
    total = total + #ui.srcs[j].notes
  end
  ImGui.SameLine(ctx, 0, 16)
  local now = shown[1]
  if now.home then
    dim("the original again, played afresh")
  elseif now.echo then
    dim(("an echo of variation %d: the same changes, played afresh"):format(now.echo))
  else
    dim(("keeps %d%% of the original's notes as they were"):format(math.floor(100 * like / math.max(total, 1) + 0.5)))
  end
  ImGui.SameLine(ctx, 0, 16)
  if pick("New set", false, 90) then newSeed(); touched() end
  tip("Another set of variations with the same settings.")
  ImGui.SameLine(ctx)
  local playing = Place.auditioning()
  if pick(playing and "Stop" or "Audition", playing, 90) then
    if playing then Place.auditionStop()
    else
      if ui.dirty then rebuild() end
      if Place.auditionStart(ui.srcs, shownLists()) ~= Place.OK then
        say("The item has gone - select it and press Use selected items.", true)
      end
      ui.heard = { runs = ui.runs, show = ui.show }
    end
  end
  tip("Plays this variation in the original's place, with the rest of the\n" ..
      "project, from the bar it starts in; the original is silent meanwhile.\n" ..
      "Step through the batch with < and > while it plays to hear the others.\n" ..
      "Nothing is added to the project or the undo history.")
  -- Stepped, or changed, while it plays: the new one comes straight in.
  if Place.auditioning() and ui.heard and (ui.heard.runs ~= ui.runs or ui.heard.show ~= ui.show) then
    Place.auditionSwap(shownLists())
    ui.heard = { runs = ui.runs, show = ui.show }
  end

  local w = select(1, ImGui.GetContentRegionAvail(ctx))
  local orig, beats = together(function(j) return ui.srcs[j].notes end)
  local var = together(function(j) return shown[j].notes end)
  pianoRoll({ { orig, SOURCE_NOTE }, { var, SELECTED } }, beats, ui.srcs[1].barBeats, math.max(160, w), 110,
            ui.playhead)

  -- The changes, each with a box: untick one to leave it out of this
  -- variation - the others stay exactly as they are.
  local lines = {}
  for _, grp in ipairs(ui.groups) do
    local j = grp[1]
    local names = {}
    for i, m in ipairs(grp) do names[i] = "\"" .. ui.srcs[m].name .. "\"" end
    for _, c in ipairs(shown[j].moves) do
      lines[#lines + 1] = { j = j, c = c,
        text = (#ui.srcs > 1 and (table.concat(names, " + ") .. "  ") or "") .. c.text }
    end
  end
  if #lines == 0 then
    dim(st.amount == 0 and "No changes to the notes."
        or now.home and "No changes: the original, with only the feel new."
        or "Only the feel changes in this one.")
  end
  for i, line in ipairs(lines) do
    if i > MAX_LINES then dim(("and %d more"):format(#lines - MAX_LINES)); break end
    local c = line.c
    local changed, on = ImGui.Checkbox(ctx, ("%s##change%d.%d"):format(line.text, line.j, c.id), not c.skipped)
    if changed then
      ui.skips[line.j] = ui.skips[line.j] or {}
      local per = ui.skips[line.j]
      -- An echo's boxes are the ones of the variation it echoes.
      local at = shown[line.j].echo or ui.show
      per[at] = per[at] or {}
      per[at][c.id] = (not on) or nil
      ui.dirty = true    -- not touched(): that would forget the other boxes
    end
    tip("Untick to leave this change out of this variation. Every other\n" ..
        "change, and the feel, stays exactly as it is.")
  end

  ImGui.Dummy(ctx, 0, 4)
  if pick(("Make %s"):format(plural(st.count, "variation")), false, 180) then makeThem() end
  tip("Puts these variations after the original on its track, one after\n" ..
      "another, each starting on the same beat of its bar. Nothing already\n" ..
      "on the track is covered. One undo step.")

  local selected = Place.selectedItems()
  if #selected > 0 then
    ImGui.SameLine(ctx)
    if pick("Vary selected in place", false, 190) then
      varySelected()
      -- Varying can replace items (pooled copies, .mid files, loops), and
      -- REAPER refuses a deleted one: read the selection again.
      selected = Place.selectedItems()
    end
    tip("Gives every selected MIDI item a new variation of its own original,\n" ..
        "where it is. Select a row of copies of a phrase and press this to\n" ..
        "vary them all. One undo step.")
    local anyVariation = false
    for _, item in ipairs(selected) do
      local _, text = reaper.GetSetMediaItemInfo_String(item, Place.EXT, "", false)
      if text ~= "" then anyVariation = true; break end
    end
    if anyVariation then
      ImGui.SameLine(ctx)
      if pick("Put back the original", false, 180) then restoreSelected() end   -- the last use of `selected`
      tip("Every selected variation plays its original again. It stays a\n" ..
          "variation, so it can be varied again later.")
    end
  end
end

local function frame()
  stepNo = 0
  ui.playhead = Place.auditionTick()   -- and stops it at the end
  if ui.dirty then rebuild() end

  drawSource()
  if ui.dirty then rebuild() end   -- a source just read
  if ui.srcs then
    if not allDrums() then
      stepGap()
      drawScale()
      if ui.dirty then rebuild() end   -- a scale just picked
    end
    stepGap()
    drawChanges()
    stepGap()
    drawVariations()
  end

  if ui.status ~= "" then
    ImGui.PushStyleColor(ctx, ImGui.Col_Text, ui.warn and WARN or DIM)
    ImGui.Text(ctx, ui.status)
    ImGui.PopStyleColor(ctx, 1)
  end
end

------------------------------------------------------------------------------
-- Running
------------------------------------------------------------------------------

local sectionID, cmdID

local function loop()
  ImGui.SetNextWindowSize(ctx, 760, 720, ImGui.Cond_FirstUseEver)
  ImGui.SetNextWindowBgAlpha(ctx, 1.0)
  pushTheme()
  local visible, open = ImGui.Begin(ctx, TITLE, true)
  if visible then
    frame()
    ImGui.End(ctx)
  end
  popTheme()   -- outside the visible test: a push always needs its pop
  if open and not ImGui.IsKeyPressed(ctx, ImGui.Key_Escape) then
    reaper.defer(loop)
  end
end

local function shutdown()
  Place.auditionStop()
  saveState()
  if sectionID then
    reaper.SetToggleCommandState(sectionID, cmdID, 0)
    reaper.RefreshToolbar2(sectionID, cmdID)
  end
end

local function main()
  loadState()
  newSeed()
  local _, _, sid, cid = reaper.get_action_context()
  sectionID, cmdID = sid, cid
  reaper.SetToggleCommandState(sectionID, cmdID, 1)
  reaper.RefreshToolbar2(sectionID, cmdID)
  reaper.atexit(shutdown)
  if reaper.set_action_options then reaper.set_action_options(1) end
  ctx = ImGui.CreateContext(TITLE)
  Place.sweep()   -- anything an audition left behind when REAPER or the script died
  load(true)
  reaper.defer(loop)
end

main()
