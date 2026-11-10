/* Middaw's Lua 5.4, part 1 of 3: the lexer and the parser.
 *
 * Middaw runs the family's Lua engines (Good Idea, Midi Suggester, Midi
 * Variator, Midi Catalogue, Starting Blocks, DAW Battle Pass...) unchanged, in
 * the browser, with no third-party code: this file reads Lua source into a
 * syntax tree, lua_compile.js turns the tree into JavaScript, lua_runtime.js
 * supplies the values and the standard library. tests/js/test_lua.js holds
 * all three to what the real Lua 5.4 prints for the same programs.
 *
 * Source is a "byte string": one JS character per byte of the file, which is
 * how Lua itself sees a string, so `#s` and string.sub count bytes as Lua does.
 */
(function (NS) {
  'use strict';

  var KEYWORDS = {};
  ('and break do else elseif end false for function goto if in local nil not ' +
   'or repeat return then true until while').split(' ').forEach(function (k) { KEYWORDS[k] = true; });

  function LuaSyntaxError(message, chunk, line) {
    this.message = chunk + ':' + line + ': ' + message;
    this.line = line;
  }
  LuaSyntaxError.prototype = Object.create(Error.prototype);
  LuaSyntaxError.prototype.name = 'LuaSyntaxError';

  function isDigit(c) { return c >= 48 && c <= 57; }
  function isHex(c) { return isDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70); }
  function isAlpha(c) { return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95; }
  function isSpace(c) { return c === 32 || (c >= 9 && c <= 13); }

  // ---------------------------------------------------------------- lexer --
  function lex(src, chunk) {
    var toks = [];
    var i = 0, n = src.length, line = 1;
    function err(msg) { throw new LuaSyntaxError(msg, chunk, line); }
    function longBracketLevel(at) {   // at points to '['; returns level or -1
      var j = at + 1, level = 0;
      while (src.charCodeAt(j) === 61) { level++; j++; }
      return src.charCodeAt(j) === 91 ? level : -1;
    }
    function readLong(at, level) {    // returns [content, end index]
      var start = at + level + 2;
      // a newline straight after the opening bracket is skipped
      if (src[start] === '\r') { start++; if (src[start] === '\n') start++; }
      else if (src[start] === '\n') { start++; if (src[start] === '\r') start++; }
      var close = ']' + '='.repeat(level) + ']';
      var end = src.indexOf(close, start);
      if (end < 0) err('unfinished long string');
      var body = src.slice(start, end);
      for (var k = at; k < end + close.length; k++) if (src.charCodeAt(k) === 10) line++;
      return [body, end + close.length];
    }
    while (i < n) {
      var c = src.charCodeAt(i);
      if (c === 10) { line++; i++; continue; }
      if (isSpace(c)) { i++; continue; }
      if (c === 45 && src.charCodeAt(i + 1) === 45) {           // comment
        i += 2;
        if (src.charCodeAt(i) === 91) {
          var lvl = longBracketLevel(i);
          if (lvl >= 0) { i = readLong(i, lvl)[1]; continue; }
        }
        while (i < n && src.charCodeAt(i) !== 10) i++;
        continue;
      }
      var tline = line;
      if (isAlpha(c)) {
        var j = i + 1;
        while (j < n && (isAlpha(src.charCodeAt(j)) || isDigit(src.charCodeAt(j)))) j++;
        var word = src.slice(i, j);
        toks.push(KEYWORDS[word] ? { t: word, line: tline } : { t: 'name', v: word, line: tline });
        i = j; continue;
      }
      if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
        var j2 = i, isFloat = false, text;
        if (c === 48 && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
          j2 = i + 2;
          while (j2 < n) {
            var d = src.charCodeAt(j2);
            if (isHex(d) || d === 46) { if (d === 46) isFloat = true; j2++; }
            else if ((d === 112 || d === 80)) {
              isFloat = true; j2++;
              if (src[j2] === '+' || src[j2] === '-') j2++;
            } else break;
          }
        } else {
          while (j2 < n) {
            var e = src.charCodeAt(j2);
            if (isDigit(e) || e === 46) { if (e === 46) isFloat = true; j2++; }
            else if (e === 101 || e === 69) {
              isFloat = true; j2++;
              if (src[j2] === '+' || src[j2] === '-') j2++;
            } else break;
          }
        }
        text = src.slice(i, j2);
        if (j2 < n && (isAlpha(src.charCodeAt(j2)))) err("malformed number near '" + text + src[j2] + "'");
        toks.push({ t: 'number', v: text, line: tline });
        i = j2; continue;
      }
      if (c === 34 || c === 39) {                                // short string
        var q = c, out = [], k = i + 1;
        for (;;) {
          if (k >= n) err('unfinished string');
          var ch = src.charCodeAt(k);
          if (ch === q) { k++; break; }
          if (ch === 10) err('unfinished string');
          if (ch === 92) {
            var x = src[k + 1];
            k += 2;
            switch (x) {
              case 'n': out.push('\n'); break;
              case 't': out.push('\t'); break;
              case 'r': out.push('\r'); break;
              case 'a': out.push('\x07'); break;
              case 'b': out.push('\b'); break;
              case 'f': out.push('\f'); break;
              case 'v': out.push('\v'); break;
              case '\\': out.push('\\'); break;
              case '"': out.push('"'); break;
              case "'": out.push("'"); break;
              case '\n': line++; out.push('\n'); break;
              case 'x': {
                var hx = src.slice(k, k + 2);
                if (!/^[0-9a-fA-F]{2}$/.test(hx)) err('hexadecimal digit expected');
                out.push(String.fromCharCode(parseInt(hx, 16))); k += 2; break;
              }
              case 'z': {
                while (k < n && isSpace(src.charCodeAt(k))) { if (src.charCodeAt(k) === 10) line++; k++; }
                break;
              }
              case 'u': {
                if (src[k] !== '{') err("missing '{' in \\u{xxxx}");
                var close = src.indexOf('}', k);
                var cp = parseInt(src.slice(k + 1, close), 16);
                k = close + 1;
                out.push(utf8Bytes(cp)); break;
              }
              default: {
                if (x !== undefined && isDigit(x.charCodeAt(0))) {
                  var digits = x; var m = 0;
                  while (m < 2 && isDigit(src.charCodeAt(k))) { digits += src[k]; k++; m++; }
                  var val = parseInt(digits, 10);
                  if (val > 255) err('decimal escape too large');
                  out.push(String.fromCharCode(val));
                } else err('invalid escape sequence');
              }
            }
            continue;
          }
          out.push(src[k]); k++;
        }
        toks.push({ t: 'string', v: out.join(''), line: tline });
        i = k; continue;
      }
      if (c === 91) {
        var lv = longBracketLevel(i);
        if (lv >= 0) {
          var r = readLong(i, lv);
          toks.push({ t: 'string', v: r[0], line: tline });
          i = r[1]; continue;
        }
      }
      var three = src.substr(i, 3), two = src.substr(i, 2);
      if (three === '...') { toks.push({ t: '...', line: tline }); i += 3; continue; }
      if (two === '==' || two === '~=' || two === '<=' || two === '>=' || two === '//' ||
          two === '::' || two === '<<' || two === '>>' || two === '..') {
        toks.push({ t: two, line: tline }); i += 2; continue;
      }
      var one = src[i];
      if ('+-*/%^#&~|<>=(){}[];:,.'.indexOf(one) >= 0) { toks.push({ t: one, line: tline }); i++; continue; }
      err("unexpected symbol near '" + one + "'");
    }
    toks.push({ t: '<eof>', line: line });
    return toks;
  }

  function utf8Bytes(cp) {
    if (cp < 0x80) return String.fromCharCode(cp);
    if (cp < 0x800) return String.fromCharCode(0xC0 | (cp >> 6), 0x80 | (cp & 63));
    if (cp < 0x10000) return String.fromCharCode(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    return String.fromCharCode(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }

  // --------------------------------------------------------------- parser --
  // Binary priorities exactly as lparser.c has them: { left, right }.
  var BINARY = {
    '+': [10, 10], '-': [10, 10], '*': [11, 11], '%': [11, 11], '^': [14, 13],
    '/': [11, 11], '//': [11, 11], '&': [6, 6], '|': [4, 4], '~': [5, 5],
    '<<': [7, 7], '>>': [7, 7], '..': [9, 8],
    '==': [3, 3], '<': [3, 3], '<=': [3, 3], '~=': [3, 3], '>': [3, 3], '>=': [3, 3],
    'and': [2, 2], 'or': [1, 1]
  };
  var UNARY_PRIORITY = 12;

  function parse(src, chunk) {
    chunk = chunk || '?';
    var toks = lex(src, chunk);
    var p = 0;
    function peek() { return toks[p]; }
    function next() { return toks[p++]; }
    function check(t) { return toks[p].t === t; }
    function err(msg, tok) {
      tok = tok || toks[p];
      var near = tok.t === '<eof>' ? '<eof>' : (tok.v !== undefined ? tok.v : tok.t);
      throw new LuaSyntaxError(msg + " near '" + near + "'", chunk, tok.line);
    }
    function expect(t, what) {
      if (toks[p].t !== t) err("'" + t + "' expected" + (what ? ' (to close ' + what + ')' : ''));
      return toks[p++];
    }
    function accept(t) { if (toks[p].t === t) { p++; return true; } return false; }
    function name() {
      if (toks[p].t !== 'name') err('<name> expected');
      return toks[p++].v;
    }

    function blockFollow(withUntil) {
      var t = toks[p].t;
      return t === 'else' || t === 'elseif' || t === 'end' || t === '<eof>' || (withUntil && t === 'until');
    }

    function block() {
      var body = [];
      while (!blockFollow(true)) {
        if (check('return')) { body.push(retstat()); break; }
        var s = statement();
        if (s) body.push(s);
      }
      return body;
    }

    function retstat() {
      var tok = next();
      var exprs = [];
      if (!blockFollow(true) && !check(';')) exprs = exprlist();
      accept(';');
      return { k: 'Return', exprs: exprs, line: tok.line };
    }

    function statement() {
      var tok = peek(), line = tok.line;
      switch (tok.t) {
        case ';': next(); return null;
        case 'if': return ifstat();
        case 'while': {
          next(); var cond = expr(); expect('do'); var b = block(); expect('end', 'while');
          return { k: 'While', cond: cond, body: b, line: line };
        }
        case 'do': { next(); var b2 = block(); expect('end', 'do'); return { k: 'Do', body: b2, line: line }; }
        case 'for': return forstat();
        case 'repeat': {
          next(); var b3 = block(); expect('until', 'repeat'); var c3 = expr();
          return { k: 'Repeat', body: b3, cond: c3, line: line };
        }
        case 'function': {
          next();
          var target = { k: 'Name', name: name(), line: line }, isMethod = false;
          while (check('.') || check(':')) {
            var sep = next().t;
            var key = name();
            target = { k: 'Index', obj: target, key: { k: 'String', v: key }, line: line };
            if (sep === ':') { isMethod = true; break; }
          }
          var f = funcbody(isMethod, line);
          return { k: 'Assign', targets: [target], exprs: [f], line: line };
        }
        case 'local': {
          next();
          if (accept('function')) {
            var nm = name();
            return { k: 'LocalFunction', name: nm, func: funcbody(false, line), line: line };
          }
          var names = [], attribs = [];
          do {
            names.push(name());
            if (accept('<')) { attribs.push(name()); expect('>'); } else attribs.push(null);
          } while (accept(','));
          var exprs = accept('=') ? exprlist() : [];
          return { k: 'Local', names: names, attribs: attribs, exprs: exprs, line: line };
        }
        case '::': { next(); var label = name(); expect('::'); return { k: 'Label', name: label, line: line }; }
        case 'return': return retstat();
        case 'break': next(); return { k: 'Break', line: line };
        case 'goto': next(); return { k: 'Goto', name: name(), line: line };
        default: return exprstat();
      }
    }

    function ifstat() {
      var line = next().line;
      var clauses = [];
      var cond = expr(); expect('then');
      clauses.push({ cond: cond, body: block() });
      var orelse = null;
      for (;;) {
        if (accept('elseif')) { var c = expr(); expect('then'); clauses.push({ cond: c, body: block() }); }
        else if (accept('else')) { orelse = block(); expect('end', 'if'); break; }
        else { expect('end', 'if'); break; }
      }
      return { k: 'If', clauses: clauses, orelse: orelse, line: line };
    }

    function forstat() {
      var line = next().line;
      var n1 = name();
      if (accept('=')) {
        var start = expr(); expect(',');
        var limit = expr();
        var step = accept(',') ? expr() : null;
        expect('do'); var b = block(); expect('end', 'for');
        return { k: 'NumFor', name: n1, start: start, limit: limit, step: step, body: b, line: line };
      }
      var names = [n1];
      while (accept(',')) names.push(name());
      expect('in');
      var exprs = exprlist();
      expect('do'); var body = block(); expect('end', 'for');
      return { k: 'GenFor', names: names, exprs: exprs, body: body, line: line };
    }

    function exprstat() {
      var line = peek().line;
      var e = suffixedexp();
      if (check('=') || check(',')) {
        var targets = [e];
        while (accept(',')) targets.push(suffixedexp());
        expect('=');
        var exprs = exprlist();
        targets.forEach(function (t) { if (t.k !== 'Name' && t.k !== 'Index') err('syntax error'); });
        return { k: 'Assign', targets: targets, exprs: exprs, line: line };
      }
      if (e.k !== 'Call' && e.k !== 'Method') err('syntax error');
      return { k: 'ExprStat', expr: e, line: line };
    }

    function exprlist() {
      var list = [expr()];
      while (accept(',')) list.push(expr());
      return list;
    }

    function funcbody(isMethod, line) {
      var params = isMethod ? ['self'] : [], vararg = false;
      expect('(');
      if (!check(')')) {
        do {
          if (accept('...')) { vararg = true; break; }
          params.push(name());
        } while (accept(','));
      }
      expect(')');
      var b = block();
      var endTok = expect('end', 'function');
      return { k: 'Function', params: params, vararg: vararg, body: b, line: line, endLine: endTok.line };
    }

    function primaryexp() {
      var tok = peek();
      if (tok.t === 'name') { next(); return { k: 'Name', name: tok.v, line: tok.line }; }
      if (tok.t === '(') {
        next(); var e = expr(); expect(')');
        return { k: 'Paren', expr: e, line: tok.line };
      }
      err('unexpected symbol');
    }

    function suffixedexp() {
      var e = primaryexp();
      for (;;) {
        var tok = peek();
        switch (tok.t) {
          case '.': next(); e = { k: 'Index', obj: e, key: { k: 'String', v: name() }, line: tok.line }; break;
          case '[': next(); var key = expr(); expect(']'); e = { k: 'Index', obj: e, key: key, line: tok.line }; break;
          case ':': next(); var m = name(); e = { k: 'Method', obj: e, name: m, args: callargs(), line: tok.line }; break;
          case '(': case 'string': case '{': e = { k: 'Call', fn: e, args: callargs(), line: tok.line }; break;
          default: return e;
        }
      }
    }

    function callargs() {
      var tok = peek();
      if (tok.t === 'string') { next(); return [{ k: 'String', v: tok.v }]; }
      if (tok.t === '{') return [tablecons()];
      expect('(');
      if (accept(')')) return [];
      var args = exprlist();
      expect(')');
      return args;
    }

    function tablecons() {
      var line = expect('{').line;
      var items = [];   // { kind: 'pos'|'named'|'keyed', key, value }
      while (!check('}')) {
        if (check('name') && toks[p + 1].t === '=') {
          var key = next().v; next();
          items.push({ kind: 'keyed', key: { k: 'String', v: key }, value: expr() });
        } else if (check('[')) {
          next(); var k = expr(); expect(']'); expect('=');
          items.push({ kind: 'keyed', key: k, value: expr() });
        } else {
          items.push({ kind: 'pos', value: expr() });
        }
        if (!accept(',') && !accept(';')) break;
      }
      expect('}', 'table');
      return { k: 'Table', items: items, line: line };
    }

    function simpleexp() {
      var tok = peek();
      switch (tok.t) {
        case 'number': next(); return { k: 'Number', v: tok.v, line: tok.line };
        case 'string': next(); return { k: 'String', v: tok.v };
        case 'nil': next(); return { k: 'Nil' };
        case 'true': next(); return { k: 'True' };
        case 'false': next(); return { k: 'False' };
        case '...': next(); return { k: 'Vararg', line: tok.line };
        case '{': return tablecons();
        case 'function': next(); return funcbody(false, tok.line);
        default: return suffixedexp();
      }
    }

    function expr(limit) {
      limit = limit || 0;
      var left, tok = peek();
      if (tok.t === 'not' || tok.t === '-' || tok.t === '#' || tok.t === '~') {
        next();
        left = { k: 'Unop', op: tok.t, expr: expr(UNARY_PRIORITY), line: tok.line };
      } else {
        left = simpleexp();
      }
      for (;;) {
        var op = peek().t, pr = BINARY[op];
        if (!pr || pr[0] <= limit) break;
        var line = next().line;
        var right = expr(pr[1]);
        left = { k: 'Binop', op: op, left: left, right: right, line: line };
      }
      return left;
    }

    var body = block();
    if (!check('<eof>')) err("'<eof>' expected");
    return { k: 'Chunk', body: body };
  }

  NS.lex = lex;
  NS.parse = parse;
  NS.LuaSyntaxError = LuaSyntaxError;
  NS.utf8Bytes = utf8Bytes;
})(typeof module === 'object' && module.exports
  ? (module.exports = (globalThis.MiddawLua = globalThis.MiddawLua || {}))
  : (globalThis.MiddawLua = globalThis.MiddawLua || {}));
