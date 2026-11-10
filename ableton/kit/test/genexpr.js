/* The GenExpr jsfx2gen.js writes, run as JavaScript, sample by sample, so it
 * can be held to Middaw's EEL2 runtime without Max. Only the part of GenExpr
 * the translator writes is understood: Data, Buffer and Param declarations,
 * functions, if/else, for, while, break, peek/poke and gen's maths.
 *
 *   const g = load(code, { sampleRate, mq, buffers });   // Float64Arrays for Buffer mq and any other Buffer
 *   g.set('slider2', 50);  const [l, r] = g.step(inL, inR); */
'use strict';

function load(code, opts) {
  opts = opts || {};
  const SR = opts.sampleRate || 48000;
  const lines = code.split('\n');
  const decl = [], params = {}, funcs = [], main = [];
  let i = 0;
  // declarations
  for (; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^Data (\w+)\((\d+)\);$/.exec(l))) decl.push('var ' + m[1] + ' = new Float64Array(' + m[2] + ');');
    else if ((m = /^Buffer (\w+);$/.exec(l))) decl.push('var ' + m[1] + ' = __buffers[' + JSON.stringify(m[1]) + '] || new Float64Array(1);');
    else if ((m = /^Param (\w+)\(([^,)]+)/.exec(l))) { params[m[1]] = Number(m[2].replace(/[()]/g, '')); decl.push('var ' + m[1] + ' = ' + params[m[1]] + ';'); }
    else if (/^\/\/ every sample/.test(l)) { i++; break; }
    else if ((m = /^(\w+)\(([^)]*)\) \{(.*)$/.exec(l))) {
      // a function: to its closing brace at column 0, or on one line
      const name = m[1], args = m[2], body = [];
      if (/\}\s*$/.test(m[3])) body.push(m[3].replace(/\}\s*$/, ''));
      else { for (i++; i < lines.length && lines[i] !== '}'; i++) body.push(lines[i]); }
      funcs.push(fn(name, args, body.join('\n')));
    }
  }
  for (; i < lines.length; i++) main.push(lines[i]);
  function locals(body, args) {
    const seen = new Set(), skip = new Set(args.concat(['V', 'M', 'mq']));
    body.replace(/(^|[^\w.=!<>])([A-Za-z_]\w*)\s*(=(?!=)|\+=|-=)/g, (all, pre, name) => { if (!skip.has(name)) seen.add(name); });
    return seen.size ? 'var ' + [...seen].join(', ') + ';\n' : '';
  }
  function fn(name, args, body) {
    const a = args.split(',').map((s) => s.trim()).filter(Boolean);
    return 'function ' + name + '(' + a.join(', ') + ') {\n' + locals(body, a) + body + '\n}';
  }
  const outs = main.join('\n');
  const outNames = (outs.match(/\bout\d+\b/g) || []).filter((v, k, s) => s.indexOf(v) === k);
  const src = [
    '"use strict";',
    'var samplerate = ' + SR + ';',
    'function peek(d, i) { i = Math.trunc(i); return i >= 0 && i < d.length ? d[i] : 0; }',
    'function poke(d, v, i) { i = Math.trunc(i); if (i >= 0 && i < d.length) d[i] = v; }',
    'var trunc = Math.trunc, abs = Math.abs, floor = Math.floor, ceil = Math.ceil, sqrt = Math.sqrt, pow = Math.pow,',
    '    exp = Math.exp, log = Math.log, log10 = Math.log10, sin = Math.sin, cos = Math.cos, tan = Math.tan,',
    '    asin = Math.asin, acos = Math.acos, atan = Math.atan, atan2 = Math.atan2, min = Math.min, max = Math.max;',
    'function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }',
    'function bitor(a, b) { return a | b; } function bitand(a, b) { return a & b; } function bitxor(a, b) { return a ^ b; }',
    decl.join('\n'),
    funcs.join('\n\n'),
    'function step(in1, in2) {',
    locals(outs, ['in1', 'in2']),
    outs,
    'return [' + outNames.join(', ') + '];',
    '}',
    'function set(name, v) { switch (name) {' + Object.keys(params).map((p) => ' case ' + JSON.stringify(p) + ': ' + p + ' = v; break;').join('') + ' } }',
    'return { step: step, set: set, V: V, M: M };'
  ].join('\n');
  const buffers = Object.assign({ mq: opts.mq || new Float64Array(1024) }, opts.buffers || {});
  try { return new Function('__buffers', src)(buffers); }
  catch (e) { e.message += ' (in the GenExpr as JavaScript)'; throw e; }
}

module.exports = { load };
