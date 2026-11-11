# The kit, and where it came from

`ableton/kit/` is the same in every family repository that has an Ableton
device. Change it in one, copy it to all, and rebuild each device.

| File | From | Commit |
| --- | --- | --- |
| `runtime/lua_parse.js`, `lua_runtime.js`, `lua_compile.js` | KallumS/Middaw `runtime/lua/` (Lua 5.4, held to the real Lua byte for byte) | 7884fe9 |
| `runtime/jsfx.js` | KallumS/Middaw `runtime/jsfx/` (EEL2 and the JSFX host, with `@gfx` on a host) | 10e0446 (branch `ccr-ec4dcb66-3i9iqs`) |
| `runtime/polyfill.js`, `runtime/host.js` | KallumS/Middaw `runtime/` (the engines, JSON in and out) | 7884fe9 |
| `palette.js`, `ui.js`, `live.js`, `generator.js`, `miditool.js`, `gfx.js`, `jsfx_device.js`, `lua_device.js`, `jsfx2gen.js`, `build.py`, `test/` | written for the Ableton devices | - |

Do not edit `runtime/`: fix Middaw, then copy. The adapters beside the kit
(`ableton/adapters/`) are Noterator's (42c2c2f, as vendored in Middaw's
`family/engines/adapters/`), unchanged.

- `palette.js` is the colours in Live: after Ableton Live 8's default theme (Starting Blocks' experiment of 18 September 2026, commit 2765b0a3), neutral greys and an amber accent, every word 7:1. `Palette.tone` turns the house scheme's colours into these as a REAPER window draws, so the JSFX and Lua scripts take it without changing.
- `ui.js` draws in a `[v8ui]` with mgraphics, in Palette's colours.
- `live.js` is the Live Object Model: tempo, meter and scale; the notes of the
  clip in Detail View; a new clip, an Arrangement clip, or new notes in the
  open clip; and a player for hearing notes before they are used.
- `generator.js` is a whole device for any engine with an adapter.
- `miditool.js` is the same engine as a Live 12 MIDI Tool, in the clip view's Generate or Transform panel (`ableton/tool/tool.json`, template `midi_tool`): Live's notes and context in through `[live.miditool.in]`, the notes to write out through `[live.miditool.out]`. The file types `nagg` and `natt` are the ones Ableton's maxdevtools (`maxdiff/amxd_textconv.py`) names.
- `gfx.js` is REAPER's `gfx_*` drawing on mgraphics, so a JSFX's own window runs.
- `jsfx_device.js` is a whole device for a family JSFX: for a MIDI effect, the plug-in on a clock, its window, its state; for an audio one, its window driving gen~.
- `jsfx2gen.js` translates a JSFX's DSP to gen~ code (GenExpr) on the runtime's parser and rules.
- `lua_device.js` runs a ReaScript that draws with gfx, with REAPER's gfx and reaper tables supplied.
- `test/genexpr.js` runs that gen~ code as JavaScript; `test/gen_compare.js` holds it to the runtime sample for sample; `test/tool_suite.js` is every MIDI Tool's tests, `test/palette_suite.js` the palette's; `test/svg.js` and `test/shot.js` draw a device to a PNG; `test/picture.js` draws the README's picture from the scene in `ableton/window.js`.
- `build.py` writes the bundle, the `.maxpat` and the `.amxd`.
- `test/max.js` is a pretend Max and a pretend Live set, for `node --test`.
