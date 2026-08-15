import fs from 'node:fs';
import path from 'node:path';

/** Read a WordPress-style header field (e.g. "Version") from file content. */
function headerValue(content, field) {
  const re = new RegExp(`^[ \\t/*#@]*${field}\\s*:\\s*(.+)$`, 'im');
  const m = content.match(re);
  if (!m) return '';
  // Strip a trailing comment/PHP close (e.g. "1.0.0 */") like WP's get_file_data.
  return m[1].replace(/\s*(?:\*\/|\?>).*$/, '').trim();
}

function readTop(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);
}

/** Detect whether the source is a theme or a plugin. */
export function detectType(sourceDir, configType) {
  if (configType === 'theme' || configType === 'plugin') return configType;
  // A plugin is any root .php with a "Plugin Name:" header — this wins even when a
  // stray style.css exists at the plugin root (which would otherwise look like a theme).
  for (const f of readTop(sourceDir)) {
    if (f.toLowerCase().endsWith('.php')) {
      const content = fs.readFileSync(path.join(sourceDir, f), 'utf8');
      if (/^[\s*#@/]*Plugin Name\s*:/im.test(content)) return 'plugin';
    }
  }
  if (fs.existsSync(path.join(sourceDir, 'style.css'))) return 'theme';
  return 'plugin';
}

/** Read the version from style.css (theme) or the main plugin header. */
export function readVersion(sourceDir, type) {
  if (type === 'theme') {
    const style = path.join(sourceDir, 'style.css');
    if (fs.existsSync(style)) {
      const v = headerValue(fs.readFileSync(style, 'utf8'), 'Version');
      if (v) return v;
    }
    return '';
  }
  for (const f of readTop(sourceDir)) {
    if (f.toLowerCase().endsWith('.php')) {
      const content = fs.readFileSync(path.join(sourceDir, f), 'utf8');
      if (/Plugin Name\s*:/i.test(content)) {
        const v = headerValue(content, 'Version');
        if (v) return v;
      }
    }
  }
  return '';
}

/** Read the display name from style.css (theme) or plugin header. */
export function readName(sourceDir, type) {
  if (type === 'theme') {
    const style = path.join(sourceDir, 'style.css');
    if (fs.existsSync(style)) {
      const n = headerValue(fs.readFileSync(style, 'utf8'), 'Theme Name');
      if (n) return n;
    }
    return '';
  }
  for (const f of readTop(sourceDir)) {
    if (f.toLowerCase().endsWith('.php')) {
      const content = fs.readFileSync(path.join(sourceDir, f), 'utf8');
      const n = headerValue(content, 'Plugin Name');
      if (n) return n;
    }
  }
  return '';
}

/** Extract the newest changelog block from readme.txt / changelog.txt (best effort). */
export function readChangelog(dir) {
  for (const name of ['changelog.txt', 'CHANGELOG.md', 'changelog.md', 'readme.txt']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }
  return '';
}
