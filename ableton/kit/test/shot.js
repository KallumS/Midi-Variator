/* A picture of a device, drawn by its own code on a pretend Max.
 *   node ableton/kit/test/shot.js ableton/Bundle.js WIDTH HEIGHT out.png [ms] [scale]
 * scale 2 (the default) draws it as a Retina screen would. */
'use strict';
const { load } = require('./max.js');
const svg = require('./svg.js');
const [bundle, w, h, file, ms, scale] = process.argv.slice(2);
const g = svg.graphics(+w, +h);
const d = load(bundle, { width: +w, height: +h, graphics: g });
d.send('bang');
d.run(+(ms || 500));
g.clear();
d.ctx.paint();
svg.png(g.svg(), file, +w, +h, +(scale || 2)).then(() => console.log(file));
