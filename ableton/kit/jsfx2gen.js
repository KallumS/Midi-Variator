/* A family JSFX's DSP as gen~ code (GenExpr), for Max for Live: the audio
 * thread is gen~'s, and Max's JavaScript cannot run there.
 *
 *   const G = require('./jsfx2gen.js');
 *   const out = G.translate(jsfxText, { readImport, memory, block });
 *   out.code     the codebox's GenExpr
 *   out.params   [{ name, index, def, min, max }] one Param per slider
 *
 * The same parser as Middaw's runtime (runtime/jsfx.js) and the same rules
 * as its compiler: every EEL2 variable lives in Data V (sliders first, at
 * their index - 1, so slider(i) is V[i - 1], however many there are), EEL2 memory is Data M, and a
 * function called as ns.f() keeps its instance variables in ns. GenExpr has
 * no expressions with effects, so every effect becomes a statement, in
 * JavaScript's order, and every value a temporary (declared at the top, so a
 * block never hides one).
 *
 * Each sample: @init (with @slider) once, @slider again when a Param moves,
 * @block every `block` samples, then @sample between in1/in2 and out1/out2.
 * MIDI in comes from Buffer mq, which the device's window fills (see
 * jsfx_audio.js): [0] how many messages written, then three values a message
 * in a ring of MQ_CAP. Strings and files are not on the audio thread: their
 * functions do nothing and give 0.
 *
 * The tests run this very text as JavaScript (test/genexpr.js) beside the
 * runtime and compare every sample. */
'use strict';
(function (G) {
  var J = typeof MiddawJSFX !== 'undefined' ? MiddawJSFX : require('./runtime/jsfx.js');
  var EPS = 0.00001, MAXLOOP = 1048576, MQ_CAP = 256;

  var MATH = { sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', atan2: 'atan2',
               exp: 'exp', log: 'log', log10: 'log10', abs: 'abs', floor: 'floor', ceil: 'ceil', min: 'min', max: 'max' };
  var NOTHING = { strcpy: 1, strcat: 1, strncpy: 1, strcpy_substr: 1, sprintf: 1, str_setchar: 1, str_getchar: 0, strlen: 0,
                  strcmp: 0, stricmp: 0, sliderchange: 1, slider_automate: 1, slider_show: 1, freembuf: 1, printf: 1,
                  file_open: 0, file_close: 0, file_rewind: 0, file_avail: 0, file_riff: 0, file_text: 0, file_mem: 0,
                  file_string: 0, file_var: 1, export_buffer_to_project: 0, get_host_placement: 0, set_pdc: 0,
                  match: 0, matchi: 0, midisend: 1, midisend_buf: 1, midisyx: 1, gfx_getchar: 0, time: 0, time_precise: 0 };

  function num(v) {
    if (v !== v) return '0';
    if (!isFinite(v)) return v < 0 ? '-1e300' : '1e300';
    var s = String(v);
    if (/e/.test(s)) s = v.toExponential();
    return v < 0 ? '(' + s + ')' : s;
  }

  function Compiler(file, opts) {
    this.file = file;
    this.opts = opts || {};
    this.funcs = {};
    this.slots = {};
    this.nsliders = Math.max(64, file.sliders.reduce(function (m, sl) { return Math.max(m, sl.index); }, 0));
    this.count = this.nsliders;
    this.temps = 0;
    this.out = [];
    this.indent = 1;
    this.inlining = [];
    this.done = {};
    this.functions = [];
    var self = this;
    file.sliders.forEach(function (sl) { self.slots[sl.variable] = sl.index - 1; });
    for (var i = 1; i <= this.nsliders; i++) if (this.slots['slider' + i] === undefined) this.slots['slider' + i] = i - 1;
  }
  Compiler.prototype.slot = function (name) {
    var s = this.slots[name];
    if (s === undefined) { s = this.slots[name] = this.count++; }
    return s;
  };
  Compiler.prototype.temp = function () { this.temps++; return 't' + this.temps; };
  Compiler.prototype.emit = function (line) { this.out.push(new Array(this.indent + 1).join('  ') + line); };
  Compiler.prototype.block = function (head, body) {
    this.emit(head + ' {');
    this.indent++;
    body.call(this);
    this.indent--;
    this.emit('}');
  };
  Compiler.prototype.rd = function (k) { return 'peek(V, ' + k + ')'; };
  Compiler.prototype.wr = function (k, x) { this.emit('poke(V, ' + x + ', ' + k + ');'); };
  // A value worth keeping: into a temporary unless it is a number already.
  Compiler.prototype.keep = function (e) {
    if (/^\(?-?[\d.e+]+\)?$/.test(e) || /^t\d+$/.test(e)) return e;
    var t = this.temp();
    this.emit(t + ' = ' + e + ';');
    return t;
  };
  function T(e) { return '(abs(' + e + ') >= ' + EPS + ')'; }

  // ------------------------------------------------------- variables ---
  function resolveThis(name, ctx) {
    var ns = ctx && ctx.ns ? ctx.ns : '';
    if (name === 'this') return ns;
    return ns ? ns + '.' + name.slice(5) : name.slice(5);
  }
  // A variable's place: a parameter of the function being inlined is a
  // temporary; a local() is the function's own slot; an instance() is the
  // namespace's; this.x is the caller's namespace's.
  Compiler.prototype.ref = function (name, ctx) {
    if (ctx) {
      var pi = ctx.fn.params.indexOf(name);
      if (pi >= 0) return { temp: ctx.args[pi] };
      if (ctx.fn.locals.indexOf(name) >= 0) return { slot: this.slot(ctx.fn.name + '::' + name) };
      if (ctx.fn.instance.indexOf(name) >= 0) return { slot: this.slot(ctx.ns ? ctx.ns + '.' + name : name) };
    }
    if (name.indexOf('this.') === 0) return { slot: this.slot(resolveThis(name, ctx)) };
    return { slot: this.slot(name) };
  };
  Compiler.prototype.read = function (name, ctx) {
    var r = this.ref(name, ctx);
    return r.temp ? r.temp : this.rd(r.slot);
  };
  Compiler.prototype.write = function (name, ctx, x) {
    var r = this.ref(name, ctx);
    if (r.temp) this.emit(r.temp + ' = ' + x + ';');
    else this.wr(r.slot, x);
  };

  // Whether evaluating n may change what another operand reads.
  function impure(n) {
    if (!n) return false;
    switch (n.k) {
      case 'num': case 'strlit': case 'nstr': case 'tmpstr': case 'var': case 'raw': return false;
      case 'seq': return n.items.some(impure);
      case 'if': return impure(n.c) || impure(n.a) || impure(n.b);
      case 'logic': case 'bin': return impure(n.a) || impure(n.b);
      case 'un': return impure(n.a);
      case 'index': return impure(n.base) || impure(n.idx);
      case 'call': return !(MATH[n.name] || n.name === 'sqrt' || n.name === 'sqr' || n.name === 'sign' || n.name === 'invsqrt' ||
                            n.name === 'pow' || n.name === 'exp2' || n.name === 'slider') || n.args.some(impure);
    }
    return true;
  }

  // ------------------------------------------------------- statements ---
  // n run for its effect; its value, when wanted, into `target`.
  Compiler.prototype.stmt = function (n, ctx, target) {
    var self = this;
    if (n.k === 'seq') {
      if (!n.items.length) { if (target) this.emit(target + ' = 0;'); return; }
      n.items.forEach(function (x, i) { self.stmt(x, ctx, i === n.items.length - 1 ? target : null); });
      return;
    }
    if (n.k === 'if') {
      var c = this.expr(n.c, ctx);
      this.block('if (' + T(c) + ')', function () { this.stmt(n.a, ctx, target); });
      if (n.b) this.block('else', function () { this.stmt(n.b, ctx, target); });
      else if (target) this.block('else', function () { this.emit(target + ' = 0;'); });
      return;
    }
    if (n.k === 'call' && n.name === 'loop') {
      var cnt = this.keep('min(' + MAXLOOP + ', trunc(' + this.expr(n.args[0], ctx) + '))'), ii = this.temp();
      if (target) this.emit(target + ' = 0;');
      this.block('for (' + ii + ' = 0; ' + ii + ' < ' + cnt + '; ' + ii + ' += 1)', function () {
        if (n.args[1]) this.stmt(n.args[1], ctx, target);
      });
      return;
    }
    if (n.k === 'call' && n.name === 'while') {
      var guard = this.temp();
      this.emit(guard + ' = 0;');
      if (target) this.emit(target + ' = 0;');
      if (n.args.length >= 2) {
        this.block('while (' + guard + ' < ' + MAXLOOP + ')', function () {
          var c2 = this.expr(n.args[0], ctx);
          this.block('if (!' + T(c2) + ')', function () { this.emit('break;'); });
          this.stmt(n.args[1], ctx, target);
          this.emit(guard + ' += 1;');
        });
      } else {
        var r = this.temp();
        this.block('while (' + guard + ' < ' + MAXLOOP + ')', function () {
          this.stmt(n.args[0], ctx, r);
          if (target) this.emit(target + ' = ' + r + ';');
          this.emit(guard + ' += 1;');
          this.block('if (!' + T(r) + ')', function () { this.emit('break;'); });
        });
      }
      return;
    }
    var e = this.expr(n, ctx);
    if (target) this.emit(target + ' = ' + e + ';');
    else if (!/^(t\d+|\(?-?[\d.e+]+\)?|peek\(V, \d+\))$/.test(e)) { var t = this.temp(); this.emit(t + ' = ' + e + ';'); }
  };

  // ------------------------------------------------------- expressions --
  // A GenExpr expression with no effects; effects are emitted before it.
  Compiler.prototype.expr = function (n, ctx) {
    var self = this;
    switch (n.k) {
      case 'raw': return n.code;
      case 'num': return num(n.v);
      case 'strlit': case 'nstr': case 'tmpstr': return '0';
      case 'var': return this.read(n.name, ctx);
      case 'seq': case 'if': {
        if (n.k === 'if' && !impure(n.a) && !impure(n.b) && !hasControl(n)) {
          var c = this.expr(n.c, ctx);
          return '(' + T(c) + ' ? ' + this.expr(n.a, ctx) + ' : ' + (n.b ? this.expr(n.b, ctx) : '0') + ')';
        }
        var t = this.temp();
        this.stmt(n, ctx, t);
        return t;
      }
      case 'logic': {
        var a = this.expr(n.a, ctx);
        if (!impure(n.b)) {
          var b = this.expr(n.b, ctx);
          return '((' + T(a) + (n.op === '&&' ? ' && ' : ' || ') + T(b) + ') ? 1 : 0)';
        }
        var r = this.temp();
        this.emit(r + ' = ' + T(a) + ' ? 1 : 0;');
        this.block(n.op === '&&' ? 'if (' + r + ' != 0)' : 'if (' + r + ' == 0)', function () {
          var b2 = this.expr(n.b, ctx);
          this.emit(r + ' = ' + T(b2) + ' ? 1 : 0;');
        });
        return r;
      }
      case 'un': {
        var x = this.expr(n.a, ctx);
        if (n.op === '!') return '(' + T(x) + ' ? 0 : 1)';
        if (n.op === '-') return '(-' + x + ')';
        return x;
      }
      case 'bin': {
        var l = this.expr(n.a, ctx);
        if (impure(n.b)) l = this.keep(l);
        var rr = this.expr(n.b, ctx);
        return this.binary(n.op, l, rr);
      }
      case 'index': return 'peek(M, ' + this.address(n, ctx) + ')';
      case 'assign': return this.assignment(n, ctx);
      case 'call': return this.call(n, ctx);
    }
    throw new Error('cannot translate ' + n.k);
  };
  function hasControl(n) {
    if (!n || typeof n !== 'object') return false;
    if (n.k === 'call' && (n.name === 'loop' || n.name === 'while')) return true;
    for (var key in n) {
      var c = n[key];
      if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) if (hasControl(c[i])) return true; }
      else if (c && typeof c === 'object' && c.k && hasControl(c)) return true;
    }
    return false;
  }

  Compiler.prototype.binary = function (op, a, b) {
    switch (op) {
      case '+': case '-': case '*': case '/': return '(' + a + ' ' + op + ' ' + b + ')';
      case '%': return 'eel_mod(' + a + ', ' + b + ')';
      case '^': return 'pow(' + a + ', ' + b + ')';
      case '<<': return 'eel_shl(' + a + ', ' + b + ')';
      case '>>': return 'eel_shr(' + a + ', ' + b + ')';
      case '|': return 'eel_bor(' + a + ', ' + b + ')';
      case '&': return 'eel_band(' + a + ', ' + b + ')';
      case '~': return 'eel_bxor(' + a + ', ' + b + ')';
      case '==': return '(abs(' + a + ' - ' + b + ') < ' + EPS + ' ? 1 : 0)';
      case '!=': return '(abs(' + a + ' - ' + b + ') < ' + EPS + ' ? 0 : 1)';
      case '===': return '(' + a + ' == ' + b + ' ? 1 : 0)';
      case '!==': return '(' + a + ' != ' + b + ' ? 1 : 0)';
      case '<': case '>': case '<=': case '>=': return '(' + a + ' ' + op + ' ' + b + ' ? 1 : 0)';
    }
    throw new Error('bad operator ' + op);
  };

  // EEL2's address: base + index, truncated after a nudge, as the runtime does.
  Compiler.prototype.address = function (n, ctx) {
    if (n.base.k === 'var' && n.base.name === 'gmem') throw new Error('gmem is not available on the audio thread');
    var base = this.expr(n.base, ctx);
    if (n.idx.k === 'num' && n.idx.v === 0) return 'trunc(' + base + ' + ' + EPS + ')';
    if (impure(n.idx)) base = this.keep(base);
    var idx = this.expr(n.idx, ctx);
    return 'trunc(' + base + ' + ' + idx + ' + ' + EPS + ')';
  };

  Compiler.prototype.assignment = function (n, ctx) {
    var lhs = n.lhs, self = this;
    var COMP = { '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%', '^=': '^', '|=': '|', '&=': '&', '~=': '~', '<<=': '<<', '>>=': '>>' };
    if (lhs.k === 'var') {
      var v = this.keep(this.expr(n.rhs, ctx));
      var val = n.op === '=' ? v : this.keep(this.binary(COMP[n.op], this.read(lhs.name, ctx), v));
      this.write(lhs.name, ctx, val);
      return val;
    }
    if (lhs.k === 'index') {
      var at = this.keep(this.address(lhs, ctx));
      var x = this.keep(this.expr(n.rhs, ctx));
      var w = n.op === '=' ? x : this.keep(this.binary(COMP[n.op], 'peek(M, ' + at + ')', x));
      this.emit('poke(M, ' + w + ', ' + at + ');');
      return w;
    }
    if (lhs.k === 'call' && lhs.name === 'slider') {
      var si = this.keep(this.expr(lhs.args[0], ctx));
      var sx = this.keep(this.expr(n.rhs, ctx));
      var sk = 'clamp(trunc(' + si + ') - 1, 0, ' + (this.nsliders - 1) + ')';
      var sv = n.op === '=' ? sx : this.keep(this.binary(COMP[n.op], 'peek(V, ' + sk + ')', sx));
      this.emit('poke(V, ' + sv + ', ' + sk + ');');
      return sv;
    }
    if (lhs.k === 'if') {
      if (n.op !== '=') throw new Error('compound assignment to a conditional is not supported');
      var tv = this.keep(this.expr(n.rhs, ctx));
      var cc = this.expr(lhs.c, ctx);
      this.block('if (' + T(cc) + ')', function () { if (lhs.a) this.assignment({ k: 'assign', op: '=', lhs: lhs.a, rhs: { k: 'raw', code: tv } }, ctx); });
      if (lhs.b) this.block('else', function () { this.assignment({ k: 'assign', op: '=', lhs: lhs.b, rhs: { k: 'raw', code: tv } }, ctx); });
      return tv;
    }
    if (lhs.k === 'seq' && lhs.items.length) {
      lhs.items.slice(0, -1).forEach(function (x) { self.stmt(x, ctx, null); });
      return this.assignment({ k: 'assign', op: n.op, lhs: lhs.items[lhs.items.length - 1], rhs: n.rhs }, ctx);
    }
    if (lhs.k === 'nstr' || lhs.k === 'strlit') { this.stmt(n.rhs, ctx, null); return '0'; }
    throw new Error('cannot assign to ' + lhs.k);
  };

  // --------------------------------------------------------------- calls --
  Compiler.prototype.call = function (n, ctx) {
    var self = this, name = n.name, args = n.args;
    function A(i) { return args[i] === undefined ? '0' : self.expr(args[i], ctx); }
    // Operands in order: kept in temporaries when a later one has an effect.
    function all() {
      var out = [];
      args.forEach(function (x, i) {
        var e = self.expr(x, ctx);
        if (args.slice(i + 1).some(impure)) e = self.keep(e);
        out.push(e);
      });
      return out;
    }
    if (MATH[name]) {
      var m = all();
      if (name === 'min' || name === 'max' || name === 'atan2') return MATH[name] + '(' + (m[0] || '0') + ', ' + (m[1] || '0') + ')';
      return MATH[name] + '(' + (m[0] || '0') + ')';
    }
    switch (name) {
      case 'sqrt': return 'sqrt(abs(' + A(0) + '))';
      case 'sqr': { var s = this.keep(A(0)); return '(' + s + ' * ' + s + ')'; }
      case 'sign': { var g = this.keep(A(0)); return '(' + g + ' > 0 ? 1 : (' + g + ' < 0 ? -1 : 0))'; }
      case 'invsqrt': return '(1 / sqrt(' + A(0) + '))';
      case 'pow': { var p = all(); return 'pow(' + p[0] + ', ' + p[1] + ')'; }
      case 'exp2': return 'pow(2, ' + A(0) + ')';
      case 'rand': {
        // A Park-Miller generator in V, so two calls in one sample differ (gen~'s noise() takes no seed)
        var rx = args.length ? this.keep(A(0)) : '1', rs = this.slot('$rnd');
        this.emit('poke(V, peek(V, ' + rs + ') * 16807 - 2147483647 * floor(peek(V, ' + rs + ') * 16807 / 2147483647), ' + rs + ');');
        return '(peek(V, ' + rs + ') / 2147483647 * ' + rx + ')';
      }
      case 'loop': case 'while': { var t = this.temp(); this.stmt(n, ctx, t); return t; }
      case 'slider': return 'peek(V, clamp(trunc(' + A(0) + ') - 1, 0, ' + (this.nsliders - 1) + '))';
      case 'memset': {
        var ms = all(), md = this.keep(ms[0]), mv = this.keep(ms[1]), mn = this.keep('min(trunc(' + ms[2] + '), 8388608)'), mi = this.temp();
        this.block('for (' + mi + ' = 0; ' + mi + ' < ' + mn + '; ' + mi + ' += 1)', function () { this.emit('poke(M, ' + mv + ', trunc(' + md + ' + ' + mi + ' + ' + EPS + '));'); });
        return md;
      }
      case 'memcpy': {
        var mc = all(), dd = this.keep(mc[0]), ss = this.keep(mc[1]), nn = this.keep('min(trunc(' + mc[2] + '), 8388608)'), k = this.temp();
        // overlapping copies go the safe way round, as memmove does
        this.block('if (' + dd + ' <= ' + ss + ')', function () {
          this.block('for (' + k + ' = 0; ' + k + ' < ' + nn + '; ' + k + ' += 1)', function () {
            this.emit('poke(M, peek(M, trunc(' + ss + ' + ' + k + ' + ' + EPS + ')), trunc(' + dd + ' + ' + k + ' + ' + EPS + '));');
          });
        });
        this.block('else', function () {
          this.block('for (' + k + ' = ' + nn + ' - 1; ' + k + ' >= 0; ' + k + ' -= 1)', function () {
            this.emit('poke(M, peek(M, trunc(' + ss + ' + ' + k + ' + ' + EPS + ')), trunc(' + dd + ' + ' + k + ' + ' + EPS + '));');
          });
        });
        return dd;
      }
      case 'midirecv': {
        // midirecv(ofs, m1, m2, m3) or midirecv(ofs, m1, m23): the next message from Buffer mq
        var got = this.temp();
        this.emit(got + ' = 0;');
        var outs = args.map(function (x) { return x && x.k === 'var' ? x : null; });
        this.block('if (peek(V, ' + this.slot('$mq_read') + ') < peek(mq, 0))', function () {
          var base = this.keep('1 + 3 * eel_mod(peek(V, ' + this.slot('$mq_read') + '), ' + MQ_CAP + ')');
          var b1 = this.keep('peek(mq, ' + base + ')'), b2 = this.keep('peek(mq, ' + base + ' + 1)'), b3 = this.keep('peek(mq, ' + base + ' + 2)');
          this.wr(this.slot('$mq_read'), 'peek(V, ' + this.slot('$mq_read') + ') + 1');
          if (outs[0]) this.write(outs[0].name, ctx, '0');
          if (outs[1]) this.write(outs[1].name, ctx, b1);
          if (args.length >= 4) { if (outs[2]) this.write(outs[2].name, ctx, b2); if (outs[3]) this.write(outs[3].name, ctx, b3); }
          else if (outs[2]) this.write(outs[2].name, ctx, '(' + b2 + ' + ' + b3 + ' * 256)');
          this.emit(got + ' = ' + b1 + ';');
        });
        return got;
      }
    }
    if (this.funcs[name]) return this.inline(this.funcs[name], args, ctx, '');
    if (name.indexOf('.') > 0) {
      var base2 = name.slice(name.lastIndexOf('.') + 1), prefix = name.slice(0, name.lastIndexOf('.'));
      if (this.funcs[base2]) return this.inline(this.funcs[base2], args, ctx, prefix === 'this' || prefix.indexOf('this.') === 0 ? resolveThis(prefix, ctx) : prefix);
    }
    if (NOTHING[name] !== undefined) { args.forEach(function (x) { if (impure(x)) self.stmt(x, ctx, null); }); return NOTHING[name] && args.length ? '0' : '0'; }
    if (/^gfx_|^mouse_/.test(name)) return '0';
    throw new Error(name + '() has no gen~ translation');
  };

  // A user function as a GenExpr function, one per namespace as EEL2 keeps
  // them (a.f() and b.f() have their own instance variables). V, M and mq
  // go in as arguments: a GenExpr function sees nothing else. A callee is
  // written before its caller.
  Compiler.prototype.inline = function (fn, args, ctx, ns) {
    if (args.length !== fn.params.length && !(args.length === 1 && fn.params.length === 0)) {
      throw new Error(fn.name + '() takes ' + fn.params.length + ' arguments, given ' + args.length);
    }
    ns = ns || '';
    var gname = 'f_' + (fn.name + (ns ? '__' + ns : '')).replace(/[^A-Za-z0-9_]/g, function (c) { return c === '.' ? '_' : '_' + c.charCodeAt(0).toString(16); });
    if (!this.done[gname]) {
      this.done[gname] = true;
      if (this.inlining.indexOf(gname) >= 0) throw new Error(fn.name + '() calls itself');
      var saved = { out: this.out, indent: this.indent, temps: this.temps };
      this.out = []; this.indent = 1; this.temps = 0;
      this.inlining.push(gname);
      var params = fn.params.map(function (_, i) { return 'p' + i; });
      this.stmt(fn.body, { fn: fn, ns: ns, args: params }, 'r');
      this.inlining.pop();
      var temps = [];
      for (var k = 1; k <= this.temps; k++) temps.push('t' + k + ' = 0;');
      var text = gname + '(' + ['V', 'M', 'mq'].concat(params).join(', ') + ') {\n' +
        (temps.length ? '  ' + temps.join(' ') + '\n' : '') + '  r = 0;\n' + this.out.join('\n') + '\n  return r;\n}';
      this.functions.push(text);
      this.out = saved.out; this.indent = saved.indent; this.temps = saved.temps;
    }
    var self = this, vals = [];
    args.slice(0, fn.params.length).forEach(function (x, i) {
      var e = self.expr(x, ctx);
      if (args.slice(i + 1).some(impure)) e = self.keep(e);
      vals.push(e);
    });
    if (fn.params.length === 0 && args.length === 1 && impure(args[0])) this.stmt(args[0], ctx, null);
    var t = this.temp();
    this.emit(t + ' = ' + gname + '(' + ['V', 'M', 'mq'].concat(vals).join(', ') + ');');
    return t;
  };

  // ------------------------------------------------------------ program --
  Compiler.prototype.section = function (name) {
    var self = this;
    this.file.sections[name].forEach(function (part) {
      var ast = J.parseEel(J.lexEel(part.code, part.line), self.funcs);
      self.stmt(ast, null, null);
    });
  };

  function translate(text, opts) {
    opts = opts || {};
    var file = J.parseFile(text, opts.readImport);
    var C = new Compiler(file, opts);
    var block = opts.block || 32;
    // every section is parsed first, so a function defined in a later one is known
    ['init', 'slider', 'block', 'sample', 'serialize', 'gfx'].forEach(function (s) {
      file.sections[s].forEach(function (part) { try { J.parseEel(J.lexEel(part.code, part.line), C.funcs); } catch (e) { if (s !== 'gfx') throw e; } });
    });
    var S = function (n) { return C.slot('$' + n); };
    var inPins = Math.max(file.inPins.length, 0), outPins = Math.max(file.outPins.length, 2);

    C.emit('// @init and @slider, once');
    C.block('if (peek(V, ' + S('ready') + ') == 0)', function () {
      file.sliders.forEach(function (sl) { C.wr(sl.index - 1, 'slider' + sl.index); C.wr(S('p' + sl.index), 'slider' + sl.index); });
      C.wr(C.slot('$rnd'), '22222');
      C.wr(C.slot('srate'), 'samplerate');
      C.wr(C.slot('num_ch'), String(Math.max(inPins, outPins)));
      C.wr(C.slot('samplesblock'), String(block));
      C.wr(C.slot('tempo'), 'tempo'); C.wr(C.slot('ts_num'), 'ts_num'); C.wr(C.slot('ts_denom'), 'ts_denom');
      C.section('init');
      C.section('slider');
      C.wr(S('ready'), '1');
    });
    C.emit('// a moved slider runs @slider');
    C.emit('moved = 0;');
    file.sliders.forEach(function (sl) {
      C.block('if (slider' + sl.index + ' != peek(V, ' + S('p' + sl.index) + '))', function () {
        C.wr(S('p' + sl.index), 'slider' + sl.index);
        C.wr(sl.index - 1, 'slider' + sl.index);
        C.emit('moved = 1;');
      });
    });
    C.block('if (moved != 0)', function () { C.section('slider'); });
    C.emit('// @block, every ' + block + ' samples');
    C.block('if (peek(V, ' + S('clock') + ') <= 0)', function () {
      C.wr(S('clock'), String(block));
      // what the window set (opts.fromWindow), as @block would have seen it there
      (opts.fromWindow || []).forEach(function (n) { C.wr(C.slot(n), 'w_' + n); });
      C.wr(C.slot('tempo'), 'tempo'); C.wr(C.slot('play_state'), 'play_state'); C.wr(C.slot('beat_position'), 'beat_position');
      C.wr(C.slot('play_position'), 'beat_position * 60 / max(1, tempo)');
      C.wr(C.slot('ts_num'), 'ts_num'); C.wr(C.slot('ts_denom'), 'ts_denom');
      C.section('block');
    });
    C.wr(S('clock'), 'peek(V, ' + S('clock') + ') - 1');
    C.emit('// @sample');
    for (var i = 0; i < Math.max(inPins, outPins); i++) C.wr(C.slot('spl' + i), i < inPins ? 'in' + (i + 1) : '0');
    C.section('sample');
    if (!inPins) C.emit('keep = in1 * 0;   // gen~ keeps its left inlet for messages');
    var body = C.out.join('\n');

    var head = [];
    head.push('// ' + (file.desc || 'JSFX') + ' - translated by ableton/kit/jsfx2gen.js. Do not edit; rebuild.');
    head.push('Data V(' + C.count + ');');
    // memory: 'buffer' puts EEL2's memory in a buffer~ (Buffer M) the window can write
    head.push(opts.memory === 'buffer' ? 'Buffer M;' : 'Data M(' + (opts.memory || 1048576) + ');');
    (opts.fromWindow || []).forEach(function (n) { head.push('Param w_' + n + '(0);'); });
    head.push(/\bpeek\(mq,/.test(body + C.functions.join('')) ? 'Buffer mq;' : 'Data mq(1);');
    file.sliders.forEach(function (sl) {
      head.push('Param slider' + sl.index + '(' + num(sl.def) + ', min=' + num(Math.min(sl.min, sl.max)) + ', max=' + num(Math.max(sl.min, sl.max)) + ');');
    });
    head.push('Param tempo(120, min=1, max=999);');
    head.push('Param play_state(0, min=0, max=8);');
    head.push('Param beat_position(0);');
    head.push('Param ts_num(4, min=1, max=64);');
    head.push('Param ts_denom(4, min=1, max=64);');
    head.push('');
    head.push('eel_mod(a, b) { ib = trunc(abs(b)); return ib >= 1 ? trunc(abs(a)) - ib * floor(trunc(abs(a)) / ib) : 0; }');
    head.push('eel_bor(a, b) { return bitor(trunc(a), trunc(b)); }');
    head.push('eel_band(a, b) { return bitand(trunc(a), trunc(b)); }');
    head.push('eel_bxor(a, b) { return bitxor(trunc(a), trunc(b)); }');
    head.push('eel_shl(a, b) { return trunc(a) * pow(2, trunc(b)); }');
    head.push('eel_shr(a, b) { return floor(trunc(a) / pow(2, trunc(b))); }');
    head.push('');
    head.push(C.functions.join('\n\n'));
    head.push('');
    var temps = [];
    for (var k = 1; k <= C.temps; k++) temps.push('t' + k);
    var decl = [];
    for (var j = 0; j < temps.length; j += 16) decl.push('  ' + temps.slice(j, j + 16).map(function (t) { return t + ' = 0;'; }).join(' '));
    head.push('// every sample');
    var code = head.join('\n') + '\n' + decl.join('\n') + '\n  moved = 0;\n' + body + '\n' +
      (function () {
        var o = [];
        for (var q = 0; q < outPins; q++) o.push('out' + (q + 1) + ' = peek(V, ' + C.slot('spl' + q) + ');');
        return o.join('\n');
      })() + '\n';
    return {
      code: code,
      params: file.sliders.map(function (sl) { return { name: 'slider' + sl.index, index: sl.index, def: sl.def, min: sl.min, max: sl.max }; }),
      slots: C.slots, desc: file.desc, inputs: inPins, outputs: outPins, temps: C.temps, lines: C.out.length
    };
  }

  G.translate = translate;
  // node jsfx2gen.js main.jsfx [memory] [block]: the GenExpr, then a line of JSON about it, for build.py
  if (typeof require !== 'undefined' && typeof module === 'object' && require.main === module) {
    var fs = require('fs'), path = require('path'), f = process.argv[2];
    var r = translate(fs.readFileSync(f, 'utf8'), {
      readImport: function (n) { return fs.readFileSync(path.join(path.dirname(f), n), 'utf8'); },
      memory: process.argv[3] === 'buffer' ? 'buffer' : Number(process.argv[3]) || undefined, block: Number(process.argv[4]) || undefined,
      fromWindow: process.argv[5] ? process.argv[5].split(',') : undefined });
    process.stdout.write(JSON.stringify({ code: r.code, params: r.params, inputs: r.inputs, outputs: r.outputs }));
  }
  G.MQ_CAP = MQ_CAP;
  if (typeof module === 'object' && module.exports) module.exports = G;
})(typeof module === 'object' && module.exports ? {} : (this.Jsfx2Gen = {}));
