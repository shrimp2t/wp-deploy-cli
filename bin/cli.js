#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/index.js';
import { readChangelog } from '../src/meta.js';
import * as gh from '../src/github.js';
import { syncEdd } from '../src/edd.js';

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

const HELP = `freemium-deploy — build Free + Pro (premium) distributables from one source.

Usage:
  cd path/to/theme_or_plugin
  deploy-version --path=.

  deploy-version --path=/path/to/source [options]

Build options:
  --path=DIR            Source theme/plugin directory (default: current dir ".")
  --out=DIR             Output directory (default: sibling "dist/" of the source)
  --free-only           Build only the free variant
  --pro-only            Build only the premium variant
  --no-zip              Emit unzipped folders only
  --keep                Keep the unzipped build folders (in addition to zips)

GitHub (optional; needs GITHUB_TOKEN or --github-token):
  --github-repo=OWNER/NAME   Fetch source from a release instead of --path
  --github-tag=TAG           Release tag to build (e.g. v1.2.3); required with --github-repo
  --github-publish           Upload the built free/pro zips as assets of that release

EDD sync (optional; needs a companion endpoint — see README):
  --edd-endpoint=URL         Receiver endpoint on the EDD site
  --edd-token=SECRET         Shared secret (sent as Bearer)
  --edd-download-id=N        Pro download id
  --edd-download-free-id=N   Free download id

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

  const log = (m) => process.stdout.write(`${m}\n`);
  const dryRun = !!args['dry-run'];

  // --- resolve source (local dir or GitHub release) ---------------------------
  let sourceDir = args.path ? String(args.path) : '.';
  let cleanupSource = null;
  const token = gh.resolveToken(args['github-token'] === true ? '' : args['github-token']);

  if (args['github-repo']) {
    if (!args['github-tag']) throw new Error('--github-tag is required with --github-repo');
    if (!token) throw new Error('GitHub access needs a token (GITHUB_TOKEN or --github-token=...)');
    log(`↓ fetching ${args['github-repo']}@${args['github-tag']} source`);
    sourceDir = await gh.downloadSource(String(args['github-repo']), String(args['github-tag']), token);
    cleanupSource = path.dirname(sourceDir);
  }

  // --- variants ---------------------------------------------------------------
  let variants = ['free', 'premium'];
  if (args['free-only']) variants = ['free'];
  if (args['pro-only']) variants = ['premium'];

  // --- build ------------------------------------------------------------------
  const result = await build({
    path: sourceDir,
    out: args.out ? String(args.out) : undefined,
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
  if (args['github-publish']) {
    if (!args['github-repo'] || !args['github-tag']) {
      throw new Error('--github-publish requires --github-repo and --github-tag');
    }
    if (!token) throw new Error('--github-publish needs a token');
    log('');
    const release = await gh.getReleaseByTag(String(args['github-repo']), String(args['github-tag']), token);
    release._repo = String(args['github-repo']);
    for (const v of variants) {
      const e = result[v];
      if (!e || !e.zip) continue;
      if (dryRun) { log(`[dry-run] would upload ${path.basename(e.zip)} to ${release._repo}@${args['github-tag']}`); continue; }
      const asset = await gh.uploadReleaseAsset(release, e.zip, token);
      e.assetUrl = asset.browser_download_url;
      log(`↑ uploaded ${path.basename(e.zip)} -> ${asset.browser_download_url}`);
    }
  }

  // --- EDD sync ---------------------------------------------------------------
  if (args['edd-endpoint'] || dryRun && args['edd-download-id']) {
    const files = variants.map((v) => result[v]).filter(Boolean).map((e) => ({
      variant: e === result.free ? 'free' : 'premium',
      name: e.zip ? path.basename(e.zip) : e.slug,
      url: e.assetUrl,
      path: e.zip,
    }));
    log('');
    const eddRes = await syncEdd({
      endpoint: args['edd-endpoint'] ? String(args['edd-endpoint']) : '',
      token: args['edd-token'] ? String(args['edd-token']) : undefined,
      downloadId: args['edd-download-id'],
      downloadFreeId: args['edd-download-free-id'],
      version: result.version,
      changelog: readChangelog(result.source),
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
