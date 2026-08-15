import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv } from '../src/env.js';

function parse(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envtest-'));
  fs.writeFileSync(path.join(dir, '.env'), content);
  const loaded = loadEnv(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return loaded;
}

test('strips inline comments on unquoted values', () => {
  const e = parse('T_ID=15   # EasyMega Pro\nT_FLAG=true    # self-signed\n');
  assert.equal(e.T_ID, '15');
  assert.equal(e.T_FLAG, 'true');
});

test('keeps # inside quoted values; ignores trailing text after the quote', () => {
  const e = parse('T_Q="a # b"   # trailing\nT_S=\'x#y\'\n');
  assert.equal(e.T_Q, 'a # b');
  assert.equal(e.T_S, 'x#y');
});

test('quoted value with spaces (app password) preserved', () => {
  const e = parse('T_PW="nqzH J7US j2wk"\n');
  assert.equal(e.T_PW, 'nqzH J7US j2wk');
});

test('full-line comments and blank lines are ignored', () => {
  const e = parse('# a comment\n\nT_A=1\n');
  assert.equal(e.T_A, '1');
  assert.equal(e.T_COMMENT, undefined);
});
