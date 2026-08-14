/**
 * Transform engine — JS port of the plugin's FD_String_Finder.
 *
 * Given a single source with inline "premium" markers, it produces either the
 * FREE or the PREMIUM (pro) variant of a file by:
 *   1. removing the marker function definition (e.g. `function ft_is__premium(){...}`),
 *   2. collapsing every `if ( ft_is__premium() ) { A } else { B }` down to the
 *      branch that belongs to the requested variant (handles negation and
 *      `== true` / `!= true` / `== false` / `!= false`),
 *   3. resolving comment-tag blocks for non-PHP files:
 *        /*<if_is_premium>*​/ ... /*</if_is_premium>*​/      (css / js / scss / php)
 *        <!-- if_is_premium --> ... <!-- /if_is_premium -->  (html)
 *
 * Unlike the original (which scans raw characters and can trip over braces
 * inside strings), this port skips string literals as well as comments.
 */

const OPEN_TO_CLOSE = { '{': '}', '(': ')', '[': ']' };

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Index just past the end of a `//` line comment starting at i. */
function skipLineComment(src, i) {
  const nl = src.indexOf('\n', i);
  return nl === -1 ? src.length : nl;
}

/** Index just past the `*​/` closing a block comment starting at i. */
function skipBlockComment(src, i) {
  const end = src.indexOf('*/', i + 2);
  return end === -1 ? src.length : end + 2;
}

/** Index just past the closing quote of a string starting at i (handles \\ escapes). */
function skipString(src, i) {
  const q = src[i];
  const n = src.length;
  i += 1;
  while (i < n) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === q) return i + 1;
    i += 1;
  }
  return n;
}

/**
 * Given src[openIndex] is one of `{ ( [`, return the index of the matching
 * close delimiter, respecting nesting and skipping comments/strings. -1 if none.
 */
function findMatching(src, openIndex) {
  const open = src[openIndex];
  const close = OPEN_TO_CLOSE[open];
  const n = src.length;
  let depth = 0;
  let i = openIndex;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = skipLineComment(src, i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = skipBlockComment(src, i); continue; }
    if (c === "'" || c === '"') { i = skipString(src, i); continue; }
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return i; }
    i += 1;
  }
  return -1;
}

/** Skip whitespace forward from i; return index of first non-space char (or n). */
function skipSpaceForward(src, i) {
  const n = src.length;
  while (i < n && /\s/.test(src[i])) i += 1;
  return i;
}

/** Skip whitespace backward from i; return index of last non-space char (or -1). */
function skipSpaceBackward(src, i) {
  while (i >= 0 && /\s/.test(src[i])) i -= 1;
  return i;
}

export class Finder {
  /**
   * @param {object} opts
   * @param {string} [opts.key='ft_is__premium'] premium marker function name
   * @param {'free'|'premium'} [opts.variant='free']
   */
  constructor({ key = 'ft_is__premium', variant = 'free' } = {}) {
    this.key = key;
    this.variant = variant;
  }

  setVariant(v) { this.variant = v; return this; }
  setKey(k) { if (k) this.key = k; return this; }

  /** Evaluate whether the THEN branch is the premium branch. Port of get_if_string(). */
  _conditionIsPremium(condition) {
    const bangs = (condition.match(/!/g) || []).length;
    if (bangs > 0) {
      if (condition.includes('true')) return bangs % 2 === 0;
      if (condition.includes('false')) return bangs % 2 !== 0;
      return false; // e.g. `! ft_is__premium()`
    }
    if (condition.includes('false')) return false; // e.g. `ft_is__premium() == false`
    return true; // plain `ft_is__premium()` or `== true`
  }

  /** Remove every `function <key>( ... ) { ... }` definition. */
  removePremiumFunction(src) {
    const re = new RegExp(`function\\s+${escapeRegExp(this.key)}\\s*\\(`, 'g');
    let out = src;
    let guard = 0;
    while (guard++ < 1000) {
      const m = re.exec(out);
      if (!m) break;
      const fnStart = m.index;
      const parenOpen = out.indexOf('(', m.index);
      const parenClose = findMatching(out, parenOpen);
      if (parenClose === -1) break;
      const braceOpen = skipSpaceForward(out, parenClose + 1);
      if (out[braceOpen] !== '{') break;
      const braceClose = findMatching(out, braceOpen);
      if (braceClose === -1) break;
      out = out.slice(0, fnStart) + out.slice(braceClose + 1);
      re.lastIndex = 0; // string changed, restart scan
    }
    return out;
  }

  /**
   * Find the `if (...)` that encloses the call at keyIdx.
   * @returns {{ifStart:number, condStart:number, condEnd:number}|null}
   */
  _findEnclosingIf(src, keyIdx) {
    // Walk left to the unmatched '(' that opens the condition.
    let depth = 0;
    let condStart = -1;
    for (let i = keyIdx; i >= 0; i -= 1) {
      const c = src[i];
      if (c === ')') depth += 1;
      else if (c === '(') {
        if (depth === 0) { condStart = i; break; }
        depth -= 1;
      }
    }
    if (condStart === -1) return null;

    // The token right before '(' must be the `if` keyword.
    const before = skipSpaceBackward(src, condStart - 1);
    if (before < 1) return null;
    if (src.slice(before - 1, before + 1) !== 'if') return null;
    // word boundary before `if`
    const pre = src[before - 2];
    if (pre !== undefined && /[A-Za-z0-9_]/.test(pre)) return null;

    const condEnd = findMatching(src, condStart);
    if (condEnd === -1 || condEnd < keyIdx) return null;
    return { ifStart: before - 1, condStart, condEnd };
  }

  /** Collapse each `if (<key>) {A} else {B}` to the branch for this.variant. */
  resolveConditionals(src) {
    const callRe = new RegExp(`\\b${escapeRegExp(this.key)}\\s*\\(`, 'g');
    let out = src;
    let from = 0;
    let guard = 0;
    while (guard++ < 5000) {
      callRe.lastIndex = from;
      const m = callRe.exec(out);
      if (!m) break;
      const keyIdx = m.index;

      const info = this._findEnclosingIf(out, keyIdx);
      if (!info) { from = keyIdx + this.key.length; continue; }

      const { ifStart, condEnd } = info;
      const condition = out.slice(info.condStart + 1, condEnd);
      const thenIsPremium = this._conditionIsPremium(condition);

      const thenOpen = skipSpaceForward(out, condEnd + 1);
      if (out[thenOpen] !== '{') { from = keyIdx + this.key.length; continue; }
      const thenClose = findMatching(out, thenOpen);
      if (thenClose === -1) { from = keyIdx + this.key.length; continue; }
      const thenBlock = out.slice(thenOpen + 1, thenClose);

      // Optional else / else if.
      let elseBlock = null;
      let spanEnd = thenClose + 1;
      const afterThen = skipSpaceForward(out, thenClose + 1);
      if (out.slice(afterThen, afterThen + 4) === 'else') {
        const elseOpen = skipSpaceForward(out, afterThen + 4);
        if (out[elseOpen] === '{') {
          const elseClose = findMatching(out, elseOpen);
          if (elseClose !== -1) {
            elseBlock = out.slice(elseOpen + 1, elseClose);
            spanEnd = elseClose + 1;
          }
        }
      }

      // Pick the branch that belongs to this variant.
      const wantPremium = this.variant === 'premium';
      let keep;
      if (wantPremium) keep = thenIsPremium ? thenBlock : elseBlock;
      else keep = thenIsPremium ? elseBlock : thenBlock;
      if (keep == null) keep = '';

      out = out.slice(0, ifStart) + keep + out.slice(spanEnd);
      from = ifStart; // re-scan (handles nested if(key))
    }
    return out;
  }

  /** Resolve a comment/HTML tagged block pair. */
  _resolveTag(src, openTag, closeTag) {
    if (this.variant !== 'free') {
      // Pro: keep the content, drop only the marker tags.
      return src.split(openTag).join('').split(closeTag).join('');
    }
    // Free: remove everything between (and including) the tags.
    let out = src;
    let guard = 0;
    while (guard++ < 5000) {
      const open = out.indexOf(openTag);
      if (open === -1) break;
      const close = out.indexOf(closeTag, open + openTag.length);
      if (close === -1) break;
      out = out.slice(0, open) + out.slice(close + closeTag.length);
    }
    return out;
  }

  /** Marker-tag resolution for any file type (css/js/scss/php/html). */
  deployMarkers(src) {
    let out = this._resolveTag(src, '/*<if_is_premium>*/', '/*</if_is_premium>*/');
    out = this._resolveTag(out, '<!-- if_is_premium -->', '<!-- /if_is_premium -->');
    return out;
  }

  /** Full transform for a PHP file. */
  deployPhp(src) {
    let out = this.deployMarkers(src);
    out = this.removePremiumFunction(out);
    out = this.resolveConditionals(out);
    return out;
  }

  /** Full transform for a non-PHP text file (css/js/scss/less/html/txt). */
  deployText(src) {
    return this.deployMarkers(src);
  }
}

export default Finder;
