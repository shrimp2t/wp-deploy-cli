import fs from 'node:fs';
import path from 'node:path';

/**
 * Sync a built version to an Easy Digital Downloads site.
 *
 * A generic Node CLI cannot write WP/EDD post meta directly, so this POSTs a
 * signed JSON payload to a small companion endpoint you expose on the EDD site
 * (e.g. a `register_rest_route` handler) which then updates the download's
 * `edd_download_files`, `_edd_sl_version`, and `_edd_sl_changelog`.
 *
 * The expected receiver contract is documented in README.md ("EDD sync").
 *
 * @param {object} o
 * @param {string} o.endpoint      full URL of the receiver
 * @param {string} [o.token]       shared secret sent as `Authorization: Bearer`
 * @param {number|string} [o.downloadId]      EDD download id (pro)
 * @param {number|string} [o.downloadFreeId]  EDD download id (free)
 * @param {string} o.version
 * @param {string} [o.changelog]
 * @param {{variant:string,name:string,url?:string,path?:string}[]} o.files
 * @param {boolean} [o.dryRun]
 * @returns {Promise<object>} the receiver's JSON response (or the payload on dry-run)
 */
export async function syncEdd(o) {
  const payload = {
    version: o.version,
    changelog: o.changelog || '',
    download_id: o.downloadId != null ? Number(o.downloadId) : null,
    download_free_id: o.downloadFreeId != null ? Number(o.downloadFreeId) : null,
    files: (o.files || []).map((f) => ({
      variant: f.variant,
      name: f.name,
      url: f.url || null,
      size: f.path && fs.existsSync(f.path) ? fs.statSync(f.path).size : null,
      basename: f.path ? path.basename(f.path) : f.name,
    })),
  };

  if (o.dryRun) return { dryRun: true, endpoint: o.endpoint, payload };
  if (!o.endpoint) throw new Error('EDD sync requires --edd-endpoint');

  const res = await fetch(o.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`EDD sync -> ${res.status} ${res.statusText} ${text.slice(0, 300)}`);
  }
  return res.json().catch(() => ({ ok: true }));
}
