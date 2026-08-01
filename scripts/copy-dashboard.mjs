// ============================================================
// AI Gateway — Copy dashboard assets into dist/ after bundling
// The esbuild bundle only produces dist/index.mjs; the dashboard
// (index.html / app.js / styles.css) must be copied alongside it
// so the production build (node dist/index.mjs) can serve the UI.
// ============================================================
import { cpSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDashboard = join(__dirname, '..', 'src', 'dashboard');
const distDir = join(__dirname, '..', 'dist');

if (!existsSync(srcDashboard)) {
  console.error('[build] src/dashboard not found — nothing to copy');
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });
cpSync(srcDashboard, join(distDir, 'dashboard'), { recursive: true });
console.log('[build] Dashboard assets copied to dist/dashboard');
