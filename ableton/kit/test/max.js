/* A pretend Max and a pretend Live, for testing a device's script in Node.
 *
 * Loads the built bundle the way [v8ui] would: in one global scope, with
 * mgraphics, LiveAPI, Task, outlet and post supplied. mgraphics records what
 * is drawn, so a test can click a control by its words; LiveAPI is backed by
 * a small Live set that a test can read back.
 */
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');

function liveSet(opts) {
  opts = opts || {};
  let nextId = 1;
  const byId = {};
  function obj(props, fns, kids) {
    const o = { id: nextId++, props: props || {}, fns: fns || {}, kids: kids || {} };
    byId[o.id] = o;
    return o;
  }
  function clip(len, notes, extra) {
    const c = obj(Object.assign({ is_midi_clip: 1, loop_start: 0, loop_end: len, length: len, name: '', start_time: 0 }, extra || {}));
    c.notes = (notes || []).map((n, i) => Object.assign({ note_id: i + 1, mute: 0 }, n));
    c.selected = [];
    c.fns.get_notes_extended = (lo, n, from, span) => JSON.stringify({ notes: c.notes.filter((x) =>
      x.pitch >= lo && x.pitch < lo + n && x.start_time >= from && x.start_time < from + span) });
    c.fns.get_selected_notes_extended = () => JSON.stringify({ notes: c.notes.filter((x) => c.selected.includes(x.note_id)) });
    c.fns.add_new_notes = (d) => { d.notes.forEach((n) => c.notes.push(Object.assign({ note_id: c.notes.length + 100 }, n))); };
    c.fns.remove_notes_extended = (lo, n, from, span) => {
      c.notes = c.notes.filter((x) => !(x.pitch >= lo && x.pitch < lo + n && x.start_time >= from && x.start_time < from + span));
    };
    return c;
  }
  const nScenes = opts.scenes || 4;
  const tracks = [];
  function makeTrack(name, audio) {
    const slots = [];
    for (let i = 0; i < nScenes; i++) {
      const s = obj({ has_clip: 0 }, {}, {});
      s.fns.create_clip = (len) => { s.kids.clip = clip(len); s.props.has_clip = 1; };
      slots.push(s);
    }
    const arrangement = [];
    const t = obj({ has_midi_input: audio ? 0 : 1, name: name }, {}, { clip_slots: slots, arrangement_clips: arrangement });
    if (opts.arrangement !== false) t.fns.create_midi_clip = (at, len) => { arrangement.push(clip(len, [], { start_time: at })); };
    return t;
  }
  const track = makeTrack('1-MIDI', opts.audioTrack);
  track.kids.devices = opts.drumRack ? [obj({ can_have_drum_pads: 1, name: 'Drum Rack' })] : [];
  tracks.push(track);
  const slots = track.kids.clip_slots, arrangement = track.kids.arrangement_clips;
  const scenes = slots.map(() => obj({}));
  for (let i = 1; i < (opts.tracks || 1); i++) tracks.push(makeTrack((i + 1) + '-MIDI'));
  const view = obj({}, {}, {});
  const song = obj(Object.assign({ tempo: 120, signature_numerator: 4, signature_denominator: 4, is_playing: 0,
    current_song_time: 0, scale_mode: 1, scale_name: 'Major', root_note: 0 }, opts.song || {}),
    { begin_undo_step: () => { set.undo++; }, end_undo_step: () => {},
      create_midi_track: (i) => { tracks.splice(i < 0 ? tracks.length : i, 0, makeTrack('MIDI')); } },
    { scenes: scenes, tracks: tracks, view: view });
  view.kids.selected_scene = scenes[0];
  view.kids.detail_clip = null;
  const set = { song, track, tracks, slots, scenes, view, arrangement, byId, clip, undo: 0,
    open(c) { view.kids.detail_clip = c; } };
  view.fns = {};
  const origSet = (o, prop, args) => {
    if (prop === 'detail_clip' && args[0] === 'id') { view.kids.detail_clip = byId[args[1]] || null; return; }
    o.props[prop] = args.length === 1 ? args[0] : args;
  };
  set.setProp = origSet;
  return set;
}

function resolve(set, path) {
  const t = String(path).replace(/"/g, '').trim().split(/\s+/);
  let o = null, i = 0;
  if (t[0] === 'live_set') { o = set.song; i = 1; }
  else if (t[0] === 'this_device') { o = set.track; i = 2; } // this_device canonical_parent
  else if (t[0] === 'id') return set.byId[t[1]] || null;
  for (; o && i < t.length; i++) {
    const k = o.kids[t[i]];
    if (Array.isArray(k)) { o = k[+t[++i]] || null; } else o = k === undefined ? null : k;
  }
  return o;
}

function load(bundlePath, opts) {
  opts = opts || {};
  const set = opts.set || liveSet(opts.live);
  const ops = [], out = [], posted = [];
  let clicks = [];
  const mg = opts.graphics || {
    init() {}, redraw() { this.dirty = true; },
    select_font_face() {}, set_font_size(s) { this.fs = s; }, text_measure(s) { return [String(s).length * (this.fs || 10) * 0.55, this.fs || 10]; },
    set_source_rgba() {}, rectangle(x, y, w, h) { this.last = [x, y, w, h]; }, rectangle_rounded(x, y, w, h) { this.last = [x, y, w, h]; },
    fill() {}, stroke() {}, set_line_width() {}, move_to(x, y) { this.at = [x, y]; },
    show_text(s) { ops.push({ text: String(s), x: this.at[0], y: this.at[1] }); },
    line_to() {}, arc() {}, ellipse() {}, close_path() {}, fill_preserve() {}, save() {}, restore() {}, translate() {}, scale() {},
    new_path() {}, curve_to() {}, rel_line_to() {}, set_line_cap() {}, set_line_join() {}
  };
  class LiveAPI {
    constructor(cb, path) { this._o = path ? resolve(set, path) : null; this._p = path; }
    get id() { return this._o ? this._o.id : 0; }
    get unquotedpath() { return String(this._p).replace(/"/g, ''); }
    get path() { return '"' + this.unquotedpath + '"'; }
    get(prop) { if (!this._o) return undefined; const v = this._o.props[prop]; return v === undefined ? undefined : [v]; }
    set(prop, ...args) { if (this._o) set.setProp(this._o, prop, args); }
    call(fn, ...args) {
      if (!this._o || !this._o.fns[fn]) throw new Error('no function ' + fn);
      return this._o.fns[fn](...args);
    }
    getcount(prop) { const k = this._o && this._o.kids[prop]; return Array.isArray(k) ? k.length : 0; }
  }
  const tasks = [];
  class Task {
    constructor(fn) { this.fn = fn; this.on = false; tasks.push(this); }
    repeat() { this.on = true; } cancel() { this.on = false; }
  }
  const buffers = opts.buffers || {};
  // buffers[name]: a Float64Array (one channel), or { chans: [Float64Array], rate } for a sound
  class Buffer {
    constructor(name) {
      this.name = name;
      if (!buffers[name]) buffers[name] = new Float64Array(1024);
    }
    get b() { return buffers[this.name]; }
    chan(ch) { const b = this.b; return b.chans ? b.chans[ch - 1] : b; }
    poke(ch, frame, values) {
      values = [].concat(values);
      let d = this.chan(ch);
      if (!this.b.chans && frame + values.length > d.length) {
        const n = new Float64Array(Math.max(frame + values.length, d.length * 2)); n.set(d); buffers[this.name] = d = n;
      }
      values.forEach((v, i) => { d[frame + i] = v; });
    }
    peek(ch, frame, n) { return Array.from(this.chan(ch).slice(frame, frame + (n || 1))); }
    framecount() { return this.chan(1).length; }
    channelcount() { return this.b.chans ? this.b.chans.length : 1; }
    length() { return this.framecount() / ((this.b.rate || 48000) / 1000); }
  }
  // Max's File, on a map of path -> text
  const disk = opts.disk || {};
  class File {
    constructor(path, mode) {
      this.path = path; this.mode = mode || 'read';
      if (this.mode === 'read' && disk[path] === undefined) { this.isopen = false; return; }
      this.isopen = true; this.text = this.mode === 'read' ? disk[path] : ''; this.position = 0;
    }
    get eof() { return this.text.length; }
    set eof(n) { this.text = this.text.slice(0, n); }
    readstring(n) { const s = this.text.slice(this.position, this.position + n); this.position += s.length; return s; }
    writestring(s) { this.text += s; this.position = this.text.length; }
    close() { if (this.mode !== 'read') disk[this.path] = this.text; this.isopen = false; }
  }
  let now = 0;
  const realDate = Date;
  const FakeDate = function () { return new realDate(now); };
  FakeDate.now = () => now;
  const ctx = {
    mgraphics: mg, LiveAPI, Task, Buffer, File, Date: FakeDate, patcher: { filepath: opts.filepath || '/Live/User Library/Device.amxd' }, max: { getcolor: () => [0.2, 0.2, 0.2, 1] },
    box: { rect: [0, 0, opts.width || 860, opts.height || 169] },
    outlet: (...a) => out.push(a), post: (s) => posted.push(String(s)),
    console, Math, JSON
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(bundlePath, 'utf8'), ctx, { filename: bundlePath });

  const api = {
    ctx, set, out, posted, ops, buffers, disk,
    paint() { ops.length = 0; ctx.paint(); return ops.slice(); },
    texts() { return api.paint().map((o) => o.text); },
    // Click the control whose words are `label` (the nth match).
    click(label, nth, side) {
      const found = api.paint().filter((o) => o.text === label);
      const o = found[nth || 0];
      if (!o) throw new Error('nothing says ' + JSON.stringify(label) + ' among ' + JSON.stringify(api.texts()));
      ctx.onclick(o.x + (side === 'left' ? -40 : 2), o.y - 3, 1);
      ctx.ondrag(o.x + 2, o.y - 3, 0);
    },
    // Advance the clock and run the ticking tasks.
    run(ms) {
      for (let t = 0; t < ms; t += 4) { now += 4; tasks.filter((k) => k.on).forEach((k) => k.fn()); }
    },
    midi() { return out.filter((a) => a[0] === 0).map((a) => a[1]); },
    saved() { const s = out.filter((a) => a[0] === 1 && a[1] === 'set'); return s.length ? JSON.parse(s[s.length - 1][2]) : null; },
    send(msg, ...args) { return ctx[msg](...args); }
  };
  return api;
}

module.exports = { load, liveSet };
