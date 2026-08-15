import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** True if `gh <args>` exits 0. */
function ghOk(args, cwd) {
  try { execFileSync('gh', args, { cwd, stdio: 'ignore' }); return true; }
  catch { return false; }
}
function ghCapture(args, cwd) {
  return execFileSync('gh', args, { cwd, encoding: 'utf8' }).trim();
}

function ensureGh() {
  if (!ghOk(['--version'])) throw new Error('GitHub CLI (gh) is required — https://cli.github.com');
  if (!ghOk(['auth', 'status'])) throw new Error('gh is not authenticated — run: gh auth login');
}

/** Resolve owner/name from an explicit value or the git repo at cwd. */
export function resolveRepo(repo, cwd) {
  if (repo) return repo;
  try { return ghCapture(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], cwd); }
  catch { return null; }
}

/**
 * Download a release's source archive via gh and extract it.
 * @returns {string} extracted source folder
 */
export function ghDownloadSource(repo, tag, { log } = {}) {
  ensureGh();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghsrc-'));
  const zip = path.join(tmp, 'source.zip');
  if (log) log(`↓ gh release download ${repo}@${tag} (source)`);
  execFileSync('gh', ['release', 'download', tag, '-R', repo, '--archive', 'zip', '--output', zip], { stdio: 'inherit' });
  execFileSync('unzip', ['-q', zip, '-d', tmp]);
  fs.rmSync(zip, { force: true });
  const inner = fs.readdirSync(tmp, { withFileTypes: true }).find((d) => d.isDirectory());
  if (!inner) throw new Error('Could not find extracted source folder');
  return path.join(tmp, inner.name);
}

/**
 * Create (or update) a GitHub release via gh and upload assets.
 *
 * @param {object} o
 * @param {string} [o.repo]        owner/name (default: git repo at o.cwd)
 * @param {string} o.tag           e.g. v1.2.3
 * @param {string} [o.title]
 * @param {string} [o.notes]
 * @param {string[]} [o.assets]    file paths to attach
 * @param {string} [o.target]      target branch/commit for a new tag
 * @param {string} [o.cwd]         used to auto-detect the repo
 * @param {boolean} [o.dryRun]
 * @param {(m:string)=>void} [o.log]
 * @returns {{repo:string, tag:string, url?:string}}
 */
export function ghRelease(o) {
  ensureGh();
  const log = o.log || (() => {});
  const repo = resolveRepo(o.repo, o.cwd);
  if (!repo) throw new Error('No GitHub repo — pass --github-repo or run inside the plugin/theme repo');
  const R = ['-R', repo];
  const assets = (o.assets || []).filter(Boolean);

  const notesFile = path.join(os.tmpdir(), `ghnotes-${o.tag}-${process.pid}.txt`);
  fs.writeFileSync(notesFile, o.notes || `Release ${o.tag}`);

  const run = (args) => {
    if (o.dryRun) { log(`   [dry-run] gh ${args.join(' ')}`); return ''; }
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  };

  try {
    const exists = ghOk(['release', 'view', o.tag, ...R]);
    if (exists) {
      log(`   release ${o.tag} exists → updating (${repo})`);
      run(['release', 'edit', o.tag, ...R, '--title', o.title || o.tag, '--notes-file', notesFile]);
      if (assets.length) run(['release', 'upload', o.tag, ...assets, ...R, '--clobber']);
    } else {
      log(`   release ${o.tag} → creating (${repo})`);
      run(['release', 'create', o.tag, ...assets, ...R,
        '--title', o.title || o.tag, '--notes-file', notesFile,
        ...(o.target ? ['--target', o.target] : [])]);
    }
  } finally {
    fs.rmSync(notesFile, { force: true });
  }

  let url;
  if (!o.dryRun) { try { url = ghCapture(['release', 'view', o.tag, ...R, '--json', 'url', '-q', '.url']); } catch { /* */ } }
  return { repo, tag: o.tag, url };
}
