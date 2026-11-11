/* The tests every MIDI Tool passes, whatever its engine.
 *   require('../kit/test/tool_suite.js')({ dir, name, kind, inKey, beside })
 * `dir` holds the built tool (ableton/tool); `kind` is 'generator' or
 * 'transformation'; `inKey` says a generator writes only the scale's notes;
 * `beside` says a transformation keeps the notes it was given and adds its own.
 * Live's side is what live.miditool.in hands over: the notes, and a context
 * of the clip's time selection, its scale, the grid and a seed per apply. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./max.js');

// A melody in Eb minor over two bars, from beat 4: what a clip hands a transformation.
const TUNE = [[63, 4, 0.5], [65, 4.5, 0.5], [66, 5, 1], [70, 6, 1], [68, 7, 0.5], [66, 7.5, 0.5], [65, 8, 1], [63, 9, 3]]
  .map(([p, s, d]) => ({ note_id: Math.round(s * 10), pitch: p, start_time: s, duration: d, velocity: 100, mute: 0, probability: 1 }));
const EB_MINOR = { scale_mode: 1, root_note: 3, scale_name: 'Minor', scale_intervals: [0, 2, 3, 5, 7, 8, 10] };
const NO_SCALE = { scale_mode: 0, root_note: 0, scale_name: 'Major', scale_intervals: [0, 2, 4, 5, 7, 9, 11] };
function context(o) {
  o = o || {};
  return { clip: { time_selection_start: o.start === undefined ? 4 : o.start, time_selection_end: o.end === undefined ? 12 : o.end },
           scale: o.scale || EB_MINOR, grid: { interval: 0.25, enabled: 1 }, seed: o.seed === undefined ? 1234 : o.seed };
}

function amxd(file) {
  const data = fs.readFileSync(file);
  const size = data.readUInt32LE(28);
  return { type: data.slice(8, 12).toString('latin1'), patch: JSON.parse(data.slice(32, 32 + size).toString('utf8').replace(/\0+$/, '')) };
}

module.exports = function (o) {
  const desc = JSON.parse(fs.readFileSync(path.join(o.dir, 'tool.json'), 'utf8'));
  const bundle = path.join(o.dir, desc.slug + '.js');
  const generate = o.kind === 'generator';
  const label = o.name + ' (' + (generate ? 'Generate' : 'Transform') + ')';
  function tool(opts) { const d = load(bundle, Object.assign({ width: 152, height: 147 }, opts || {})); d.send('bang'); return d; }
  const given = () => (generate ? [] : TUNE.map((n) => Object.assign({}, n)));
  const shown = (x) => JSON.parse(JSON.stringify(x.ctx.rows().map((r) => r.label + '=' + r.names[r.index - 1])));
  // Step the first setting after Result that can move on, and say which.
  function nudge(d) {
    const arrows = d.texts().filter((t) => t === '›').length;
    for (let k = 1; k < arrows; k++) {
      const before = JSON.stringify(shown(d));
      d.click('›', k);
      if (JSON.stringify(shown(d)) !== before) return k;
    }
    throw new Error('no setting could be changed');
  }

  test(label + ': the file is a MIDI Tool of its kind, wired from live.miditool.in to live.miditool.out', () => {
    const a = amxd(path.join(o.dir, desc.name + '.amxd'));
    const four = generate ? 'nagg' : 'natt';
    assert.strictEqual(a.type, four);
    assert.strictEqual(a.patch.patcher.project.amxdtype, Buffer.from(four).readUInt32BE(0));
    const boxes = {};
    a.patch.patcher.boxes.forEach((b) => { boxes[b.box.id] = b.box; });
    const named = (t) => Object.values(boxes).find((b) => b.text === t || b.maxclass === t);
    const tin = named('live.miditool.in'), tout = named('live.miditool.out'), ui = named('v8ui'), join = named('dict.join');
    assert.ok(tin && tout && ui && join, 'the four objects are there');
    assert.deepStrictEqual(ui.presentation_rect, [0, 0, 152, 147]);
    const wired = (a1, o1, b1, i1) => a.patch.patcher.lines.some((l) => l.patchline.source[0] === a1.id && l.patchline.source[1] === o1 &&
                                                                      l.patchline.destination[0] === b1.id && l.patchline.destination[1] === i1);
    assert.ok(wired(tin, 0, join, 0) && wired(tin, 1, join, 1) && wired(join, 0, ui, 0), 'notes and context reach the window');
    assert.ok(wired(ui, 0, tout, 0), 'the window writes to live.miditool.out');
    assert.ok(wired(ui, 2, tin, 0), 'the window can ask Live to apply again');
  });

  test(label + ': an apply writes notes inside the time selection, in the clip’s scale', () => {
    const d = tool();
    const out = d.tool(given(), context());
    assert.ok(out && out.length, 'notes were written: ' + d.texts()[0]);
    const mine = o.beside ? out.slice(TUNE.length) : out;
    assert.ok(mine.length, 'something of its own was written');
    for (const n of mine) {
      assert.ok(n.start_time >= 4 - 1e-9 && n.start_time + n.duration <= 12 + 1e-6, 'inside the selection: ' + JSON.stringify(n));
      assert.ok(n.pitch >= 0 && n.pitch <= 127 && n.velocity >= 1 && n.velocity <= 127 && n.duration > 0, JSON.stringify(n));
      if (o.inKey) assert.ok(EB_MINOR.scale_intervals.includes(((n.pitch - 3) % 12 + 12) % 12), 'in Eb minor: ' + n.pitch);
    }
    if (generate) assert.ok(Math.max(...out.map((n) => n.start_time)) >= 8, 'the selection is filled, not just its first bar');
  });

  test(label + ': the same apply gives the same notes (Live’s seed decides, not the clock)', () => {
    const a = tool().tool(given(), context()), b = tool().tool(given(), context());
    assert.deepStrictEqual(a, b);
  });

  if (generate) {
    test(label + ': a selection that is not a whole number of blocks is filled and cut at its end', () => {
      const out = tool().tool([], context({ start: 4, end: 10.5 }));
      assert.ok(out.length);
      assert.ok(out.every((n) => n.start_time >= 4 && n.start_time + n.duration <= 10.5 + 1e-6), 'a note runs past the selection');
      assert.ok(Math.max(...out.map((n) => n.start_time + n.duration)) > 10, 'the end of the selection is reached');
    });
    test(label + ': with no time selection it writes four bars from the start', () => {
      const out = tool().tool([], context({ start: 0, end: 0 }));
      assert.ok(out.length);
      assert.ok(out.every((n) => n.start_time >= 0 && n.start_time + n.duration <= 16 + 1e-6));
    });
    test(label + ': the clip’s scale decides the key; without one, the tool’s own Key and Scale show and decide', () => {
      const d = tool();
      d.tool([], context());
      assert.ok(!d.texts().includes('Key'), 'no Key row while the clip has a scale');
      const inEb = d.tool([], context());
      const inC = d.tool([], context({ scale: NO_SCALE }));
      const all = () => { const t = []; for (let p = 0; p < 4; p++) { t.push(...d.texts()); d.ctx.T.page = (d.ctx.T.page + 1) % 8; } return t; };
      assert.ok(all().includes('Key'), 'the Key row shows for a clip with no scale');
      assert.notDeepStrictEqual(inEb.map((n) => n.pitch), inC.map((n) => n.pitch));
    });
  } else {
    test(label + ': with nothing selected it leaves the clip as it is and says what to do', () => {
      const d = tool();
      const out = d.tool([], context());
      assert.deepStrictEqual(out, []);
      assert.strictEqual(d.ctx.T.status, 'Select notes to change first.');
    });
    if (o.beside) {
      test(label + ': the notes it was given stay, exactly, beside the suggestion', () => {
        const out = tool().tool(given(), context());
        assert.deepStrictEqual(out.slice(0, TUNE.length), TUNE);
        assert.ok(out.length > TUNE.length);
      });
    } else {
      test(label + ': a new apply (a new seed) can give a different variation', () => {
        const d = tool();
        const seen = new Set();
        for (let s = 1; s <= 12; s++) seen.add(JSON.stringify(d.tool(given(), context({ seed: s * 7919 }))));
        assert.ok(seen.size > 1, 'every seed gave the same notes');
      });
    }
  }

  test(label + ': a setting changed after an apply asks Live to apply again; before one, it does not', () => {
    const d = tool();
    nudge(d);
    d.run(20);
    assert.strictEqual(d.bangs(), 0, 'no apply yet, so nothing to redo');
    d.tool(given(), context());
    nudge(d);
    d.run(20);
    assert.strictEqual(d.bangs(), 1);
  });

  test(label + ': its settings are kept with the set', () => {
    const d = tool();
    nudge(d);
    const saved = d.out.filter((a) => a[0] === 1 && a[1] === 'set').pop();
    assert.ok(saved, 'the state went to the pattr');
    const e = tool();
    e.send('restore', saved[2]);
    assert.deepStrictEqual(shown(e), shown(d));
    assert.notDeepStrictEqual(shown(tool()), shown(d), 'the click changed something to keep');
  });

  test(label + ': it is drawn in the Ableton palette', () => {
    const d = tool();
    const P = d.ctx.Palette;
    assert.ok(P, 'palette.js is in the bundle');
    assert.deepStrictEqual(d.ctx.UI.C.ground.slice(0, 3), P.rgb(P.C.ground).slice(0, 3));
  });
};
