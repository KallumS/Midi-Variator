/* Midi Variator - built by ableton/kit/build.py from ableton/device.json. Do not edit; edit the sources and rebuild. */
var DEVICE = {"generator": "midi-variator", "keyless": true, "title": "Midi Variator"};
DEVICE.files = {"adapters/common.lua": "--[[ Noterator - what every generator adapter shares.\n\n     The engines in the folders beside this one are the family's own, copied\n     unchanged from their repositories. An adapter is the only thing written\n     for Noterator: it turns one engine's settings into lists the app can show\n     and its output into parts the app can drop into a score. The app speaks\n     to every adapter the same way:\n\n       A.id, A.name, A.description\n       A.input                 \"none\", or \"selection\" when it works on music\n                               the user has selected\n       A.panel                 \"generate\", \"toolbox\", or nil: not shown\n       A.newState()            a fresh table of settings\n       A.settings(st, ctx)     the settings to show now, each\n                               { id, label, names = {...}, index, hint, hints = {...}, group }\n       A.set(st, id, index)    choose the index-th value of a setting\n       A.useKey(st, root, scale)   follow the score's key (1-based ScaleView indices)\n       A.generate(st, ctx, seed, count)\n                               { results = { { title, detail, beats, parts = {\n                                   { name, drums, instrument, notes = { {start, len, pitch, vel} } } } } },\n                                 message }\n\n     Times are quarter notes from the start of the result. `ctx` is\n       { root, scale, num, den, barBeats, bpm, inst, catalogueId, bars,\n         selection = { notes, beats, drums } } ]]\n\nlocal C = {}\n\nfunction C.indexOf(list, v)\n  for i, x in ipairs(list) do if x == v then return i end end\n  return nil\nend\n\n-- A setting: `values` are what the engine stores, `names` what the window\n-- shows. `when(st)` hides it when it does nothing (no dead controls).\nfunction C.setting(id, label, values, names, opts)\n  opts = opts or {}\n  local shown = {}\n  for i, v in ipairs(values) do shown[i] = names and names[i] or tostring(v) end\n  return { id = id, label = label, values = values, names = shown, hint = opts.hint,\n           hints = opts.hints, when = opts.when, group = opts.group, dynamic = opts.dynamic }\nend\n\nfunction C.onOff(id, label, opts)\n  return C.setting(id, label, { true, false }, { \"On\", \"Off\" }, opts)\nend\n\n-- What the window draws: the settings that apply to this state.\nfunction C.describe(list, st, ctx)\n  local out = {}\n  for _, s in ipairs(list) do\n    if not s.when or s.when(st) then\n      local values, names, hints = s.values, s.names, s.hints\n      if s.dynamic then values, names, hints = s.dynamic(st, ctx) end\n      local index = C.indexOf(values, st[s.id]) or 1\n      out[#out + 1] = { id = s.id, label = s.label, names = names, index = index,\n                        hint = s.hint or \"\", hints = hints or {}, group = s.group or \"\" }\n    end\n  end\n  return out\nend\n\nfunction C.set(list, st, id, index, ctx)\n  for _, s in ipairs(list) do\n    if s.id == id then\n      local values = s.values\n      if s.dynamic then values = s.dynamic(st, ctx) end\n      if values[index] ~= nil then st[id] = values[index] end\n      return true\n    end\n  end\n  return false\nend\n\n-- Notes as the app wants them, whatever the engine called the fields.\nfunction C.notes(list, chan)\n  local out = {}\n  for _, n in ipairs(list or {}) do\n    if not chan or (n.chan or 0) == chan then\n      out[#out + 1] = { start = n.start, len = n.len, pitch = n.pitch, vel = n.vel or 100 }\n    end\n  end\n  table.sort(out, function(a, b)\n    if a.start ~= b.start then return a.start < b.start end\n    return a.pitch < b.pitch\n  end)\n  return out\nend\n\nfunction C.finish(notes)\n  local e = 0\n  for _, n in ipairs(notes) do e = math.max(e, n.start + n.len) end\n  return e\nend\n\nreturn C\n", "adapters/index.lua": "return { \"adapters/midi_variator.lua\" }\n", "adapters/midi_variator.lua": "--[[ Midi Variator, in Noterator.\n\n     Select some music and get variations of it: a note bent a step, a beat\n     pushed, a passing note slipped in, a chord revoiced. Every variation is\n     made from the original, never from the one before, so the twentieth is\n     as close to it as the first. ]]\n\nlocal C = engine(\"adapters/common.lua\")\nlocal T = engine(\"midi-variator/mv_theory.lua\")\nlocal V = engine(\"midi-variator/mv_vary.lua\")\n\nlocal A = {\n  id = \"midi-variator\",\n  name = \"Vary Notes\",       -- Midi Variator (decision 0025)\n  description = \"Small variations of the selected music, the way a score keeps returning to a motif a little different each time.\",\n  input = \"selection\",\n  panel = \"generate\",\n}\n\nlocal AMOUNTS = { 0.1, 0.2, 0.35, 0.5, 0.7, 0.9, 1.0 }\nlocal function pct(list) local out = {} for i, v in ipairs(list) do out[i] = math.floor(v * 100 + 0.5) .. \"%\" end return out end\nlocal function range(n) local out = {} for i = 1, n do out[i] = i end return out end\nlocal formNames, formHints = {}, {}\nfor i, f in ipairs(V.FORMS) do formNames[i], formHints[i] = f.name, f.hint end\n\nlocal LIST = {\n  C.setting(\"amount\", \"How much\", AMOUNTS, pct(AMOUNTS), {\n    hint = \"How much of the music may change. Near 100% a stretch of it may be developed.\" }),\n  C.setting(\"focus\", \"Where\", range(#V.FOCUS), V.FOCUS),\n  C.setting(\"form\", \"Form\", range(#V.FORMS), formNames, { hints = formHints }),\n  C.onOff(\"keepEnds\", \"Keep the ends\", { hint = \"The first and last notes stay as they are.\" }),\n  C.onOff(\"grow\", \"Grow\", { hint = \"Gentle first, the full amount by the last.\" }),\n  C.onOff(\"outside\", \"Outside the scale\", { hint = \"Chord-quality changes may use notes outside the scale.\" }),\n}\nfor _, k in ipairs(V.KINDS) do LIST[#LIST + 1] = C.onOff(k.key, k.name, { group = \"What may change\" }) end\nfor _, f in ipairs(V.FEELS) do LIST[#LIST + 1] = C.onOff(f.key, f.name, { group = \"Feel\" }) end\n\nfunction A.newState() return V.defaults() end\nfunction A.settings(st, ctx) return C.describe(LIST, st, ctx) end\nfunction A.set(st, id, index, ctx) C.set(LIST, st, id, index, ctx) end\nfunction A.useKey() end   -- it reads the key from the music itself\n\nfunction A.generate(st, ctx, seed, count)\n  local sel = ctx.selection\n  if not sel or #sel.notes == 0 then\n    return { results = {}, message = \"Select some music in the score first - a motif, a chord part or a beat.\" }\n  end\n  local notes = {}\n  for i, n in ipairs(sel.notes) do\n    notes[i] = { start = n.start, len = n.len, pitch = n.pitch, vel = n.vel or 100,\n                 chan = sel.drums and V.DRUM_CHANNEL or 0 }\n  end\n  local src = { notes = notes, lead = 0, beats = sel.beats, barBeats = ctx.barBeats, pulse = ctx.pulse or 1 }\n  local an = V.analyse(src, T)\n  local vars = V.series(src, an, st, seed * 7919, count or 6, T)\n  local letters = V.formLetters(st.form or 1, #vars)\n  local out = {}\n  local i = 0\n  for letter in letters:gmatch(\"%S+\") do\n    i = i + 1\n    local var = vars[i]\n    if not var then break end\n    local changes = #var.changes > 0 and table.concat(var.changes, \"; \") or \"No changes - the original, played afresh.\"\n    out[#out + 1] = { title = (\"%d. %s  -  keeps %d%%\"):format(i, letter, math.floor(V.likeness(notes, var.notes) * 100 + 0.5)),\n                      detail = changes, beats = sel.beats,\n                      parts = { { name = \"Variation\", drums = sel.drums, notes = C.notes(var.notes) } } }\n  end\n  local msg = an.key and (\"Heard in \" .. an.key.label) or nil\n  return { results = out, message = msg }\nend\n\nreturn A\n", "midi-variator/mv_theory.lua": "--[[ Midi Variator - keys, finding the key, and naming chords.\n\n     Pure Lua. Nothing in this file touches REAPER or ImGui.\n\n     Everything below the line is copied UNCHANGED from Midi Suggester's\n     reascripts/ms_theory.lua at commit 4577b87, comments and all:\n\n       - Keys: ScaleView for REAPER's roots and seven-note scales.\n       - Finding the key, with weights tuned on fifteen tunes there.\n       - Naming a chord: ScaleView Pro's chord reader - the definitive one;\n         ScaleView (not Pro) is a simplified version. Midi Suggester carries\n         it unchanged, and its CORE_RANK-to-analyse block is\n         reascripts/ScaleView Pro.lua's at f9e2691, verbatim. (Pro took\n         Starting Blocks' chords as a dictionary in df4ea43 and dropped\n         them again in f13f8a6; so does this copy.)\n         The variator uses it to find a chord's root before changing its\n         quality, and to say what it became (\"Bar 2: G7 became G9\") in\n         ScaleView Pro's own words.\n\n     Do not change or retune anything here: a change belongs in Midi\n     Suggester (or, for the chord reader, ScaleView Pro) first, and is then\n     copied across. tests/test_vary.lua checks a few of ScaleView's own\n     chord names to prove the copy.\n\n     Scale degrees are 0-based (0 is the tonic) because the arithmetic wants\n     them that way. Table indices are 1-based, like Lua.\n]]\n------------------------------------------------------------------------------\nlocal M = {}\n\n------------------------------------------------------------------------------\n-- Keys\n--\n-- ScaleView's roots and scales, so the tools agree on what a key is and what\n-- its notes are called. Both spellings of every black key are here plus Cb,\n-- because C# major and Db major are the same seven notes written differently.\n--\n-- Only the seven-note scales are offered. Chords are built by stacking every\n-- other scale note, and a five- or six-note scale has no thirds to stack:\n-- a \"triad\" of the minor pentatonic is a pile of fourths.\n------------------------------------------------------------------------------\n\nlocal LETTER_PC  = { 0, 2, 4, 5, 7, 9, 11 }        -- C D E F G A B\nlocal LETTERS    = { \"C\", \"D\", \"E\", \"F\", \"G\", \"A\", \"B\" }\nlocal ACCIDENTAL = { [-2] = \"bb\", [-1] = \"b\", [0] = \"\", [1] = \"#\", [2] = \"x\" }\n\nM.SHARP_NAMES = { \"C\", \"C#\", \"D\", \"D#\", \"E\", \"F\", \"F#\", \"G\", \"G#\", \"A\", \"A#\", \"B\" }\nM.FLAT_NAMES  = { \"C\", \"Db\", \"D\", \"Eb\", \"E\", \"F\", \"Gb\", \"G\", \"Ab\", \"A\", \"Bb\", \"B\" }\n\n-- letter is 0-based into LETTERS.\nM.ROOTS = {\n  { name = \"C\",  letter = 0, acc =  0 }, { name = \"C#\", letter = 0, acc =  1 },\n  { name = \"Db\", letter = 1, acc = -1 }, { name = \"D\",  letter = 1, acc =  0 },\n  { name = \"D#\", letter = 1, acc =  1 }, { name = \"Eb\", letter = 2, acc = -1 },\n  { name = \"E\",  letter = 2, acc =  0 }, { name = \"F\",  letter = 3, acc =  0 },\n  { name = \"F#\", letter = 3, acc =  1 }, { name = \"Gb\", letter = 4, acc = -1 },\n  { name = \"G\",  letter = 4, acc =  0 }, { name = \"G#\", letter = 4, acc =  1 },\n  { name = \"Ab\", letter = 5, acc = -1 }, { name = \"A\",  letter = 5, acc =  0 },\n  { name = \"A#\", letter = 5, acc =  1 }, { name = \"Bb\", letter = 6, acc = -1 },\n  { name = \"B\",  letter = 6, acc =  0 }, { name = \"Cb\", letter = 0, acc = -1 },\n}\n\n-- iv is semitones from the tonic. Every scale here walks the letters in\n-- order, so the spelling needs no table of its own.\nM.SCALES = {\n  { name = \"Major\",           iv = { 0, 2, 4, 5, 7, 9, 11 } },\n  { name = \"Minor (Natural)\", iv = { 0, 2, 3, 5, 7, 8, 10 } },\n  { name = \"Harmonic Minor\",  iv = { 0, 2, 3, 5, 7, 8, 11 } },\n  { name = \"Dorian\",          iv = { 0, 2, 3, 5, 7, 9, 10 } },\n  { name = \"Phrygian\",        iv = { 0, 1, 3, 5, 7, 8, 10 } },\n  { name = \"Lydian\",          iv = { 0, 2, 4, 6, 7, 9, 11 } },\n  { name = \"Mixolydian\",      iv = { 0, 2, 4, 5, 7, 9, 10 } },\n}\nM.MAJOR, M.MINOR = 1, 2\n\nfunction M.rootIndex(name)\n  for i, r in ipairs(M.ROOTS) do if r.name == name then return i end end\nend\nfunction M.scaleIndex(name)\n  for i, s in ipairs(M.SCALES) do if s.name == name then return i end end\nend\n\nfunction M.rootPc(root) return (LETTER_PC[root.letter + 1] + root.acc) % 12 end\n\n-- Spell pitch class pc on the given letter (0-based, any integer), or nil\n-- when that would take more than a double accidental.\nlocal function spellAs(letter, pc)\n  letter = letter % 7\n  local offset = ((pc - LETTER_PC[letter + 1] + 6) % 12) - 6\n  local acc = ACCIDENTAL[offset]\n  if not acc then return nil end\n  return LETTERS[letter + 1] .. acc\nend\n\n--[[  A key, built once and handed around.\n\n      pcs[pc] is true for the scale's notes; degree[pc] is which degree a note\n      is (0-based); names[pc] is how it is written in this key. The notes\n      outside the scale have no spelling of their own, so they lean whichever\n      way the key does - exactly as ScaleView names them. ]]\nfunction M.key(rootIdx, scaleIdx)\n  local root, scale = M.ROOTS[rootIdx], M.SCALES[scaleIdx]\n  local k = {\n    root = rootIdx, scale = scaleIdx,\n    tonic = M.rootPc(root),\n    pcs = {}, degree = {}, degreePc = {}, names = {},\n    label = root.name .. \" \" .. scale.name,\n  }\n  local sharps, flats = 0, 0\n  for d, iv in ipairs(scale.iv) do\n    local pc = (k.tonic + iv) % 12\n    local name = spellAs(root.letter + d - 1, pc)\n    k.pcs[pc], k.degree[pc], k.degreePc[d - 1] = true, d - 1, pc\n    k.names[pc] = name\n    if name then\n      if name:find(\"#\") or name:find(\"x\") then sharps = sharps + 1 end\n      if name:find(\"b\", 2) then flats = flats + 1 end   -- skip the letter B\n    end\n  end\n  k.flats = flats > sharps\n  local outside = k.flats and M.FLAT_NAMES or M.SHARP_NAMES\n  for pc = 0, 11 do\n    if not k.names[pc] then k.names[pc] = outside[pc + 1] end\n  end\n  -- Whether the third above the tonic is major. The chord palette borrows\n  -- from the parallel key, and which way it borrows depends on this alone.\n  k.majorish = k.pcs[(k.tonic + 4) % 12] == true\n  return k\nend\n\n-- The pitch class of scale degree d, for any integer d: 7 is the tonic again.\nfunction M.degreePc(key, d) return key.degreePc[d % 7] end\n\nfunction M.noteName(key, pc) return key.names[pc % 12] end\n\n------------------------------------------------------------------------------\n-- Finding the key\n--\n-- Krumhansl and Kessler's key profiles: how well each of the twelve pitch\n-- classes was judged to fit a major and a minor key, measured by listening\n-- experiment (Krumhansl, Cognitive Foundations of Musical Pitch, 1990). The\n-- notes are counted by how long they sound, and the key whose profile\n-- correlates best with that count wins.\n--\n-- The profiles cannot tell a key from its relative minor very well - the two\n-- share all seven notes - so the note a piece ends on settles it, and the note\n-- it starts on helps. That is how a musician settles it too.\n------------------------------------------------------------------------------\n\nlocal PROFILE = {\n  [M.MAJOR] = { 6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88 },\n  [M.MINOR] = { 6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17 },\n}\n\n-- How a key on each pitch class is conventionally written: the spelling with\n-- fewer accidentals, and the sharp side of the six-and-six tie in major only\n-- because F# major is the one more often seen.\nlocal MAJOR_ROOT = { \"C\", \"Db\", \"D\", \"Eb\", \"E\", \"F\", \"F#\", \"G\", \"Ab\", \"A\", \"Bb\", \"B\" }\nlocal MINOR_ROOT = { \"C\", \"C#\", \"D\", \"Eb\", \"E\", \"F\", \"F#\", \"G\", \"G#\", \"A\", \"Bb\", \"B\" }\n\n--[[  The profiles alone are not enough for a short tune. Ode to Joy's first\n      phrase is five notes, C to G, and correlates best with E minor - which\n      has no F natural in it, and the phrase has two. So two more things are\n      asked, both of them things a musician asks:\n\n        - Is every note in the key? Time spent outside the scale counts\n          against it. (The raised seventh does not, in minor: the harmonic\n          minor's leading tone is part of a minor key.)\n        - Does the tune sit on the key's tonic chord? Time spent on its 1, 3\n          and 5 counts for it.\n\n      Measured over fifteen tunes and progressions (see the session log),\n      every setting of these weights misses one. This one misses Ode to Joy,\n      whose first phrase ends on D - a half cadence, which from the melody\n      alone is as good as D minor. The setting that gets Ode right misses\n      Happy Birthday instead, which ends on its tonic, and a tune ending on\n      its tonic is far the commoner case. The key is always the user's to\n      change. ]]\nM.KEY_OUTSIDE     = 1.0    -- per share of time on notes outside the scale\nM.KEY_TRIAD       = 0.6    -- per share of time on the tonic triad\nM.KEY_END_BONUS   = 0.2    -- the last note (or last bass) is the tonic\nM.KEY_START_BONUS = 0.05   -- and so is the first\n\nlocal function correlate(xs, ys)\n  local n, mx, my = #xs, 0, 0\n  for i = 1, n do mx, my = mx + xs[i], my + ys[i] end\n  mx, my = mx / n, my / n\n  local sxy, sxx, syy = 0, 0, 0\n  for i = 1, n do\n    local dx, dy = xs[i] - mx, ys[i] - my\n    sxy, sxx, syy = sxy + dx * dy, sxx + dx * dx, syy + dy * dy\n  end\n  if sxx == 0 or syy == 0 then return 0 end\n  return sxy / math.sqrt(sxx * syy)\nend\n\n--[[  notes: { {pitch, start, len}, ... }. firstPc / lastPc are the pitch\n      classes that open and close the music - the reader decides what those\n      are (a melody's first and last notes, a progression's first and last\n      bass). Returns the ranked candidates, best first, each\n      { root = index into ROOTS, scale = MAJOR or MINOR, score = number }. ]]\nfunction M.detectKey(notes, firstPc, lastPc)\n  local hist, total = {}, 0\n  for pc = 1, 12 do hist[pc] = 0 end\n  for _, n in ipairs(notes) do\n    local pc = n.pitch % 12 + 1\n    -- A very short note still counts for something: a run of sixteenths is\n    -- as much a statement of the key as one long note.\n    local w = math.max(n.len, 0.25)\n    hist[pc], total = hist[pc] + w, total + w\n  end\n  if total <= 0 then total = 1 end\n  local function at(pc) return hist[pc % 12 + 1] end\n\n  local ranked = {}\n  for tonic = 0, 11 do\n    for _, mode in ipairs({ M.MAJOR, M.MINOR }) do\n      local rotated = {}\n      for i = 0, 11 do rotated[i + 1] = PROFILE[mode][(i - tonic) % 12 + 1] end\n      local score = correlate(hist, rotated)\n\n      local inScale, outside = {}, 0\n      for _, iv in ipairs(M.SCALES[mode].iv) do inScale[(tonic + iv) % 12] = true end\n      if mode == M.MINOR then inScale[(tonic + 11) % 12] = true end\n      for pc = 0, 11 do if not inScale[pc] then outside = outside + at(pc) end end\n      local third = mode == M.MAJOR and 4 or 3\n      local triad = at(tonic) + at(tonic + third) + at(tonic + 7)\n      score = score - M.KEY_OUTSIDE * outside / total + M.KEY_TRIAD * triad / total\n\n      if lastPc == tonic then score = score + M.KEY_END_BONUS end\n      if firstPc == tonic then score = score + M.KEY_START_BONUS end\n      local rootName = (mode == M.MAJOR and MAJOR_ROOT or MINOR_ROOT)[tonic + 1]\n      ranked[#ranked + 1] = { root = M.rootIndex(rootName), scale = mode, score = score }\n    end\n  end\n  table.sort(ranked, function(a, b)\n    if a.score ~= b.score then return a.score > b.score end\n    if a.root ~= b.root then return a.root < b.root end\n    return a.scale < b.scale\n  end)\n  return ranked\nend\n\n------------------------------------------------------------------------------\n-- Reading a chord\n--\n-- Everything from here to `nameChord` is ScaleView Pro's chord reader,\n-- copied from `reascripts/ScaleView Pro.lua` at commit f9e2691 - its\n-- CORE_RANK table through `analyse`, unchanged, comments and all. The\n-- comments are its own and refer to its measurements, which are the reason\n-- the weights are what they are. Do not retune them here: a change belongs in\n-- ScaleView first, with its corpora, and is then copied across.\n-- tests/test_theory.lua holds ScaleView's own expected names to prove the copy.\n-- `nameChord` below is Pro's detectChord with the key passed in; its tiebreak\n-- (key, then no slash, then rank) is Pro's at the same commit.\n------------------------------------------------------------------------------\n\nlocal CORE_RANK = {\n  [\"maj/P/none\"]  =  1, [\"min/P/none\"]  =  2,\n  [\"maj/P/b7\"]    =  3, [\"min/P/b7\"]    =  4, [\"maj/P/maj7\"] =  5,\n  [\"min/b/b7\"]    =  6, [\"min/b/bb7\"]   =  7, [\"min/b/none\"] =  8,\n  [\"maj/#/none\"]  =  9,\n  [\"sus4/P/none\"] = 10, [\"sus2/P/none\"] = 11,\n  [\"min/P/maj7\"]  = 12,\n  [\"maj/#/b7\"]    = 13, [\"maj/b/b7\"]    = 14, [\"maj/#/maj7\"] = 15,\n  --[[  maj7b5 belongs in this list and was missing from it. The note above\n      says every altered fifth carrying a seventh that musicians play is named\n      here - 7b5, aug7, min7b5, maj7#5 - and players write maj7b5 constantly,\n      as the Lydian tonic. Without it the quality paid RANK_UNNAMED plus\n      RANK_TWICE_ODD, 37 before any slash, and lost to readings with no third\n      in them at all: D D# G A read Dsus4b9 rather than D#maj7b5/D. ]]\n  [\"maj/b/maj7\"]  = 16,\n  [\"sus4/P/b7\"]   = 17, [\"sus2/P/b7\"]   = 18,\n  [\"sus4/P/maj7\"] = 19, [\"sus2/P/maj7\"] = 20,\n\n  --[[  A missing third is a different chord, not a thinner one, so these sit\n      well below anything with a third in it.\n\n      Below, and by more than a slash costs. A third-less shape with a perfect\n      fifth is a real voicing - a seventh over a bare fifth is what a guitarist\n      plays - but one whose fifth is *also* altered is odd twice over, exactly\n      as RANK_TWICE_ODD has it for the qualities that keep their third. Those\n      two sit past COST_INVERSION from an unnamed quality with a third in it\n      (25), so D E A# reads Bb(b5)/E rather than E7b5(no3), the same way F A B\n      reads F(b5) rather than B7b5(no3). The perfect-fifth pair are left where\n      they were, which is what keeps C G Bb reading C7(no3). ]]\n  [\"none/P/b7\"]   = 30, [\"none/P/maj7\"] = 31, [\"none/P/none\"] = 34,\n  [\"none/b/maj7\"] = 41, [\"none/b/b7\"]   = 42,\n}\n\n--[[  A quality the table does not name is still ranked by the interval that\n    decides most about a chord: the third. A real third - major or minor -\n    keeps a chord readable however odd the rest of it is, so F A B reads\n    F(b5) rather than losing to B7b5(no3), which has no third in it at all.\n    A suspension is not a third but a stand-in for one, and a shape with\n    neither is the last thing to reach for. ]]\nlocal RANK_UNNAMED   = {maj = 25, min = 25, sus4 = 70, sus2 = 70, none = 90}\n--[[  Except that a third only excuses one oddity. Every altered fifth carrying\n    a seventh that musicians actually play is named in the table above - 7b5,\n    aug7, min7b5, maj7#5 - so a combination that is not there is strange twice\n    over, and should not win on the strength of its third alone. Without this\n    C D Eb Gb Cb read CminMaj9b5. ]]\nlocal RANK_TWICE_ODD =  12\n--[[  A missing fifth is never spoken, but it is not equally unremarkable. A\n    seventh chord is routinely voiced without one - that is the standard shell -\n    while a triad with no fifth is two notes and a guess, so the two are\n    charged differently. ]]\nlocal RANK_NO_FIFTH  =  20  -- a triad that has lost its fifth\nlocal RANK_NO_FIFTH7 =   4  -- a seventh chord voiced as a shell\nlocal RANK_ELEVENTH  =   6  -- a sus4 carrying a seventh and a ninth: C11\nlocal COST_INVERSION =  14  -- naming the bass after a slash\nlocal COST_NATURAL   =   1  -- a ninth/eleventh/thirteenth the number implies\nlocal COST_ADD       =   2  -- one that has to be spelled out as an add\nlocal COST_CLASH     =   6  -- a natural eleventh fighting a major third\nlocal COST_ALTERED   =   5  -- b9, #9, #11, b13 colouring a plain chord\n--[[  An alteration that does not belong to the chord it is sitting on costs\n    far more, because it usually means the root has been guessed wrong and the\n    notes belong to some plainer chord standing on one of the others. A b9, a\n    #9 and a b13 are the dominant's alterations: over a minor seventh or a\n    plain triad they are not colours a musician hears. A sharpened eleventh is\n    the exception - it is at home on almost anything with a perfect fifth -\n    and any alteration over a fifth that is already altered is suspect. ]]\nlocal COST_CLASHING  =  18\n--[[  A suspension replaces the third rather than decorating it, so it does not\n    carry added tones. \"sus4 add6 add9\" is not a chord anybody writes; those\n    notes are an inversion of something with a third in it. ]]\nlocal COST_SUS_EXTRA =  12\nlocal COST_SIXTH     =   4  -- enough that C E A stays Amin/C\n--[[  A minor sixth is charged one more than any other, because it is the one\n    sixth that is also something else: A C E F# is Amin6 and it is equally the\n    half-diminished on its third, F#min7b5. Those two readings tie exactly at\n    4, and the half-diminished is the name Scaler prints, the name jazznet's\n    labels carry, and the name some 880 analyst labels across DCML and When in\n    Rome give it. One point settles the tie without touching any other sixth. ]]\nlocal COST_MIN_SIXTH =   5\n\n--[[  Reading the intervals present into a third, a fifth and a seventh.\n\n    Where both a flattened and a raised fifth are sounding, which one is *the*\n    fifth is a real choice and not a lookup, so `preferSharpFive` lets the\n    caller ask for the other reading and cost them both. C E F# G# B was named\n    Cmaj7b5b13 because the flattened fifth was taken greedily, leaving the G#\n    to be described as a b13 over a chord that is not at home with one; read\n    the other way round it is Cmaj7#5#11, which costs 14 less. ]]\nlocal function core(has, preferSharpFive)\n  local third, fifth, seventh\n  local used = {[0] = true}\n\n  if     has[4] then third, used[4] = \"maj\",  true\n  elseif has[3] then third, used[3] = \"min\",  true\n  elseif has[5] then third, used[5] = \"sus4\", true\n  elseif has[2] then third, used[2] = \"sus2\", true\n  else               third = \"none\" end\n\n  if has[7] then fifth, used[7] = \"P\", true\n  elseif has[6] and has[8] and preferSharpFive then fifth, used[8] = \"#\", true\n  elseif has[6] then fifth, used[6] = \"b\", true\n  elseif has[8] then fifth, used[8] = \"#\", true\n  else               fifth = \"none\" end\n\n  -- A diminished triad takes the 9 as a doubly flattened seventh.\n  if     has[10] then seventh, used[10] = \"b7\",   true\n  elseif has[11] then seventh, used[11] = \"maj7\", true\n  elseif third == \"min\" and fifth == \"b\" and has[9] then\n                      seventh, used[9]  = \"bb7\",  true\n  else                seventh = \"none\" end\n\n  return third, fifth, seventh, used\nend\n\n-- The name of a core quality. Most are built from their parts; the handful\n-- with names of their own are named.\nlocal SPECIAL = {\n  [\"min/b/none\"] = \"dim\",  [\"min/b/bb7\"]  = \"dim7\", [\"min/b/b7\"] = \"min7b5\",\n  [\"maj/#/none\"] = \"aug\",  [\"maj/#/b7\"]   = \"aug7\", [\"maj/#/maj7\"] = \"maj7#5\",\n  [\"maj/b/b7\"]   = \"7b5\",  [\"min/P/maj7\"] = \"minMaj7\", [\"min/none/maj7\"] = \"minMaj7\",\n}\n\nlocal function coreName(third, fifth, seventh)\n  local special = SPECIAL[third .. \"/\" .. fifth .. \"/\" .. seventh]\n  if special then return special end\n\n  local base = (third == \"min\" and \"min\") or (third == \"sus4\" and \"sus4\")\n            or (third == \"sus2\" and \"sus2\") or \"\"\n  local sev  = (seventh == \"b7\" and \"7\") or (seventh == \"bb7\" and \"dim7\")\n            or (seventh == \"maj7\" and (third == \"min\" and \"Maj7\" or \"maj7\")) or \"\"\n  local alt  = (fifth == \"b\" and \"b5\") or (fifth == \"#\" and \"#5\") or \"\"\n\n  -- Sevenths are written before a sus, not after it: 7sus4, never sus47.\n  local name = (third == \"sus4\" or third == \"sus2\") and (sev .. base)\n                                                     or (base .. sev)\n  name = name .. alt\n  -- A bare altered fifth has to be bracketed or the symbol reads as a note\n  -- name: C(b5) is a chord on C, Cb5 looks like one on C flat.\n  if name == alt and alt ~= \"\" then name = \"(\" .. alt .. \")\" end\n  return name\nend\n\nlocal function rankOf(third, fifth, seventh)\n  if fifth == \"none\" then\n    local rank = CORE_RANK[third .. \"/P/\" .. seventh] or RANK_UNNAMED[third]\n    return rank + (seventh == \"none\" and RANK_NO_FIFTH or RANK_NO_FIFTH7)\n  end\n  local rank = CORE_RANK[third .. \"/\" .. fifth .. \"/\" .. seventh]\n  if rank then return rank end\n  return RANK_UNNAMED[third] + (seventh ~= \"none\" and RANK_TWICE_ODD or 0)\nend\n\n-- What is left over once the core has taken its notes.\n-- interval -> {how it is written, whether it is an alteration, which degree}\nlocal EXTENSION = {\n  [1] = {\"b9\",  true},  [2] = {\"9\",  false, 9},  [3] = {\"#9\",  true},\n  [5] = {\"11\",  false, 11}, [6] = {\"#11\", true}, [8] = {\"b13\", true},\n}\n\nlocal function analyseAs(has, root, bass, preferSharpFive)\n  local third, fifth, seventh, used = core(has, preferSharpFive)\n  local rank = rankOf(third, fifth, seventh)\n  local name, cost = coreName(third, fifth, seventh), rank\n\n  local naturals, altered, sixth = {}, {}, false\n  local asEleventh = false  -- read as an 11 chord, so not a suspension at all\n  for i = 1, 11 do\n    if has[i] and not used[i] then\n      if i == 9 then\n        if seventh == \"none\" then sixth = true else naturals[13] = true end\n      else\n        local ext = EXTENSION[i]\n        if ext and ext[2] then altered[#altered + 1] = ext[1]\n        elseif ext then naturals[ext[3]] = true\n        else\n          -- Only 11 can arrive here: core() always takes 4, 7 and 10 when they\n          -- are present, and 9 was dealt with above. So this is the major\n          -- seventh left over when a flattened one took the seventh's place.\n          altered[#altered + 1] = \"maj7\"\n        end\n      end\n    end\n  end\n\n  if seventh ~= \"none\" and seventh ~= \"bb7\" then\n    --[[  With a seventh underneath, the highest natural extension names the\n        chord - but a stacked number claims everything under it, so it may only\n        be used when the ninth is actually being played. Hutchinson's chord\n        list (Music Theory for the 21st-Century Classroom, 31.4) prints Cm11\n        and Cm7(11) side by side, six noteheads against five: the first has the\n        ninth in it, the second does not. So a ninth that is not there is named\n        in brackets after the seventh instead of being swallowed by a number.\n\n        A natural eleventh over a major third is the other exception: it\n        clashes, so it is bracketed rather than promoted whatever else is\n        present. ]]\n    --[[  A ninth that has been altered still fills its place in the stack: the\n        same list prints C13sus(b9) with six noteheads, the b9 standing where\n        the natural ninth would. So a b9 or a #9 lets the number rise too. ]]\n    local ninth = naturals[9]\n    for _, token in ipairs(altered) do\n      if token == \"b9\" or token == \"#9\" then ninth = true end\n    end\n\n    local number\n    if ninth and naturals[13] then number = 13\n    elseif ninth and naturals[11] and third ~= \"maj\" then number = 11\n    elseif naturals[9] then number = 9 end\n\n    if third == \"sus4\" and seventh == \"b7\" and naturals[9]\n       and (fifth == \"P\" or fifth == \"none\") then\n      -- A sus4 carrying a seventh and a ninth is how an eleventh chord is\n      -- voiced - the third is left out precisely because it would clash with\n      -- the eleventh - so it is named as one rather than as a suspension.\n      name, number, asEleventh = \"11\", 11, true\n      naturals[11] = true\n      cost = RANK_ELEVENTH + (fifth == \"none\" and RANK_NO_FIFTH7 or 0)\n    elseif number then\n      name = name:gsub(\"7\", tostring(number), 1)\n    end\n\n    local spare = {}\n    for _, degree in ipairs({9, 11, 13}) do\n      if naturals[degree] then\n        local implied = number and degree <= number\n                        and not (degree == 11 and third == \"maj\")\n        if implied then cost = cost + COST_NATURAL\n        else\n          cost = cost + (degree == 11 and third == \"maj\" and COST_CLASH or COST_ADD)\n          spare[#spare + 1] = degree\n        end\n      end\n    end\n    -- Everything the number did not account for, bracketed as the chord lists\n    -- print it: Cm7(11), C7(13), C7(11,13).\n    if #spare > 0 then name = name .. \"(\" .. table.concat(spare, \",\") .. \")\" end\n  else\n    -- No seventh, so nothing stacks: everything above the triad is an add.\n    if sixth then\n      cost = cost + ((third == \"min\" and fifth == \"P\") and COST_MIN_SIXTH\n                                                        or COST_SIXTH)\n      --[[  The sixth stands where a seventh would, so the symbol is rebuilt\n          around it rather than having a 6 pasted on the end. An altered fifth\n          has to survive that: C Eb G# A is min6#5, and naming it Cmin6 claims\n          a perfect fifth that is not being played. ]]\n      local mark = (fifth == \"b\" and \"b5\") or (fifth == \"#\" and \"#5\") or \"\"\n      if naturals[9] and (third == \"maj\" or third == \"min\") then\n        naturals[9] = nil\n        name = (third == \"min\" and \"min6/9\" or \"6/9\") .. mark\n        cost = cost + COST_ADD\n      elseif third == \"min\"  then name = \"min6\" .. mark\n      elseif third == \"maj\"  then name = (fifth == \"#\" and \"aug6\") or (\"6\" .. mark)\n      elseif third == \"none\" then name = \"6\" .. mark\n      else name = name .. \"(add6)\" end\n    end\n    --[[  A diminished seventh carrying a ninth is a dim9, not a dim7 with a\n        note stuck on the end. The number rises the way it does under every\n        other seventh - the bb7 only sat in the \"no seventh\" branch here\n        because it is spelled as a sixth - and Cdim9 is what the chord lists\n        and Scaler both print. ]]\n    --  Only the spelling changes. It still costs what an added tone costs, so\n    --  which reading wins is untouched: this renames, it does not re-rank.\n    if seventh == \"bb7\" and naturals[9] then\n      naturals[9] = nil\n      name = name:gsub(\"dim7\", \"dim9\", 1)\n      cost = cost + COST_ADD\n    end\n    for _, degree in ipairs({9, 11, 13}) do\n      if naturals[degree] then\n        cost = cost + (degree == 11 and third == \"maj\" and COST_CLASH or COST_ADD)\n        name = name .. (name == \"\" and \"add\" or \"Add\") .. degree\n      end\n    end\n  end\n\n  --[[  An alteration is written straight onto the symbol - C7b9, Cmin#11 -\n      except where that would read as a note name. \"C#11\" is a chord on C#,\n      so a bare triad says add instead: Cadd#11. ]]\n  --[[  Alt 2 differs from Alt here, and only here. Alt asks whether an\n      alteration belongs to the chord under it, and only a dominant is at home\n      with a b9, a #9 or a b13. Alt 2 also accepts a complete triad - a real\n      third with a perfect fifth underneath it - which is what Scaler 3 does:\n      given the choice it names the chord that has a whole triad in it and\n      hangs the odd notes off that, rather than the thinner reading that needs\n      fewer of them. C D Eb Gb Cb is the case that separates them: Alt reads\n      D13b9/C, Alt 2 and Scaler read Cbaddb9#9/C. ]]\n  local dominant = third == \"maj\" and seventh == \"b7\"\n  local triad = (third == \"maj\" or third == \"min\") and fifth == \"P\"\n  for _, token in ipairs(altered) do\n    --[[  A b13 is excluded from the concession, and measurably so. It is the\n        one alteration whose note is almost always a chord tone of something\n        plainer: E G B with a C in it is Cmaj7 in first inversion, not Emin\n        wearing a b13. Letting a complete triad take one cost 207 misnamed\n        sonorities across the Bach chorales and 7 points of accuracy on\n        inverted jazz voicings, and bought nothing - the chord Alt 2 exists\n        for, Cb maj b9 #9, carries a b9 and a #9, not a b13. ]]\n    --[[  An altered fifth is no bar on a dominant standing on its own root.\n        A b9 or #9 over a b5 or #5 usually means the root has been guessed\n        wrong, but over a major third and a flat seventh with the root in the\n        bass it is the altered dominant - 7#5b9, 7b5#9, 7b9b13 - which every\n        lead sheet writes. Barring it read C7#5b9 as A#min9b5/C. Only from the\n        bass, because that is how the chord is played - the bass takes the\n        root, the hands take the alterations - and allowing it from an\n        inversion as well read F A C G C# over C as Aaug7#9/C, a #9 in the\n        bass, and moved 790 names in the sweep where this moves 455. ]]\n    local plainFifth = fifth ~= \"b\" and fifth ~= \"#\"\n    local athome = token ~= \"maj7\"\n                   and ((dominant and (plainFifth or root == bass))\n                        or (plainFifth and (token == \"#11\"\n                                            or (triad and token ~= \"b13\"))))\n\n    --[[  A flattened sixth is a b13 only when a seventh is under it. Without\n        one it is an added flat sixth, exactly as a natural sixth is a 6 rather\n        than a 13 - \"C#(add b6) means a C# major triad with the b6 added\"\n        (Hutchinson, Music Theory for the 21st-Century Classroom, 31.1-31.2).\n        Only the printed name changes: the cost still reads it as a b13, which\n        is what keeps E G B C reading Cmaj7/E rather than Emin wearing one. ]]\n    --[[  Both sevenths at once is a semitone cluster rather than a colour, and\n        it turns up in real music as a passing note against a seventh chord -\n        G B D F with an F# over it, 83 voicings across the Beethoven quartets\n        and the Chopin mazurkas. Bracket it, or the two seventh names run\n        together into \"G7maj7\", which is not a symbol anybody could read. ]]\n    local shown = (token == \"b13\" and seventh == \"none\") and \"b6\"\n                  or (token == \"maj7\" and \"(maj7)\") or token\n    cost = cost + (athome and COST_ALTERED or COST_CLASHING)\n    name = name .. ((name == \"\" and seventh == \"none\") and \"add\" or \"\") .. shown\n  end\n\n  if (third == \"sus4\" or third == \"sus2\") and not asEleventh then\n    local carried = #altered\n    for _, degree in ipairs({9, 11, 13}) do\n      if naturals[degree] then carried = carried + 1 end\n    end\n    if sixth then carried = carried + 1 end\n    cost = cost + carried * COST_SUS_EXTRA\n  end\n\n  --[[  A missing third is the one omission that has to be said out loud, and\n      it is said last, so the symbol reads as a chord with a note taken out of\n      it: maj7b5(no3), not maj7(no3)b5. A bare fifth with nothing above it is\n      the one chord that is only its root and fifth. ]]\n  if third == \"none\" then name = (name == \"\" and \"5\" or name .. \"(no3)\") end\n\n  if root ~= bass then cost = cost + COST_INVERSION end\n  -- Two readings can cost the same - Emin6 and C#min7b5 are the same four\n  -- notes - so the commoner quality settles it rather than the loop order.\n  return name, cost, rank\nend\n\n--[[  With both fifths sounding and no perfect one between them, neither is\n    obviously the fifth, so both readings are costed and the cheaper wins.\n    Everywhere else there is nothing to choose and the second reading is not\n    even built. ]]\nlocal function analyse(has, root, bass)\n  local name, cost, rank = analyseAs(has, root, bass, false)\n  if has[6] and has[8] and not has[7] then\n    local altName, altCost, altRank = analyseAs(has, root, bass, true)\n    if altCost < cost then return altName, altCost, altRank end\n  end\n  return name, cost, rank\nend\n\n------------------------------------------------------------------------------\n-- End of the copy. What follows is ScaleView Pro's `detectChord`, with the\n-- one change a port needs: it read the notes held and the key selected from\n-- the script's globals, and here both are passed in. With no key it assumes\n-- C major, as ScaleView does, and for the same reason: it is what the names\n-- fall back to anyway.\n------------------------------------------------------------------------------\n\nlocal ASSUMED = M.key(1, M.MAJOR)\n\n-- A chord root is named from the eighteen spellings ROOTS offers, the roots\n-- real keys are built on; anything else falls back to a plain name leaning\n-- the way the key does, so no chord symbol carries a double accidental.\nlocal CHORD_ROOT_NAMES = {}\nfor _, root in ipairs(M.ROOTS) do CHORD_ROOT_NAMES[root.name] = true end\n\nlocal function chordNoteName(key, pc)\n  local name = key.names[pc]\n  if CHORD_ROOT_NAMES[name] then return name end\n  return (key.flats and M.FLAT_NAMES or M.SHARP_NAMES)[pc + 1]\nend\nM.chordNoteName = function(key, pc) return chordNoteName(key or ASSUMED, pc % 12) end\n\n-- A doubled first, third or fifth degree of the key claims the bass: E G C C\n-- is C, not C/E. It can only remove a slash, never invent one.\nlocal function readAsRootPosition(key, root, bass, voices)\n  if root == bass then return true end\n  if (voices[root] or 0) < 2 then return false end\n  return root == key.degreePc[0] or root == key.degreePc[2] or root == key.degreePc[4]\nend\n\n--[[  pitches: a list of MIDI note numbers sounding together. Returns the\n      symbol, the root's pitch class and the bass's pitch class. Where the\n      notes are an interval rather than a chord, the symbol reads them out and\n      the root is nil. ]]\nfunction M.nameChord(pitches, key)\n  key = key or ASSUMED\n  local classes, bassNote, voices = {}, nil, {}\n  for _, p in ipairs(pitches) do\n    local pc = p % 12\n    classes[pc] = true\n    voices[pc] = (voices[pc] or 0) + 1\n    if not bassNote or p < bassNote then bassNote = p end\n  end\n  if not bassNote then return nil end\n  local bass = bassNote % 12\n\n  local count = 0\n  for _ in pairs(classes) do count = count + 1 end\n  if count == 1 then return chordNoteName(key, bass), bass, bass end\n\n  local function spellOut()\n    local spelled = {}\n    for pc = 0, 11 do\n      if classes[pc] then spelled[#spelled + 1] = chordNoteName(key, pc) end\n    end\n    return table.concat(spelled, \" \")\n  end\n\n  local function slashed(root, name)\n    if not readAsRootPosition(key, root, bass, voices) then\n      name = name .. \"/\" .. chordNoteName(key, bass)\n    end\n    return name\n  end\n\n  -- Two notes are an interval, except a bare fifth and a third.\n  if count == 2 then\n    for root = 0, 11 do\n      if classes[root] and classes[(root + 7) % 12] then\n        return slashed(root, chordNoteName(key, root) .. \"5\"), root, bass\n      end\n    end\n    for root = 0, 11 do\n      if classes[root] then\n        local quality = (classes[(root + 4) % 12] and \"maj\")\n                     or (classes[(root + 3) % 12] and \"min\")\n        if quality then\n          return slashed(root, chordNoteName(key, root) .. quality .. \"(no5)\"), root, bass\n        end\n      end\n    end\n    return spellOut(), nil, bass\n  end\n\n  -- Past a certain thickness there is no chord left to find, only a cluster.\n  if count > 7 then return spellOut(), nil, bass end\n\n  local best\n  for root = 0, 11 do\n    if classes[root] then\n      local has = {}\n      for pc = 0, 11 do\n        if classes[pc] then has[(pc - root) % 12] = true end\n      end\n      local name, cost, rank = analyse(has, root, bass)\n      local fit = key.pcs[root] and 100 or 0\n      for pc = 0, 11 do\n        if classes[pc] and key.pcs[pc] then fit = fit + 1 end\n      end\n      --[[  After the key, a draw goes to the reading that needs no slash, and\n          only then to the commoner quality. C D G Bb over C cost the same as\n          C7sus2 and as Gmin add11 over C, and the minor triad's rank won it:\n          a slash nobody needed, chosen by a tiebreak. ]]\n      local slash = root ~= bass\n      if not best or cost < best.cost\n         or (cost == best.cost and fit > best.fit)\n         or (cost == best.cost and fit == best.fit and best.slash and not slash)\n         or (cost == best.cost and fit == best.fit and slash == best.slash\n             and rank < best.rank) then\n        best = { root = root, name = name, cost = cost, rank = rank, fit = fit,\n                 slash = slash }\n      end\n    end\n  end\n\n  return slashed(best.root, chordNoteName(key, best.root) .. best.name), best.root, bass\nend\n\n------------------------------------------------------------------------------\n-- Roman numerals\n--\n-- A numeral says where a chord sits in the key, which is the thing a symbol\n-- cannot: C G Amin F and G D Emin C are the same progression, I V vi IV.\n-- Upper case for a major third, lower case for a minor one, the way every\n-- harmony textbook writes them.\n------------------------------------------------------------------------------\n\nlocal NUMERALS = { \"I\", \"II\", \"III\", \"IV\", \"V\", \"VI\", \"VII\" }\n\n-- The quality of a chord from its intervals above the root (a set), as the\n-- two things a numeral shows: its third and fifth, and its seventh.\nfunction M.quality(has)\n  local third = has[4] and \"maj\" or (has[3] and \"min\") or \"none\"\n  local fifth = has[7] and \"P\" or (has[6] and \"b\") or (has[8] and \"#\") or \"P\"\n  local triad = (third == \"min\" and fifth == \"b\" and \"dim\")\n             or (third == \"maj\" and fifth == \"#\" and \"aug\")\n             or (third == \"min\" and \"min\") or \"maj\"\n  local seventh = (has[10] and \"b7\") or (has[11] and \"maj7\")\n               or (triad == \"dim\" and has[9] and \"dim7\") or \"none\"\n  return triad, seventh\nend\n\n--[[  The numeral for a chord on rootPc with the given interval set.\n\n      A root in the key takes its degree. A root outside it is written as the\n      nearest degree flattened - bVII, bVI, bIII are the chords borrowed from\n      the parallel minor, and that is how they are always written - except a\n      root a semitone under the tonic, which is the raised seventh, #vii. ]]\nfunction M.numeral(key, rootPc, has)\n  rootPc = rootPc % 12\n  local triad, seventh = M.quality(has)\n  local base\n  local d = key.degree[rootPc]\n  if d then\n    base = NUMERALS[d + 1]\n  elseif (rootPc + 1) % 12 == key.tonic then\n    base = \"#\" .. NUMERALS[7]\n  else\n    local up = key.degree[(rootPc + 1) % 12]\n    if up then base = \"b\" .. NUMERALS[up + 1]\n    else base = \"#\" .. NUMERALS[(key.degree[(rootPc - 1) % 12] or 0) + 1] end\n  end\n  if triad == \"min\" or triad == \"dim\" then base = base:lower() end\n  local mark = (triad == \"dim\" and (seventh == \"b7\" and \"\u00c3\u00b87\" or \"\u00c2\u00b0\"))\n            or (triad == \"aug\" and \"+\") or \"\"\n  if triad == \"dim\" and seventh == \"dim7\" then mark = \"\u00c2\u00b07\" end\n  local sev = \"\"\n  if triad ~= \"dim\" then\n    sev = (seventh == \"b7\" and \"7\") or (seventh == \"maj7\" and \"maj7\") or \"\"\n  end\n  return base .. mark .. sev\nend\n\nreturn M\n", "midi-variator/mv_vary.lua": "--[[ Midi Variator - making a variation of some music.\n\n     Pure Lua: no reaper., no ImGui. The notes arrive as plain tables, in\n     quarter notes counted from the bar line at or before the item:\n\n       { pitch = 60, start = 0.0, len = 1.0, vel = 100, chan = 0 }\n\n     with the source around them:\n\n       { notes, lead, beats, barBeats, pulse }\n\n     `lead` is where the item starts (0 when it starts on a bar line) and\n     `beats` where it ends, both in the same quarter notes, so the engine's\n     bars and beats are the project's.\n\n     The one rule everything here keeps: A VARIATION IS ALWAYS MADE FROM THE\n     ORIGINAL. `vary` takes the original and a seed and nothing else, so the\n     twentieth variation is exactly as close to the original as the first -\n     nothing accumulates. That is the Nordic Noir way with a motif: it keeps\n     coming back, a little different each time, never wandering off.\n\n     How small is small:\n\n       - A handful of changes to the notes themselves (`budget`), at most one\n         to any one moment of the music, and never more than 30% of it.\n       - Each of those is one musical move a player might make: a note nudged\n         a step within the key, a note repeated or tied, a beat anticipated,\n         a passing note or a grace note added, a note left out, a chord\n         revoiced, rolled or coloured.\n       - Then, lightly, over everything: timing, velocity and length, the way\n         nobody plays a phrase twice exactly alike.\n]]\n\nlocal M = {}\n\n------------------------------------------------------------------------------\n-- Settings the engine is tuned with. Every musical judgement is here.\n------------------------------------------------------------------------------\n\n-- Notes struck within this many quarter notes of each other are one moment:\n-- a chord. A 64th - tight enough that a fast run is not read as a chord.\nM.ONSET = 0.07\n\n-- The finest grid a rhythm is read on, coarsest first. The first one that at\n-- least GRID_SHARE of the notes start on is the music's grid.\nM.GRIDS = { 1, 0.5, 1 / 3, 0.25, 1 / 6, 0.125 }\nM.GRID_SHARE = 0.9\n\n-- Rhythm changes move by the grid, but never by more than an eighth: a tune\n-- in plain quarter notes is varied with eighths, not with whole beats.\nM.MAX_UNIT = 0.5\n\n-- How many changes a variation gets, at full amount: one, plus one for every\n-- CHANGES_PER notes. Never more than CAP_SHARE of the notes.\nM.CHANGES_PER = 8\nM.CAP_SHARE = 0.3\n\n-- Feel, at full amount. Timing is a spread in quarter notes (0.012 is about\n-- 6ms at 120bpm; TIMING_MAX about 15ms). Velocity is in MIDI steps. Length\n-- is a share of the note.\nM.TIMING_SD, M.TIMING_MAX, M.TIMING_CHORD = 0.012, 0.03, 0.004\nM.VEL_JITTER, M.VEL_SWELL, M.VEL_WHOLE = 5, 7, 3\nM.LEN_WHOLE, M.LEN_NOTE = 0.08, 0.08\n\n-- The furthest a \"step\" may go, in semitones. In a seven-note scale a step\n-- is one or two; in a pentatonic or blues scale up to three; with only the\n-- original's own notes to use, a three-note motif could otherwise \"step\" a\n-- fifth. A major third is the most that still sounds like a neighbour.\nM.MAX_STEP = 4\n\n-- The shortest note anything leaves behind, in quarter notes.\nM.MIN_LEN = 0.03\n\n-- The channel General MIDI keeps for drums (0-based). Drum notes are sounds,\n-- not pitches, so nothing moves their pitch.\nM.DRUM_CHANNEL = 9\n\n-- What can change, as the window names them, and the moves each allows.\n-- `w` is how often a move is tried against the others in its kind.\nM.KINDS = {\n  { key = \"notes\",   name = \"Notes\",           moves = { { \"neighbour\", 4 }, { \"octave\", 0.7 } } },\n  { key = \"rhythm\",  name = \"Rhythm\",          moves = { { \"split\", 1.5 }, { \"shift\", 1.5 }, { \"join\", 1 } } },\n  { key = \"add\",     name = \"Add Notes\",       moves = { { \"passing\", 2 }, { \"grace\", 1 }, { \"pickup\", 1 }, { \"fill\", 2 }, { \"ghost\", 2 } } },\n  { key = \"remove\",  name = \"Leave Notes Out\", moves = { { \"drop\", 2 }, { \"thin\", 2 } } },\n  { key = \"chords\",  name = \"Chord Voicing\",   moves = { { \"revoice\", 2 }, { \"roll\", 1 } } },\n  { key = \"quality\", name = \"Chord Quality\",   moves = { { \"quality\", 4 }, { \"colour\", 1 }, { \"arpeggio\", 4 } } },\n}\nM.FEELS = {\n  { key = \"timing\",   name = \"Timing\" },\n  { key = \"velocity\", name = \"Velocity\" },\n  { key = \"lengths\",  name = \"Lengths\" },\n}\nM.FOCUS = { \"Anywhere\", \"Towards the End\", \"Towards the Start\" }\n\n-- The options a caller starts from. Every kind and feel is on.\nfunction M.defaults()\n  -- outside: chord-quality changes may use notes outside the scale.\n  -- develop: near 100%, a stretch of the music may be developed (below).\n  local o = { amount = 0.35, focus = 1, keepEnds = true, grow = false, outside = false, develop = true }\n  for _, k in ipairs(M.KINDS) do o[k.key] = true end\n  for _, f in ipairs(M.FEELS) do o[f.key] = true end\n  return o\nend\n\n------------------------------------------------------------------------------\n-- Randomness\n--\n-- A fixed generator (Park and Miller's), so a seed always gives the same\n-- variation: the preview in the window is exactly what gets made.\n------------------------------------------------------------------------------\n\nfunction M.random(seed)\n  local s = math.floor(math.abs(seed or 1)) % 2147483646 + 1\n  return function()\n    s = s * 48271 % 2147483647\n    return (s - 1) / 2147483646\n  end\nend\n\n-- A seed for the i-th variation of the j-th item in a batch.\nfunction M.seedFor(base, i, j)\n  return (math.floor(base) + (i or 0) * 7919 + (j or 0) * 104729) % 2147483646\nend\n\nlocal function between(r, lo, hi) return lo + (hi - lo) * r() end\nlocal function coin(r, p) return r() < (p or 0.5) end\n-- Roughly bell-shaped, -1.5..1.5, standard deviation 0.5 - three uniforms.\nlocal function bell(r) return r() + r() + r() - 1.5 end\n\n-- One of `items`, chosen in proportion to `weights`.\nlocal function choose(r, items, weights)\n  local total = 0\n  for i = 1, #items do total = total + (weights and weights[i] or 1) end\n  if total <= 0 then return nil end\n  local x = r() * total\n  for i = 1, #items do\n    x = x - (weights and weights[i] or 1)\n    if x < 0 then return items[i], i end\n  end\n  return items[#items], #items\nend\n\n------------------------------------------------------------------------------\n-- Reading the original\n------------------------------------------------------------------------------\n\nlocal function byStart(a, b)\n  if math.abs(a.start - b.start) > 1e-9 then return a.start < b.start end\n  if a.pitch ~= b.pitch then return a.pitch < b.pitch end\n  return (a.chan or 0) < (b.chan or 0)\nend\n\nlocal function noteEnd(n) return n.start + n.len end\n\nlocal function copyNote(n)\n  -- `part`: which item of several varied together (M.combine) it is from.\n  return { pitch = n.pitch, start = n.start, len = n.len, vel = n.vel or 100, chan = n.chan or 0, part = n.part }\nend\n\nfunction M.copyNotes(notes)\n  local out = {}\n  for i, n in ipairs(notes) do out[i] = copyNote(n) end\n  table.sort(out, byStart)\n  return out\nend\n\nlocal function isDrum(n) return (n.chan or 0) == M.DRUM_CHANNEL end\n\n-- The grid the rhythm sits on: the coarsest that nearly every note starts on.\nfunction M.grid(notes)\n  if #notes == 0 then return 0.25 end\n  for _, g in ipairs(M.GRIDS) do\n    local on = 0\n    for _, n in ipairs(notes) do\n      local off = n.start / g - math.floor(n.start / g + 0.5)\n      if math.abs(off * g) < 0.02 then on = on + 1 end\n    end\n    if on >= M.GRID_SHARE * #notes then return g end\n  end\n  return M.GRIDS[#M.GRIDS]\nend\n\n-- How strong a moment is: 3 on the bar line, 2 on a counted beat, 1 halfway\n-- between beats, 0 anywhere else.\nfunction M.strength(t, barBeats, pulse)\n  local function on(unit)\n    local x = t / unit\n    return math.abs(x - math.floor(x + 0.5)) * unit < 0.02\n  end\n  if on(barBeats) then return 3 end\n  if on(pulse) then return 2 end\n  if on(pulse / 2) then return 1 end\n  return 0\nend\n\n--[[  Which notes a changed note may land on.\n\n      Not simply \"the key\": the key finder is tuned on tunes that end at\n      home, and a piece that ends on a half cadence (A minor ending on E\n      major) reads as E minor, whose F# is nowhere in the music. What a\n      variation needs is the seven notes the music is actually made of, so\n      the scale is the seven-note set that covers the most of the music's\n      time, and the key finder only breaks ties between sets that cover it\n      equally (D minor's notes D E F G A fit F major's set and C major's; the\n      key finder says which).\n\n      scale: the seven pitch classes, for chord colours, which must be diatonic.\n      pcs:   those plus every note the original plays, for melody steps, so a\n             tune's raised seventh or blue note stays available.\n      key:   for spelling note names. ]]\nlocal function scaleOf(notes, T, first, last)\n  local pcs, pitched, weight = {}, {}, {}\n  for _, n in ipairs(notes) do\n    if not isDrum(n) then\n      pitched[#pitched + 1] = n\n      pcs[n.pitch % 12] = true\n      weight[n.pitch % 12] = (weight[n.pitch % 12] or 0) + math.max(n.len, 0.25)\n    end\n  end\n  if not T or #pitched == 0 then return pcs, pcs, nil end\n\n  local best, bestCover\n  for _, cand in ipairs(T.detectKey(pitched, first, last)) do\n    local k = T.key(cand.root, cand.scale)\n    local cover = 0\n    for pc, w in pairs(weight) do if k.pcs[pc] then cover = cover + w end end\n    if not bestCover or cover > bestCover + 1e-9 then best, bestCover = k, cover end\n  end\n  local scale = {}\n  for pc in pairs(best.pcs) do scale[pc] = true; pcs[pc] = true end\n  return scale, pcs, best\nend\n\n--[[  Everything the moves need to know about the original, worked out once.\n\n      events: the moments something is struck, in order, each\n              { start, notes (low to high), top, bass, strength, pos }\n      pcs:    the pitch classes a changed note may land on\n      key:    how note names are spelled: the key heard (nil for drums)\n      unit:   the step rhythm changes move by\n      lo, hi: the range of the pitched notes\n      heardKey: the key it seems to be in, whatever is picked (nil for drums)\n      played: the pitch classes the original plays\n\n      `pick`, if given, replaces what was heard - see `prepare`. Then\n      `key` spells note names in the picked scale and `picked` is it. ]]\nfunction M.analyse(src, T, pick)\n  local notes = M.copyNotes(src.notes)\n  local an = { events = {}, lo = 127, hi = 0, count = #notes }\n  for _, n in ipairs(notes) do\n    local last = an.events[#an.events]\n    if last and n.start - last.start <= M.ONSET then\n      last.notes[#last.notes + 1] = n\n    else\n      an.events[#an.events + 1] = { start = n.start, notes = { n } }\n    end\n    if not isDrum(n) then an.lo, an.hi = math.min(an.lo, n.pitch), math.max(an.hi, n.pitch) end\n  end\n\n  local span = math.max((src.beats or 0) - (src.lead or 0), 1e-9)\n  for i, e in ipairs(an.events) do\n    table.sort(e.notes, function(a, b) return a.pitch < b.pitch end)\n    e.index = i\n    e.top, e.bass = e.notes[#e.notes], e.notes[1]\n    e.strength = M.strength(e.start, src.barBeats or 4, src.pulse or 1)\n    e.pos = math.max(0, math.min(1, (e.start - (src.lead or 0)) / span))\n    e.drum = isDrum(e.top)\n  end\n\n  local first = an.events[1]\n  local last = an.events[#an.events]\n  an.scale, an.pcs, an.key = scaleOf(notes, T,\n    first and first.top.pitch % 12, last and last.bass.pitch % 12)\n  an.heardKey = an.key          -- what it heard, whatever is picked below\n\n  -- What the window asked for instead of what was heard (see `prepare`).\n  local played = {}\n  for _, n in ipairs(notes) do if not isDrum(n) then played[n.pitch % 12] = true end end\n  an.played = played\n  if pick and pick.own then\n    an.scale, an.pcs = played, played\n  elseif pick and pick.root and T then\n    local sc = M.pickedScale(T, pick.root, pick.scale)\n    an.scale, an.key, an.picked = sc.pcs, sc, sc\n    -- Chords are named by mv_theory's reader, which needs one of its own\n    -- keys: the picked one where it has it (C minor names Eb, not D#).\n    local seven = T.scaleIndex(M.SCALES[pick.scale].name)\n    if seven then an.chordKey = T.key(pick.root, seven) end\n    -- The original's own notes stay allowed. After a pivot they are all\n    -- in the scale anyway; without one, they are what it still plays.\n    an.pcs = {}\n    for pc in pairs(sc.pcs) do an.pcs[pc] = true end\n    for pc in pairs(played) do an.pcs[pc] = true end\n  end\n\n  an.chordKey = an.chordKey or an.heardKey\n  an.grid = M.grid(notes)\n  an.unit = math.min(an.grid, M.MAX_UNIT)\n  an.drums = an.hi < an.lo\n  an.broken = M.brokenChords(an, src, T)\n  return an\nend\n\n--[[  Arpeggiated chords: a bar - or half a bar, where its halves are two\n      different chords - whose notes, struck one at a time, spell a chord.\n      Every moment a single note; at least ARP_NOTES of them on at least\n      three different notes, one of which comes round again (an\n      accompaniment goes round its chord; a tune like D F A G does not);\n      at least half as many leaps as steps between one note and the next\n      (B G F G is an arpeggio, a scale is not); at most one pair of its\n      notes a step apart; and ScaleView Pro's reader must find a chord.\n      Returns { { t0, t1, events = { index, ... } } }. ]]\nM.ARP_NOTES = 4\n\nfunction M.brokenChords(an, src, T)\n  local out = {}\n  if not T or an.drums then return out end\n  local function window(t0, t1)\n    local evs, pitches, pcs, k = {}, {}, {}, 0\n    local leaps, steps = 0, 0\n    for _, e in ipairs(an.events) do\n      if e.start >= t0 - 1e-6 and e.start < t1 - 1e-6 then\n        if #e.notes ~= 1 or e.drum then return nil end\n        evs[#evs + 1] = e.index\n        local p = e.notes[1].pitch\n        if #pitches > 0 then\n          local d = math.abs(p - pitches[#pitches])\n          if d == 1 or d == 2 then steps = steps + 1 elseif d >= 3 then leaps = leaps + 1 end\n        end\n        pitches[#pitches + 1] = p\n        if not pcs[p % 12] then pcs[p % 12], k = true, k + 1 end\n      end\n    end\n    if #evs < M.ARP_NOTES or k < 3 or #evs <= k or leaps * 2 < steps or leaps == 0 then return nil end\n    -- A chord spelled out has at most one pair of its notes a step apart\n    -- (the seventh and root of Amin7: G A). E G A B is a tune round Em.\n    local near = 0\n    for a in pairs(pcs) do\n      for b in pairs(pcs) do\n        local d = (b - a) % 12\n        if d == 1 or d == 2 then near = near + 1 end\n      end\n    end\n    if near > 1 then return nil end\n    local name, root = T.nameChord(pitches, an.chordKey)\n    if not root then return nil end\n    return { t0 = t0, t1 = t1, events = evs, name = name }\n  end\n  local bb = src.barBeats or 4\n  local first, last = an.events[1], an.events[#an.events]\n  if not first then return out end\n  for b = math.floor(first.start / bb + 1e-6), math.floor(last.start / bb + 1e-6) do\n    local h1 = window(b * bb, b * bb + bb / 2)\n    local h2 = window(b * bb + bb / 2, (b + 1) * bb)\n    if h1 and h2 and h1.name ~= h2.name then\n      out[#out + 1], out[#out + 2] = h1, h2\n    else\n      local w = window(b * bb, (b + 1) * bb)\n      if w then out[#out + 1] = w\n      else\n        if h1 then out[#out + 1] = h1 end\n        if h2 then out[#out + 1] = h2 end\n      end\n    end\n  end\n  return out\nend\n\n------------------------------------------------------------------------------\n-- Picking a scale\n--\n-- The scales are ScaleView for REAPER's, its SCALES table copied UNCHANGED\n-- from reascripts/ScaleView Pro.lua at commit e31a6e8, so the tools agree\n-- on what a scale is and how its notes are spelled. A change belongs in\n-- ScaleView first. Roots are mv_theory's (ScaleView's eighteen, spelled).\n------------------------------------------------------------------------------\n\nlocal SCALES = {\n  {name = \"Major\",            intervals = {0, 2, 4, 5, 7, 9, 11},\n                              letters   = {0, 1, 2, 3, 4, 5,  6}},\n  {name = \"Minor (Natural)\",  intervals = {0, 2, 3, 5, 7, 8, 10},\n                              letters   = {0, 1, 2, 3, 4, 5,  6}},\n  {name = \"Harmonic Minor\",   intervals = {0, 2, 3, 5, 7, 8, 11},\n                              letters   = {0, 1, 2, 3, 4, 5,  6}},\n  {name = \"Ionian\",           intervals = {0, 2, 4, 5, 7, 9, 11},\n                              letters   = {0, 1, 2, 3, 4, 5,  6}},\n  {name = \"Dorian\",           intervals = {0, 2, 3, 5, 7, 9, 10},\n                              letters   = {0, 1, 2, 3, 4, 5,  6}},\n  {name = \"Phrygian\",         intervals = {0, 1, 3, 5, 7, 8, 10},\n                              letters   = {0, 1, 2, 3, 4, 5,  6}},\n  {name = \"Lydian\",           intervals = {0, 2, 4, 6, 7, 9, 11},\n                              letters   = {0, 1, 2, 3, 4, 5,  6}},\n  {name = \"Mixolydian\",       intervals = {0, 2, 4, 5, 7, 9, 10},\n                              letters   = {0, 1, 2, 3, 4, 5,  6}},\n  {name = \"Aeolian\",          intervals = {0, 2, 3, 5, 7, 8, 10},\n                              letters   = {0, 1, 2, 3, 4, 5,  6}},\n  {name = \"Major Pentatonic\", intervals = {0, 2, 4, 7, 9},\n                              letters   = {0, 1, 2, 4, 5}},\n  {name = \"Minor Pentatonic\", intervals = {0, 3, 5, 7, 10},\n                              letters   = {0, 2, 3, 4,  6}},\n  {name = \"Major Blues\",      intervals = {0, 2, 3, 4, 7, 9},\n                              letters   = {0, 1, 2, 2, 4, 5}},\n  {name = \"Minor Blues\",      intervals = {0, 3, 5, 6, 7, 10},\n                              letters   = {0, 2, 3, 4, 4,  6}},\n  {name = \"Whole Tone\",       intervals = {0, 2, 4, 6, 8, 10},\n                              letters   = {0, 1, 2, 3, 4,  5}},\n  {name = \"Diminished Whole-Half\", intervals = {0, 2, 3, 5, 6, 8, 9, 11},\n                                   letters   = {0, 1, 2, 3, 4, 5, 5,  6}},\n  {name = \"Diminished Half-Whole\", intervals = {0, 1, 3, 4, 6, 7, 9, 10},\n                                   letters   = {0, 1, 2, 2, 3, 4, 5,  6}},\n}\nM.SCALES = SCALES\n\nfunction M.scaleIndex(name)\n  for i, sc in ipairs(SCALES) do if sc.name == name then return i end end\nend\n\nlocal LETTER_PC = { 0, 2, 4, 5, 7, 9, 11 }\nlocal LETTERS   = { \"C\", \"D\", \"E\", \"F\", \"G\", \"A\", \"B\" }\nlocal ACCIDENT  = { [-2] = \"bb\", [-1] = \"b\", [0] = \"\", [1] = \"#\", [2] = \"x\" }\n\n--[[  A scale picked in the window: `root` indexes mv_theory's ROOTS and\n      `scale` indexes SCALES. Shaped like an mv_theory key - pcs[pc],\n      names[pc], label - so note names are spelled by it: C minor's third\n      is Eb, not D#. Notes outside it lean whichever way the scale does. ]]\nfunction M.pickedScale(T, rootIdx, scaleIdx)\n  local root, sc = T.ROOTS[rootIdx], SCALES[scaleIdx]\n  local tonic = T.rootPc(root)\n  local s = { root = rootIdx, scale = scaleIdx, tonic = tonic, pcs = {}, names = {},\n              label = root.name .. \" \" .. sc.name }\n  local sharps, flats = 0, 0\n  for i, iv in ipairs(sc.intervals) do\n    local pc = (tonic + iv) % 12\n    local letter = (root.letter + sc.letters[i]) % 7\n    local offset = ((pc - LETTER_PC[letter + 1] + 6) % 12) - 6\n    s.pcs[pc] = true\n    if ACCIDENT[offset] then\n      s.names[pc] = LETTERS[letter + 1] .. ACCIDENT[offset]\n      if offset > 0 then sharps = sharps + 1 elseif offset < 0 then flats = flats + 1 end\n    end\n  end\n  local outside = flats > sharps and T.FLAT_NAMES or T.SHARP_NAMES\n  for pc = 0, 11 do s.names[pc] = s.names[pc] or outside[pc + 1] end\n  return s\nend\n\n--[[  The original brought into a picked scale - the pivot. Each note outside\n      it moves to the nearest note inside it; when two are equally near, to\n      the one on the same letter, so C major into C minor makes E into Eb\n      (the third stays a third) rather than F. Drums are left alone. Two\n      notes landing on one pitch at once become one.\n\n      `from` spells the original (the key it was heard in). Returns the\n      notes and what moved: { { from = pc, to = pc, count }, ... }. ]]\nfunction M.fit(notes, scale, from)\n  local out, moved = {}, {}\n  for _, n in ipairs(notes) do\n    local c = copyNote(n)\n    local pc = n.pitch % 12\n    if not isDrum(n) and not scale.pcs[pc] then\n      local up, down\n      for d = 1, 11 do\n        if not up and scale.pcs[(pc + d) % 12] then up = d end\n        if not down and scale.pcs[(pc - d) % 12] then down = d end\n      end\n      local d\n      if up and down and up == down then\n        local letter = from and from.names[pc] and from.names[pc]:sub(1, 1)\n        d = (letter and scale.names[(pc + up) % 12]:sub(1, 1) == letter) and up or -down\n      elseif up and (not down or up < down) then d = up\n      elseif down then d = -down end\n      if d and n.pitch + d >= 0 and n.pitch + d <= 127 then\n        c.pitch, c.fitted = n.pitch + d, true\n        moved[pc] = moved[pc] or { from = pc, to = (pc + d) % 12, count = 0 }\n        moved[pc].count = moved[pc].count + 1\n      end\n    end\n    out[#out + 1] = c\n  end\n\n  table.sort(out, byStart)\n  local last, keep = {}, {}\n  for _, n in ipairs(out) do\n    local k = (n.part or 0) * 2048 + n.chan * 128 + n.pitch\n    local p = last[k]\n    if p and (p.fitted or n.fitted) and noteEnd(p) > n.start + 1e-9 then\n      if math.abs(p.start - n.start) < 1e-9 then\n        p.len = math.max(p.len, n.len)   -- one note where two landed\n        n.dead = true\n      else\n        p.len = n.start - p.start\n        if p.len < M.MIN_LEN then p.dead = true end\n      end\n    end\n    if not n.dead then last[k] = n end\n  end\n  for _, n in ipairs(out) do\n    if not n.dead then\n      keep[#keep + 1] = { pitch = n.pitch, start = n.start, len = n.len, vel = n.vel, chan = n.chan, part = n.part }\n    end\n  end\n  local list = {}\n  for _, m in pairs(moved) do list[#list + 1] = m end\n  table.sort(list, function(a, b) return a.from < b.from end)\n  return keep, list\nend\n\n-- \"E -> Eb, A -> Ab\": what fitting moved, in the two keys' own spellings.\nfunction M.describeFit(moved, from, scale)\n  local parts = {}\n  for _, m in ipairs(moved) do\n    local a = from and from.names[m.from] or tostring(m.from)\n    parts[#parts + 1] = a .. \" \u00e2\u0086\u0092 \" .. scale.names[m.to]\n  end\n  return table.concat(parts, \", \")\nend\n\n--[[  The source a batch of variations is made from, and its analysis.\n\n      pick = nil            the scale is heard from the notes (decision 0004)\n      pick = { own = true } changes use only the notes the original plays\n      pick = { root, scale, fit }\n                            a scale chosen in the window. With `fit`, the\n                            original is first brought into it (`fit`), so\n                            the variations pivot to the new scale; without,\n                            the original's own notes stay and only the\n                            changes use the new scale.\n\n      The source returned is a copy with the fitted notes; everything else\n      - the item, and the TRUE original kept inside variations - is the\n      source's own. The analysis carries `fitted` (what moved) and the key\n      the original was heard in. ]]\nfunction M.prepare(src, T, pick)\n  if not (pick and pick.root and pick.fit and T) then\n    local an = M.analyse(src, T, pick)\n    an.fitted = {}\n    return src, an\n  end\n  local heard = M.analyse(src, T)\n  local sc = M.pickedScale(T, pick.root, pick.scale)\n  local notes, moved = M.fit(src.notes, sc, heard.heardKey)\n  local out = {}\n  for k, x in pairs(src) do out[k] = x end\n  out.notes = notes\n  local an = M.analyse(out, T, pick)\n  an.fitted, an.heardKey, an.played = moved, heard.heardKey, heard.played\n  return out, an\nend\n\n------------------------------------------------------------------------------\n-- Naming what changed, for the window\n------------------------------------------------------------------------------\n\n-- General MIDI's names for the drums people actually use.\nM.DRUM_NAMES = {\n  [35] = \"kick\", [36] = \"kick\", [37] = \"side stick\", [38] = \"snare\", [39] = \"clap\",\n  [40] = \"snare\", [41] = \"low tom\", [42] = \"closed hi-hat\", [43] = \"low tom\",\n  [44] = \"pedal hi-hat\", [45] = \"mid tom\", [46] = \"open hi-hat\", [47] = \"mid tom\",\n  [48] = \"high tom\", [49] = \"crash\", [50] = \"high tom\", [51] = \"ride\", [53] = \"ride bell\",\n  [54] = \"tambourine\", [56] = \"cowbell\", [57] = \"crash\", [59] = \"ride\",\n}\n\nfunction M.noteName(an, pitch, T, drum)\n  if drum then return M.DRUM_NAMES[pitch] or (\"drum \" .. pitch) end\n  local name\n  if T and an.key then name = T.noteName(an.key, pitch % 12)\n  elseif T then name = T.SHARP_NAMES[pitch % 12 + 1]\n  else name = tostring(pitch % 12) end\n  return name .. (pitch // 12 - 1)\nend\n\nfunction M.where(t, barBeats, pulse)\n  local bar = math.floor(t / barBeats + 1e-6)\n  local beat = (t - bar * barBeats) / pulse + 1\n  beat = math.floor(beat * 100 + 0.5) / 100\n  local b = (beat == math.floor(beat)) and (\"%d\"):format(beat) or (\"%g\"):format(beat)\n  return (\"Bar %d, beat %s\"):format(bar + 1, b)\nend\n\n------------------------------------------------------------------------------\n-- The moves\n--\n-- Each move works on `v`, the variation being built:\n--   v.notes     the working notes (copies of the original's)\n--   v.an        the analysis of the original\n--   v.touched   events already changed - one change per moment, at most\n--   v.r         the random generator\n-- and returns a description of what it did, or nil if it found nowhere it\n-- could do it. A move only ever changes the one moment it chose (and, where\n-- it has to, how long the note before it lasts).\n------------------------------------------------------------------------------\n\n-- The next pitch up (dir 1) or down (dir -1) that belongs to the key.\nlocal function step(pcs, p, dir)\n  local q = p + dir\n  for _ = 1, 12 do\n    if q < 0 or q > 127 or math.abs(q - p) > M.MAX_STEP then return nil end\n    if pcs[q % 12] then return q end\n    q = q + dir\n  end\n  return nil\nend\n\n-- A minor second, major seventh or minor ninth: the intervals that grind.\nlocal function harsh(a, b)\n  local d = math.abs(a - b) % 12\n  return d == 1 or d == 11\nend\n\n-- True if `pitch` at [t0, t1) would grind against something else sounding,\n-- where `note` (the one being changed) did not. `near`, if given, is the\n-- notes to look at (all of them, or at least all sounding in [t0, t1)).\n-- (Declared here, used by the moves below.)\nlocal function clashes(v, note, pitch, t0, t1, near)\n  for _, o in ipairs(near or v.notes) do\n    if o ~= note and not o.gone and not isDrum(o)\n       and o.start < t1 - 1e-6 and noteEnd(o) > t0 + 1e-6 then\n      if harsh(pitch, o.pitch) and not (note and harsh(note.pitch, o.pitch)) then return true end\n      if o.pitch == pitch then return true end\n    end\n  end\n  return false\nend\n\nlocal function protected(v, e)\n  return v.opts.keepEnds and (e.index == 1 or e.index == #v.an.events)\nend\n\n-- How much a moment invites change: where it is in the phrase, as the focus\n-- setting asks, times whatever the move itself cares about.\nlocal function focusWeight(v, e)\n  local f = v.opts.focus or 1\n  if f == 2 then return 0.15 + 1.85 * e.pos * e.pos end\n  if f == 3 then return 0.15 + 1.85 * (1 - e.pos) * (1 - e.pos) end\n  return 1\nend\n\n-- The moments a move may use: not already changed, not protected (unless\n-- the move leaves the moment itself alone), passing `test`.\n--\n-- In a series, `v.history` counts what the earlier variations changed, so a\n-- moment already changed is less likely to be picked again and the same move\n-- on the same moment much less likely: twenty variations spread their\n-- changes over the phrase instead of bending the same note twenty times.\n-- Each is still made from the original; the history only steers the dice.\nlocal function candidates(v, test, weight, allowProtected)\n  local list, weights = {}, {}\n  local h = v.history or {}\n  for _, e in ipairs(v.an.events) do\n    if not v.touched[e] and (allowProtected or not protected(v, e)) and test(e) then\n      local w = focusWeight(v, e) * (weight and weight(e) or 1)\n      w = w / (1 + 2 * (h[\"@\" .. e.index] or 0))\n      if h[v.move .. \"@\" .. e.index] then w = w * 0.25 end\n      list[#list + 1] = e\n      weights[#weights + 1] = w\n    end\n  end\n  return list, weights\nend\n\nlocal function pickEvent(v, test, weight, allowProtected)\n  local list, weights = candidates(v, test, weight, allowProtected)\n  if #list == 0 then return nil end\n  v.chosen = choose(v.r, list, weights)\n  return v.chosen\nend\n\nlocal function add(v, n)\n  n.added = true\n  v.notes[#v.notes + 1] = n\n  return n\nend\n\n-- The part of the note nearest `q` in pitch, the bass aside: a note added\n-- to a chord joins the item that plays the chord, not a bass on its own\n-- track (unless the bass is all there is).\nlocal function nearestPart(notes, q)\n  local lowest, best\n  for _, n in ipairs(notes) do if not lowest or n.pitch < lowest.pitch then lowest = n end end\n  for _, n in ipairs(notes) do\n    if n ~= lowest and (not best or math.abs(n.pitch - q) < math.abs(best.pitch - q)) then best = n end\n  end\n  return (best or lowest) and (best or lowest).part\nend\n\nlocal function live(e)\n  local out = {}\n  for _, n in ipairs(e.notes) do if not n.gone then out[#out + 1] = n end end\n  return out\nend\n\nlocal function pitched(e) return not e.drum end\nlocal function isChord(e)\n  local k = 0\n  for _, n in ipairs(e.notes) do if not isDrum(n) then k = k + 1 end end\n  return k >= 3\nend\n-- A note's name - a pitch, or for a drum, the drum. `p` may be a note (its\n-- current pitch) or a bare pitch.\nlocal function nameOf(v, p)\n  if type(p) == \"table\" then return M.noteName(v.an, p.pitch, v.T, isDrum(p)) end\n  return M.noteName(v.an, p, v.T)\nend\nlocal function at(v, t) return M.where(t, v.src.barBeats, v.src.pulse) end\nlocal function nextEvent(v, e) return v.an.events[e.index + 1] end\nlocal function prevEvent(v, e) return v.an.events[e.index - 1] end\n\nlocal MOVES = {}\n\n-- A note moved one step up or down the key. The commonest variation of all:\n-- the same shape, one note bent.\nfunction MOVES.neighbour(v)\n  local e = pickEvent(v, pitched, function(e) return e.strength == 3 and 0.5 or 1 end)\n  if not e then return nil end\n  local n = e.top\n  local dirs = coin(v.r) and { 1, -1 } or { -1, 1 }\n  local below = e.notes[#e.notes - 1]\n  for _, dir in ipairs(dirs) do\n    local q = step(v.an.pcs, n.pitch, dir)\n    if q and (not below or q > below.pitch)\n       and q >= v.an.lo - 2 and q <= v.an.hi + 2\n       and not clashes(v, n, q, n.start, noteEnd(n)) then\n      local was = n.pitch\n      n.pitch = q\n      v.touched[e] = true\n      return (\"%s: %s moved %s to %s\"):format(at(v, e.start), nameOf(v, was),\n                                             dir > 0 and \"up\" or \"down\", nameOf(v, q))\n    end\n  end\n  return nil\nend\n\n-- One note an octave away. Kept inside the range the original already uses,\n-- so it never leaves the register.\nfunction MOVES.octave(v)\n  local e = pickEvent(v, function(e) return pitched(e) and #e.notes == 1 end)\n  if not e then return nil end\n  local n = e.top\n  for _, d in ipairs(coin(v.r) and { 12, -12 } or { -12, 12 }) do\n    local q = n.pitch + d\n    if q >= v.an.lo and q <= v.an.hi and not clashes(v, n, q, n.start, noteEnd(n)) then\n      local was = n.pitch\n      n.pitch = q\n      v.touched[e] = true\n      return (\"%s: %s %s an octave\"):format(at(v, e.start), nameOf(v, was), d > 0 and \"up\" or \"down\")\n    end\n  end\n  return nil\nend\n\n-- A long note (or chord) struck twice instead of held.\nfunction MOVES.split(v)\n  local u = v.an.unit\n  local e = pickEvent(v, function(e)\n    for _, n in ipairs(e.notes) do if n.len < 2 * u - 1e-6 then return false end end\n    return true\n  end)\n  if not e then return nil end\n  local shortest = math.huge\n  for _, n in ipairs(e.notes) do shortest = math.min(shortest, n.len) end\n  local cut = math.max(u, math.floor(shortest / 2 / u + 0.5) * u)\n  if cut > shortest - u + 1e-6 then cut = shortest - u end\n  for _, n in ipairs(live(e)) do\n    local second = copyNote(n)\n    second.start = n.start + cut\n    second.len = noteEnd(n) - second.start\n    second.vel = math.floor(n.vel * 0.88 + 0.5)\n    n.len = cut\n    add(v, second)\n  end\n  v.touched[e] = true\n  if e.drum then return (\"%s: %s hit twice\"):format(at(v, e.start), nameOf(v, e.top)) end\n  if #e.notes > 1 then return (\"%s: chord struck again halfway\"):format(at(v, e.start)) end\n  return (\"%s: %s repeated instead of held\"):format(at(v, e.start), nameOf(v, e.top))\nend\n\n-- A moment moved a step earlier (anticipated - \"pushed\") or later, keeping\n-- where it ends. Whatever was leading into it is shortened or held to meet it.\nfunction MOVES.shift(v)\n  local u = v.an.unit\n  local e = pickEvent(v, function(e) return e.index > 1 end)\n  if not e then return nil end\n  local prev, nxt = prevEvent(v, e), nextEvent(v, e)\n  local dirs = coin(v.r, 0.6) and { -1, 1 } or { 1, -1 }\n  for _, dir in ipairs(dirs) do\n    local ns = e.start + dir * u\n    local ok = ns > prev.start + u * 0.5 - 1e-6\n    for _, n in ipairs(e.notes) do\n      if noteEnd(n) - ns < u * 0.5 then ok = false end\n    end\n    if nxt and ns >= nxt.start - 1e-6 then ok = false end\n    if protected(v, prev) then\n      -- The note before is one of the protected ones: it may not be cut short.\n      for _, n in ipairs(prev.notes) do if noteEnd(n) > ns + 1e-6 then ok = false end end\n    end\n    if ok then\n      local old = e.start\n      -- Notes that ran up to this moment follow it: cut short, or held on.\n      for _, o in ipairs(v.notes) do\n        if not o.gone and o.start < old - 1e-6 then\n          local oe = noteEnd(o)\n          if dir < 0 and oe > ns + 1e-6 and oe <= old + 0.05 then\n            if ns - o.start < M.MIN_LEN * 2 then ok = false end\n          end\n        end\n      end\n      if ok then\n        for _, o in ipairs(v.notes) do\n          if not o.gone and o.start < old - 1e-6 then\n            local oe = noteEnd(o)\n            if dir < 0 and oe > ns + 1e-6 and oe <= old + 0.05 then o.len = ns - o.start\n            elseif dir > 0 and math.abs(oe - old) <= 0.05 then o.len = ns - o.start end\n          end\n        end\n        for _, n in ipairs(e.notes) do\n          local ne = noteEnd(n)\n          n.start = n.start + (ns - old)\n          n.len = ne - n.start\n        end\n        v.touched[e], v.touched[prev] = true, true\n        return (\"%s: %s\"):format(at(v, old), dir < 0 and \"comes in early (anticipated)\"\n                                                      or \"comes in late (held back)\")\n      end\n    end\n  end\n  return nil\nend\n\n-- Two notes of the same pitch, one after the other, tied into one.\nfunction MOVES.join(v)\n  local e = pickEvent(v, function(e)\n    local nx = nextEvent(v, e)\n    return nx and not e.drum and #e.notes == 1 and #nx.notes == 1 and not v.touched[nx]\n       and not protected(v, nx) and nx.top.pitch == e.top.pitch\n       and nx.start - noteEnd(e.top) <= v.an.unit + 1e-6\n  end)\n  if not e then return nil end\n  local nx = nextEvent(v, e)\n  e.top.len = noteEnd(nx.top) - e.top.start\n  nx.top.gone = true\n  v.touched[e], v.touched[nx] = true, true\n  return (\"%s: two %ss tied into one\"):format(at(v, e.start), nameOf(v, e.top.pitch))\nend\n\n-- A passing note: the last part of a note given to the step between it and\n-- the next note, where the tune leaps.\nfunction MOVES.passing(v)\n  local u = v.an.unit\n  local e = pickEvent(v, function(e)\n    local nx = nextEvent(v, e)\n    if not nx or e.drum or nx.drum then return false end\n    local d = math.abs(nx.top.pitch - e.top.pitch)\n    return d >= 3 and d <= 9 and e.top.len >= 2 * u - 1e-6\n       and noteEnd(e.top) >= nx.start - 0.05\n  end)\n  if not e then return nil end\n  local n, nx = e.top, nextEvent(v, e).top\n  local dir = nx.pitch > n.pitch and 1 or -1\n  local q = step(v.an.pcs, n.pitch, dir)\n  if not q or (dir > 0 and q >= nx.pitch) or (dir < 0 and q <= nx.pitch) then return nil end\n  local t = noteEnd(n) - u\n  if clashes(v, n, q, t, noteEnd(n)) then return nil end\n  local p = copyNote(n)\n  p.pitch, p.start, p.len = q, t, u\n  p.vel = math.floor(n.vel * 0.85 + 0.5)\n  n.len = t - n.start\n  add(v, p)\n  v.touched[e] = true\n  return (\"%s: passing note %s added on the way to %s\"):format(at(v, t), nameOf(v, q), nameOf(v, nx.pitch))\nend\n\n-- A grace note: a quick neighbour just before a note, taken from the end of\n-- the note before it.\nfunction MOVES.grace(v)\n  local u = v.an.unit\n  local g = math.min(u / 2, 0.25)\n  local e = pickEvent(v, function(e)\n    if e.index == 1 or e.drum then return false end\n    local pv = prevEvent(v, e)\n    if v.touched[pv] then return false end\n    for _, n in ipairs(pv.notes) do\n      if noteEnd(n) > e.start - g + 1e-6 then\n        if protected(v, pv) or (e.start - g) - n.start < g - 1e-6 then return false end\n      end\n    end\n    return true\n  end, nil, true)\n  if not e then return nil end\n  local n, pv = e.top, prevEvent(v, e)\n  local dirs = coin(v.r, 0.6) and { 1, -1 } or { -1, 1 }\n  for _, dir in ipairs(dirs) do\n    local q = step(v.an.pcs, n.pitch, dir)\n    if q and not clashes(v, nil, q, e.start - g, e.start) then\n      for _, o in ipairs(pv.notes) do\n        if noteEnd(o) > e.start - g then o.len = e.start - g - o.start end\n      end\n      local gn = copyNote(n)\n      gn.pitch, gn.start, gn.len = q, e.start - g, g\n      gn.vel = math.floor(n.vel * 0.8 + 0.5)\n      add(v, gn)\n      v.touched[e], v.touched[pv] = true, true\n      return (\"%s: grace note %s before the %s\"):format(at(v, e.start), nameOf(v, q), nameOf(v, n.pitch))\n    end\n  end\n  return nil\nend\n\n-- A pickup: a short note in a rest, stepping into the note after it.\nfunction MOVES.pickup(v)\n  local u = v.an.unit\n  -- Where the last sound before each moment ends, in one sweep: a long\n  -- piece has thousands of notes, and asking each moment separately made\n  -- this move alone take most of a second.\n  local live, silentFrom = {}, {}\n  for _, o in ipairs(v.notes) do if not o.gone then live[#live + 1] = o end end\n  table.sort(live, function(a, b) return a.start < b.start end)\n  local k, latest = 1, 0\n  for _, e in ipairs(v.an.events) do\n    while live[k] and live[k].start < e.start - 1e-6 do\n      latest = math.max(latest, noteEnd(live[k]))\n      k = k + 1\n    end\n    silentFrom[e] = latest\n  end\n  local e = pickEvent(v, function(e)\n    if e.index == 1 or e.drum then return false end\n    return e.start - silentFrom[e] >= 2 * u - 1e-6\n  end, nil, true)\n  if not e then return nil end\n  local n, pv = e.top, prevEvent(v, e)\n  local from = pv.top.pitch\n  local dir = (n.pitch > from) and -1 or 1       -- approach from the side the tune comes from\n  local q = step(v.an.pcs, n.pitch, dir)\n  if not q or clashes(v, nil, q, e.start - u, e.start) then return nil end\n  local pn = copyNote(n)\n  pn.pitch, pn.start, pn.len = q, e.start - u, u\n  pn.vel = math.floor(n.vel * 0.8 + 0.5)\n  add(v, pn)\n  v.touched[e] = true\n  return (\"%s: pickup note %s leading in\"):format(at(v, pn.start), nameOf(v, q))\nend\n\n-- A ghost note, for drums: a quiet extra hit of one of this moment's drums,\n-- halfway to the next moment - the hi-hat sixteenth or ghosted snare a\n-- drummer drops in without thinking.\nfunction MOVES.ghost(v)\n  local u = v.an.unit\n  local e = pickEvent(v, function(e)\n    local nx = nextEvent(v, e)\n    return e.drum and nx and nx.start - e.start >= u - 1e-6\n  end, nil, true)\n  if not e then return nil end\n  local t = e.start + (nextEvent(v, e).start - e.start) / 2\n  local n = e.notes[1]\n  for _, o in ipairs(e.notes) do if o.vel < n.vel then n = o end end   -- the quietest: hat or snare, not kick\n  local gn = copyNote(n)\n  gn.start, gn.len = t, math.min(n.len, (nextEvent(v, e).start - t))\n  gn.vel = math.max(1, math.floor(n.vel * 0.55 + 0.5))\n  add(v, gn)\n  v.touched[e] = true\n  return (\"%s: ghost %s added\"):format(at(v, t), nameOf(v, n))\nend\n\n-- A chord filled out: one of its own notes doubled in another octave, inside\n-- the chord, so the top and the bass stay where they were.\nfunction MOVES.fill(v)\n  local e = pickEvent(v, function(e) return pitched(e) and #e.notes >= 2 end)\n  if not e then return nil end\n  local have, pcs = {}, {}\n  for _, n in ipairs(e.notes) do have[n.pitch], pcs[n.pitch % 12] = true, true end\n  local options = {}\n  -- Not a note that grinds against anything: a Cmaj7's B doubled low\n  -- against its C bass is mud, where its C, E or G doubled is warmth.\n  local lens = {}\n  for _, n in ipairs(e.notes) do lens[#lens + 1] = n.len end\n  table.sort(lens)\n  local len = lens[(#lens + 1) // 2]\n  for q = e.bass.pitch + 3, e.top.pitch - 3 do\n    if pcs[q % 12] and not have[q] and not clashes(v, nil, q, e.bass.start, e.bass.start + len) then\n      local near = false\n      for _, n in ipairs(e.notes) do if math.abs(n.pitch - q) < 3 then near = true end end\n      if not near then options[#options + 1] = q end\n    end\n  end\n  if #options == 0 then return nil end\n  local q = choose(v.r, options)\n  local vel = 0\n  for _, n in ipairs(e.notes) do vel = vel + n.vel end\n  local fn = copyNote(e.bass)\n  fn.pitch, fn.len = q, len\n  fn.part = nearestPart(e.notes, q)\n  fn.vel = math.floor(vel / #e.notes * 0.85 + 0.5)\n  add(v, fn)\n  v.touched[e] = true\n  return (\"%s: chord filled out with %s\"):format(at(v, e.start), nameOf(v, q))\nend\n\n-- A note left out - the weakest-placed, shortest ones first. Sometimes the\n-- note before is held over the gap instead of leaving a rest.\nfunction MOVES.drop(v)\n  local left = 0\n  for _, n in ipairs(v.notes) do if not n.gone then left = left + 1 end end\n  if left <= 3 then return nil end\n  local u = v.an.unit\n  -- A single note, or one drum out of several struck together.\n  local e = pickEvent(v, function(e) return #e.notes == 1 or e.drum end, function(e)\n    local w = ({ [0] = 1.5, 1.0, 0.6, 0.3 })[e.strength]\n    if e.top.len <= u + 1e-6 then w = w * 1.5 end\n    return w\n  end)\n  if not e then return nil end\n  local n = e.top\n  for _, o in ipairs(e.notes) do if o.vel < n.vel then n = o end end   -- the quietest drum\n  n.gone = true\n  v.touched[e] = true\n  local pv = prevEvent(v, e)\n  local text = (\"%s: %s left out\"):format(at(v, e.start), nameOf(v, n))\n  if #e.notes == 1 and not e.drum and pv and not v.touched[pv] and not protected(v, pv) and #pv.notes == 1\n     and math.abs(noteEnd(pv.top) - n.start) <= 0.05 and coin(v.r, 0.6) then\n    pv.top.len = noteEnd(n) - pv.top.start\n    v.touched[pv] = true\n    text = text .. (\", %s held over it\"):format(nameOf(v, pv.top.pitch))\n  end\n  return text\nend\n\n-- A chord thinned: an inner note taken out, a doubled one if there is one.\n-- The bass and the top note stay.\nfunction MOVES.thin(v)\n  local e = pickEvent(v, isChord)\n  if not e then return nil end\n  local count, inner, weights = {}, {}, {}\n  for _, n in ipairs(e.notes) do count[n.pitch % 12] = (count[n.pitch % 12] or 0) + 1 end\n  for i = 2, #e.notes - 1 do\n    local n = e.notes[i]\n    inner[#inner + 1] = n\n    weights[#weights + 1] = count[n.pitch % 12] > 1 and 3 or 1\n  end\n  local n = choose(v.r, inner, weights)\n  if not n then return nil end\n  n.gone = true\n  v.touched[e] = true\n  return (\"%s: chord thinned, %s left out\"):format(at(v, e.start), nameOf(v, n.pitch))\nend\n\n-- A chord revoiced: an inner note moved an octave, staying between the bass\n-- and the top so the outline of the music does not change.\nfunction MOVES.revoice(v)\n  local e = pickEvent(v, isChord)\n  if not e then return nil end\n  local have = {}\n  for _, n in ipairs(e.notes) do have[n.pitch] = true end\n  local options = {}\n  for i = 2, #e.notes - 1 do\n    local n = e.notes[i]\n    for _, d in ipairs({ 12, -12 }) do\n      local q = n.pitch + d\n      if q > e.bass.pitch and q < e.top.pitch and not have[q]\n         and not clashes(v, n, q, n.start, noteEnd(n)) then\n        options[#options + 1] = { n = n, q = q }\n      end\n    end\n  end\n  if #options == 0 then return nil end\n  local o = choose(v.r, options)\n  local was = o.n.pitch\n  o.n.pitch = o.q\n  v.touched[e] = true\n  return (\"%s: chord revoiced, %s moved %s to %s\"):format(at(v, e.start), nameOf(v, was),\n    o.q > was and \"up\" or \"down\", nameOf(v, o.q))\nend\n\n-- A chord rolled - its notes struck one after another, like a strum or a\n-- harp, over no more than a sixteenth.\nfunction MOVES.roll(v)\n  local e = pickEvent(v, isChord)\n  if not e then return nil end\n  local notes = live(e)\n  local up = coin(v.r, 0.7)\n  local gap = math.min(0.25 / #notes, v.an.unit / 4)\n  for k, n in ipairs(notes) do\n    local i = up and (k - 1) or (#notes - k)\n    local ne = noteEnd(n)\n    n.start = n.start + i * gap\n    n.len = ne - n.start\n  end\n  v.touched[e] = true\n  return (\"%s: chord rolled %s\"):format(at(v, e.start), up and \"upwards\" or \"downwards\")\nend\n\n-- A chord coloured: an inner note moved a step (a third to a fourth makes a\n-- sus chord, a root to a second an add9), if it grinds against nothing.\nfunction MOVES.colour(v)\n  local e = pickEvent(v, isChord)\n  if not e then return nil end\n  local pcs = {}\n  for _, n in ipairs(e.notes) do pcs[n.pitch % 12] = true end\n  local options = {}\n  for i = 2, #e.notes - 1 do\n    local n = e.notes[i]\n    for _, dir in ipairs({ 1, -1 }) do\n      local q = step(v.an.scale, n.pitch, dir)\n      if q and q > e.notes[i - 1].pitch and q < e.notes[i + 1].pitch and not pcs[q % 12]\n         and not clashes(v, n, q, n.start, noteEnd(n)) then\n        options[#options + 1] = { n = n, q = q }\n      end\n    end\n  end\n  if #options == 0 then return nil end\n  local o = choose(v.r, options)\n  local was = o.n.pitch\n  o.n.pitch = o.q\n  v.touched[e] = true\n  return (\"%s: chord coloured, %s to %s\"):format(at(v, e.start), nameOf(v, was), nameOf(v, o.q))\nend\n\n--[[  Changing a chord's quality: one small step to a neighbouring chord.\n\n      The chord is read by ScaleView Pro's chord reader (mv_theory.nameChord),\n      which gives its root. Each rule says which intervals above the root\n      must be there (`needs`) and must not (`lacks`), and then does one\n      thing - or, for the eleventh, two:\n\n        add   a new chord tone (C -> C7, Cmaj7, C6, Cadd9; C7 -> C9, C13, C7b9)\n        move  a chord tone a semitone or a tone (sus, minor <-> major,\n              Cmin -> Cdim, C -> Caug, Cmin7b5 -> Cdim7)\n        drop  a chord tone (C7 -> C)\n\n      Every note a rule would add must be in the scale unless the\n      \"Chord Changes May Leave the Scale\" box is ticked (opts.outside).\n      The bass is never moved or dropped, and a dropped note is never the\n      top one, so the chord keeps its footing and its outline. ]]\nM.QUALITY_RULES = {\n  { needs = { 0, 4, 7 }, lacks = { 9, 10, 11 }, add = 10 },              -- C -> C7\n  { needs = { 0, 3, 7 }, lacks = { 9, 10, 11 }, add = 10 },              -- Cmin -> Cmin7\n  { needs = { 0, 4, 7 }, lacks = { 9, 10, 11 }, add = 11 },              -- C -> Cmaj7\n  { needs = { 0, 4, 7 }, lacks = { 9, 10, 11 }, add = 9 },               -- C -> C6\n  { needs = { 0, 3, 7 }, lacks = { 9, 10, 11 }, add = 9 },               -- Cmin -> Cmin6\n  { needs = { 0, 4, 7 }, lacks = { 1, 2, 3 }, add = 2 },                 -- Cadd9, C9, Cmaj9\n  { needs = { 0, 3, 7, 10 }, lacks = { 1, 2 }, add = 2 },                -- Cmin7 -> Cmin9\n  { needs = { 0, 3, 10 }, lacks = { 4, 5 }, add = 5 },                   -- Cmin7 -> Cmin11\n  { needs = { 0, 4, 10 }, lacks = { 8, 9 }, add = 9 },                   -- C7 -> C13\n  { needs = { 0, 4, 10 }, lacks = { 1, 2, 3 }, add = 1, rub = true },    -- C7 -> C7b9\n  { needs = { 0, 4, 7, 10 }, lacks = { 2, 5 }, move = { 4, 5 }, add = 2 }, -- C7 -> C11\n  { needs = { 0, 4, 7 }, lacks = { 5 }, move = { 4, 5 } },               -- C -> Csus4, C7 -> C7sus4\n  { needs = { 0, 3, 7 }, lacks = { 5 }, move = { 3, 5 } },               -- Cmin -> Csus4\n  { needs = { 0, 4, 7 }, lacks = { 2 }, move = { 4, 2 } },               -- C -> Csus2\n  { needs = { 0, 3, 7 }, lacks = { 2 }, move = { 3, 2 } },               -- Cmin -> Csus2\n  { needs = { 0, 5, 7 }, lacks = { 3, 4 }, move = { 5, 4 } },            -- Csus4 -> C\n  { needs = { 0, 5, 7 }, lacks = { 3, 4 }, move = { 5, 3 } },            -- Csus4 -> Cmin\n  { needs = { 0, 2, 7 }, lacks = { 3, 4 }, move = { 2, 4 } },            -- Csus2 -> C\n  { needs = { 0, 2, 7 }, lacks = { 3, 4 }, move = { 2, 3 } },            -- Csus2 -> Cmin\n  { needs = { 0, 4, 7 }, lacks = { 3 }, move = { 4, 3 } },              -- C -> Cmin\n  { needs = { 0, 3, 7 }, lacks = { 4 }, move = { 3, 4 } },               -- Cmin -> C\n  { needs = { 0, 3, 7 }, lacks = { 6, 11 }, move = { 7, 6 } },           -- Cmin -> Cdim, Cmin7 -> Cmin7b5\n  { needs = { 0, 4, 7 }, lacks = { 8, 9, 10 }, move = { 7, 8 } },        -- C -> Caug\n  { needs = { 0, 3, 6 }, lacks = { 9, 10, 11 }, add = 9 },               -- Cdim -> Cdim7\n  { needs = { 0, 3, 6 }, lacks = { 9, 10, 11 }, add = 10 },              -- Cdim -> Cmin7b5\n  { needs = { 0, 3, 6, 10 }, lacks = { 9 }, move = { 10, 9 } },          -- Cmin7b5 -> Cdim7\n  { needs = { 0, 3, 6, 9 }, lacks = { 10 }, move = { 9, 10 } },          -- Cdim7 -> Cmin7b5\n  { needs = { 0, 4, 10 }, lacks = {}, drop = 10 },                       -- C7 -> C\n  { needs = { 0, 3, 10 }, lacks = {}, drop = 10 },                       -- Cmin7 -> Cmin\n  { needs = { 0, 4, 11 }, lacks = {}, drop = 11 },                       -- Cmaj7 -> C\n}\n\nlocal function pitchesOf(e)\n  local out = {}\n  for _, n in ipairs(e.notes) do if not n.gone and not isDrum(n) then out[#out + 1] = n.pitch end end\n  table.sort(out)\n  return out\nend\n\n-- The same chord struck again and again (a strummed bar) is one chord: it\n-- changes as one, or one strike in four would sound like a wrong note.\nlocal function chordRun(v, e)\n  local key = table.concat(pitchesOf(e), \",\")\n  local run = { e }\n  for dir = -1, 1, 2 do\n    local i = e.index + dir\n    while v.an.events[i] do\n      local o = v.an.events[i]\n      if v.touched[o] or protected(v, o) or table.concat(pitchesOf(o), \",\") ~= key then break end\n      if dir < 0 then table.insert(run, 1, o) else run[#run + 1] = o end\n      i = i + dir\n    end\n  end\n  return run\nend\n\n-- Is `q` a pitch the chord can take? Not already there, and - unless the\n-- rule is the b9, whose rub is the point - no semitone against a chord note.\nlocal function fits(q, pitches, rub)\n  for _, x in ipairs(pitches) do\n    if x == q then return false end\n    if not rub and math.abs(x - q) == 1 then return false end\n  end\n  return q >= 0 and q <= 127\nend\n\n--[[  How `rule` changes the chord `pitches` (low to high) on `root`: a map\n      of old pitch -> new pitch, pitches to add, pitches to drop - or nil if\n      it cannot be done without moving the bass or the outline. ]]\nlocal function plan(rule, pitches, root, blockChord)\n  local bass, top = pitches[1], pitches[#pitches]\n  local moves, adds, drops = {}, {}, {}\n  local now = {}\n  for i, p in ipairs(pitches) do now[i] = p end\n\n  if rule.move then\n    local f, t = rule.move[1], rule.move[2]\n    local d = ((t - f + 6) % 12) - 6\n    local any = false\n    for i, p in ipairs(pitches) do\n      if (p - root) % 12 == f then\n        if i == 1 then return nil end            -- the bass stays\n        moves[p] = p + d\n        now[i] = p + d\n        any = true\n      end\n    end\n    if not any then return nil end\n  end\n\n  if rule.drop then\n    for i, p in ipairs(pitches) do\n      if (p - root) % 12 == rule.drop then\n        if i == 1 or i == #pitches then return nil end   -- bass and top stay\n        drops[p] = true\n      end\n    end\n    if #pitches - (function() local k = 0; for _ in pairs(drops) do k = k + 1 end; return k end)() < 3 then\n      return nil\n    end\n  end\n\n  if rule.add then\n    local pc = (root + rule.add) % 12\n    local others = {}\n    for _, p in ipairs(now) do if not drops[p] then others[#others + 1] = p end end\n    local place\n    -- Inside the chord, as high as it will go: an added ninth or seventh\n    -- belongs near the top, where a low one would muddy the bass.\n    for q = top - 1, bass + 1, -1 do\n      if q % 12 == pc and fits(q, others, rule.rub) then place = q; break end\n    end\n    -- Or a doubled inner note becomes the new one - the doubled root of a\n    -- triad is the note a seventh classically replaces.\n    if not place then\n      local count = {}\n      for _, p in ipairs(others) do count[p % 12] = (count[p % 12] or 0) + 1 end\n      for i = 2, #pitches - 1 do\n        local p = pitches[i]\n        if not moves[p] and count[p % 12] > 1 then\n          for d = -6, 6 do\n            local q = p + d\n            local rest = {}\n            for _, x in ipairs(others) do if x ~= p then rest[#rest + 1] = x end end\n            if q % 12 == pc and q > bass and q < top and fits(q, rest, rule.rub) then\n              moves[p], place = q, nil\n              return { moves = moves, adds = adds, drops = drops }\n            end\n          end\n        end\n      end\n    end\n    -- Or, for a block chord with no tune on top of it, just above the top.\n    if not place and blockChord then\n      for q = top + 1, top + 12 do\n        if q % 12 == pc and fits(q, others, rule.rub) then place = q; break end\n      end\n    end\n    if not place then return nil end\n    adds[#adds + 1] = place\n  end\n  return { moves = moves, adds = adds, drops = drops }\nend\n\n-- A block chord: every note struck together and held alike, so the top note\n-- is part of the chord, not a tune riding on it.\nlocal function isBlock(e)\n  local s, l = e.notes[1].start, e.notes[1].len\n  for _, n in ipairs(e.notes) do\n    if math.abs(n.start - s) > M.ONSET or math.abs(n.len - l) > 0.05 then return false end\n  end\n  return true\nend\n\nfunction MOVES.quality(v)\n  if not v.T or not v.an.chordKey then return nil end\n  local e = pickEvent(v, isChord)\n  if not e then return nil end\n  local pitches = pitchesOf(e)\n  local before, root = v.T.nameChord(pitches, v.an.chordKey)\n  if not root then return nil end\n  local has = {}\n  for _, p in ipairs(pitches) do has[(p - root) % 12] = true end\n\n  local rules = {}\n  for _, rule in ipairs(M.QUALITY_RULES) do\n    local ok = true\n    for _, iv in ipairs(rule.needs) do if not has[iv] then ok = false end end\n    for _, iv in ipairs(rule.lacks) do if has[iv] then ok = false end end\n    if ok and not v.opts.outside then\n      local new = {}\n      if rule.add then new[#new + 1] = rule.add end\n      if rule.move then new[#new + 1] = rule.move[2] end\n      for _, iv in ipairs(new) do\n        if not v.an.pcs[(root + iv) % 12] then ok = false end\n      end\n    end\n    if ok then rules[#rules + 1] = rule end\n  end\n\n  local run = chordRun(v, e)\n  local span0, span1 = math.huge, -math.huge\n  for _, ev in ipairs(run) do\n    for _, n in ipairs(ev.notes) do\n      span0, span1 = math.min(span0, n.start), math.max(span1, noteEnd(n))\n    end\n  end\n  local inRun = {}\n  for _, ev in ipairs(run) do for _, n in ipairs(ev.notes) do inRun[n] = true end end\n\n  -- Nothing it adds or moves may grind against the tune or anything else\n  -- sounding over the chord.\n  local function outsideClash(q)\n    for _, o in ipairs(v.notes) do\n      if not inRun[o] and not o.gone and not isDrum(o)\n         and o.start < span1 - 1e-6 and noteEnd(o) > span0 + 1e-6\n         and (harsh(q, o.pitch) or q == o.pitch) then\n        return true\n      end\n    end\n    return false\n  end\n\n  while #rules > 0 do\n    local rule, i = choose(v.r, rules)\n    table.remove(rules, i)\n    local p = plan(rule, pitches, root, isBlock(e))\n    local ok = p ~= nil\n    if ok then\n      for _, q in pairs(p.moves) do if outsideClash(q) then ok = false end end\n      for _, q in ipairs(p.adds) do if outsideClash(q) then ok = false end end\n    end\n    if ok then\n      local after = {}\n      for _, x in ipairs(pitches) do\n        if not p.drops[x] then after[#after + 1] = p.moves[x] or x end\n      end\n      for _, q in ipairs(p.adds) do after[#after + 1] = q end\n      table.sort(after)\n      local name = v.T.nameChord(after, v.an.chordKey)\n      if name ~= before then\n        for _, ev in ipairs(run) do\n          local vel, lens = 0, {}\n          for _, n in ipairs(ev.notes) do\n            if p.drops[n.pitch] then n.gone = true\n            elseif p.moves[n.pitch] then n.pitch = p.moves[n.pitch] end\n            vel = vel + n.vel\n            lens[#lens + 1] = n.len\n          end\n          table.sort(lens)\n          for _, q in ipairs(p.adds) do\n            local an = copyNote(ev.bass)\n            an.pitch, an.len = q, lens[(#lens + 1) // 2]\n            an.part = nearestPart(ev.notes, q)\n            an.vel = math.floor(vel / #ev.notes * 0.85 + 0.5)\n            add(v, an)\n          end\n          v.touched[ev] = true\n        end\n        local times = #run > 1 and (\", all %d times it is struck\"):format(#run) or \"\"\n        return (\"%s: %s became %s%s\"):format(at(v, e.start), before, name, times)\n      end\n    end\n  end\n  return nil\nend\n\n-- \"Bar 3\" or \"Bars 3-4\" (or half bars, \"Bar 2, second half\").\nlocal function spanName(v, t0, t1)\n  local bb = v.src.barBeats\n  local b0, b1 = math.floor(t0 / bb + 1e-6), math.floor(t1 / bb - 1e-6)\n  local half = (t1 - t0) < bb - 1e-6\n  if b0 == b1 then\n    if half and math.abs(t0 - b0 * bb) > 1e-6 then return (\"Bar %d, second half\"):format(b0 + 1) end\n    if half then return (\"Bar %d, first half\"):format(b0 + 1) end\n    return (\"Bar %d\"):format(b0 + 1)\n  end\n  return (\"Bars %d\u00e2\u0080\u0093%d\"):format(b0 + 1, b1 + 1)\nend\n\n--[[  An arpeggiated chord changed in quality: the same rules, applied to\n      a chord whose notes come one at a time (M.brokenChords).\n\n        move  every note of that chord tone moves, wherever it is played\n        add   a doubled note - not the lowest - becomes the new tone, at\n              the nearest pitch that fits (A C E A becomes A C E G: Amin7)\n        drop  every note of that tone becomes the nearest chord note left\n\n      The lowest note is the bass and never changes; a protected note (the\n      first or last of the phrase) never changes; nothing grinds against\n      notes outside the arpeggio. The same arpeggio in the bars straight\n      after (or before) changes with it, as a repeated chord does. ]]\nfunction MOVES.arpeggio(v)\n  if not v.T or not v.an.chordKey or #v.an.broken == 0 then return nil end\n  local evs = v.an.events\n  local function pitchesIn(w)\n    local ps = {}\n    for _, i in ipairs(w.events) do\n      local n = evs[i].notes[1]\n      if n.gone then return nil end\n      ps[#ps + 1] = n.pitch\n    end\n    return ps\n  end\n  local function key(w)\n    local ps = pitchesIn(w)\n    if not ps then return nil end\n    return table.concat(ps, \",\")\n  end\n\n  local list, weights = {}, {}\n  local h = v.history or {}\n  for wi, w in ipairs(v.an.broken) do\n    local free = true\n    for _, i in ipairs(w.events) do if v.touched[evs[i]] then free = false end end\n    if free and key(w) then\n      local e = evs[w.events[1]]\n      list[#list + 1] = wi\n      weights[#weights + 1] = focusWeight(v, e) / (1 + 2 * (h[\"arpeggio@\" .. e.index] or 0))\n    end\n  end\n  if #list == 0 then return nil end\n  local wi = choose(v.r, list, weights)\n  local w = v.an.broken[wi]\n\n  -- The run: the same notes in the same order, in the windows next to it.\n  local run = { w }\n  local k = key(w)\n  for dir = -1, 1, 2 do\n    local j = wi + dir\n    while v.an.broken[j] do\n      local o = v.an.broken[j]\n      local touching = dir > 0 and math.abs(o.t0 - run[#run].t1) < 1e-6 or math.abs(o.t1 - run[1].t0) < 1e-6\n      local free = true\n      for _, i in ipairs(o.events) do if v.touched[evs[i]] then free = false end end\n      if not touching or not free or key(o) ~= k then break end\n      if dir < 0 then table.insert(run, 1, o) else run[#run + 1] = o end\n      j = j + dir\n    end\n  end\n\n  local pitches = pitchesIn(w)\n  local set, distinct = {}, {}\n  for _, p in ipairs(pitches) do\n    if not set[p] then set[p] = true; distinct[#distinct + 1] = p end\n  end\n  table.sort(distinct)\n  local before, root = v.T.nameChord(distinct, v.an.chordKey)\n  if not root then return nil end\n  local bass = distinct[1]\n  local has, count = {}, {}\n  for _, p in ipairs(distinct) do has[(p - root) % 12] = true end\n  for _, p in ipairs(pitches) do count[p % 12] = (count[p % 12] or 0) + 1 end\n  -- How many different pitches carry each pitch class: a doubled one can\n  -- give one of its pitches to a new note.\n  local spread = {}\n  for _, p in ipairs(distinct) do spread[p % 12] = (spread[p % 12] or 0) + 1 end\n\n  local inRun, protectedNote = {}, {}\n  local span0, span1 = math.huge, -math.huge\n  for _, rw in ipairs(run) do\n    for _, i in ipairs(rw.events) do\n      local n = evs[i].notes[1]\n      inRun[n] = true\n      if protected(v, evs[i]) then protectedNote[n] = true end\n      span0, span1 = math.min(span0, n.start), math.max(span1, noteEnd(n))\n    end\n  end\n  local function outsideClash(q, n)\n    for _, o in ipairs(v.notes) do\n      if not inRun[o] and not o.gone and not isDrum(o)\n         and o.start < noteEnd(n) - 1e-6 and noteEnd(o) > n.start + 1e-6\n         and (harsh(q, o.pitch) or q == o.pitch) then\n        return true\n      end\n    end\n    return false\n  end\n\n  local rules = {}\n  for _, rule in ipairs(M.QUALITY_RULES) do\n    local ok = true\n    for _, iv in ipairs(rule.needs) do if not has[iv] then ok = false end end\n    for _, iv in ipairs(rule.lacks) do if has[iv] then ok = false end end\n    if ok and not v.opts.outside then\n      local new = {}\n      if rule.add then new[#new + 1] = rule.add end\n      if rule.move then new[#new + 1] = rule.move[2] end\n      for _, iv in ipairs(new) do if not v.an.pcs[(root + iv) % 12] then ok = false end end\n    end\n    if ok then rules[#rules + 1] = rule end\n  end\n\n  while #rules > 0 do\n    local rule, ri = choose(v.r, rules)\n    table.remove(rules, ri)\n    -- old pitch -> new pitch, for every distinct pitch of the arpeggio;\n    -- and, for an add with nothing doubled, every other strike of the\n    -- note struck most often (C G E G becomes C G E B).\n    local map, every, ok = {}, nil, true\n    if rule.move then\n      local f, t = rule.move[1], rule.move[2]\n      local d = ((t - f + 6) % 12) - 6\n      local any = false\n      for _, p in ipairs(distinct) do\n        if (p - root) % 12 == f then\n          if p == bass then ok = false end\n          map[p], any = p + d, true\n        end\n      end\n      if not any then ok = false end\n    end\n    if ok and rule.drop then\n      local left = {}\n      for _, p in ipairs(distinct) do if (p - root) % 12 ~= rule.drop then left[#left + 1] = p end end\n      local pcsLeft, kinds = {}, 0\n      for _, p in ipairs(left) do if not pcsLeft[p % 12] then pcsLeft[p % 12], kinds = true, kinds + 1 end end\n      if kinds < 3 then ok = false end\n      for _, p in ipairs(distinct) do\n        if ok and (p - root) % 12 == rule.drop then\n          if p == bass then ok = false; break end\n          local best\n          for _, q in ipairs(left) do\n            if not best or math.abs(q - p) < math.abs(best - p) or (math.abs(q - p) == math.abs(best - p) and q > best) then\n              best = q\n            end\n          end\n          map[p] = best\n        end\n      end\n    end\n    local place\n    if ok and rule.add then\n      local pc = (root + rule.add) % 12\n      local now = {}\n      for _, p in ipairs(distinct) do now[#now + 1] = map[p] or p end\n      -- The highest doubled pitch (not the bass) gives way to the new tone;\n      -- with none doubled, every other strike of the commonest one does.\n      local given\n      for i = #distinct, 2, -1 do\n        local p = distinct[i]\n        if not map[p] and spread[p % 12] > 1 then given = p; break end\n      end\n      local struck = {}\n      for _, p in ipairs(pitches) do struck[p] = (struck[p] or 0) + 1 end\n      local others = {}\n      if not given then\n        local most = 1\n        for i = 2, #distinct do\n          local p = distinct[i]\n          if not map[p] and struck[p] > most then given, most, every = p, struck[p], true end\n        end\n      end\n      if not given then ok = false\n      else\n        for _, p in ipairs(now) do if every or p ~= given then others[#others + 1] = p end end\n        for d = 0, 6 do\n          for _, q in ipairs({ given - d, given + d }) do\n            if not place and q % 12 == pc and q > bass and fits(q, others, rule.rub) then place = q end\n          end\n        end\n        if not place then ok = false elseif not every then map[given] = place end\n      end\n      if ok and every then\n        -- Every other strike of `given`, counted through the window.\n        every = { pitch = given, to = place }\n      end\n    end\n    if ok and (next(map) or every) then\n      -- The window's notes in time order, and what each becomes; every\n      -- window of the run plays the same notes, so the same plan fits all.\n      local function plan(rw)\n        local out, seenGiven = {}, 0\n        for k2, i in ipairs(rw.events) do\n          local p = evs[i].notes[1].pitch\n          local q = map[p] or p\n          if every and p == every.pitch then\n            seenGiven = seenGiven + 1\n            if seenGiven % 2 == 0 then q = every.to end\n          end\n          out[k2] = q\n        end\n        return out\n      end\n      local after, seen = {}, {}\n      for _, q in ipairs(plan(w)) do\n        if not seen[q] then seen[q] = true; after[#after + 1] = q end\n      end\n      table.sort(after)\n      local name = v.T.nameChord(after, v.an.chordKey)\n      if name == before then ok = false end\n      for _, rw in ipairs(run) do\n        local pl = plan(rw)\n        for k2, i in ipairs(rw.events) do\n          local n = evs[i].notes[1]\n          if pl[k2] ~= n.pitch and (protectedNote[n] or outsideClash(pl[k2], n)) then ok = false end\n        end\n      end\n      if ok then\n        for _, rw in ipairs(run) do\n          local pl = plan(rw)\n          for k2, i in ipairs(rw.events) do evs[i].notes[1].pitch = pl[k2] end\n          for _, i in ipairs(rw.events) do v.touched[evs[i]] = true end\n        end\n        v.chosen = evs[w.events[1]]\n        local times = #run > 1 and (\", all %d times it is played\"):format(#run) or \"\"\n        return (\"%s: the arpeggio %s became %s%s\"):format(spanName(v, w.t0, w.t1), before, name, times)\n      end\n    end\n  end\n  return nil\nend\n\nM.MOVES = MOVES\n\n------------------------------------------------------------------------------\n-- Developing the motif\n--\n-- Near the top of the amount slider a variation may do something bigger to\n-- one stretch of the music - the ways a composer brings a motif back\n-- changed (Hutchinson, ch. 11; Good Idea's sequence and fragment):\n--\n--   invert      the tune turned upside down, mirrored in the scale\n--   retrograde  the notes in reverse order, in the same rhythm\n--   transpose   the stretch moved up or down the scale - a sequence\n--   stretch     its intervals widened (steps become thirds)\n--   squeeze     its intervals narrowed (leaps become steps)\n--   fragment    its first half again, a step lower, in place of the rest\n--\n-- Everything moves by scale positions, so a moved tune stays in the key.\n-- The rhythm stays (but for fragment, which repeats the first half's), so\n-- the motif is still recognisable by its rhythm. With chords under a tune,\n-- only the tune is inverted, reversed or stretched, and each of its notes\n-- is nudged to the nearest scale note that does not grind and stays on\n-- top; a sequence moves everything. One change, covering every moment in\n-- the stretch - nothing else changes inside it.\n------------------------------------------------------------------------------\n\n-- Develop starts above this amount, and its chance of happening in a\n-- variation rises from the first number just above it to the second at 100%.\nM.DEVELOP_FROM = 0.7\nM.DEVELOP_CHANCE = { 0.15, 0.9 }\n-- How far a developed stretch may leave the original's range, in semitones.\nM.DEVELOP_ROOM = 5\nM.DEVELOP = { key = \"develop\", name = \"Develop\",\n              moves = { { \"invert\", 2 }, { \"retrograde\", 2 }, { \"transpose\", 3 },\n                        { \"stretch\", 1.5 }, { \"squeeze\", 1 }, { \"fragment\", 1.5 } } }\n\n-- The scale as a ladder of positions: position s is pitch `rung(L, s)`.\n-- A third above anything is two positions up, in any seven-note scale.\nlocal function ladder(an)\n  local L = {}\n  for pc = 0, 11 do if an.scale[pc] then L[#L + 1] = pc end end\n  if #L < 2 then\n    L = {}\n    for pc = 0, 11 do if an.pcs[pc] then L[#L + 1] = pc end end\n  end\n  return L\nend\nlocal function rung(L, s) return (s // #L) * 12 + L[s % #L + 1] end\n-- A pitch's position, and how far above it the pitch is (1 for a raised\n-- seventh between two scale notes, so it can be carried along).\nlocal function posOf(L, p)\n  local oct, pc = p // 12, p % 12\n  local i\n  for k = #L, 1, -1 do if L[k] <= pc then i = k; break end end\n  if not i then oct, i = oct - 1, #L end\n  local s = oct * #L + (i - 1)\n  return s, p - rung(L, s)\nend\n-- Back from a position, with the offset kept where the scale allows it.\nlocal function fromPos(v, L, s, off)\n  local q = rung(L, s) + (off or 0)\n  if off and off ~= 0 and not v.an.pcs[q % 12] then q = q - off end\n  return q\nend\n\nlocal INTERVAL_NAMES = { [0] = \"\", \"a semitone\", \"a step\", \"a third\", \"a third\", \"a fourth\",\n                         \"a tritone\", \"a fifth\", \"a sixth\", \"a sixth\", \"a seventh\", \"a seventh\", \"an octave\" }\n-- How far a move of `s` positions is, by name: counted in scale steps in a\n-- seven-note scale (E to F is a step, not \"a semitone\"), else by the\n-- semitones the first note moved, `d`.\nlocal STEP_NAMES = { \"a step\", \"a third\", \"a fourth\", \"a fifth\", \"a sixth\", \"a seventh\", \"an octave\" }\nlocal function distance(L, s, d)\n  if #L == 7 and STEP_NAMES[math.abs(s)] then return STEP_NAMES[math.abs(s)] end\n  return INTERVAL_NAMES[math.min(12, math.abs(d))]\nend\n\n-- The notes in time order, to find what sounds when without looking at\n-- every note: a develop on a long piece moves hundreds of notes, and\n-- asking all two thousand about each one took seconds.\nlocal function noteIndex(notes)\n  local list, most = {}, 0\n  for _, n in ipairs(notes) do list[#list + 1] = n; most = math.max(most, n.len) end\n  table.sort(list, function(a, b) return a.start < b.start end)\n  return { list = list, most = most }\nend\n\n-- Every note of `idx` that may sound in [t0, t1) - a few more, never fewer.\nlocal function around(idx, t0, t1)\n  local list = idx.list\n  local from = t0 - idx.most - 1e-3\n  local lo, hi = 1, #list + 1\n  while lo < hi do\n    local mid = (lo + hi) // 2\n    if list[mid].start < from then lo = mid + 1 else hi = mid end\n  end\n  local out = {}\n  for i = lo, #list do\n    local o = list[i]\n    if o.start >= t1 + 1e-3 then break end\n    if noteEnd(o) > t0 - 1e-3 then out[#out + 1] = o end\n  end\n  return out\nend\n\n-- The moments of [t0, t1) a develop may change, and the pitched notes of\n-- each that sound (the tune is the top one).\nlocal function spanMoments(v, t0, t1)\n  local out = {}\n  for _, e in ipairs(v.an.events) do\n    if e.start >= t0 - 1e-6 and e.start < t1 - 1e-6 and not e.drum\n       and not v.touched[e] and not protected(v, e) then\n      local ns = {}\n      for _, n in ipairs(e.notes) do if not n.gone and not isDrum(n) then ns[#ns + 1] = n end end\n      if #ns > 0 then\n        table.sort(ns, function(a, b) return a.pitch < b.pitch end)\n        local m = { e = e, notes = ns, top = ns[#ns] }\n        -- A moment whose top note is under something still held from\n        -- before (a walking bass under a held chord) is not the tune.\n        for _, o in ipairs(around(v.byTime, e.start, e.start + 1e-6)) do\n          if not o.gone and not isDrum(o) and o.event ~= e and o.start < e.start - 1e-6\n             and noteEnd(o) > e.start + 1e-6 and o.pitch > m.top.pitch then\n            m.under = true\n          end\n        end\n        out[#out + 1] = m\n      end\n    end\n  end\n  return out\nend\n\nlocal function inRange(v, q)\n  return q >= v.an.lo - M.DEVELOP_ROOM and q <= v.an.hi + M.DEVELOP_ROOM and q >= 0 and q <= 127\nend\n\n-- How far a set of pitches overshoots the range allowed: 0 if it fits.\nlocal function overshoot(v, qs)\n  local over = 0\n  for _, q in ipairs(qs) do\n    over = math.max(over, (v.an.lo - M.DEVELOP_ROOM) - q, q - (v.an.hi + M.DEVELOP_ROOM))\n  end\n  return over\nend\n\n--[[  New pitches for the tune of a stretch, one per moment, given as scale\n      positions (with the offset each note had). Each is placed if it\n      grinds against nothing and stays above the rest of its moment;\n      otherwise the nearest position that does, up to two away; otherwise\n      the note keeps its pitch. Fails, changing nothing, if more than a\n      third of the notes could not take their place, or nothing changed. ]]\nlocal function placeTune(v, L, line, targets)\n  local was, kept, changed = {}, 0, 0\n  local isTune = {}\n  for i, m in ipairs(line) do was[i] = m.top.pitch; isTune[m.top] = true end\n  for i, m in ipairs(line) do\n    local n = m.top\n    -- Everything else sounding when it is struck - its own chord, or one\n    -- held from before - stays under it.\n    local near = around(v.byTime, n.start, noteEnd(n) + M.ONSET)\n    local below = -1\n    for _, o in ipairs(near) do\n      if not isTune[o] and not o.gone and not isDrum(o)\n         and o.start <= n.start + M.ONSET and noteEnd(o) > n.start + 1e-6 then\n        below = math.max(below, o.pitch)\n      end\n    end\n    local function good(q)\n      return inRange(v, q) and q > below\n         and not clashes(v, n, q, n.start, noteEnd(n), near)\n    end\n    local s, off = targets[i][1], targets[i][2]\n    local placed\n    for _, d in ipairs({ 0, 1, -1, 2, -2 }) do\n      local q = fromPos(v, L, s + d, off)\n      if good(q) then placed = q; break end\n    end\n    if placed then\n      if placed ~= n.pitch then changed = changed + 1 end\n      n.pitch = placed\n    else\n      kept = kept + 1\n    end\n  end\n  if changed == 0 or kept * 3 > #line then\n    for i, m in ipairs(line) do m.top.pitch = was[i] end\n    return false\n  end\n  return true\nend\n\nlocal DEVELOP = {}\n\n-- The moments of a stretch that carry the tune.\nlocal function tune(line)\n  local out = {}\n  for _, m in ipairs(line) do if not m.under then out[#out + 1] = m end end\n  return out\nend\n\n-- The tune mirrored in the scale around its first note - or, if that\n-- would leave the range, around its middle.\nfunction DEVELOP.invert(v, L, line)\n  line = tune(line)\n  if #line < 3 then return nil end\n  local pos, lo, hi = {}, math.huge, -math.huge\n  for i, m in ipairs(line) do\n    local s, off = posOf(L, m.top.pitch)\n    pos[i] = { s, off }\n    lo, hi = math.min(lo, s), math.max(hi, s)\n  end\n  local best, bestCost\n  for k, axis in ipairs({ pos[1][1], (lo + hi) // 2 }) do\n    local qs = {}\n    for i, p in ipairs(pos) do qs[i] = fromPos(v, L, 2 * axis - p[1], -p[2]) end\n    local cost = overshoot(v, qs) * 100 + (k - 1)\n    if not bestCost or cost < bestCost then best, bestCost = axis, cost end\n  end\n  if bestCost >= 100 then return nil end\n  local targets = {}\n  for i, p in ipairs(pos) do targets[i] = { 2 * best - p[1], -p[2] } end\n  local around = v.T and M.noteName(v.an, line[1].top.pitch, v.T) or \"its first note\"\n  if not placeTune(v, L, line, targets) then return nil end\n  if best ~= pos[1][1] then return \"the tune turned upside down\" end\n  return (\"the tune turned upside down around its first note, %s\"):format(around)\nend\n\n-- The notes in reverse order, each keeping the place in the rhythm.\nfunction DEVELOP.retrograde(v, L, line)\n  line = tune(line)\n  if #line < 3 then return nil end\n  local targets = {}\n  for i = 1, #line do\n    local s, off = posOf(L, line[#line + 1 - i].top.pitch)\n    targets[i] = { s, off }\n  end\n  if not placeTune(v, L, line, targets) then return nil end\n  return \"the notes played in reverse order, in the same rhythm\"\nend\n\n-- Intervals from the first note multiplied: widened (x2) or narrowed (x0.5,\n-- every step still going the way it went).\nlocal function scaleIntervals(v, L, line, factor)\n  line = tune(line)\n  if #line < 3 then return nil end\n  local pos = {}\n  for i, m in ipairs(line) do pos[i] = { posOf(L, m.top.pitch) } end\n  local anchor = pos[1][1]\n  local function target(p)\n    local d = p[1] - anchor\n    local nd = d * factor\n    if factor < 1 then\n      nd = (d > 0) and math.max(1, math.floor(nd + 0.5)) or (d < 0 and math.min(-1, -math.floor(-nd + 0.5)) or 0)\n    end\n    return anchor + nd\n  end\n  local targets, qs, differs = {}, {}, false\n  for i, p in ipairs(pos) do\n    targets[i] = { target(p), p[2] }\n    qs[i] = fromPos(v, L, targets[i][1], p[2])\n    if targets[i][1] ~= p[1] then differs = true end\n  end\n  if not differs or overshoot(v, qs) > 0 then return nil end\n  return placeTune(v, L, line, targets)\nend\n\nfunction DEVELOP.stretch(v, L, line)\n  if not scaleIntervals(v, L, line, 2) then return nil end\n  return \"its intervals widened \u00e2\u0080\u0094 steps become thirds\"\nend\n\nfunction DEVELOP.squeeze(v, L, line)\n  if not scaleIntervals(v, L, line, 0.5) then return nil end\n  return \"its intervals narrowed \u00e2\u0080\u0094 leaps become steps\"\nend\n\n-- How many pairs of these notes grind while sounding together, at their\n-- pitches now or at `new` pitches. A sequence moves by scale steps, and a\n-- step is not always the same size: D under E moved up a step is E under\n-- F. So it may not add a grinding pair - inside a chord, or between a\n-- held chord and the tune over it.\nlocal function harshPairs(notes, new)\n  local k = 0\n  local sorted = {}\n  for i, n in ipairs(notes) do sorted[i] = n end\n  table.sort(sorted, function(a, b) return a.start < b.start end)\n  notes = sorted\n  for i = 1, #notes do\n    for j = i + 1, #notes do\n      local a, b = notes[i], notes[j]\n      if b.start >= noteEnd(a) - 1e-6 then break end   -- in time order: none later overlaps a\n      if a.start < noteEnd(b) - 1e-6 and b.start < noteEnd(a) - 1e-6 then\n        local pa = new and new[a] or a.pitch\n        local pb = new and new[b] or b.pitch\n        if harsh(pa, pb) or (new and pa == pb and a.pitch ~= b.pitch) then k = k + 1 end\n      end\n    end\n  end\n  return k\nend\n\n-- Everything in the stretch moved up or down the scale: a sequence.\n-- Chords move with the tune. The shift (or an octave either side of it)\n-- that stays in range and moves least is used (Good Idea's bestShift).\nfunction DEVELOP.transpose(v, L, line)\n  local inLine = {}\n  for _, m in ipairs(line) do for _, n in ipairs(m.notes) do inLine[n] = true end end\n  local shifts, weights = { 1, -1, 2, -2, 4, -3 }, { 2, 1.5, 1, 1, 1.5, 1 }\n  while #shifts > 0 do\n    local k, i = choose(v.r, shifts, weights)\n    table.remove(shifts, i); table.remove(weights, i)\n    local best, bestCost\n    for _, s in ipairs({ k, k - #L, k + #L }) do\n      local qs = {}\n      for _, m in ipairs(line) do\n        for _, n in ipairs(m.notes) do\n          local p, off = posOf(L, n.pitch)\n          qs[#qs + 1] = fromPos(v, L, p + s, off)\n        end\n      end\n      local cost = overshoot(v, qs) * 100 + math.abs(s)\n      if not bestCost or cost < bestCost then best, bestCost = s, cost end\n    end\n    if best ~= 0 and bestCost < 100 then\n      local new, moved = {}, {}\n      for _, m in ipairs(line) do\n        for _, n in ipairs(m.notes) do\n          local p, off = posOf(L, n.pitch)\n          new[n] = fromPos(v, L, p + best, off)\n          moved[#moved + 1] = n\n        end\n      end\n      local ok = harshPairs(moved, new) <= harshPairs(moved)\n      -- Nothing outside the stretch that sounds with it may grind against\n      -- the moved notes, or be doubled by one.\n      if ok then\n        -- (Only the notes sounding with the stretch need asking.)\n        local t0, t1 = math.huge, -math.huge\n        for n in pairs(new) do t0, t1 = math.min(t0, n.start), math.max(t1, noteEnd(n)) end\n        local outside = {}\n        for _, o in ipairs(around(v.byTime, t0, t1)) do\n          if not inLine[o] then outside[#outside + 1] = o end\n        end\n        for n, q in pairs(new) do\n          for _, o in ipairs(outside) do\n            if not inLine[o] and not o.gone and not isDrum(o)\n               and o.start < noteEnd(n) - 1e-6 and noteEnd(o) > n.start + 1e-6\n               and (o.pitch == q or (harsh(q, o.pitch) and not harsh(n.pitch, o.pitch))) then\n              ok = false\n            end\n          end\n        end\n      end\n      if ok then\n        local d = new[line[1].top] - line[1].top.pitch\n        for n, q in pairs(new) do n.pitch = q end\n        local what = #line[1].notes > 1 and \"the music\" or \"the tune\"\n        return (\"%s moved %s %s \u00e2\u0080\u0094 a sequence\"):format(what, best > 0 and \"up\" or \"down\", distance(L, best, d))\n      end\n    end\n  end\n  return nil\nend\n\n-- The first half of the stretch again, a step lower (or higher), in place\n-- of the second half: a melody only, and only where every moment of the\n-- stretch is free to change.\nfunction DEVELOP.fragment(v, L, line, t0, t1)\n  local half = (t1 - t0) / 2\n  if half < v.an.unit * 2 - 1e-6 then return nil end\n  for _, e in ipairs(v.an.events) do\n    if e.start >= t0 - 1e-6 and e.start < t1 - 1e-6 and (v.touched[e] or protected(v, e) or e.drum) then\n      return nil\n    end\n  end\n  local first, second = {}, {}\n  for _, m in ipairs(line) do\n    if #m.notes > 1 then return nil end\n    if m.e.start < t0 + half - 1e-6 then first[#first + 1] = m else second[#second + 1] = m end\n  end\n  if #first < 2 or #second < 1 then return nil end\n  -- Nothing else may be sounding: a melody alone.\n  for _, o in ipairs(v.notes) do\n    if not o.gone and o.start < t1 - 1e-6 and noteEnd(o) > t0 + 1e-6 then\n      local mine = false\n      for _, m in ipairs(line) do if m.top == o then mine = true end end\n      if not mine then return nil end\n    end\n  end\n  for _, dir in ipairs(coin(v.r, 0.7) and { -1, 1 } or { 1, -1 }) do\n    local copies, ok = {}, true\n    for _, m in ipairs(first) do\n      local n = m.top\n      local p, off = posOf(L, n.pitch)\n      local c = copyNote(n)\n      c.pitch, c.start = fromPos(v, L, p + dir, off), n.start + half\n      c.len = math.min(n.len, t1 - c.start)\n      if not inRange(v, c.pitch) then ok = false end\n      copies[#copies + 1] = c\n    end\n    if ok then\n      for _, m in ipairs(second) do m.top.gone = true end\n      -- The first half's last note stops where the copy begins.\n      local lens = {}\n      for i, m in ipairs(first) do\n        lens[i] = m.top.len\n        if noteEnd(m.top) > t0 + half + 1e-6 then m.top.len = t0 + half - m.top.start end\n      end\n      local bad = false\n      for _, c in ipairs(copies) do\n        if clashes(v, nil, c.pitch, c.start, noteEnd(c), around(v.byTime, c.start, noteEnd(c))) then bad = true end\n      end\n      if not bad then\n        for _, c in ipairs(copies) do add(v, c) end\n        return (\"its first half again, %s %s, in place of the second\"):format(\n          distance(L, dir, copies[1].pitch - first[1].top.pitch), dir < 0 and \"lower\" or \"higher\")\n      end\n      -- Grinds somewhere: put it all back and try the other direction.\n      for _, m in ipairs(second) do m.top.gone = nil end\n      for i, m in ipairs(first) do m.top.len = lens[i] end\n    end\n  end\n  return nil\nend\n\nM.DEVELOP_MOVES = DEVELOP\n\n--[[  One stretch of the music developed. `x` is how far into the develop\n      range the amount is, 0 to 1: the further, the longer the stretch -\n      a bar or two at first, up to the whole phrase at 100%.\n\n      The stretch is whole bars (half bars for music of a bar or less),\n      placed as the Where setting asks. Returns the change, or nil. ]]\nfunction M.developOnce(v, x)\n  v.byTime = noteIndex(v.notes)\n  local said, name, u, t0, t1 = M.developStretch(v, x)\n  v.byTime = nil\n  return said, name, u, t0, t1\nend\n\nfunction M.developStretch(v, x)\n  local an, src = v.an, v.src\n  local first, last = an.events[1], an.events[#an.events]\n  if not first then return nil end\n  local unit = src.barBeats\n  local b0 = math.floor(first.start / unit + 1e-6)\n  local b1 = math.floor(last.start / unit + 1e-6)\n  if b1 - b0 < 1 then unit = unit / 2; b0, b1 = math.floor(first.start / unit + 1e-6), math.floor(last.start / unit + 1e-6) end\n  local units = b1 - b0 + 1\n  local L = ladder(an)\n  if #L < 2 then return nil end\n  local h = v.history or {}\n\n  for _ = 1, 4 do\n    local most = math.max(1, math.ceil(units * (0.35 + 0.65 * x)))\n    local k = math.max(1, (most + 1) // 2 + math.floor(v.r() * (most - (most + 1) // 2 + 1)))\n    k = math.min(k, units)\n    local starts, ws = {}, {}\n    for u = b0, b1 - k + 1 do\n      local t0, t1 = u * unit, (u + k) * unit\n      local mid = math.max(0, math.min(1, ((t0 + t1) / 2 - src.lead) / math.max(src.beats - src.lead, 1e-9)))\n      local w = focusWeight(v, { pos = mid })\n      w = w / (1 + 2 * (h[\"develop@\" .. u] or 0))\n      starts[#starts + 1], ws[#ws + 1] = u, w\n    end\n    local u = choose(v.r, starts, ws)\n    if u then\n      local t0, t1 = u * unit, (u + k) * unit\n      local line = spanMoments(v, t0, t1)\n      if #line > 0 then\n        local names, mw = {}, {}\n        for _, m in ipairs(M.DEVELOP.moves) do\n          names[#names + 1] = m[1]\n          mw[#mw + 1] = m[2] / (1 + 2 * (h[m[1]] or 0))\n        end\n        while #names > 0 do\n          local name, i = choose(v.r, names, mw)\n          table.remove(names, i); table.remove(mw, i)\n          local said = DEVELOP[name](v, L, line, t0, t1)\n          if said then\n            for _, m in ipairs(line) do v.touched[m.e] = true end\n            for _, e in ipairs(an.events) do\n              if e.start >= t0 - 1e-6 and e.start < t1 - 1e-6 and not protected(v, e) then v.touched[e] = true end\n            end\n            v.chosen = line[1].e\n            return (\"%s: %s\"):format(spanName(v, t0, t1), said), name, u, t0, t1\n          end\n        end\n      end\n    end\n  end\n  return nil\nend\n\n------------------------------------------------------------------------------\n-- Feel\n------------------------------------------------------------------------------\n\nlocal function applyFeel(v, s)\n  local r, o = v.r, v.opts\n  if s <= 0 then return end\n  local span = math.max(v.src.beats - v.src.lead, 1e-9)\n\n  if o.timing then\n    -- Each moment moves as one, so a chord stays a chord; its notes get a\n    -- hair of their own on top.\n    local shift = {}\n    for _, n in ipairs(v.notes) do\n      local key = n.event or n\n      if not shift[key] then\n        local d = bell(r) * 2 * M.TIMING_SD * s\n        shift[key] = math.max(-M.TIMING_MAX * s, math.min(M.TIMING_MAX * s, d))\n      end\n      n.start = n.start + shift[key] + (r() - 0.5) * 2 * M.TIMING_CHORD * s\n    end\n  end\n\n  if o.velocity then\n    -- A whole-phrase lift or drop, a slow swell across it, and a little per\n    -- note. The accents of the original stay where they were.\n    local whole = bell(r) * 2 * M.VEL_WHOLE * s\n    local cycles, phase = between(r, 0.5, 1.5), between(r, 0, 2 * math.pi)\n    for _, n in ipairs(v.notes) do\n      local x = (n.start - v.src.lead) / span\n      local swell = M.VEL_SWELL * s * math.sin(2 * math.pi * cycles * x + phase)\n      n.vel = n.vel + whole + swell + (r() - 0.5) * 2 * M.VEL_JITTER * s\n    end\n  end\n\n  if o.lengths then\n    -- Played a touch more legato or more detached overall, and each note a\n    -- little its own. A note may grow only up to the next moment: a chord\n    -- held a little longer must not ring on into the next chord, where its\n    -- B would grind against the new chord's C.\n    local starts = {}\n    for _, n in ipairs(v.notes) do if not n.gone then starts[#starts + 1] = n.start end end\n    table.sort(starts)\n    local function nextStart(t)\n      local lo, hi = 1, #starts + 1\n      while lo < hi do\n        local mid = (lo + hi) // 2\n        if starts[mid] > t then hi = mid else lo = mid + 1 end\n      end\n      return starts[lo] or math.huge\n    end\n    local whole = 1 + (r() - 0.5) * 2 * M.LEN_WHOLE * s\n    for _, n in ipairs(v.notes) do\n      local was = noteEnd(n)\n      n.len = n.len * whole * (1 + (r() - 0.5) * 2 * M.LEN_NOTE * s)\n      local limit = math.max(was, nextStart(n.start + M.ONSET))\n      if noteEnd(n) > limit then n.len = limit - n.start end\n    end\n  end\nend\n\n-- Leaves the notes playable: inside the item, no note shorter than MIN_LEN,\n-- no two notes of one pitch on one channel overlapping, velocities 1-127.\n-- An overlap the original itself has (two notes it plays exactly as written)\n-- is left as it is: a variation does not correct the music it varies.\nlocal function tidy(v)\n  local out, same = {}, {}\n  for _, n in ipairs(v.notes) do\n    if not n.gone then\n      -- Inside its own item, when several are varied together.\n      local edge = v.src.parts and v.src.parts[n.part or 1] or v.src\n      local s = math.max(n.start, edge.lead)\n      local e = math.min(noteEnd(n), edge.beats)\n      if e - s >= M.MIN_LEN - 1e-9 then\n        local t = {\n          pitch = math.max(0, math.min(127, math.floor(n.pitch + 0.5))),\n          start = s, len = e - s,\n          vel = math.max(1, math.min(127, math.floor(n.vel + 0.5))),\n          chan = n.chan or 0, part = n.part,\n        }\n        local o = n.orig\n        same[t] = o and o.pitch == t.pitch and o.start == t.start and o.len == t.len\n        out[#out + 1] = t\n      end\n    end\n  end\n  table.sort(out, byStart)\n  local lastOf, keep = {}, {}\n  for _, n in ipairs(out) do\n    local k = (n.part or 0) * 2048 + n.chan * 128 + n.pitch\n    local prev = lastOf[k]\n    if prev and noteEnd(prev) > n.start + 1e-9 and not (same[prev] and same[n]) then\n      prev.len = n.start - prev.start\n      if prev.len < M.MIN_LEN then prev.dead = true end\n    end\n    lastOf[k] = n\n  end\n  for _, n in ipairs(out) do if not n.dead then keep[#keep + 1] = n end end\n  return keep\nend\n\n------------------------------------------------------------------------------\n-- Making a variation\n------------------------------------------------------------------------------\n\n-- How many changes to make: `want` on average, never more than `cap`.\nfunction M.budget(amount, count)\n  if amount <= 0 or count == 0 then return 0, 0 end\n  local want = amount * (1 + count / M.CHANGES_PER)\n  local cap = math.max(1, math.ceil(count * M.CAP_SHARE))\n  return want, cap\nend\n\n--[[  Unticking a change.\n\n      The window lists a variation's changes with a box each; unticking\n      one takes that change out and leaves every other one exactly as it\n      was. So the moves still all run, drawing the same dice, and each\n      remembers what it did (`record`); at the end the unticked ones are\n      undone (`undo`): their notes back as they were, their added notes\n      gone. A note a later change touched again keeps the later change.\n      Added notes are marked gone, not removed, so the feel - which draws\n      dice note by note - falls on every other note exactly as before. ]]\nlocal FIELDS = { \"pitch\", \"start\", \"len\", \"gone\" }\n\nlocal function snapshot(v)\n  local snap = { count = #v.notes }\n  for i, n in ipairs(v.notes) do snap[i] = { n.pitch, n.start, n.len, n.gone or false } end\n  return snap\nend\n\n-- What one change did: { { note, field, before, after }, ... } and the\n-- notes it added.\nlocal function record(v, snap)\n  local diff, added = {}, {}\n  for i = 1, snap.count do\n    local n = v.notes[i]\n    for f, field in ipairs(FIELDS) do\n      local now = n[field] or (field == \"gone\" and false or nil)\n      if now ~= snap[i][f] then diff[#diff + 1] = { n, field, snap[i][f], now } end\n    end\n  end\n  for i = snap.count + 1, #v.notes do added[#added + 1] = v.notes[i] end\n  return { diff = diff, added = added }\nend\n\nlocal function undo(rec)\n  for k = #rec.diff, 1, -1 do\n    local d = rec.diff[k]\n    local now = d[1][d[2]] or (d[2] == \"gone\" and false or nil)\n    if now == d[4] then d[1][d[2]] = d[3] or nil end\n  end\n  for _, n in ipairs(rec.added) do n.gone = true end\nend\n\n--[[  One variation of the original `src`, analysed as `an`.\n\n      opts: amount (0-1), focus (1-3), keepEnds, and each kind and feel key\n            (notes, rhythm, add, remove, chords, timing, velocity, lengths)\n            true or false. `skip`, if given, is a set of change ids (each\n            change's `id`, the order it was made in) to leave out.\n      seed: which variation - the same seed always gives the same one.\n\n      history: optional, shared by a series (see `candidates`); added to.\n\n      Returns { notes = {...}, changes = { \"Bar 2, beat 3: ...\", ... },\n      moves = { { text, move, kind, at, event, id, skipped }, ... } }, the\n      changes in the order they happen in the music. `changes` lists only\n      the ones kept; `moves` all of them, the unticked marked `skipped`. ]]\nfunction M.vary(src, an, opts, seed, T, history)\n  local r = M.random(seed)\n  local v = { src = src, an = an, opts = opts, r = r, T = T, touched = {}, notes = {},\n              history = history, move = \"\" }\n\n  -- Working copies of the original's notes, each remembering its moment.\n  local copyOf = {}\n  for _, e in ipairs(an.events) do\n    local copies = {}\n    for i, n in ipairs(e.notes) do\n      local c = copyNote(n)\n      c.event, c.orig = e, n\n      copies[i] = c\n      v.notes[#v.notes + 1] = c\n    end\n    copyOf[e] = copies\n  end\n  -- The analysis's own events point at the copies while the moves run, so\n  -- the original's notes are never touched.\n  local saved = {}\n  for _, e in ipairs(an.events) do\n    saved[e] = { notes = e.notes, top = e.top, bass = e.bass }\n    e.notes = copyOf[e]\n    e.top, e.bass = e.notes[#e.notes], e.notes[1]\n  end\n\n  local amount = math.max(0, math.min(1, opts.amount or 0))\n  local want, cap = M.budget(amount, an.count)\n  local changes = {}\n  -- Unticked changes: each change's doing is recorded, to be undone.\n  local skip = opts.skip and next(opts.skip) and opts.skip\n  local records = {}\n  local goal = 0\n  if want > 0 then goal = math.min(cap, math.max(1, math.floor(want + r()))) end\n  -- Home: the original again, played afresh - no changes, only the feel.\n  if opts.home then goal = 0 end\n\n  local kinds, kindWeights = {}, {}\n  for _, k in ipairs(M.KINDS) do\n    if opts[k.key] then\n      kinds[#kinds + 1] = k\n      kindWeights[#kindWeights + 1] = 1\n    end\n  end\n\n  -- Near 100%, first, perhaps one bigger change: a stretch developed. It\n  -- draws no dice at all below DEVELOP_FROM, so everything gentler is\n  -- exactly what it was before develop existed.\n  if opts.develop and amount > M.DEVELOP_FROM and goal > 0 and not an.drums then\n    local x = (amount - M.DEVELOP_FROM) / (1 - M.DEVELOP_FROM)\n    local c = M.DEVELOP_CHANCE\n    if coin(r, c[1] + (c[2] - c[1]) * x) then\n      local snap = skip and snapshot(v)\n      local said, name, u, t0, t1 = M.developOnce(v, x)\n      if said then\n        local e = v.chosen\n        changes[#changes + 1] = { text = said, move = name, kind = \"develop\", at = e.start, event = e.index,\n                                  from = t0, to = t1, id = #changes + 1 }\n        if snap then records[#changes] = record(v, snap) end\n        if history then\n          history[\"develop@\" .. u] = (history[\"develop@\" .. u] or 0) + 1\n          history[name] = (history[name] or 0) + 1\n          history[\"@\" .. e.index] = (history[\"@\" .. e.index] or 0) + 1\n        end\n      end\n    end\n  end\n\n  local tries = 0\n  while #changes < goal and #kinds > 0 and tries < 40 do\n    tries = tries + 1\n    local kind = choose(r, kinds, kindWeights)\n    local names, ws = {}, {}\n    for _, m in ipairs(kind.moves) do\n      -- The arpeggio move is offered only where there are arpeggios, so the\n      -- dice for everything else fall exactly as they did before it.\n      if m[1] ~= \"arpeggio\" or #an.broken > 0 then names[#names + 1] = m[1]; ws[#ws + 1] = m[2] end\n    end\n    local name = choose(r, names, ws)\n    v.move, v.chosen = name, nil\n    local snap = skip and snapshot(v)\n    local said = MOVES[name](v)\n    if said then\n      local e = v.chosen\n      changes[#changes + 1] = { text = said, move = name, kind = kind.key, at = e.start, event = e.index,\n                                id = #changes + 1 }\n      if snap then records[#changes] = record(v, snap) end\n      if history then\n        history[\"@\" .. e.index] = (history[\"@\" .. e.index] or 0) + 1\n        history[name .. \"@\" .. e.index] = (history[name .. \"@\" .. e.index] or 0) + 1\n      end\n    end\n  end\n\n  for _, e in ipairs(an.events) do\n    e.notes, e.top, e.bass = saved[e].notes, saved[e].top, saved[e].bass\n  end\n\n  -- The unticked ones undone, latest first.\n  if skip then\n    for id = #changes, 1, -1 do\n      if skip[id] then undo(records[id]); changes[id].skipped = true end\n    end\n  end\n\n  -- An echo plays the same changes with a feel of its own.\n  if opts.feelSeed then v.r = M.random(opts.feelSeed) end\n  applyFeel(v, math.sqrt(amount))\n  local notes = tidy(v)\n  table.sort(changes, function(a, b) return a.at < b.at end)\n  local texts = {}\n  for _, c in ipairs(changes) do if not c.skipped then texts[#texts + 1] = c.text end end\n  return { notes = notes, changes = texts, moves = changes }\nend\n\n--[[  Forms: what a batch plays after the original, A.\n\n      A motif that keeps coming back does not have to come back different\n      every time. A form says, for each place in the batch, which\n      variation plays there: 0 is home - the original again, played\n      afresh, only its feel new - and 1, 2, 3... are the batch's own\n      variations, A', A'', A'''. A number that has played before is an\n      echo: the same changes, with a feel of its own. ]]\nM.FORMS = {\n  { name = \"All New\",      hint = \"A new variation every time.\",\n    slot = function(i) return i end },\n  { name = \"Home Between\", hint = \"The original comes back between the variations, played afresh.\",\n    slot = function(i) return i % 2 == 0 and 0 or (i + 1) // 2 end },\n  { name = \"In Pairs\",     hint = \"Each variation stated, then echoed: the same changes, played afresh.\",\n    slot = function(i) return (i + 1) // 2 end },\n  { name = \"A Refrain\",    hint = \"The first variation keeps coming back between new ones.\",\n    slot = function(i) return i % 2 == 1 and 1 or i // 2 + 1 end },\n}\n\n-- \"A' A A'' A\": the letters a form gives `count` places.\nfunction M.formLetters(form, count)\n  local f = M.FORMS[form] or M.FORMS[1]\n  local out = {}\n  for i = 1, count do\n    local k = f.slot(i)\n    out[i] = k == 0 and \"A\" or (k <= 3 and (\"A\" .. (\"'\"):rep(k)) or (\"A(\" .. k .. \")\"))\n  end\n  return table.concat(out, \" \")\nend\n\n--[[  A run of variations, each made from the original - never from the one\n      before it. With `grow`, the first ones are gentler and the last one\n      gets the full amount, so a repeated motif can build. `history` may be\n      passed in to carry on from an earlier batch of the same original.\n      `opts.form` picks a form (M.FORMS; All New when nil). `skips[i]`, if\n      given, is the set of changes unticked in the i-th; an echo follows\n      the place it echoes, so its own entry is never read.\n\n      Each one carries `home` (it is the original again) or `echo` (the\n      place it echoes), for the window. ]]\nfunction M.series(src, an, opts, baseSeed, count, T, j, history, skips)\n  local out = {}\n  history = history or {}\n  local form = M.FORMS[opts.form or 1] or M.FORMS[1]\n  local first = {}   -- variation number -> the place it first played\n  -- The memory as each first statement found it, so an echo draws the\n  -- same dice (a copy each time: an echo adds nothing to it).\n  local memoryAt = {}\n  local function copy(h) local c = {}; for k, x in pairs(h) do c[k] = x end; return c end\n  local function optsAt(i, extra)\n    local o = {}\n    for k, x in pairs(opts) do o[k] = x end\n    if opts.grow and count > 1 then o.amount = opts.amount * (0.4 + 0.6 * (i - 1) / (count - 1)) end\n    for k, x in pairs(extra or {}) do o[k] = x end\n    return o\n  end\n  for i = 1, count do\n    local k = form.slot(i)\n    local seed = M.seedFor(baseSeed, i - 1, j)\n    if k == 0 then\n      out[i] = M.vary(src, an, optsAt(i, { home = true }), seed, T)\n      out[i].home = true\n    elseif first[k] then\n      -- An echo: the place it echoes, its seed and its unticked changes,\n      -- and only the feel its own.\n      local f = first[k]\n      out[i] = M.vary(src, an, optsAt(f, { skip = skips and skips[f], feelSeed = seed + 1 }),\n                      M.seedFor(baseSeed, f - 1, j), T, copy(memoryAt[f]))\n      out[i].echo = f\n    else\n      first[k] = i\n      memoryAt[i] = copy(history)\n      out[i] = M.vary(src, an, optsAt(i, { skip = skips and skips[i] }), seed, T, history)\n    end\n  end\n  return out\nend\n\n--[[  How much of the original a variation keeps: the share of the original's\n      notes still there at the same pitch, starting within a sixteenth of\n      where they did. ]]\nfunction M.likeness(original, variation)\n  if #original == 0 then return 1 end\n  local byPitch = {}\n  for _, b in ipairs(variation) do\n    byPitch[b.pitch] = byPitch[b.pitch] or {}\n    table.insert(byPitch[b.pitch], b)\n  end\n  local used, kept = {}, 0\n  for _, a in ipairs(original) do\n    for _, b in ipairs(byPitch[a.pitch] or {}) do\n      if not used[b] and math.abs(b.start - a.start) <= 0.13 then\n        used[b] = true\n        kept = kept + 1\n        break\n      end\n    end\n  end\n  return kept / #original\nend\n\n------------------------------------------------------------------------------\n-- Varying several items as one piece\n--\n-- A melody on one track and its chords on another, selected together, are\n-- one piece of music: a changed melody note must not grind against the\n-- chords, a changed chord must not grind against the tune, and the key is\n-- heard from both. So the items that overlap in time are put on one\n-- timeline (`combine`), each note remembering its part, varied as one, and\n-- given back to their items (`split`).\n------------------------------------------------------------------------------\n\n-- Items that sound together, in groups: each source joins the group of\n-- the one before it if they overlap in time and share a metre. `srcs` are\n-- sorted by start, as mv_place reads them, and carry startQN and lengthQN.\n-- Returns { { 1, 2 }, { 3 }, ... } - indices into srcs.\nfunction M.groups(srcs)\n  local out, last, finish = {}, nil, -math.huge\n  for j, s in ipairs(srcs) do\n    local first = last and srcs[last[1]]\n    if last and s.startQN < finish - 1e-6 and s.barBeats == first.barBeats and s.pulse == first.pulse then\n      last[#last + 1] = j\n    else\n      last = { j }\n      out[#out + 1] = last\n      finish = -math.huge\n    end\n    finish = math.max(finish, s.startQN + s.lengthQN)\n  end\n  return out\nend\n\n--[[  The sources of a group on one timeline, from the earliest bar line.\n      Each note carries `part` (its source's place in `srcs`); `parts[k]`\n      keeps each source's own edges and how far it was moved, for tidy and\n      split. The result is a source like any other. ]]\nfunction M.combine(srcs)\n  local base = math.huge\n  for _, s in ipairs(srcs) do base = math.min(base, s.originQN) end\n  local out = { notes = {}, parts = {}, lead = math.huge, beats = -math.huge,\n                barBeats = srcs[1].barBeats, pulse = srcs[1].pulse, num = srcs[1].num, den = srcs[1].den }\n  for k, s in ipairs(srcs) do\n    local shift = s.originQN - base\n    out.parts[k] = { lead = s.lead + shift, beats = s.beats + shift, shift = shift }\n    out.lead, out.beats = math.min(out.lead, s.lead + shift), math.max(out.beats, s.beats + shift)\n    for _, n in ipairs(s.notes) do\n      out.notes[#out.notes + 1] = { pitch = n.pitch, start = n.start + shift, len = n.len,\n                                    vel = n.vel, chan = n.chan, part = k }\n    end\n  end\n  return out\nend\n\n-- A variation of a combined source, given back to its parts: a list of\n-- note lists, each on its own source's timeline.\nfunction M.split(notes, combined)\n  local out = {}\n  for k = 1, #combined.parts do out[k] = {} end\n  for _, n in ipairs(notes) do\n    local p = combined.parts[n.part or 1]\n    table.insert(out[n.part or 1], { pitch = n.pitch, start = n.start - p.shift, len = n.len,\n                                     vel = n.vel, chan = n.chan })\n  end\n  return out\nend\n\n------------------------------------------------------------------------------\n-- Keeping the original inside a variation\n--\n-- Every variation item carries its original's notes, so a variation of a\n-- variation is really a fresh variation of the original, and the original\n-- can always be put back. Positions are stored from the item's own start,\n-- so they hold wherever the item is moved.\n------------------------------------------------------------------------------\n\nlocal function num(x)\n  local s = (\"%.6f\"):format(x):gsub(\"0+$\", \"\"):gsub(\"%.$\", \"\")\n  return s\nend\n\n-- notes: from the item's start. Returns one line of text.\nfunction M.encode(notes, length, name, index)\n  local parts = { \"MV1\", num(length), tostring(index or 0),\n                  ((name or \"\"):gsub(\"[|\\n\\r]\", \" \")) }\n  local body = {}\n  for _, n in ipairs(notes) do\n    body[#body + 1] = table.concat({ n.pitch, num(n.start), num(n.len), n.vel or 100, n.chan or 0 }, \",\")\n  end\n  return table.concat(parts, \"|\") .. \"|\" .. table.concat(body, \";\")\nend\n\n-- The opposite of encode. Returns notes, length, name, index - or nil for\n-- anything that is not something encode wrote.\nfunction M.decode(text)\n  if type(text) ~= \"string\" or text:sub(1, 4) ~= \"MV1|\" then return nil end\n  local length, index, name, body = text:match(\"^MV1|([^|]*)|([^|]*)|([^|]*)|(.*)$\")\n  length, index = tonumber(length), tonumber(index)\n  if not length or not index then return nil end\n  local notes = {}\n  for chunk in body:gmatch(\"[^;]+\") do\n    local p, s, l, vel, c = chunk:match(\"^(%-?%d+),([^,]+),([^,]+),(%d+),(%d+)$\")\n    p, s, l, vel, c = tonumber(p), tonumber(s), tonumber(l), tonumber(vel), tonumber(c)\n    if not (p and s and l and vel and c) then return nil end\n    notes[#notes + 1] = { pitch = p, start = s, len = l, vel = vel, chan = c }\n  end\n  return notes, length, name, index\nend\n\nreturn M\n"};

/* ---- kit/runtime/polyfill.js ---- */
/* What JavaScriptCore lacks and the Lua runtime uses: TextEncoder and
 * TextDecoder, UTF-8 only, as the web defines them (an invalid byte decodes
 * to U+FFFD and decoding goes on). Installed only where they are missing, so
 * Node and browsers keep their own; MiddawUTF8 is the same code, always, for
 * the tests to hold against the real thing.
 */
(function (G) {
  'use strict';
  function encode(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var d = str.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
        else c = 0xFFFD;
      } else if (c >= 0xD800 && c <= 0xDFFF) c = 0xFFFD;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  function decode(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    var out = '', i = 0, n = b.length;
    while (i < n) {
      var c = b[i], need = 0, cp = 0, min = 0;
      if (c < 0x80) { out += String.fromCharCode(c); i++; continue; }
      else if (c >= 0xC2 && c <= 0xDF) { need = 1; cp = c & 0x1F; min = 0x80; }
      else if (c >= 0xE0 && c <= 0xEF) { need = 2; cp = c & 0x0F; min = 0x800; }
      else if (c >= 0xF0 && c <= 0xF4) { need = 3; cp = c & 0x07; min = 0x10000; }
      else { out += '�'; i++; continue; }
      var j = 1, ok = true;
      for (; j <= need; j++) {
        if (i + j >= n) { ok = false; break; }
        var x = b[i + j];
        // the second byte's range is narrower for a few leads (no overlongs, no surrogates)
        var lo = 0x80, hi = 0xBF;
        if (j === 1) {
          if (c === 0xE0) lo = 0xA0; else if (c === 0xED) hi = 0x9F;
          else if (c === 0xF0) lo = 0x90; else if (c === 0xF4) hi = 0x8F;
        }
        if (x < lo || x > hi) { ok = false; break; }
        cp = (cp << 6) | (x & 0x3F);
      }
      if (!ok || cp < min) { out += '�'; i += Math.max(1, j); continue; }
      if (cp >= 0x10000) { cp -= 0x10000; out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
      else out += String.fromCharCode(cp);
      i += need + 1;
    }
    return out;
  }
  function Enc() {}
  Enc.prototype.encode = function (s) { return encode(String(s === undefined ? '' : s)); };
  function Dec() {}
  Dec.prototype.decode = function (b) { return decode(b); };
  G.MiddawUTF8 = { TextEncoder: Enc, TextDecoder: Dec };
  if (typeof G.TextEncoder === 'undefined') G.TextEncoder = Enc;
  if (typeof G.TextDecoder === 'undefined') G.TextDecoder = Dec;
})(typeof globalThis !== 'undefined' ? globalThis : this);


/* ---- kit/runtime/lua_parse.js ---- */
/* Middaw's Lua 5.4, part 1 of 3: the lexer and the parser.
 *
 * Middaw runs the family's Lua engines (Good Idea, Midi Suggester, Midi
 * Variator, Midi Catalogue, Starting Blocks, DAW Battle Pass...) unchanged, in
 * the browser, with no third-party code: this file reads Lua source into a
 * syntax tree, lua_compile.js turns the tree into JavaScript, lua_runtime.js
 * supplies the values and the standard library. tests/js/test_lua.js holds
 * all three to what the real Lua 5.4 prints for the same programs.
 *
 * Source is a "byte string": one JS character per byte of the file, which is
 * how Lua itself sees a string, so `#s` and string.sub count bytes as Lua does.
 */
(function (NS) {
  'use strict';

  var KEYWORDS = {};
  ('and break do else elseif end false for function goto if in local nil not ' +
   'or repeat return then true until while').split(' ').forEach(function (k) { KEYWORDS[k] = true; });

  function LuaSyntaxError(message, chunk, line) {
    this.message = chunk + ':' + line + ': ' + message;
    this.line = line;
  }
  LuaSyntaxError.prototype = Object.create(Error.prototype);
  LuaSyntaxError.prototype.name = 'LuaSyntaxError';

  function isDigit(c) { return c >= 48 && c <= 57; }
  function isHex(c) { return isDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70); }
  function isAlpha(c) { return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95; }
  function isSpace(c) { return c === 32 || (c >= 9 && c <= 13); }

  // ---------------------------------------------------------------- lexer --
  function lex(src, chunk) {
    var toks = [];
    var i = 0, n = src.length, line = 1;
    function err(msg) { throw new LuaSyntaxError(msg, chunk, line); }
    function longBracketLevel(at) {   // at points to '['; returns level or -1
      var j = at + 1, level = 0;
      while (src.charCodeAt(j) === 61) { level++; j++; }
      return src.charCodeAt(j) === 91 ? level : -1;
    }
    function readLong(at, level) {    // returns [content, end index]
      var start = at + level + 2;
      // a newline straight after the opening bracket is skipped
      if (src[start] === '\r') { start++; if (src[start] === '\n') start++; }
      else if (src[start] === '\n') { start++; if (src[start] === '\r') start++; }
      var close = ']' + '='.repeat(level) + ']';
      var end = src.indexOf(close, start);
      if (end < 0) err('unfinished long string');
      var body = src.slice(start, end);
      for (var k = at; k < end + close.length; k++) if (src.charCodeAt(k) === 10) line++;
      return [body, end + close.length];
    }
    while (i < n) {
      var c = src.charCodeAt(i);
      if (c === 10) { line++; i++; continue; }
      if (isSpace(c)) { i++; continue; }
      if (c === 45 && src.charCodeAt(i + 1) === 45) {           // comment
        i += 2;
        if (src.charCodeAt(i) === 91) {
          var lvl = longBracketLevel(i);
          if (lvl >= 0) { i = readLong(i, lvl)[1]; continue; }
        }
        while (i < n && src.charCodeAt(i) !== 10) i++;
        continue;
      }
      var tline = line;
      if (isAlpha(c)) {
        var j = i + 1;
        while (j < n && (isAlpha(src.charCodeAt(j)) || isDigit(src.charCodeAt(j)))) j++;
        var word = src.slice(i, j);
        toks.push(KEYWORDS[word] ? { t: word, line: tline } : { t: 'name', v: word, line: tline });
        i = j; continue;
      }
      if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
        var j2 = i, isFloat = false, text;
        if (c === 48 && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
          j2 = i + 2;
          while (j2 < n) {
            var d = src.charCodeAt(j2);
            if (isHex(d) || d === 46) { if (d === 46) isFloat = true; j2++; }
            else if ((d === 112 || d === 80)) {
              isFloat = true; j2++;
              if (src[j2] === '+' || src[j2] === '-') j2++;
            } else break;
          }
        } else {
          while (j2 < n) {
            var e = src.charCodeAt(j2);
            if (isDigit(e) || e === 46) { if (e === 46) isFloat = true; j2++; }
            else if (e === 101 || e === 69) {
              isFloat = true; j2++;
              if (src[j2] === '+' || src[j2] === '-') j2++;
            } else break;
          }
        }
        text = src.slice(i, j2);
        if (j2 < n && (isAlpha(src.charCodeAt(j2)))) err("malformed number near '" + text + src[j2] + "'");
        toks.push({ t: 'number', v: text, line: tline });
        i = j2; continue;
      }
      if (c === 34 || c === 39) {                                // short string
        var q = c, out = [], k = i + 1;
        for (;;) {
          if (k >= n) err('unfinished string');
          var ch = src.charCodeAt(k);
          if (ch === q) { k++; break; }
          if (ch === 10) err('unfinished string');
          if (ch === 92) {
            var x = src[k + 1];
            k += 2;
            switch (x) {
              case 'n': out.push('\n'); break;
              case 't': out.push('\t'); break;
              case 'r': out.push('\r'); break;
              case 'a': out.push('\x07'); break;
              case 'b': out.push('\b'); break;
              case 'f': out.push('\f'); break;
              case 'v': out.push('\v'); break;
              case '\\': out.push('\\'); break;
              case '"': out.push('"'); break;
              case "'": out.push("'"); break;
              case '\n': line++; out.push('\n'); break;
              case 'x': {
                var hx = src.slice(k, k + 2);
                if (!/^[0-9a-fA-F]{2}$/.test(hx)) err('hexadecimal digit expected');
                out.push(String.fromCharCode(parseInt(hx, 16))); k += 2; break;
              }
              case 'z': {
                while (k < n && isSpace(src.charCodeAt(k))) { if (src.charCodeAt(k) === 10) line++; k++; }
                break;
              }
              case 'u': {
                if (src[k] !== '{') err("missing '{' in \\u{xxxx}");
                var close = src.indexOf('}', k);
                var cp = parseInt(src.slice(k + 1, close), 16);
                k = close + 1;
                out.push(utf8Bytes(cp)); break;
              }
              default: {
                if (x !== undefined && isDigit(x.charCodeAt(0))) {
                  var digits = x; var m = 0;
                  while (m < 2 && isDigit(src.charCodeAt(k))) { digits += src[k]; k++; m++; }
                  var val = parseInt(digits, 10);
                  if (val > 255) err('decimal escape too large');
                  out.push(String.fromCharCode(val));
                } else err('invalid escape sequence');
              }
            }
            continue;
          }
          out.push(src[k]); k++;
        }
        toks.push({ t: 'string', v: out.join(''), line: tline });
        i = k; continue;
      }
      if (c === 91) {
        var lv = longBracketLevel(i);
        if (lv >= 0) {
          var r = readLong(i, lv);
          toks.push({ t: 'string', v: r[0], line: tline });
          i = r[1]; continue;
        }
      }
      var three = src.substr(i, 3), two = src.substr(i, 2);
      if (three === '...') { toks.push({ t: '...', line: tline }); i += 3; continue; }
      if (two === '==' || two === '~=' || two === '<=' || two === '>=' || two === '//' ||
          two === '::' || two === '<<' || two === '>>' || two === '..') {
        toks.push({ t: two, line: tline }); i += 2; continue;
      }
      var one = src[i];
      if ('+-*/%^#&~|<>=(){}[];:,.'.indexOf(one) >= 0) { toks.push({ t: one, line: tline }); i++; continue; }
      err("unexpected symbol near '" + one + "'");
    }
    toks.push({ t: '<eof>', line: line });
    return toks;
  }

  function utf8Bytes(cp) {
    if (cp < 0x80) return String.fromCharCode(cp);
    if (cp < 0x800) return String.fromCharCode(0xC0 | (cp >> 6), 0x80 | (cp & 63));
    if (cp < 0x10000) return String.fromCharCode(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    return String.fromCharCode(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }

  // --------------------------------------------------------------- parser --
  // Binary priorities exactly as lparser.c has them: { left, right }.
  var BINARY = {
    '+': [10, 10], '-': [10, 10], '*': [11, 11], '%': [11, 11], '^': [14, 13],
    '/': [11, 11], '//': [11, 11], '&': [6, 6], '|': [4, 4], '~': [5, 5],
    '<<': [7, 7], '>>': [7, 7], '..': [9, 8],
    '==': [3, 3], '<': [3, 3], '<=': [3, 3], '~=': [3, 3], '>': [3, 3], '>=': [3, 3],
    'and': [2, 2], 'or': [1, 1]
  };
  var UNARY_PRIORITY = 12;

  function parse(src, chunk) {
    chunk = chunk || '?';
    var toks = lex(src, chunk);
    var p = 0;
    function peek() { return toks[p]; }
    function next() { return toks[p++]; }
    function check(t) { return toks[p].t === t; }
    function err(msg, tok) {
      tok = tok || toks[p];
      var near = tok.t === '<eof>' ? '<eof>' : (tok.v !== undefined ? tok.v : tok.t);
      throw new LuaSyntaxError(msg + " near '" + near + "'", chunk, tok.line);
    }
    function expect(t, what) {
      if (toks[p].t !== t) err("'" + t + "' expected" + (what ? ' (to close ' + what + ')' : ''));
      return toks[p++];
    }
    function accept(t) { if (toks[p].t === t) { p++; return true; } return false; }
    function name() {
      if (toks[p].t !== 'name') err('<name> expected');
      return toks[p++].v;
    }

    function blockFollow(withUntil) {
      var t = toks[p].t;
      return t === 'else' || t === 'elseif' || t === 'end' || t === '<eof>' || (withUntil && t === 'until');
    }

    function block() {
      var body = [];
      while (!blockFollow(true)) {
        if (check('return')) { body.push(retstat()); break; }
        var s = statement();
        if (s) body.push(s);
      }
      return body;
    }

    function retstat() {
      var tok = next();
      var exprs = [];
      if (!blockFollow(true) && !check(';')) exprs = exprlist();
      accept(';');
      return { k: 'Return', exprs: exprs, line: tok.line };
    }

    function statement() {
      var tok = peek(), line = tok.line;
      switch (tok.t) {
        case ';': next(); return null;
        case 'if': return ifstat();
        case 'while': {
          next(); var cond = expr(); expect('do'); var b = block(); expect('end', 'while');
          return { k: 'While', cond: cond, body: b, line: line };
        }
        case 'do': { next(); var b2 = block(); expect('end', 'do'); return { k: 'Do', body: b2, line: line }; }
        case 'for': return forstat();
        case 'repeat': {
          next(); var b3 = block(); expect('until', 'repeat'); var c3 = expr();
          return { k: 'Repeat', body: b3, cond: c3, line: line };
        }
        case 'function': {
          next();
          var target = { k: 'Name', name: name(), line: line }, isMethod = false;
          while (check('.') || check(':')) {
            var sep = next().t;
            var key = name();
            target = { k: 'Index', obj: target, key: { k: 'String', v: key }, line: line };
            if (sep === ':') { isMethod = true; break; }
          }
          var f = funcbody(isMethod, line);
          return { k: 'Assign', targets: [target], exprs: [f], line: line };
        }
        case 'local': {
          next();
          if (accept('function')) {
            var nm = name();
            return { k: 'LocalFunction', name: nm, func: funcbody(false, line), line: line };
          }
          var names = [], attribs = [];
          do {
            names.push(name());
            if (accept('<')) { attribs.push(name()); expect('>'); } else attribs.push(null);
          } while (accept(','));
          var exprs = accept('=') ? exprlist() : [];
          return { k: 'Local', names: names, attribs: attribs, exprs: exprs, line: line };
        }
        case '::': { next(); var label = name(); expect('::'); return { k: 'Label', name: label, line: line }; }
        case 'return': return retstat();
        case 'break': next(); return { k: 'Break', line: line };
        case 'goto': next(); return { k: 'Goto', name: name(), line: line };
        default: return exprstat();
      }
    }

    function ifstat() {
      var line = next().line;
      var clauses = [];
      var cond = expr(); expect('then');
      clauses.push({ cond: cond, body: block() });
      var orelse = null;
      for (;;) {
        if (accept('elseif')) { var c = expr(); expect('then'); clauses.push({ cond: c, body: block() }); }
        else if (accept('else')) { orelse = block(); expect('end', 'if'); break; }
        else { expect('end', 'if'); break; }
      }
      return { k: 'If', clauses: clauses, orelse: orelse, line: line };
    }

    function forstat() {
      var line = next().line;
      var n1 = name();
      if (accept('=')) {
        var start = expr(); expect(',');
        var limit = expr();
        var step = accept(',') ? expr() : null;
        expect('do'); var b = block(); expect('end', 'for');
        return { k: 'NumFor', name: n1, start: start, limit: limit, step: step, body: b, line: line };
      }
      var names = [n1];
      while (accept(',')) names.push(name());
      expect('in');
      var exprs = exprlist();
      expect('do'); var body = block(); expect('end', 'for');
      return { k: 'GenFor', names: names, exprs: exprs, body: body, line: line };
    }

    function exprstat() {
      var line = peek().line;
      var e = suffixedexp();
      if (check('=') || check(',')) {
        var targets = [e];
        while (accept(',')) targets.push(suffixedexp());
        expect('=');
        var exprs = exprlist();
        targets.forEach(function (t) { if (t.k !== 'Name' && t.k !== 'Index') err('syntax error'); });
        return { k: 'Assign', targets: targets, exprs: exprs, line: line };
      }
      if (e.k !== 'Call' && e.k !== 'Method') err('syntax error');
      return { k: 'ExprStat', expr: e, line: line };
    }

    function exprlist() {
      var list = [expr()];
      while (accept(',')) list.push(expr());
      return list;
    }

    function funcbody(isMethod, line) {
      var params = isMethod ? ['self'] : [], vararg = false;
      expect('(');
      if (!check(')')) {
        do {
          if (accept('...')) { vararg = true; break; }
          params.push(name());
        } while (accept(','));
      }
      expect(')');
      var b = block();
      var endTok = expect('end', 'function');
      return { k: 'Function', params: params, vararg: vararg, body: b, line: line, endLine: endTok.line };
    }

    function primaryexp() {
      var tok = peek();
      if (tok.t === 'name') { next(); return { k: 'Name', name: tok.v, line: tok.line }; }
      if (tok.t === '(') {
        next(); var e = expr(); expect(')');
        return { k: 'Paren', expr: e, line: tok.line };
      }
      err('unexpected symbol');
    }

    function suffixedexp() {
      var e = primaryexp();
      for (;;) {
        var tok = peek();
        switch (tok.t) {
          case '.': next(); e = { k: 'Index', obj: e, key: { k: 'String', v: name() }, line: tok.line }; break;
          case '[': next(); var key = expr(); expect(']'); e = { k: 'Index', obj: e, key: key, line: tok.line }; break;
          case ':': next(); var m = name(); e = { k: 'Method', obj: e, name: m, args: callargs(), line: tok.line }; break;
          case '(': case 'string': case '{': e = { k: 'Call', fn: e, args: callargs(), line: tok.line }; break;
          default: return e;
        }
      }
    }

    function callargs() {
      var tok = peek();
      if (tok.t === 'string') { next(); return [{ k: 'String', v: tok.v }]; }
      if (tok.t === '{') return [tablecons()];
      expect('(');
      if (accept(')')) return [];
      var args = exprlist();
      expect(')');
      return args;
    }

    function tablecons() {
      var line = expect('{').line;
      var items = [];   // { kind: 'pos'|'named'|'keyed', key, value }
      while (!check('}')) {
        if (check('name') && toks[p + 1].t === '=') {
          var key = next().v; next();
          items.push({ kind: 'keyed', key: { k: 'String', v: key }, value: expr() });
        } else if (check('[')) {
          next(); var k = expr(); expect(']'); expect('=');
          items.push({ kind: 'keyed', key: k, value: expr() });
        } else {
          items.push({ kind: 'pos', value: expr() });
        }
        if (!accept(',') && !accept(';')) break;
      }
      expect('}', 'table');
      return { k: 'Table', items: items, line: line };
    }

    function simpleexp() {
      var tok = peek();
      switch (tok.t) {
        case 'number': next(); return { k: 'Number', v: tok.v, line: tok.line };
        case 'string': next(); return { k: 'String', v: tok.v };
        case 'nil': next(); return { k: 'Nil' };
        case 'true': next(); return { k: 'True' };
        case 'false': next(); return { k: 'False' };
        case '...': next(); return { k: 'Vararg', line: tok.line };
        case '{': return tablecons();
        case 'function': next(); return funcbody(false, tok.line);
        default: return suffixedexp();
      }
    }

    function expr(limit) {
      limit = limit || 0;
      var left, tok = peek();
      if (tok.t === 'not' || tok.t === '-' || tok.t === '#' || tok.t === '~') {
        next();
        left = { k: 'Unop', op: tok.t, expr: expr(UNARY_PRIORITY), line: tok.line };
      } else {
        left = simpleexp();
      }
      for (;;) {
        var op = peek().t, pr = BINARY[op];
        if (!pr || pr[0] <= limit) break;
        var line = next().line;
        var right = expr(pr[1]);
        left = { k: 'Binop', op: op, left: left, right: right, line: line };
      }
      return left;
    }

    var body = block();
    if (!check('<eof>')) err("'<eof>' expected");
    return { k: 'Chunk', body: body };
  }

  NS.lex = lex;
  NS.parse = parse;
  NS.LuaSyntaxError = LuaSyntaxError;
  NS.utf8Bytes = utf8Bytes;
})(typeof module === 'object' && module.exports
  ? (module.exports = (globalThis.MiddawLua = globalThis.MiddawLua || {}))
  : (globalThis.MiddawLua = globalThis.MiddawLua || {}));


/* ---- kit/runtime/lua_runtime.js ---- */
/* Middaw's Lua 5.4, part 3 of 3: values, operators and the standard library.
 *
 * Values, as JavaScript sees them:
 *   nil      undefined
 *   boolean  true / false
 *   number   a JS number. An integral JS number is a Lua *integer*; a
 *            non-integral one (or inf, nan) is a Lua *float*. A float whose
 *            value happens to be integral (4.0, 2/2) is an LFloat, so that it
 *            still prints "4.0" and math.type still says "float".
 *   string   a JS string with one character per byte (0-255)
 *   table    LuaTable
 *   function a JS function: Lua arguments in, and undefined, one value, or a
 *            Multi for two or more results.
 *
 * Wherever the result has to match the real Lua byte for byte - table.sort
 * with ties, the pattern matcher, math.random, number formatting - the code
 * is a port of Lua 5.4's own C, not a lookalike.
 */
(function (NS) {
  'use strict';

  // ------------------------------------------------------------ values ----
  function LFloat(n) { this.n = n; }
  LFloat.prototype.valueOf = function () { return this.n; };

  function mkf(x) { return Number.isInteger(x) ? new LFloat(x) : x; }
  function isNum(v) { return typeof v === 'number' || v instanceof LFloat; }
  function num(v) { return typeof v === 'number' ? v : v.n; }
  function isFloatVal(v) { return v instanceof LFloat || (typeof v === 'number' && !Number.isInteger(v)); }

  function Multi(a) { this.a = a; }
  function first(v) { return v instanceof Multi ? v.a[0] : v; }
  // `return` with no values gives NONE; a bare undefined is one nil.
  var NONE = new Multi([]);
  var NIL1 = Object.freeze([undefined]);
  function sp(v) {
    if (v instanceof Multi) return v.a;
    return v === undefined ? NIL1 : [v];
  }
  function ret(list) {
    if (list.length === 0) return NONE;
    if (list.length === 1) return list[0];
    return new Multi(list);
  }

  var tableIds = 0;
  function LuaTable() { this.arr = []; this.hash = null; this.mt = null; this.id = 0; this.hver = 0; }
  LuaTable.prototype.get = function (k) {
    if (typeof k === 'number') {
      var a = this.arr;
      if (k > 0 && k <= a.length && Number.isInteger(k)) return a[k - 1];
    } else if (typeof k === 'string') {
      return this.hash === null ? undefined : this.hash.get(k);
    } else if (k instanceof LFloat) {
      return this.get(k.n);
    }
    return this.hash === null ? undefined : this.hash.get(k);
  };
  LuaTable.prototype.set = function (k, v) {
    if (typeof k === 'number') {
      if (Number.isInteger(k) && k > 0) {
        var a = this.arr, n = a.length;
        if (k <= n) {
          a[k - 1] = v;
          if (v === undefined && k === n) { while (a.length && a[a.length - 1] === undefined) a.pop(); }
          return;
        }
        if (k === n + 1) {
          if (v === undefined) { if (this.hash !== null) this.hash.delete(k); return; }
          a.push(v);
          if (this.hash !== null && this.hash.size) {
            var h = this.hash;
            while (h.has(a.length + 1)) { var nk = a.length + 1; a.push(h.get(nk)); h.delete(nk); }
          }
          return;
        }
      } else if (k !== k) {
        throw rterror('table index is NaN');
      }
    } else if (k instanceof LFloat) {
      return this.set(k.n, v);
    } else if (k === undefined) {
      throw rterror('table index is nil');
    }
    if (v === undefined) { if (this.hash !== null) this.hash.delete(k); return; }
    if (this.hash === null) this.hash = new Map();
    if (!this.hash.has(k)) this.hver++;
    this.hash.set(k, v);
  };
  LuaTable.prototype.length = function () { return this.arr.length; };

  // ------------------------------------------------------------ errors ----
  // Compiled chunks register their line maps here, so an error can say
  // "gi_idea.lua:1234:" as the real Lua would.
  var lineMaps = {};
  function luaPosition(level) {
    var stack = new Error().stack || '';
    var re = /lua:([^:\s()]+):(\d+):\d+/g, m, found = 0;
    while ((m = re.exec(stack)) !== null) {
      found++;
      if (found >= level) {
        var map = lineMaps[m[1]];
        var line = map ? map[Number(m[2]) - 1] : undefined;
        if (line) return m[1] + ':' + line + ': ';
        return m[1] + ': ';
      }
    }
    return '';
  }
  function LuaError(value, traceback) {
    this.value = value;
    this.message = typeof value === 'string' ? value : tostring(value);
    this.luaTraceback = traceback;
    this.stack = new Error().stack;
  }
  LuaError.prototype = Object.create(Error.prototype);
  LuaError.prototype.name = 'LuaError';
  function rterror(msg) { return new LuaError(luaPosition(1) + msg); }

  function typeName(v) {
    if (v === undefined || v === null) return 'nil';
    switch (typeof v) {
      case 'boolean': return 'boolean';
      case 'number': return 'number';
      case 'string': return 'string';
      case 'function': return 'function';
    }
    if (v instanceof LFloat) return 'number';
    if (v instanceof LuaTable) return 'table';
    return 'userdata';
  }

  // --------------------------------------------------------- numbers ----
  // Exact decimal expansion of a double: x = D * 10^-s, D a BigInt.
  var F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
  function exactDecimal(x) {
    F64[0] = x;
    var hi = U32[1], lo = U32[0];
    var exp = (hi >>> 20) & 0x7ff;
    var mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    if (exp === 0) exp = 1; else mant |= 1n << 52n;
    var e = exp - 1075;
    if (e >= 0) return { D: mant << BigInt(e), s: 0 };
    return { D: mant * (5n ** BigInt(-e)), s: -e };
  }
  function roundDiv(N, div) {      // round N/div half to even
    var q = N / div, r = N % div;
    var twice = r * 2n;
    if (twice > div || (twice === div && (q & 1n) === 1n)) q += 1n;
    return q;
  }
  function fixedDigits(x, f) {     // |x| to f decimals, C-exact; returns string
    var ex = exactDecimal(Math.abs(x));
    var q;
    if (f >= ex.s) q = ex.D * (10n ** BigInt(f - ex.s));
    else q = roundDiv(ex.D, 10n ** BigInt(ex.s - f));
    var s = q.toString();
    if (f === 0) return s;
    while (s.length <= f) s = '0' + s;
    return s.slice(0, s.length - f) + '.' + s.slice(s.length - f);
  }
  function expDigits(x, prec) {    // |x| as d.ddd with prec decimals; returns [mantissa, exponent]
    if (x === 0) return [prec > 0 ? '0.' + '0'.repeat(prec) : '0', 0];
    var ex = exactDecimal(Math.abs(x));
    var D = ex.D.toString();
    var X = D.length - 1 - ex.s;
    var P = prec + 1, q;
    if (D.length > P) {
      q = roundDiv(ex.D, 10n ** BigInt(D.length - P)).toString();
      if (q.length > P) { q = q.slice(0, P); X++; }
    } else q = D + '0'.repeat(P - D.length);
    return [prec > 0 ? q[0] + '.' + q.slice(1) : q, X];
  }
  function fmtExp(x, prec, upper) {
    var r = expDigits(x, prec);
    var X = r[1];
    var s = r[0] + (upper ? 'E' : 'e') + (X < 0 ? '-' : '+') + (Math.abs(X) < 10 ? '0' : '') + Math.abs(X);
    return s;
  }
  function stripZeros(s) {
    if (s.indexOf('.') < 0) return s;
    s = s.replace(/0+$/, '');
    return s.replace(/\.$/, '');
  }
  function fmtG(x, P, upper, alt) {   // C's %g of |x|
    if (P === 0) P = 1;
    if (x === 0) return '0';
    var X = expDigits(x, P - 1)[1];
    var s;
    if (X < -4 || X >= P) {
      var r = expDigits(x, P - 1);
      var m = alt ? r[0] : stripZeros(r[0]);
      s = m + (upper ? 'E' : 'e') + (r[1] < 0 ? '-' : '+') + (Math.abs(r[1]) < 10 ? '0' : '') + Math.abs(r[1]);
    } else {
      s = fixedDigits(x, P - 1 - X);
      if (!alt) s = stripZeros(s);
    }
    return s;
  }
  function floatStr(x) {
    if (x === Infinity) return 'inf';
    if (x === -Infinity) return '-inf';
    if (x !== x) return (1 / x) < 0 ? 'nan' : '-nan';
    var neg = x < 0 || (x === 0 && 1 / x < 0);
    var s = (neg ? '-' : '') + fmtG(x, 14, false, false);
    if (/^-?\d+$/.test(s)) s += '.0';
    return s;
  }
  function intStr(n) {
    if (Math.abs(n) <= 9007199254740992) return String(n === 0 ? 0 : n);
    return BigInt(n).toString();
  }
  // io.write prints a float with LUA_NUMBER_FMT alone: 1.0 is "1".
  function writeNum(v) {
    if (!isNum(v)) throw rterror('bad argument to \'write\' (string expected, got ' + typeName(v) + ')');
    if (typeof v === 'number' && Number.isInteger(v)) return intStr(v);
    var x = num(v);
    if (x === Infinity) return 'inf';
    if (x === -Infinity) return '-inf';
    if (x !== x) return '-nan';
    return (x < 0 || (x === 0 && 1 / x < 0) ? '-' : '') + fmtG(Math.abs(x), 14, false, false);
  }
  function numStr(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? intStr(v) : floatStr(v);
    return floatStr(v.n);
  }

  // lua_stringtonumber: a whole numeral, spaces either side, or undefined.
  function str2num(s) {
    var t = s.replace(/^[ \f\n\r\t\v]+|[ \f\n\r\t\v]+$/g, '');
    var m;
    if ((m = /^([+-])?0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?(?:[pP]([+-]?\d+))?$/.exec(t))) {
      var ip = m[2], fp = m[3], ex = m[4];
      if (!ip && !fp) return undefined;
      var neg = m[1] === '-';
      if (fp === undefined && ex === undefined) {
        var big = BigInt.asIntN(64, BigInt('0x' + ip));
        var n = Number(big);
        return neg ? 0 - n : n;
      }
      var val = 0;
      for (var i = 0; i < ip.length; i++) val = val * 16 + parseInt(ip[i], 16);
      var scale = 1 / 16;
      fp = fp || '';
      for (var j = 0; j < fp.length; j++) { val += parseInt(fp[j], 16) * scale; scale /= 16; }
      if (ex) val *= Math.pow(2, Number(ex));
      return mkf(neg ? -val : val);
    }
    if ((m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.exec(t))) {
      var isInt = m[1].indexOf('.') < 0 && !m[2];
      var v = Number(t);
      if (isInt) {
        if (Math.abs(v) <= 9223372036854775807) return v;
        return mkf(v);
      }
      return mkf(v);
    }
    return undefined;
  }

  function toNumberArith(v, op) {
    if (typeof v === 'number') return v;
    if (v instanceof LFloat) return v;
    if (typeof v === 'string') { var n = str2num(v); if (n !== undefined) return n; }
    return null;
  }
  function arithError(op, a, b) {
    var bad = (isNum(a) || (typeof a === 'string' && str2num(a) !== undefined)) ? b : a;
    if (op === 'concat') return rterror('attempt to concatenate a ' + typeName(bad) + ' value');
    if (op === 'bit') return rterror('attempt to perform bitwise operation on a ' + typeName(bad) + ' value');
    return rterror('attempt to perform arithmetic on a ' + typeName(bad) + ' value');
  }
  function metaOf(v) {
    if (v instanceof LuaTable) return v.mt;
    if (typeof v === 'string') return stringMeta;
    return null;
  }
  function metaBin(ev, a, b) {
    var mt = metaOf(a), h = mt && mt.get(ev);
    if (h === undefined) { mt = metaOf(b); h = mt && mt.get(ev); }
    if (h === undefined || h === null) return NOMETA;
    return first(call(h)(a, b));
  }
  var NOMETA = {};

  function arithSlow(op, a, b, ev) {
    var x = toNumberArith(a), y = toNumberArith(b);
    if (x === null || y === null) {
      var r = metaBin(ev, a, b);
      if (r !== NOMETA) return r;
      throw arithError(op, a, b);
    }
    switch (op) {
      case 'add': return add(x, y);
      case 'sub': return sub(x, y);
      case 'mul': return mul(x, y);
      case 'div': return div(x, y);
      case 'mod': return mod(x, y);
      case 'idiv': return idiv(x, y);
      case 'pow': return pow(x, y);
    }
  }
  function add(a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      var r = a + b;
      return (Number.isInteger(a) && Number.isInteger(b)) ? r : mkf(r);
    }
    if (isNum(a) && isNum(b)) return mkf(num(a) + num(b));
    return arithSlow('add', a, b, '__add');
  }
  function sub(a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      var r = a - b;
      return (Number.isInteger(a) && Number.isInteger(b)) ? r : mkf(r);
    }
    if (isNum(a) && isNum(b)) return mkf(num(a) - num(b));
    return arithSlow('sub', a, b, '__sub');
  }
  function mul(a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      var r = a * b;
      if (Number.isInteger(a) && Number.isInteger(b)) return r === 0 ? 0 : r;
      return mkf(r);
    }
    if (isNum(a) && isNum(b)) return mkf(num(a) * num(b));
    return arithSlow('mul', a, b, '__mul');
  }
  function div(a, b) {
    if (isNum(a) && isNum(b)) return mkf(num(a) / num(b));
    return arithSlow('div', a, b, '__div');
  }
  function idiv(a, b) {
    if (typeof a === 'number' && typeof b === 'number' && Number.isInteger(a) && Number.isInteger(b)) {
      if (b === 0) throw rterror("attempt to perform 'n//0'");
      var q = Math.floor(a / b);
      return q === 0 ? 0 : q;
    }
    if (isNum(a) && isNum(b)) return mkf(Math.floor(num(a) / num(b)));
    return arithSlow('idiv', a, b, '__idiv');
  }
  function mod(a, b) {
    if (typeof a === 'number' && typeof b === 'number' && Number.isInteger(a) && Number.isInteger(b)) {
      if (b === 0) throw rterror("attempt to perform 'n%%0'");
      var r = a % b;
      if (r !== 0 && (r < 0) !== (b < 0)) r += b;
      return r === 0 ? 0 : r;
    }
    if (isNum(a) && isNum(b)) {
      var x = num(a), y = num(b);
      var m;
      if (y === Infinity || y === -Infinity) m = x;
      else m = x % y;
      if ((m > 0) ? y < 0 : (m < 0 && y !== m)) m += y;
      return mkf(m);
    }
    return arithSlow('mod', a, b, '__mod');
  }
  function pow(a, b) {
    if (isNum(a) && isNum(b)) return mkf(Math.pow(num(a), num(b)));
    return arithSlow('pow', a, b, '__pow');
  }
  function unm(a) {
    if (typeof a === 'number') return Number.isInteger(a) ? 0 - a : -a;
    if (a instanceof LFloat) return new LFloat(-a.n);
    var x = toNumberArith(a);
    if (x !== null) return unm(x);
    var mt = metaOf(a), h = mt && mt.get('__unm');
    if (h !== undefined && h !== null) return first(call(h)(a, a));
    throw rterror('attempt to perform arithmetic on a ' + typeName(a) + ' value');
  }

  // Bitwise operations work on 64-bit integers.
  function toInt64(v, a, b) {
    var x = typeof v === 'string' ? str2num(v) : v;
    if (typeof x === 'number' && Number.isInteger(x)) return BigInt(x);
    if (x instanceof LFloat) return BigInt(x.n);
    if (typeof x === 'number') throw rterror('number has no integer representation');
    throw arithError('bit', a, b);
  }
  function fromInt64(big) { return Number(BigInt.asIntN(64, big)); }
  function small(a, b) {
    return typeof a === 'number' && typeof b === 'number' && (a | 0) === a && (b | 0) === b;
  }
  function band(a, b) { if (small(a, b)) return a & b; return bitSlow('__band', a, b, function (x, y) { return x & y; }); }
  function bor(a, b) { if (small(a, b)) return a | b; return bitSlow('__bor', a, b, function (x, y) { return x | y; }); }
  function bxor(a, b) { if (small(a, b)) return a ^ b; return bitSlow('__bxor', a, b, function (x, y) { return x ^ y; }); }
  function shiftLeft(x, n) {
    if (n <= -64n || n >= 64n) return 0n;
    if (n >= 0n) return BigInt.asUintN(64, x << n);
    return BigInt.asUintN(64, x) >> (-n);
  }
  function shl(a, b) { return bitSlow('__shl', a, b, function (x, y) { return shiftLeft(x, y); }); }
  function shr(a, b) { return bitSlow('__shr', a, b, function (x, y) { return shiftLeft(x, -y); }); }
  function bnot(a) {
    if (typeof a === 'number' && (a | 0) === a) return ~a;
    var mt = metaOf(a), h = mt && mt.get('__bnot');
    if (h !== undefined && h !== null && !isNum(a)) return first(call(h)(a, a));
    return fromInt64(~toInt64(a, a, a));
  }
  function bitSlow(ev, a, b, f) {
    if (!((isNum(a) || typeof a === 'string') && (isNum(b) || typeof b === 'string'))) {
      var r = metaBin(ev, a, b);
      if (r !== NOMETA) return r;
    }
    return fromInt64(f(toInt64(a, a, b), toInt64(b, a, b)));
  }

  function concat(a, b) {
    var ta = typeof a, tb = typeof b;
    if (ta === 'string' && tb === 'string') return a + b;
    if ((ta === 'string' || isNum(a)) && (tb === 'string' || isNum(b))) {
      return (ta === 'string' ? a : numStr(a)) + (tb === 'string' ? b : numStr(b));
    }
    var r = metaBin('__concat', a, b);
    if (r !== NOMETA) return r;
    throw arithError('concat', a, b);
  }

  function len(v) {
    if (typeof v === 'string') return v.length;
    if (v instanceof LuaTable) {
      if (v.mt !== null) {
        var h = v.mt.get('__len');
        if (h !== undefined) return first(call(h)(v));
      }
      return v.arr.length;
    }
    var mt = metaOf(v), h2 = mt && mt.get('__len');
    if (h2 !== undefined && h2 !== null) return first(call(h2)(v));
    throw rterror('attempt to get length of a ' + typeName(v) + ' value');
  }

  function eq(a, b) {
    if (a === b) return true;
    var ta = typeof a, tb = typeof b;
    if (ta === 'object' || tb === 'object') {
      if (isNum(a) && isNum(b)) return num(a) === num(b);
      if (a instanceof LuaTable && b instanceof LuaTable) {
        var h = (a.mt && a.mt.get('__eq')) || (b.mt && b.mt.get('__eq'));
        if (h) return truthy(first(call(h)(a, b)));
      }
    }
    return false;
  }
  function lt(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a < b;
    if (isNum(a) && isNum(b)) return num(a) < num(b);
    if (typeof a === 'string' && typeof b === 'string') return a < b;
    var r = metaBin('__lt', a, b);
    if (r !== NOMETA) return truthy(r);
    throw compareError(a, b);
  }
  function le(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a <= b;
    if (isNum(a) && isNum(b)) return num(a) <= num(b);
    if (typeof a === 'string' && typeof b === 'string') return a <= b;
    var r = metaBin('__le', a, b);
    if (r !== NOMETA) return truthy(r);
    throw compareError(a, b);
  }
  function gt(a, b) { return lt(b, a); }
  function ge(a, b) { return le(b, a); }
  function compareError(a, b) {
    var t1 = typeName(a), t2 = typeName(b);
    if (t1 === t2) return rterror('attempt to compare two ' + t1 + ' values');
    return rterror('attempt to compare ' + t1 + ' with ' + t2);
  }
  function truthy(v) { return v !== undefined && v !== false && v !== null; }

  // ------------------------------------------------------- indexing ----
  function index(o, k, desc) {
    if (o instanceof LuaTable) {
      var v = o.get(k);
      if (v !== undefined || o.mt === null) return v;
      return metaIndex(o, k, desc);
    }
    if (typeof o === 'string') return stringLib.get(k);
    return metaIndex(o, k, desc);
  }
  function metaIndex(o, k, desc) {
    for (var loop = 0; loop < 100; loop++) {
      var h;
      if (o instanceof LuaTable) {
        var v = o.get(k);
        if (v !== undefined) return v;
        if (o.mt === null) return undefined;
        h = o.mt.get('__index');
        if (h === undefined) return undefined;
      } else {
        var mt = metaOf(o);
        h = mt && mt.get('__index');
        if (h === undefined || h === null) {
          throw rterror('attempt to index a ' + typeName(o) + ' value' + (desc ? ' (' + desc + ')' : ''));
        }
      }
      if (typeof h === 'function') return first(h(o, k));
      o = h;
    }
    throw rterror("'__index' chain too long; possible loop");
  }
  function setindex(o, k, v, desc) {
    if (o instanceof LuaTable) {
      if (o.mt === null) { o.set(k, v); return; }
      var h = o.mt.get('__newindex');
      if (h === undefined || o.get(k) !== undefined) { o.set(k, v); return; }
      if (typeof h === 'function') { h(o, k, v); return; }
      return setindex(h, k, v);
    }
    throw rterror('attempt to index a ' + typeName(o) + ' value' + (desc ? ' (' + desc + ')' : ''));
  }

  function call(f, desc) {
    if (typeof f === 'function') return f;
    var mt = metaOf(f), h = mt && mt.get('__call');
    if (typeof h === 'function') return function () {
      var args = [f];
      for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
      return h.apply(null, args);
    };
    throw rterror('attempt to call a ' + typeName(f) + ' value' + (desc ? ' (' + desc + ')' : ''));
  }
  function method(o, name) {
    var f = index(o, name, 'method \'' + name + '\'');
    if (typeof f !== 'function') f = call(f, "method '" + name + "'");
    var args = [o];
    for (var i = 2; i < arguments.length; i++) args.push(arguments[i]);
    return f.apply(null, args);
  }

  function tbl(list, keyed) {
    var t = new LuaTable();
    if (list.length) {
      var a = list.slice();
      while (a.length && a[a.length - 1] === undefined) a.pop();
      t.arr = a;
    }
    if (keyed) {
      for (var i = 0; i < keyed.length; i += 2) {
        if (keyed[i] === undefined) throw rterror('table index is nil');
        if (keyed[i + 1] !== undefined) t.set(keyed[i], keyed[i + 1]);
      }
    }
    return t;
  }

  // ------------------------------------------------------- iteration ----
  function IpairsIter(t) { this.t = t; this.i = 0; this.a = undefined; this.b = undefined; }
  IpairsIter.prototype.step = function () {
    var i = this.i + 1, v = this.t.get(i);
    if (v === undefined) return false;
    this.i = i; this.a = i; this.b = v; return true;
  };
  function PairsIter(t) { this.t = t; this.i = 0; this.it = null; this.a = undefined; this.b = undefined; }
  PairsIter.prototype.step = function () {
    var arr = this.t.arr;
    while (this.it === null && this.i < arr.length) {
      var v = arr[this.i++];
      if (v !== undefined) { this.a = this.i; this.b = v; return true; }
    }
    if (this.it === null) {
      if (this.t.hash === null) return false;
      this.it = this.t.hash.entries();
    }
    var n = this.it.next();
    if (n.done) return false;
    this.a = n.value[0]; this.b = n.value[1];
    return true;
  };
  function GenIter(f, s, c) { this.f = call(f, 'for iterator'); this.s = s; this.c = c; this.a = undefined; this.b = undefined; this.v = NONE; }
  GenIter.prototype.step = function () {
    var r = this.f(this.s, this.c);
    var v = r instanceof Multi ? r.a : [r];
    if (v[0] === undefined) return false;
    this.c = v[0]; this.a = v[0]; this.b = v[1]; this.v = v;
    return true;
  };
  function iter(f, s, c) {
    if (f === ipairsAux && s instanceof LuaTable && s.mt === null) return new IpairsIter(s);
    if (f === luaNext && s instanceof LuaTable && c === undefined && s.mt === null) return new PairsIter(s);
    return new GenIter(f, s, c);
  }

  function forprep(a, b, c) {
    if (c === undefined) c = 1;
    if (!isNum(a)) throw rterror("'for' initial value must be a number");
    if (!isNum(b)) throw rterror("'for' limit must be a number");
    if (!isNum(c)) throw rterror("'for' step must be a number");
    var x = num(a), lim = num(b), st = num(c);
    if (st === 0) throw rterror("'for' step is zero");
    var intLoop = typeof a === 'number' && Number.isInteger(a) && typeof c === 'number' && Number.isInteger(c);
    if (intLoop) {
      if (!(typeof b === 'number' && Number.isInteger(b))) {
        if (lim !== lim) return [1, 0, 1, false];
        lim = st > 0 ? Math.floor(lim) : Math.ceil(lim);
      }
      return [x, lim, st, false];
    }
    return [x, lim, st, true];
  }

  // ------------------------------------------------------- tostring ----
  function tostring(v) {
    if (v === undefined || v === null) return 'nil';
    switch (typeof v) {
      case 'string': return v;
      case 'number': return numStr(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'function': return 'function: ' + addressOf(v);
    }
    if (v instanceof LFloat) return floatStr(v.n);
    if (v instanceof LuaTable) {
      if (v.mt !== null) {
        var h = v.mt.get('__tostring');
        if (h !== undefined) {
          var s = first(call(h)(v));
          if (typeof s !== 'string') throw rterror("'__tostring' must return a string");
          return s;
        }
        var nm = v.mt.get('__name');
        if (typeof nm === 'string') return nm + ': ' + addressOf(v);
      }
      return 'table: ' + addressOf(v);
    }
    return 'userdata: ' + addressOf(v);
  }
  var addresses = new WeakMap(), nextAddress = 0x55d0c0de0000;
  function addressOf(o) {
    var a = addresses.get(o);
    if (a === undefined) { a = nextAddress; nextAddress += 0x40; addresses.set(o, a); }
    return '0x' + a.toString(16).padStart(14, '0');
  }

  // ===================================================== the library ======
  function argError(n, fname, msg) { return rterror("bad argument #" + n + " to '" + fname + "' (" + msg + ')'); }
  function checkTable(v, n, fname) {
    if (!(v instanceof LuaTable)) throw argError(n, fname, 'table expected, got ' + typeNameArg(v));
    return v;
  }
  function typeNameArg(v) { return v === undefined ? 'no value' : typeName(v); }
  function checkInt(v, n, fname) {
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    if (v instanceof LFloat) return v.n;
    if (typeof v === 'string') { var x = str2num(v); if (x !== undefined) return checkInt(x, n, fname); }
    if (typeof v === 'number') throw argError(n, fname, 'number has no integer representation');
    throw argError(n, fname, 'number expected, got ' + typeNameArg(v));
  }
  function optInt(v, n, fname, d) { return v === undefined ? d : checkInt(v, n, fname); }
  function checkNum(v, n, fname) {
    if (typeof v === 'number') return v;
    if (v instanceof LFloat) return v.n;
    if (typeof v === 'string') { var x = str2num(v); if (x !== undefined) return num(x); }
    throw argError(n, fname, 'number expected, got ' + typeNameArg(v));
  }
  function checkStr(v, n, fname) {
    if (typeof v === 'string') return v;
    if (isNum(v)) return numStr(v);
    throw argError(n, fname, 'string expected, got ' + typeNameArg(v));
  }

  function rawLen(t) { return t instanceof LuaTable ? t.arr.length : (typeof t === 'string' ? t.length : 0); }

  // ---------------------------------------------------------- base ------
  function luaNext(t, k) {
    checkTable(t, 1, 'next');
    var arr = t.arr, i = 0;
    if (k !== undefined) {
      if (typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= arr.length) i = k;
      else if (k instanceof LFloat && k.n >= 1 && k.n <= arr.length) i = k.n;
      else i = -1;
    }
    if (i >= 0) {
      for (; i < arr.length; i++) if (arr[i] !== undefined) return new Multi([i + 1, arr[i]]);
      if (t.hash === null) return undefined;
      var it = t.hash.entries().next();
      return it.done ? undefined : new Multi([it.value[0], it.value[1]]);
    }
    if (t.hash === null) throw rterror("invalid key to 'next'");
    if (t._nkver !== t.hver || !t._nk) {
      t._nk = Array.from(t.hash.keys());
      t._nki = new Map();
      for (var j = 0; j < t._nk.length; j++) t._nki.set(t._nk[j], j);
      t._nkver = t.hver;
    }
    var key = k instanceof LFloat ? k.n : k;
    var pos = t._nki.get(key);
    if (pos === undefined) throw rterror("invalid key to 'next'");
    for (pos++; pos < t._nk.length; pos++) {
      var kk = t._nk[pos];
      if (t.hash.has(kk)) return new Multi([kk, t.hash.get(kk)]);
    }
    return undefined;
  }
  function ipairsAux(t, i) {
    i = i + 1;
    var v = index(t, i);
    return v === undefined ? undefined : new Multi([i, v]);
  }

  function makeEnv(host) {
    host = host || {};
    var G = new LuaTable();
    function reg(t, name, f) { t.set(name, f); }

    reg(G, 'print', function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(tostring(arguments[i]));
      (host.print || function (s) { console.log(s); })(parts.join('\t'));
      return NONE;
    });
    reg(G, 'type', function (v) {
      if (arguments.length === 0) throw argError(1, 'type', 'value expected');
      return typeName(v);
    });
    reg(G, 'tostring', function (v) { return tostring(v); });
    reg(G, 'tonumber', function (v, base) {
      if (base === undefined) {
        if (isNum(v)) return v;
        if (typeof v === 'string') return str2num(v);
        if (arguments.length === 0) throw argError(1, 'tonumber', 'value expected');
        return undefined;
      }
      var b = checkInt(base, 2, 'tonumber');
      var s = checkStr(v, 1, 'tonumber').replace(/^\s+|\s+$/g, '').toLowerCase();
      var neg = false;
      if (s[0] === '-') { neg = true; s = s.slice(1); }
      if (!s.length) return undefined;
      var n = 0;
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        var d = c >= 48 && c <= 57 ? c - 48 : (c >= 97 && c <= 122 ? c - 87 : 99);
        if (d >= b) return undefined;
        n = n * b + d;
      }
      return neg ? -n : n;
    });
    reg(G, 'ipairs', function (t) {
      if (arguments.length === 0) throw argError(1, 'ipairs', 'table expected, got no value');
      return new Multi([ipairsAux, t, 0]);
    });
    reg(G, 'pairs', function (t) {
      if (t instanceof LuaTable && t.mt !== null) {
        var h = t.mt.get('__pairs');
        if (h !== undefined) { var r = sp(call(h)(t)); return new Multi([r[0], r[1], r[2]]); }
      }
      checkTable(t, 1, 'pairs');
      return new Multi([luaNext, t, undefined]);
    });
    reg(G, 'next', luaNext);
    reg(G, 'select', function (n) {
      var count = arguments.length - 1;
      if (n === '#') return count;
      var i = checkInt(n, 1, 'select');
      if (i < 0) i = count + i; else if (i === 0) throw argError(1, 'select', 'index out of range');
      else i = i - 1;
      if (i < 0) throw argError(1, 'select', 'index out of range');
      var out = [];
      for (var j = i + 1; j < arguments.length; j++) out.push(arguments[j]);
      return ret(out);
    });
    reg(G, 'rawget', function (t, k) { checkTable(t, 1, 'rawget'); return t.get(k); });
    reg(G, 'rawset', function (t, k, v) { checkTable(t, 1, 'rawset'); t.set(k, v); return t; });
    reg(G, 'rawequal', function (a, b) { return a === b || (isNum(a) && isNum(b) && num(a) === num(b)); });
    reg(G, 'rawlen', function (t) { return rawLen(t); });
    reg(G, 'setmetatable', function (t, mt) {
      checkTable(t, 1, 'setmetatable');
      if (t.mt && t.mt.get('__metatable') !== undefined) throw rterror('cannot change a protected metatable');
      t.mt = mt === undefined ? null : mt;
      return t;
    });
    reg(G, 'getmetatable', function (v) {
      var mt = metaOf(v);
      if (!mt) return undefined;
      var p = mt.get('__metatable');
      return p !== undefined ? p : mt;
    });
    reg(G, 'assert', function (v, msg) {
      if (truthy(v)) { return ret(Array.prototype.slice.call(arguments)); }
      if (arguments.length < 1) throw argError(1, 'assert', 'value expected');
      throw new LuaError(arguments.length >= 2 ? msg : 'assertion failed!');
    });
    reg(G, 'error', function (v, level) {
      var lv = level === undefined ? 1 : num(level);
      if (typeof v === 'string' && lv > 0) v = luaPosition(lv + 1) + v;
      throw new LuaError(v);
    });
    reg(G, 'pcall', function (f) {
      var args = Array.prototype.slice.call(arguments, 1);
      try {
        var r = call(f).apply(null, args);
        return new Multi([true].concat(sp(r)));
      } catch (e) {
        return new Multi([false, errorValue(e)]);
      }
    });
    reg(G, 'xpcall', function (f, handler) {
      var args = Array.prototype.slice.call(arguments, 2);
      try {
        var r = call(f).apply(null, args);
        return new Multi([true].concat(sp(r)));
      } catch (e) {
        return new Multi([false].concat(sp(call(handler)(errorValue(e)))));
      }
    });
    reg(G, 'collectgarbage', function (opt) { return opt === 'count' ? mkf(1024) : 0; });
    reg(G, 'load', function (chunk, name, mode, env) {
      var src = chunk;
      if (typeof chunk === 'function') {
        var pieces = [], piece;
        while ((piece = first(chunk())) !== undefined && piece !== '') pieces.push(piece);
        src = pieces.join('');
      }
      try {
        return NS.load(src, typeof name === 'string' ? name.replace(/^[=@]/, '') : 'chunk', env || G);
      } catch (e) {
        return new Multi([undefined, errorValue(e)]);
      }
    });
    reg(G, 'loadfile', function (path, mode, env) {
      var src = host.readFile ? host.readFile(path) : null;
      if (src === null || src === undefined) return new Multi([undefined, 'cannot open ' + path]);
      try { return NS.load(src, path, env || G); }
      catch (e) { return new Multi([undefined, errorValue(e)]); }
    });
    reg(G, 'dofile', function (path) {
      var src = host.readFile ? host.readFile(path) : null;
      if (src === null || src === undefined) throw rterror('cannot open ' + path);
      return NS.load(src, path, G)();
    });
    reg(G, 'require', function (name) {
      var loaded = G.get('package').get('loaded');
      var v = loaded.get(name);
      if (v !== undefined) return v;
      if (!host.require) throw rterror("module '" + name + "' not found");
      v = host.require(name);
      loaded.set(name, v === undefined ? true : v);
      return v === undefined ? true : v;
    });
    var pkg = new LuaTable(); pkg.set('loaded', new LuaTable()); pkg.set('path', './?.lua');
    G.set('package', pkg);
    G.set('_G', G);
    G.set('_VERSION', 'Lua 5.4');

    G.set('string', stringLib);
    G.set('table', makeTableLib());
    G.set('math', makeMathLib());
    G.set('os', makeOsLib(host));
    G.set('io', makeIoLib(host));
    G.set('utf8', makeUtf8Lib());
    pkg.get('loaded').set('string', stringLib);
    pkg.get('loaded').set('_G', G);
    return G;
  }
  function errorValue(e) {
    if (e instanceof LuaError) return e.value;
    if (e instanceof RangeError) return 'stack overflow';
    if (e && e.name === 'LuaSyntaxError') return e.message;
    return String(e && e.message ? e.message : e);
  }

  // --------------------------------------------------------- table ------
  function makeTableLib() {
    var T = new LuaTable();
    T.set('insert', function (t, a, b) {
      checkTable(t, 1, 'insert');
      var e = len(t) + 1;
      if (arguments.length === 2) { setindex(t, e, a); return NONE; }
      if (arguments.length !== 3) throw rterror("wrong number of arguments to 'insert'");
      var pos = checkInt(a, 2, 'insert');
      if (pos < 1 || pos > e) throw argError(2, 'insert', 'position out of bounds');
      if (t.mt === null && e - 1 === t.arr.length) {
        t.arr.splice(pos - 1, 0, b);
        if (b === undefined) { while (t.arr.length && t.arr[t.arr.length - 1] === undefined) t.arr.pop(); }
        return NONE;
      }
      for (var i = e; i > pos; i--) setindex(t, i, index(t, i - 1));
      setindex(t, pos, b);
      return NONE;
    });
    T.set('remove', function (t, p) {
      checkTable(t, 1, 'remove');
      var size = len(t);
      var pos = p === undefined ? size : checkInt(p, 2, 'remove');
      if (p !== undefined && pos !== size && (pos < 1 || pos > size + 1)) throw argError(2, 'remove', 'position out of bounds');
      var result = index(t, pos);
      if (t.mt === null && size === t.arr.length && pos >= 1 && pos <= size) {
        t.arr.splice(pos - 1, 1);
        while (t.arr.length && t.arr[t.arr.length - 1] === undefined) t.arr.pop();
        return result;
      }
      for (; pos < size; pos++) setindex(t, pos, index(t, pos + 1));
      setindex(t, pos, undefined);
      return result;
    });
    T.set('concat', function (t, sep, i, j) {
      checkTable(t, 1, 'concat');
      sep = sep === undefined ? '' : checkStr(sep, 2, 'concat');
      var a = optInt(i, 3, 'concat', 1), b = j === undefined ? len(t) : checkInt(j, 4, 'concat');
      var parts = [];
      for (var k = a; k <= b; k++) {
        var v = index(t, k);
        if (typeof v === 'string') parts.push(v);
        else if (isNum(v)) parts.push(numStr(v));
        else throw rterror("invalid value (at index " + k + ") in table for 'concat'");
      }
      return parts.join(sep);
    });
    T.set('unpack', function (t, i, j) {
      var a = optInt(i, 2, 'unpack', 1), b = j === undefined ? len(t) : checkInt(j, 3, 'unpack');
      var out = [];
      for (var k = a; k <= b; k++) out.push(index(t, k));
      return ret(out);
    });
    T.set('pack', function () {
      var t = tbl(Array.prototype.slice.call(arguments));
      t.set('n', arguments.length);
      return t;
    });
    T.set('move', function (a1, f, e, t, a2) {
      if (a2 === undefined) a2 = a1;
      f = checkInt(f, 2, 'move'); e = checkInt(e, 3, 'move'); t = checkInt(t, 4, 'move');
      if (e >= f) {
        if (t > e || t <= f || a1 !== a2) for (var i = 0; i <= e - f; i++) setindex(a2, t + i, index(a1, f + i));
        else for (var k = e - f; k >= 0; k--) setindex(a2, t + k, index(a1, f + k));
      }
      return a2;
    });
    T.set('sort', function (t, comp) {
      checkTable(t, 1, 'sort');
      var n = len(t);
      if (n > 1) {
        var a = new Array(n + 1);
        for (var i = 1; i <= n; i++) a[i] = index(t, i);
        var less;
        if (comp !== undefined) {
          var cf = call(comp);
          less = function (x, y) { return truthy(first(cf(x, y))); };
        } else less = lt;
        auxsort(a, 1, n, 0, less);
        for (var j = 1; j <= n; j++) setindex(t, j, a[j]);
      }
      return NONE;
    });
    return T;
  }

  // Lua 5.4's ltablib.c sort, line for line: ties come out in the same
  // order as in the real Lua, which matters to engines that sort with them.
  var RANLIMIT = 100;
  function auxsort(a, lo, up, rnd, less) {
    var t;
    while (lo < up) {
      if (less(a[up], a[lo])) { t = a[lo]; a[lo] = a[up]; a[up] = t; }
      if (up - lo === 1) break;
      var p;
      if (up - lo < RANLIMIT || rnd === 0) p = Math.floor((lo + up) / 2);
      else { var r4 = Math.floor((up - lo) / 4); p = rnd % (r4 * 2) + (lo + r4); }
      if (less(a[p], a[lo])) { t = a[p]; a[p] = a[lo]; a[lo] = t; }
      else if (less(a[up], a[p])) { t = a[p]; a[p] = a[up]; a[up] = t; }
      if (up - lo === 2) break;
      var P = a[p];
      t = a[p]; a[p] = a[up - 1]; a[up - 1] = t;
      // partition
      var i = lo, j = up - 1;
      for (;;) {
        while (less(a[++i], P)) {
          if (i === up - 1) throw rterror('invalid order function for sorting');
        }
        while (less(P, a[--j])) {
          if (j < i) throw rterror('invalid order function for sorting');
        }
        if (j < i) { t = a[up - 1]; a[up - 1] = a[i]; a[i] = t; break; }
        t = a[i]; a[i] = a[j]; a[j] = t;
      }
      p = i;
      var n;
      if (p - lo < up - p) { auxsort(a, lo, p - 1, rnd, less); n = p - lo; lo = p + 1; }
      else { auxsort(a, p + 1, up, rnd, less); n = up - p; up = p - 1; }
      if ((up - lo) / 128 > n) rnd = 0x5bd1e995;   // real Lua randomises here
    }
  }

  // ---------------------------------------------------------- math ------
  function makeMathLib() {
    var M = new LuaTable();
    M.set('pi', Math.PI);
    M.set('huge', Infinity);
    M.set('maxinteger', 9223372036854775807);
    M.set('mininteger', -9223372036854775808);
    M.set('abs', function (x) {
      if (typeof x === 'number') return Number.isInteger(x) ? (x < 0 ? 0 - x : x) : Math.abs(x);
      if (x instanceof LFloat) return new LFloat(Math.abs(x.n));
      return mkfOrInt(Math.abs(checkNum(x, 1, 'abs')), x);
    });
    M.set('floor', function (x) {
      if (typeof x === 'number' && Number.isInteger(x)) return x;
      var r = Math.floor(checkNum(x, 1, 'floor'));
      return r === 0 ? 0 : r;
    });
    M.set('ceil', function (x) {
      if (typeof x === 'number' && Number.isInteger(x)) return x;
      var r = Math.ceil(checkNum(x, 1, 'ceil'));
      return r === 0 ? 0 : r;
    });
    function minmax(isMax, name) {
      return function () {
        if (arguments.length === 0) throw argError(1, name, 'number expected, got no value');
        var best = arguments[0]; checkNum(best, 1, name);
        for (var i = 1; i < arguments.length; i++) {
          var v = arguments[i]; checkNum(v, i + 1, name);
          if (isMax ? lt(best, v) : lt(v, best)) best = v;
        }
        return best;
      };
    }
    M.set('max', minmax(true, 'max'));
    M.set('min', minmax(false, 'min'));
    function fl(f, name) { return function (x) { return mkf(f(checkNum(x, 1, name))); }; }
    M.set('sqrt', fl(Math.sqrt, 'sqrt'));
    M.set('sin', fl(Math.sin, 'sin'));
    M.set('cos', fl(Math.cos, 'cos'));
    M.set('tan', fl(Math.tan, 'tan'));
    M.set('asin', fl(Math.asin, 'asin'));
    M.set('acos', fl(Math.acos, 'acos'));
    M.set('exp', fl(Math.exp, 'exp'));
    M.set('atan', function (y, x) { return mkf(Math.atan2(checkNum(y, 1, 'atan'), x === undefined ? 1 : checkNum(x, 2, 'atan'))); });
    M.set('log', function (x, base) {
      var v = checkNum(x, 1, 'log');
      if (base === undefined) return mkf(Math.log(v));
      var b = checkNum(base, 2, 'log');
      if (b === 2) return mkf(Math.log2(v));
      if (b === 10) return mkf(Math.log10(v));
      return mkf(Math.log(v) / Math.log(b));
    });
    M.set('fmod', function (a, b) {
      if (typeof a === 'number' && typeof b === 'number' && Number.isInteger(a) && Number.isInteger(b)) {
        if (b === 0) throw argError(2, 'fmod', 'zero');
        return a % b === 0 ? 0 : a % b;
      }
      return mkf(checkNum(a, 1, 'fmod') % checkNum(b, 2, 'fmod'));
    });
    M.set('modf', function (x) {
      var v = checkNum(x, 1, 'modf');
      var ip = v >= 0 ? Math.floor(v) : Math.ceil(v);
      var fp = (v === Infinity || v === -Infinity) ? 0 : v - ip;
      return new Multi([mkf(ip), mkf(fp)]);
    });
    M.set('tointeger', function (x) {
      if (typeof x === 'number' && Number.isInteger(x)) return x;
      if (x instanceof LFloat) return x.n;
      if (typeof x === 'string') { var n = str2num(x); return n === undefined ? undefined : (typeof n === 'number' && Number.isInteger(n) ? n : (n instanceof LFloat ? n.n : undefined)); }
      return undefined;
    });
    M.set('type', function (x) {
      if (arguments.length === 0) throw argError(1, 'type', 'value expected');
      if (typeof x === 'number') return Number.isInteger(x) ? 'integer' : 'float';
      if (x instanceof LFloat) return 'float';
      return undefined;
    });
    M.set('ult', function (a, b) {
      return BigInt.asUintN(64, BigInt(checkInt(a, 1, 'ult'))) < BigInt.asUintN(64, BigInt(checkInt(b, 2, 'ult')));
    });

    // xoshiro256**, as lmathlib.c has it, on 64-bit BigInts.
    var MASK = (1n << 64n) - 1n;
    var state = [0n, 0n, 0n, 0n];
    function rotl(x, n) { return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK; }
    function nextrand() {
      var s0 = state[0], s1 = state[1], s2 = state[2] ^ s0, s3 = state[3] ^ s1;
      var res = (rotl((s1 * 5n) & MASK, 7) * 9n) & MASK;
      state[0] = s0 ^ s3;
      state[1] = s1 ^ s2;
      state[2] = s2 ^ ((s1 << 17n) & MASK);
      state[3] = rotl(s3, 45);
      return res;
    }
    function setseed(n1, n2) {
      state = [BigInt.asUintN(64, n1), 0xffn, BigInt.asUintN(64, n2), 0n];
      for (var i = 0; i < 16; i++) nextrand();
    }
    setseed(BigInt(Date.now()), 0n);
    function project(ran, n) {
      if ((n & (n + 1n)) === 0n) return ran & n;
      var lim = n;
      lim |= lim >> 1n; lim |= lim >> 2n; lim |= lim >> 4n; lim |= lim >> 8n;
      lim |= lim >> 16n; lim |= lim >> 32n;
      while ((ran &= lim) > n) ran = nextrand();
      return ran;
    }
    M.set('random', function (m, n) {
      var rv = nextrand();
      var low, up;
      switch (arguments.length) {
        case 0: return mkf(Number(rv >> 11n) * Math.pow(2, -53));
        case 1:
          low = 1n; up = BigInt(checkInt(m, 1, 'random'));
          if (up === 0n) return fromInt64(rv);
          break;
        case 2:
          low = BigInt(checkInt(m, 1, 'random')); up = BigInt(checkInt(n, 2, 'random'));
          break;
        default: throw rterror('wrong number of arguments');
      }
      if (!(low <= up)) throw argError(1, 'random', 'interval is empty');
      var p = project(rv, BigInt.asUintN(64, up - low));
      return fromInt64(p + BigInt.asUintN(64, low));
    });
    M.set('randomseed', function (a, b) {
      if (arguments.length === 0) { setseed(BigInt(Date.now()), 0n); return; }
      var n1 = isFloatVal(a) ? BigInt(Math.trunc(num(a))) : BigInt(checkInt(a, 1, 'randomseed'));
      var n2 = b === undefined ? 0n : BigInt(checkInt(b, 2, 'randomseed'));
      setseed(n1, n2);
      return new Multi([fromInt64(n1), fromInt64(n2)]);
    });
    return M;
  }
  function mkfOrInt(r, orig) { return isFloatVal(orig) ? mkf(r) : r; }

  // ------------------------------------------------------------ os ------
  function makeOsLib(host) {
    var O = new LuaTable();
    var now = host.now || function () { return Date.now(); };
    O.set('time', function (t) {
      if (t === undefined) return Math.floor(now() / 1000);
      checkTable(t, 1, 'time');
      function field(k, d) {
        var v = t.get(k);
        if (v === undefined) { if (d === undefined) throw rterror("field '" + k + "' missing in date table"); return d; }
        return num(v);
      }
      var d = new Date(field('year'), field('month') - 1, field('day'), field('hour', 12), field('min', 0), field('sec', 0));
      return Math.floor(d.getTime() / 1000);
    });
    O.set('clock', function () {
      var p = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      return mkf(p / 1000);
    });
    O.set('date', function (fmt, t) {
      fmt = fmt === undefined ? '%c' : checkStr(fmt, 1, 'date');
      var ms = t === undefined ? now() : num(t) * 1000;
      var utc = fmt[0] === '!';
      if (utc) fmt = fmt.slice(1);
      var d = new Date(ms);
      var g = utc
        ? { Y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds(), w: d.getUTCDay() }
        : { Y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), H: d.getHours(), M: d.getMinutes(), S: d.getSeconds(), w: d.getDay() };
      var start = utc ? Date.UTC(g.Y, 0, 1) : new Date(g.Y, 0, 1).getTime();
      var cur = utc ? Date.UTC(g.Y, g.m, g.d) : new Date(g.Y, g.m, g.d).getTime();
      var yday = Math.round((cur - start) / 86400000) + 1;
      if (fmt.slice(0, 2) === '*t') {
        var r = new LuaTable();
        r.set('year', g.Y); r.set('month', g.m + 1); r.set('day', g.d);
        r.set('hour', g.H); r.set('min', g.M); r.set('sec', g.S);
        r.set('wday', g.w + 1); r.set('yday', yday); r.set('isdst', false);
        return r;
      }
      var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      function p2(n) { return (n < 10 ? '0' : '') + n; }
      return fmt.replace(/%(.)/g, function (_, c) {
        switch (c) {
          case 'Y': return String(g.Y);
          case 'y': return p2(g.Y % 100);
          case 'm': return p2(g.m + 1);
          case 'd': return p2(g.d);
          case 'e': return (g.d < 10 ? ' ' : '') + g.d;
          case 'H': return p2(g.H);
          case 'I': return p2(((g.H + 11) % 12) + 1);
          case 'M': return p2(g.M);
          case 'S': return p2(g.S);
          case 'p': return g.H < 12 ? 'AM' : 'PM';
          case 'A': return DAYS[g.w];
          case 'a': return DAYS[g.w].slice(0, 3);
          case 'B': return MONTHS[g.m];
          case 'b': return MONTHS[g.m].slice(0, 3);
          case 'j': return String(yday).padStart(3, '0');
          case 'w': return String(g.w);
          case 'u': return String(g.w === 0 ? 7 : g.w);
          case 'x': return p2(g.m + 1) + '/' + p2(g.d) + '/' + p2(g.Y % 100);
          case 'X': return p2(g.H) + ':' + p2(g.M) + ':' + p2(g.S);
          case 'c': return DAYS[g.w].slice(0, 3) + ' ' + MONTHS[g.m].slice(0, 3) + ' ' + (g.d < 10 ? ' ' : '') + g.d + ' ' + p2(g.H) + ':' + p2(g.M) + ':' + p2(g.S) + ' ' + g.Y;
          case '%': return '%';
          default: return '%' + c;
        }
      });
    });
    O.set('getenv', function () { return undefined; });
    O.set('remove', function (path) {
      if (host.removeFile && host.removeFile(path)) return true;
      return new Multi([undefined, path + ': No such file or directory', 2]);
    });
    O.set('rename', function (a, b) {
      if (host.renameFile && host.renameFile(a, b)) return true;
      return new Multi([undefined, a + ': No such file or directory', 2]);
    });
    O.set('exit', function () { throw new LuaError('os.exit called'); });
    O.set('tmpname', function () { return '/tmp/lua_' + Math.random().toString(36).slice(2); });
    return O;
  }

  // ------------------------------------------------------------ io ------
  // Files live wherever the host keeps them (host.readFile / host.writeFile):
  // Battle Pass keeps its save file this way.
  function makeIoLib(host) {
    var IO = new LuaTable();
    var fileMeta = new LuaTable();
    var fileMethods = new LuaTable();
    fileMeta.set('__index', fileMethods);
    fileMeta.set('__name', 'FILE*');
    function newFile(path, mode, data) {
      var f = new LuaTable();
      f.mt = fileMeta;
      f._path = path; f._mode = mode; f._data = data; f._pos = 0; f._closed = false;
      return f;
    }
    IO.set('open', function (path, mode) {
      path = checkStr(path, 1, 'open');
      mode = mode === undefined ? 'r' : checkStr(mode, 2, 'open');
      var m = mode.replace('b', '');
      if (m[0] === 'r') {
        var data = host.readFile ? host.readFile(path) : null;
        if (data === null || data === undefined) return new Multi([undefined, path + ': No such file or directory', 2]);
        return newFile(path, m, data);
      }
      if (m[0] === 'w') return newFile(path, m, '');
      if (m[0] === 'a') {
        var old = host.readFile ? host.readFile(path) : null;
        var f = newFile(path, m, old || '');
        f._pos = f._data.length;
        return f;
      }
      throw argError(2, 'open', 'invalid mode');
    });
    fileMethods.set('read', function (f) {
      var fmts = Array.prototype.slice.call(arguments, 1);
      if (!fmts.length) fmts = ['l'];
      var out = [];
      for (var i = 0; i < fmts.length; i++) {
        var fm = fmts[i];
        if (isNum(fm)) {
          var n = num(fm);
          if (f._pos >= f._data.length && n > 0) { out.push(undefined); break; }
          out.push(f._data.substr(f._pos, n)); f._pos += n; continue;
        }
        fm = String(fm).replace(/^\*/, '');
        if (fm[0] === 'a') { out.push(f._data.slice(f._pos)); f._pos = f._data.length; continue; }
        if (fm[0] === 'l' || fm[0] === 'L') {
          if (f._pos >= f._data.length) { out.push(undefined); break; }
          var e = f._data.indexOf('\n', f._pos);
          var line = e < 0 ? f._data.slice(f._pos) : f._data.slice(f._pos, fm[0] === 'L' ? e + 1 : e);
          f._pos = e < 0 ? f._data.length : e + 1;
          out.push(line); continue;
        }
        if (fm[0] === 'n') {
          var m = /^\s*[-+]?(0[xX][0-9a-fA-F.]+|\d*\.?\d+(?:[eE][-+]?\d+)?)/.exec(f._data.slice(f._pos));
          if (!m) { out.push(undefined); break; }
          f._pos += m[0].length; out.push(str2num(m[0])); continue;
        }
      }
      return ret(out);
    });
    fileMethods.set('write', function (f) {
      for (var i = 1; i < arguments.length; i++) {
        var v = arguments[i];
        var s = typeof v === 'string' ? v : writeNum(v);
        f._data = f._data.slice(0, f._pos) + s + f._data.slice(f._pos + s.length);
        f._pos += s.length;
      }
      return f;
    });
    fileMethods.set('lines', function (f) {
      return function () { return first(fileMethods.get('read')(f, 'l')); };
    });
    fileMethods.set('seek', function (f, whence, off) {
      whence = whence || 'cur'; off = off === undefined ? 0 : num(off);
      if (whence === 'set') f._pos = off;
      else if (whence === 'end') f._pos = f._data.length + off;
      else f._pos += off;
      return f._pos;
    });
    fileMethods.set('flush', function (f) {
      if (f._mode[0] !== 'r' && host.writeFile) host.writeFile(f._path, f._data);
      return f;
    });
    fileMethods.set('close', function (f) {
      if (!f._closed && f._mode[0] !== 'r' && host.writeFile) host.writeFile(f._path, f._data);
      f._closed = true;
      return true;
    });
    fileMethods.set('setvbuf', function () { return true; });
    IO.set('write', function () {
      var s = '';
      for (var i = 0; i < arguments.length; i++) s += typeof arguments[i] === 'string' ? arguments[i] : writeNum(arguments[i]);
      (host.write || host.print || function (x) { if (typeof process !== 'undefined') process.stdout.write(x); })(s);
      return NONE;
    });
    IO.set('lines', function (path) {
      var data = host.readFile ? host.readFile(path) : null;
      if (data === null || data === undefined) throw rterror(path + ': No such file or directory');
      var f = newFile(path, 'r', data);
      return function () { return first(fileMethods.get('read')(f, 'l')); };
    });
    return IO;
  }

  // ---------------------------------------------------------- utf8 ------
  function makeUtf8Lib() {
    var U = new LuaTable();
    U.set('char', function () {
      var s = '';
      for (var i = 0; i < arguments.length; i++) s += NS.utf8Bytes(checkInt(arguments[i], i + 1, 'char'));
      return s;
    });
    U.set('charpattern', '[\x00-\x7F\xC2-\xFD][\x80-\xBF]*');
    function decodeAt(s, i) {   // i 0-based; returns [codepoint, length] or null
      var c = s.charCodeAt(i);
      if (c < 0x80) return [c, 1];
      var n = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 0;
      if (!n) return null;
      var cp = c & (0x7F >> n);
      for (var k = 1; k < n; k++) {
        var cc = s.charCodeAt(i + k);
        if ((cc & 0xC0) !== 0x80) return null;
        cp = (cp << 6) | (cc & 0x3F);
      }
      return [cp, n];
    }
    U.set('len', function (s, i, j) {
      s = checkStr(s, 1, 'len');
      var a = (i === undefined ? 1 : num(i)) - 1, b = j === undefined ? s.length : num(j);
      var n = 0;
      while (a < b) {
        var d = decodeAt(s, a);
        if (!d) return new Multi([undefined, a + 1]);
        a += d[1]; n++;
      }
      return n;
    });
    U.set('codepoint', function (s, i, j) {
      s = checkStr(s, 1, 'codepoint');
      var a = (i === undefined ? 1 : num(i)), b = j === undefined ? a : num(j);
      var out = [], p = a - 1;
      while (p < b) {
        var d = decodeAt(s, p);
        if (!d) throw rterror('invalid UTF-8 code');
        out.push(d[0]); p += d[1];
      }
      return ret(out);
    });
    U.set('offset', function (s, n, i) {
      s = checkStr(s, 1, 'offset');
      n = num(n);
      var p = i === undefined ? (n >= 0 ? 1 : s.length + 1) : num(i);
      p -= 1;
      function cont(k) { return (s.charCodeAt(k) & 0xC0) === 0x80; }
      if (n === 0) { while (p > 0 && cont(p)) p--; return p + 1; }
      if (n > 0) { n--; while (n > 0 && p < s.length) { p++; while (cont(p)) p++; n--; } return n === 0 ? p + 1 : undefined; }
      while (n < 0 && p > 0) { p--; while (p > 0 && cont(p)) p--; n++; }
      return n === 0 ? p + 1 : undefined;
    });
    U.set('codes', function (s) {
      s = checkStr(s, 1, 'codes');
      return new Multi([function (str, i) {
        var p = num(i);
        if (p > 0) { var d0 = decodeAt(str, p - 1); p += d0 ? d0[1] - 1 : 0; }
        if (p >= str.length) return undefined;
        var d = decodeAt(str, p);
        if (!d) throw rterror('invalid UTF-8 code');
        return new Multi([p + 1, d[0]]);
      }, s, 0]);
    });
    return U;
  }

  // ======================================================== strings =======
  var stringLib = new LuaTable();
  var stringMeta = new LuaTable();
  stringMeta.set('__index', stringLib);

  function posrelatI(pos, l) {
    if (pos > 0) return pos;
    if (pos === 0) return 1;
    if (pos < -l) return 1;
    return l + pos + 1;
  }
  function getendpos(pos, l) {
    if (pos > l) return l;
    if (pos >= 0) return pos;
    if (pos < -l) return 0;
    return l + pos + 1;
  }
  stringLib.set('len', function (s) { return checkStr(s, 1, 'len').length; });
  stringLib.set('sub', function (s, i, j) {
    s = checkStr(s, 1, 'sub');
    var l = s.length;
    var st = posrelatI(checkInt(i === undefined ? 1 : i, 2, 'sub'), l);
    var en = getendpos(j === undefined ? -1 : checkInt(j, 3, 'sub'), l);
    if (st < 1) st = 1;
    if (en > l) en = l;
    return st <= en ? s.slice(st - 1, en) : '';
  });
  stringLib.set('upper', function (s) {
    s = checkStr(s, 1, 'upper');
    return s.replace(/[a-z]+/g, function (m) { return m.toUpperCase(); });
  });
  stringLib.set('lower', function (s) {
    s = checkStr(s, 1, 'lower');
    return s.replace(/[A-Z]+/g, function (m) { return m.toLowerCase(); });
  });
  stringLib.set('rep', function (s, n, sep) {
    s = checkStr(s, 1, 'rep'); n = checkInt(n, 2, 'rep');
    if (n <= 0) return '';
    if (sep === undefined || sep === '') return s.repeat(n);
    sep = checkStr(sep, 3, 'rep');
    return Array(n).fill(s).join(sep);
  });
  stringLib.set('reverse', function (s) { return checkStr(s, 1, 'reverse').split('').reverse().join(''); });
  stringLib.set('byte', function (s, i, j) {
    s = checkStr(s, 1, 'byte');
    var l = s.length;
    var pi = posrelatI(optInt(i, 2, 'byte', 1), l);
    var pe = getendpos(j === undefined ? pi : checkInt(j, 3, 'byte'), l);
    if (pi > pe) return undefined;
    var out = [];
    for (var k = pi; k <= pe; k++) out.push(s.charCodeAt(k - 1));
    return ret(out);
  });
  stringLib.set('char', function () {
    var out = '';
    for (var i = 0; i < arguments.length; i++) {
      var c = checkInt(arguments[i], i + 1, 'char');
      if (c < 0 || c > 255) throw argError(i + 1, 'char', 'value out of range');
      out += String.fromCharCode(c);
    }
    return out;
  });

  // string.format, with C's own rounding.
  stringLib.set('format', function (fmt) {
    fmt = checkStr(fmt, 1, 'format');
    var args = arguments, argi = 1;
    var out = '', i = 0, n = fmt.length;
    while (i < n) {
      var c = fmt[i++];
      if (c !== '%') { out += c; continue; }
      if (fmt[i] === '%') { out += '%'; i++; continue; }
      var m = /^([-+ #0]*)(\d*)(?:\.(\d*))?([a-zA-Z])/.exec(fmt.slice(i));
      if (!m) throw rterror("invalid conversion '%" + fmt.slice(i, i + 5) + "' to 'format'");
      i += m[0].length;
      var flags = m[1], width = m[2] ? Number(m[2]) : 0, prec = m[3] === undefined ? undefined : Number(m[3] || 0);
      var conv = m[4];
      var argn = ++argi;
      if (argn > args.length - 1 + 1 && conv !== '%') {
        if (args[argn - 1] === undefined && argn > args.length) throw argError(argn, 'format', 'no value');
      }
      var v = args[argn - 1], body, sign = '';
      switch (conv) {
        case 'd': case 'i': {
          var iv = checkInt(v, argn, 'format');
          body = String(Math.abs(iv) < 1e21 ? Math.abs(iv) : BigInt(iv) * (iv < 0 ? -1n : 1n));
          if (prec !== undefined) { body = body.padStart(prec, '0'); if (prec === 0 && iv === 0) body = ''; }
          sign = iv < 0 ? '-' : (flags.indexOf('+') >= 0 ? '+' : (flags.indexOf(' ') >= 0 ? ' ' : ''));
          out += pad(sign, body, width, flags, prec === undefined);
          break;
        }
        case 'u': {
          var uv = checkInt(v, argn, 'format');
          body = BigInt.asUintN(64, BigInt(uv)).toString();
          out += pad('', body, width, flags, true);
          break;
        }
        case 'c': out += pad('', String.fromCharCode(checkInt(v, argn, 'format')), width, flags.replace('0', ''), false); break;
        case 'x': case 'X': case 'o': {
          var xv = BigInt.asUintN(64, BigInt(checkInt(v, argn, 'format')));
          body = xv.toString(conv === 'o' ? 8 : 16);
          if (conv === 'X') body = body.toUpperCase();
          if (prec !== undefined) body = body.padStart(prec, '0');
          var pre = (flags.indexOf('#') >= 0 && xv !== 0n) ? (conv === 'o' ? '0' : (conv === 'x' ? '0x' : '0X')) : '';
          out += pad(pre, body, width, flags, prec === undefined);
          break;
        }
        case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': case 'a': case 'A': {
          var fv = checkNum(v, argn, 'format');
          var neg = fv < 0 || (fv === 0 && 1 / fv < 0);
          var ax = Math.abs(fv);
          var up = conv === 'E' || conv === 'G' || conv === 'F' || conv === 'A';
          if (ax === Infinity || fv !== fv) {
            body = fv !== fv ? 'nan' : 'inf';
            if (up) body = body.toUpperCase();
            sign = neg && fv === fv ? '-' : (flags.indexOf('+') >= 0 ? '+' : (flags.indexOf(' ') >= 0 ? ' ' : ''));
            out += pad(sign, body, width, flags.replace('0', ''), false);
            break;
          }
          var p = prec === undefined ? 6 : prec;
          var alt = flags.indexOf('#') >= 0;
          if (conv === 'f' || conv === 'F') { body = fixedDigits(ax, p); if (alt && p === 0) body += '.'; }
          else if (conv === 'e' || conv === 'E') body = fmtExp(ax, p, up);
          else if (conv === 'g' || conv === 'G') body = fmtG(ax, p, up, alt);
          else body = hexFloat(ax, prec, up);
          sign = neg ? '-' : (flags.indexOf('+') >= 0 ? '+' : (flags.indexOf(' ') >= 0 ? ' ' : ''));
          out += pad(sign, body, width, flags, true);
          break;
        }
        case 's': {
          var sv = tostring(v);
          if (args.length < argn) throw argError(argn, 'format', 'no value');
          if (prec !== undefined) sv = sv.slice(0, prec);
          out += pad('', sv, width, flags.replace('0', ''), false);
          break;
        }
        case 'q': out += quoteString(v); break;
        default:
          throw rterror("invalid conversion '%" + m[0] + "' to 'format'");
      }
    }
    return out;
  });
  function pad(sign, body, width, flags, zeroOk) {
    var total = sign.length + body.length;
    if (total >= width) return sign + body;
    if (flags.indexOf('-') >= 0) return sign + body + ' '.repeat(width - total);
    if (zeroOk && flags.indexOf('0') >= 0) return sign + '0'.repeat(width - total) + body;
    return ' '.repeat(width - total) + sign + body;
  }
  function hexFloat(x, prec, up) {
    if (x === 0) return up ? '0X0P+0' : '0x0p+0';
    var e = Math.floor(Math.log2(x)), m = x / Math.pow(2, e);
    if (m >= 2) { m /= 2; e++; } else if (m < 1) { m *= 2; e--; }
    var frac = (m - 1).toString(16).slice(2);
    if (prec !== undefined) frac = frac.slice(0, prec).padEnd(prec, '0');
    var s = '0x1' + (frac ? '.' + frac : '') + 'p' + (e >= 0 ? '+' : '') + e;
    return up ? s.toUpperCase() : s;
  }
  function quoteString(v) {
    if (typeof v === 'string') {
      var o = '"';
      for (var i = 0; i < v.length; i++) {
        var c = v.charCodeAt(i), ch = v[i];
        if (ch === '"' || ch === '\\') o += '\\' + ch;
        else if (ch === '\n') o += '\\\n';
        else if (ch === '\r') o += '\\r';
        else if (c === 0) o += (i + 1 < v.length && /\d/.test(v[i + 1])) ? '\\000' : '\\0';
        else if (c < 32 || c === 127) o += '\\' + ((i + 1 < v.length && /\d/.test(v[i + 1])) ? String(c).padStart(3, '0') : c);
        else o += ch;
      }
      return o + '"';
    }
    if (typeof v === 'number' && Number.isInteger(v)) return intStr(v);
    if (isNum(v)) {
      var x = num(v);
      if (x === Infinity) return '1e9999';
      if (x === -Infinity) return '-1e9999';
      if (x !== x) return '(0/0)';
      if (x === Math.floor(x)) return (x < 0 ? '-' : '') + hexFloat(Math.abs(x)) ;
      return (x < 0 ? '-' : '') + hexFloat(Math.abs(x));
    }
    if (v === undefined || typeof v === 'boolean') return tostring(v);
    throw rterror("bad argument to 'format' (value has no literal form)");
  }

  // ----------------------------------------------------- patterns ------
  // lstrlib.c's matcher, ported line for line.
  var L_ESC = 37, CAP_UNFINISHED = -1, CAP_POSITION = -2, MAXCCALLS = 200, MAXCAPTURES = 32;
  function MatchState(src, pat) {
    this.src = src; this.pat = pat; this.level = 0; this.matchdepth = MAXCCALLS;
    this.capInit = new Array(MAXCAPTURES); this.capLen = new Array(MAXCAPTURES);
  }
  function classEnd(ms, p) {
    var pat = ms.pat, pe = pat.length;
    var c = pat.charCodeAt(p++);
    if (c === L_ESC) {
      if (p >= pe) throw rterror("malformed pattern (ends with '%')");
      return p + 1;
    }
    if (c === 91) {   // '['
      if (pat.charCodeAt(p) === 94) p++;
      do {
        if (p >= pe) throw rterror("malformed pattern (missing ']')");
        if (pat.charCodeAt(p++) === L_ESC && p < pe) p++;
      } while (pat.charCodeAt(p) !== 93);
      return p + 1;
    }
    return p;
  }
  function isalpha(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
  function isdigit(c) { return c >= 48 && c <= 57; }
  function islower(c) { return c >= 97 && c <= 122; }
  function isupper(c) { return c >= 65 && c <= 90; }
  function isspace(c) { return c === 32 || (c >= 9 && c <= 13); }
  function iscntrl(c) { return c < 32 || c === 127; }
  function ispunct(c) { return c >= 33 && c <= 126 && !isalpha(c) && !isdigit(c); }
  function isxdigit(c) { return isdigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70); }
  function matchClass(c, cl) {
    var res;
    var low = cl >= 65 && cl <= 90 ? cl + 32 : cl;
    switch (low) {
      case 97: res = isalpha(c); break;            // a
      case 99: res = iscntrl(c); break;            // c
      case 100: res = isdigit(c); break;           // d
      case 103: res = c >= 33 && c <= 126; break;  // g
      case 108: res = islower(c); break;           // l
      case 112: res = ispunct(c); break;           // p
      case 115: res = isspace(c); break;           // s
      case 117: res = isupper(c); break;           // u
      case 119: res = isalpha(c) || isdigit(c); break; // w
      case 120: res = isxdigit(c); break;          // x
      default: return cl === c;
    }
    if (isupper(cl)) res = !res;
    return res;
  }
  function matchBracketClass(ms, c, p, ec) {
    var pat = ms.pat, sig = true;
    if (pat.charCodeAt(p + 1) === 94) { sig = false; p++; }
    while (++p < ec) {
      var pc = pat.charCodeAt(p);
      if (pc === L_ESC) {
        p++;
        if (matchClass(c, pat.charCodeAt(p))) return sig;
      } else if (pat.charCodeAt(p + 1) === 45 && p + 2 < ec) {
        p += 2;
        if (pat.charCodeAt(p - 2) <= c && c <= pat.charCodeAt(p)) return sig;
      } else if (pc === c) return sig;
    }
    return !sig;
  }
  function singleMatch(ms, s, p, ep) {
    if (s >= ms.src.length) return false;
    var c = ms.src.charCodeAt(s);
    var pc = ms.pat.charCodeAt(p);
    switch (pc) {
      case 46: return true;                                  // '.'
      case L_ESC: return matchClass(c, ms.pat.charCodeAt(p + 1));
      case 91: return matchBracketClass(ms, c, p, ep - 1);
      default: return pc === c;
    }
  }
  function matchBalance(ms, s, p) {
    if (p >= ms.pat.length - 1) throw rterror("malformed pattern (missing arguments to '%b')");
    var src = ms.src;
    if (src.charCodeAt(s) !== ms.pat.charCodeAt(p)) return -1;
    var b = ms.pat.charCodeAt(p), e = ms.pat.charCodeAt(p + 1), cont = 1;
    while (++s < src.length) {
      var c = src.charCodeAt(s);
      if (c === e) { if (--cont === 0) return s + 1; }
      else if (c === b) cont++;
    }
    return -1;
  }
  function maxExpand(ms, s, p, ep) {
    var i = 0;
    while (singleMatch(ms, s + i, p, ep)) i++;
    while (i >= 0) {
      var res = doMatch(ms, s + i, ep + 1);
      if (res !== -1) return res;
      i--;
    }
    return -1;
  }
  function minExpand(ms, s, p, ep) {
    for (;;) {
      var res = doMatch(ms, s, ep + 1);
      if (res !== -1) return res;
      else if (singleMatch(ms, s, p, ep)) s++;
      else return -1;
    }
  }
  function startCapture(ms, s, p, what) {
    var level = ms.level;
    if (level >= MAXCAPTURES) throw rterror('too many captures');
    ms.capInit[level] = s; ms.capLen[level] = what;
    ms.level = level + 1;
    var res = doMatch(ms, s, p);
    if (res === -1) ms.level--;
    return res;
  }
  function captureToClose(ms) {
    var level = ms.level;
    for (level--; level >= 0; level--) if (ms.capLen[level] === CAP_UNFINISHED) return level;
    throw rterror('invalid pattern capture');
  }
  function endCapture(ms, s, p) {
    var l = captureToClose(ms);
    ms.capLen[l] = s - ms.capInit[l];
    var res = doMatch(ms, s, p);
    if (res === -1) ms.capLen[l] = CAP_UNFINISHED;
    return res;
  }
  function checkCapture(ms, l) {
    l -= 49;
    if (l < 0 || l >= ms.level || ms.capLen[l] === CAP_UNFINISHED) throw rterror('invalid capture index %' + (l + 1));
    return l;
  }
  function matchCapture(ms, s, l) {
    l = checkCapture(ms, l);
    var len = ms.capLen[l];
    var cap = ms.src.substr(ms.capInit[l], len);
    if (ms.src.length - s >= len && ms.src.substr(s, len) === cap) return s + len;
    return -1;
  }
  function doMatch(ms, s, p) {
    if (ms.matchdepth-- === 0) throw rterror('pattern too complex');
    var pat = ms.pat, pe = pat.length;
    for (;;) {
      if (p === pe) break;
      var pc = pat.charCodeAt(p);
      if (pc === 40) {                                     // '('
        if (pat.charCodeAt(p + 1) === 41) s = startCapture(ms, s, p + 2, CAP_POSITION);
        else s = startCapture(ms, s, p + 1, CAP_UNFINISHED);
        break;
      }
      if (pc === 41) { s = endCapture(ms, s, p + 1); break; }   // ')'
      if (pc === 36 && p + 1 === pe) {                     // '$' at the end
        s = (s === ms.src.length) ? s : -1;
        break;
      }
      if (pc === L_ESC) {
        var nx = pat.charCodeAt(p + 1);
        if (nx === 98) {                                   // %b
          s = matchBalance(ms, s, p + 2);
          if (s !== -1) { p += 4; continue; }
          break;
        }
        if (nx === 102) {                                  // %f
          p += 2;
          if (pat.charCodeAt(p) !== 91) throw rterror("missing '[' after '%f' in pattern");
          var ep0 = classEnd(ms, p);
          var prev = (s === 0) ? 0 : ms.src.charCodeAt(s - 1);
          var cur = s < ms.src.length ? ms.src.charCodeAt(s) : 0;
          if (!matchBracketClass(ms, prev, p, ep0 - 1) && matchBracketClass(ms, cur, p, ep0 - 1)) { p = ep0; continue; }
          s = -1; break;
        }
        if (nx >= 48 && nx <= 57) {                        // %0-%9
          s = matchCapture(ms, s, nx);
          if (s !== -1) { p += 2; continue; }
          break;
        }
      }
      // default: a single class with an optional suffix
      var ep = classEnd(ms, p);
      var epc = pat.charCodeAt(ep);
      if (!singleMatch(ms, s, p, ep)) {
        if (epc === 42 || epc === 63 || epc === 45) { p = ep + 1; continue; }   // * ? -
        s = -1; break;
      }
      if (epc === 63) {                                    // ?
        var res = doMatch(ms, s + 1, ep + 1);
        if (res !== -1) { s = res; break; }
        p = ep + 1; continue;
      }
      if (epc === 43) { s = maxExpand(ms, s + 1, p, ep); break; }   // +
      if (epc === 42) { s = maxExpand(ms, s, p, ep); break; }       // *
      if (epc === 45) { s = minExpand(ms, s, p, ep); break; }       // -
      s++; p = ep;
    }
    ms.matchdepth++;
    return s;
  }
  function getCapture(ms, i, s, e) {
    if (i >= ms.level) {
      if (i !== 0) throw rterror('invalid capture index %' + (i + 1));
      return ms.src.slice(s, e);
    }
    var l = ms.capLen[i];
    if (l === CAP_UNFINISHED) throw rterror('unfinished capture');
    if (l === CAP_POSITION) return ms.capInit[i] + 1;
    return ms.src.substr(ms.capInit[i], l);
  }
  function captures(ms, s, e, wholeIfNone) {
    var n = (ms.level === 0 && wholeIfNone) ? 1 : ms.level;
    var out = [];
    for (var i = 0; i < n; i++) out.push(getCapture(ms, i, s, e));
    return out;
  }
  var SPECIALS = /[\^$*+?.()[\]%-]/;
  function strFindAux(find, s, p, init, plain, fname) {
    s = checkStr(s, 1, fname); p = checkStr(p, 2, fname);
    var ls = s.length;
    var st = posrelatI(optInt(init, 3, fname, 1), ls) - 1;
    if (st > ls) return undefined;
    if (find && (truthy(plain) || !SPECIALS.test(p))) {
      var idx = s.indexOf(p, st);
      if (idx >= 0) return new Multi([idx + 1, idx + p.length]);
      return undefined;
    }
    var anchor = p.charCodeAt(0) === 94;
    var pp = anchor ? p.slice(1) : p;
    var ms = new MatchState(s, pp);
    var s1 = st;
    do {
      ms.level = 0; ms.matchdepth = MAXCCALLS;
      var res = doMatch(ms, s1, 0);
      if (res !== -1) {
        if (find) return new Multi([s1 + 1, res].concat(captures(ms, -1, 0, false)));
        return ret(captures(ms, s1, res, true));
      }
    } while (s1++ < ls && !anchor);
    return undefined;
  }
  stringLib.set('find', function (s, p, init, plain) { return strFindAux(true, s, p, init, plain, 'find'); });
  stringLib.set('match', function (s, p, init) { return strFindAux(false, s, p, init, false, 'match'); });
  stringLib.set('gmatch', function (s, p, init) {
    s = checkStr(s, 1, 'gmatch'); p = checkStr(p, 2, 'gmatch');
    var ls = s.length;
    var src = posrelatI(optInt(init, 3, 'gmatch', 1), ls) - 1;
    if (src > ls) src = ls + 1;
    var ms = new MatchState(s, p), lastmatch = -1;
    return function () {
      for (; src <= ls; src++) {
        ms.level = 0; ms.matchdepth = MAXCCALLS;
        var e = doMatch(ms, src, 0);
        if (e !== -1 && e !== lastmatch) {
          var start = src;
          src = lastmatch = e;
          return ret(captures(ms, start, e, true));
        }
      }
      return undefined;
    };
  });
  stringLib.set('gsub', function (s, p, repl, maxn) {
    s = checkStr(s, 1, 'gsub'); p = checkStr(p, 2, 'gsub');
    var tr = typeName(repl);
    if (!(tr === 'number' || tr === 'string' || tr === 'table' || tr === 'function')) {
      throw argError(3, 'gsub', 'string/function/table expected, got ' + typeNameArg(repl));
    }
    var maxS = maxn === undefined ? s.length + 1 : checkInt(maxn, 4, 'gsub');
    var anchor = p.charCodeAt(0) === 94;
    var pp = anchor ? p.slice(1) : p;
    var ms = new MatchState(s, pp);
    var src = 0, lastmatch = -1, n = 0, out = '';
    var rs = tr === 'string' || tr === 'number' ? (typeof repl === 'string' ? repl : numStr(repl)) : null;
    while (n < maxS) {
      ms.level = 0; ms.matchdepth = MAXCCALLS;
      var e = doMatch(ms, src, 0);
      if (e !== -1 && e !== lastmatch) {
        n++;
        out += addValue(ms, src, e, repl, rs, tr);
        src = lastmatch = e;
      } else if (src < s.length) out += s[src++];
      else break;
      if (anchor) break;
    }
    if (src < s.length) out += s.slice(src);
    return new Multi([out, n]);
  });
  function addValue(ms, s, e, repl, rs, tr) {
    var whole = ms.src.slice(s, e), v;
    if (rs !== null) {
      var o = '';
      for (var i = 0; i < rs.length; i++) {
        var c = rs[i];
        if (c !== '%') { o += c; continue; }
        i++;
        var d = rs[i];
        if (d === '%') o += '%';
        else if (d !== undefined && d >= '0' && d <= '9') {
          var cap = d === '0' ? whole : getCapture(ms, d.charCodeAt(0) - 49, s, e);
          o += typeof cap === 'string' ? cap : numStr(cap);
        } else throw rterror("invalid use of '%' in replacement string");
      }
      return o;
    }
    var caps = captures(ms, s, e, true);
    if (tr === 'table') v = index(repl, caps[0]);
    else v = first(call(repl).apply(null, caps));
    if (v === undefined || v === false) return whole;
    if (typeof v === 'string') return v;
    if (isNum(v)) return numStr(v);
    throw rterror('invalid replacement value (a ' + typeName(v) + ')');
  }

  // ===================================================== conversion =======
  // Between JS values (UTF-16 strings, arrays, objects) and Lua values.
  var encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  function toBytes(str) {        // JS string -> Lua byte string
    if (/^[\x00-\x7f]*$/.test(str)) return str;
    var b = encoder.encode(str), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }
  function fromBytes(s) {        // Lua byte string -> JS string
    if (/^[\x00-\x7f]*$/.test(s)) return s;
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return decoder.decode(b);
  }
  function toLua(v) {
    if (v === null || v === undefined) return undefined;
    if (typeof v === 'string') return toBytes(v);
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'function') return v;
    if (v instanceof LuaTable || v instanceof LFloat) return v;
    var t = new LuaTable();
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) t.set(i + 1, toLua(v[i])); return t; }
    Object.keys(v).forEach(function (k) { t.set(toBytes(k), toLua(v[k])); });
    return t;
  }
  function toJS(v, seen) {
    if (v instanceof LFloat) return v.n;
    if (typeof v === 'string') return fromBytes(v);
    if (!(v instanceof LuaTable)) return v;
    seen = seen || new Map();
    if (seen.has(v)) return seen.get(v);
    var n = v.arr.length, hashSize = v.hash ? v.hash.size : 0;
    if (hashSize === 0) {
      var a = [];
      seen.set(v, a);
      for (var i = 0; i < n; i++) a.push(toJS(v.arr[i], seen));
      return a;
    }
    var o = {};
    seen.set(v, o);
    for (var j = 0; j < n; j++) if (v.arr[j] !== undefined) o[j + 1] = toJS(v.arr[j], seen);
    v.hash.forEach(function (val, key) {
      var k = typeof key === 'string' ? fromBytes(key) : (isNum(key) ? numStr(key) : tostring(key));
      o[k] = toJS(val, seen);
    });
    return o;
  }

  NS.LFloat = LFloat; NS.mkf = mkf; NS.Multi = Multi; NS.first = first; NS.sp = sp; NS.ret = ret;
  NS.LuaTable = LuaTable; NS.NONE = NONE; NS.LuaError = LuaError; NS.lineMaps = lineMaps;
  NS.add = add; NS.sub = sub; NS.mul = mul; NS.div = div; NS.idiv = idiv; NS.mod = mod; NS.pow = pow;
  NS.unm = unm; NS.band = band; NS.bor = bor; NS.bxor = bxor; NS.shl = shl; NS.shr = shr; NS.bnot = bnot;
  NS.concat = concat; NS.len = len; NS.eq = eq; NS.lt = lt; NS.le = le; NS.gt = gt; NS.ge = ge;
  NS.T = truthy; NS.index = index; NS.setindex = setindex; NS.call = call; NS.method = method;
  NS.tbl = tbl; NS.iter = iter; NS.forprep = forprep; NS.tostring = tostring; NS.typeName = typeName;
  NS.makeEnv = makeEnv; NS.toLua = toLua; NS.toJS = toJS; NS.toBytes = toBytes; NS.fromBytes = fromBytes;
  NS.numStr = numStr; NS.str2num = str2num; NS.errorValue = errorValue; NS.rterror = rterror;
})(typeof module === 'object' && module.exports
  ? (module.exports = (globalThis.MiddawLua = globalThis.MiddawLua || {}))
  : (globalThis.MiddawLua = globalThis.MiddawLua || {}));


/* ---- kit/runtime/lua_compile.js ---- */
/* Middaw's Lua 5.4, part 2 of 3: syntax tree in, JavaScript out.
 *
 * Every Lua local becomes a JS `let` with a name of its own ($x, $x$2...), so
 * shadowing and closures behave as in Lua: a fresh binding per declaration,
 * and per loop iteration. Every operator goes through the runtime, so the
 * integer/float distinction and the error messages are Lua's. Each statement
 * starts a new line carrying a marker with its Lua line number, which is how
 * an error raised in the generated code is reported at the Lua line.
 */
(function (NS) {
  'use strict';

  var ARITH = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'mod', '^': 'pow', '//': 'idiv',
                '&': 'band', '|': 'bor', '~': 'bxor', '<<': 'shl', '>>': 'shr', '..': 'concat' };
  var COMPARE = { '==': 'eq', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' };

  function compile(ast, chunk) {
    var consts = [];
    var nameCounts = Object.create(null);

    function uniqueName(luaName) {
      var n = (nameCounts[luaName] || 0) + 1;
      nameCounts[luaName] = n;
      return n === 1 ? '$' + luaName : '$' + luaName + '$' + n;
    }

    function FuncState(parent, vararg) {
      this.parent = parent; this.vararg = vararg; this.temps = 0; this.scopes = [];
    }
    var fs = null;
    var stmtUid = 0;

    function newTemp() { fs.temps++; return '$$' + fs.temps; }
    function lookup(name) {
      for (var f = fs; f; f = f.parent) {
        for (var i = f.scopes.length - 1; i >= 0; i--) {
          var js = f.scopes[i][name];
          if (js !== undefined) return js;
        }
      }
      return null;
    }
    function declare(name) {
      var js = uniqueName(name);
      fs.scopes[fs.scopes.length - 1][name] = js;
      return js;
    }
    function openScope() { fs.scopes.push(Object.create(null)); }
    function closeScope() { fs.scopes.pop(); }

    function err(msg, line) {
      throw new NS.LuaSyntaxError(msg, chunk, line || 0);
    }

    function str(s) { return JSON.stringify(s); }

    function numberLiteral(text) {
      var v;
      if (/^0[xX]/.test(text)) {
        if (/[.pP]/.test(text)) v = NS.str2num(text);
        else {
          var big = BigInt.asIntN(64, BigInt('0x' + text.slice(2)));
          return String(Number(big));
        }
      } else if (/[.eE]/.test(text)) {
        v = NS.mkf(Number(text));
      } else {
        var n = Number(text);
        if (Math.abs(n) > 9223372036854775807) v = NS.mkf(n);
        else return String(n);
      }
      if (v instanceof NS.LFloat) {
        var idx = consts.length;
        consts.push(v);
        return '$$K[' + idx + ']';
      }
      var s = String(v);
      return s === 'Infinity' ? 'Infinity' : (s === 'NaN' ? 'NaN' : (v < 0 ? '(' + s + ')' : s));
    }

    function describe(e) {
      if (e.k === 'Name') return lookup(e.name) ? "local '" + e.name + "'" : "global '" + e.name + "'";
      if (e.k === 'Index' && e.key.k === 'String') return "field '" + e.key.v + "'";
      if (e.k === 'Method') return "method '" + e.name + "'";
      return '';
    }

    function isMultiExpr(e) { return e.k === 'Call' || e.k === 'Method' || e.k === 'Vararg'; }

    // A JS expression for the raw result of a call: possibly a Multi.
    function callRaw(e) {
      if (e.k === 'Method') {
        var o = ex(e.obj);
        var args = argList(e.args);
        return 'L.method(' + o + ', ' + str(e.name) + (args ? ', ' + args : '') + ')';
      }
      var fn = ex(e.fn), a = argList(e.args), d = describe(e.fn);
      if (/^\$[A-Za-z_][\w$]*$/.test(fn)) {
        return '(typeof ' + fn + " === 'function' ? " + fn + ' : L.call(' + fn + ', ' + str(d) + '))(' + a + ')';
      }
      var t = newTemp();
      return '(typeof (' + t + ' = ' + fn + ") === 'function' ? " + t + ' : L.call(' + t + ', ' + str(d) + '))(' + a + ')';
    }

    function argList(exprs) {
      var out = [];
      for (var i = 0; i < exprs.length; i++) {
        var e = exprs[i], last = i === exprs.length - 1;
        if (last && (e.k === 'Call' || e.k === 'Method')) out.push('...L.sp(' + callRaw(e) + ')');
        else if (last && e.k === 'Vararg') { checkVararg(e); out.push('...$$va'); }
        else out.push(ex(e));
      }
      return out.join(', ');
    }
    function checkVararg(e) {
      if (!fs.vararg) err("cannot use '...' outside a vararg function", e.line);
    }

    // A JS expression for exactly one Lua value.
    function ex(e) {
      switch (e.k) {
        case 'Nil': return 'undefined';
        case 'True': return 'true';
        case 'False': return 'false';
        case 'Number': return numberLiteral(e.v);
        case 'String': return str(e.v);
        case 'Vararg': checkVararg(e); return '$$va[0]';
        case 'Function': return funcExpr(e);
        case 'Paren': return ex(e.expr);
        case 'Name': {
          var js = lookup(e.name);
          if (js) return js;
          return 'L.index($$G, ' + str(e.name) + ')';
        }
        case 'Index':
          return 'L.index(' + ex(e.obj) + ', ' + ex(e.key) + ', ' + str(describe(e.obj)) + ')';
        case 'Call': case 'Method':
          return 'L.first(' + callRaw(e) + ')';
        case 'Table': return tableExpr(e);
        case 'Unop': {
          if (e.op === 'not') return '!' + cond(e.expr);
          if (e.op === '-') {
            if (e.expr.k === 'Number') {
              var lit = numberLiteral(e.expr.v);
              if (/^\d+$/.test(lit)) return lit === '0' ? '0' : '(-' + lit + ')';
              if (/^[\d.e+-]+$/.test(lit)) return '(-' + lit + ')';
            }
            return 'L.unm(' + ex(e.expr) + ')';
          }
          if (e.op === '#') return 'L.len(' + ex(e.expr) + ')';
          if (e.op === '~') return 'L.bnot(' + ex(e.expr) + ')';
          break;
        }
        case 'Binop': {
          if (e.op === 'and') {
            var t = newTemp();
            return '(L.T(' + t + ' = ' + ex(e.left) + ') ? ' + ex(e.right) + ' : ' + t + ')';
          }
          if (e.op === 'or') {
            var t2 = newTemp();
            return '(L.T(' + t2 + ' = ' + ex(e.left) + ') ? ' + t2 + ' : ' + ex(e.right) + ')';
          }
          if (e.op === '~=') return '!L.eq(' + ex(e.left) + ', ' + ex(e.right) + ')';
          if (COMPARE[e.op]) return 'L.' + COMPARE[e.op] + '(' + ex(e.left) + ', ' + ex(e.right) + ')';
          return 'L.' + ARITH[e.op] + '(' + ex(e.left) + ', ' + ex(e.right) + ')';
        }
      }
      err('cannot compile expression ' + e.k, e.line);
    }

    // A JS boolean expression for Lua truth, without building a Lua value.
    function cond(e) {
      switch (e.k) {
        case 'True': return 'true';
        case 'False': case 'Nil': return 'false';
        case 'Paren': return cond(e.expr);
        case 'Unop': if (e.op === 'not') return '!' + cond(e.expr); break;
        case 'Binop':
          if (e.op === 'and') return '(' + cond(e.left) + ' && ' + cond(e.right) + ')';
          if (e.op === 'or') return '(' + cond(e.left) + ' || ' + cond(e.right) + ')';
          if (e.op === '~=' || COMPARE[e.op]) return ex(e);
          break;
      }
      return 'L.T(' + ex(e) + ')';
    }

    function tableExpr(e) {
      var pos = [], keyed = [];
      for (var i = 0; i < e.items.length; i++) {
        var it = e.items[i];
        if (it.kind === 'pos') {
          var lastPos = true;
          for (var j = i + 1; j < e.items.length; j++) if (e.items[j].kind === 'pos') { lastPos = false; break; }
          if (lastPos && (it.value.k === 'Call' || it.value.k === 'Method')) pos.push('...L.sp(' + callRaw(it.value) + ')');
          else if (lastPos && it.value.k === 'Vararg') { checkVararg(it.value); pos.push('...$$va'); }
          else pos.push(ex(it.value));
        } else {
          keyed.push(ex(it.key), ex(it.value));
        }
      }
      if (!keyed.length) return 'L.tbl([' + pos.join(', ') + '])';
      return 'L.tbl([' + pos.join(', ') + '], [' + keyed.join(', ') + '])';
    }

    function funcExpr(f) {
      var saved = fs;
      fs = new FuncState(saved, f.vararg);
      openScope();
      var params = f.params.map(function (p) { return declare(p); });
      if (f.vararg) params.push('...$$va');
      var body = block(f.body);
      closeScope();
      var temps = '';
      if (fs.temps) {
        var names = [];
        for (var i = 1; i <= fs.temps; i++) names.push('$$' + i);
        temps = 'let ' + names.join(', ') + ';';
      }
      fs = saved;
      return 'function (' + params.join(', ') + ') {' + temps + body + '\n/*@' + (f.endLine || f.line) + '*/return L.NONE;}';
    }

    function block(stmts) {
      var out = '';
      for (var i = 0; i < stmts.length; i++) out += statement(stmts[i]);
      return out;
    }
    function scoped(stmts) {
      openScope();
      var b = block(stmts);
      closeScope();
      return b;
    }

    function assignTo(target, value) {
      if (target.k === 'Name') {
        var js = lookup(target.name);
        if (js) return js + ' = ' + value + ';';
        return 'L.setindex($$G, ' + str(target.name) + ', ' + value + ');';
      }
      return 'L.setindex(' + ex(target.obj) + ', ' + ex(target.key) + ', ' + value + ', ' + str(describe(target.obj)) + ');';
    }

    function valuesArray(exprs) { return '[' + argList(exprs) + ']'; }

    function statement(s) {
      var mark = '\n/*@' + (s.line || 0) + '*/';
      switch (s.k) {
        case 'Local': {
          var attrs = s.attribs || [];
          attrs.forEach(function (a) {
            if (a && a !== 'const' && a !== 'close') err("unknown attribute '" + a + "'", s.line);
          });
          if (s.names.length === 1 && s.exprs.length <= 1) {
            var v = s.exprs.length ? ex(s.exprs[0]) : 'undefined';
            return mark + 'let ' + declare(s.names[0]) + ' = ' + v + ';';
          }
          if (s.exprs.length === s.names.length && !s.exprs.some(isMultiExpr)) {
            var vals = s.exprs.map(ex);
            var tmpNames = vals.map(function () { return '$$l' + (++stmtUid); });
            var pre = 'const ' + tmpNames.map(function (t, i) { return t + ' = ' + vals[i]; }).join(', ') + ';';
            var decl = s.names.map(function (n, i) { return declare(n) + ' = ' + tmpNames[i]; });
            return mark + pre + ' let ' + decl.join(', ') + ';';
          }
          var r = '$$r' + (++stmtUid);
          var code = 'const ' + r + ' = ' + valuesArray(s.exprs) + ';';
          var decls = s.names.map(function (n, i) { return declare(n) + ' = ' + r + '[' + i + ']'; });
          return mark + code + ' let ' + decls.join(', ') + ';';
        }
        case 'LocalFunction': {
          var name = declare(s.name);
          return mark + 'let ' + name + '; ' + name + ' = ' + funcExpr(s.func) + ';';
        }
        case 'Assign': {
          if (s.targets.length === 1 && s.exprs.length === 1) {
            return mark + assignTo(s.targets[0], ex(s.exprs[0]));
          }
          var rr = '$$r' + (++stmtUid);
          var c2 = 'const ' + rr + ' = ' + valuesArray(s.exprs) + ';';
          s.targets.forEach(function (t, i) { c2 += ' ' + assignTo(t, rr + '[' + i + ']'); });
          return mark + c2;
        }
        case 'ExprStat':
          return mark + callRaw(s.expr) + ';';
        case 'Do':
          return mark + '{' + scoped(s.body) + '\n}';
        case 'While':
          return mark + 'while (' + cond(s.cond) + ') {' + scoped(s.body) + '\n}';
        case 'Repeat': {
          openScope();
          var body = block(s.body);
          var cnd = cond(s.cond);
          closeScope();
          return mark + 'for (;;) {' + body + '\nif (' + cnd + ') break;\n}';
        }
        case 'If': {
          var o = mark;
          s.clauses.forEach(function (c, i) {
            o += (i ? ' else if (' : 'if (') + cond(c.cond) + ') {' + scoped(c.body) + '\n}';
          });
          if (s.orelse) o += ' else {' + scoped(s.orelse) + '\n}';
          return o;
        }
        case 'NumFor': {
          var u = ++stmtUid;
          var I = '$$i' + u, LIM = '$$m' + u, ST = '$$s' + u, FL = '$$f' + u;
          var start = ex(s.start), limit = ex(s.limit);
          var stepLit = !s.step ? 1 : (s.step.k === 'Number' && /^\d+$/.test(s.step.v) ? Number(s.step.v) : null);
          var step = s.step ? ex(s.step) : '1';
          var intStart = s.start.k === 'Number' && /^\d+$/.test(s.start.v);
          var test = stepLit !== null && stepLit > 0 ? I + ' <= ' + LIM : '(' + ST + ' > 0 ? ' + I + ' <= ' + LIM + ' : ' + I + ' >= ' + LIM + ')';
          openScope();
          var v2 = declare(s.name);
          var bindVal = (intStart && stepLit !== null) ? I : FL + ' ? L.mkf(' + I + ') : ' + I;
          var bd = block(s.body);
          closeScope();
          return mark + 'for (let [' + I + ', ' + LIM + ', ' + ST + ', ' + FL + '] = L.forprep(' + start + ', ' + limit + ', ' + step + '); ' +
                 test + '; ' + I + ' += ' + ST + ') { let ' + v2 + ' = ' + bindVal + ';' + bd + '\n}';
        }
        case 'GenFor': {
          var it = '$$it' + (++stmtUid);
          var head = 'const ' + it + ' = L.iter(' + argList(s.exprs) + ');';
          openScope();
          var binds = s.names.map(function (n, i) {
            var src = i === 0 ? it + '.a' : (i === 1 ? it + '.b' : it + '.v[' + i + ']');
            return declare(n) + ' = ' + src;
          });
          var gb = block(s.body);
          closeScope();
          return mark + '{' + head + ' while (' + it + '.step()) { let ' + binds.join(', ') + ';' + gb + '\n}}';
        }
        case 'Return': {
          var ex0 = s.exprs;
          if (!ex0.length) return mark + 'return L.NONE;';
          if (ex0.length === 1) {
            if (ex0[0].k === 'Call' || ex0[0].k === 'Method') return mark + 'return ' + callRaw(ex0[0]) + ';';
            if (ex0[0].k === 'Vararg') { checkVararg(ex0[0]); return mark + 'return L.ret($$va);'; }
            return mark + 'return ' + ex(ex0[0]) + ';';
          }
          return mark + 'return L.ret(' + valuesArray(ex0) + ');';
        }
        case 'Break': return mark + 'break;';
        case 'Goto': case 'Label':
          err('goto and labels are not supported by Middaw\'s Lua', s.line);
      }
      err('cannot compile statement ' + s.k, s.line);
    }

    fs = new FuncState(null, true);
    openScope();
    var body = block(ast.body);
    closeScope();
    var temps = '';
    if (fs.temps) {
      var names = [];
      for (var i = 1; i <= fs.temps; i++) names.push('$$' + i);
      temps = 'let ' + names.join(', ') + ';';
    }
    return { body: temps + body, consts: consts };
  }

  // The line the first line of a `new Function` body is reported as.
  var lineOffset = null;
  function probeOffset() {
    if (lineOffset !== null) return lineOffset;
    try {
      new Function('throw new Error("probe");\n//# sourceURL=lua:__probe__')();
    } catch (e) {
      var m = /lua:__probe__:(\d+)/.exec(e.stack || '');
      lineOffset = m ? Number(m[1]) - 1 : 0;
    }
    return lineOffset;
  }

  var chunkUid = 0;
  // Lua source (a byte string) -> a JS function, as `load` gives it.
  function load(src, chunkname, env) {
    var name = String(chunkname || 'chunk').replace(/[^A-Za-z0-9_.\/-]/g, '_');
    if (NS.lineMaps[name]) name = name + '#' + (++chunkUid);
    var ast = NS.parse(src, name);
    var out = compile(ast, name);
    var code = 'return function (...$$va) {' + out.body + '\nreturn L.NONE;\n};';
    var offset = probeOffset();
    var lines = code.split('\n'), map = [], cur = 0;
    for (var i = 0; i < offset; i++) map.push(0);
    for (var j = 0; j < lines.length; j++) {
      var m = /^\/\*@(\d+)\*\//.exec(lines[j]);
      if (m) cur = Number(m[1]);
      map.push(cur);
    }
    NS.lineMaps[name.replace(/#/g, '_')] = map;
    var factory = new Function('L', '$$G', '$$K', code + '\n//# sourceURL=lua:' + name.replace(/#/g, '_'));
    return factory(NS, env || NS.defaultEnv(), out.consts);
  }

  var sharedEnv = null;
  NS.defaultEnv = function () { return sharedEnv || (sharedEnv = NS.makeEnv()); };
  NS.compile = compile;
  NS.load = load;
})(typeof module === 'object' && module.exports
  ? (module.exports = (globalThis.MiddawLua = globalThis.MiddawLua || {}))
  : (globalThis.MiddawLua = globalThis.MiddawLua || {}));


/* ---- kit/runtime/host.js ---- */
/* The family's Lua engines, spoken to in JSON.
 *
 * The native app runs this in JavaScriptCore, after the Lua runtime
 * (runtime/lua/), and calls `MiddawHost.call(method, argsJSON)`; the tests run
 * it in Node. It knows no browser and no files: the host hands it a
 * `readFile(path)` that returns the file's bytes as a string, one character
 * per byte, which is how Middaw's Lua keeps its strings.
 *
 * The adapters (Noterator's) are how the generators are spoken to - settings
 * in, notes out - the same protocol Miderator and Noterator use.
 */
(function (G) {
  'use strict';
  var L = G.MiddawLua;

  var FILES = [
    'good-idea/gi_theory.lua', 'good-idea/gi_idea.lua',
    'midi-catalogue/mc_theory.lua', 'midi-catalogue/mc_orchestra.lua', 'midi-catalogue/mc_catalogue.lua',
    'midi-suggester/ms_theory.lua', 'midi-suggester/ms_read.lua', 'midi-suggester/ms_harmony.lua', 'midi-suggester/ms_melody.lua',
    'midi-variator/mv_theory.lua', 'midi-variator/mv_vary.lua',
    'starting-blocks/sb_engine.lua',
    'adapters/common.lua', 'adapters/index.lua', 'adapters/good_idea.lua', 'adapters/midi_suggester.lua',
    'adapters/midi_variator.lua', 'adapters/starting_blocks.lua', 'adapters/midi_catalogue.lua',
    'notation/sb_notate.lua', 'notation/sb_draw.lua', 'notation/sb_glyphs.lua',
    'battle-pass/bp_theory.lua', 'battle-pass/bp_loot.lua', 'battle-pass/bp_game.lua',
    'orchestration/orchestration_data.lua', 'orchestration/orchestration_composers.lua'
  ];

  var readFile = null, modules = {}, env = null, log = function () {};

  function engine(name) {
    if (modules[name] === undefined) {
      var src = readFile(name);
      if (src === null || src === undefined) throw new Error("engine '" + name + "' is not there");
      var r = L.first(L.load(src, name, env)());
      modules[name] = r === undefined ? false : r;
    }
    return modules[name];
  }

  function init(reader, logger) {
    readFile = reader;
    if (logger) log = logger;
    modules = {};
    env = L.makeEnv({
      print: function (s) { log('[lua] ' + L.fromBytes(s)); },
      readFile: function () { return null; },
      writeFile: function () {}
    });
    env.set('engine', function (name) { return engine(name); });
    env.set('dofile', function (name) { return L.first(engine(String(name).replace(/^.*engines\//, ''))); });
    return true;
  }

  function call(mod, fname) {
    var m = typeof mod === 'string' ? engine(mod) : mod;
    var f = L.index(m, fname);
    var args = [];
    for (var i = 2; i < arguments.length; i++) {
      var a = arguments[i];
      args.push(a instanceof L.LuaTable ? a : L.toLua(a));
    }
    return L.first(L.call(f).apply(null, args));
  }
  function js(v) { return L.toJS(v); }
  function list(x) { return !x ? [] : Array.isArray(x) ? x : Object.keys(x).map(function (k) { return x[k]; }); }

  // --------------------------------------------------------- generators --
  var adapters = null;
  function gens() {
    if (adapters) return adapters;
    adapters = list(js(engine('adapters/index.lua'))).map(function (path) {
      var A = engine(path);
      return { id: js(L.index(A, 'id')), name: js(L.index(A, 'name')), description: js(L.index(A, 'description')) || '',
               input: js(L.index(A, 'input')), panel: js(L.index(A, 'panel')) || null, A: A, path: path };
    });
    return adapters;
  }
  function gen(id) {
    var l = gens();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    throw new Error('no generator ' + id);
  }

  // A generator's settings live in Lua, as the engine left them.
  var sessions = {}, nextSession = 1;
  function session(id) { var s = sessions[id]; if (!s) throw new Error('no session ' + id); return s; }
  function normalise(r) {
    r = r || { results: [] };
    r.results = list(r.results);
    r.results.forEach(function (res) {
      res.parts = list(res.parts);
      res.parts.forEach(function (p) { p.notes = list(p.notes); });
    });
    return r;
  }

  // ------------------------------------------------------------- theory --
  // Chord names are ScaleView's, read by Midi Variator's port of it.
  // mv_theory knows the seven-note scales; anything else names chords
  // against the parallel major or minor. Indexed by ScaleView's scale (1-16).
  var MV_SCALE = [1, 2, 3, 1, 4, 5, 6, 7, 2, 1, 2, 1, 2, 1, 2, 1];
  var keyCache = {};
  function luaKey(key) {
    var k = key.root + ':' + key.scale;
    if (!keyCache[k]) keyCache[k] = call('midi-variator/mv_theory.lua', 'key', key.root, MV_SCALE[key.scale - 1] || 1);
    return keyCache[k];
  }

  // -------------------------------------------------------- orchestra ----
  // Noterator's instruments beyond the orchestra (Source/Core/Instruments.cpp).
  var EXTRA = [
    { id: 'asax', name: 'Alto Saxophone', family: 'Woodwind', low: 49, high: 80, sweet: [53, 76], poly: 1, fast: 0.09, leap: 12 },
    { id: 'tsax', name: 'Tenor Saxophone', family: 'Woodwind', low: 44, high: 75, sweet: [48, 70], poly: 1, fast: 0.09, leap: 12 },
    { id: 'bsax', name: 'Baritone Saxophone', family: 'Woodwind', low: 36, high: 69, sweet: [40, 62], poly: 1, fast: 0.10, leap: 12 },
    { id: 'vib', name: 'Vibraphone', family: 'Percussion', low: 53, high: 89, sweet: [55, 84], poly: 4, fast: 0.09, leap: 12 },
    { id: 'sop', name: 'Soprano', family: 'Voices', low: 60, high: 81, sweet: [64, 77], poly: 1, fast: 0.15, leap: 9 },
    { id: 'alto', name: 'Alto', family: 'Voices', low: 53, high: 74, sweet: [57, 69], poly: 1, fast: 0.15, leap: 9 },
    { id: 'ten', name: 'Tenor', family: 'Voices', low: 48, high: 69, sweet: [50, 65], poly: 1, fast: 0.15, leap: 9 },
    { id: 'bass', name: 'Bass', family: 'Voices', low: 40, high: 64, sweet: [43, 60], poly: 1, fast: 0.15, leap: 9 },
    { id: 'gtr', name: 'Guitar', family: 'Band', low: 40, high: 83, sweet: [45, 76], poly: 6, fast: 0.08, leap: 12 },
    { id: 'ebass', name: 'Bass Guitar', family: 'Band', low: 28, high: 67, sweet: [28, 55], poly: 1, fast: 0.09, leap: 12 },
    { id: 'ubass', name: 'Upright Bass', family: 'Band', low: 28, high: 67, sweet: [28, 55], poly: 1, fast: 0.10, leap: 12 },
    { id: 'synth', name: 'Synth', family: 'Band', low: 24, high: 108, sweet: [36, 96], poly: 16, fast: 0.03, leap: 48 },
    { id: 'kit', name: 'Drum Kit', family: 'Band', low: 35, high: 81, sweet: [35, 81], poly: 4, fast: 0.05, leap: 127, drums: true }
  ];

  // ----------------------------------------------------------- notation --
  var notate = null;
  function notation() {
    if (notate) return notate;
    var N = engine('notation/sb_notate.lua'), D = engine('notation/sb_draw.lua'), Gl = engine('notation/sb_glyphs.lua');
    L.call(L.index(D, 'setNotate'))(N);
    L.call(L.index(D, 'setGlyphs'))(Gl);
    notate = { N: N, D: D, E: engine('starting-blocks/sb_engine.lua') };
    return notate;
  }
  // A pen that records what Starting Blocks Notation draws, for the native
  // side to replay. sb_draw.lua uses four calls; colours arrive as the ids
  // given to it (1 ink, 2 staff, 3 ground, 4 accent):
  //   ["line", x1, y1, x2, y2, colour, thickness]
  //   ["poly", [x, y, x, y, ...], colour]
  //   ["circle", x, y, r, colour, filled]
  //   ["text", x, y, colour, text, size, centred]
  function num(v) { return v instanceof L.LFloat ? v.n : +v; }
  function colour(c) { return c instanceof L.LuaTable ? js(c) : num(c); }
  function recordingPen(ops) {
    var pen = new L.LuaTable();
    pen.set('line', function (x1, y1, x2, y2, col, th) {
      ops.push(['line', num(x1), num(y1), num(x2), num(y2), colour(col), th === undefined ? 1 : num(th)]); return L.NONE;
    });
    pen.set('poly', function (pts, col) {
      ops.push(['poly', pts.arr.map(num), colour(col)]); return L.NONE;
    });
    pen.set('circle', function (x, y, r, col, filled) {
      ops.push(['circle', num(x), num(y), num(r), colour(col), !!L.T(filled)]); return L.NONE;
    });
    pen.set('text', function (x, y, col, str, size, center) {
      ops.push(['text', num(x), num(y), colour(col), L.fromBytes(L.tostring(str)), num(size), !!L.T(center)]); return L.NONE;
    });
    return pen;
  }

  // ---------------------------------------------------------- the pass ---
  var pass = null, passState = null, passSession = null;
  function battlePass() {
    if (pass) return pass;
    var T = engine('battle-pass/bp_theory.lua');
    var Lt = L.first(L.call(L.index(engine('battle-pass/bp_loot.lua'), 'init'))(T));
    var Gm = L.first(L.call(L.index(engine('battle-pass/bp_game.lua'), 'init'))(Lt));
    pass = { G: Gm, L: Lt, T: T };
    return pass;
  }

  // ------------------------------------------------------------- methods -
  var M = {
    generators: function () {
      return gens().map(function (g) { return { id: g.id, name: g.name, description: g.description, input: g.input, panel: g.panel }; });
    },
    newSession: function (a) {
      var g = gen(a.generator), id = nextSession++;
      sessions[id] = { g: g, st: L.first(L.call(L.index(g.A, 'newState'))()) };
      return id;
    },
    useKey: function (a) { var s = session(a.session); call(s.g.A, 'useKey', s.st, a.key.root, a.key.scale); return true; },
    settings: function (a) { var s = session(a.session); return list(js(call(s.g.A, 'settings', s.st, L.toLua(a.context || {})))); },
    set: function (a) { var s = session(a.session); call(s.g.A, 'set', s.st, a.setting, a.index, L.toLua(a.context || {})); return true; },
    generate: function (a) {
      var s = session(a.session);
      return normalise(js(call(s.g.A, 'generate', s.st, L.toLua(a.context || {}), a.seed || 1, a.count || 6)));
    },
    snapshot: function (a) { return js(session(a.session).st); },
    restore: function (a) {
      var s = session(a.session);
      Object.keys(a.state || {}).forEach(function (k) { L.setindex(s.st, L.toBytes(k), L.toLua(a.state[k])); });
      return true;
    },
    closeSession: function (a) { delete sessions[a.session]; return true; },

    nameChord: function (a) {
      if (!a.pitches || a.pitches.length < 2) return '';
      var r = L.call(L.index(engine('midi-variator/mv_theory.lua'), 'nameChord'))(L.toLua(a.pitches), luaKey(a.key));
      return js(L.first(r)) || '';
    },
    noteNames: function (a) {
      var k = js(L.index(luaKey(a.key), 'names')), out = [];
      for (var pc = 0; pc < 12; pc++) out.push(k[pc] || k[String(pc)] || '');
      return out;
    },
    // Midi Variator's key finder (ScaleView's), as Miderator's key lane uses it.
    detectKey: function (a) {
      var notes = (a.notes || []).slice().sort(function (x, y) { return x.start - y.start; });
      if (!notes.length) return null;
      var r = list(js(call('midi-variator/mv_theory.lua', 'detectKey',
        notes.map(function (n) { return { pitch: n.pitch, start: n.start, len: n.len }; }),
        notes[0].pitch % 12, notes[notes.length - 1].pitch % 12)));
      if (!r.length) return null;
      return { root: r[0].root, scale: r[0].scale === 2 ? 2 : 1 };
    },
    // Midi Catalogue's orchestra, plus Noterator's band and voices.
    instruments: function () {
      return list(js(L.index(engine('midi-catalogue/mc_orchestra.lua'), 'INSTRUMENTS'))).concat(EXTRA);
    },
    orchestration: function () {
      var A = js(engine('orchestration/orchestration_data.lua'));
      var B = js(engine('orchestration/orchestration_composers.lua'));
      return { entries: list(A.ENTRIES).concat(list(B && B.ENTRIES)),
               sources: Object.assign({}, (B && B.SOURCES) || {}, A.SOURCES || {}) };
    },

    // A part engraved by Starting Blocks Notation: its height and the drawing,
    // as a list of pen calls in staff spaces of `space` points.
    engrave: function (a) {
      var nt = notation();
      var st = L.first(L.call(L.index(nt.E, 'newState'))());
      st.set('root', a.key.root); st.set('scale', a.key.scale); st.set('barBeats', a.barBeats);
      var ctx = L.first(L.call(L.index(nt.N, 'context'))(nt.E, st));
      var block = L.toLua({ notes: a.notes, beats: a.beats, name: a.name || '' });
      var opts = L.toLua({ barBeats: a.barBeats, tsNum: a.meter[0], tsDen: a.meter[1], width: a.width,
                           drums: !!a.drums, grid: a.drums ? 0.25 : undefined,
                           // a clip is as played, so its silences are rests (Starting Blocks Notation 0019)
                           rests: !a.drums });
      opts.set('ctx', ctx);
      var doc = L.first(L.call(L.index(nt.N, 'layout'))(block, opts));
      var height = +L.first(L.call(L.index(nt.D, 'height'))(doc, a.space));
      var ops = [];
      var colours = L.toLua({ ink: 1, staff: 2, ground: 3, accent: 4 });
      var popts = new L.LuaTable();
      if (a.highlight !== undefined && a.highlight >= 0) {
        var at = a.highlight * 960;
        popts.set('highlight', function (el) {
          var abs = L.index(el, 'abs'), ticks = L.index(el, 'ticks');
          return abs !== undefined && at >= +abs && at < +abs + +ticks;
        });
      }
      L.call(L.index(nt.D, 'page'))(recordingPen(ops), doc, 0, 0, a.space, colours, popts);
      return { height: height, ops: ops };
    },

    // The Battle Pass, unchanged: its state is the game's own text.
    // `clock` is seconds of activity time, `epoch` the wall clock in seconds.
    passStart: function (a) {
      var Gm = battlePass().G;
      passState = a.saved ? L.first(L.call(L.index(Gm, 'deserialize'))(L.toBytes(a.saved))) : undefined;
      if (!passState) passState = L.first(L.call(L.index(Gm, 'newState'))(a.epoch));
      L.call(L.index(Gm, 'clampState'))(passState, a.epoch);
      passSession = L.first(L.call(L.index(Gm, 'newSession'))(passState, a.clock, a.epoch));
      L.call(L.index(Gm, 'refresh'))(passState, passSession, a.epoch, new L.LuaTable());
      return true;
    },
    // Any bp_game function; "$state" and "$session" in `args` stand for the
    // game's own tables.
    passCall: function (a) {
      var args = (a.args || []).map(function (x) {
        return x === '$state' ? passState : x === '$session' ? passSession : L.toLua(x);
      });
      return js(L.first(L.call(L.index(battlePass().G, a.fn)).apply(null, args)));
    },
    // What the game wants celebrated since last asked, then forgotten.
    passNotices: function () {
      var l = L.index(passSession, 'notices');
      if (!l || !l.arr || !l.arr.length) return [];
      var out = l.arr.map(function (n) { return js(n); });
      l.arr.length = 0;
      return out;
    },
    passGet: function (a) {
      var v = passState;
      String(a.path).split('.').forEach(function (k) { v = v === undefined ? undefined : L.index(v, isNaN(+k) ? k : +k); });
      return v instanceof L.LFloat ? v.n : js(v);
    },
    // Middaw's composer (runtime/composer/, the port of middaw/): a sentence
    // in, the song's five parts out, exactly as `python3 -m middaw --json`
    // answers. composerLoad takes data/vocab/tags.json and drums.json as text.
    composerLoad: function (a) {
      if (!G.MiddawComposer || !G.MiddawComposer.load) throw new Error('the composer is not loaded');
      G.MiddawComposer.load(JSON.parse(a.tags), JSON.parse(a.drums));
      return true;
    },
    compose: function (a) {
      var C = G.MiddawComposer;
      if (!C || !C.vocabulary) throw new Error('the composer has no vocabulary');
      return C.compose(String(a.prompt || ''), a.seed === undefined || a.seed === null ? undefined : a.seed);
    },

    // The game's own tables that are not state: the shop, the check-in
    // calendar, the rarities (module 'loot').
    passConst: function (a) {
      var P = battlePass();
      var v = L.index(a.module === 'loot' ? P.L : P.G, String(a.name));
      // a list that is also indexed by name (G.SHOP[id]) is its list
      if (v instanceof L.LuaTable && L.index(v, 1) != null) {
        var out = [];
        for (var i = 1; L.index(v, i) != null; i++) out.push(js(L.index(v, i)));
        return out;
      }
      return js(v);
    },
    passSave: function () { return L.fromBytes(L.first(L.call(L.index(battlePass().G, 'serialize'))(passState))); },

    // AutoCC (the JSFX, unchanged) run over a clip's notes: the curves it
    // would play, as controller lanes {number: [[beat, value], ...]}. Only a
    // point where the value turns is kept, not every step.
    autoCC: function (a) {
      var J = G.MiddawJSFX;
      if (!J) throw new Error('the JSFX runtime is not loaded');
      var fx = new J.JSFX(a.source, {});
      Object.keys(a.sliders || {}).forEach(function (k) { fx.setSliderByIndex(Number(k), a.sliders[k]); });
      var sr = 48000, bs = 256;
      fx.init(sr);
      fx.setTime({ tempo: a.tempo, playState: 1, num: a.meter[0], den: a.meter[1] });
      var ev = [];
      (a.notes || []).forEach(function (n) {
        ev.push([n.start, [0x90, n.pitch, n.vel]]);
        ev.push([n.start + n.len, [0x80, n.pitch, 0]]);
      });
      ev.sort(function (x, y) { return x[0] - y[0]; });
      var spb = sr * 60 / a.tempo, total = Math.ceil(a.length * spb / bs) + 8, k = 0, lanes = {};
      for (var b = 0; b < total; b++) {
        var midi = [];
        while (k < ev.length && ev[k][0] * spb < (b + 1) * bs) {
          midi.push({ offset: Math.max(0, Math.round(ev[k][0] * spb - b * bs)), data: ev[k][1] }); k++;
        }
        fx.setTime({ beat: b * bs / spb, seconds: b * bs / sr });
        fx.process(bs, null, null, midi).forEach(function (m) {
          if ((m.data[0] & 0xF0) !== 0xB0) return;
          var beat = (b * bs + m.offset) / spb;
          if (beat > a.length) return;
          (lanes[m.data[1]] = lanes[m.data[1]] || []).push([Math.round(beat * 1000) / 1000, m.data[2]]);
        });
      }
      Object.keys(lanes).forEach(function (num) {
        var pts = lanes[num], out = [];
        pts.forEach(function (pt, i) {
          var prev = out[out.length - 1];
          if (!prev || i === pts.length - 1 || Math.abs(pt[1] - prev[1]) >= 2) out.push(pt);
        });
        lanes[num] = out;
      });
      return lanes;
    }
  };

  G.MiddawHost = {
    FILES: FILES,
    init: init,
    // The one entry point the native side uses: JSON in, JSON out, errors
    // returned rather than thrown so they cross the bridge as text.
    call: function (method, argsJSON) {
      try {
        if (!M[method]) throw new Error('no method ' + method);
        var r = M[method](argsJSON ? JSON.parse(argsJSON) : {});
        return JSON.stringify({ ok: true, value: r === undefined ? null : r });
      } catch (e) {
        var msg = e && (e.message || (e.value !== undefined ? String(L.tostring ? L.tostring(e.value) : e.value) : String(e)));
        return JSON.stringify({ ok: false, error: msg || 'error' });
      }
    },
    methods: M
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);


/* ---- kit/ui.js ---- */
/* The family's look, drawn with Max's mgraphics in a [v8ui].
 *
 * Colours are Middaw's HousePalette (MiddawCore/Palette.swift): cool greys,
 * the yellow accent for what is on, every word 7:1 on its surface. A control
 * registers its rectangle while it is painted, so a click goes to whatever
 * was drawn under it last paint - no layout is kept twice.
 */
var UI = (function () {
  'use strict';
  function rgb(hex, a) {
    return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a === undefined ? 1 : a];
  }
  var C = {
    accent: rgb(0xFFF200), accentHeld: rgb(0xD1C600), control: rgb(0xA9AFBA), controlHeld: rgb(0x8F96A2),
    ground: rgb(0x23272E), raised: rgb(0x2A2F37), sunken: rgb(0x1A1D23), rule: rgb(0x3A404A),
    edge: rgb(0x6D7581), ink: rgb(0x14171C), text: rgb(0xDDE1E7), dim: rgb(0xB6BCC6),
    label: rgb(0xBFC5CE), warn: rgb(0xD2483F), warnText: rgb(0xFFA6A0)
  };

  var g = null, hits = [], drag = null, FONT = 'Arial';

  function begin(graphics) {
    g = graphics;
    hits = [];
    g.select_font_face(FONT);
  }
  function fill(c) { g.set_source_rgba(c[0], c[1], c[2], c[3]); }
  function rect(x, y, w, h, c) { fill(c); g.rectangle(x, y, w, h); g.fill(); }
  function round(x, y, w, h, r, c) { fill(c); g.rectangle_rounded(x, y, w, h, r, r); g.fill(); }
  function frame(x, y, w, h, c) { fill(c); g.set_line_width(1); g.rectangle(x + 0.5, y + 0.5, w - 1, h - 1); g.stroke(); }
  function measure(s, size) { g.set_font_size(size || 10); var m = g.text_measure(String(s)); return m[0]; }

  // Text cut to fit, with an ellipsis, so a long name never runs into the next control.
  function fit(s, w, size) {
    s = String(s);
    if (measure(s, size) <= w) return s;
    while (s.length > 1 && measure(s + '…', size) > w) s = s.slice(0, -1);
    return s + '…';
  }
  // align: 0 left, 1 centre, 2 right; y is the box top, h its height.
  function text(s, x, y, w, h, c, size, align, bold) {
    size = size || 10;
    g.select_font_face(FONT, 'normal', bold ? 'bold' : 'normal');
    g.set_font_size(size);
    var t = fit(s, w, size), tw = measure(t, size);
    var tx = align === 1 ? x + (w - tw) / 2 : align === 2 ? x + w - tw : x;
    fill(c);
    g.move_to(tx, y + h / 2 + size * 0.36);
    g.show_text(t);
    g.select_font_face(FONT, 'normal', 'normal');
  }

  function hit(x, y, w, h, handler) { hits.push({ x: x, y: y, w: w, h: h, fn: handler }); }
  function find(px, py) {
    for (var i = hits.length - 1; i >= 0; i--) {
      var r = hits[i];
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return r;
    }
    return null;
  }

  // A push button: title-style words, ink on the control grey, accent when on.
  function button(label, x, y, w, h, on, handler, enabled) {
    var off = enabled === false;
    round(x, y, w, h, 3, off ? C.raised : on ? C.accent : C.control);
    text(label, x + 4, y, w - 8, h, off ? C.dim : C.ink, 10, 1, true);
    if (!off) hit(x, y, w, h, { click: handler });
  }

  // A value chosen from a list: click the left third for the one before, the
  // rest for the one after, or drag up and down through them.
  function stepper(label, names, index, x, y, w, onChange) {
    text(label, x, y, w, 12, C.label, 9, 0);
    var by = y + 13, bh = 18;
    round(x, by, w, bh, 3, C.sunken);
    frame(x, by, w, bh, C.rule);
    text('‹', x + 3, by, 8, bh, C.dim, 11, 1);
    text('›', x + w - 11, by, 8, bh, C.dim, 11, 1);
    text(names[index - 1] === undefined ? '' : names[index - 1], x + 12, by, w - 24, bh, C.text, 10, 1);
    var n = names.length;
    var last = index;
    function to(i) { i = Math.max(1, Math.min(n, i)); if (i !== last) { last = i; onChange(i); } }
    hit(x, by, w, bh, {
      click: function (px) { to(px < x + w / 3 ? index - 1 : index + 1); },
      drag: function (dy) { to(index - Math.round(dy / 8)); }
    });
  }

  function toggle(label, on, x, y, w, h, onChange) {
    round(x, y, w, h, 3, on ? C.accent : C.control);
    text(label, x + 4, y, w - 8, h, C.ink, 10, 1, true);
    hit(x, y, w, h, { click: function () { onChange(!on); } });
  }

  // Mouse, as [v8ui] delivers it: onclick then ondrag until the button is up.
  function click(px, py) {
    var r = find(px, py);
    drag = null;
    if (!r) return false;
    if (r.fn.drag) drag = { r: r, y0: py, moved: false };
    else if (r.fn.click) r.fn.click(px, py);
    return true;
  }
  function dragTo(px, py, down) {
    if (!drag) return;
    var dy = drag.y0 - py;
    if (down) {
      if (Math.abs(dy) >= 4) drag.moved = true;
      if (drag.moved) drag.r.fn.drag(dy);
    } else {
      if (!drag.moved && drag.r.fn.click) drag.r.fn.click(px, py);
      drag = null;
    }
  }

  return { C: C, begin: begin, rect: rect, round: round, frame: frame, text: text, fit: fit, measure: measure,
           hit: hit, button: button, stepper: stepper, toggle: toggle, click: click, dragTo: dragTo, find: find };
})();


/* ---- kit/live.js ---- */
/* The Live set, as the family's devices need it: the song's tempo, meter and
 * scale, the notes of the clip being edited, somewhere to put new notes, and
 * a way to hear notes before they are used.
 *
 * Everything goes through the Live Object Model (LiveAPI). Times are beats,
 * which in Live are quarter notes - the unit every family engine already
 * speaks - so nothing is converted but the field names.
 */
var Live = (function () {
  'use strict';
  function api(path) { return new LiveAPI(null, path); }
  function one(a, prop) { var v = a.get(prop); return Array.isArray(v) ? v[0] : v; }
  function exists(a) { return a && Number(a.id) !== 0; }
  function json(v) {
    if (typeof v === 'string') return JSON.parse(v);
    if (Array.isArray(v) && typeof v[0] === 'string' && v.length === 1) return JSON.parse(v[0]);
    return v;
  }

  // Live 12's scale names, as ScaleView numbers its scales (1-16). A scale
  // ScaleView has no name for is left out: the device keeps its own key.
  var SCALE = {
    'Major': 1, 'Minor': 2, 'Harmonic Minor': 3, 'Dorian': 5, 'Phrygian': 6, 'Lydian': 7,
    'Mixolydian': 8, 'Major Pentatonic': 10, 'Minor Pentatonic': 11, 'Minor Blues': 13,
    'Whole Tone': 14, 'Whole-half Dim.': 15, 'Half-whole Dim.': 16
  };
  // ScaleView's eighteen roots, and the spelling a key on each pitch class
  // takes: flats for the major side, sharps where a minor key has them.
  var ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B', 'Cb'];
  var MAJOR_SIDE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  var MINOR_SIDE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  var MINORISH = { 2: 1, 3: 1, 5: 1, 6: 1, 11: 1, 13: 1 };
  var SCALE_NAMES = ['Major', 'Minor (Natural)', 'Harmonic Minor', 'Ionian', 'Dorian', 'Phrygian', 'Lydian',
                     'Mixolydian', 'Aeolian', 'Major Pentatonic', 'Minor Pentatonic', 'Major Blues', 'Minor Blues',
                     'Whole Tone', 'Diminished Whole-Half', 'Diminished Half-Whole'];

  function song() {
    var s = api('live_set');
    var out = { tempo: +one(s, 'tempo') || 120, num: +one(s, 'signature_numerator') || 4,
                den: +one(s, 'signature_denominator') || 4, playing: !!+one(s, 'is_playing'),
                position: +one(s, 'current_song_time') || 0, key: null };
    var mode = s.get('scale_mode');
    if (mode !== undefined && mode !== null) {
      var name = String(one(s, 'scale_name')), pc = +one(s, 'root_note');
      var sc = SCALE[name];
      out.liveScale = { on: !!+(Array.isArray(mode) ? mode[0] : mode), name: name, root: pc };
      if (sc) out.key = { root: ROOTS.indexOf((MINORISH[sc] ? MINOR_SIDE : MAJOR_SIDE)[((pc % 12) + 12) % 12]) + 1, scale: sc };
    }
    return out;
  }

  function detailClip() {
    var c = api('live_set view detail_clip');
    if (!exists(c) || !+one(c, 'is_midi_clip')) return null;
    return c;
  }

  // The clip being edited: its selected notes if any are selected, else every
  // note in its loop. Starts are from the start of what was taken.
  function clipNotes() {
    var c = detailClip();
    if (!c) return null;
    var from = +one(c, 'loop_start') || 0, to = +one(c, 'loop_end') || 0;
    var raw = null, selected = false;
    try { raw = json(c.call('get_selected_notes_extended')); selected = raw && raw.notes && raw.notes.length > 0; } catch (e) { raw = null; }
    if (!selected) raw = json(c.call('get_notes_extended', 0, 128, from, Math.max(0, to - from)));
    var notes = ((raw && raw.notes) || []).filter(function (n) { return !n.mute; }).map(function (n) {
      return { start: n.start_time, len: n.duration, pitch: n.pitch, vel: Math.round(n.velocity) };
    });
    var first = selected && notes.length ? Math.min.apply(null, notes.map(function (n) { return n.start; })) : from;
    var beats = to - from;
    if (selected) {
      var bar = 4, end = 0;
      notes.forEach(function (n) { end = Math.max(end, n.start + n.len); });
      first = Math.floor(first / bar) * bar;
      beats = Math.ceil((end - first) / bar) * bar;
    }
    notes.forEach(function (n) { n.start -= first; });
    notes.sort(function (a, b) { return a.start - b.start || a.pitch - b.pitch; });
    return { notes: notes, beats: beats, name: String(one(c, 'name') || ''), selected: selected, drums: drumTrack() };
  }

  // A track whose instrument is a Drum Rack plays drums: its note numbers name
  // drums, not pitches, and the engines treat them that way.
  function drumTrack() {
    try {
      var track = api('this_device canonical_parent'), n = track.getcount('devices');
      for (var i = 0; i < n; i++) if (+one(api(track.unquotedpath + ' devices ' + i), 'can_have_drum_pads')) return true;
    } catch (e) { /* not known: not drums */ }
    return false;
  }

  function liveNotes(notes) {
    return { notes: notes.map(function (n) {
      return { pitch: Math.max(0, Math.min(127, Math.round(n.pitch))), start_time: Math.max(0, n.start),
               duration: Math.max(1 / 128, n.len), velocity: Math.max(1, Math.min(127, Math.round(n.vel || 100))), mute: 0 };
    }) };
  }

  function undoable(fn) {
    var s = api('live_set');
    try { s.call('begin_undo_step'); } catch (e) { /* Live before 11.1 */ }
    try { return fn(); } finally { try { s.call('end_undo_step'); } catch (e2) { /* as above */ } }
  }

  function show(clip) {
    try { api('live_set view').set('detail_clip', 'id', Number(clip.id)); } catch (e) { /* the clip is made either way */ }
  }

  function selectedScene() {
    var scene = api('live_set view selected_scene'), n = api('live_set').getcount('scenes');
    for (var i = 0; i < n; i++) if (Number(api('live_set scenes ' + i).id) === Number(scene.id)) return i;
    return 0;
  }
  function thisTrack() {
    var track = api('this_device canonical_parent');
    if (!exists(track) || !+one(track, 'has_midi_input')) return null;
    return track;
  }
  // Where this device's track is in the set, for putting new tracks beside it.
  function trackIndex(track) {
    var n = api('live_set').getcount('tracks');
    for (var i = 0; i < n; i++) if (Number(api('live_set tracks ' + i).id) === Number(track.id)) return i;
    return n - 1;
  }
  function clipInSlot(slot, notes, beats, name) {
    slot.call('create_clip', Math.max(1, beats));
    var clip = api(slot.unquotedpath + ' clip');
    if (name) clip.set('name', name);
    clip.call('add_new_notes', liveNotes(notes));
    return clip;
  }
  function freeSlot(track, from) {
    var n = track.getcount('clip_slots');
    for (var k = 0; k < n; k++) {
      var at = (from + k) % n, slot = api(track.unquotedpath + ' clip_slots ' + at);
      if (!+one(slot, 'has_clip')) return { slot: slot, at: at };
    }
    return null;
  }
  function arrangementClipOn(track, notes, beats, name, at) {
    var before = track.getcount('arrangement_clips');
    try { track.call('create_midi_clip', at, Math.max(1, beats)); } catch (e) { /* checked below */ }
    var count = track.getcount('arrangement_clips');
    if (!(count > before)) return false;
    for (var i = 0; i < count; i++) {
      var clip = api(track.unquotedpath + ' arrangement_clips ' + i);
      if (Math.abs((+one(clip, 'start_time') || 0) - at) < 1e-6) {
        if (name) clip.set('name', name);
        clip.call('add_new_notes', liveNotes(notes));
        return true;
      }
    }
    return false;
  }

  // New notes, as a new clip in the first free slot on this device's track,
  // from the selected scene down. `more` are further parts ({name, notes}),
  // each on a new MIDI track after this one, in the same scene. Returns what
  // happened, for the status line.
  function newClip(notes, beats, name, more) {
    var track = thisTrack();
    if (!track) return { ok: false, message: 'This device needs to be on a MIDI track.' };
    var free = freeSlot(track, selectedScene());
    if (!free) return { ok: false, message: 'Every clip slot on this track is full. Add a scene, then try again.' };
    return undoable(function () {
      var clip = clipInSlot(free.slot, notes, beats, name);
      var made = newTracks(track, more, function (t) {
        clipInSlot(api(t.unquotedpath + ' clip_slots ' + free.at), this.notes, beats, this.name);
      });
      show(clip);
      return { ok: true, message: 'Added a clip in scene ' + (free.at + 1) + (made ? ', and ' + made + ' on new tracks beside it.' : '.') };
    });
  }

  // New notes on a new MIDI track beside this one, in the selected scene:
  // a suggestion goes with the music it was made for, not over it.
  function newTrackClip(notes, beats, name, more) {
    var track = thisTrack();
    if (!track) return { ok: false, message: 'This device needs to be on a MIDI track.' };
    var scene = selectedScene();
    return undoable(function () {
      var parts = [{ name: name, notes: notes }].concat(more || []);
      newTracks(track, parts, function (t) { show(clipInSlot(api(t.unquotedpath + ' clip_slots ' + scene), this.notes, beats, this.name)); });
      return { ok: true, message: parts.length === 1 ? 'Added a track beside this one, with the clip in scene ' + (scene + 1) + '.'
                                                     : 'Added ' + parts.length + ' tracks beside this one, with the clips in scene ' + (scene + 1) + '.' };
    });
  }

  // Each further part on a new MIDI track, in order, after this one.
  function newTracks(track, more, put) {
    if (!more || !more.length) return '';
    var at = trackIndex(track), song = api('live_set');
    more.forEach(function (part, k) {
      song.call('create_midi_track', at + 1 + k);
      var t = api('live_set tracks ' + (at + 1 + k));
      t.set('name', part.name);
      put.call(part, t);
    });
    return more.length === 1 ? 'one more part' : more.length + ' more parts';
  }

  // New notes in place of the notes of the clip being edited, from its loop start.
  function replaceInClip(notes, beats) {
    var c = detailClip();
    if (!c) return { ok: false, message: 'No MIDI clip is open. Open one in Detail View, then try again.' };
    var from = +one(c, 'loop_start') || 0;
    return undoable(function () {
      var span = Math.max(beats, (+one(c, 'loop_end') || 0) - from);
      c.call('remove_notes_extended', 0, 128, from, span);
      c.call('add_new_notes', liveNotes(notes.map(function (n) {
        return { start: n.start + from, len: n.len, pitch: n.pitch, vel: n.vel };
      })));
      if ((+one(c, 'loop_end') || 0) < from + beats) c.set('loop_end', from + beats);
      return { ok: true, message: 'Replaced the notes in “' + (String(one(c, 'name') || '') || 'the clip') + '”.' };
    });
  }

  // New notes in the Arrangement at the insert marker, on this device's track
  // (Track.create_midi_clip, Live 12.2 and later); further parts as above.
  function arrangementClip(notes, beats, name, more) {
    var track = thisTrack();
    if (!track) return { ok: false, message: 'This device needs to be on a MIDI track.' };
    var at = +one(api('live_set'), 'current_song_time') || 0;
    return undoable(function () {
      if (!arrangementClipOn(track, notes, beats, name, at)) {
        return { ok: false, message: 'This version of Live can\u2019t add Arrangement clips from a device. Choose New Clip instead.' };
      }
      var made = newTracks(track, more, function (t) { arrangementClipOn(t, this.notes, beats, this.name, at); });
      return { ok: true, message: 'Added a clip to the Arrangement at beat ' + (Math.round(at * 100) / 100 + 1) +
               (made ? ', and ' + made + ' on new tracks beside it.' : '.') };
    });
  }

  // ------------------------------------------------------------ player ---
  // Notes heard through this device's MIDI out: the instrument after it on
  // the track plays them. A Task ticks every few milliseconds and sends what
  // is due; nothing waits on the transport.
  function Player(send) {
    this.send = send; this.events = []; this.pos = 0; this.t0 = 0; this.task = null; this.sounding = {};
    this.onEnd = null;
  }
  Player.prototype.play = function (notes, tempo, onEnd) {
    this.stop();
    var ms = 60000 / (tempo || 120), ev = [];
    notes.forEach(function (n) {
      ev.push({ t: n.start * ms, on: true, pitch: n.pitch, vel: n.vel || 100 });
      ev.push({ t: (n.start + n.len) * ms - 1, on: false, pitch: n.pitch });
    });
    ev.sort(function (a, b) { return a.t - b.t || (a.on === b.on ? 0 : a.on ? 1 : -1); });
    this.events = ev; this.pos = 0; this.t0 = Date.now(); this.onEnd = onEnd || null;
    var self = this;
    this.task = new Task(function () { self.tick(); }, this);
    this.task.interval = 4;
    this.task.repeat();
    this.tick();
  };
  Player.prototype.tick = function () {
    var now = Date.now() - this.t0;
    while (this.pos < this.events.length && this.events[this.pos].t <= now) {
      var e = this.events[this.pos++];
      if (e.on) { this.sounding[e.pitch] = (this.sounding[e.pitch] || 0) + 1; this.send([0x90, e.pitch, Math.max(1, Math.min(127, Math.round(e.vel)))]); }
      else if (this.sounding[e.pitch]) { this.sounding[e.pitch]--; this.send([0x80, e.pitch, 0]); }
    }
    if (this.pos >= this.events.length) {
      var end = this.onEnd;
      this.stop();
      if (end) end();
    }
  };
  Player.prototype.playing = function () { return !!this.task; };
  Player.prototype.stop = function () {
    if (this.task) { this.task.cancel(); this.task.freepeer && this.task.freepeer(); this.task = null; }
    var self = this;
    Object.keys(this.sounding).forEach(function (p) {
      for (var i = 0; i < self.sounding[p]; i++) self.send([0x80, +p, 0]);
    });
    this.sounding = {};
    this.onEnd = null;
  };

  return { song: song, clipNotes: clipNotes, newClip: newClip, newTrackClip: newTrackClip, replaceInClip: replaceInClip,
           arrangementClip: arrangementClip, drumTrack: drumTrack, Player: Player, ROOTS: ROOTS, SCALE_NAMES: SCALE_NAMES };
})();


/* ---- kit/generator.js ---- */
/* A family generator as a Max for Live MIDI effect.
 *
 * The engine is the repository's own Lua, run unchanged by Middaw's Lua
 * runtime; the adapter (Noterator's) turns its settings into lists and its
 * output into notes. This file is only the window: the key, the engine's
 * settings, the results, and Play and Insert.
 *
 * Expects, before it: UI, Live, MiddawHost, and DEVICE = { generator, files }.
 * Outlets: 0 MIDI bytes to [midiout], 1 the saved state to [pattr].
 */
inlets = 1;
outlets = 2;
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var H = MiddawHost;
H.init(function (p) { return DEVICE.files[p] === undefined ? null : DEVICE.files[p]; },
       function (s) { post(s + '\n'); });

function call(method, args) {
  var r = JSON.parse(H.call(method, args === undefined ? '' : JSON.stringify(args)));
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

var GEN = null;
call('generators').forEach(function (g) { if (g.id === DEVICE.generator) GEN = g; });

var S = {
  session: call('newSession', { generator: DEVICE.generator }),
  key: { root: 1, scale: 1 }, follow: true, seed: 1, target: 0,
  song: { tempo: 120, num: 4, den: 4 },
  settings: [], results: [], chosen: 0, part: 0, inst: 'pno', page: 0, scroll: 0,
  selection: null, status: '', warn: false, ready: false, pending: null
};
// Where Insert puts a result. A suggestion (DEVICE.beside) goes with the
// music it was made for, so its first choice is a track of its own.
var TARGETS = DEVICE.beside ? ['New Track', 'New Clip', 'Arrangement', 'This Clip'] : ['New Clip', 'Arrangement', 'This Clip'];
var player = new Live.Player(function (bytes) { for (var i = 0; i < bytes.length; i++) outlet(0, bytes[i]); });

function say(msg, warn) { S.status = msg || ''; S.warn = !!warn; }

function context() {
  var sel = S.selection || { notes: [], beats: 0, drums: false };
  return { root: S.key.root, scale: S.key.scale, num: S.song.num, den: S.song.den,
           barBeats: S.song.num * 4 / S.song.den, bpm: S.song.tempo, inst: S.inst, catalogueId: S.inst, bars: 4,
           selection: { notes: sel.notes, beats: sel.beats, drums: !!sel.drums } };
}

// A result with more than one part (melody, chords, bass, drums) offers a
// Part setting of the device's own: all of them, or one.
function partNames() {
  var most = [];
  S.results.forEach(function (r) { if (r.parts.length > most.length) most = r.parts; });
  return most.length > 1 ? ['All Parts'].concat(most.map(function (p, i) { return p.name || ('Part ' + (i + 1)); })) : null;
}
// The device's Key and Scale are the engine's key; an engine that also lists
// its own is not shown it twice.
var OWN_KEY = { root: 1, scale: 1, key: 1 };
// An engine written for one instrument (DEVICE.instrument) is told which:
// Midi Catalogue's orchestra, chosen on the device, as Noterator's part is.
var EXTRA = { asax: 1, tsax: 1, bsax: 1, vib: 1, sop: 1, alto: 1, ten: 1, bass: 1, gtr: 1, ebass: 1, ubass: 1, synth: 1, kit: 1 };
var INSTRUMENTS = DEVICE.instrument ? call('instruments').filter(function (i) { return !EXTRA[i.id]; }) : [];
function refreshSettings() {
  S.settings = call('settings', { session: S.session, context: context() }).filter(function (s) { return !OWN_KEY[s.id]; });
  if (INSTRUMENTS.length) {
    var at = 0;
    INSTRUMENTS.forEach(function (x, i) { if (x.id === S.inst) at = i; });
    S.settings.unshift({ id: '$inst', label: 'Instrument', names: INSTRUMENTS.map(function (x) { return x.name; }), index: at + 1, hint: '' });
  }
  var parts = partNames();
  if (parts) {
    if (S.part >= parts.length) S.part = 0;
    S.settings.push({ id: '$part', label: 'Part', names: parts, index: S.part + 1, hint: '' });
  }
}

function generate() {
  if (GEN.input === 'selection' && !S.selection) {
    S.results = [];
    refreshSettings();
    say('Open a MIDI clip in Detail View, then click Use Clip.');
    return;
  }
  try {
    var r = call('generate', { session: S.session, context: context(), seed: S.seed, count: 8 });
    S.results = r.results || [];
    if (S.chosen >= S.results.length) S.chosen = 0;
    refreshSettings();
    if (r.message) say(r.message);
    else if (!S.results.length) say('Nothing fits these settings. Change one, then try again.');
  } catch (e) {
    S.results = [];
    say(String(e.message || e), true);
  }
}

function save() {
  outlet(1, 'set', JSON.stringify({ v: 1, st: call('snapshot', { session: S.session }), key: S.key,
                                    follow: S.follow, seed: S.seed, target: S.target, part: S.part, inst: S.inst }));
}

function useKey() { call('useKey', { session: S.session, key: S.key }); }

function readSong() {
  try {
    var s = Live.song();
    S.song = { tempo: s.tempo, num: s.num, den: s.den };
    if (S.follow && s.liveScale && s.liveScale.on) {
      if (s.key) { S.key = s.key; return true; }
      say('Live’s scale, ' + s.liveScale.name + ', isn’t one this device knows, so it stays in ' + keyName() + '.');
    }
  } catch (e) { /* not in Live: keep what we have */ }
  return false;
}

function keyName() { return Live.ROOTS[S.key.root - 1] + ' ' + Live.SCALE_NAMES[S.key.scale - 1]; }

// ------------------------------------------------------------ messages --
// [live.thisdevice] bangs once Live is ready to be spoken to.
function bang() {
  S.ready = true;
  if (S.pending) { apply(S.pending); S.pending = null; }
  readSong();
  useKey();
  generate();
  mgraphics.redraw();
}

// The state [pattr] kept with the Live set.
function restore(text) {
  var st = null;
  try { st = JSON.parse(String(text)); } catch (e) { return; }
  if (!S.ready) { S.pending = st; return; }
  apply(st);
  generate();
  mgraphics.redraw();
}
function apply(st) {
  if (!st || st.v !== 1) return;
  if (st.st) call('restore', { session: S.session, state: st.st });
  if (st.key) S.key = st.key;
  S.follow = st.follow !== false;
  S.seed = st.seed || 1;
  S.target = st.target || 0;
  S.part = st.part || 0;
  if (st.inst) S.inst = st.inst;
  useKey();
}

// ------------------------------------------------------------- actions --
function setSetting(id, index) {
  if (id === '$part') { S.part = index - 1; refreshSettings(); save(); mgraphics.redraw(); return; }
  if (id === '$inst') { S.inst = INSTRUMENTS[index - 1].id; say(''); generate(); save(); mgraphics.redraw(); return; }
  call('set', { session: S.session, setting: id, index: index, context: context() });
  say('');
  generate();
  save();
  mgraphics.redraw();
}
function setKey(root, scale) {
  S.key = { root: root, scale: scale };
  S.follow = false;
  useKey();
  say('');
  generate();
  save();
  mgraphics.redraw();
}
function newIdeas() {
  S.seed = 1 + Math.floor(Math.random() * 99999);
  S.chosen = 0; S.scroll = 0;
  say('');
  readSong();
  useKey();
  generate();
  save();
  mgraphics.redraw();
}
// The chosen result as notes: every part together for hearing, and for
// inserting the first part here and `more` on tracks of their own.
function chosenNotes() {
  var r = S.results[S.chosen];
  if (!r) return null;
  var parts = S.part > 0 && r.parts[S.part - 1] ? [r.parts[S.part - 1]] : r.parts;
  var all = [];
  parts.forEach(function (p) { p.notes.forEach(function (n) { all.push(n); }); });
  all.sort(function (a, b) { return a.start - b.start || a.pitch - b.pitch; });
  var title = r.title || GEN.name;
  function named(p) { return parts.length > 1 && p.name ? title + ' \u2014 ' + p.name : title; }
  return { all: all, notes: parts[0] ? parts[0].notes : [], beats: r.beats || 4, title: named(parts[0] || {}),
           more: parts.slice(1).map(function (p) { return { name: named(p), notes: p.notes }; }) };
}
function play() {
  if (player.playing()) { player.stop(); mgraphics.redraw(); return; }
  var c = chosenNotes();
  if (!c) return;
  readSong();
  player.play(heard(c), S.song.tempo, function () { mgraphics.redraw(); });
  mgraphics.redraw();
}
// What Play sounds: the result, and for a suggestion the music it goes with.
function heard(c) {
  if (!DEVICE.beside || !S.selection) return c.all;
  return c.all.concat(S.selection.notes).sort(function (a, b) { return a.start - b.start || a.pitch - b.pitch; });
}
function insert() {
  var c = chosenNotes();
  if (!c) return;
  player.stop();
  var r;
  try {
    var beats = Math.max(c.beats, Math.ceil(c.beats));
    var where = TARGETS[S.target];
    r = where === 'New Track' ? Live.newTrackClip(c.notes, beats, c.title, c.more)
      : where === 'New Clip' ? Live.newClip(c.notes, beats, c.title, c.more)
      : where === 'Arrangement' ? Live.arrangementClip(c.notes, beats, c.title, c.more)
      : c.more.length ? { ok: false, message: 'This Clip takes one part. Choose a part, then try again.' }
      : Live.replaceInClip(c.notes, beats);
  } catch (e) { r = { ok: false, message: String(e.message || e) }; }
  say(r.message, !r.ok);
  mgraphics.redraw();
}
function useClip() {
  var c = null;
  try { c = Live.clipNotes(); } catch (e) { c = null; }
  if (!c) { say('No MIDI clip is open. Open one in Detail View, then try again.', true); mgraphics.redraw(); return; }
  if (!c.notes.length) { say('That clip has no notes. Choose a clip with notes, then try again.', true); mgraphics.redraw(); return; }
  S.selection = { notes: c.notes, beats: Math.max(1, c.beats), name: c.name, drums: c.drums };
  say('Using ' + c.notes.length + (c.selected ? ' selected' : '') + ' notes from “' + (c.name || 'the clip') + '”.');
  readSong();
  generate();
  mgraphics.redraw();
}
function choose(i) {
  S.chosen = i;
  player.stop();
  var c = chosenNotes();
  if (c) player.play(heard(c), S.song.tempo, function () { mgraphics.redraw(); });
  mgraphics.redraw();
}

// --------------------------------------------------------------- paint --
var KEY_X = 6, KEY_W = 104, SET_X = 118, CELL_W = 104, CELL_GAP = 6, ROW_Y = [20, 54, 88, 122];

function size() {
  var r = (typeof box !== 'undefined' && box.rect) ? box.rect : [0, 0, 860, 169];
  return [r[2] - r[0], r[3] - r[1]];
}

function paint() {
  var g = mgraphics, sz = size(), W = sz[0], Ht = sz[1];
  UI.begin(g);
  UI.rect(0, 0, W, Ht, UI.C.ground);
  UI.text(S.status || ((DEVICE.title || GEN.name) + (DEVICE.keyless ? '' : ' — ' + keyName())), 6, 1, W - 12, 16, S.warn ? UI.C.warnText : UI.C.dim, 10, 0);

  // The key: the engine writes in it, and follows Live's scale when asked.
  // An engine that hears the key in the music it is given has no key to set.
  if (!DEVICE.keyless) {
  UI.stepper('Key', Live.ROOTS, S.key.root, KEY_X, ROW_Y[0], KEY_W, function (i) { setKey(i, S.key.scale); });
  UI.stepper('Scale', Live.SCALE_NAMES, S.key.scale, KEY_X, ROW_Y[1], KEY_W, function (i) { setKey(S.key.root, i); });
  UI.toggle('Follow Live', S.follow, KEY_X, ROW_Y[2] + 13, KEY_W, 18, function (on) {
    S.follow = on;
    if (on) { readSong(); useKey(); generate(); }
    save(); mgraphics.redraw();
  });
  }
  if (GEN.input === 'selection') UI.button('Use Clip', KEY_X, DEVICE.keyless ? ROW_Y[0] + 13 : ROW_Y[3] + 13, KEY_W, 18, !!S.selection, useClip);

  // A block read as notation (DEVICE.notation): Starting Blocks Notation's
  // engraving of the chosen result, at the right.
  var noteW = DEVICE.notation ? 380 : 0;
  if (noteW) drawScore(W - noteW, 18, noteW - 6, Ht - 22);

  // The engine's settings, four rows to a column.
  var resX = W - 296 - noteW, cols = Math.max(1, Math.floor((resX - SET_X) / (CELL_W + CELL_GAP))), per = cols * 4;
  var pages = Math.max(1, Math.ceil(S.settings.length / per));
  if (S.page >= pages) S.page = 0;
  var shown = S.settings.slice(S.page * per, (S.page + 1) * per);
  shown.forEach(function (s, i) {
    var col = Math.floor(i / 4), row = i % 4;
    UI.stepper(s.label, s.names, s.index, SET_X + col * (CELL_W + CELL_GAP), ROW_Y[row], CELL_W, function (k) { setSetting(s.id, k); });
  });
  // More than a page of settings: the next page from the foot of the key
  // column, which is free (Use Clip sits at its top when there is no key).
  if (pages > 1 && !(GEN.input === 'selection' && !DEVICE.keyless)) {
    UI.button('More Settings', KEY_X, ROW_Y[3] + 13, KEY_W, 18, false, function () { S.page = (S.page + 1) % pages; mgraphics.redraw(); });
    UI.text('Page ' + (S.page + 1) + ' of ' + pages, KEY_X, ROW_Y[3] + 32, KEY_W, 14, UI.C.dim, 9, 1);
  }

  // The results: click one to hear it.
  // Eight rows, or seven and the arrows in the eighth's place when there are more.
  var lx = resX, lw = 290, ly = 20, rowH = 15, rows = S.results.length > 8 ? 7 : 8;
  UI.rect(lx, ly, lw, 8 * rowH + 2, UI.C.sunken);
  if (S.chosen < S.scroll) S.scroll = S.chosen;
  if (S.chosen >= S.scroll + rows) S.scroll = S.chosen - rows + 1;
  for (var i = 0; i < rows && S.scroll + i < S.results.length; i++) {
    var k = S.scroll + i, r = S.results[k], y = ly + 1 + i * rowH, on = k === S.chosen;
    if (on) { UI.rect(lx, y, lw, rowH, UI.C.raised); UI.rect(lx, y, 3, rowH, UI.C.accent); }
    UI.text(r.title || ('Result ' + (k + 1)), lx + 8, y, lw * 0.6 - 10, rowH, on ? UI.C.text : UI.C.label, 10, 0, on);
    UI.text(r.detail || '', lx + lw * 0.6, y, lw * 0.4 - 6, rowH, UI.C.dim, 9, 2);
    (function (index) { UI.hit(lx, y, lw, rowH, { click: function () { choose(index); } }); })(k);
  }
  if (S.results.length > rows) {
    UI.button('↑', lx + lw - 38, ly + rows * rowH + 2, 18, 13, false, function () { S.chosen = Math.max(0, S.chosen - 1); mgraphics.redraw(); });
    UI.button('↓', lx + lw - 18, ly + rows * rowH + 2, 18, 13, false, function () { S.chosen = Math.min(S.results.length - 1, S.chosen + 1); mgraphics.redraw(); });
  }

  var by = Ht - 22, has = S.results.length > 0;
  UI.button('New Ideas', lx, by, 76, 18, false, newIdeas);
  UI.button(player.playing() ? 'Stop' : 'Play', lx + 80, by, 46, 18, player.playing(), play, has);
  UI.button('Insert', lx + 130, by, 56, 18, false, insert, has);
  UI.button(TARGETS[S.target], lx + 190, by, 100, 18, false, function () { S.target = (S.target + 1) % TARGETS.length; save(); mgraphics.redraw(); });
}

// --------------------------------------------------------------- score --
var score = { key: null, ops: null, height: 0 };
function engraving() {
  var r = S.results[S.chosen];
  if (!r) return null;
  var k = JSON.stringify([S.chosen, r.title, r.beats, S.key, r.parts[0] && r.parts[0].notes.length]);
  if (score.key === k) return score;
  try {
    var e = call('engrave', { key: S.key, barBeats: S.song.num * 4 / S.song.den, meter: [S.song.num, S.song.den], width: 360,
                              notes: chosenNotes().all, beats: r.beats || 4, name: '', drums: false, space: 6 });
    score = { key: k, ops: e.ops, height: e.height };
  } catch (err) { score = { key: k, ops: [], height: 0, error: String(err.message || err) }; }
  return score;
}
// The pen's colours: 1 ink, 2 staff, 3 ground, 4 accent, in the house palette.
function penColour(c) { return c === 2 ? UI.C.dim : c === 3 ? UI.C.sunken : c === 4 ? UI.C.accent : UI.C.text; }
// How wide the engraving really is, so a short block is drawn large.
function scoreWidth(ops) {
  var m = 1;
  ops.forEach(function (op) {
    if (op[0] === 'line') m = Math.max(m, op[1], op[3]);
    else if (op[0] === 'poly') for (var i = 0; i < op[1].length; i += 2) m = Math.max(m, op[1][i]);
    else m = Math.max(m, op[1]);
  });
  return m;
}
function drawScore(x, y, w, h) {
  var g = mgraphics, sc = engraving();
  UI.rect(x, y, w, h, UI.C.sunken);
  if (!sc || !sc.ops || !sc.ops.length) return;
  var z = Math.min(2, (h - 8) / Math.max(1, sc.height), (w - 16) / scoreWidth(sc.ops));
  var ox = x + 4, oy = y + 4 + Math.max(0, (h - 8 - sc.height * z) / 2);
  sc.ops.forEach(function (op) {
    var col = penColour(op[op[0] === 'line' ? 5 : op[0] === 'poly' ? 2 : op[0] === 'circle' ? 4 : 3]);
    g.set_source_rgba(col[0], col[1], col[2], col[3]);
    if (op[0] === 'line') {
      g.set_line_width(Math.max(0.5, op[6] * z));
      g.move_to(ox + op[1] * z, oy + op[2] * z); g.line_to(ox + op[3] * z, oy + op[4] * z); g.stroke();
    } else if (op[0] === 'poly') {
      var p = op[1];
      g.move_to(ox + p[0] * z, oy + p[1] * z);
      for (var i = 2; i + 1 < p.length; i += 2) g.line_to(ox + p[i] * z, oy + p[i + 1] * z);
      g.close_path(); g.fill();
    } else if (op[0] === 'circle') {
      g.arc(ox + op[1] * z, oy + op[2] * z, op[3] * z, 0, Math.PI * 2);
      if (op[5]) g.fill(); else { g.set_line_width(1); g.stroke(); }
    } else if (op[0] === 'text') {
      g.select_font_face('Arial', 'normal', 'normal'); g.set_font_size(Math.max(6, op[5] * z));
      var tw = op[6] ? g.text_measure(op[4])[0] : 0;
      g.move_to(ox + op[1] * z - tw / 2, oy + op[2] * z); g.show_text(op[4]);
    }
  });
}

function onclick(x, y) { if (UI.click(x, y)) mgraphics.redraw(); }
function ondrag(x, y, but) { UI.dragTo(x, y, !!but); }

