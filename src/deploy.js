import fs from 'node:fs';
import path from 'node:path';
import { Finder } from './finder.js';

const TRANSFORM_EXTS = new Set(['php', 'js', 'css', 'sass', 'scss', 'less', 'txt', 'readme']);

function ext(file) {
  const i = file.lastIndexOf('.');
  return i === -1 ? '' : file.slice(i + 1).toLowerCase();
}

function isPremiumOnlyDir(relDirSlashed, premiumOnly) {
  return premiumOnly.some((e) => relDirSlashed === e || relDirSlashed.startsWith(e));
}

/** Load .distignore (or .svnignore) patterns from the source root — files never shipped. */
function loadDistIgnore(sourceDir) {
  for (const name of ['.distignore', '.svnignore']) {
    const p = path.join(sourceDir, name);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8').split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    }
  }
  return [];
}

/** Match a relative posix path against one .distignore/.svnignore pattern. */
function matchDistPattern(relPath, pattern) {
  if (pattern.startsWith('/')) {                    // root-relative dir/file (incl. subtree)
    const p = pattern.slice(1).replace(/\/$/, '');
    return relPath === p || relPath.startsWith(p + '/');
  }
  const base = relPath.split('/').pop();            // basename match, at any depth
  if (pattern.includes('*')) {
    const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return re.test(base);
  }
  return base === pattern;
}

function isDistIgnored(relPath, patterns) {
  return patterns.some((pat) => matchDistPattern(relPath, pat));
}

function applyReplace(content, config, variant) {
  if (!config.replace.length) return content;
  const repl = variant === 'free' ? config.replace_free : config.replace_pro;
  let out = content;
  config.replace.forEach((find, i) => {
    if (!find) return;
    const r = repl[i] != null ? repl[i] : (repl[0] != null ? repl[0] : '');
    out = out.split(find).join(r);
  });
  return out;
}

function transformFile(fullPath, variant, config, finder) {
  if (!TRANSFORM_EXTS.has(ext(fullPath))) return; // binaries/images copied as-is
  let content = fs.readFileSync(fullPath, 'utf8');
  content = applyReplace(content, config, variant);
  content = ext(fullPath) === 'php' ? finder.deployPhp(content) : finder.deployText(content);
  content = content.replace(/\r\n|\r|\n/g, '\r\n'); // consistent CRLF (matches plugin)
  fs.writeFileSync(fullPath, content);
}

/**
 * Build one variant of the source into destItemDir.
 *
 * @param {object} o
 * @param {string} o.sourceDir  absolute path to the source theme/plugin
 * @param {string} o.destItemDir absolute path of the output item folder (created here)
 * @param {'free'|'premium'} o.variant
 * @param {object} o.config     resolved deploy.json config
 * @returns {{files:number, dirs:number}}
 */
export function buildVariant({ sourceDir, destItemDir, variant, config }) {
  const finder = new Finder({ variant, key: config.function_premium || 'ft_is__premium' });
  const stats = { files: 0, dirs: 0 };
  const distIgnore = loadDistIgnore(sourceDir);
  fs.mkdirSync(destItemDir, { recursive: true });

  function walk(relDir) {
    const entries = fs.readdirSync(path.join(sourceDir, relDir), { withFileTypes: true });
    for (const ent of entries) {
      const name = ent.name;
      if (name.startsWith('.')) continue;      // skip .git, .DS_Store, dot-anything
      if (name === 'deploy.json') continue;    // never ship the config
      const relPath = relDir ? path.posix.join(relDir, name) : name;
      if (isDistIgnored(relPath, distIgnore)) continue;  // .distignore/.svnignore

      if (ent.isDirectory()) {
        const relDirSlashed = '/' + relPath + '/';
        if (variant === 'free' && isPremiumOnlyDir(relDirSlashed, config.premium_only)) continue;
        fs.mkdirSync(path.join(destItemDir, relPath), { recursive: true });
        stats.dirs += 1;
        walk(relPath);
      } else if (ent.isFile()) {
        if (variant === 'free'
          && (config.premium_files.includes('/' + relPath) || config.premium_files.includes(relPath))) {
          continue;
        }
        const dest = path.join(destItemDir, relPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(sourceDir, relPath), dest);
        transformFile(dest, variant, config, finder);
        stats.files += 1;
      }
    }
  }

  walk('');
  return stats;
}
