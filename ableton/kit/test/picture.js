/* The README's picture of a device: drawn by the device's own code on a
 * pretend Max and a pretend Live set, doing what a scene asks first.
 * Each repo's `ableton/window.js` is its scene:
 *   require('./kit/test/picture.js')(__dirname, { bundle, w, h, clip, live, buffers, apply, go(d) })
 * A MIDI Tool's scene (ableton/tool/window.js) gives `apply`: the notes and
 * context Live would hand it, so the picture shows the tool after an apply.
 * and `node ableton/window.js` writes `ableton/window.png`, at Retina's 2x. */
'use strict';
const path = require('path');
const { load, liveSet } = require('./max.js');
const svg = require('./svg.js');

function picture(dir, S) {
  const set = liveSet(S.live);
  // a clip open in Detail View, for the devices that read one
  if (S.clip) set.open(set.clip(8, picture.TUNE, { name: typeof S.clip === 'string' ? S.clip : 'Tune' }));
  const g = svg.graphics(S.w, S.h);
  const d = load(path.join(dir, S.bundle), { set, width: S.w, height: S.h, graphics: g, buffers: S.buffers });
  d.send('bang');
  if (d.ctx.mqname) d.send('mqname', 'mq-1');
  d.run(300);
  if (S.clip === true) d.ctx.useClip();
  if (S.apply) d.tool(S.apply.notes || [], S.apply.context);
  if (S.go) S.go(d);
  g.clear();
  d.ctx.paint();
  const out = path.join(dir, S.out || 'window.png');
  return svg.png(g.svg(), out, S.w, S.h, S.scale || 2).then(() => console.log(out));
}
// Two bars of eighths, up a scale and back, for a clip
picture.TUNE = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72, 71, 67, 65, 64]
  .map((p, i) => ({ pitch: p, start_time: i * 0.5, duration: 0.5, velocity: 100 }));
// A melody in Eb minor from beat 4, as Live hands it to a Transform tool.
picture.MELODY = [[63, 4, 0.5], [65, 4.5, 0.5], [66, 5, 1], [70, 6, 1], [68, 7, 0.5], [66, 7.5, 0.5], [65, 8, 1], [63, 9, 3]]
  .map(([p, s, d]) => ({ pitch: p, start_time: s, duration: d, velocity: 100 }));
// The context of a clip in Eb minor with beats 4 to 12 selected.
picture.EB_MINOR = { clip: { time_selection_start: 4, time_selection_end: 12 }, grid: { interval: 0.25, enabled: 1 }, seed: 1234,
                     scale: { scale_mode: 1, root_note: 3, scale_name: 'Minor', scale_intervals: [0, 2, 3, 5, 7, 8, 10] } };
// A stereo sound in a buffer, from a function of the sample number
picture.sound = function (fn, n, rate) {
  const L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) L[i] = R[i] = fn(i);
  return { chans: [L, R], rate: rate || 48000 };
};
module.exports = picture;
