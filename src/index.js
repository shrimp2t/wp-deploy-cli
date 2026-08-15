import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';
import { detectType, readVersion, readName } from './meta.js';
import { buildVariant } from './deploy.js';
import { zipDir } from './zip.js';

export { Finder } from './finder.js';
export { loadConfig } from './config.js';
export { buildVariant } from './deploy.js';

/**
 * Build a single variant into `dir/<slug>` and return its location + metadata.
 * Used by the SVN deploy step (which needs the built files, not a zip).
 */
export function buildVariantToDir({ path: srcPath, variant, dir }) {
  const sourceDir = path.resolve(srcPath);
  const config = loadConfig(sourceDir);
  const type = detectType(sourceDir, config.type);
  const version = readVersion(sourceDir, type);
  const displayName = readName(sourceDir, type);
  const baseSlug = config.name || slugify(displayName) || path.basename(sourceDir);
  const proSlug = config.premium_name || `${baseSlug}-${config.premium_suffix || 'premium'}`;
  const slug = variant === 'free' ? baseSlug : proSlug;
  const itemDir = path.join(dir, slug);
  buildVariant({ sourceDir, destItemDir: itemDir, variant, config });
  return { dir: itemDir, slug, type, version };
}

function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build FREE and/or PREMIUM distributables from a single source directory.
 *
 * @param {object} o
 * @param {string} o.path            source theme/plugin directory
 * @param {string} [o.out]           output directory (default: sibling `dist/`)
 * @param {('free'|'premium')[]} [o.variants=['free','premium']]
 * @param {boolean} [o.zip=true]     also produce zip files
 * @param {boolean} [o.keep=false]   keep the unzipped build folders
 * @param {(msg:string)=>void} [o.log]
 * @returns {Promise<object>} result with built variants, versions, and zip paths
 */
export async function build(o) {
  const log = o.log || (() => {});
  const sourceDir = path.resolve(o.path);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Source path is not a directory: ${sourceDir}`);
  }

  const config = loadConfig(sourceDir);
  const type = detectType(sourceDir, config.type);
  const version = readVersion(sourceDir, type);
  const displayName = readName(sourceDir, type);

  const baseSlug = config.name || slugify(displayName) || path.basename(sourceDir);
  // Pro-only ("single") products keep the plain slug — no "-pro" suffix appended.
  const proSlug = o.single
    ? (config.premium_name || baseSlug)
    : (config.premium_name || `${baseSlug}-${config.premium_suffix || 'premium'}`);

  const outDir = path.resolve(o.out || path.join(path.dirname(sourceDir), 'dist'));
  fs.mkdirSync(outDir, { recursive: true });

  const variants = o.variants && o.variants.length ? o.variants : ['free', 'premium'];
  const doZip = o.zip !== false;

  const result = {
    source: sourceDir, type, version, name: displayName,
    outDir, free: null, premium: null,
  };

  // Stage builds under a temp dir so nothing partial lands in outDir.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'fdeploy-'));

  try {
    for (const variant of variants) {
      const itemSlug = variant === 'free' ? baseSlug : proSlug;
      const itemDir = path.join(stage, variant, itemSlug);
      log(`build ${variant}: ${itemSlug}${version ? ' v' + version : ''}`);
      const stats = buildVariant({ sourceDir, destItemDir: itemDir, variant, config });

      const entry = { slug: itemSlug, dir: null, zip: null, files: stats.files, dirs: stats.dirs };

      if (o.keep) {
        const keepDir = path.join(outDir, `${itemSlug}${variant === 'free' ? '' : ''}`);
        fs.rmSync(keepDir, { recursive: true, force: true });
        fs.cpSync(itemDir, keepDir, { recursive: true });
        entry.dir = keepDir;
      }

      if (doZip) {
        const vtag = version ? `-v${version}` : '';
        // The "-free" suffix only disambiguates from a pro zip; when there is no pro
        // build (free-only), name it cleanly as <slug>-v<version>.zip.
        const zipName = variant === 'free' && variants.includes('premium')
          ? `${itemSlug}-free${vtag}.zip`
          : `${itemSlug}${vtag}.zip`;
        const zipPath = path.join(outDir, zipName);
        fs.rmSync(zipPath, { force: true });
        await zipDir(itemDir, zipPath, itemSlug);
        entry.zip = zipPath;
        log(`  zipped -> ${path.basename(zipPath)}`);
      }

      result[variant] = entry;
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }

  return result;
}

export default { build };
