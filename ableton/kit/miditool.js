/* A family engine as a Live 12 MIDI Tool: in the clip view's Generate or
 * Transform panel, beside Live's own.
 *
 * Live hands the tool the clip's notes and a context (the time selection,
 * the clip's scale, the grid, a seed for this apply) through
 * [live.miditool.in]; [dict.join] makes them one dictionary, and this answers
 * at once with the notes to write, through [live.miditool.out]:
 *   - a Generator (DEVICE.tool 'generate') writes the chosen result into the
 *     time selection, repeated to fill it; Live adds it to what is there;
 *   - a Transformation ('transform') replaces the notes it was given: with a
 *     variation of them, or (DEVICE.beside) with them and a suggestion that
 *     goes with them.
 * The key is the clip's scale when the clip has one ScaleView knows, else the
 * tool's own Key and Scale. The engine is the repository's own Lua, run
 * unchanged by Middaw's Lua runtime, spoken to through Noterator's adapter,
 * exactly as in the MIDI effect (generator.js).
 *
 * Changing a setting asks Live for the notes again (a bang to
 * [live.miditool.in], a moment later: from inside an apply it would nest).
 *
 * Expects, before it: Palette, UI, Live, MiddawHost, and DEVICE = { generator,
 * tool, files }. Outlets: 0 the notes to [live.miditool.out], 1 the saved
 * state to [pattr], 2 a bang to [live.miditool.in].
 */
inlets = 1;
outlets = 3;
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
var TRANSFORM = DEVICE.tool === 'transform';

var T = {
  session: call('newSession', { generator: DEVICE.generator }),
  key: { root: 1, scale: 1 },   // the tool's own, for a clip with no scale
  clipKey: null,                // the clip's, from the last apply
  song: { tempo: 120, num: 4, den: 4 },
  settings: [], results: [], pick: 1, part: 0, inst: 'pno', page: 0,
  input: null, applied: false, wrote: 0, status: '', warn: false, ready: false, pending: null
};

function say(msg, warn) { T.status = msg || ''; T.warn = !!warn; }
function keyName(k) { return Live.ROOTS[k.root - 1] + ' ' + Live.SCALE_NAMES[k.scale - 1]; }
function barBeats() { return T.song.num * 4 / T.song.den; }
function key() { return T.clipKey || T.key; }

function context() {
  var sel = T.input || { notes: [], beats: 0 };
  var k = key();
  return { root: k.root, scale: k.scale, num: T.song.num, den: T.song.den, barBeats: barBeats(), bpm: T.song.tempo,
           inst: T.inst, catalogueId: T.inst, bars: 4,
           selection: { notes: sel.notes, beats: sel.beats, drums: false } };
}

// The settings a tool shows: which result, the engine's own, then the parts
// and the instrument where the engine has them, then the key (only when the
// clip has none of its own, or it would be a control that does nothing).
var OWN_KEY = { root: 1, scale: 1, key: 1 };
var EXTRA = { asax: 1, tsax: 1, bsax: 1, vib: 1, sop: 1, alto: 1, ten: 1, bass: 1, gtr: 1, ebass: 1, ubass: 1, synth: 1, kit: 1 };
var INSTRUMENTS = DEVICE.instrument ? call('instruments').filter(function (i) { return !EXTRA[i.id]; }) : [];
function partNames() {
  var most = [];
  T.results.forEach(function (r) { if (r.parts.length > most.length) most = r.parts; });
  return most.length > 1 ? ['All Parts'].concat(most.map(function (p, i) { return p.name || ('Part ' + (i + 1)); })) : null;
}
function rows() {
  var out = [];
  // DEVICE.short: a result is named by what comes before its first wide gap
  // (Starting Blocks' numeral: "IV  C Major IV Chord Triad" is IV).
  var names = T.results.length ? T.results.map(function (r, i) {
    var t = r.title || String(i + 1);
    return DEVICE.short ? t.split('  ')[0] : t;
  }) : ['1'];
  if (T.pick > names.length) T.pick = 1;
  out.push({ id: '$pick', label: DEVICE.result || 'Result', names: names, index: T.pick });
  if (INSTRUMENTS.length) {
    var at = 0;
    INSTRUMENTS.forEach(function (x, i) { if (x.id === T.inst) at = i; });
    out.push({ id: '$inst', label: 'Instrument', names: INSTRUMENTS.map(function (x) { return x.name; }), index: at + 1 });
  }
  T.settings.forEach(function (s) { out.push(s); });
  var parts = partNames();
  if (parts) {
    if (T.part >= parts.length) T.part = 0;
    out.push({ id: '$part', label: 'Part', names: parts, index: T.part + 1 });
  }
  if (!DEVICE.keyless && !T.clipKey) {
    out.push({ id: '$root', label: 'Key', names: Live.ROOTS, index: T.key.root });
    out.push({ id: '$scale', label: 'Scale', names: Live.SCALE_NAMES, index: T.key.scale });
  }
  return out;
}

function refresh() {
  call('useKey', { session: T.session, key: key() });
  T.settings = call('settings', { session: T.session, context: context() }).filter(function (s) { return !OWN_KEY[s.id]; });
}

// Before Live has asked for anything, a generator lists what it would write
// in the tool's own key, so Result names something.
function preview() {
  if (TRANSFORM || T.applied) return;
  T.results = call('generate', { session: T.session, context: context(), seed: 1, count: 8 }).results || [];
}

function readSong() {
  try { var s = Live.song(); T.song = { tempo: s.tempo, num: s.num, den: s.den }; } catch (e) { /* not in Live */ }
}

// ------------------------------------------------------------ the apply --
// Live's notes (start_time, duration...) as the engines' (start, len...),
// from the start of what the tool was given.
function fromLive(notes, base) {
  return notes.filter(function (n) { return !+n.mute; }).map(function (n) {
    return { start: +n.start_time - base, len: +n.duration, pitch: +n.pitch, vel: Math.round(+n.velocity || 100) };
  }).sort(function (a, b) { return a.start - b.start || a.pitch - b.pitch; });
}
function toLive(n, base) {
  return { pitch: Math.max(0, Math.min(127, Math.round(n.pitch))), start_time: base + n.start,
           duration: Math.max(1 / 64, n.len), velocity: Math.max(1, Math.min(127, Math.round(n.vel || 100))) };
}
// Where the tool writes: the time selection, else (a transformation) the
// bars the notes it was given cover, else (a generator) four bars.
function span(d, notes) {
  var c = d.clip || d;
  var a = +c.time_selection_start, b = +c.time_selection_end;
  if (b > a) return { base: a, beats: b - a };
  var bar = barBeats();
  if (!TRANSFORM || !notes.length) return { base: a > 0 ? a : 0, beats: bar * 4 };
  var lo = Infinity, hi = 0;
  notes.forEach(function (n) { lo = Math.min(lo, +n.start_time); hi = Math.max(hi, +n.start_time + +n.duration); });
  var base = Math.floor(lo / bar) * bar;
  return { base: base, beats: Math.max(bar, Math.ceil((hi - base) / bar) * bar) };
}
function clipScale(d) {
  var s = d.scale || {};
  var on = Array.isArray(s.scale_mode) ? s.scale_mode[0] : s.scale_mode;
  return +on ? Live.keyOf(s.root_note, s.scale_name) : null;
}
function chosen() {
  var r = T.results[T.pick - 1];
  if (!r) return null;
  var parts = T.part > 0 && r.parts[T.part - 1] ? [r.parts[T.part - 1]] : r.parts;
  var all = [];
  parts.forEach(function (p) { p.notes.forEach(function (n) { all.push(n); }); });
  return { notes: all, beats: r.beats || 4, title: r.title || GEN.name };
}

// What the tool writes for one apply. Returns Live's notes.
function compute(d) {
  readSong();
  var given = (d.notes || []).slice();
  var at = span(d, given);
  var ck = clipScale(d);
  T.clipKey = ck;
  T.input = TRANSFORM ? { notes: fromLive(given, at.base), beats: at.beats } : { notes: [], beats: at.beats };
  var keep = TRANSFORM ? given : [];   // what a transformation leaves if it has nothing to say
  if (TRANSFORM && !T.input.notes.length) { say('Select notes to change first.'); return keep; }
  var seed = 1 + Math.abs(Math.round(+d.seed || 0)) % 99999;
  refresh();
  var r = call('generate', { session: T.session, context: context(), seed: seed, count: 8 });
  T.results = r.results || [];
  var c = chosen();
  if (!c || !c.notes.length) { say(r.message || 'Nothing fits these settings. Change one, then try again.', !r.message); return keep; }
  var out = [];
  if (TRANSFORM) {
    // A variation replaces what it was given; a suggestion goes with it.
    if (DEVICE.beside) given.forEach(function (n) { out.push(n); });
    c.notes.forEach(function (n) {
      if (n.start < at.beats) out.push(toLive({ start: n.start, len: Math.min(n.len, at.beats - n.start), pitch: n.pitch, vel: n.vel }, at.base));
    });
  } else {
    // A block fills the time selection, repeated as a pattern is.
    var len = c.beats > 0 ? c.beats : at.beats;
    for (var k = 0; k * len < at.beats; k++) {
      c.notes.forEach(function (n) {
        var st = k * len + n.start;
        if (st < at.beats - 1e-9) out.push(toLive({ start: st, len: Math.min(n.len, at.beats - st), pitch: n.pitch, vel: n.vel }, at.base));
      });
    }
  }
  T.wrote = out.length - (DEVICE.beside ? given.length : 0);
  say(c.title);
  return out;
}

function send(notes) {
  var body = { notes: notes };
  if (typeof outlet_dictionary === 'function') { outlet_dictionary(0, body); return; }
  var dct = new Dict();
  dct.parse(JSON.stringify(body));
  outlet(0, 'dictionary', dct.name);
}

// The joined notes and context. v8 hands a dictionary to msg_dictionary as an
// object when the function exists; dictionary(name) is the older route.
function msg_dictionary(d) { applyFrom(d); }
function dictionary(name) {
  var d = null;
  try { d = JSON.parse(new Dict(String(name)).stringify()); } catch (e) { d = null; }
  if (d) applyFrom(d);
}
function applyFrom(d) {
  var notes;
  try { notes = compute(d); } catch (e) { say(String(e.message || e), true); notes = TRANSFORM ? (d.notes || []) : []; }
  T.applied = true;
  send(notes);
  mgraphics.redraw();
}

// Ask Live to apply again, after this message is done.
var again = new Task(function () { outlet(2, 'bang'); });
function reapply() { if (T.applied) again.schedule(1); }

// ------------------------------------------------------------ messages --
function bang() {
  T.ready = true;
  if (T.pending) { restoreFrom(T.pending); T.pending = null; }
  readSong();
  try { refresh(); preview(); }
  catch (e) { say(String(e.message || e), true); }
  if (!T.status) say(TRANSFORM ? 'Select notes, then Transform.' : 'Choose, then click Generate.');
  mgraphics.redraw();
}
function save() {
  outlet(1, 'set', JSON.stringify({ v: 1, st: call('snapshot', { session: T.session }), key: T.key,
                                    pick: T.pick, part: T.part, inst: T.inst }));
}
function restore(text) {
  var st = null;
  try { st = JSON.parse(String(text)); } catch (e) { return; }
  if (!T.ready) { T.pending = st; return; }
  restoreFrom(st);
  mgraphics.redraw();
}
function restoreFrom(st) {
  if (!st || st.v !== 1) return;
  if (st.st) call('restore', { session: T.session, state: st.st });
  if (st.key) T.key = st.key;
  T.pick = st.pick || 1;
  T.part = st.part || 0;
  if (st.inst) T.inst = st.inst;
  refresh();
  preview();
}
function choose(id, index) {
  if (id === '$pick') T.pick = index;
  else if (id === '$part') T.part = index - 1;
  else if (id === '$inst') T.inst = INSTRUMENTS[index - 1].id;
  else if (id === '$root') T.key = { root: index, scale: T.key.scale };
  else if (id === '$scale') T.key = { root: T.key.root, scale: index };
  else call('set', { session: T.session, setting: id, index: index, context: context() });
  try {
    refresh();
    preview();
  } catch (e) { say(String(e.message || e), true); }
  save();
  reapply();
  mgraphics.redraw();
}

// --------------------------------------------------------------- paint --
var ROW_H = 17, GAP = 1, TOP = 16;
function size() {
  var r = (typeof box !== 'undefined' && box.rect) ? box.rect : [0, 0, 152, 147];
  return [r[2] - r[0], r[3] - r[1]];
}
function paint() {
  var g = mgraphics, sz = size(), W = sz[0], Ht = sz[1];
  UI.begin(g);
  UI.rect(0, 0, W, Ht, UI.C.ground);
  UI.text(T.status || GEN.name, 3, 0, W - 6, TOP - 2, T.warn ? UI.C.warnText : UI.C.dim, 9, 0);
  var all = rows();
  var per = Math.max(1, Math.floor((Ht - TOP - ROW_H - GAP) / (ROW_H + GAP)));
  if (all.length <= per + 1) per = all.length;
  var pages = Math.max(1, Math.ceil(all.length / per));
  if (T.page >= pages) T.page = 0;
  all.slice(T.page * per, (T.page + 1) * per).forEach(function (s, i) {
    UI.row(s.label, s.names, s.index, 2, TOP + i * (ROW_H + GAP), W - 4, ROW_H, function (k) { choose(s.id, k); });
  });
  if (pages > 1) {
    var y = Ht - ROW_H - 1, bw = 22;
    UI.button('‹', 2, y, bw, ROW_H, false, function () { T.page = (T.page + pages - 1) % pages; mgraphics.redraw(); });
    UI.text('Settings ' + (T.page + 1) + ' of ' + pages, 2 + bw, y, W - 4 - 2 * bw, ROW_H, UI.C.dim, 9, 1);
    UI.button('›', W - 2 - bw, y, bw, ROW_H, false, function () { T.page = (T.page + 1) % pages; mgraphics.redraw(); });
  }
}
function onclick(x, y) { if (UI.click(x, y)) mgraphics.redraw(); }
function ondrag(x, y, but) { UI.dragTo(x, y, !!but); }
