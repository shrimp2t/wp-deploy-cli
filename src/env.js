import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env loader (no dependency). Reads KEY=VALUE lines and populates
 * process.env for any key that is not already set (real env vars win).
 * Supports # comments, `export KEY=...`, and single/double quoted values.
 *
 * @param {string} [dir=process.cwd()] directory to look for `.env` in
 * @returns {Record<string,string>} the values loaded from the file
 */
export function loadEnv(dir = process.cwd()) {
  const file = path.join(dir, '.env');
  const loaded = {};
  if (!fs.existsSync(file)) return loaded;

  for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).replace(/^\s+/, '');
    if (val[0] === '"' || val[0] === "'") {
      // Quoted: take the contents up to the matching closing quote (trailing text ignored).
      const q = val[0];
      const end = val.indexOf(q, 1);
      val = end === -1 ? val.slice(1) : val.slice(1, end);
    } else {
      // Unquoted: strip an inline comment ( # … to end of line) and surrounding space.
      const hash = val.search(/\s#/);
      if (hash !== -1) val = val.slice(0, hash);
      else if (val[0] === '#') val = '';
      val = val.trim();
    }
    loaded[key] = val;
    if (!(key in process.env)) process.env[key] = val;
  }
  return loaded;
}

export function envBool(v) {
  if (v === true) return true;
  if (typeof v !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}
