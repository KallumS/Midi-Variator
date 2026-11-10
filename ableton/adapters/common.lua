--[[ Noterator - what every generator adapter shares.

     The engines in the folders beside this one are the family's own, copied
     unchanged from their repositories. An adapter is the only thing written
     for Noterator: it turns one engine's settings into lists the app can show
     and its output into parts the app can drop into a score. The app speaks
     to every adapter the same way:

       A.id, A.name, A.description
       A.input                 "none", or "selection" when it works on music
                               the user has selected
       A.panel                 "generate", "toolbox", or nil: not shown
       A.newState()            a fresh table of settings
       A.settings(st, ctx)     the settings to show now, each
                               { id, label, names = {...}, index, hint, hints = {...}, group }
       A.set(st, id, index)    choose the index-th value of a setting
       A.useKey(st, root, scale)   follow the score's key (1-based ScaleView indices)
       A.generate(st, ctx, seed, count)
                               { results = { { title, detail, beats, parts = {
                                   { name, drums, instrument, notes = { {start, len, pitch, vel} } } } } },
                                 message }

     Times are quarter notes from the start of the result. `ctx` is
       { root, scale, num, den, barBeats, bpm, inst, catalogueId, bars,
         selection = { notes, beats, drums } } ]]

local C = {}

function C.indexOf(list, v)
  for i, x in ipairs(list) do if x == v then return i end end
  return nil
end

-- A setting: `values` are what the engine stores, `names` what the window
-- shows. `when(st)` hides it when it does nothing (no dead controls).
function C.setting(id, label, values, names, opts)
  opts = opts or {}
  local shown = {}
  for i, v in ipairs(values) do shown[i] = names and names[i] or tostring(v) end
  return { id = id, label = label, values = values, names = shown, hint = opts.hint,
           hints = opts.hints, when = opts.when, group = opts.group, dynamic = opts.dynamic }
end

function C.onOff(id, label, opts)
  return C.setting(id, label, { true, false }, { "On", "Off" }, opts)
end

-- What the window draws: the settings that apply to this state.
function C.describe(list, st, ctx)
  local out = {}
  for _, s in ipairs(list) do
    if not s.when or s.when(st) then
      local values, names, hints = s.values, s.names, s.hints
      if s.dynamic then values, names, hints = s.dynamic(st, ctx) end
      local index = C.indexOf(values, st[s.id]) or 1
      out[#out + 1] = { id = s.id, label = s.label, names = names, index = index,
                        hint = s.hint or "", hints = hints or {}, group = s.group or "" }
    end
  end
  return out
end

function C.set(list, st, id, index, ctx)
  for _, s in ipairs(list) do
    if s.id == id then
      local values = s.values
      if s.dynamic then values = s.dynamic(st, ctx) end
      if values[index] ~= nil then st[id] = values[index] end
      return true
    end
  end
  return false
end

-- Notes as the app wants them, whatever the engine called the fields.
function C.notes(list, chan)
  local out = {}
  for _, n in ipairs(list or {}) do
    if not chan or (n.chan or 0) == chan then
      out[#out + 1] = { start = n.start, len = n.len, pitch = n.pitch, vel = n.vel or 100 }
    end
  end
  table.sort(out, function(a, b)
    if a.start ~= b.start then return a.start < b.start end
    return a.pitch < b.pitch
  end)
  return out
end

function C.finish(notes)
  local e = 0
  for _, n in ipairs(notes) do e = math.max(e, n.start + n.len) end
  return e
end

return C
