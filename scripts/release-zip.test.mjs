import { describe, expect, it } from 'vitest';
import { buildManifest, validateBundle, validateManifest } from './release-zip.mjs';

const config = {
  manifestFiles: ['skin-manifest.json', 'manifest.json'],
  licenseFiles: ['LICENSE', 'NOTICE'],
  requiredFields: ['id', 'name', 'description', 'version'],
  manifest: { id: 'cafai', name: 'CafAI', description: 'Coach' },
};

describe('release manifest', () => {
  it('takes its version from package.json as a string', () => {
    const m = buildManifest(config, '1.2.3');
    expect(m).toEqual({ id: 'cafai', name: 'CafAI', description: 'Coach', version: '1.2.3' });
    expect(validateManifest(m, config, '1.2.3')).toEqual([]);
  });

  it('rejects unsafe ids, numeric versions and mismatches', () => {
    expect(validateManifest({ ...buildManifest(config, '1.0.0'), id: 'Caf AI' }, config, '1.0.0')[0]).toMatch(/id/);
    expect(validateManifest({ ...buildManifest(config, '1.0.0'), version: 1 }, config, '1.0.0').join()).toMatch(
      /JSON string/,
    );
    expect(validateManifest(buildManifest(config, '1.0.0'), config, '1.0.1').join()).toMatch(/does not match/);
    expect(validateManifest({ ...buildManifest(config, '1.0.0'), name: '' }, config, '1.0.0').join()).toMatch(/name/);
  });
});

describe('release bundle', () => {
  const good = [
    'index.html',
    'skin-manifest.json',
    'manifest.json',
    'LICENSE',
    'NOTICE',
    'assets/index-abc.js',
    'assets/polyfills-def.js',
    'assets/index-abc.css',
    'assets/roboto-latin-400-normal-x.woff2',
  ];

  it('accepts a single entry chunk with manifests at the root', () => {
    expect(validateBundle(good, config)).toEqual([]);
  });

  it('rejects lazy chunks, a missing manifest and the mock service worker', () => {
    expect(validateBundle([...good, 'assets/chunk-xyz.js'], config).join()).toMatch(/lazy chunks/);
    expect(validateBundle(good.filter((f) => f !== 'skin-manifest.json'), config).join()).toMatch(/skin-manifest/);
    expect(validateBundle([...good, 'mockServiceWorker.js'], config).join()).toMatch(/mockServiceWorker/);
  });

  it('requires the license and the notice at the root', () => {
    expect(validateBundle(good.filter((f) => f !== 'LICENSE'), config).join()).toMatch(/LICENSE is not at the zip root/);
    expect(validateBundle(good.filter((f) => f !== 'NOTICE'), config).join()).toMatch(/NOTICE is not at the zip root/);
  });
});
