#!/bin/bash
# Prove a test bites: break the code on purpose in a copy of the repo and
# watch a test fail. (Good Idea's tool, with the lupa fallback.)
#
#   tools/bite.sh "what is broken" test_vary.lua "PYTHON"
#
# PYTHON is run in the copy with r(path, old, new) defined, which replaces
# the first `old` in `path` with `new` (and fails if `old` is not there):
#
#   tools/bite.sh "develop below its amount" test_vary.lua \
#     "r('reascripts/mv_vary.lua', 'amount > M.DEVELOP_FROM', 'amount > 0.1')"
#
# Prints BIT (and the first failures), MISSED, or DID NOT APPLY. A MISSED
# is either a gap in the tests or a sabotage that changed nothing - check
# which before trusting it.

set -u
here=$(cd "$(dirname "$0")/.." && pwd)
copy=$(mktemp -d)
trap 'rm -rf "$copy"' EXIT
cp -r "$here/." "$copy"
cd "$copy" || exit 1
python3 - <<PY || { echo "DID NOT APPLY: $1"; exit 0; }
def r(p, a, b):
    s = open(p).read()
    assert a in s, (p, a)
    open(p, "w").write(s.replace(a, b, 1))
$3
PY
if command -v lua5.4 >/dev/null 2>&1; then RUN="lua5.4"; else RUN="python3 tools/run_lua.py"; fi
out=$($RUN "tests/$2" 2>&1)
if echo "$out" | grep -q FAIL; then
  echo "BIT: $1 -> $(echo "$out" | grep FAIL | head -2 | cut -c1-150 | tr '\n' ' ')"
elif ! echo "$out" | grep -q "^ok"; then
  # A sabotage that crashes the suite is caught too - but say so: a crash
  # may mean the sabotage, not the test, did the work.
  echo "BIT (crashed): $1 -> $(echo "$out" | tail -2 | head -1 | cut -c1-150)"
else
  echo "MISSED: $1"
fi
