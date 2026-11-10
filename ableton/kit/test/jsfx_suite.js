/* The tests every JSFX device passes: the plug-in runs, its own window draws
 * and answers the mouse, MIDI goes through it, and its state is saved.
 *   const { device } = require('../kit/test/jsfx_suite.js')({ bundle, name, window: [w, h] }) */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load, liveSet } = require('./max.js');

module.exports = function (o) {
  function device(opts) {
    opts = opts || {};
    const d = load(o.bundle, Object.assign({ width: o.window[0], height: o.window[1] }, opts));
    d.send('bang');
    d.note = (on, pitch, vel) => { [on ? 0x90 : 0x80, pitch, on ? vel || 100 : 0].forEach((b) => d.send('msg_int', b)); };
    d.status = () => { const s = d.out.filter((a) => a[0] === 2); return s.length ? s[s.length - 1].slice(2).join(' ') : ''; };
    return d;
  }

  test(o.name + ': the plug-in runs and its own window draws', () => {
    const d = device();
    d.run(500);
    const t = d.texts();
    assert.ok(t.length > 5, 'the window drew words: ' + t.slice(0, 10).join(' | '));
    assert.ok(!/stopped/.test(d.status()), d.status());
  });

  test(o.name + ': the window answers clicks all over it without an error', () => {
    const d = device();
    for (let y = 10; y < o.window[1]; y += 37) {
      for (let x = 10; x < o.window[0]; x += 53) {
        d.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0);
        d.paint();
        d.ctx.ondrag(x, y, 0);
        d.paint();
        if (d.ctx.D.menu) d.ctx.onclick(-5, -5, 1, 0, 0, 0, 0, 0);   // a menu opened: click away
        d.run(8);
      }
    }
    assert.ok(!/stopped/.test(d.status()), d.status());
  });

  test(o.name + ': notes in come out, and nothing is left sounding', () => {
    const d = device();
    d.run(50);
    d.note(true, 60); d.note(true, 64); d.note(true, 67);
    d.run(2000);
    d.note(false, 60); d.note(false, 64); d.note(false, 67);
    d.run(6000);
    const b = d.midi(), on = {};
    for (let i = 0; i + 2 < b.length; i += 3) {
      const st = b[i] & 0xF0, ch = b[i] & 15, key = ch + ':' + b[i + 1];
      if (st === 0x90 && b[i + 2] > 0) on[key] = (on[key] || 0) + 1;
      else if (st === 0x80 || (st === 0x90 && b[i + 2] === 0)) on[key] = (on[key] || 0) - 1;
    }
    assert.ok(b.length > 0, 'something came out');
    assert.ok(Object.values(on).every((n) => n <= 0), 'every note ended: ' + JSON.stringify(on));
  });

  test(o.name + ': the state is saved when it changes, and comes back', () => {
    const d = device();
    d.run(100);
    d.ctx.fx.setSliderByIndex(d.ctx.fx.file.sliders[0].index, d.ctx.fx.file.sliders[0].max);
    d.ctx.save();
    const saved = d.out.filter((a) => a[0] === 1 && a[1] === 'set').pop();
    assert.ok(saved, 'the state went to [pattr]');
    const n = d.out.length;
    d.ctx.save();
    assert.strictEqual(d.out.length, n, 'nothing new is written when nothing changed');
    const e = load(o.bundle, { width: o.window[0], height: o.window[1] });
    e.send('restore', saved[2]);
    e.send('bang');
    assert.strictEqual(JSON.stringify(e.ctx.fx.serialize()), JSON.parse(saved[2]).fx ? JSON.stringify(JSON.parse(saved[2]).fx) : '');
  });

  return { device };
};
