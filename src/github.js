import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = 'https://api.github.com';

function authHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'freemium-deploy',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function resolveToken(explicit) {
  return explicit || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
}

async function ghFetch(url, { token, method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    method,
    headers: { ...authHeaders(token), ...headers },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${method} ${url} -> ${res.status} ${res.statusText} ${text.slice(0, 300)}`);
  }
  return res;
}

/** GET a release object by tag. */
export async function getReleaseByTag(repo, tag, token) {
  const res = await ghFetch(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, { token });
  return res.json();
}

/**
 * Download the source code of a repo at a tag and extract it.
 * @returns {string} absolute path to the extracted source folder
 */
export async function downloadSource(repo, tag, token) {
  const res = await ghFetch(`/repos/${repo}/zipball/${encodeURIComponent(tag)}`, { token });
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fdeploy-src-'));
  const zipPath = path.join(tmp, 'source.zip');
  fs.writeFileSync(zipPath, buf);
  // Use the system `unzip` (present on macOS and CI runners).
  execFileSync('unzip', ['-q', zipPath, '-d', tmp]);
  fs.rmSync(zipPath, { force: true });
  // GitHub zipballs contain a single top-level folder "<owner>-<repo>-<sha>".
  const inner = fs.readdirSync(tmp, { withFileTypes: true }).find((d) => d.isDirectory());
  if (!inner) throw new Error('Could not find extracted source folder');
  return path.join(tmp, inner.name);
}

/**
 * Upload (or replace) a file as an asset on a release.
 */
export async function uploadReleaseAsset(release, filePath, token) {
  const name = path.basename(filePath);
  // Remove an existing asset with the same name so we can update it.
  const existing = (release.assets || []).find((a) => a.name === name);
  if (existing) {
    await ghFetch(`/repos/${release._repo}/releases/assets/${existing.id}`, { token, method: 'DELETE' });
  }
  const uploadBase = release.upload_url.replace(/\{\?[^}]*\}$/, '');
  const data = fs.readFileSync(filePath);
  const res = await ghFetch(`${uploadBase}?name=${encodeURIComponent(name)}`, {
    token,
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: data,
  });
  return res.json();
}
