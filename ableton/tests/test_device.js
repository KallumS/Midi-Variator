/* The Max for Live device, run in Node on a pretend Max and a pretend Live.
 *   python3 ableton/kit/build.py ableton/device.json && node --test ableton/tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { load, liveSet } = require('../kit/test/max.js');
const suite = require('../kit/test/generator_suite.js');
require('../kit/test/palette_suite.js')();

const BUNDLE = path.join(__dirname, '..', 'MidiVariator.js');
const { device, TUNE } = suite({ bundle: BUNDLE, name: 'Midi Variator', selection: true, keyless: true });

test('it hears the key in the clip and says so', () => {
  const d = device();
  assert.ok(d.texts().some((s) => s.startsWith('Heard in C')), d.texts()[0]);
});

test('every variation keeps the clip’s length and stays near it', () => {
  const d = device();
  for (const r of d.ctx.S.results) {
    assert.strictEqual(r.beats, 8);
    const n = r.parts[0].notes.length;
    assert.ok(n >= TUNE.length / 2 && n <= TUNE.length * 2, r.title + ': ' + n + ' notes');
  }
});

test('selected notes are what is varied, from the bar they start in', () => {
  const set = liveSet();
  const c = set.clip(16, TUNE.concat([{ pitch: 48, start_time: 9, duration: 1, velocity: 100 },
                                      { pitch: 50, start_time: 10, duration: 1, velocity: 100 }]));
  c.selected = c.notes.filter((n) => n.start_time >= 9).map((n) => n.note_id);
  set.open(c);
  const d = load(BUNDLE, { set });
  d.send('bang');
  d.click('Use Clip');
  assert.deepStrictEqual(Array.from(d.ctx.S.selection.notes, (n) => n.start), [1, 2]);
  assert.strictEqual(d.ctx.S.selection.beats, 4);
});

test('on a Drum Rack the clip is varied as drums', () => {
  const set = liveSet({ drumRack: true });
  set.open(set.clip(4, [36, 42, 38, 42, 36, 36, 38, 42].map((p, i) => ({ pitch: p, start_time: i * 0.5, duration: 0.25, velocity: 100 }))));
  const d = load(BUNDLE, { set });
  d.send('bang');
  d.click('Use Clip');
  assert.strictEqual(d.ctx.S.selection.drums, true);
  assert.ok(d.ctx.S.results.length > 0, d.ctx.S.status);
  for (const r of d.ctx.S.results) for (const n of r.parts[0].notes) assert.ok([36, 38, 42, 44, 46, 49, 51, 37, 39, 41, 43, 45, 47, 48, 50, 35, 40].includes(n.pitch), r.title + ' drum ' + n.pitch);
});
