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
eq(#g.headings, 3, "a selected item on start: all three steps")
ok(has(g.texts, "\"Noir\"   8 bars of 4/4, 28 notes, D Minor (Natural)"), "the source described")
ok(has(g.texts, "Variation 1 of 4"), "four variations previewed")
ok(has(g.texts, "subtle - about 2 changes in 28 notes"), "the amount said in words and changes")
ok(not has(g.buttons, "Chords"), "no Chords switch for a melody: no dead controls")
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
ok(has(g.buttons, "Chords"), "a piano part gets the Chords switch")
checkInk("piano")

project("drums", "Beat", 8)
start()
frame()
ok(has(g.texts, "drums"), "drums are recognised")
ok(not has(g.buttons, "Notes"), "and get no Notes switch: a drum has no pitch to bend")
checkInk("drums")

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
}

local reached = {}
for _, state in ipairs(STATES) do
  state[2]()
  P.ext = {}
  start()
  frame()
  local count = #g.buttons
  for i = 1, count do
    state[2]()
    P.ext = {}
    start()
    frame()
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
for _, name in ipairs({ "Use selected items", "Notes", "Rhythm", "Add notes", "Leave notes out", "Chords",
                        "Timing", "Velocity", "Lengths", "Anywhere", "Towards the end", "Towards the start",
                        "<", ">", "New set", "Make 4 variations", "Vary selected in place",
                        "Put back the original" }) do
  ok(reached[name], "the sweep reached '" .. name .. "'")
end

C.done()
