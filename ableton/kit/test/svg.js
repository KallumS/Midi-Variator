/* mgraphics drawn to SVG, to look at what a device draws without Max.
 *   const svg = require('./svg.js'); const g = svg.graphics(w, h); ... g.svg() */
'use strict';
// Arial's advance widths in thousandths of an em, so a picture measures text
// as Max will (a flat guess put Midular's footer over its own status).
const ARIAL = { ' ': 278, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222,
  m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722,
  O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '.': 278, ',': 278, ':': 278, ';': 278, '-': 333, '(': 333, ')': 333, '/': 278, '%': 889, '\u00B7': 278, '\u2014': 1000,
  '\u2013': 556, "'": 191, '\u2019': 222, '\u201C': 333, '\u201D': 333, '"': 355, '!': 278, '?': 556, '#': 556, '+': 584,
  '=': 584, '<': 584, '>': 584, '\u00D7': 584, '\u2026': 1000, '\u2039': 333, '\u203A': 333, '[': 278, ']': 278, '&': 667 };
function width(s, font) {
  let t = 0;
  for (const ch of s) t += ARIAL[ch] !== undefined ? ARIAL[ch] : (/[0-9]/.test(ch) ? 556 : 600);
  return t / 1000 * font.size * (font.weight === 'bold' ? 1.06 : 1);
}

function graphics(w, h) {
  const out = [], path = [];
  let rgba = [0, 0, 0, 1], lw = 1, font = { name: 'Arial', slant: 'normal', weight: 'normal', size: 10 }, at = [0, 0];
  const col = () => 'rgba(' + Math.round(rgba[0] * 255) + ',' + Math.round(rgba[1] * 255) + ',' + Math.round(rgba[2] * 255) + ',' + rgba[3] + ')';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const g = {
    init() {}, redraw() {}, relative_coords: 0, autofill: 0,
    set_source_rgba(r, gg, b, a) { rgba = Array.isArray(r) ? r : [r, gg, b, a === undefined ? 1 : a]; },
    set_line_width(x) { lw = x; },
    select_font_face(name, slant, weight) { font = Object.assign({}, font, { name, slant: slant || 'normal', weight: weight || 'normal' }); },
    set_font_size(s) { font.size = s; },
    text_measure(s) { return [width(String(s), font), font.size * 1.2]; },
    move_to(x, y) { at = [x, y]; path.push('M' + x + ' ' + y); },
    line_to(x, y) { at = [x, y]; path.push('L' + x + ' ' + y); },
    close_path() { path.push('Z'); },
    rectangle(x, y, ww, hh) { path.push('M' + x + ' ' + y + 'h' + ww + 'v' + hh + 'h' + -ww + 'Z'); },
    rectangle_rounded(x, y, ww, hh, rx) { const r = Math.min(rx / 2, ww / 2, hh / 2);
      path.push('M' + (x + r) + ' ' + y + 'h' + (ww - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + r + 'v' + (hh - 2 * r) +
        'a' + r + ' ' + r + ' 0 0 1 ' + -r + ' ' + r + 'h' + -(ww - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + -r + ' ' + -r +
        'v' + -(hh - 2 * r) + 'a' + r + ' ' + r + ' 0 0 1 ' + r + ' ' + -r + 'Z'); },
    arc(x, y, r, a1, a2) {
      if (a2 - a1 >= Math.PI * 2 - 1e-6) { path.push('M' + (x + r) + ' ' + y + 'a' + r + ' ' + r + ' 0 1 1 ' + -2 * r + ' 0a' + r + ' ' + r + ' 0 1 1 ' + 2 * r + ' 0'); return; }
      const sx = x + r * Math.cos(a1), sy = y + r * Math.sin(a1), ex = x + r * Math.cos(a2), ey = y + r * Math.sin(a2);
      path.push('M' + sx + ' ' + sy + 'A' + r + ' ' + r + ' 0 ' + (a2 - a1 > Math.PI ? 1 : 0) + ' 1 ' + ex + ' ' + ey);
    },
    ellipse(x, y, ww, hh) { path.push('M' + (x + ww) + ' ' + (y + hh / 2) + 'a' + ww / 2 + ' ' + hh / 2 + ' 0 1 1 ' + -ww + ' 0a' + ww / 2 + ' ' + hh / 2 + ' 0 1 1 ' + ww + ' 0'); },
    fill() { out.push('<path d="' + path.join('') + '" fill="' + col() + '"/>'); path.length = 0; },
    fill_preserve() { out.push('<path d="' + path.join('') + '" fill="' + col() + '"/>'); },
    stroke() { out.push('<path d="' + path.join('') + '" fill="none" stroke="' + col() + '" stroke-width="' + lw + '"/>'); path.length = 0; },
    new_path() { path.length = 0; },
    show_text(s) { out.push('<text x="' + at[0] + '" y="' + at[1] + '" fill="' + col() + '" font-family="' + esc(font.name) + ', Arial" font-size="' + font.size +
      '" font-weight="' + font.weight + '" font-style="' + font.slant + '">' + esc(s) + '</text>'); },
    save() {}, restore() {}, translate() {}, scale() {}, curve_to() {}, rel_line_to() {}, set_line_cap() {}, set_line_join() {},
    svg() { return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + out.join('') + '</svg>'; },
    clear() { out.length = 0; }
  };
  return g;
}

// An SVG to a PNG, through the pre-installed Chromium (playwright).
// `scale` 2 draws it as a Retina screen would, for a picture people will look at.
async function png(svgText, file, w, h, scale) {
  const { chromium } = require('playwright');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale || 1 });
  await p.setContent('<body style="margin:0">' + svgText + '</body>');
  await p.screenshot({ path: file });
  await b.close();
}
module.exports = { graphics, png };
