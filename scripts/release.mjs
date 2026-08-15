#!/usr/bin/env node
/**
 * Release the current package.json version to GitHub.
 *
 *  - version + tag (v<version>) come from package.json
 *  - builds the two dist zips (plugin + CLI)
 *  - pushes the branch and the tag (creating or force-moving the tag)
 *  - if a release for v<version> exists -> updates it (notes + re-uploads assets)
 *    otherwise -> creates it
 *  - uploads both zips as release assets
 *
 * Usage:
 *   npm run release
 *   npm run release -- --dry-run
 *   npm run release -- --repo=owner/name      (or set REPO=owner/name)
 *
 * Requires the GitHub CLI (`gh`) authenticated, and a git remote (or --repo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const repoArg = (argv.find((a) => a.startsWith('--repo=')) || '').split('=')[1] || process.env.REPO;

const C = { cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', off: '\x1b[0m' };
const log = (m) => console.log(m);

function capture(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();
}
function run(cmd, args) {
  if (dryRun) { log(`   ${C.yellow}[dry-run]${C.off} ${cmd} ${args.join(' ')}`); return ''; }
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
}
function exists(cmd, args) {
  try { execFileSync(cmd, args, { cwd: root, stdio: 'ignore' }); return true; } catch { return false; }
}

// --- prerequisites -----------------------------------------------------------
if (!exists('gh', ['--version'])) { console.error(`${C.red}GitHub CLI (gh) is required${C.off}`); process.exit(1); }

// --- resolve repo ------------------------------------------------------------
let repo = repoArg;
if (!repo) {
  try { repo = capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']); }
  catch {
    console.error(`${C.red}No GitHub repo found.${C.off} Create one and add it as 'origin', e.g.:`);
    console.error(`  gh repo create wp-deploy-cli --private --source=. --remote=origin --push`);
    console.error(`…or pass --repo=owner/name`);
    process.exit(1);
  }
}
const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

log(`${C.cyan}Releasing ${tag} -> ${repo} [branch ${branch}]${dryRun ? ' (dry-run)' : ''}${C.off}`);

// --- build the zips ----------------------------------------------------------
log('building dist zips…');
execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' });
const pluginZip = path.join(root, 'dist', `freemium-deploy-endpoint-${version}.zip`);
const cliZip = path.join(root, 'dist', `wp-deploy-cli-${version}.zip`);
for (const z of [pluginZip, cliZip]) {
  if (!fs.existsSync(z)) { console.error(`${C.red}Missing build artifact: ${z}${C.off}`); process.exit(1); }
}

// --- push branch + tag -------------------------------------------------------
run('git', ['push', 'origin', 'HEAD']);
run('git', ['tag', '-f', tag]);
run('git', ['push', '-f', 'origin', `refs/tags/${tag}`]);

// --- notes -------------------------------------------------------------------
const notes = [
  `Release ${tag}.`,
  '',
  'Assets:',
  `- \`${path.basename(cliZip)}\` — the wp-deploy-cli CLI/library`,
  `- \`${path.basename(pluginZip)}\` — the Freemium Deploy Endpoint WordPress plugin`,
].join('\n');
const notesFile = path.join(root, 'dist', `.notes-${version}.txt`);
fs.writeFileSync(notesFile, notes);

// --- create or update the release -------------------------------------------
const releaseExists = exists('gh', ['release', 'view', tag, '-R', repo]);
if (releaseExists) {
  log(`   release ${tag} exists -> updating`);
  run('gh', ['release', 'edit', tag, '-R', repo, '--title', tag, '--notes-file', notesFile, '--target', branch]);
  run('gh', ['release', 'upload', tag, pluginZip, cliZip, '-R', repo, '--clobber']);
} else {
  log(`   release ${tag} not found -> creating`);
  run('gh', ['release', 'create', tag, pluginZip, cliZip, '-R', repo, '--title', tag, '--notes-file', notesFile, '--target', branch]);
}

fs.rmSync(notesFile, { force: true });
log(`${C.green}✓ ${tag} released on ${repo}${C.off}`);
