--[[ The whole script, headless.

     ReaImGui only exists inside REAPER, so a mock stands in its place and
     the real "Midi Variator.lua" is run against it and the mocked REAPER.
     It cannot say the window looks right. It can say that nothing raises,
     that no call reaches a ReaImGui function that does not exist, that every
     push is popped, that every button wears the dark ink, that what the
     preview shows is what gets made, and that clicking every button in every
     state leaves the script working.

       lua5.4 tests/test_ui.lua
]]

local HERE = (arg and arg[0] or ""):match("^(.*)[/\\]") or "."
local C = dofile(HERE .. "/check.lua")
local ok, eq = C.ok, C.eq
local P = dofile(HERE .. "/reaper_mock.lua")
local F = dofile(HERE .. "/fixtures.lua")
local T = dofile(C.SCRIPTS .. "mv_theory.lua")
local V = dofile(C.SCRIPTS .. "mv_vary.lua")
local SCRIPT = C.SCRIPTS .. "Midi Variator.lua"

------------------------------------------------------------------------------
-- A ReaImGui that records
------------------------------------------------------------------------------

local g = {}
local function resetFrame()
  g.idDepth, g.colDepth, g.colStack = 0, 0, {}
  g.buttons, g.ink, g.texts, g.checkboxes, g.headings, g.sliders = {}, {}, {}, {}, {}, {}
  g.ticked = {}
  g.rects = {}
end
resetFrame()

local ImGui = {}
local consts = { "Col_Text", "Col_TextDisabled", "Col_WindowBg", "Col_PopupBg", "Col_Border",
  "Col_FrameBg", "Col_FrameBgHovered", "Col_FrameBgActive", "Col_TitleBg", "Col_TitleBgActive",
  "Col_TitleBgCollapsed", "Col_Button", "Col_ButtonHovered", "Col_ButtonActive", "Col_CheckMark",
  "Col_SliderGrab", "Col_SliderGrabActive", "Col_Separator", "Col_ScrollbarBg", "Col_ScrollbarGrab",
  "Col_ScrollbarGrabHovered", "Col_ScrollbarGrabActive", "Cond_FirstUseEver", "Key_Escape" }
for i, k in ipairs(consts) do ImGui[k] = i end

local function effective(idx)
  for i = #g.colStack, 1, -1 do if g.colStack[i].idx == idx then return g.colStack[i].col end end
end

function ImGui.CreateContext(name) return { name = name } end
function ImGui.SetNextWindowSize() end
function ImGui.SetNextWindowBgAlpha(_, a) assert(a >= 0 and a <= 1) end
function ImGui.Begin() return not g.collapsed, true end
function ImGui.End() end
function ImGui.IsKeyPressed() return false end
function ImGui.SeparatorText(_, s) g.headings[#g.headings + 1] = s end
function ImGui.Text(_, s)
  if type(s) ~= "string" then error("Text got a " .. type(s)) end
  g.texts[#g.texts + 1] = s
end
function ImGui.SameLine() end
function ImGui.Dummy() end
function ImGui.SetNextItemWidth(_, w) if type(w) ~= "number" then error("width is a " .. type(w)) end end
function ImGui.PushID(_, v)
  if v == nil then error("PushID with nil") end
  g.idDepth = g.idDepth + 1
end
function ImGui.PopID()
  g.idDepth = g.idDepth - 1
  if g.idDepth < 0 then error("PopID without a push") end
end
function ImGui.PushStyleColor(_, idx, col)
  if type(idx) ~= "number" then error("PushStyleColor with a " .. type(idx) .. " index") end
  if type(col) ~= "number" or col % 256 == 0 then error("style colour must be an opaque 0xRRGGBBAA") end
  g.colStack[#g.colStack + 1] = { idx = idx, col = col }
  g.colDepth = g.colDepth + 1
end
function ImGui.PopStyleColor(_, n)
  for _ = 1, (n or 1) do g.colStack[#g.colStack] = nil end
  g.colDepth = g.colDepth - (n or 1)
  if g.colDepth < 0 then error("PopStyleColor without a push") end
end
function ImGui.Button(_, label)
  if type(label) ~= "string" then error("Button label is a " .. type(label)) end
  g.buttons[#g.buttons + 1] = label
  g.ink[#g.buttons] = { bg = effective(ImGui.Col_Button), text = effective(ImGui.Col_Text) }
  if g.clickTarget == #g.buttons then g.clicked = label; return true end
  return false
end
function ImGui.Checkbox(_, label, v)
  if type(v) ~= "boolean" then error("Checkbox value is a " .. type(v)) end
  g.checkboxes[#g.checkboxes + 1] = label
  g.ticked[label] = v
  if g.toggle == label then return true, not v end
  return false, v
end
-- boolean retval, integer v = SliderInt(ctx, label, v, v_min, v_max, format)
function ImGui.SliderInt(_, label, v, lo, hi, fmt)
  for _, x in ipairs({ v, lo, hi }) do
    if math.type(x) ~= "integer" then error("SliderInt needs integers, got " .. tostring(x)) end
  end
  if v < lo or v > hi then error("slider value outside its range") end
  g.sliders[#g.sliders + 1] = label
  if g.slide and g.slide[label] then return true, g.slide[label] end
  return false, v
end
function ImGui.IsItemHovered() return true end
function ImGui.SetTooltip(_, s) if type(s) ~= "string" then error("tooltip is a " .. type(s)) end end
function ImGui.GetContentRegionAvail() return 720, 400 end
function ImGui.GetWindowDrawList() return {} end
function ImGui.GetCursorScreenPos() return 0, 0 end
function ImGui.InvisibleButton() return false end
function ImGui.DrawList_AddRectFilled(_, x1, y1, x2, y2, col)
  if x2 < x1 or y2 < y1 then error("rect is inside out") end
  g.rects[#g.rects + 1] = col
end
function ImGui.DrawList_AddLine(_, x1, y1, x2, y2, col)
  for _, v in ipairs({ x1, y1, x2, y2, col }) do
    if type(v) ~= "number" then error("line argument is a " .. type(v)) end
  end
end
setmetatable(ImGui, { __index = function(_, k)
  error("the script called ImGui." .. tostring(k) .. ", which the mock does not have")
end })

------------------------------------------------------------------------------
-- REAPER, and running the script
------------------------------------------------------------------------------

local tmp = os.tmpname()
os.remove(tmp)
os.execute('mkdir -p "' .. tmp .. '"')
local shim = assert(io.open(tmp .. "/imgui.lua", "w"))
shim:write("return function(version) return _G.__MOCK_IMGUI end\n")
shim:close()
_G.__MOCK_IMGUI = ImGui

-- The script seeds itself from the clock; a fixed clock makes its seed
-- known, so the test can make the same variations and compare.
os.time = function() return 1000 end
os.clock = function() return 0 end

P.install()
local deferred, atexitFn, gaveUp
local function absolute(path)
  if path:match("^/") then return path end
  return (os.getenv("PWD") or ".") .. "/" .. path
end
reaper.ImGui_GetBuiltinPath = function() return tmp end
reaper.MB = function(msg) gaveUp = msg end
reaper.get_action_context = function() return true, absolute(SCRIPT), 0, 1, 0, 0, 0 end
reaper.defer = function(f) deferred = f end
reaper.atexit = function(f) atexitFn = f end
reaper.set_action_options = function() end
reaper.SetToggleCommandState = function() end
reaper.RefreshToolbar2 = function() end

local function start()
  deferred, atexitFn = nil, nil
  dofile(SCRIPT)
end

-- One frame, optionally clicking the n-th button drawn in it.
local function frame(click, opts)
  resetFrame()
  opts = opts or {}
  g.clickTarget, g.clicked, g.toggle, g.slide = click, nil, opts.toggle, opts.slide
  local f = deferred
  deferred = nil
  if not f then error("the script stopped deferring") end
  f()
  if g.idDepth ~= 0 then error("PushID left unbalanced: " .. g.idDepth) end
  if g.colDepth ~= 0 then error("PushStyleColor left unbalanced: " .. g.colDepth) end
  if P.undoDepth ~= 0 then error("an undo block left open") end
  if P.refreshDepth ~= 0 then error("screen refresh left off") end
  return g.clicked
end

local function has(list, text)
  for _, t in ipairs(list) do if t:find(text, 1, true) then return true end end
  return false
end

local function buttonIndex(label)
  for i, b in ipairs(g.buttons) do if b == label then return i end end
end
local function click(label)
  frame()
  local i = buttonIndex(label)
  if not i then error("no button called " .. label) end
  frame(i)
  frame()
end
local function toggle(label) frame(); frame(nil, { toggle = label }); frame() end
local function slide(label, v) frame(); frame(nil, { slide = { [label] = v } }); frame() end

local function checkInk(tag)
  for i, b in ipairs(g.buttons) do
    eq(g.ink[i].text, 0x14171CFF, tag .. ": button '" .. b .. "' wears the dark ink")
  end
end

-- An item holding a fixture, as long as its music in whole bars.
local function barsOf(notes)
  local finish = 0
  for _, n in ipairs(notes) do finish = math.max(finish, n.start + n.len) end
  return math.ceil(finish / 4 - 1e-9) * 4
end
local function project(fixture, name, lenQN)
  P.reset()
  local tr = P.track("Piano")
  local item = P.item(tr, 0, lenQN or barsOf(F[fixture]), F[fixture], name or fixture)
  P.selected = { item }
  return tr, item
end

local function notesOfItem(item)
  local out = {}
  for _, n in ipairs(P.notesOf(item)) do
    out[#out + 1] = ("%d@%.4f+%.4f v%d"):format(n.pitch, n.start, n.len, n.vel)
  end
  return table.concat(out, " ")
end
local function notesOfList(list)
  local out = {}
  for _, n in ipairs(list) do out[#out + 1] = ("%d@%.4f+%.4f v%d"):format(n.pitch, n.start, n.len, n.vel) end
  return table.concat(out, " ")
end

------------------------------------------------------------------------------
-- No ReaImGui: it says so and stops
------------------------------------------------------------------------------

do
  local keep = reaper.ImGui_GetBuiltinPath
  reaper.ImGui_GetBuiltinPath = false   -- absent (nil would make the mock raise)
  gaveUp = nil
  start()
  ok(gaveUp and gaveUp:find("ReaImGui"), "without ReaImGui it says what is missing")
  eq(deferred, nil, "and does not start")
  reaper.ImGui_GetBuiltinPath = keep
end

------------------------------------------------------------------------------
-- Starting with nothing selected
------------------------------------------------------------------------------

P.reset()
start()
ok(deferred ~= nil, "the script defers a frame")
frame()
eq(#g.buttons, 1, "with nothing read there is one button")
ok(has(g.texts, "Import a .mid file"), "and it says what to do")
eq(#g.headings, 1, "only the first step is shown: no dead controls")
click("Use selected items")
ok(has(g.texts, "Select a MIDI item first."), "pressing it with nothing selected says so")

------------------------------------------------------------------------------
-- A melody: preview, make, vary in place, put back
------------------------------------------------------------------------------

local tr, item = project("noir", "Noir")
P.ext = {}
start()                       -- reads the selection it starts with
frame()
eq(#g.headings, 4, "a selected item on start: all four steps")
eq(g.headings[2], "Scale", "the second is the scale")
ok(has(g.texts, "\"Noir\"   8 bars of 4/4, 28 notes, D Minor (Natural)"), "the source described")
ok(has(g.texts, "Variation 1 of 4"), "four variations previewed")
ok(has(g.texts, "subtle - about 2 changes in 28 notes"), "the amount said in words and changes")
ok(not has(g.buttons, "Chord voicing") and not has(g.buttons, "Chord quality"),
   "no chord switches for a melody: no dead controls")
ok(not has(g.checkboxes, "Chord changes may leave the scale"), "nor the box to leave the scale")
ok(has(g.buttons, "Notes") and has(g.buttons, "Rhythm"), "the other switches are there")
ok(not has(g.buttons, "Put back the original"), "nothing to put back in an original")
checkInk("melody")
do
  local grey, yellow = false, false
  for _, c in ipairs(g.rects) do
    if c == 0x6D7581FF then grey = true end
    if c == 0xFFF200FF then yellow = true end
  end
  ok(grey and yellow, "the roll draws the original grey and the variation yellow")
end

-- Stepping through the batch.
click(">")
ok(has(g.texts, "Variation 2 of 4"), "> shows the next variation")
click("<")
click("<")
ok(has(g.texts, "Variation 4 of 4"), "< wraps round to the last")

-- What is made is what was previewed. The seed is known from the fixed
-- clock: the script's first seed.
do
  local seed = (1000 * 7 + 0 + 1 * 31) % 2147483000 + 1
  local src = { notes = F.noir, lead = 0, beats = 32, barBeats = 4, pulse = 1 }
  local expected = V.series(src, V.analyse(src, T), (function()
    local o = V.defaults(); o.amount = 0.35; return o end)(), seed, 4, T, 1, {})
  click("Make 4 variations")
  eq(#tr.items, 5, "four new items")
  ok(has(g.texts, "Made 4 variations after \"Noir\""), "and it says so")
  for i = 1, 4 do
    eq(notesOfItem(tr.items[i + 1]), notesOfList(expected[i].notes),
       ("variation %d is exactly the one previewed"):format(i))
    eq(tr.items[i + 1].take.name, "Noir - variation " .. i, "numbered")
  end
  eq(#P.selected, 4, "the new ones are selected")
  ok(has(g.buttons, "Put back the original"), "and can be put back")
  eq(P.undoNames[#P.undoNames], "Midi Variator: make variations", "one undo step")
end

-- Making more numbers on from the last.
click("Make 4 variations")
eq(#tr.items, 9, "four more")
eq(tr.items[9].take.name, "Noir - variation 8", "numbered on from the ones before")

-- Vary the selected ones in place, then put their original back.
do
  local before = notesOfItem(tr.items[6])
  click("Vary selected in place")
  ok(has(g.texts, "Varied 4 items in place"), "varied in place")
  eq(#tr.items, 9, "no new items")
  ok(notesOfItem(tr.items[6]) ~= before, "the notes changed")
  click("Put back the original")
  ok(has(g.texts, "Put the original back in 4 items."), "put back")
  eq(notesOfItem(tr.items[6]), notesOfItem(tr.items[1]), "each plays the original again")
end

-- Amount 0: exact copies but for the feel; no changes listed.
slide("##amount", 0)
ok(has(g.texts, "none - exact copies"), "amount 0 says so")
ok(has(g.texts, "No changes to the notes."), "and lists nothing")
slide("##amount", 100)
ok(has(g.texts, "bold, still recognisable"), "amount 100 is bold")

-- One variation: no arrows to step through.
slide("##count", 1)
ok(has(g.texts, "Variation 1 of 1"), "one variation")
ok(not has(g.buttons, ">") and not has(g.buttons, "<"), "no arrows for one: no dead controls")
ok(has(g.buttons, "Make 1 variation"), "and the button says one")

-- Switches: off is grey, on is yellow.
do
  frame()
  local i = buttonIndex("Rhythm")
  eq(g.ink[i].bg, 0xFFF200FF, "a switch that is on is yellow")
  click("Rhythm")
  i = buttonIndex("Rhythm")
  eq(g.ink[i].bg, 0xA9AFBAFF, "clicked, it is off and grey")
  click("Towards the end")
  i = buttonIndex("Towards the end")
  eq(g.ink[i].bg, 0xFFF200FF, "Where: the chosen one is yellow")
  toggle("Keep the first and last notes")
  toggle("Grow across the series")
end

-- Settings are saved on the way out and come back.
atexitFn()
do
  local blob = P.ext["MidiVariator:state"]
  ok(blob and blob:find("amount=100") and blob:find("rhythm=0") and blob:find("focus=2")
     and blob:find("keepEnds=0") and blob:find("grow=1") and blob:find("count=1"),
     "settings are saved: " .. tostring(blob))
  P.ext["MidiVariator:state"] = "amount=500;count=-3;focus=9;rhythm=7;nonsense=1;grow"
  project("twinkle", "Twinkle")
  start()
  frame()
  ok(has(g.texts, "bold, still recognisable"), "an amount out of range is clamped to 100")
  ok(has(g.texts, "Variation 1 of 1"), "a count below one is clamped to one")
  eq(g.ink[buttonIndex("Towards the start")].bg, 0xFFF200FF, "a focus past the end is clamped to the last")
  eq(g.ink[buttonIndex("Rhythm")].bg, 0xFFF200FF, "a switch saved as 7 is simply on")
end

------------------------------------------------------------------------------
-- Other material
------------------------------------------------------------------------------

P.ext = {}
project("piano", "Piano")
start()
frame()
ok(has(g.buttons, "Chord voicing") and has(g.buttons, "Chord quality"), "a piano part gets the chord switches")
ok(has(g.checkboxes, "Chord changes may leave the scale"), "and, with Chord quality on, the box to leave the scale")
click("Chord quality")
ok(not has(g.checkboxes, "Chord changes may leave the scale"), "Chord quality off: the box goes, no dead controls")
click("Chord quality")
toggle("Chord changes may leave the scale")
atexitFn()
ok(P.ext["MidiVariator:state"]:find("outside=1"), "leaving the scale is remembered")
P.ext = {}
start()
frame()
checkInk("piano")

-- Arpeggios: Chord quality changes them, Chord voicing has nothing to do.
P.ext = {}
project("arpeggios", "Arps")
start()
frame()
ok(has(g.buttons, "Chord quality"), "arpeggiated chords get the Chord quality switch")
ok(not has(g.buttons, "Chord voicing"), "but not Chord voicing: no chords struck together")
ok(has(g.checkboxes, "Chord changes may leave the scale"), "and the box to leave the scale")
checkInk("arpeggios")

project("drums", "Beat", 8)
start()
frame()
ok(has(g.texts, "drums"), "drums are recognised")
ok(not has(g.buttons, "Notes"), "and get no Notes switch: a drum has no pitch to bend")
checkInk("drums")

-- Unticking a change: a box for each, the preview and what is made both
-- leave it out, and a new batch starts with every box ticked.
do
  P.ext = {}
  local tr = project("noir", "Noir")
  start()
  frame()
  local boxes = {}
  for _, l in ipairs(g.checkboxes) do if l:find("##change", 1, true) then boxes[#boxes + 1] = l end end
  ok(#boxes >= 2, "every change has a box (" .. #boxes .. ")")
  for _, l in ipairs(boxes) do ok(g.ticked[l], "ticked to begin with") end
  local label = boxes[1]
  local id = tonumber(label:match("##change1%.(%d+)$"))
  ok(id, "the box knows its change")
  toggle(label)
  ok(g.ticked[label] == false, "unticked, the box stays, unticked")
  local seed = (1000 * 7 + 0 + 1 * 31) % 2147483000 + 1
  local src = { notes = F.noir, lead = 0, beats = 32, barBeats = 4, pulse = 1 }
  local o = V.defaults(); o.amount = 0.35
  local an = V.analyse(src, T)
  local with = V.series(src, an, o, seed, 4, T, 1, {})
  local without = V.series(src, an, o, seed, 4, T, 1, {}, { [1] = { [id] = true } })
  ok(notesOfList(with[1].notes) ~= notesOfList(without[1].notes), "set up: unticking changes the notes")
  click("Make 4 variations")
  eq(notesOfItem(tr.items[2]), notesOfList(without[1].notes), "what is made leaves the unticked change out")
  eq(notesOfItem(tr.items[3]), notesOfList(with[2].notes), "and the other variations are as they were")
  -- A setting changed: a new batch, every box ticked.
  P.selected = { tr.items[1] }
  click("Use selected items")
  local first
  for _, l in ipairs(g.checkboxes) do if l:find("##change", 1, true) then first = first or l end end
  toggle(first)
  slide("##amount", 50)
  slide("##amount", 35)
  local all = true
  for _, l in ipairs(g.checkboxes) do if l:find("##change", 1, true) and not g.ticked[l] then all = false end end
  ok(all, "after a setting changes, every box is ticked again")
  -- Unticked in one variation, not in the next.
  frame()
  for _, l in ipairs(g.checkboxes) do if l:find("##change", 1, true) then first = l; break end end
  toggle(first)
  click(">")
  local nextAll = true
  for _, l in ipairs(g.checkboxes) do if l:find("##change", 1, true) and not g.ticked[l] then nextAll = false end end
  ok(nextAll, "an unticked box belongs to its own variation")
  click("<")
  ok(g.ticked[first] == false, "and is still unticked coming back")
end

-- Develop: only near the top of the slider, never for drums, and what it
-- previews at 100% is what it makes.
do
  P.ext = {}
  local tr = project("noir", "Noir")
  start()
  frame()
  ok(not has(g.buttons, "Develop the motif"), "at 35% there is no Develop switch: no dead controls")
  slide("##amount", 70)
  ok(not has(g.buttons, "Develop the motif"), "nor at 70%, where it cannot happen")
  slide("##amount", 100)
  ok(has(g.buttons, "Develop the motif"), "at 100% there is")
  eq(g.ink[buttonIndex("Develop the motif")].bg, 0xFFF200FF, "on by default")
  ok(has(g.texts, "and now and then a stretch developed"), "and the amount says so")
  local seed = (1000 * 7 + 0 + 1 * 31) % 2147483000 + 1
  local src = { notes = F.noir, lead = 0, beats = 32, barBeats = 4, pulse = 1 }
  local o = V.defaults(); o.amount = 1
  local expected = V.series(src, V.analyse(src, T), o, seed, 4, T, 1, {})
  local developed = 0
  for _, var in ipairs(expected) do
    for _, c in ipairs(var.moves) do if c.kind == "develop" then developed = developed + 1 end end
  end
  ok(developed > 0, "set up: this batch has something developed")
  click("Make 4 variations")
  for i = 1, 4 do
    eq(notesOfItem(tr.items[i + 1]), notesOfList(expected[i].notes),
       ("at 100%%, variation %d is exactly the one previewed"):format(i))
  end
  -- What the list of changes shows across a few sets: developed or not.
  local DEVELOPED = { "a sequence", "upside down", "reverse order", "intervals widened",
                      "intervals narrowed", "first half again" }
  local function anyDeveloped()
    local found = false
    for _ = 1, 3 do
      for _ = 1, 4 do
        frame()
        for _, t in ipairs(g.checkboxes) do
          for _, w in ipairs(DEVELOPED) do if t:find(w, 1, true) then found = true end end
        end
        click(">")
      end
      click("New set")
    end
    return found
  end
  ok(anyDeveloped(), "on: the list shows stretches developed")
  click("Develop the motif")
  eq(g.ink[buttonIndex("Develop the motif")].bg, 0xA9AFBAFF, "switched off, it is grey")
  ok(not anyDeveloped(), "off: none")
  ok(not has(g.texts, "and now and then a stretch developed"), "and the amount no longer says so")
  atexitFn()
  ok(P.ext["MidiVariator:state"]:find("develop=0"), "and that is remembered")
  P.ext = {}
  project("drums", "Beat", 8)
  start()
  slide("##amount", 100)
  ok(not has(g.buttons, "Develop the motif"), "drums are never developed: no switch")
end

-- Two items at once, on two tracks: each varied on its own.
do
  P.reset()
  local a = P.track("Melody")
  local b = P.track("Chords")
  P.selected = { P.item(a, 0, 16, F.twinkle, "Tune"), P.item(b, 0, 16, F.popChords, "Harmony") }
  start()
  frame()
  ok(has(g.texts, "\"Tune\"") and has(g.texts, "\"Harmony\""), "both sources listed")
  click("Make 4 variations")
  eq(#a.items, 5, "the melody's variations on the melody's track")
  eq(#b.items, 5, "the chords' on the chords' track")
  eq(P.posQN(a.items[2]), P.posQN(b.items[2]), "lined up with each other")
end

-- A collapsed window still pops its theme.
do
  project("noir", "Noir")
  start()
  g.collapsed = true
  frame()
  g.collapsed = false
  frame()
end

-- The source item deleted behind the script's back.
do
  local tr2, it = project("noir", "Noir")
  start()
  frame()
  reaper.DeleteTrackMediaItem(tr2, it)
  click("Make 4 variations")
  ok(has(g.texts, "The item has gone"), "a deleted source is noticed, not written from")
  eq(#tr2.items, 0, "and nothing is made")
end

------------------------------------------------------------------------------
-- Varying in place items that have to be replaced
--
-- Pasted copies are often pooled, and an imported .mid can be played from
-- disk: those are replaced by new items, not rewritten (decision 0005).
-- The window once kept its list of selected items from before the click
-- and asked REAPER about the deleted ones - "bad argument #1 to
-- 'GetSetMediaItemInfo_String' (MediaItem expected)" in REAPER itself.
------------------------------------------------------------------------------

do
  P.reset()
  P.ext = {}
  local tr = P.track("Piano")
  local copies = {
    P.item(tr, 0, 16, F.twinkle, "Twinkle", { pooled = true }),
    P.item(tr, 16, 16, F.twinkle, "Twinkle", { pooled = true }),
    P.item(tr, 32, 16, F.twinkle, "Twinkle", { file = "/music/twinkle.mid" }),
  }
  P.selected = { copies[1], copies[2], copies[3] }
  start()
  frame()
  click("Vary selected in place")
  ok(has(g.texts, "Varied 3 items in place"), "pooled and file items are varied in place")
  for i, it in ipairs(copies) do ok(not it.alive, ("copy %d was replaced"):format(i)) end
  eq(#P.selected, 3, "by three new items, selected")
  ok(has(g.buttons, "Put back the original"), "which can be put back")
  click("Vary selected in place")
  ok(has(g.texts, "Varied 3 items in place"), "and varied again")
  click("Put back the original")
  ok(has(g.texts, "Put the original back in 3 items."), "and put back")
end

------------------------------------------------------------------------------
-- The scale: picking one, pivoting, and staying in the original's notes
------------------------------------------------------------------------------

local function pcsOfItems(items)
  local pcs = {}
  for _, it in ipairs(items) do
    for _, n in ipairs(P.notesOf(it)) do pcs[n.pitch % 12] = true end
  end
  return pcs
end

do
  P.ext = {}
  local tr = project("twinkle", "Twinkle")
  start()
  frame()
  ok(has(g.texts, "Heard as C Major."), "it says what it heard")
  eq(g.ink[buttonIndex("C")].bg, 0xFFF200FF, "the heard root is lit")
  eq(g.ink[buttonIndex("Major")].bg, 0xFFF200FF, "and the heard scale")
  ok(not has(g.buttons, "Back to what it heard"), "nothing to go back to yet: no dead controls")
  ok(not has(g.checkboxes, "Bring the original into this scale"), "nor anything to bring into a scale")
  ok(has(g.texts, "Pick another scale to take the variations there."), "and it says what picking does")

  -- Pivot to C minor.
  click("Minor (Natural)")
  eq(g.ink[buttonIndex("Minor (Natural)")].bg, 0xFFF200FF, "the picked scale is lit")
  ok(has(g.buttons, "Back to what it heard"), "now there is a way back")
  ok(has(g.checkboxes, "Bring the original into this scale"), "and the pivot is offered")
  ok(has(g.texts, "Moved into C Minor (Natural): E -> Eb, A -> Ab."), "and says what the pivot moves")
  click("Make 4 variations")
  local made = {}
  for i = 2, 5 do made[#made + 1] = tr.items[i] end
  local pcs = pcsOfItems(made)
  local cminor = { [0] = true, [2] = true, [3] = true, [5] = true, [7] = true, [8] = true, [10] = true }
  local outside = {}
  for pc in pairs(pcs) do if not cminor[pc] then outside[#outside + 1] = pc end end
  eq(#outside, 0, "every note made is in C minor")
  local kept = V.decode(tr.items[2].ext.MidiVariator)
  local hasE = false
  for _, n in ipairs(kept) do if n.pitch == 64 then hasE = true end end
  ok(hasE, "but the original kept inside is the real one, in C major")
  click("Put back the original")
  ok(pcsOfItems({ tr.items[2] })[4], "so putting it back brings the E back")

  -- Vary in place follows the picked scale too.
  click("Vary selected in place")
  pcs = pcsOfItems(made)
  outside = {}
  for pc in pairs(pcs) do if not cminor[pc] then outside[#outside + 1] = pc end end
  eq(#outside, 0, "varied in place: still all in C minor")

  -- Not pivoting: the original's notes stay, the changes use the scale.
  P.selected = { tr.items[1] }
  toggle("Bring the original into this scale")
  ok(has(g.texts, "notes of the original outside C Minor (Natural) stay as they are"),
     "unticked, it says the original stays as it is")

  -- Picking the heard key again is going back.
  click("Major")
  ok(not has(g.buttons, "Back to what it heard"), "picking what it heard goes back to it")
  click("D")
  ok(has(g.buttons, "Back to what it heard"), "a new root is a pick")
  click("Back to what it heard")
  eq(g.ink[buttonIndex("C")].bg, 0xFFF200FF, "back: C lit again")
  ok(not has(g.buttons, "Back to what it heard"), "and the way back hides itself")

  -- A scale every note is already in: nothing to bring in.
  click("F")
  ok(has(g.texts, "Every note of the original is in F Major already"), "Twinkle has no B: F major holds it all")
  ok(not has(g.checkboxes, "Bring the original into this scale"), "and no box that would do nothing")

  -- Reading another item forgets the pick: it belonged to that music.
  click("Use selected items")
  ok(not has(g.buttons, "Back to what it heard"), "a new source starts from what is heard")

  -- Stay in the original's notes: the picker goes away.
  click("Stay in the original's notes")
  ok(has(g.texts, "Changes use only C D E F G A."), "it lists the notes it will use")
  ok(not has(g.buttons, "Minor (Natural)") and not has(g.buttons, "Db"), "no picker while it is on")
  eq(g.ink[buttonIndex("Stay in the original's notes")].bg, 0xFFF200FF, "the switch is lit")
  local before = #tr.items
  slide("##amount", 100)
  click("Make 4 variations")
  made = {}
  for i = before + 1, #tr.items do made[#made + 1] = tr.items[i] end
  eq(#made, 4, "made")
  pcs = pcsOfItems(made)
  ok(not pcs[11] and not pcs[10], "no B or Bb: only the notes Twinkle plays")

  atexitFn()
  local blob = P.ext["MidiVariator:state"]
  ok(blob:find("own=1") and blob:find("fit=0"), "both switches are remembered: " .. blob)
  P.ext["MidiVariator:state"] = "own=5;fit=-2"
  start()
  frame()
  eq(g.ink[buttonIndex("Stay in the original's notes")].bg, 0xFFF200FF, "own clamped to on")
end

-- Drums have no scale step, and the steps close up.
do
  project("drums", "Beat", 8)
  start()
  frame()
  eq(#g.headings, 3, "drums: three steps")
  eq(g.headings[2], "What may change", "the scale step is left out")
  ok(has(g.texts, "2"), "and numbered on without a gap")
end

-- Drums first and a melody second: the scale is the melody's.
do
  P.reset()
  local a = P.track("Drums")
  local b = P.track("Tune")
  P.selected = { P.item(a, 0, 8, F.drums, "Beat"), P.item(b, 0, 16, F.twinkle, "Tune") }
  P.ext = {}
  start()
  frame()
  ok(has(g.texts, "Heard as C Major in \"Tune\"."), "the key comes from the item that has one, named")
  click("Minor (Natural)")
  click("Make 4 variations")
  eq(#a.items, 5, "the drums are varied")
  eq(#b.items, 5, "and the tune")
end

------------------------------------------------------------------------------
-- Every button, from a fresh start, in every state
------------------------------------------------------------------------------

local STATES = {
  { "a melody", function() project("noir", "Noir") end },
  { "a piano part", function() project("piano", "Piano") end },
  { "drums", function() project("drums", "Beat", 8) end },
  { "variations selected", function()
      local t = project("twinkle", "Twinkle")
      start(); frame(); click("Make 4 variations")
    end },
  { "nothing selected", function() P.reset() end },
  -- Picked in the window, so done after the script starts (third entry).
  { "a scale picked", function() project("twinkle", "Twinkle") end,
    function() click("Dorian") end },
  { "a pivot switched off", function() project("twinkle", "Twinkle") end,
    function() click("Minor (Natural)"); toggle("Bring the original into this scale") end },
  { "own notes", function() project("twinkle", "Twinkle") end,
    function() click("Stay in the original's notes") end },
  { "arpeggios", function() project("arpeggios", "Arps") end },
  { "a melody at 100%", function() project("noir", "Noir") end,
    function() slide("##amount", 100) end },
}

local reached = {}
for _, state in ipairs(STATES) do
  state[2]()
  P.ext = {}
  start()
  frame()
  if state[3] then state[3]() end
  local count = #g.buttons
  for i = 1, count do
    state[2]()
    P.ext = {}
    start()
    frame()
    if state[3] then state[3]() end
    local label = g.buttons[i]
    if label then
      local okCall, err = pcall(function()
        frame(i)
        frame()
        frame()
      end)
      ok(okCall, ("%s: clicking '%s' works (%s)"):format(state[1], label, tostring(err)))
      reached[label] = true
      checkInk(state[1] .. " after " .. label)
    end
  end
end
for _, name in ipairs({ "Use selected items", "Notes", "Rhythm", "Add notes", "Leave notes out",
                        "Chord voicing", "Chord quality", "Timing", "Velocity", "Lengths", "Anywhere", "Towards the end", "Towards the start",
                        "<", ">", "New set", "Make 4 variations", "Vary selected in place",
                        "Put back the original", "Stay in the original's notes", "Back to what it heard",
                        "Db", "B", "Major", "Minor Pentatonic", "Diminished Half-Whole",
                        "Develop the motif" }) do
  ok(reached[name], "the sweep reached '" .. name .. "'")
end

C.done()
