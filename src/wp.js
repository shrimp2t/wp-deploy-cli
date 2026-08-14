/**
 * WordPress core REST client (reuses the existing endpoint EDD already exposes).
 *
 * EDD registers the `download` post type with show_in_rest = true and
 * rest_base = "edd-downloads", so WP core's standard controller serves:
 *     POST /wp-json/wp/v2/edd-downloads/<id>
 * Auth uses core Application Passwords (Basic auth over HTTPS) — no plugin, no
 * custom endpoint.
 *
 * NOTE: EDD/WP do NOT expose the Software Licensing meta to REST by default
 * (`_edd_sl_version`, `_edd_sl_changelog`, `edd_download_files`). To write them
 * via this endpoint, those existing meta keys must be registered for REST with
 * the small mu-plugin in examples/ — see README.
 */

function basicAuth(user, appPassword) {
  // Application passwords may be shown with spaces; WP accepts them removed.
  const pw = String(appPassword).replace(/\s+/g, '');
  return 'Basic ' + Buffer.from(`${user}:${pw}`).toString('base64');
}

async function wpFetch(url, { auth, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'freemium-deploy',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json && json.message ? json.message : `${res.status} ${res.statusText}`;
    throw new Error(`WP REST ${method} ${url} -> ${msg}`);
  }
  return json;
}

/**
 * Update an EDD download post (title/status/meta) via the core REST endpoint.
 *
 * @param {object} o
 * @param {string} o.baseUrl        site URL, e.g. https://shop.example.com
 * @param {string} [o.restBase='edd-downloads']
 * @param {number|string} o.id
 * @param {string} o.user           WP username
 * @param {string} o.appPassword    Application Password
 * @param {object} [o.meta]         meta keys to set (must be REST-registered)
 * @param {string} [o.status]       e.g. 'publish'
 * @param {boolean} [o.dryRun]
 * @returns {Promise<object>}
 */
export async function updateDownload(o) {
  const restBase = o.restBase || 'edd-downloads';
  const url = `${String(o.baseUrl).replace(/\/+$/, '')}/wp-json/wp/v2/${restBase}/${o.id}`;
  const body = {};
  if (o.status) body.status = o.status;
  if (o.meta && Object.keys(o.meta).length) body.meta = o.meta;

  if (o.dryRun) return { dryRun: true, url, body };

  return wpFetch(url, {
    auth: basicAuth(o.user, o.appPassword),
    method: 'POST',
    body,
  });
}

/**
 * Sync a built version to EDD downloads over WP core REST.
 * Sets the Software Licensing version + changelog on the pro (and free) download.
 *
 * @returns {Promise<object[]>} results per download
 */
export async function syncViaWpRest(o) {
  const results = [];
  const targets = [
    { id: o.downloadId, variant: 'premium' },
    { id: o.downloadFreeId, variant: 'free' },
  ].filter((t) => t.id);

  for (const t of targets) {
    const meta = {};
    if (o.version) meta._edd_sl_version = o.version;
    if (o.changelog) meta._edd_sl_changelog = o.changelog;
    // Optional: point the download's file at the freshly published asset.
    const file = (o.files || []).find((f) => f.variant === t.variant && f.url);
    if (file && o.setFileUrl) meta._fdeploy_file_url = file.url;

    const res = await updateDownload({
      baseUrl: o.baseUrl,
      restBase: o.restBase,
      id: t.id,
      user: o.user,
      appPassword: o.appPassword,
      status: o.status,
      meta,
      dryRun: o.dryRun,
    });
    results.push({ variant: t.variant, id: t.id, ...(o.dryRun ? { request: res } : { ok: true, id: res.id }) });
  }
  return results;
}
