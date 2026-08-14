import { execFileSync } from 'node:child_process';

/**
 * Zero-site-code sync using the existing WP-CLI (`wp`, or `studio wp` on Studio).
 *
 * Unlike REST, WP-CLI writes any post meta directly, so it can set the protected
 * Software Licensing keys (`_edd_sl_version`, `_edd_sl_changelog`) with no plugin
 * and no meta registration.
 *
 * @param {object} o
 * @param {string} [o.command='wp']  base command, e.g. "wp" or "studio wp"
 * @param {string} [o.cwd]           working dir (used to target a Studio site)
 * @param {number|string} [o.downloadId]      pro download id
 * @param {number|string} [o.downloadFreeId]  free download id
 * @param {string} o.version
 * @param {string} [o.changelog]
 * @param {boolean} [o.dryRun]
 * @returns {object[]} per-download results
 */
export function syncViaWpCli(o) {
  const parts = String(o.command || 'wp').trim().split(/\s+/);
  const program = parts[0];
  const prefix = parts.slice(1);
  const execOpts = { cwd: o.cwd || undefined, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

  const targets = [
    { id: o.downloadId, variant: 'premium' },
    { id: o.downloadFreeId, variant: 'free' },
  ].filter((t) => t.id);

  const results = [];
  for (const t of targets) {
    const updates = [];
    if (o.version) updates.push(['_edd_sl_version', String(o.version)]);
    if (o.changelog) updates.push(['_edd_sl_changelog', String(o.changelog)]);

    for (const [key, val] of updates) {
      // Args are passed as an array (no shell), so multiline/special values are safe.
      const args = [...prefix, 'post', 'meta', 'update', String(t.id), key, val];
      if (o.dryRun) {
        results.push({ variant: t.variant, id: t.id, key, command: `${program} ${[...prefix, 'post', 'meta', 'update', t.id, key, '<value>'].join(' ')}` });
        continue;
      }
      execFileSync(program, args, execOpts);
    }
    if (!o.dryRun) results.push({ variant: t.variant, id: t.id, ok: true, version: o.version });
  }
  return results;
}
