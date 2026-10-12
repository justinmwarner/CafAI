#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Derived from Crema web/scripts/validate-manifest.mjs and the release:zip script of web/package.json
// (https://github.com/yarneo/crema @ 628cd714), Copyright (C) 2026 Yarden (yarneo).
// Modified for CafAI: zipped in Node with fflate, both manifests written from skin.config.json, the single entry chunk and the licence files checked.
//
// Build the installable Decaid skin zip.
//
// Decaid installs a skin from a zip whose root holds index.html and the skin
// manifest (or exactly one top-level folder; CafAI uses the root). This script
// builds the production bundle, writes the manifest(s) from skin.config.json
// with the version from package.json, validates them, checks the bundle is a
// single entry chunk (Decaid replaces skin files in place on update, so a
// lazily loaded chunk could 404 in a running page), and zips dist/ plus the
// licence files named in skin.config.json (the GPL LICENSE, the NOTICE with
// credits, the Roboto font's OFL text) into release/cafai-<version>.zip.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The manifest Decaid reads: every value a JSON string, version from package.json. */
export function buildManifest(config, version) {
  return { ...config.manifest, version: String(version) };
}

/** Problems with a manifest, as sentences. Empty when valid. */
export function validateManifest(manifest, config, version) {
  const problems = [];
  for (const field of config.requiredFields) {
    if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') {
      problems.push(`missing or empty string "${field}"`);
    }
  }
  // Decaid uses the id as the install directory name: keep it a safe slug.
  if (typeof manifest.id === 'string' && !/^[a-z0-9][a-z0-9_-]*$/.test(manifest.id)) {
    problems.push(`id "${manifest.id}" must be lowercase letters, digits, hyphen or underscore`);
  }
  // A numeric JSON version makes the installed skin vanish from Decaid's list.
  if (typeof manifest.version !== 'string') problems.push('version must be a JSON string');
  else if (!/^\d+(\.\d+)*$/.test(manifest.version)) {
    problems.push(`version "${manifest.version}" must be numeric dot-segments`);
  }
  if (manifest.version !== String(version)) {
    problems.push(`version ${manifest.version} does not match package.json ${version}`);
  }
  return problems;
}

/** Problems with the built file set, as sentences. Empty when valid. */
export function validateBundle(fileNames, config) {
  const problems = [];
  for (const required of ['index.html', ...config.manifestFiles, ...(config.licenseFiles ?? [])]) {
    if (!fileNames.includes(required)) problems.push(`${required} is not at the zip root`);
  }
  if (fileNames.some((f) => f.endsWith('mockServiceWorker.js'))) {
    problems.push('mockServiceWorker.js leaked into the production build');
  }
  const scripts = fileNames.filter((f) => f.endsWith('.js'));
  const entries = scripts.filter((f) => /(^|\/)index-[^/]+\.js$/.test(f));
  const polyfills = scripts.filter((f) => /(^|\/)polyfills-[^/]+\.js$/.test(f));
  const others = scripts.filter((f) => !entries.includes(f) && !polyfills.includes(f));
  if (entries.length !== 1) problems.push(`expected one entry chunk, found ${entries.length}`);
  if (others.length > 0) problems.push(`unexpected lazy chunks (break on in-place updates): ${others.join(', ')}`);
  if (fileNames.some((f) => /[:<>"|?*]/.test(f))) problems.push('a file name contains a character Decaid rejects');
  return problems;
}

function walk(dir, base = dir, out = {}) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else if (!name.endsWith('.map') && name !== '.DS_Store') {
      out[path.relative(base, full).split(path.sep).join('/')] = readFileSync(full);
    }
  }
  return out;
}

function fail(message) {
  console.error(`release zip failed: ${message}`);
  process.exit(1);
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const config = JSON.parse(readFileSync(path.join(root, 'skin.config.json'), 'utf8'));
  const dist = path.join(root, 'dist');

  if (!process.argv.includes('--no-build')) execSync('npx vite build', { cwd: root, stdio: 'inherit' });
  if (!existsSync(path.join(dist, 'index.html'))) fail('dist/index.html is missing; did the build run?');

  const manifest = buildManifest(config, pkg.version);
  const manifestProblems = validateManifest(manifest, config, pkg.version);
  if (manifestProblems.length > 0) fail(manifestProblems.join('; '));
  for (const file of config.manifestFiles) {
    writeFileSync(path.join(dist, file), JSON.stringify(manifest, null, 2) + '\n');
  }

  const files = walk(dist);
  // The binary is distributed, so the license and the credits travel with it.
  for (const file of config.licenseFiles ?? []) {
    const source = path.join(root, file);
    if (!existsSync(source)) fail(`${file} is missing from the repository root`);
    files[file] = readFileSync(source);
  }
  const bundleProblems = validateBundle(Object.keys(files), config);
  if (bundleProblems.length > 0) fail(bundleProblems.join('; '));

  const outDir = path.join(root, 'release');
  mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, `${config.zipBaseName}-${pkg.version}.zip`);
  writeFileSync(zipPath, zipSync(files, { level: 9 }));
  console.log(
    `ok - ${path.relative(root, zipPath)}: ${Object.keys(files).length} files, ` +
      `root has index.html + ${[...config.manifestFiles, ...(config.licenseFiles ?? [])].join(' + ')}`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
