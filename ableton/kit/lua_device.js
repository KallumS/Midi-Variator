/* A family ReaScript that draws with gfx, as a Max for Live device: the .lua
 * itself, unchanged, on Middaw's Lua 5.4 runtime, with REAPER's gfx and the
 * parts of the reaper table it uses supplied here.
 *
 * REAPER runs such a script as a loop of reaper.defer callbacks drawing into
 * a window that keeps what was drawn. Here every repaint runs the deferred
 * callback once, its drawing is recorded, and the last frame that drew is
 * shown again until another draws (ScaleView draws only when something
 * changes).
 *
 * gfx.showmenu is modal in REAPER. Middaw's Lua has no coroutines, so a frame
 * that asks for a menu is stopped there (nothing after the call runs) and the
 * menu is drawn; no frame runs while it is open. When an item is chosen the
 * click that opened it is played again at the same place - released, pressed,
 * released - or the same keys typed again, and the menu call it reaches
 * returns the item. That works whether a script acts on the press (Orchestration
 * Helper) or the release (ScaleView), whatever it noted before asking.
 *
 * Expects, before it: Gfx (gfx.js), MiddawLua, and DEVICE = { main, files,
 * size: [w, h], midi }. ExtState and ProjExtState are kept with the Live set.
 * Inlet 0: bang, MIDI bytes, restore, key. Outlets: 0 MIDI bytes (MIDI
 * passes through), 1 the saved state to [pattr], 2 the status line.
 */
inlets = 1;
outlets = 3;
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var L = MiddawLua;
var R = {
  pending: null, atexit: null, quit: false, ext: {}, proj: {}, lastSaved: '', ready: false, started: false,
  mouse: { x: -1, y: -1, cap: 0, wheel: 0 }, release: false, frameSaw: true,
  menu: null, choice: 0, asking: null, keys: [], frameKeys: [],
  ops: [], lastOps: [], recording: null, midi: [], seq: 0, running: [], error: null,
  host: new Gfx.Host(mgraphics)
};
function say(msg) { outlet(2, 'set', msg || ''); }

// ------------------------------------------------------------ the gfx table --
var G = new L.LuaTable();
function gnum(k) { var v = G.get(k); return v === undefined ? 0 : +(v instanceof L.LFloat ? v.n : v); }
function gset(k, x) { G.set(k, Number.isInteger(x) ? x : L.mkf ? L.mkf(x) : x); }
// gfx.js's Host reads and writes REAPER's variables through fx.v[slot]; for a
// script they are the fields of the gfx table.
var FX = {
  v: new Proxy({}, { get: function (t, k) { return gnum(k); }, set: function (t, k, x) { gset(k, x); return true; } }),
  slots: { gfx_r: 'r', gfx_g: 'g', gfx_b: 'b', gfx_a: 'a', gfx_x: 'x', gfx_y: 'y', gfx_texth: 'texth',
           mouse_x: 'mouse_x', mouse_y: 'mouse_y', gfx_clear: 'clear' },
  str: null,
  gm: [0, 0]
};
FX.str = function (s) { return typeof s === 'string' ? s : (s === undefined ? '' : String(s instanceof L.LFloat ? s.n : s)); };
['r', 'g', 'b'].forEach(function (k) { gset(k, 1); });
gset('a', 1); gset('x', 0); gset('y', 0); gset('clear', 0); gset('ext_retina', 1); gset('texth', 13);
gset('mouse_x', 0); gset('mouse_y', 0); gset('mouse_cap', 0); gset('mouse_wheel', 0); gset('mouse_hwheel', 0);

var MENU_PENDING = { menuPending: true };
function call(name) {
  var a = Array.prototype.slice.call(arguments, 1);
  return R.host[name].apply(R.host, [FX].concat(a));
}
function flagsOf(f) { return typeof f === 'string' ? (f.length ? f.charCodeAt(0) : 0) : (f instanceof L.LFloat ? f.n : f); }
var GFX = {
  init: function (name, w, h) {
    if (w !== undefined) { gset('w', DEVICE.size[0]); gset('h', DEVICE.size[1]); }
    return 1;
  },
  quit: function () { R.quit = true; return L.NONE; },
  update: function () { return L.NONE; },
  dock: function (v) { return new L.Multi([0, 0, 0, DEVICE.size[0], DEVICE.size[1]]); },
  set: function (r, g, b, a) { call('gfx_set', +r, g === undefined ? undefined : +g, b === undefined ? undefined : +b, a === undefined ? undefined : +a); return L.NONE; },
  rect: function (x, y, w, h, filled) { call('gfx_rect', +x, +y, +w, +h, filled === undefined ? 1 : (filled === true ? 1 : filled === false ? 0 : +filled)); return L.NONE; },
  line: function (x1, y1, x2, y2) { call('gfx_line', +x1, +y1, +x2, +y2); return L.NONE; },
  lineto: function (x, y) { call('gfx_lineto', +x, +y); return L.NONE; },
  circle: function (x, y, r, fill) { call('gfx_circle', +x, +y, +r, fill === true ? 1 : fill === false || fill === undefined ? 0 : +fill); return L.NONE; },
  arc: function (x, y, r, a1, a2) { call('gfx_arc', +x, +y, +r, +a1, +a2); return L.NONE; },
  roundrect: function (x, y, w, h, r) { call('gfx_roundrect', +x, +y, +w, +h, +r); return L.NONE; },
  triangle: function () { call.apply(null, ['gfx_triangle'].concat(Array.prototype.map.call(arguments, Number))); return L.NONE; },
  gradrect: function (x, y, w, h, r, g, b, a) { call('gfx_gradrect', +x, +y, +w, +h, +r, +g, +b, +a); return L.NONE; },
  setfont: function (idx, name, size, flags) { call('gfx_setfont', +idx || 0, name, size === undefined ? undefined : +size, flagsOf(flags)); return 1; },
  getfont: function () { var f = R.host.fonts[R.host.font] || R.host.fonts[0]; return new L.Multi([R.host.font, f.name]); },
  measurestr: function (s) { call('gfx_measurestr', s); return new L.Multi([L.mkf(FX.gm[0]), L.mkf(FX.gm[1])]); },
  measurechar: function (c) { call('gfx_measurechar', +c); return new L.Multi([L.mkf(FX.gm[0]), L.mkf(FX.gm[1])]); },
  drawstr: function (s, flags, right, bottom) { call('gfx_drawstr', s, flags === undefined ? undefined : +flags, right === undefined ? undefined : +right, bottom === undefined ? undefined : +bottom); return L.NONE; },
  drawnumber: function (n, d) { call('gfx_drawnumber', +n, +d); return L.NONE; },
  drawchar: function (c) { call('gfx_drawchar', +c); return L.NONE; },
  printf: function (fmt) { var a = Array.prototype.slice.call(arguments, 1); call.apply(null, ['gfx_printf', fmt].concat(a)); return L.NONE; },
  // Keys typed this frame; the frame that asked for a menu sees the same ones again.
  getchar: function (c) {
    if (c !== undefined && +c === 65536) return 1 | 2 | 8;
    if (c !== undefined && +c !== 0) return 0;
    return R.frameKeys.length ? R.frameKeys.shift() : 0;
  },
  showmenu: function (s) {
    if (R.choice) { var k = R.choice; R.choice = 0; R.menu = null; return k; }
    if (!R.menu) R.menu = { items: Gfx.parseMenu(L.fromBytes ? decode(s) : s), x: gnum('x'), y: gnum('y'), hover: -1 };
    throw MENU_PENDING;
  },
  setcursor: function () { return L.NONE; },
  clienttoscreen: function (x, y) { return new L.Multi([x, y]); },
  screentoclient: function (x, y) { return new L.Multi([x, y]); },
  getimgdim: function () { return new L.Multi([0, 0]); },
  blit: function () { return L.NONE; },
  setimgdim: function () { return L.NONE; },
  loadimg: function () { return -1; },
  getdropfile: function () { return 0; },
  getpixel: function () { return new L.Multi([0, 0, 0]); },
  muloffset: function () { return L.NONE; }
};
function decode(s) { try { return decodeURIComponent(escape(String(s))); } catch (e) { return String(s); } }
Object.keys(GFX).forEach(function (k) { G.set(k, GFX[k]); });

// ------------------------------------------------------- the reaper table --
// What the family's gfx scripts use; anything else is nil, as on an old REAPER.
function str(v) { return v === undefined || v === null ? '' : typeof v === 'string' ? v : String(v instanceof L.LFloat ? v.n : v); }
var REAPER = {
  defer: function (f) { R.pending = f; return L.NONE; },
  atexit: function (f) { R.atexit = f; return L.NONE; },
  time_precise: function () { return L.mkf(Date.now() / 1000); },
  GetOS: function () { return 'macOS-arm64'; },
  GetResourcePath: function () { return '/Live'; },
  GetAppVersion: function () { return '7.0/macOS-arm64'; },
  get_action_context: function () { return new L.Multi([false, '/Live/' + DEVICE.main, 0, 0, 0, 0, 0]); },
  set_action_options: function () { return L.NONE; },
  SetToggleCommandState: function () { return true; },
  RefreshToolbar2: function () { return L.NONE; },
  ShowMessageBox: function (msg) { say(decode(str(msg)).split('\n')[0]); return 1; },
  MB: function (msg) { say(decode(str(msg)).split('\n')[0]); return 1; },
  ShowConsoleMsg: function (msg) { post(decode(str(msg))); return L.NONE; },
  GetExtState: function (sec, key) { var v = R.ext[str(sec) + '\u0000' + str(key)]; return v === undefined ? '' : v; },
  HasExtState: function (sec, key) { return R.ext[str(sec) + '\u0000' + str(key)] !== undefined; },
  SetExtState: function (sec, key, val) { R.ext[str(sec) + '\u0000' + str(key)] = str(val); return L.NONE; },
  DeleteExtState: function (sec, key) { delete R.ext[str(sec) + '\u0000' + str(key)]; return L.NONE; },
  GetProjExtState: function (proj, sec, key) {
    var v = R.proj[str(sec) + '\u0000' + str(key)];
    return new L.Multi([v === undefined ? 0 : v.length, v === undefined ? '' : v]);
  },
  SetProjExtState: function (proj, sec, key, val) { R.proj[str(sec) + '\u0000' + str(key)] = str(val); return 1; },
  EnumProjects: function (idx) { return +idx <= 0 ? new L.Multi([PROJECT, 'Live Set']) : undefined; },
  MarkProjectDirty: function () { return L.NONE; },
  // REAPER's recent MIDI input, newest first: what came into the device.
  MIDI_GetRecentInputEvent: function (idx) {
    var e = R.midi[R.midi.length - 1 - (+idx)];
    if (!e) return new L.Multi([0, '', 0, 0, 0, 0]);
    return new L.Multi([e.seq, e.bytes, 0, 0, 0, 0]);
  }
};
var PROJECT = new L.LuaTable();
var RT = new L.LuaTable();
Object.keys(REAPER).forEach(function (k) { RT.set(k, REAPER[k]); });

// ------------------------------------------------------------- the script --
// Files the script reads (dofile) are found by their name, wherever it asks.
function readFile(path) {
  var p = String(path), base = p.replace(/^.*[\/\\]/, '');
  if (DEVICE.files[p] !== undefined) return DEVICE.files[p];
  if (DEVICE.files[base] !== undefined) return DEVICE.files[base];
  return null;
}
var env = L.makeEnv({ print: function (s) { post(String(s) + '\n'); }, readFile: readFile, writeFile: function () {} });
env.set('gfx', G);
env.set('reaper', RT);
// what a Mac's Lua says about its paths (scripts read the separator from it)
env.get('package').set('config', '/\n;\n?\n!\n-\n');

function start() {
  if (R.started) return;
  R.started = true;
  gset('w', DEVICE.size[0]); gset('h', DEVICE.size[1]);
  frame(function () { L.call(L.load(DEVICE.files[DEVICE.main], DEVICE.main, env))(); });
}

// One frame: the deferred callback, its drawing recorded. A frame stopped by a
// menu leaves nothing behind but the menu; it runs again until it is answered.
function frame(f, input) {
  var rec = recorder(mgraphics);
  R.host.begin(rec, FX);
  R.frameKeys = input ? input.keys.slice() : R.keys.splice(0);
  var mouse = input ? input.mouse : { x: R.mouse.x, y: R.mouse.y, cap: R.mouse.cap, wheel: R.mouse.wheel };
  if (!input) R.mouse.wheel = 0;
  gset('mouse_x', mouse.x); gset('mouse_y', mouse.y); gset('mouse_cap', mouse.cap);
  if (mouse.wheel) gset('mouse_wheel', gnum('mouse_wheel') + mouse.wheel);
  var keys = R.frameKeys.slice();
  R.pending = null;
  try {
    f();
    R.asking = null;
    // a frame that drew (not one that only set a font) is the one shown
    if (rec.ops.some(function (op) { return op[0] === 'fill' || op[0] === 'stroke' || op[0] === 'show_text'; })) R.lastOps = rec.ops;
  } catch (e) {
    if (e === MENU_PENDING || (e && e.value === MENU_PENDING)) {
      R.asking = { f: f, mouse: mouse, keys: keys, button: R.button || 1 };
      R.pending = f;
      return;
    }
    R.error = String(e && (e.message || (e.value !== undefined ? L.tostring(e.value) : e)));
    say('The script stopped: ' + R.error);
    post('ReaScript error: ' + R.error + '\n');
  }
  R.frameSaw = true;
  if (R.release) { R.release = false; R.mouse.cap = 0; }
}

// mgraphics, recorded: what is drawn is kept to be drawn again; measuring and
// font changes also reach the real one, so text is measured as it will look.
function recorder(g) {
  var ops = [];
  var r = { ops: ops };
  ['set_source_rgba', 'rectangle', 'rectangle_rounded', 'fill', 'fill_preserve', 'stroke', 'move_to', 'line_to',
   'close_path', 'arc', 'ellipse', 'show_text', 'set_line_width', 'new_path'].forEach(function (m) {
    r[m] = function () { ops.push([m, Array.prototype.slice.call(arguments)]); };
  });
  ['select_font_face', 'set_font_size'].forEach(function (m) {
    r[m] = function () { var a = Array.prototype.slice.call(arguments); ops.push([m, a]); g[m].apply(g, a); };
  });
  r.text_measure = function (s) { return g.text_measure(s); };
  return r;
}

// --------------------------------------------------------------- paint ---
function size() {
  var rc = (typeof box !== 'undefined' && box.rect) ? box.rect : [0, 0, DEVICE.size[0], DEVICE.size[1]];
  return [rc[2] - rc[0], rc[3] - rc[1]];
}
function paint() {
  var g = mgraphics, sz = size();
  gset('w', sz[0]); gset('h', sz[1]);
  if (R.started && !R.quit && R.pending && !R.error && !R.menu) frame(R.pending);
  var c = gnum('clear');
  if (c >= 0) { g.set_source_rgba((c & 255) / 255, ((c >> 8) & 255) / 255, ((c >> 16) & 255) / 255, 1); g.rectangle(0, 0, sz[0], sz[1]); g.fill(); }
  R.lastOps.forEach(function (op) { g[op[0]].apply(g, op[1]); });
  if (R.menu) drawMenu(g, sz);
}

// The menu gfx.showmenu asked for, over the window.
var ITEM_H = 20;
function menuRect(sz) {
  var m = R.menu, w = 40;
  mgraphics.select_font_face('Arial', 'normal', 'normal');
  mgraphics.set_font_size(12);
  m.items.forEach(function (it) { if (it.label) w = Math.max(w, mgraphics.text_measure(it.label)[0] + 40 + it.depth * 12); });
  var h = m.items.length * ITEM_H + 8;
  return [Math.max(0, Math.min(m.x, sz[0] - w - 2)), Math.max(0, Math.min(m.y, sz[1] - h - 2)), w, h];
}
function drawMenu(g, sz) {
  var r = menuRect(sz), m = R.menu;
  g.set_source_rgba(0.165, 0.184, 0.216, 1); g.rectangle(r[0], r[1], r[2], r[3]); g.fill();
  g.set_source_rgba(0.227, 0.251, 0.29, 1); g.set_line_width(1); g.rectangle(r[0] + 0.5, r[1] + 0.5, r[2] - 1, r[3] - 1); g.stroke();
  g.select_font_face('Arial', 'normal', 'normal'); g.set_font_size(12);
  m.items.forEach(function (it, i) {
    var y = r[1] + 4 + i * ITEM_H;
    if (it.rule) { g.set_source_rgba(0.227, 0.251, 0.29, 1); g.rectangle(r[0] + 6, y + ITEM_H / 2, r[2] - 12, 1); g.fill(); return; }
    var on = i === m.hover && it.index && !it.grey;
    if (on) { g.set_source_rgba(1, 0.949, 0, 1); g.rectangle(r[0] + 2, y, r[2] - 4, ITEM_H); g.fill(); }
    var ink = on ? [0.078, 0.09, 0.11] : it.grey || it.title ? [0.714, 0.737, 0.776] : [0.867, 0.882, 0.906];
    g.set_source_rgba(ink[0], ink[1], ink[2], 1);
    g.move_to(r[0] + 22 + it.depth * 12, y + 14);
    g.show_text(it.label);
    if (it.tick) { g.move_to(r[0] + 7 + it.depth * 12, y + 14); g.show_text('✓'); }
  });
}
function menuAt(x, y) {
  var r = menuRect(size());
  if (x < r[0] || x >= r[0] + r[2] || y < r[1] + 4 || y >= r[1] + r[3] - 4) return -1;
  return Math.floor((y - r[1] - 4) / ITEM_H);
}
// An item chosen: the frame that asked runs again and is given it. Clicking
// away gives it 0, as closing REAPER's menu does.
function chooseMenu(i) {
  var it = i >= 0 ? R.menu.items[i] : null;
  if (it && (!it.index || it.grey)) return;          // a title, a rule or a greyed item: the menu stays
  frameAnswer(R.asking ? R.asking.f : R.pending, it ? it.index : 0);
  save();
  mgraphics.redraw();
}
function frameAnswer(f, k) {
  var ask = R.asking, keep = GFX.showmenu, answered = false;
  // the next gfx.showmenu, wherever the script calls it from, is given the answer
  G.set('showmenu', function () { answered = true; G.set('showmenu', keep); return k; });
  R.menu = null; R.asking = null;
  var x = ask.mouse.x, y = ask.mouse.y, steps = ask.keys.length
    ? [{ cap: 0, keys: [] }, { cap: 0, keys: ask.keys }]
    : [{ cap: 0, keys: [] }, { cap: ask.button, keys: [] }, { cap: 0, keys: [] }];
  steps.forEach(function (st) {
    if (answered || R.error) return;
    var g = R.pending || f;
    frame(g, { mouse: { x: x, y: y, cap: st.cap, wheel: 0 }, keys: st.keys });
  });
  G.set('showmenu', keep);
  R.mouse.cap = 0;
}

// --------------------------------------------------------------- input ---
function onclick(x, y, but, cmd, shift, capslock, opt, ctrl) {
  if (R.menu) { chooseMenu(menuAt(x, y)); return; }
  R.mouse.x = x; R.mouse.y = y;
  R.mouse.cap = (ctrl ? 2 : 1) | (cmd ? 4 : 0) | (shift ? 8 : 0) | (opt ? 16 : 0);
  R.button = R.mouse.cap;
  R.frameSaw = false;
  mgraphics.redraw();
}
function ondrag(x, y, but) {
  if (R.menu) return;
  R.mouse.x = x; R.mouse.y = y;
  if (!but) { if (R.frameSaw) R.mouse.cap = 0; else R.release = true; save(); }
  mgraphics.redraw();
}
function onidle(x, y) {
  if (R.menu) { var i = menuAt(x, y); if (i !== R.menu.hover) { R.menu.hover = i; mgraphics.redraw(); } return; }
  R.mouse.x = x; R.mouse.y = y;
}
function onidleout() { if (!R.menu) { R.mouse.x = -1; R.mouse.y = -1; } }
function onwheel(x, y, dx, dy) { R.mouse.wheel += Math.round(dy * 120); mgraphics.redraw(); }
var KEYS = { 28: 0x6C656674, 29: 0x72676874, 30: 0x7570, 31: 0x646F776E, 127: 0x64656C };
function key(code) {
  if (R.menu && code === 27) { chooseMenu(-1); return; }
  R.keys.push(KEYS[code] !== undefined ? KEYS[code] : code);
  if (R.keys.length > 32) R.keys.shift();
  mgraphics.redraw();
}

// ---------------------------------------------------------------- MIDI ---
// Bytes from [midiin]: passed straight on, and kept as REAPER's recent input.
function msg_int(b) {
  b = b & 255;
  outlet(0, b);
  if (b >= 0xF8) return;
  if (b & 0x80) { R.running = [b]; return; }
  if (!R.running.length || R.running[0] >= 0xF0) return;
  R.running.push(b);
  var st = R.running[0] & 0xF0, need = (st === 0xC0 || st === 0xD0) ? 2 : 3;
  if (R.running.length === need) {
    R.midi.push({ seq: ++R.seq, bytes: String.fromCharCode.apply(null, R.running) });
    if (R.midi.length > 4096) R.midi.splice(0, 1024);
    R.running = [R.running[0]];
    mgraphics.redraw();
  }
}

// ----------------------------------------------------------- the device --
var drawTask = null;
function bang() {
  R.ready = true;
  start();
  if (!drawTask) { drawTask = new Task(function () { mgraphics.redraw(); }, this); drawTask.interval = 33; drawTask.repeat(); }
  mgraphics.redraw();
}
// What the script keeps (ExtState, ProjExtState), with the Live set.
function save() {
  var s = JSON.stringify({ v: 1, ext: R.ext, proj: R.proj });
  if (s === R.lastSaved) return;
  R.lastSaved = s;
  outlet(1, 'set', s);
}
function restore(text) {
  var st = null;
  try { st = JSON.parse(String(text)); } catch (e) { return; }
  if (!st || st.v !== 1) return;
  R.ext = st.ext || {}; R.proj = st.proj || {};
  R.lastSaved = JSON.stringify(st);
  // a script reads its state when it starts: start again with it
  if (R.started) { R.started = false; R.pending = null; R.lastOps = []; R.quit = false; R.error = null; start(); }
}
var saveTask = new Task(function () { save(); }, this);
saveTask.interval = 2000;
saveTask.repeat();
