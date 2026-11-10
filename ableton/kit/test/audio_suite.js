/* The tests every JSFX audio device passes: its window runs and drives gen~,
 * and the gen~ code in the device - read back out of the .maxpat - sounds as
 * Middaw's runtime does, sample by sample.
 *   require('../kit/test/audio_suite.js')({ bundle, maxpat, jsfx, readImport, name, window, instrument }) */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { load } = require('./max.js');
const { compare } = require('./gen_compare.js');
const genexpr = require('./genexpr.js');

function genCode(maxpat) {
  let code = null;
  (function walk(p) {
    (p.boxes || []).forEach((b) => { if (b.box.maxclass === 'codebox') code = b.box.code; if (b.box.patcher) walk(b.box.patcher); });
  })(JSON.parse(fs.readFileSync(maxpat, 'utf8')).patcher);
  return code;
}

module.exports = function (o) {
  function device(opts) {
    const d = load(o.bundle, Object.assign({ width: o.window[0], height: o.window[1] }, opts || {}));
    d.send('bang');
    d.send('mqname', 'mq-1');
    d.status = () => { const s = d.out.filter((a) => a[0] === 2); return s.length ? s[s.length - 1].slice(2).join(' ') : ''; };
    d.toGen = () => d.out.filter((a) => a[0] === 3).map((a) => a.slice(1));
    return d;
  }
  const code = genCode(o.maxpat);

  test(o.name + ': the device carries the gen~ code, and it sounds as the runtime does', () => {
    assert.ok(code && code.length > 1000, 'a codebox is in the device');
    const notes = [];
    [[0, 48], [7000, 55], [14000, 60], [21000, 64]].forEach(([t, p]) => { notes.push([t, 0x90, p, 100]); notes.push([t + 12000, 0x80, p, 0]); });
    const r = compare(fs.readFileSync(o.jsfx, 'utf8'), { readImport: o.readImport, seconds: 1, midi: notes, memory: o.memory, code: code,
      input: (i, c) => (i % 9000 < 4 ? 0.6 : 0) + 0.05 * Math.sin(i * 0.01 * (c + 1)) });
    assert.ok(r.worst < 1e-6, 'worst difference ' + r.worst + ' at sample ' + r.at);
    assert.ok(r.peak > 0.01, 'it made a sound: peak ' + r.peak);
  });

  if (/Data M\(/.test(code || '')) test(o.name + ': gen~ has memory enough for chords at 192 kHz', () => {
    const declared = Number(/Data M\((\d+)\)/.exec(code)[1]);
    const big = code.replace(/Data M\(\d+\)/, 'Data M(8388608)');
    let highest = 0;
    for (let k = 0; k < 3; k++) {
      const mq = new Float64Array(1024), g = genexpr.load(big, { sampleRate: 192000, mq });
      let n = 0;
      const put = (a, b, c) => { const at = 1 + 3 * (n % 256); mq[at] = a; mq[at + 1] = b; mq[at + 2] = c; n++; mq[0] = n; };
      const sl = o.vary || null;
      if (sl) g.set('slider' + sl, k);
      for (let i = 0; i < 192000; i++) {
        if (i === 0) [36, 48, 60, 72].forEach((p) => put(0x90, p, 110));
        if (i === 120000) [36, 48, 60, 72].forEach((p) => put(0x80, p, 0));
        g.step(i % 9000 < 4 ? 0.6 : 0, 0);
      }
      for (let i = g.M.length - 1; i >= 0; i--) if (g.M[i] !== 0) { highest = Math.max(highest, i); break; }
    }
    assert.ok(highest < declared * 0.75, 'memory written up to ' + highest + ' of ' + declared);
  });

  test(o.name + ': the window draws and answers clicks without an error', () => {
    const d = device();
    d.run(200);
    assert.ok(d.texts().length > 5, 'the window drew words');
    for (let y = 10; y < o.window[1]; y += 41) for (let x = 10; x < o.window[0]; x += 61) {
      d.ctx.onclick(x, y, 1, 0, 0, 0, 0, 0); d.paint(); d.ctx.ondrag(x, y, 0); d.paint();
      if (d.ctx.D.menu) d.ctx.onclick(-5, -5, 1, 0, 0, 0, 0, 0);
      d.run(8);
    }
    assert.ok(!/stopped/.test(d.status()), d.status());
  });

  test(o.name + ': every slider reaches gen~, once, and again when it moves', () => {
    const d = device();
    d.run(100);
    const first = d.toGen().filter((m) => /^slider\d+$/.test(m[0]));
    const n = d.ctx.fx.file.sliders.length;
    assert.strictEqual(new Set(first.map((m) => m[0])).size, n, 'all ' + n + ' sliders sent');
    assert.ok(d.toGen().some((m) => m[0] === 'tempo'), 'the tempo is sent');
    const sl = d.ctx.fx.file.sliders[1];
    d.out.length = 0;
    d.ctx.fx.setSliderByIndex(sl.index, sl.max);
    d.run(100);
    assert.deepStrictEqual(d.toGen().filter((m) => /^slider/.test(m[0])), [['slider' + sl.index, sl.max]]);
  });

  test(o.name + ': the state is saved, and restoring it sends it to gen~', () => {
    const d = device();
    d.run(50);
    const sl = d.ctx.fx.file.sliders[2];
    d.ctx.fx.setSliderByIndex(sl.index, sl.min);
    d.ctx.save();
    const saved = d.out.filter((a) => a[0] === 1 && a[1] === 'set').pop();
    const e = load(o.bundle, { width: o.window[0], height: o.window[1] });
    e.send('restore', saved[2]);
    e.send('bang');
    e.run(100);
    const sent = e.out.filter((a) => a[0] === 3 && a[1] === 'slider' + sl.index);
    assert.strictEqual(sent[sent.length - 1][2], sl.min);
  });

  if (o.instrument) {
    test(o.name + ': notes played into the device are what gen~ reads, and it sounds', () => {
      const d = device();
      d.run(20);
      [0x90, 60, 100].forEach((b) => d.send('msg_int', b));
      d.run(20);
      const mq = d.buffers['mq-1'];
      assert.strictEqual(mq[0], 1);
      assert.deepStrictEqual(Array.from(mq.slice(1, 4)), [0x90, 60, 100]);
      const g = genexpr.load(code, { mq: Float64Array.from(mq) });
      let peak = 0;
      for (let i = 0; i < 24000; i++) peak = Math.max(peak, Math.abs(g.step(0, 0)[0]));
      assert.ok(peak > 0.01, 'gen~ played the note: peak ' + peak);
    });
  }
  return { device, code };
};
