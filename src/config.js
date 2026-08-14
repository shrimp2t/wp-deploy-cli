import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  type: '',                // 'theme' | 'plugin'  (auto-detected when empty)
  name: '',                // free output folder/slug (defaults to source basename)
  premium_name: '',        // pro output folder/slug
  function_premium: '',    // marker function name (defaults to ft_is__premium)
  premium_suffix: 'premium',
  replace: '',             // string or [strings] to replace
  replace_pro: '',         // replacement(s) for the pro build
  replace_free: '',        // replacement(s) for the free build
  premium_only: [],        // dirs excluded from the free build, e.g. ["/premium/"]
  premium_files: [],       // files excluded from the free build
};

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v === '' || v == null) return [];
  return [v];
}

/** Load deploy.json (if present) merged over defaults. */
export function loadConfig(sourceDir) {
  const file = path.join(sourceDir, 'deploy.json');
  let cfg = {};
  if (fs.existsSync(file)) {
    try {
      cfg = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (e) {
      throw new Error(`Invalid deploy.json: ${e.message}`);
    }
  }
  const merged = { ...DEFAULTS, ...cfg };
  merged.premium_only = toArray(merged.premium_only).map(normalizeDirEntry);
  merged.premium_files = toArray(merged.premium_files);
  merged.replace = toArray(merged.replace);
  merged.replace_pro = toArray(merged.replace_pro);
  merged.replace_free = toArray(merged.replace_free);
  merged._hasFile = fs.existsSync(file);
  return merged;
}

/** Normalize a premium_only entry to a posix path with leading + trailing slash. */
function normalizeDirEntry(entry) {
  let e = String(entry).replace(/\\/g, '/');
  if (!e.startsWith('/')) e = '/' + e;
  if (!e.endsWith('/')) e = e + '/';
  return e;
}
