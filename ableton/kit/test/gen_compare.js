/* A JSFX's gen~ translation held to Middaw's runtime, sample by sample.
 *   compare(text, { readImport, seconds, sliders: {n: v}, midi: [[sample, b1, b2, b3]], input: (i, ch) => x, code })
 * `code` is GenExpr to test instead of a fresh translation (the one in a device).
 * Returns { worst, at, samples, outs }: the largest difference seen. */
'use strict';
const path = require('path');
const J = require('../runtime/jsfx.js');
const Gen = require('../jsfx2gen.js');
const { load } = require('./genexpr.js');

function parkMiller() {
  let s = 22222;
  return () => { s = s * 16807 - 2147483647 * Math.floor(s * 16807 / 2147483647); return s / 2147483647; };
}

function compare(text, o) {
  o = o || {};
  const SR = 48000, B = o.block || 32, N = Math.round((o.seconds || 1) * SR / B) * B;
  const realRandom = Math.random;
  const mq = new Float64Array(1 + 3 * Gen.MQ_CAP);
  const tr = Gen.translate(text, { readImport: o.readImport, block: B, memory: o.memory });
  const g = load(o.code || tr.code, { sampleRate: SR, mq, buffers: o.buffers });
  const fx = new J.JSFX(text, { readImport: o.readImport, sampleRate: SR });
  Object.keys(o.sliders || {}).forEach((k) => { fx.setSliderByIndex(+k, o.sliders[k]); g.set('slider' + k, o.sliders[k]); });
  const inputs = tr.inputs, outputs = tr.outputs;
  let worst = 0, at = -1, peak = 0;
  const midi = (o.midi || []).slice().sort((a, b) => a[0] - b[0]);
  let mk = 0, written = 0;
  try {
    Math.random = parkMiller();
    fx.init(SR);
    const genRandom = parkMiller();
    const ins = [], outs = [];
    for (let c = 0; c < inputs; c++) ins.push(new Float32Array(B));
    for (let c = 0; c < outputs; c++) outs.push(new Float32Array(B));
    for (let b = 0; b < N; b += B) {
      const ev = [];
      while (mk < midi.length && midi[mk][0] < b + B) {
        const m = midi[mk++];
        ev.push({ offset: 0, data: [m[1], m[2], m[3]] });
        const at3 = 1 + 3 * (written % Gen.MQ_CAP);
        mq[at3] = m[1]; mq[at3 + 1] = m[2]; mq[at3 + 2] = m[3];
        written++; mq[0] = written;
      }
      for (let c = 0; c < inputs; c++) for (let i = 0; i < B; i++) ins[c][i] = o.input ? o.input(b + i, c) : 0;
      // the runtime's rand and the translation's each run their own copy of the same sequence
      fx.process(B, inputs ? ins : null, outs, ev);
      for (let i = 0; i < B; i++) {
        const y = g.step(inputs > 0 ? ins[0][i] : 0, inputs > 1 ? ins[1][i] : 0);
        for (let c = 0; c < outputs; c++) {
          const ref = outs[c][i], d = Math.abs(y[c] - ref);
          peak = Math.max(peak, Math.abs(ref));
          if (!(d <= worst) || d !== d) { if (d > worst || d !== d) { worst = d !== d ? Infinity : d; at = b + i; } }
        }
      }
    }
  } finally { Math.random = realRandom; }
  return { worst, at, samples: N, peak, lines: tr.code.split('\n').length };
}
module.exports = { compare };
