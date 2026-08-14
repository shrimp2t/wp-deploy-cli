#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/index.js';
import { readChangelog } from '../src/meta.js';
import { loadEnv, envBool } from '../src/env.js';
import * as gh from '../src/github.js';
import { syncEdd } from '../src/edd.js';
import { syncViaWpRest } from '../src/wp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) args[a.slice(2, eq)] = a.slice(eq + 1);
      else args[a.slice(2)] = true;
    } else if (a.startsWith('-') && a.length > 1) {
      args[a.slice(1)] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

// A --flag=value wins; otherwise fall back to the .env / environment variable.
function pick(argVal, envVal) {
  if (argVal === undefined) return envVal || undefined;
  if (argVal === true) return true;            // bare flag
  return String(argVal);
}

const HELP = `freemium-deploy — build Free + Pro (premium) distributables from one source.

Usage:
  cd path/to/theme_or_plugin
  deploy-version --path=.

Config: a .env file in the current directory is auto-loaded and used as defaults.
See .env.example. Flags override .env; real environment variables win in CI.

Build options:
  --path=DIR            Source theme/plugin directory (default: current dir ".")
  --out=DIR             Output directory (default: sibling "dist/" of the source)
  --free-only           Build only the free variant
  --pro-only            Build only the premium variant
  --no-zip              Emit unzipped folders only
  --keep                Keep the unzipped build folders (in addition to zips)

GitHub (needs GITHUB_TOKEN or --github-token):
  --github-repo=OWNER/NAME   Fetch source from a release instead of --path
  --github-tag=TAG           Release tag to build (e.g. v1.2.3)
  --github-publish           Upload the built free/pro zips as assets of that release

EDD sync via WordPress core REST (existing /wp-json/wp/v2/edd-downloads endpoint):
  --wp-url=URL               EDD site URL
  --wp-user=USER             WP username
  --wp-app-password=PASS     Application Password (WP core >= 5.6)
  --wp-rest-base=BASE        REST base (default: edd-downloads)
  --download-id=N            Pro download id
  --download-free-id=N       Free download id
  (writes _edd_sl_version + _edd_sl_changelog; needs the tiny meta-registration
   mu-plugin from examples/ — it enables those existing fields, adds no new route)

EDD sync via custom endpoint (fallback):
  --edd-endpoint=URL --edd-token=SECRET

Misc:
  --dry-run             Print what would happen; do not publish/sync
  -h, --help            Show this help
  -v, --version         Show version
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) { process.stdout.write(HELP); return; }
  if (args.version || args.v) {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  // Load .env from the current working directory (real env vars still win).
  loadEnv(process.cwd());
  const env = process.env;

  // Resolve effective settings: CLI flag > .env / environment.
  const cfg = {
    githubRepo: pick(args['github-repo'], env.GITHUB_REPO),
    githubTag: pick(args['github-tag'], env.GITHUB_TAG),
    githubPublish: args['github-publish'] === true || envBool(env.GITHUB_PUBLISH),
    githubToken: gh.resolveToken(args['github-token'] === true ? '' : args['github-token']),
    eddEndpoint: pick(args['edd-endpoint'], env.EDD_ENDPOINT),
    eddToken: pick(args['edd-token'], env.EDD_TOKEN),
    downloadId: pick(args['download-id'], env.EDD_DOWNLOAD_ID),
    downloadFreeId: pick(args['download-free-id'], env.EDD_DOWNLOAD_FREE_ID),
    // WordPress core REST (Application Passwords) — the "existing API" path.
    wpUrl: pick(args['wp-url'], env.WP_URL),
    wpUser: pick(args['wp-user'], env.WP_USER),
    wpAppPassword: pick(args['wp-app-password'], env.WP_APP_PASSWORD),
    wpRestBase: pick(args['wp-rest-base'], env.WP_REST_BASE) || 'edd-downloads',
    out: pick(args.out, env.OUT_DIR),
  };

  const log = (m) => process.stdout.write(`${m}\n`);
  const dryRun = !!args['dry-run'];

  // --- resolve source (local dir or GitHub release) ---------------------------
  let sourceDir = args.path ? String(args.path) : '.';
  let cleanupSource = null;

  if (cfg.githubRepo) {
    if (!cfg.githubTag) throw new Error('A release tag is required (--github-tag or GITHUB_TAG)');
    if (!cfg.githubToken) throw new Error('GitHub access needs a token (GITHUB_TOKEN or --github-token=...)');
    log(`↓ fetching ${cfg.githubRepo}@${cfg.githubTag} source`);
    sourceDir = await gh.downloadSource(cfg.githubRepo, cfg.githubTag, cfg.githubToken);
    cleanupSource = path.dirname(sourceDir);
  }

  // --- variants ---------------------------------------------------------------
  let variants = ['free', 'premium'];
  if (args['free-only']) variants = ['free'];
  if (args['pro-only']) variants = ['premium'];

  // --- build ------------------------------------------------------------------
  const result = await build({
    path: sourceDir,
    out: cfg.out,
    variants,
    zip: !args['no-zip'],
    keep: !!args.keep,
    log,
  });

  log('');
  log(`✓ ${result.name || path.basename(result.source)}  (${result.type}${result.version ? ' v' + result.version : ''})`);
  for (const v of variants) {
    const e = result[v];
    if (!e) continue;
    const where = e.zip || e.dir || '(built)';
    log(`  ${v.padEnd(7)} ${e.slug}  ${e.files} files  ->  ${path.relative(process.cwd(), where) || where}`);
  }

  // --- GitHub publish ---------------------------------------------------------
  if (cfg.githubPublish) {
    if (!cfg.githubRepo || !cfg.githubTag) {
      throw new Error('Publishing needs a repo and tag (--github-repo/--github-tag or GITHUB_REPO/GITHUB_TAG)');
    }
    if (!cfg.githubToken) throw new Error('Publishing needs a GitHub token');
    log('');
    const release = await gh.getReleaseByTag(cfg.githubRepo, cfg.githubTag, cfg.githubToken);
    release._repo = cfg.githubRepo;
    for (const v of variants) {
      const e = result[v];
      if (!e || !e.zip) continue;
      if (dryRun) { log(`[dry-run] would upload ${path.basename(e.zip)} to ${release._repo}@${cfg.githubTag}`); continue; }
      const asset = await gh.uploadReleaseAsset(release, e.zip, cfg.githubToken);
      e.assetUrl = asset.browser_download_url;
      log(`↑ uploaded ${path.basename(e.zip)} -> ${asset.browser_download_url}`);
    }
  }

  // --- EDD / WordPress sync ---------------------------------------------------
  const files = variants.map((v) => result[v]).filter(Boolean).map((e) => ({
    variant: e === result.free ? 'free' : 'premium',
    name: e.zip ? path.basename(e.zip) : e.slug,
    url: e.assetUrl,
    path: e.zip,
  }));
  const changelog = readChangelog(result.source);

  // Preferred: WordPress core REST (existing /wp-json/wp/v2/edd-downloads endpoint).
  if (cfg.wpUrl) {
    if (!cfg.wpUser || !cfg.wpAppPassword) {
      throw new Error('WP REST sync needs WP_USER and WP_APP_PASSWORD (or --wp-user/--wp-app-password)');
    }
    log('');
    const res = await syncViaWpRest({
      baseUrl: cfg.wpUrl,
      restBase: cfg.wpRestBase,
      user: cfg.wpUser,
      appPassword: cfg.wpAppPassword,
      downloadId: cfg.downloadId,
      downloadFreeId: cfg.downloadFreeId,
      version: result.version,
      changelog,
      files,
      dryRun,
    });
    log(dryRun ? '[dry-run] WP REST requests prepared' : `↔ WP REST sync done (${res.length} download(s))`);
    if (dryRun) log(JSON.stringify(res, null, 2));
  } else if (cfg.eddEndpoint || (dryRun && cfg.downloadId)) {
    // Fallback: custom companion endpoint.
    log('');
    const eddRes = await syncEdd({
      endpoint: cfg.eddEndpoint || '',
      token: cfg.eddToken,
      downloadId: cfg.downloadId,
      downloadFreeId: cfg.downloadFreeId,
      version: result.version,
      changelog,
      files,
      dryRun,
    });
    log(dryRun ? '[dry-run] EDD payload prepared' : '↔ EDD sync done');
    if (dryRun) log(JSON.stringify(eddRes.payload, null, 2));
  }

  if (cleanupSource) fs.rmSync(cleanupSource, { recursive: true, force: true });
}

main().catch((err) => {
  process.stderr.write(`\x1b[31mError: ${err.message}\x1b[0m\n`);
  process.exit(1);
});
