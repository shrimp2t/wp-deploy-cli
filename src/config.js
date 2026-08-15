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

// Arrays accept a JS array (deploy.json) or a comma-separated string (.env).
function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v === '' || v == null) return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

// .env keys (DEPLOY_*) that mirror deploy.json fields — lets you skip deploy.json
// and put everything in .env. When both are present, the env value wins.
const ENV_MAP = {
  DEPLOY_TYPE: 'type',
  DEPLOY_NAME: 'name',
  DEPLOY_PREMIUM_NAME: 'premium_name',
  DEPLOY_FUNCTION_PREMIUM: 'function_premium',
  DEPLOY_PREMIUM_SUFFIX: 'premium_suffix',
  DEPLOY_REPLACE: 'replace',
  DEPLOY_REPLACE_PRO: 'replace_pro',
  DEPLOY_REPLACE_FREE: 'replace_free',
  DEPLOY_PREMIUM_ONLY: 'premium_only',
  DEPLOY_PREMIUM_FILES: 'premium_files',
};

/**
 * Load deploy.json (if present) merged over defaults, then overlaid with any
 * DEPLOY_* environment variables (from a project `.env`, already loaded).
 */
export function loadConfig(sourceDir, env = process.env) {
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

  // Overlay DEPLOY_* env vars (env wins over deploy.json).
  for (const [envKey, cfgKey] of Object.entries(ENV_MAP)) {
    if (env && env[envKey] != null && env[envKey] !== '') merged[cfgKey] = env[envKey];
  }

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
