--[[
 * ReaScript Name: Midi Variator
 * Description:    Makes small variations of a MIDI item — a note bent, a
 *                 beat anticipated, a passing note, a chord revoiced, a
 *                 touch of feel — each one made from the original, so the
 *                 twentieth still sounds like the first.
 *
 * About:          Import a .mid file (or play something in), select the item,
 *                 and run this. Choose how much may change and what, preview
 *                 and audition the variations against the original, untick
 *                 any change you don't like, then make them after it on the
 *                 same track. Near 100% a stretch of the motif may be
 *                 developed — inverted, reversed, sequenced. A melody and its
 *                 chords on two tracks are varied together. Every variation
 *                 keeps the original inside it, so it can be varied again —
 *                 from the original — or put back.
 *
 *                 Needs ReaImGui, from the ReaTeam Extensions repository.
 * Author:         Kallum Shah
 * Links:          https://github.com/KallumS/Midi-Variator
 * Version:        1.5
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
            "Install it with ReaPack, from the ReaTeam Extensions repository, " ..
            "then run Midi Variator again.",
            "ReaImGui Needed", 0)
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
  -- ImGui writes a menu item's keys (Cmd+=) in this colour, so it is a word
  -- and 7:1 on the menu too (#8A919C was 4.2:1 there). A disabled item is
  -- drawn faded on top of this, which Apple exempts.
  { "Col_TextDisabled",      0xBFC5CEFF },
  { "Col_WindowBg",          0x23272EFF },
  -- Menus and tooltips sit in front of the window, so they are a step
  -- lighter than it, as Apple's dark surfaces are (#1B1F25 was darker), with
  -- an edge of their own.
  { "Col_PopupBg",           0x2A2F37FF },
  { "Col_Border",            0x3A404AFF },
  { "Col_MenuBarBg",         0x1B1F25FF },
  -- A menu item under the pointer, and pressed: lighter, then darker, as a
  -- button is. ImGui's own were blue.
  { "Col_Header",            0x3A404AFF },
  { "Col_HeaderHovered",     0x3A404AFF },
  { "Col_HeaderActive",      0x22262DFF },
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
  -- Things you can drag are 3:1 on what they sit on, like any control's
  -- edge (#585F6B was 2.6:1 on its track). The window's resize corner was
  -- ImGui's blue.
  { "Col_ScrollbarGrab",     0x6D7581FF },
  { "Col_ScrollbarGrabHovered", 0x8A919CFF },
  { "Col_ScrollbarGrabActive",  0xA9AFBAFF },
  { "Col_ResizeGrip",        0x6D7581FF },
  { "Col_ResizeGripHovered", 0x8A919CFF },
  { "Col_ResizeGripActive",  0xA9AFBAFF },
  -- The keyboard's focus ring: near-white, because yellow means "on" and a
  -- focused control need not be.
  { "Col_NavHighlight",      0xF2F4F7FF },
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
-- Secondary text and warnings are 7:1 against the ground, Apple's target
-- for small text in a dark window (0015). The ramp's #8A919C was 4.7:1 and
-- the house red #D2483F 3.4:1, so neither is used for words any more.
local DIM       = 0xB0B6C0FF
local PLAYHEAD  = 0xDDE1E7FF   -- where the audition has got to, in the roll
local WARN      = 0xFF9E96FF
-- The edge of a box or a slider's track: 3:1 on the ground and on their own
-- dark fill, so they can be seen before they are touched (Apple asks the
-- same contrast of a control's edge as of an icon; the fill alone was 1.1:1).
local BOX_EDGE  = 0x8A919CFF

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
             develop = 1, form = 1, together = 1, textSize = 1 }
for _, k in ipairs(V.KINDS) do st[k.key] = 1 end
for _, f in ipairs(V.FEELS) do st[f.key] = 1 end

local LIMITS = { amount = { 0, 100 }, focus = { 1, #V.FOCUS }, keepEnds = { 0, 1 },
                 grow = { 0, 1 }, count = { 1, 16 }, own = { 0, 1 }, fit = { 0, 1 },
                 outside = { 0, 1 }, develop = { 0, 1 }, form = { 1, #V.FORMS },
                 together = { 0, 1 }, textSize = { 1, 4 } }
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
  -- The keyboard is on a control, or a menu is open, as of the last frame:
  -- then Escape lets go of that rather than closing the window.
  held = false,
}

local ctx

------------------------------------------------------------------------------
-- Apple's Human Interface Guidelines (0015, docs/apple-hig-review.md)
--
-- Text Size, in the View menu: Apple asks that text can be made at least
-- twice as big, and 13 points is the Mac's default text size. Every fixed
-- width in the window goes through px(), so it grows with the text.
------------------------------------------------------------------------------

local TEXT_SIZES = { 100, 125, 150, 200 }
local BASE_TEXT = 13
local fonts = {}           -- one per size, made and attached once in main()
local bold = {}            -- the same in bold, for the step headings
local S = 1                -- the chosen size as a scale: 1, 1.25, 1.5 or 2
local function px(n) return math.floor(n * S + 0.5) end

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
      say(why == Place.NO_ITEM and "Select a MIDI item first."
          or "That item has no notes. Select a MIDI item with notes in it.", true)
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
    say("The item is no longer in the project. Select it and click Use Selected Items.", true)
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
    say("REAPER couldn’t make the items. Try again.", true)
    return
  end
  say(("Made %s after “%s”. They’re selected — click Vary Selected in Place to vary them again."):format(
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
  if result ~= Place.OK then say("None of the selected items is a variation. Select a variation and try again.", true); return end
  if not sourcesAlive() then load(true) end
  say(("Put the original back in %s."):format(plural(count, "item")))
end

-- Unticked changes live only in the window: a new set, another source or
-- closing throws them away, and nothing brings them back. Apple asks for a
-- confirmation before anything that cannot be undone, so it asks, in
-- REAPER's own dialog (which VoiceOver can read), and only when a box is
-- unticked. (A setting changed makes a different batch, whose changes are
-- other changes; the slider would ask at every step, so it does not.)
local function unticked()
  for _, per in pairs(ui.skips) do
    for _, ids in pairs(per) do if next(ids) then return true end end
  end
  return false
end
local function letGo(doing)
  if not unticked() then return true end
  return reaper.ShowMessageBox(
    doing .. " throws away the changes you unticked.\n\n" ..
    "To keep them, click Cancel, then Make the variations.", "Throw Away the Unticked Changes?", 1) == 1
end

------------------------------------------------------------------------------
-- Widgets
------------------------------------------------------------------------------

local function pushTheme()
  for _, c in ipairs(THEME) do ImGui.PushStyleColor(ctx, ImGui[c[1]], c[2]) end
end
local function popTheme() ImGui.PopStyleColor(ctx, #THEME) end

-- The text size and Apple's Mac control: 28 points tall at 100% (a 13-point
-- line and 7.5 above and below), about 12 points between controls. Pushed
-- before Begin and popped after End, like the theme.
local SIZE_VARS = 3
local function pushSize()
  ImGui.PushFont(ctx, fonts[st.textSize])
  ImGui.PushStyleVar(ctx, ImGui.StyleVar_FramePadding, px(8), 7.5 * S)
  ImGui.PushStyleVar(ctx, ImGui.StyleVar_ItemSpacing, px(12), px(12))
  ImGui.PushStyleVar(ctx, ImGui.StyleVar_ItemInnerSpacing, px(8), px(6))
end
local function popSize()
  ImGui.PopStyleVar(ctx, SIZE_VARS)
  ImGui.PopFont(ctx)
end

local function setTextSize(i)
  st.textSize = math.max(1, math.min(#TEXT_SIZES, i))
  S = TEXT_SIZES[st.textSize] / 100
end

-- A button's width: the width asked for (0 is its label's), grown with the
-- text size, and never narrower than its label, so nothing is cut short.
local function fit(label, width)
  local text = label:gsub("##.*$", "")
  return math.max(px(width or 0), select(1, ImGui.CalcTextSize(ctx, text)) + px(16))
end

-- A button that is on takes the accent; every button, on or not, takes the
-- dark ink, because both fills are far lighter than the window's own text.
-- One that is on also carries a bar under its label, so being on is not
-- shown by colour alone.
local function pick(label, selected, width)
  local pushed = 1
  if selected then
    ImGui.PushStyleColor(ctx, ImGui.Col_Button, SELECTED)
    ImGui.PushStyleColor(ctx, ImGui.Col_ButtonHovered, shade(SELECTED, 0.18))
    ImGui.PushStyleColor(ctx, ImGui.Col_ButtonActive, shade(SELECTED, -0.18))
    pushed = 4
  end
  ImGui.PushStyleColor(ctx, ImGui.Col_Text, INK)
  local hit = ImGui.Button(ctx, label, fit(label, width), 0)
  ImGui.PopStyleColor(ctx, pushed)
  if selected then
    local x1 = ImGui.GetItemRectMin(ctx)
    local x2, y2 = ImGui.GetItemRectMax(ctx)
    ImGui.DrawList_AddRectFilled(ImGui.GetWindowDrawList(ctx),
                                 x1 + px(8), y2 - px(5), x2 - px(8), y2 - px(3), INK)
  end
  return hit
end

-- A row of buttons that wraps at the window's edge, each new line starting
-- under the first (after its row label, if it has one).
local flowX, flowAvail, flowIndent
local function flowStart(indent)
  flowX, flowIndent = nil, indent or 0
  flowAvail = select(1, ImGui.GetContentRegionAvail(ctx))
end
-- Places the next item, w wide, beside the last when it fits and on a new
-- line when not - so at 200% in a narrow window nothing runs off the
-- right-hand edge where it cannot be reached.
local function flowPlace(w, gap)
  gap = gap or px(12)
  if not flowX then flowX = w; return end
  if flowX + gap + w <= flowAvail then
    ImGui.SameLine(ctx, 0, gap)
    flowX = flowX + gap + w
  else
    ImGui.Dummy(ctx, 1, 1)
    ImGui.SameLine(ctx, flowIndent)
    flowX = w
  end
end
local function flowNext(label, width) flowPlace(fit(label, width)) end

-- The steps number themselves: drums have no Scale step, and the steps
-- after it close up rather than skip a number.
local stepNo = 0
-- A step's heading is bold, Apple's Headline style (13-point bold), so the
-- steps stand out from the text under them by weight as well as by the rule.
local function heading(text)
  stepNo = stepNo + 1
  ImGui.PushFont(ctx, bold[st.textSize])
  ImGui.PushStyleColor(ctx, ImGui.Col_Text, STEP)
  ImGui.Text(ctx, tostring(stepNo))
  ImGui.PopStyleColor(ctx, 1)
  ImGui.SameLine(ctx, 0, px(10))
  ImGui.SeparatorText(ctx, text)
  ImGui.PopFont(ctx)
end

local function stepGap() ImGui.Dummy(ctx, px(16), px(22)) end

local function tip(text)
  if text and ImGui.IsItemHovered(ctx) then ImGui.SetTooltip(ctx, text) end
end

-- Secondary text, wrapped at the window's edge rather than cut off by it.
local function dim(text, col)
  ImGui.PushStyleColor(ctx, ImGui.Col_Text, col or DIM)
  ImGui.TextWrapped(ctx, text)
  ImGui.PopStyleColor(ctx, 1)
end
local function textWidth(text) return (ImGui.CalcTextSize(ctx, text)) end
-- Words in a row: beside what came before if they fit, else on a line of
-- their own, wrapped.
local function flowWords(text, gap, col)
  flowPlace(math.min(textWidth(text), flowAvail), gap)
  dim(text, col)
end

-- A box, as wide as a button is tall, a gap, then its label.
local function boxWidth(label) return px(28) + px(8) + textWidth((label:gsub("##.*$", ""))) end
-- A box or a slider with an edge that can be seen before it is touched.
local function edged(draw)
  ImGui.PushStyleColor(ctx, ImGui.Col_Border, BOX_EDGE)
  ImGui.PushStyleVar(ctx, ImGui.StyleVar_FrameBorderSize, math.max(1, px(1)))
  local a, b = draw()
  ImGui.PopStyleVar(ctx, 1)
  ImGui.PopStyleColor(ctx, 1)
  return a, b
end
local function checkbox(label, v) return edged(function() return ImGui.Checkbox(ctx, label, v) end) end
local function slider(label, v, lo, hi, fmt)
  return edged(function() return ImGui.SliderInt(ctx, label, v, lo, hi, fmt) end)
end

local LABEL_W = 110
local function label(text)
  dim(text)
  ImGui.SameLine(ctx, px(LABEL_W))
  flowStart(px(LABEL_W))
end
-- Under a row's label, lined up with the row's buttons - unless it would
-- not fit there, when it starts at the left edge instead.
local function underLabel(w)
  if px(LABEL_W) + w <= select(1, ImGui.GetContentRegionAvail(ctx)) then
    ImGui.Dummy(ctx, 1, 1)
    ImGui.SameLine(ctx, px(LABEL_W))
  end
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

  -- Grid lines on the middle of a pixel, so a one-point line stays sharp.
  local b = 0
  while b <= beats + 1e-9 do
    local gx = math.floor(x + width * (b / beats)) + 0.5
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
  -- The playhead grows with the text, like everything else drawn.
  if playhead then
    local hx = x + width * playhead
    ImGui.DrawList_AddLine(dl, hx, y, hx, y + height, PLAYHEAD, px(2))
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
  flowStart()
  flowNext("Use Selected Items", 170)
  if pick("Use Selected Items", false, 170) and letGo("Reading another item") then load() end
  tip("Select one or more MIDI items in the arrange view — an imported .mid file\n" ..
      "is one — then click this. Each is varied on its own track.")
  if not ui.srcs then
    dim("Import a .mid file onto a track, select the item it makes, and click Use Selected Items.")
    return
  end
  -- Only when some of them sound at the same time.
  if canGroup() then
    flowNext("Vary Them Together", 170)
    switch("together", "Vary Them Together",
           "The items that sound at the same time — a melody on one track and its\n" ..
           "chords on another — are varied as one piece: a changed melody note\n" ..
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
    flowStart()
    flowWords(("“%s”   %s of %d/%d, %s, %s"):format(src.name, plural(math.max(bars, 1), "bar"),
              src.num, src.den, plural(#src.notes, "note"), what))
    if src.stored then flowWords("— a variation; new ones start from its original") end
  end
end

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

  flowStart()
  flowNext("Stay in the Original’s Notes", 0)
  switch("own", "Stay in the Original’s Notes",
         "Changed and added notes use only the notes the original already\n" ..
         "plays — nothing new at all. The scale below is set aside.", 0)
  if st.own == 1 then
    local names = {}
    for pc = 0, 11 do
      if an.played[pc] then names[#names + 1] = T.noteName(heard, pc) end
    end
    flowWords("Changes use only " .. table.concat(names, " ") .. ".", px(14))
    return
  end
  flowWords(("Heard as %s%s."):format(heard.label, #ui.srcs > 1 and (" in “" .. from.name .. "”") or ""), px(14))

  local cur = ui.pick or heardPick()
  label("Root")
  ImGui.PushID(ctx, "root")
  for i, r in ipairs(T.ROOTS) do
    flowNext(r.name, 34)
    ImGui.PushID(ctx, i)
    if pick(r.name, cur.root == i, 34) then pickScale(i, cur.scale) end
    ImGui.PopID(ctx)
  end
  ImGui.PopID(ctx)

  label("Scale")
  ImGui.PushID(ctx, "scale")
  for i, sc in ipairs(V.SCALES) do
    flowNext(sc.name, 150)
    ImGui.PushID(ctx, i)
    if pick(sc.name, cur.scale == i, 150) then pickScale(cur.root, i) end
    ImGui.PopID(ctx)
  end
  ImGui.PopID(ctx)

  if not ui.pick then
    dim("Choose another scale to take the variations there.")
    return
  end
  if pick("Back to What It Heard", false, 200) then ui.pick = nil; touched(); return end
  tip("Forgets the chosen scale and uses the one heard in the music.")

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
  local changed, v = checkbox("Bring the Original into This Scale", st.fit == 1)
  if changed then st.fit = v and 1 or 0; touched() end
  tip("On: the original’s notes outside the scale move to its nearest note\n" ..
      "first — C major into C minor makes every E an Eb — so the variations\n" ..
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

local AMOUNT_WORDS = { { 0, "none — exact copies" }, { 1, "a whisper" }, { 21, "subtle" },
                       { 46, "noticeable" }, { 71, "bold, still recognisable" } }

local function drawChanges()
  heading("What May Change")

  label("How much")
  flowPlace(px(240))
  ImGui.SetNextItemWidth(ctx, px(240))
  local changed, v = slider("##amount", st.amount, 0, 100, "%d%%")
  if changed then st.amount = math.max(0, math.min(100, v)); touched() end
  tip("How far each variation strays from the original. Even at 100% most of\n" ..
      "the original stays exactly as it was.")
  local words = AMOUNT_WORDS[1][2]
  for _, w in ipairs(AMOUNT_WORDS) do if st.amount >= w[1] then words = w[2] end end
  local want = V.budget(st.amount / 100, #ui.srcs[1].notes)
  if st.amount > 0 then
    local about = math.max(1, math.floor(want + 0.5))
    words = ("%s — about %s in %d notes"):format(words, plural(about, "change"), #ui.srcs[1].notes)
  end
  if canDevelop() and st.develop == 1 then words = words .. ", and now and then a stretch developed" end
  flowWords(words, px(14))

  local hints = {
    notes = "A note moved one step up or down the key (or, now and then, an octave).",
    rhythm = "A long note struck twice, two notes tied into one, or a beat\n" ..
             "anticipated (pushed early) or held back.",
    add = "A passing note, a grace note, a pickup into a note, a chord filled\n" ..
          "out, or — for drums — a ghost note.",
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
  for _, k in ipairs(V.KINDS) do
    -- Voicing needs chords struck together; quality takes arpeggios too.
    local shown = not ((k.key == "chords" and not hasChords())
                    or (k.key == "quality" and not hasChords() and not hasArpeggios())
                    or (k.key == "notes" and allDrums()))
    if shown then
      flowNext(k.name)
      switch(k.key, k.name, hints[k.key])
    end
  end

  -- Only while Chord quality is on and there are chords for it to change.
  if st.quality == 1 and (hasChords() or hasArpeggios()) then
    underLabel(boxWidth("Chord Changes May Leave the Scale"))
    local c, v = checkbox("Chord Changes May Leave the Scale", st.outside == 1)
    if c then st.outside = v and 1 or 0; touched() end
    tip("Off: a chord only changes into one whose notes are in the scale —\n" ..
        "in C major, G7 can become G9 or G13, C can become Cmaj7 or C6.\n" ..
        "On: it may borrow notes from outside — C can become Cmin or Caug,\n" ..
        "G7 can become G7b9, Amin can become Adim.")
  end

  -- Only near the top of the slider, where it can happen, and not for drums.
  if canDevelop() then
    underLabel(fit("Develop the Motif", 0))
    switch("develop", "Develop the Motif",
           "Near 100%, now and then a variation takes a stretch of the music — a\n" ..
           "bar or two, or at 100% most of it — and develops it the way a composer\n" ..
           "brings a motif back: turned upside down, played in reverse order, moved\n" ..
           "up or down the scale (a sequence), its intervals widened or narrowed, or\n" ..
           "its first half repeated a step lower. The rhythm stays, so it is still\n" ..
           "recognisable, and the first and last notes stay when kept.")
  end

  label("Feel")
  for _, f in ipairs(V.FEELS) do
    flowNext(f.name, 90)
    switch(f.key, f.name, hints[f.key], 90)
  end

  label("Where")
  for i, name in ipairs(V.FOCUS) do
    flowNext(name)
    ImGui.PushID(ctx, "focus" .. i)
    if pick(name, st.focus == i, 0) then st.focus = i; touched() end
    ImGui.PopID(ctx)
    tip(({ "Changes may land anywhere in the phrase.",
           "Changes gather towards the end — the phrase starts the same and\n" ..
           "answers differently, the classic way to vary a repeated motif.",
           "Changes gather towards the start." })[i])
  end

  local c1, keep = checkbox("Keep the First and Last Notes", st.keepEnds == 1)
  if c1 then st.keepEnds = keep and 1 or 0; touched() end
  tip("The notes that open and close the phrase stay exactly as they are,\n" ..
      "so every variation is recognisably the same motif.")
end

local function drawVariations()
  heading("Variations")

  label("How many")
  flowPlace(px(240))
  ImGui.SetNextItemWidth(ctx, px(240))
  local changed, v = slider("##count", st.count, 1, 16, "%d")
  if changed then st.count = math.max(1, math.min(16, v)); touched() end
  flowPlace(boxWidth("Grow Across the Series"), px(14))
  local c2, grow = checkbox("Grow Across the Series", st.grow == 1)
  if c2 then st.grow = grow and 1 or 0; touched() end
  tip("The first variations change less and the last the full amount, so a\n" ..
      "repeated motif builds. Each is still made from the original.")

  -- The form: what comes after the original, A. Only with something to
  -- arrange.
  if st.count > 1 then
    label("Form")
    for i, f in ipairs(V.FORMS) do
      flowNext(f.name)
      ImGui.PushID(ctx, "form" .. i)
      if pick(f.name, st.form == i, 0) then st.form = i; touched() end
      ImGui.PopID(ctx)
      tip(f.hint .. "\nAfter the original: " .. V.formLetters(i, st.count))
    end
    flowWords("A  " .. V.formLetters(st.form, st.count), px(14))
  end
  -- Anything changed above, this frame or in step 2, is previewed now.
  if ui.dirty then rebuild() end

  flowStart()
  -- The arrows are symbols, so each says its name when hovered or reached
  -- with the keyboard.
  if st.count > 1 then
    flowNext("<", 28)
    if pick("<", false, 28) then ui.show = (ui.show - 2) % st.count + 1 end
    tip("Previous Variation")
  end
  local where = ("Variation %d of %d"):format(ui.show, st.count)
  flowPlace(textWidth(where))
  ImGui.Text(ctx, where)
  if st.count > 1 then
    flowNext(">", 28)
    if pick(">", false, 28) then ui.show = ui.show % st.count + 1 end
    tip("Next Variation")
  end
  local runs = ui.runs
  local shown = {}
  local like, total = 0, 0
  for j, run in ipairs(runs) do
    shown[j] = run[ui.show]
    like = like + shown[j].like * #ui.srcs[j].notes
    total = total + #ui.srcs[j].notes
  end
  local now = shown[1]
  if now.home then
    flowWords("The original again, played afresh", px(16))
  elseif now.echo then
    flowWords(("An echo of variation %d — the same changes, played afresh"):format(now.echo), px(16))
  else
    flowWords(("Keeps %d%% of the original’s notes as they were"):format(
              math.floor(100 * like / math.max(total, 1) + 0.5)), px(16))
  end
  flowPlace(fit("New Set", 90), px(16))
  if pick("New Set", false, 90) and letGo("A new set") then newSeed(); touched() end
  tip("Another set of variations with the same settings.")
  local playing = Place.auditioning()
  flowNext(playing and "Stop" or "Audition", 90)
  if pick(playing and "Stop" or "Audition", playing, 90) then
    if playing then Place.auditionStop()
    else
      if ui.dirty then rebuild() end
      if Place.auditionStart(ui.srcs, shownLists()) ~= Place.OK then
        say("The item is no longer in the project. Select it and click Use Selected Items.", true)
      end
      ui.heard = { runs = ui.runs, show = ui.show }
    end
  end
  tip("Plays this variation in the original’s place, with the rest of the\n" ..
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
  pianoRoll({ { orig, SOURCE_NOTE }, { var, SELECTED } }, beats, ui.srcs[1].barBeats, math.max(px(160), w), px(110),
            ui.playhead)
  -- Which notes are which, in words as well as colour - and in lightness,
  -- which reads whatever colours a person sees.
  dim("In the roll, the darker notes are the original and the bright ones the variation.")

  -- The changes, each with a box: untick one to leave it out of this
  -- variation - the others stay exactly as they are.
  local lines = {}
  for _, grp in ipairs(ui.groups) do
    local j = grp[1]
    local names = {}
    for i, m in ipairs(grp) do names[i] = "“" .. ui.srcs[m].name .. "”" end
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
    local changed, on = checkbox(("%s##change%d.%d"):format(line.text, line.j, c.id), not c.skipped)
    if changed then
      ui.skips[line.j] = ui.skips[line.j] or {}
      local per = ui.skips[line.j]
      -- An echo's boxes are the ones of the variation it echoes.
      local at = shown[line.j].echo or ui.show
      per[at] = per[at] or {}
      per[at][c.id] = (not on) or nil
      ui.dirty = true    -- not touched(): that would forget the other boxes
    end
    -- The whole change, in case a narrow window cuts its line short.
    tip(line.text .. "\n\nUntick to leave this change out of this variation. Every\n" ..
        "other change, and the feel, stays exactly as it is.")
  end

  ImGui.Dummy(ctx, 0, px(4))
  flowStart()
  local make = ("Make %d %s"):format(st.count, st.count == 1 and "Variation" or "Variations")
  flowNext(make, 180)
  if pick(make, false, 180) then
    makeThem()
  end
  tip("Puts these variations after the original on its track, one after\n" ..
      "another, each starting on the same beat of its bar. Nothing already\n" ..
      "on the track is covered. It’s one undo step.")

  local selected = Place.selectedItems()
  if #selected > 0 then
    flowNext("Vary Selected in Place", 190)
    if pick("Vary Selected in Place", false, 190) then
      varySelected()
      -- Varying can replace items (pooled copies, .mid files, loops), and
      -- REAPER refuses a deleted one: read the selection again.
      selected = Place.selectedItems()
    end
    tip("Gives every selected MIDI item a new variation of its own original,\n" ..
        "where it is. Select a row of copies of a phrase and click this to\n" ..
        "vary them all. It’s one undo step.")
    local anyVariation = false
    for _, item in ipairs(selected) do
      local _, text = reaper.GetSetMediaItemInfo_String(item, Place.EXT, "", false)
      if text ~= "" then anyVariation = true; break end
    end
    if anyVariation then
      flowNext("Put Back the Original", 180)
      if pick("Put Back the Original", false, 180) then restoreSelected() end   -- the last use of `selected`
      tip("Every selected variation plays its original again. It stays a\n" ..
          "variation, so it can be varied again later.")
    end
  end
end

-- The View menu: Text Size, with the Mac's own zoom keys.
local SHORTCUT_KEY = (reaper.GetOS():find("OSX") or reaper.GetOS():find("mac")) and "Cmd" or "Ctrl"
local function menuBar()
  if not ImGui.BeginMenuBar(ctx) then return end
  if ImGui.BeginMenu(ctx, "View") then
    for i, size in ipairs(TEXT_SIZES) do
      local keys = (i == 1 and SHORTCUT_KEY .. "+0") or nil
      if ImGui.MenuItem(ctx, ("Text Size %d%%"):format(size), keys, st.textSize == i) then
        setTextSize(i)
      end
    end
    ImGui.Separator(ctx)
    if ImGui.MenuItem(ctx, "Bigger Text", SHORTCUT_KEY .. "+=", false, st.textSize < #TEXT_SIZES) then
      setTextSize(st.textSize + 1)
    end
    if ImGui.MenuItem(ctx, "Smaller Text", SHORTCUT_KEY .. "+-", false, st.textSize > 1) then
      setTextSize(st.textSize - 1)
    end
    ImGui.EndMenu(ctx)
  end
  ImGui.EndMenuBar(ctx)
end

-- Cmd (Ctrl on Windows) with =, - or 0, as in every Mac app that zooms.
local function zoomKeys()
  if ImGui.GetKeyMods(ctx) & ImGui.Mod_Shortcut == 0 then return end
  if ImGui.IsKeyPressed(ctx, ImGui.Key_Equal) or ImGui.IsKeyPressed(ctx, ImGui.Key_KeypadAdd) then
    setTextSize(st.textSize + 1)
  elseif ImGui.IsKeyPressed(ctx, ImGui.Key_Minus) or ImGui.IsKeyPressed(ctx, ImGui.Key_KeypadSubtract) then
    setTextSize(st.textSize - 1)
  elseif ImGui.IsKeyPressed(ctx, ImGui.Key_0) then
    setTextSize(1)
  end
end

-- What just happened, at the top of the window where it cannot fall off
-- the bottom of the screen, and there until it is dismissed or replaced:
-- Apple asks for nothing that goes away on a timer.
local function drawMessage()
  if ui.status == "" then return end
  flowStart()
  flowWords(ui.status, nil, ui.warn and WARN or DIM)
  flowPlace(fit("Dismiss", 0), px(16))
  if pick("Dismiss", false) then say("") end
end

local function frame()
  stepNo = 0
  ui.playhead = Place.auditionTick()   -- and stops it at the end
  if ui.dirty then rebuild() end

  menuBar()
  zoomKeys()
  drawMessage()
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
end

------------------------------------------------------------------------------
-- Running
------------------------------------------------------------------------------

local sectionID, cmdID

-- The window's title names what it is working on, which is also what a
-- screen reader can read of it. "###" keeps the window the same window
-- whatever the title says.
local function title()
  local name = ""
  if ui.srcs then
    name = " — " .. ui.srcs[1].name .. (#ui.srcs > 1 and (" and " .. plural(#ui.srcs - 1, "more")) or "")
  end
  return TITLE .. name .. "###" .. TITLE
end

local function loop()
  ImGui.SetNextWindowSize(ctx, 760, 720, ImGui.Cond_FirstUseEver)
  -- Never so small that a button is cut off: as wide as the widest row at
  -- this text size, and tall enough for the message and step 1.
  ImGui.SetNextWindowSizeConstraints(ctx, px(400), px(300), 100000, 100000)
  ImGui.SetNextWindowBgAlpha(ctx, 1.0)
  pushTheme()
  pushSize()
  local visible, open = ImGui.Begin(ctx, title(), true, ImGui.WindowFlags_MenuBar)
  if visible then
    frame()
    ImGui.End(ctx)
  end
  popSize()
  popTheme()   -- outside the visible test: a push always needs its pop

  -- Escape lets go of the keyboard's place, or a menu, first (ImGui does
  -- that itself); only with nothing held does it close the window.
  local escape = ImGui.IsKeyPressed(ctx, ImGui.Key_Escape) and not ui.held
  ui.held = ImGui.IsAnyItemFocused(ctx) or ImGui.IsPopupOpen(ctx, "", ImGui.PopupFlags_AnyPopup)
  if (not open or escape) and not letGo("Closing the window") then open, escape = true, false end
  if open and not escape then
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
  -- The keyboard alone: Tab and the arrow keys move between controls, Space
  -- or Return presses one, and a ring shows where you are.
  ctx = ImGui.CreateContext(TITLE, ImGui.ConfigFlags_NavEnableKeyboard)
  for i, size in ipairs(TEXT_SIZES) do
    local points = math.floor(BASE_TEXT * size / 100 + 0.5)
    fonts[i] = ImGui.CreateFont("sans-serif", points)
    bold[i] = ImGui.CreateFont("sans-serif", points, ImGui.FontFlags_Bold)
    ImGui.Attach(ctx, fonts[i])
    ImGui.Attach(ctx, bold[i])
  end
  setTextSize(st.textSize)
  Place.sweep()   -- anything an audition left behind when REAPER or the script died
  load(true)
  reaper.defer(loop)
end

main()
