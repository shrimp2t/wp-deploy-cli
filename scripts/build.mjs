#!/usr/bin/env node
/**
 * Build distributables into ./dist :
 *   - dist/freemium-deploy-endpoint-<version>.zip  (WordPress plugin, foldered)
 *   - dist/wp-deploy-cli-<version>.zip             (the CLI/library package)
 *
 * Version comes from package.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

/** Zip a list of { src, dest } entries (src = abs file/dir, dest = path inside the zip). */
function makeZip(outFile, entries) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(archive.pointer()));
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const e of entries) {
      if (!fs.existsSync(e.src)) continue;
      if (fs.statSync(e.src).isDirectory()) archive.directory(e.src, e.dest);
      else archive.file(e.src, { name: e.dest });
    }
    archive.finalize();
  });
}

const abs = (p) => path.join(root, p);
const human = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1024) + 'K');

// --- 1) Plugin zip: top-level folder freemium-deploy-endpoint/ ---------------
const pluginZip = path.join(dist, `freemium-deploy-endpoint-${version}.zip`);
fs.rmSync(pluginZip, { force: true });
const pluginBytes = await makeZip(pluginZip, [
  { src: abs('wordpress-plugin/freemium-deploy-endpoint.php'), dest: 'freemium-deploy-endpoint/freemium-deploy-endpoint.php' },
]);

// --- 2) CLI zip: top-level folder wp-deploy-cli/ -----------------------------
const cliZip = path.join(dist, `wp-deploy-cli-${version}.zip`);
fs.rmSync(cliZip, { force: true });
const cliIncludes = [
  'bin', 'src', 'wordpress-plugin', 'examples',
  'README.md', 'package.json', 'package-lock.json', '.env.example',
];
const cliBytes = await makeZip(
  cliZip,
  cliIncludes.map((p) => ({ src: abs(p), dest: `wp-deploy-cli/${p}` })),
);

console.log(`Built v${version} into ./dist:`);
console.log(`  ${path.basename(pluginZip)}  (${human(pluginBytes)})`);
console.log(`  ${path.basename(cliZip)}  (${human(cliBytes)})`);
