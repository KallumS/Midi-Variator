/* The Ableton palette (palette.js): every pair the devices draw keeps the
 * family's rules, and the house scheme's colours translate without losing them.
 *   require('../kit/test/palette_suite.js')()
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function palette() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'palette.js'), 'utf8') + '\nthis.Palette = Palette;', ctx);
  return ctx.Palette;
}
const hex = (n) => '#' + n.toString(16).padStart(6, '0').toUpperCase();

module.exports = function () {
  const P = palette(), C = P.C;
  const ratio = (a, b) => P.contrast(P.rgb(a), P.rgb(b));
  const toneHex = (h) => { const t = P.tone(...P.rgb(h).slice(0, 3)); return (Math.round(t[0] * 255) << 16) | (Math.round(t[1] * 255) << 8) | Math.round(t[2] * 255); };

  test('palette: every word is 7:1 on every surface it sits on', () => {
    for (const w of ['text', 'label', 'dim', 'warnText']) {
      for (const g of ['ground', 'sunken', 'popup', 'deep', 'ink']) {
        assert.ok(ratio(C[w], C[g]) >= 7, w + ' on ' + g + ' is ' + ratio(C[w], C[g]).toFixed(2) + ':1');
      }
    }
    for (const f of ['control', 'controlHover', 'controlHeld', 'accent', 'accentHeld']) {
      assert.ok(ratio(C.ink, C[f]) >= 7, 'ink on ' + f + ' is ' + ratio(C.ink, C[f]).toFixed(2) + ':1');
    }
  });

  test('palette: edges and marks are 3:1 on the chrome', () => {
    for (const m of ['edge', 'mark', 'accent', 'control', 'warn', 'note']) {
      assert.ok(ratio(C[m], C.ground) >= 3, m + ' is ' + ratio(C[m], C.ground).toFixed(2) + ':1');
    }
  });

  test('palette: the greys are neutral, as Live’s are; the accent is Live 8’s amber', () => {
    const coloured = { accent: 1, accentHeld: 1, warn: 1, warnText: 1, note: 1 };
    for (const k of Object.keys(C)) {
      if (coloured[k]) continue;
      const v = C[k];
      assert.ok(((v >> 16) & 255) === ((v >> 8) & 255) && ((v >> 8) & 255) === (v & 255), k + ' ' + hex(v) + ' is not a neutral grey');
    }
    assert.strictEqual(C.accent, 0xD7A93C);
  });

  test('palette: the house scheme translates one for one, and its yellow becomes the amber', () => {
    for (const [from, to] of Object.entries(P.HOUSE)) assert.strictEqual(toneHex(+from), to, hex(+from));
    assert.strictEqual(toneHex(0xFFF200), C.accent);
    // a shade a script makes of the yellow is the same shade of the amber
    const lighter = toneHex(0xFFF52E);
    assert.ok(lighter !== C.accent && P.luminance(...P.rgb(lighter).slice(0, 3)) > P.luminance(...P.rgb(C.accent).slice(0, 3)));
    // and it is amber, not yellow: red stands well above green, as in the amber
    assert.ok(((lighter >> 16) & 255) - ((lighter >> 8) & 255) >= 20, hex(lighter) + ' is still yellow');
    const darker = toneHex(0xB3A900);
    assert.ok(((darker >> 16) & 255) - ((darker >> 8) & 255) >= 20, hex(darker) + ' is still yellow');
  });

  test('palette: what was 7:1 in the house scheme is 7:1 after the translation', () => {
    const words = [0xDDE1E7, 0xB0B6C0, 0xBFC5CE, 0xFF9E96, 0xF2F4F7], grounds = [0x23272E, 0x1A1D23, 0x1B1F25, 0x111419];
    for (const w of words) for (const g of grounds) {
      if (ratio(w, g) < 7) continue;
      assert.ok(ratio(toneHex(w), toneHex(g)) >= 7, hex(w) + ' on ' + hex(g) + ' falls to ' + ratio(toneHex(w), toneHex(g)).toFixed(2));
    }
    for (const f of [0xA9AFBA, 0x8F96A2, 0xC0C6CF, 0xFFF200, 0xD1C600]) {
      if (ratio(0x14171C, f) < 7) continue;
      assert.ok(ratio(toneHex(0x14171C), toneHex(f)) >= 7, 'ink on ' + hex(f));
    }
  });

  test('palette: a grey of another palette keeps its brightness; a colour is left alone', () => {
    for (const g of [0x80879A, 0xCCD1DE, 0x30343C, 0x9AA0AA]) {
      const t = toneHex(g);
      const v = (t >> 16) & 255;
      assert.ok(v === ((t >> 8) & 255) && v === (t & 255), hex(g) + ' is not made neutral');
      const before = ratio(g, 0x000000), after = ratio(t, 0x000000);
      assert.ok(Math.abs(before - after) / before < 0.02, hex(g) + ' changed brightness');
    }
    for (const c of [0x3A86FF, 0xF29940, 0x8EE29A, 0xB88CF2]) assert.strictEqual(toneHex(c), c, hex(c));
  });
};
