import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const status = 'website/static/unified-test-status.html';
const statusHtml = readFileSync(status, 'utf8');
const publish = (action, stage, target, previous = 'none') =>
  spawnSync('python3', ['scripts/publish-v3-unified-route.py', action, stage, target, status, previous]);

test('the status page loads with no script, external assets, wallet or source selector', () => {
  assert.match(statusHtml, /Single-position reinvestment/);
  assert.match(statusHtml, /awaiting deployment verification/);
  assert.match(statusHtml, /href="\/hourly-test\/"/);
  assert.doesNotMatch(statusHtml, /<script\b|<form\b|<select\b|\ssrc=|url\(/i);
});

test('install, upgrade and recovery preserve the previous status page and reject unrelated data', t => {
  const directory = mkdtempSync(join(tmpdir(), 'v3-unified-route-'));
  t.after(() => rmSync(directory, {force: true, recursive: true}));
  const stage = join(directory, 'stage');
  const target = join(directory, 'unified-test');
  const file = dir => join(dir, 'index.html');
  mkdirSync(stage);
  writeFileSync(file(stage), statusHtml);
  assert.equal(publish('install', stage, target).status, 0);
  assert.equal(readFileSync(file(target), 'utf8'), statusHtml);
  const previous = statSync(target);
  const previousId = previous.dev + ':' + previous.ino;
  mkdirSync(stage);
  writeFileSync(file(stage), 'preview');
  assert.notEqual(publish('install', stage, target).status, 0);
  writeFileSync(join(target, 'independent.txt'), 'preserve');
  assert.notEqual(publish('install', stage, target, previousId).status, 0);
  assert.equal(readFileSync(join(target, 'independent.txt'), 'utf8'), 'preserve');
  rmSync(join(target, 'independent.txt'));
  assert.equal(publish('install', stage, target, previousId).status, 0);
  assert.equal(readFileSync(file(target), 'utf8'), 'preview');
  assert.equal(readFileSync(file(stage), 'utf8'), statusHtml);
  assert.equal(publish('rollback', stage, target, previousId).status, 0);
  assert.equal(readFileSync(file(target), 'utf8'), statusHtml);
  assert.equal(readFileSync(file(stage), 'utf8'), 'preview');
});

test('a full installer-owned build upgrades atomically; editing any asset disables replacement', t => {
  const dir = mkdtempSync(join(tmpdir(), 'v3-release-'));
  t.after(() => rmSync(dir, {force: true, recursive: true}));
  const stage = join(dir, 'stage');
  const target = join(dir, 'unified-test');
  const index = path => join(path, 'index.html');
  mkdirSync(stage);
  writeFileSync(index(stage), 'previously verified read-only dashboard');
  assert.equal(publish('mark', stage, target).status, 0);
  assert.equal(publish('install', stage, target).status, 0);
  const old = statSync(target);
  const previous = old.dev + ':' + old.ino;
  mkdirSync(stage);
  writeFileSync(index(stage), 'new verified dashboard');
  assert.equal(publish('mark', stage, target).status, 0);
  writeFileSync(index(target), 'out of band change');
  assert.notEqual(publish('install', stage, target, previous).status, 0);
  assert.equal(readFileSync(index(target), 'utf8'), 'out of band change');
  writeFileSync(index(target), 'previously verified read-only dashboard');
  assert.equal(publish('install', stage, target, previous).status, 0);
  assert.equal(readFileSync(index(target), 'utf8'), 'new verified dashboard');
  assert.equal(publish('rollback', stage, target, previous).status, 0);
  assert.equal(readFileSync(index(target), 'utf8'), 'previously verified read-only dashboard');
});
