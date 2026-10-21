--[[ Apple's Human Interface Guidelines, as the UI test sees them.

     test_ui.lua loads this into its mocked ReaImGui just before sealing it:

       local HIG = dofile(HERE .. "/hig_mock.lua")(ImGui)

     It adds what the HIG work calls - fonts, style variables, the View menu,
     the keyboard flag, the zoom keys - from ReaImGui 0.9's documented
     signatures, and wraps the mock's own widgets to record, per widget, what
     the checks need: each line of text's colour, each button's width, fill
     and ink, and the order things are drawn in. It keeps its own colour
     stack, so it does not depend on how the mock keeps one.

     HIG.check(env) then runs the checks the family's windows share. The
     same file is in Midi Variator, Starting Blocks, Starting Blocks
     Notation, Midi Catalogue, Good Idea and DAW Battle Pass.
]]

return function(ImGui)
  local H = { keys = {}, mods = 0 }

  local function newFrame()
    H.stack, H.texts, H.textInk, H.buttons, H.ink, H.widths = {}, {}, {}, {}, {}, {}
    H.order, H.menu, H.inkBars, H.navRing = {}, {}, 0, nil
    H.varDepth, H.fontDepth, H.fontStack = 0, 0, {}
  end
  newFrame()

  local function has(name) return rawget(ImGui, name) ~= nil end
  local nextConst = 5000
  local function const(name)
    if not has(name) then nextConst = nextConst + 1; ImGui[name] = nextConst end
  end
  for _, k in ipairs({ "Col_NavHighlight", "Col_Text", "Col_Button", "StyleVar_FramePadding",
                       "StyleVar_ItemSpacing", "StyleVar_ItemInnerSpacing", "Key_Equal",
                       "Key_KeypadAdd", "Key_Minus", "Key_KeypadSubtract", "Key_0" }) do
    const(k)
  end
  -- Flags are bits, as in ReaImGui.
  ImGui.WindowFlags_MenuBar = 1024
  ImGui.ConfigFlags_NavEnableKeyboard = 1
  ImGui.Mod_Shortcut = 4096

  local function effective(idx)
    for i = #H.stack, 1, -1 do if H.stack[i].idx == idx then return H.stack[i].col end end
  end

  -- Wraps a mock function, calling the mock's own first if it has one.
  local function wrap(name, after, before)
    local orig = rawget(ImGui, name)
    ImGui[name] = function(...)
      if before then before(...) end
      local r = orig and table.pack(orig(...)) or table.pack()
      if after then
        local o = table.pack(after(r, ...))
        if o.n > 0 and o[1] ~= nil then return table.unpack(o, 1, o.n) end
      end
      return table.unpack(r, 1, r.n)
    end
  end

  -- Every window's loop starts here, so a frame starts here. Whatever the
  -- last frame pushed must have come off.
  wrap("SetNextWindowSize", nil, function()
    if H.varDepth ~= 0 then error("PushStyleVar left unbalanced: " .. H.varDepth) end
    if H.fontDepth ~= 0 then error("PushFont left unbalanced: " .. H.fontDepth) end
    newFrame()
  end)

  wrap("PushStyleColor", nil, function(_, idx, col)
    H.stack[#H.stack + 1] = { idx = idx, col = col }
    if idx == ImGui.Col_NavHighlight then H.navRing = col end
  end)
  wrap("PopStyleColor", nil, function(_, n) for _ = 1, (n or 1) do H.stack[#H.stack] = nil end end)

  -- ImGui_Context ctx = CreateContext(string label, optional integer config_flags)
  wrap("CreateContext", nil, function(_, flags) H.configFlags = flags end)
  -- ImGui_Font font = CreateFont(string family_or_file, integer size, optional integer flags)
  if not has("CreateFont") then
    ImGui.CreateFont = function(family, size) return { family = family, size = size } end
  end
  wrap("CreateFont", function(r, family, size)
    if type(family) ~= "string" or math.type(size) ~= "integer" then error("CreateFont(family, size)") end
    if type(r[1]) == "table" then r[1].size = r[1].size or size; r[1].hig = true end
  end)
  wrap("Attach", nil, function(_, obj) if type(obj) == "table" then obj.higAttached = true end end)
  wrap("PushFont", nil, function(_, font)
    if not (font and font.higAttached) then error("PushFont with a font that is not attached") end
    H.fontDepth = H.fontDepth + 1
    H.fontStack[#H.fontStack + 1] = font
    -- The window's own size is the first font pushed in a frame.
    if H.fontDepth == 1 then H.font = font end
  end)
  wrap("PopFont", nil, function()
    H.fontDepth = H.fontDepth - 1
    H.fontStack[#H.fontStack] = nil
  end)
  wrap("PushStyleVar", nil, function(_, idx, a, b)
    if type(idx) ~= "number" or type(a) ~= "number" then error("PushStyleVar(ctx, var, val1, val2)") end
    if idx == ImGui.StyleVar_FramePadding then H.framePad = b end
    if idx == ImGui.StyleVar_ItemSpacing then H.spacing = a end
    H.varDepth = H.varDepth + 1
  end)
  wrap("PopStyleVar", nil, function(_, n) H.varDepth = H.varDepth - (n or 1) end)

  wrap("Begin", nil, function(_, _, _, flags) H.windowFlags = flags end)
  wrap("IsKeyPressed", function(r, _, key) if H.keys[key] then return true end end)
  ImGui.GetKeyMods = function() return H.mods end

  -- Text measured as a sans-serif's average, about half its size a letter,
  -- in whichever font is pushed.
  ImGui.CalcTextSize = function(_, s)
    local f = H.fontStack[#H.fontStack]
    local size = f and f.size or 13
    return #tostring(s) * size * 0.55, size
  end

  local function textOf(label) return (tostring(label):gsub("##.*$", "")) end
  local function recordText(_, s)
    H.texts[#H.texts + 1] = s
    H.textInk[#H.texts] = effective(ImGui.Col_Text) or 0xDDE1E7FF
    H.order[#H.order + 1] = "text:" .. tostring(s)
  end
  wrap("Text", nil, recordText)
  if has("TextWrapped") then wrap("TextWrapped", nil, recordText) end
  wrap("SeparatorText", nil, function(_, s) H.order[#H.order + 1] = "heading:" .. s end)
  wrap("Button", nil, function(_, label, w)
    H.buttons[#H.buttons + 1] = textOf(label)
    local n = #H.buttons
    H.ink[n] = { bg = effective(ImGui.Col_Button) or 0xA9AFBAFF, text = effective(ImGui.Col_Text) }
    H.widths[n] = w or 0
    H.order[#H.order + 1] = "button:" .. textOf(label)
  end)
  if not has("GetItemRectMin") then
    ImGui.GetItemRectMin = function() return 0, 0 end
    ImGui.GetItemRectMax = function() return 100, 28 end
  end
  wrap("DrawList_AddRectFilled", nil, function(_, x1, y1, x2, y2, col)
    if col == 0x14171CFF then H.inkBars = H.inkBars + 1 end
  end)
  if not has("Separator") then ImGui.Separator = function() end end

  ImGui.BeginMenuBar = function() H.inMenuBar = true; return true end
  ImGui.EndMenuBar = function() H.inMenuBar = false end
  ImGui.BeginMenu = function(_, label)
    if not H.inMenuBar then error("BeginMenu outside the menu bar") end
    H.menuOpen = label
    return true
  end
  ImGui.EndMenu = function() H.menuOpen = nil end
  -- bool clicked = MenuItem(ctx, label, optional shortcut, optional p_selected, optional enabled)
  ImGui.MenuItem = function(_, label, shortcut, selected, enabled)
    if not H.menuOpen then error("MenuItem outside a menu") end
    if shortcut ~= nil and type(shortcut) ~= "string" then error("MenuItem's shortcut is text") end
    H.menu[#H.menu + 1] = { label = label, shortcut = shortcut, selected = selected,
                            enabled = enabled ~= false, menu = H.menuOpen }
    if H.menuClick == label and enabled ~= false then H.menuClick = nil; return true end
    return false
  end

  --------------------------------------------------------------------------
  -- The checks
  --------------------------------------------------------------------------

  -- WCAG's contrast ratio, which Apple's Accessibility page uses.
  local function luminance(col)
    local function ch(v)
      v = v / 255
      return v <= 0.03928 and v / 12.92 or ((v + 0.055) / 1.055) ^ 2.4
    end
    local r = math.floor(col / 16777216) % 256
    local g = math.floor(col / 65536) % 256
    local b = math.floor(col / 256) % 256
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
  end
  function H.contrast(a, b)
    local la, lb = luminance(a), luminance(b)
    return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05)
  end
  H.GROUND = 0x23272EFF
  H.ACCENT = 0xFFF200FF

  -- One frame, optionally choosing a menu item or pressing keys in it.
  function H.menuFrame(env, label)
    H.menuClick = label
    env.frame()
    H.menuClick = nil
    env.frame()
  end
  function H.keyFrame(env, mods, key)
    H.mods, H.keys = mods or 0, { [key] = true }
    env.frame()
    H.mods, H.keys = 0, {}
    env.frame()
  end

  --[[ env:
       ok, eq            the suite's checks
       frame()           draws one frame
       loaded()          a fresh start with something to show (several
                         buttons chosen, a message absent)
       warned()          a fresh start that has just shown a warning; returns
                         the warning's text (a substring)
       dismiss()         clicks Dismiss
       quit()            runs the script's atexit
       restart()         starts the script again on the same saved settings
       saved()           the saved settings string
       setSaved(s)       replaces it
       sizeKey           the saved key, "textSize"
       allTexts          optional: true when every text in loaded() should be
                         7:1 (default true)
  ]]
  function H.check(env)
    local ok, eq = env.ok, env.eq

    env.loaded()
    ok(H.configFlags and H.configFlags & ImGui.ConfigFlags_NavEnableKeyboard ~= 0,
       "HIG: the keyboard alone can move through the window - keyboard navigation is on")
    ok(H.windowFlags and H.windowFlags & ImGui.WindowFlags_MenuBar ~= 0, "HIG: the window has a menu bar")
    eq(H.font and H.font.size, env.baseSize or 13, "HIG: text starts at the Mac's default size")
    eq((env.baseSize or 13) + 2 * (H.framePad or 0), 28, "HIG: a control is 28 points tall, Apple's Mac default")
    eq(H.spacing, 12, "HIG: with 12 points between controls")
    ok(H.navRing and H.navRing ~= H.ACCENT and H.contrast(H.navRing, env.ground or H.GROUND) >= 3,
       "HIG: the keyboard's focus ring has a colour of its own, 3:1 on the ground and not the accent")

    -- Every line of text 7:1 on the ground; every button's ink 7:1 on its fill.
    local worst, which = 99, nil
    for i, t in ipairs(H.texts) do
      local c = H.contrast(H.textInk[i], env.ground or H.GROUND)
      if c < worst then worst, which = c, t end
    end
    ok(#H.texts > 0 and worst >= 7,
       ("HIG: every text is 7:1 on the ground (lowest %.2f: %s)"):format(worst, tostring(which)))
    local bad
    for i, b in ipairs(H.buttons) do
      if H.contrast(H.ink[i].text or 0, H.ink[i].bg) < 7 then bad = bad or b end
    end
    ok(#H.buttons > 0 and not bad, "HIG: every button's ink is 7:1 on its fill: " .. tostring(bad))

    -- Chosen is not shown by colour alone.
    local chosen = 0
    for i in ipairs(H.buttons) do if H.ink[i].bg == H.ACCENT then chosen = chosen + 1 end end
    ok(chosen >= 1, "HIG: something is chosen: " .. chosen)
    eq(H.inkBars, chosen, "HIG: each chosen button carries a bar as well as the accent")

    -- A warning: 7:1, at the top, staying until dismissed.
    if env.warned then
      local text = env.warned()
      local at, first
      for i, t in ipairs(H.texts) do
        if tostring(t):find(text, 1, true) then
          at = i
          ok(H.contrast(H.textInk[i], env.ground or H.GROUND) >= 7, "HIG: a warning is 7:1 too, not the house red")
        end
      end
      ok(at, "HIG: the warning was shown: " .. text)
      local msg
      for i, o in ipairs(H.order) do
        if o:find(text, 1, true) then msg = msg or i end
        if o:find("^heading:") or o:find("^button:") and not o:find("Dismiss") then first = first or i end
      end
      ok(msg and first and msg < first, "HIG: the message sits above everything else in the window")
      for _ = 1, 20 do env.frame() end
      local still = false
      for _, t in ipairs(H.texts) do if tostring(t):find(text, 1, true) then still = true end end
      ok(still, "HIG: and is still there twenty frames later")
      env.dismiss()
      still = false
      for _, t in ipairs(H.texts) do if tostring(t):find(text, 1, true) then still = true end end
      ok(not still, "HIG: until Dismiss takes it away")
    end

    -- Text Size, from the View menu and the keys.
    env.loaded()
    local labels = {}
    for _, m in ipairs(H.menu) do if m.menu == "View" and m.label:find("Text") then labels[#labels + 1] = m.label end end
    eq(table.concat(labels, "|"),
       "Text Size 100%|Text Size 125%|Text Size 150%|Text Size 200%|Bigger Text|Smaller Text",
       "HIG: the View menu offers four sizes, bigger and smaller")
    local before = {}
    for i, b in ipairs(H.buttons) do before[b] = before[b] or H.widths[i] end
    H.menuFrame(env, "Text Size 200%")
    local base = env.baseSize or 13
    eq(H.font and H.font.size, base * 2, "HIG: 200% is twice the text")
    eq(base * 2 + 2 * (H.framePad or 0), 56, "HIG: and controls twice as tall")
    local grew = 0
    for i, b in ipairs(H.buttons) do
      if before[b] and before[b] > 0 and H.widths[i] >= 2 * before[b] - 1 then grew = grew + 1 end
    end
    ok(grew >= (env.minGrown or 5), "HIG: buttons grow with the text: " .. grew)
    local narrow
    for i, b in ipairs(H.buttons) do
      local need = #b * H.font.size * 0.55   -- as CalcTextSize measures at this size
      if H.widths[i] ~= 0 and H.widths[i] < need then narrow = narrow or b end
    end
    ok(not narrow, "HIG: every button is wide enough for its label at 200%: " .. tostring(narrow))
    for _, m in ipairs(H.menu) do
      if m.label == "Bigger Text" then ok(not m.enabled, "HIG: nothing bigger than 200%") end
    end
    env.quit()
    ok((env.saved() or ""):find(env.sizeKey .. "=4", 1, true), "HIG: the size is remembered")
    env.restart()
    env.frame()
    eq(H.font and H.font.size, base * 2, "HIG: and comes back next time")

    H.keyFrame(env, ImGui.Mod_Shortcut, ImGui.Key_Minus)
    eq(H.font.size, math.floor(base * 1.5 + 0.5), "HIG: Cmd+- makes it smaller")
    H.keyFrame(env, 0, ImGui.Key_Equal)
    eq(H.font.size, math.floor(base * 1.5 + 0.5), "HIG: = alone does nothing; it needs Cmd")
    H.keyFrame(env, ImGui.Mod_Shortcut, ImGui.Key_0)
    eq(H.font.size, base, "HIG: Cmd+0 is the actual size")
    env.quit()
    env.setSaved(env.sizeKey .. "=9")
    env.restart()
    env.frame()
    eq(H.font.size, base * 2, "HIG: a saved size out of range is put back in range")
    env.quit()
    env.setSaved("")
  end

  return H
end
