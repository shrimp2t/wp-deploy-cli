import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVariant } from '../src/deploy.js';
import { detectType } from '../src/meta.js';
import { loadConfig } from '../src/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'build-'));

test('detectType: a plugin header wins over a stray style.css', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'style.css'), '/* stray */');
  fs.writeFileSync(path.join(dir, 'x.php'), '<?php /*\nPlugin Name: X\n*/');
  assert.equal(detectType(dir), 'plugin');
});

test('detectType: style.css with no plugin header -> theme', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'style.css'), '/*\nTheme Name: X\n*/');
  assert.equal(detectType(dir), 'theme');
});

test('.svnignore/.distignore excludes node_modules & listed files, keeps the rest', () => {
  const src = tmp();
  fs.writeFileSync(path.join(src, 'main.php'), '<?php /*\nPlugin Name: X\nVersion: 1.0.0\n*/');
  fs.mkdirSync(path.join(src, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(src, 'node_modules', 'dep', 'i.js'), 'x');
  fs.mkdirSync(path.join(src, 'src'));
  fs.writeFileSync(path.join(src, 'src', 'app.jsx'), 'x');
  fs.writeFileSync(path.join(src, 'deploy.sh'), '#');
  fs.writeFileSync(path.join(src, '.svnignore'), '/node_modules\n/docs\ndeploy.sh\n');

  const dest = path.join(tmp(), 'out');
  buildVariant({ sourceDir: src, destItemDir: dest, variant: 'free', config: loadConfig(src, {}) });

  assert.ok(!fs.existsSync(path.join(dest, 'node_modules')), 'node_modules excluded');
  assert.ok(!fs.existsSync(path.join(dest, 'deploy.sh')), 'deploy.sh excluded');
  assert.ok(fs.existsSync(path.join(dest, 'src', 'app.jsx')), 'src kept');
  assert.ok(fs.existsSync(path.join(dest, 'main.php')), 'main file kept');
});
