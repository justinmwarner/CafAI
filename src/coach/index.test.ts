import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as coach from './index.ts';

const here = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe('the coach barrel', () => {
  it('exposes the public API', () => {
    for (const name of [
      'normalizeProfile',
      'profileId',
      'TEMPLATES',
      'getTemplate',
      'applyLever',
      'readLeverValues',
      'validateProposal',
      'checkStructure',
      'describeLeverChange',
      'describeManualChange',
      'diffProfiles',
      'summarizeShot',
      'summaryForModel',
      'createShotSource',
      'runQueryTool',
      'COACH_TOOL_SPECS',
      'buildSystemPrompt',
      'COACH_HEURISTICS',
      'withOther',
      'DEFAULT_TASTE_OPTIONS',
      'versionTitle',
      'buildVersionProfile',
    ]) {
      expect(coach, name).toHaveProperty(name);
    }
  });
});

describe('coach purity (brief: pure TypeScript, types only from other modules)', () => {
  const files = sourceFiles(here);

  it('imports only types from src/api, src/llm and src/storage', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const imports = text.match(/^import[^;]*?from '[^']*\/(api|llm|storage)\/[^']*';/gm) ?? [];
      for (const line of imports) expect(line.startsWith('import type '), `${file}: ${line}`).toBe(true);
    }
  });

  it('uses no React, network, storage or timers', () => {
    for (const file of files) {
      // Comments may explain why an API is avoided; only code counts.
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(text, file).not.toMatch(/from 'react|\bfetch\(|indexedDB|localStorage|setTimeout|setInterval|crypto\.subtle|structuredClone|\.at\(-1\)/);
    }
  });
});
