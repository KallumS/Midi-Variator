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
