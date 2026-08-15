import fs from 'node:fs';
import path from 'node:path';

const API_ROUTE = '/wp-json/wp-deploy/v1/download';

/** Accept a bare site URL (append the route) or a full endpoint URL (use as-is). */
export function resolveApiEndpoint(url) {
  if (!url) return url;
  const u = String(url).replace(/\/+$/, '');
  return u.includes('/wp-json/') ? u : `${u}${API_ROUTE}`;
}

/**
 * Upload built zips to the Freemium Deploy Endpoint (wordpress-plugin/) which sets
 * each EDD download's file + SL version/changelog. One request per download.
 *
 * Auth: Bearer token (FD_API_TOKEN) or Basic (WP user + Application Password).
 *
 * @param {object} o
 * @param {string} o.endpoint      site base URL (e.g. https://shop.example.com) — the
 *                                 /wp-json/wp-deploy/v1/download route is appended; a full
 *                                 endpoint URL is also accepted as-is
 * @param {string} [o.token]       shared bearer token
 * @param {string} [o.user] @param {string} [o.appPassword]  Basic-auth alternative
 * @param {number|string} [o.downloadId] @param {number|string} [o.downloadFreeId]
 * @param {string} o.version @param {string} [o.changelog]
 * @param {{variant:string,path?:string,url?:string,name?:string}[]} o.files
 * @param {boolean} [o.dryRun]
 * @returns {Promise<object[]>}
 */
export async function syncViaApi(o) {
  const endpoint = resolveApiEndpoint(o.endpoint);
  const targets = [
    { id: o.downloadId, variant: 'premium', fileId: o.fileId },
    { id: o.downloadFreeId, variant: 'free', fileId: o.fileFreeId },
  ].filter((t) => t.id);

  const authHeader = () => {
    if (o.token) return { Authorization: `Bearer ${o.token}` };
    if (o.user && o.appPassword) {
      const pw = String(o.appPassword).replace(/\s+/g, '');
      return { Authorization: 'Basic ' + Buffer.from(`${o.user}:${pw}`).toString('base64') };
    }
    return {};
  };

  const results = [];
  for (const t of targets) {
    const file = (o.files || []).find((f) => f.variant === t.variant);
    const zipPath = file && file.path;
    const name = zipPath ? path.basename(zipPath) : (file && file.name);

    if (o.dryRun) {
      results.push({
        variant: t.variant, id: t.id, file_id: t.fileId != null ? t.fileId : 0,
        request: { endpoint, download_id: t.id, file_id: t.fileId, version: o.version, file: name, file_url: file && file.url },
      });
      continue;
    }

    const form = new FormData();
    form.set('download_id', String(t.id));
    form.set('variant', t.variant);
    if (t.fileId != null && t.fileId !== '') form.set('file_id', String(t.fileId));
    if (o.version) form.set('version', o.version);
    if (o.changelog) form.set('changelog', o.changelog);
    if (zipPath && fs.existsSync(zipPath)) {
      form.set('file', new Blob([fs.readFileSync(zipPath)], { type: 'application/zip' }), name);
      form.set('file_name', name);
    } else if (file && file.url) {
      form.set('file_url', file.url);
      if (name) form.set('file_name', name);
    } else {
      throw new Error(`No zip or url available for ${t.variant} (build with zips or pass a URL)`);
    }

    const res = await fetch(endpoint, { method: 'POST', headers: authHeader(), body: form });
    let json = {};
    try { json = await res.json(); } catch { /* non-json */ }
    if (!res.ok || json.ok === false) {
      throw new Error(`API ${res.status}: ${json.message || JSON.stringify(json)}`);
    }
    results.push({ variant: t.variant, id: t.id, ok: true, file: json.file });
  }
  return results;
}
