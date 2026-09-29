--[[ What the variator does to the test music, printed.

       lua5.4 tools/demo.lua                 every fixture, three variations each
       lua5.4 tools/demo.lua noir 8 0.6      one fixture, how many, how much

     Each variation lists its changes and how much of the original it keeps.
]]

local HERE = (arg and arg[0] or ""):match("^(.*)[/\\]") or "."
local T = dofile(HERE .. "/../reascripts/mv_theory.lua")
local V = dofile(HERE .. "/../reascripts/mv_vary.lua")
local F = dofile(HERE .. "/../tests/fixtures.lua")

local only, count, amount = arg[1], tonumber(arg[2]) or 3, tonumber(arg[3]) or 0.35
local names = {}
for k, v in pairs(F) do if type(v) == "table" and not only or k == only then names[#names + 1] = k end end
table.sort(names)

for _, name in ipairs(names) do
  local notes = F[name]
  local finish = 0
  for _, n in ipairs(notes) do finish = math.max(finish, n.start + n.len) end
  local src = { notes = notes, lead = 0, beats = math.ceil(finish / 4) * 4, barBeats = 4, pulse = 1 }
  local an = V.analyse(src, T)
  local opts = V.defaults()
  opts.amount = amount
  print(("== %s: %d notes, %d moments, grid %.3g, key %s"):format(name, #notes, #an.events, an.grid,
        an.key and an.key.label or "none (drums)"))
  for i, var in ipairs(V.series(src, an, opts, 1234, count, T)) do
    print(("  variation %d keeps %d%% of the original"):format(i, math.floor(V.likeness(notes, var.notes) * 100 + 0.5)))
    for _, c in ipairs(var.changes) do print("     " .. c) end
  end
end
