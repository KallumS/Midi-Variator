#!/usr/bin/env python3
"""Runs a Lua test file through lupa, for machines with no lua binary.

    python3 tools/run_lua.py tests/test_bridge.lua
"""
import os, sys
import lupa

def main(path, argv):
    L = lupa.LuaRuntime(unpack_returned_tuples=True)
    L.execute("arg = {}")
    arg = L.eval("arg")
    arg[0] = path
    for i, a in enumerate(argv, 1):
        arg[i] = a
    code = open(path, encoding="utf-8").read()
    try:
        L.execute(code)
    except lupa.LuaError as e:
        msg = str(e)
        # os.exit inside the script surfaces here; a clean exit is not a failure
        if "exit" in msg.lower() and "0" in msg.split("\n")[0]:
            return 0
        print(msg)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2:]))
