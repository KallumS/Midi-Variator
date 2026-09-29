--[[ The few lines every suite shares: counting checks and failures, and
     saying how it went. dofile'd by each test, so each still runs on its own:

       lua5.4 tests/test_theory.lua
]]

local C = { failures = 0, checks = 0 }

function C.ok(cond, what)
  C.checks = C.checks + 1
  if not cond then C.failures = C.failures + 1; io.write("FAIL  ", what, "\n") end
  return cond
end

function C.eq(got, want, what)
  C.checks = C.checks + 1
  if got ~= want then
    C.failures = C.failures + 1
    io.write("FAIL  ", what, "\n        got  ", tostring(got),
             "\n        want ", tostring(want), "\n")
    return false
  end
  return true
end

function C.eqList(got, want, what)
  local a = table.concat(got or {}, " ")
  local b = table.concat(want or {}, " ")
  return C.eq(a, b, what)
end

function C.done()
  if C.failures > 0 then
    io.write(("%d of %d checks failed\n"):format(C.failures, C.checks))
    os.exit(1)
  end
  io.write(("ok  (%d checks)\n"):format(C.checks))
end

-- Where the scripts are, from wherever the test was started.
C.HERE = (arg and arg[0] or ""):match("^(.*)[/\\]") or "."
C.SCRIPTS = C.HERE .. "/../reascripts/"

return C
