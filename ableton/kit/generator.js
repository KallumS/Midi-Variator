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

  // The engine's settings, four rows to a column.
  var resX = W - 296, cols = Math.max(1, Math.floor((resX - SET_X) / (CELL_W + CELL_GAP))), per = cols * 4;
  var pages = Math.max(1, Math.ceil(S.settings.length / per));
  if (S.page >= pages) S.page = 0;
  var shown = S.settings.slice(S.page * per, (S.page + 1) * per);
  shown.forEach(function (s, i) {
    var col = Math.floor(i / 4), row = i % 4;
    UI.stepper(s.label, s.names, s.index, SET_X + col * (CELL_W + CELL_GAP), ROW_Y[row], CELL_W, function (k) { setSetting(s.id, k); });
  });
  if (pages > 1) {
    UI.button('More Settings', SET_X, Ht - 22, 100, 18, false, function () { S.page = (S.page + 1) % pages; mgraphics.redraw(); });
    UI.text((S.page + 1) + ' of ' + pages, SET_X + 106, Ht - 22, 60, 18, UI.C.dim, 9, 0);
  }

  // The results: click one to hear it.
  var lx = resX, lw = 290, ly = 20, rowH = 15, rows = 8;
  UI.rect(lx, ly, lw, rows * rowH + 2, UI.C.sunken);
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
    UI.button('↑', lx + lw - 38, ly + rows * rowH + 4, 18, 14, false, function () { S.chosen = Math.max(0, S.chosen - 1); mgraphics.redraw(); });
    UI.button('↓', lx + lw - 18, ly + rows * rowH + 4, 18, 14, false, function () { S.chosen = Math.min(S.results.length - 1, S.chosen + 1); mgraphics.redraw(); });
  }

  var by = Ht - 22, has = S.results.length > 0;
  UI.button('New Ideas', lx, by, 76, 18, false, newIdeas);
  UI.button(player.playing() ? 'Stop' : 'Play', lx + 80, by, 46, 18, player.playing(), play, has);
  UI.button('Insert', lx + 130, by, 56, 18, false, insert, has);
  UI.button(TARGETS[S.target], lx + 190, by, 100, 18, false, function () { S.target = (S.target + 1) % TARGETS.length; save(); mgraphics.redraw(); });
}

function onclick(x, y) { if (UI.click(x, y)) mgraphics.redraw(); }
function ondrag(x, y, but) { UI.dragTo(x, y, !!but); }
