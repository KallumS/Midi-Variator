// The picture in the README: `node ableton/tool/window.js` redraws ableton/tool/window.png.
// The tool in Live's Transform panel, after Transform on a melody in E flat minor.
const P = require('../kit/test/picture.js');
P(__dirname, { bundle: 'MidiVariatorTool.js', w: 152, h: 147, apply: { notes: P.MELODY, context: P.EB_MINOR } });
