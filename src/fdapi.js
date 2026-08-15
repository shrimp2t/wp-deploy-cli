import fs from 'node:fs';
import path from 'node:path';

/**
 * Upload built zips to the Freemium Deploy Endpoint (wordpress-plugin/) which sets
 * each EDD download's file + SL version/changelog. One request per download.
 *
 * Auth: Bearer token (FD_API_TOKEN) or Basic (WP user + Application Password).
 *
 * @param {object} o
 * @param {string} o.endpoint      full URL, e.g. https://shop/wp-json/freemium-deploy/v1/download
 * @param {string} [o.token]       shared bearer token
 * @param {string} [o.user] @param {string} [o.appPassword]  Basic-auth alternative
 * @param {number|string} [o.downloadId] @param {number|string} [o.downloadFreeId]
 * @param {string} o.version @param {string} [o.changelog]
 * @param {{variant:string,path?:string,url?:string,name?:string}[]} o.files
 * @param {boolean} [o.dryRun]
 * @returns {Promise<object[]>}
 */
export async function syncViaApi(o) {
  const targets = [
    { id: o.downloadId, variant: 'premium' },
    { id: o.downloadFreeId, variant: 'free' },
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
        variant: t.variant, id: t.id,
        request: { endpoint: o.endpoint, download_id: t.id, version: o.version, file: name, file_url: file && file.url },
      });
      continue;
    }

    const form = new FormData();
    form.set('download_id', String(t.id));
    form.set('variant', t.variant);
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

    const res = await fetch(o.endpoint, { method: 'POST', headers: authHeader(), body: form });
    let json = {};
    try { json = await res.json(); } catch { /* non-json */ }
    if (!res.ok || json.ok === false) {
      throw new Error(`API ${res.status}: ${json.message || JSON.stringify(json)}`);
    }
    results.push({ variant: t.variant, id: t.id, ok: true, file: json.file });
  }
  return results;
}
