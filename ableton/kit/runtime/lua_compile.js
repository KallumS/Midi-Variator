/* Middaw's Lua 5.4, part 2 of 3: syntax tree in, JavaScript out.
 *
 * Every Lua local becomes a JS `let` with a name of its own ($x, $x$2...), so
 * shadowing and closures behave as in Lua: a fresh binding per declaration,
 * and per loop iteration. Every operator goes through the runtime, so the
 * integer/float distinction and the error messages are Lua's. Each statement
 * starts a new line carrying a marker with its Lua line number, which is how
 * an error raised in the generated code is reported at the Lua line.
 */
(function (NS) {
  'use strict';

  var ARITH = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'mod', '^': 'pow', '//': 'idiv',
                '&': 'band', '|': 'bor', '~': 'bxor', '<<': 'shl', '>>': 'shr', '..': 'concat' };
  var COMPARE = { '==': 'eq', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge' };

  function compile(ast, chunk) {
    var consts = [];
    var nameCounts = Object.create(null);

    function uniqueName(luaName) {
      var n = (nameCounts[luaName] || 0) + 1;
      nameCounts[luaName] = n;
      return n === 1 ? '$' + luaName : '$' + luaName + '$' + n;
    }

    function FuncState(parent, vararg) {
      this.parent = parent; this.vararg = vararg; this.temps = 0; this.scopes = [];
    }
    var fs = null;
    var stmtUid = 0;

    function newTemp() { fs.temps++; return '$$' + fs.temps; }
    function lookup(name) {
      for (var f = fs; f; f = f.parent) {
        for (var i = f.scopes.length - 1; i >= 0; i--) {
          var js = f.scopes[i][name];
          if (js !== undefined) return js;
        }
      }
      return null;
    }
    function declare(name) {
      var js = uniqueName(name);
      fs.scopes[fs.scopes.length - 1][name] = js;
      return js;
    }
    function openScope() { fs.scopes.push(Object.create(null)); }
    function closeScope() { fs.scopes.pop(); }

    function err(msg, line) {
      throw new NS.LuaSyntaxError(msg, chunk, line || 0);
    }

    function str(s) { return JSON.stringify(s); }

    function numberLiteral(text) {
      var v;
      if (/^0[xX]/.test(text)) {
        if (/[.pP]/.test(text)) v = NS.str2num(text);
        else {
          var big = BigInt.asIntN(64, BigInt('0x' + text.slice(2)));
          return String(Number(big));
        }
      } else if (/[.eE]/.test(text)) {
        v = NS.mkf(Number(text));
      } else {
        var n = Number(text);
        if (Math.abs(n) > 9223372036854775807) v = NS.mkf(n);
        else return String(n);
      }
      if (v instanceof NS.LFloat) {
        var idx = consts.length;
        consts.push(v);
        return '$$K[' + idx + ']';
      }
      var s = String(v);
      return s === 'Infinity' ? 'Infinity' : (s === 'NaN' ? 'NaN' : (v < 0 ? '(' + s + ')' : s));
    }

    function describe(e) {
      if (e.k === 'Name') return lookup(e.name) ? "local '" + e.name + "'" : "global '" + e.name + "'";
      if (e.k === 'Index' && e.key.k === 'String') return "field '" + e.key.v + "'";
      if (e.k === 'Method') return "method '" + e.name + "'";
      return '';
    }

    function isMultiExpr(e) { return e.k === 'Call' || e.k === 'Method' || e.k === 'Vararg'; }

    // A JS expression for the raw result of a call: possibly a Multi.
    function callRaw(e) {
      if (e.k === 'Method') {
        var o = ex(e.obj);
        var args = argList(e.args);
        return 'L.method(' + o + ', ' + str(e.name) + (args ? ', ' + args : '') + ')';
      }
      var fn = ex(e.fn), a = argList(e.args), d = describe(e.fn);
      if (/^\$[A-Za-z_][\w$]*$/.test(fn)) {
        return '(typeof ' + fn + " === 'function' ? " + fn + ' : L.call(' + fn + ', ' + str(d) + '))(' + a + ')';
      }
      var t = newTemp();
      return '(typeof (' + t + ' = ' + fn + ") === 'function' ? " + t + ' : L.call(' + t + ', ' + str(d) + '))(' + a + ')';
    }

    function argList(exprs) {
      var out = [];
      for (var i = 0; i < exprs.length; i++) {
        var e = exprs[i], last = i === exprs.length - 1;
        if (last && (e.k === 'Call' || e.k === 'Method')) out.push('...L.sp(' + callRaw(e) + ')');
        else if (last && e.k === 'Vararg') { checkVararg(e); out.push('...$$va'); }
        else out.push(ex(e));
      }
      return out.join(', ');
    }
    function checkVararg(e) {
      if (!fs.vararg) err("cannot use '...' outside a vararg function", e.line);
    }

    // A JS expression for exactly one Lua value.
    function ex(e) {
      switch (e.k) {
        case 'Nil': return 'undefined';
        case 'True': return 'true';
        case 'False': return 'false';
        case 'Number': return numberLiteral(e.v);
        case 'String': return str(e.v);
        case 'Vararg': checkVararg(e); return '$$va[0]';
        case 'Function': return funcExpr(e);
        case 'Paren': return ex(e.expr);
        case 'Name': {
          var js = lookup(e.name);
          if (js) return js;
          return 'L.index($$G, ' + str(e.name) + ')';
        }
        case 'Index':
          return 'L.index(' + ex(e.obj) + ', ' + ex(e.key) + ', ' + str(describe(e.obj)) + ')';
        case 'Call': case 'Method':
          return 'L.first(' + callRaw(e) + ')';
        case 'Table': return tableExpr(e);
        case 'Unop': {
          if (e.op === 'not') return '!' + cond(e.expr);
          if (e.op === '-') {
            if (e.expr.k === 'Number') {
              var lit = numberLiteral(e.expr.v);
              if (/^\d+$/.test(lit)) return lit === '0' ? '0' : '(-' + lit + ')';
              if (/^[\d.e+-]+$/.test(lit)) return '(-' + lit + ')';
            }
            return 'L.unm(' + ex(e.expr) + ')';
          }
          if (e.op === '#') return 'L.len(' + ex(e.expr) + ')';
          if (e.op === '~') return 'L.bnot(' + ex(e.expr) + ')';
          break;
        }
        case 'Binop': {
          if (e.op === 'and') {
            var t = newTemp();
            return '(L.T(' + t + ' = ' + ex(e.left) + ') ? ' + ex(e.right) + ' : ' + t + ')';
          }
          if (e.op === 'or') {
            var t2 = newTemp();
            return '(L.T(' + t2 + ' = ' + ex(e.left) + ') ? ' + t2 + ' : ' + ex(e.right) + ')';
          }
          if (e.op === '~=') return '!L.eq(' + ex(e.left) + ', ' + ex(e.right) + ')';
          if (COMPARE[e.op]) return 'L.' + COMPARE[e.op] + '(' + ex(e.left) + ', ' + ex(e.right) + ')';
          return 'L.' + ARITH[e.op] + '(' + ex(e.left) + ', ' + ex(e.right) + ')';
        }
      }
      err('cannot compile expression ' + e.k, e.line);
    }

    // A JS boolean expression for Lua truth, without building a Lua value.
    function cond(e) {
      switch (e.k) {
        case 'True': return 'true';
        case 'False': case 'Nil': return 'false';
        case 'Paren': return cond(e.expr);
        case 'Unop': if (e.op === 'not') return '!' + cond(e.expr); break;
        case 'Binop':
          if (e.op === 'and') return '(' + cond(e.left) + ' && ' + cond(e.right) + ')';
          if (e.op === 'or') return '(' + cond(e.left) + ' || ' + cond(e.right) + ')';
          if (e.op === '~=' || COMPARE[e.op]) return ex(e);
          break;
      }
      return 'L.T(' + ex(e) + ')';
    }

    function tableExpr(e) {
      var pos = [], keyed = [];
      for (var i = 0; i < e.items.length; i++) {
        var it = e.items[i];
        if (it.kind === 'pos') {
          var lastPos = true;
          for (var j = i + 1; j < e.items.length; j++) if (e.items[j].kind === 'pos') { lastPos = false; break; }
          if (lastPos && (it.value.k === 'Call' || it.value.k === 'Method')) pos.push('...L.sp(' + callRaw(it.value) + ')');
          else if (lastPos && it.value.k === 'Vararg') { checkVararg(it.value); pos.push('...$$va'); }
          else pos.push(ex(it.value));
        } else {
          keyed.push(ex(it.key), ex(it.value));
        }
      }
      if (!keyed.length) return 'L.tbl([' + pos.join(', ') + '])';
      return 'L.tbl([' + pos.join(', ') + '], [' + keyed.join(', ') + '])';
    }

    function funcExpr(f) {
      var saved = fs;
      fs = new FuncState(saved, f.vararg);
      openScope();
      var params = f.params.map(function (p) { return declare(p); });
      if (f.vararg) params.push('...$$va');
      var body = block(f.body);
      closeScope();
      var temps = '';
      if (fs.temps) {
        var names = [];
        for (var i = 1; i <= fs.temps; i++) names.push('$$' + i);
        temps = 'let ' + names.join(', ') + ';';
      }
      fs = saved;
      return 'function (' + params.join(', ') + ') {' + temps + body + '\n/*@' + (f.endLine || f.line) + '*/return L.NONE;}';
    }

    function block(stmts) {
      var out = '';
      for (var i = 0; i < stmts.length; i++) out += statement(stmts[i]);
      return out;
    }
    function scoped(stmts) {
      openScope();
      var b = block(stmts);
      closeScope();
      return b;
    }

    function assignTo(target, value) {
      if (target.k === 'Name') {
        var js = lookup(target.name);
        if (js) return js + ' = ' + value + ';';
        return 'L.setindex($$G, ' + str(target.name) + ', ' + value + ');';
      }
      return 'L.setindex(' + ex(target.obj) + ', ' + ex(target.key) + ', ' + value + ', ' + str(describe(target.obj)) + ');';
    }

    function valuesArray(exprs) { return '[' + argList(exprs) + ']'; }

    function statement(s) {
      var mark = '\n/*@' + (s.line || 0) + '*/';
      switch (s.k) {
        case 'Local': {
          var attrs = s.attribs || [];
          attrs.forEach(function (a) {
            if (a && a !== 'const' && a !== 'close') err("unknown attribute '" + a + "'", s.line);
          });
          if (s.names.length === 1 && s.exprs.length <= 1) {
            var v = s.exprs.length ? ex(s.exprs[0]) : 'undefined';
            return mark + 'let ' + declare(s.names[0]) + ' = ' + v + ';';
          }
          if (s.exprs.length === s.names.length && !s.exprs.some(isMultiExpr)) {
            var vals = s.exprs.map(ex);
            var tmpNames = vals.map(function () { return '$$l' + (++stmtUid); });
            var pre = 'const ' + tmpNames.map(function (t, i) { return t + ' = ' + vals[i]; }).join(', ') + ';';
            var decl = s.names.map(function (n, i) { return declare(n) + ' = ' + tmpNames[i]; });
            return mark + pre + ' let ' + decl.join(', ') + ';';
          }
          var r = '$$r' + (++stmtUid);
          var code = 'const ' + r + ' = ' + valuesArray(s.exprs) + ';';
          var decls = s.names.map(function (n, i) { return declare(n) + ' = ' + r + '[' + i + ']'; });
          return mark + code + ' let ' + decls.join(', ') + ';';
        }
        case 'LocalFunction': {
          var name = declare(s.name);
          return mark + 'let ' + name + '; ' + name + ' = ' + funcExpr(s.func) + ';';
        }
        case 'Assign': {
          if (s.targets.length === 1 && s.exprs.length === 1) {
            return mark + assignTo(s.targets[0], ex(s.exprs[0]));
          }
          var rr = '$$r' + (++stmtUid);
          var c2 = 'const ' + rr + ' = ' + valuesArray(s.exprs) + ';';
          s.targets.forEach(function (t, i) { c2 += ' ' + assignTo(t, rr + '[' + i + ']'); });
          return mark + c2;
        }
        case 'ExprStat':
          return mark + callRaw(s.expr) + ';';
        case 'Do':
          return mark + '{' + scoped(s.body) + '\n}';
        case 'While':
          return mark + 'while (' + cond(s.cond) + ') {' + scoped(s.body) + '\n}';
        case 'Repeat': {
          openScope();
          var body = block(s.body);
          var cnd = cond(s.cond);
          closeScope();
          return mark + 'for (;;) {' + body + '\nif (' + cnd + ') break;\n}';
        }
        case 'If': {
          var o = mark;
          s.clauses.forEach(function (c, i) {
            o += (i ? ' else if (' : 'if (') + cond(c.cond) + ') {' + scoped(c.body) + '\n}';
          });
          if (s.orelse) o += ' else {' + scoped(s.orelse) + '\n}';
          return o;
        }
        case 'NumFor': {
          var u = ++stmtUid;
          var I = '$$i' + u, LIM = '$$m' + u, ST = '$$s' + u, FL = '$$f' + u;
          var start = ex(s.start), limit = ex(s.limit);
          var stepLit = !s.step ? 1 : (s.step.k === 'Number' && /^\d+$/.test(s.step.v) ? Number(s.step.v) : null);
          var step = s.step ? ex(s.step) : '1';
          var intStart = s.start.k === 'Number' && /^\d+$/.test(s.start.v);
          var test = stepLit !== null && stepLit > 0 ? I + ' <= ' + LIM : '(' + ST + ' > 0 ? ' + I + ' <= ' + LIM + ' : ' + I + ' >= ' + LIM + ')';
          openScope();
          var v2 = declare(s.name);
          var bindVal = (intStart && stepLit !== null) ? I : FL + ' ? L.mkf(' + I + ') : ' + I;
          var bd = block(s.body);
          closeScope();
          return mark + 'for (let [' + I + ', ' + LIM + ', ' + ST + ', ' + FL + '] = L.forprep(' + start + ', ' + limit + ', ' + step + '); ' +
                 test + '; ' + I + ' += ' + ST + ') { let ' + v2 + ' = ' + bindVal + ';' + bd + '\n}';
        }
        case 'GenFor': {
          var it = '$$it' + (++stmtUid);
          var head = 'const ' + it + ' = L.iter(' + argList(s.exprs) + ');';
          openScope();
          var binds = s.names.map(function (n, i) {
            var src = i === 0 ? it + '.a' : (i === 1 ? it + '.b' : it + '.v[' + i + ']');
            return declare(n) + ' = ' + src;
          });
          var gb = block(s.body);
          closeScope();
          return mark + '{' + head + ' while (' + it + '.step()) { let ' + binds.join(', ') + ';' + gb + '\n}}';
        }
        case 'Return': {
          var ex0 = s.exprs;
          if (!ex0.length) return mark + 'return L.NONE;';
          if (ex0.length === 1) {
            if (ex0[0].k === 'Call' || ex0[0].k === 'Method') return mark + 'return ' + callRaw(ex0[0]) + ';';
            if (ex0[0].k === 'Vararg') { checkVararg(ex0[0]); return mark + 'return L.ret($$va);'; }
            return mark + 'return ' + ex(ex0[0]) + ';';
          }
          return mark + 'return L.ret(' + valuesArray(ex0) + ');';
        }
        case 'Break': return mark + 'break;';
        case 'Goto': case 'Label':
          err('goto and labels are not supported by Middaw\'s Lua', s.line);
      }
      err('cannot compile statement ' + s.k, s.line);
    }

    fs = new FuncState(null, true);
    openScope();
    var body = block(ast.body);
    closeScope();
    var temps = '';
    if (fs.temps) {
      var names = [];
      for (var i = 1; i <= fs.temps; i++) names.push('$$' + i);
      temps = 'let ' + names.join(', ') + ';';
    }
    return { body: temps + body, consts: consts };
  }

  // The line the first line of a `new Function` body is reported as.
  var lineOffset = null;
  function probeOffset() {
    if (lineOffset !== null) return lineOffset;
    try {
      new Function('throw new Error("probe");\n//# sourceURL=lua:__probe__')();
    } catch (e) {
      var m = /lua:__probe__:(\d+)/.exec(e.stack || '');
      lineOffset = m ? Number(m[1]) - 1 : 0;
    }
    return lineOffset;
  }

  var chunkUid = 0;
  // Lua source (a byte string) -> a JS function, as `load` gives it.
  function load(src, chunkname, env) {
    var name = String(chunkname || 'chunk').replace(/[^A-Za-z0-9_.\/-]/g, '_');
    if (NS.lineMaps[name]) name = name + '#' + (++chunkUid);
    var ast = NS.parse(src, name);
    var out = compile(ast, name);
    var code = 'return function (...$$va) {' + out.body + '\nreturn L.NONE;\n};';
    var offset = probeOffset();
    var lines = code.split('\n'), map = [], cur = 0;
    for (var i = 0; i < offset; i++) map.push(0);
    for (var j = 0; j < lines.length; j++) {
      var m = /^\/\*@(\d+)\*\//.exec(lines[j]);
      if (m) cur = Number(m[1]);
      map.push(cur);
    }
    NS.lineMaps[name.replace(/#/g, '_')] = map;
    var factory = new Function('L', '$$G', '$$K', code + '\n//# sourceURL=lua:' + name.replace(/#/g, '_'));
    return factory(NS, env || NS.defaultEnv(), out.consts);
  }

  var sharedEnv = null;
  NS.defaultEnv = function () { return sharedEnv || (sharedEnv = NS.makeEnv()); };
  NS.compile = compile;
  NS.load = load;
})(typeof module === 'object' && module.exports
  ? (module.exports = (globalThis.MiddawLua = globalThis.MiddawLua || {}))
  : (globalThis.MiddawLua = globalThis.MiddawLua || {}));
