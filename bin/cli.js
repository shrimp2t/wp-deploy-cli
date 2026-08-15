#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fsx from 'node:fs';
import osx from 'node:os';
import { build, buildVariantToDir } from '../src/index.js';
import { deployToSvn } from '../src/svn.js';
import { ghDownloadSource, ghRelease } from '../src/ghcli.js';
import { readChangelog } from '../src/meta.js';
import { loadEnv, envBool } from '../src/env.js';
import * as gh from '../src/github.js';
import { syncEdd } from '../src/edd.js';
import { syncViaWpRest } from '../src/wp.js';
import { syncViaWpCli } from '../src/wpcli.js';
import { syncViaApi } from '../src/fdapi.js';

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

const HELP = `wp-deploy-cli — build Free + Pro (premium) distributables from one source.

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

WordPress.org SVN (deploy the FREE build to plugins/themes SVN):
  --svn                      Enable SVN deploy of the free variant
  --svn-slug=SLUG            wp.org slug (default: the free build slug)
  --svn-user=USER            wp.org username        (or SVN_USER)
  --svn-password=PASS        wp.org password        (or SVN_PASSWORD; never stored)
  --svn-url=URL              Override the SVN URL
  --svn-message=MSG          Commit message (default: "Release <version>")
  --svn-no-tag               (plugins) skip creating tags/<version>

GitHub — via the gh CLI (run \`gh auth login\` once):
  --github-publish           Create/update a GitHub release and upload the built zips
  --github-repo=OWNER/NAME   Target repo (default: the git repo at --path)
  --github-tag=TAG           Release tag (default: v<version>)
  --no-fetch                 Build --path locally instead of downloading a release's source
  (With both --github-repo and --github-tag, source is built FROM that release
   unless --no-fetch; add --github-publish to upload the built zips back.)

EDD sync via companion plugin API (uploads the zip + sets the download file):
  --api-url=URL              Endpoint from wordpress-plugin/ (…/wp-deploy/v1/download)
  --api-token=TOKEN          Shared bearer token (FD_API_TOKEN on the site), OR
  --api-user=USER --api-app-password=PASS   Application Password auth
  --download-id=N            Pro download id
  --download-free-id=N       Free download id
  --insecure                 Allow self-signed TLS (local Studio sites)

EDD sync via WP-CLI (zero site-code; writes protected SL meta directly):
  --wp-cli[=CMD]             Enable; CMD is the base command (default "wp", or "studio wp")
  --wp-path=DIR              Run WP-CLI from this site dir (Studio auto-detects the site)
  --download-id=N            Pro download id
  --download-free-id=N       Free download id

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
    // WP-CLI (zero site-code) path — can write protected SL meta directly.
    wpCli: args['wp-cli'] !== undefined || envBool(env.WP_CLI),
    wpCliCommand: (typeof args['wp-cli'] === 'string' ? args['wp-cli'] : undefined) || env.WP_CLI_COMMAND || 'wp',
    wpPath: pick(args['wp-path'], env.WP_PATH),
    // WordPress.org SVN deploy of the FREE build.
    svn: !!args.svn || envBool(env.SVN),
    svnSlug: pick(args['svn-slug'], env.SVN_SLUG),
    svnUser: pick(args['svn-user'], env.SVN_USER),
    svnPassword: pick(args['svn-password'], env.SVN_PASSWORD),
    svnUrl: pick(args['svn-url'], env.SVN_URL),
    svnMessage: pick(args['svn-message'], env.SVN_MESSAGE),
    svnNoTag: !!args['svn-no-tag'],
    // Custom Freemium Deploy Endpoint (uploads file + sets download file/version).
    apiUrl: pick(args['api-url'], env.FD_API_URL),
    apiToken: pick(args['api-token'], env.FD_API_TOKEN),
    apiUser: pick(args['api-user'], env.FD_API_USER),
    apiAppPassword: pick(args['api-app-password'], env.FD_API_APP_PASSWORD),
    out: pick(args.out, env.OUT_DIR),
  };

  // Allow self-signed TLS for local Studio sites (opt-in).
  if (args.insecure || envBool(env.FD_INSECURE_TLS)) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const log = (m) => process.stdout.write(`${m}\n`);
  const dryRun = !!args['dry-run'];

  // --- resolve source (local dir or GitHub release) ---------------------------
  let sourceDir = args.path ? String(args.path) : '.';
  let cleanupSource = null;

  if (cfg.githubRepo && cfg.githubTag && !args['no-fetch']) {
    // Build from a release's source (downloaded via the gh CLI).
    sourceDir = ghDownloadSource(cfg.githubRepo, cfg.githubTag, { log });
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

  // --- GitHub release (via gh CLI): create/update release + upload built zips -
  if (cfg.githubPublish) {
    log('');
    const ghTag = cfg.githubTag || (result.version ? `v${result.version}` : null);
    if (!ghTag) throw new Error('GitHub publish needs a tag (--github-tag or a readable version)');
    const assets = variants.map((v) => result[v] && result[v].zip).filter(Boolean);
    const cl = readChangelog(result.source);
    const notes = cl ? `Release ${ghTag}\n\n${cl}` : `Release ${ghTag}`;
    const res = ghRelease({
      repo: cfg.githubRepo,                       // optional; else the repo at --path
      tag: ghTag,
      title: ghTag,
      notes,
      assets,
      cwd: path.resolve(String(args.path || '.')),
      dryRun,
      log,
    });
    log(`↑ ${assets.length} asset(s) → ${res.repo}${res.url ? ' (' + res.url + ')' : ' ' + ghTag}`);
  }

  // --- WordPress.org SVN deploy (FREE build) ----------------------------------
  if (cfg.svn) {
    log('');
    const stageRoot = fsx.mkdtempSync(path.join(osx.tmpdir(), 'wpsvn-stage-'));
    try {
      const staged = buildVariantToDir({ path: sourceDir, variant: 'free', dir: stageRoot });
      deployToSvn({
        sourceDir: staged.dir,
        slug: cfg.svnSlug || staged.slug,
        type: staged.type,
        version: staged.version || result.version,
        user: cfg.svnUser,
        password: cfg.svnPassword,
        url: cfg.svnUrl,
        message: cfg.svnMessage,
        tag: !cfg.svnNoTag,
        dryRun,
        log,
      });
    } finally {
      fsx.rmSync(stageRoot, { recursive: true, force: true });
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

  // Custom API endpoint: uploads the zip and sets the download file + version/changelog.
  if (cfg.apiUrl) {
    log('');
    const res = await syncViaApi({
      endpoint: cfg.apiUrl,
      token: cfg.apiToken,
      user: cfg.apiUser,
      appPassword: cfg.apiAppPassword,
      downloadId: cfg.downloadId,
      downloadFreeId: cfg.downloadFreeId,
      version: result.version,
      changelog,
      files,
      dryRun,
    });
    log(dryRun ? '[dry-run] API requests prepared' : `↔ API sync done (${res.length} download(s))`);
    if (dryRun) log(JSON.stringify(res, null, 2));
    else res.forEach((r) => log(`  ${r.variant} #${r.id} -> ${r.file}`));
  } else if (cfg.wpCli) {
    // Zero site-code: WP-CLI (writes protected SL meta directly; no plugin, no REST registration).
    log('');
    const res = syncViaWpCli({
      command: cfg.wpCliCommand,
      cwd: cfg.wpPath,
      downloadId: cfg.downloadId,
      downloadFreeId: cfg.downloadFreeId,
      version: result.version,
      changelog,
      dryRun,
    });
    log(dryRun ? '[dry-run] WP-CLI commands prepared' : `↔ WP-CLI sync done (${res.length} download(s))`);
    if (dryRun) log(JSON.stringify(res, null, 2));
  } else if (cfg.wpUrl) {
    // WordPress core REST (existing /wp-json/wp/v2/edd-downloads endpoint).
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
