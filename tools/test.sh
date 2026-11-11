#!/bin/sh
# Runs every suite. Uses lua if there is one, and falls back to lupa otherwise.
set -e
cd "$(dirname "$0")/.."

if command -v lua5.4 >/dev/null 2>&1; then RUN="lua5.4"
elif command -v lua >/dev/null 2>&1;   then RUN="lua"
else RUN="python3 tools/run_lua.py"
fi

fail=0
for suite in tests/test_vary.lua tests/test_place.lua tests/test_ui.lua; do
  printf '%-26s ' "$(basename "$suite")"
  if ! $RUN "$suite"; then fail=1; fi
done
if command -v node >/dev/null 2>&1; then
  printf '%-22s ' "ableton device"
  if python3 ableton/kit/build.py --check ableton/device.json && python3 ableton/kit/build.py --check ableton/tool/tool.json && node --test ableton/tests/test_device.js ableton/tests/test_tool.js >/tmp/ableton_test.out 2>&1; then
    echo "ok"
  else
    tail -20 /tmp/ableton_test.out; fail=1
  fi
fi

exit $fail
