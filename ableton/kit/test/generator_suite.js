/* The tests every generator device passes, whatever its engine.
 *   require('../kit/test/generator_suite.js')({ bundle, name, selection })
 * `selection` is true for an engine that works on a clip's notes (Use Clip). */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load, liveSet } = require('./max.js');

// A clip to work from: a C major tune over two bars.
const TUNE = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72, 71, 67, 65, 64].map((p, i) =>
  ({ pitch: p, start_time: i * 0.5, duration: 0.5, velocity: 100 }));

function balanced(bytes) {
  const on = {};
  for (let i = 0; i < bytes.length; i += 3) {
    const st = bytes[i] & 0xF0, p = bytes[i + 1];
    if (st === 0x90 && bytes[i + 2] > 0) on[p] = (on[p] || 0) + 1; else on[p] = (on[p] || 0) - 1;
  }
  return Object.values(on).every((n) => n === 0);
}
function plain(x) { return JSON.parse(JSON.stringify(x)); }

module.exports = function (o) {
  function device(opts) {
    opts = opts || {};
    let set = opts.set;
    if (!set) {
      set = liveSet(opts.live);
      if (o.selection) set.open(set.clip(8, TUNE));
    }
    const d = load(o.bundle, { set, width: o.width });
    d.send('bang');
    if (o.selection && !opts.noClip) d.click('Use Clip');
    if (o.beside && !opts.keepTarget) d.click('New Track');   // the shared tests start from New Clip
    return d;
  }
  function results(d) { return d.ctx.S.results; }

  test(o.name + ': it opens with results, in the key, with its controls', () => {
    const d = device();
    const t = d.texts();
    assert.ok(results(d).length > 0, d.ctx.S.status);
    assert.ok(!d.ctx.S.warn, d.ctx.S.status);
    const words = ['New Ideas', 'Play', 'Insert', 'New Clip'].concat(o.keyless ? [] : ['Follow Live', 'Key', 'Scale']);
    if (o.keyless) for (const w of ['Follow Live', 'Key', 'Scale']) assert.ok(!t.includes(w), 'no ' + w + ': the key is heard in the music');
    for (const w of words) assert.ok(t.includes(w), w + ' in ' + t.join(' | '));
    if (!o.selection && !o.keyless) assert.ok(t.some((s) => s.indexOf('C Major') >= 0), t.join(' | '));
  });

  if (o.selection) {
    test(o.name + ': without a clip it says what to do', () => {
      const d = device({ noClip: true, set: liveSet() });
      assert.strictEqual(results(d).length, 0);
      assert.ok(d.texts().some((s) => s.indexOf('Use Clip') >= 0));
      d.click('Use Clip');
      assert.ok(d.texts().some((s) => s.startsWith('No MIDI clip is open')));
    });
  }

  test(o.name + ': a result is heard when chosen, and every note it starts it stops', () => {
    const d = device();
    const k = Math.min(1, results(d).length - 1);
    d.click(d.ctx.S.results[k].title || ('Result ' + (k + 1)));
    d.run(60000);
    const bytes = d.midi();
    assert.ok(bytes.length >= 3, 'notes were sent');
    assert.ok(balanced(bytes), 'every note stopped');
  });

  test(o.name + ': New Ideas gives different results, and the same ones come back with the set', () => {
    const d = device();
    const before = JSON.stringify(results(d));
    let changed = false;
    for (let i = 0; i < 5 && !changed; i++) { d.click('New Ideas'); changed = JSON.stringify(results(d)) !== before; }
    const saved = d.saved();
    const e = device();
    e.send('restore', JSON.stringify(saved));
    assert.strictEqual(JSON.stringify(results(e)), JSON.stringify(results(d)), 'restored results match');
    if (o.varies !== false) assert.ok(changed, 'New Ideas changed something');
  });

  test(o.name + ': Insert puts the result in a new clip, and further parts on new tracks', () => {
    const d = device();
    const r = results(d)[0];
    d.click('Insert');
    const clip = d.set.slots[0].kids.clip;
    assert.ok(clip, 'a clip was made: ' + d.ctx.S.status);
    assert.strictEqual(clip.notes.length, r.parts[0].notes.length);
    assert.strictEqual(d.set.tracks.length, r.parts.length, 'one track per part');
    r.parts.slice(1).forEach((p, i) => {
      const t = d.set.tracks[1 + i];
      assert.strictEqual(t.kids.clip_slots[0].kids.clip.notes.length, p.notes.length, p.name);
    });
    assert.ok(!d.ctx.S.warn, d.ctx.S.status);
  });

  test(o.name + ': a full track says so instead of overwriting', () => {
    const set = liveSet({ scenes: 1 });
    if (o.selection) set.open(set.clip(8, TUNE));
    const d = device({ set });
    d.click('Insert');
    d.click('Insert');
    assert.ok(d.texts().some((s) => s.startsWith('Every clip slot on this track is full')));
  });

  test(o.name + ': Arrangement puts the result at the insert marker', () => {
    const set = liveSet({ song: { current_song_time: 8 } });
    if (o.selection) set.open(set.clip(8, TUNE));
    const d = device({ set });
    d.click('New Clip');
    d.click('Insert');
    assert.ok(set.arrangement.length >= 1, d.ctx.S.status);
    assert.strictEqual(set.arrangement[0].props.start_time, 8);
    assert.ok(set.arrangement[0].notes.length > 0);
  });

  test(o.name + ': This Clip replaces the notes of the open clip with one part', () => {
    const set = liveSet();
    const c = set.clip(8, o.selection ? TUNE : [{ pitch: 40, start_time: 0, duration: 1, velocity: 90 }]);
    set.open(c);
    const d = device({ set });
    d.click('New Clip'); d.click('Arrangement');
    const parts = d.ctx.S.settings.find((s) => s.id === '$part');
    if (parts) d.ctx.setSetting('$part', 2);
    d.click('Insert');
    assert.ok(!d.ctx.S.warn, d.ctx.S.status);
    const r = results(d)[d.ctx.S.chosen];
    assert.strictEqual(c.notes.length, (parts ? r.parts[0] : r.parts[0]).notes.length);
  });

  if (!o.keyless) test(o.name + ': it follows Live’s scale', () => {
    const d = device({ live: { song: { scale_name: 'Dorian', root_note: 2 } } });
    assert.deepStrictEqual(plain(d.ctx.S.key), { root: 4, scale: 5 });
    const e = device({ live: { song: { scale_name: 'Minor', root_note: 8 } } });
    assert.deepStrictEqual(plain(e.ctx.S.key), { root: 12, scale: 2 });
    const f = device({ live: { song: { scale_name: 'Bhairav', root_note: 0 } } });
    assert.ok(f.texts().some((s) => s.indexOf('isn’t one this device knows') >= 0));
  });

  test(o.name + ': every setting can be stepped through without an error', () => {
    const d = device();
    for (let pass = 0; pass < 2; pass++) {
      for (const s of d.ctx.S.settings.slice()) {
        if (!d.ctx.S.settings.some((x) => x.id === s.id)) continue;
        for (let i = 1; i <= s.names.length; i++) {
          d.ctx.setSetting(s.id, i);
          assert.ok(!d.ctx.S.warn, s.id + '=' + s.names[i - 1] + ': ' + d.ctx.S.status);
        }
      }
    }
  });

  test(o.name + ': state restored before Live is ready waits for it', () => {
    const d = device();
    d.click('New Clip');
    const saved = d.saved();
    const e = load(o.bundle);
    e.send('restore', JSON.stringify(saved));
    e.send('bang');
    assert.strictEqual(e.ctx.S.target, d.ctx.S.target);
  });

  if (o.beside) {
    test(o.name + ': a suggestion goes on a new track beside this one, and is heard with the music', () => {
      const d = device({ keepTarget: true });
      assert.ok(d.texts().includes('New Track'));
      const r = results(d)[0];
      d.click('Insert');
      assert.ok(!d.ctx.S.warn, d.ctx.S.status);
      assert.strictEqual(d.set.tracks.length, 1 + r.parts.length);
      assert.strictEqual(d.set.slots[0].props.has_clip, 0, 'nothing written over the music');
      assert.strictEqual(d.set.tracks[1].kids.clip_slots[0].kids.clip.notes.length, r.parts[0].notes.length);
      d.click('Play');
      d.run(60000);
      const ons = d.midi().filter((b, i) => i % 3 === 0 && (b & 0xF0) === 0x90).length;
      assert.ok(ons >= r.parts[0].notes.length + TUNE.length, 'the original is heard too');
    });
  }

  return { device, TUNE, balanced };
};
