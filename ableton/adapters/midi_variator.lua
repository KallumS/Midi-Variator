--[[ Midi Variator, in Noterator.

     Select some music and get variations of it: a note bent a step, a beat
     pushed, a passing note slipped in, a chord revoiced. Every variation is
     made from the original, never from the one before, so the twentieth is
     as close to it as the first. ]]

local C = engine("adapters/common.lua")
local T = engine("midi-variator/mv_theory.lua")
local V = engine("midi-variator/mv_vary.lua")

local A = {
  id = "midi-variator",
  name = "Vary Notes",       -- Midi Variator (decision 0025)
  description = "Small variations of the selected music, the way a score keeps returning to a motif a little different each time.",
  input = "selection",
  panel = "generate",
}

local AMOUNTS = { 0.1, 0.2, 0.35, 0.5, 0.7, 0.9, 1.0 }
local function pct(list) local out = {} for i, v in ipairs(list) do out[i] = math.floor(v * 100 + 0.5) .. "%" end return out end
local function range(n) local out = {} for i = 1, n do out[i] = i end return out end
local formNames, formHints = {}, {}
for i, f in ipairs(V.FORMS) do formNames[i], formHints[i] = f.name, f.hint end

local LIST = {
  C.setting("amount", "How much", AMOUNTS, pct(AMOUNTS), {
    hint = "How much of the music may change. Near 100% a stretch of it may be developed." }),
  C.setting("focus", "Where", range(#V.FOCUS), V.FOCUS),
  C.setting("form", "Form", range(#V.FORMS), formNames, { hints = formHints }),
  C.onOff("keepEnds", "Keep the ends", { hint = "The first and last notes stay as they are." }),
  C.onOff("grow", "Grow", { hint = "Gentle first, the full amount by the last." }),
  C.onOff("outside", "Outside the scale", { hint = "Chord-quality changes may use notes outside the scale." }),
}
for _, k in ipairs(V.KINDS) do LIST[#LIST + 1] = C.onOff(k.key, k.name, { group = "What may change" }) end
for _, f in ipairs(V.FEELS) do LIST[#LIST + 1] = C.onOff(f.key, f.name, { group = "Feel" }) end

function A.newState() return V.defaults() end
function A.settings(st, ctx) return C.describe(LIST, st, ctx) end
function A.set(st, id, index, ctx) C.set(LIST, st, id, index, ctx) end
function A.useKey() end   -- it reads the key from the music itself

function A.generate(st, ctx, seed, count)
  local sel = ctx.selection
  if not sel or #sel.notes == 0 then
    return { results = {}, message = "Select some music in the score first - a motif, a chord part or a beat." }
  end
  local notes = {}
  for i, n in ipairs(sel.notes) do
    notes[i] = { start = n.start, len = n.len, pitch = n.pitch, vel = n.vel or 100,
                 chan = sel.drums and V.DRUM_CHANNEL or 0 }
  end
  local src = { notes = notes, lead = 0, beats = sel.beats, barBeats = ctx.barBeats, pulse = ctx.pulse or 1 }
  local an = V.analyse(src, T)
  local vars = V.series(src, an, st, seed * 7919, count or 6, T)
  local letters = V.formLetters(st.form or 1, #vars)
  local out = {}
  local i = 0
  for letter in letters:gmatch("%S+") do
    i = i + 1
    local var = vars[i]
    if not var then break end
    local changes = #var.changes > 0 and table.concat(var.changes, "; ") or "No changes - the original, played afresh."
    out[#out + 1] = { title = ("%d. %s  -  keeps %d%%"):format(i, letter, math.floor(V.likeness(notes, var.notes) * 100 + 0.5)),
                      detail = changes, beats = sel.beats,
                      parts = { { name = "Variation", drums = sel.drums, notes = C.notes(var.notes) } } }
  end
  local msg = an.key and ("Heard in " .. an.key.label) or nil
  return { results = out, message = msg }
end

return A
