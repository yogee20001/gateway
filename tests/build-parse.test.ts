// ============================================================
// AI Gateway — Build Regression: Source Parse Tests
// Guards against the brace-mismatch regression that broke
// `npm run build` ("Unexpected catch") by verifying that every
// top-level src/*.ts file parses cleanly with the same
// transform esbuild uses (loader: 'ts').
// ============================================================

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { transformSync } from 'esbuild';

const srcDir = join(__dirname, '..', 'src');

/** Recursively collect all *.ts files under src/ (covers nested dirs). */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = collectTsFiles(srcDir).sort();

describe('src/**/*.ts parse regression', () => {
  it('discovers at least one source file to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  describe.each(sourceFiles)('%s', (filePath) => {
    it('parses without throwing (no unbalanced braces / unexpected catch)', () => {
      const content = readFileSync(filePath, 'utf-8');
      expect(() => {
        transformSync(content, { loader: 'ts', format: 'esm' });
      }).not.toThrow();
    });
  });
});
