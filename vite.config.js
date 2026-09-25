import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(({ mode }) => ({
  plugins: [preact()],
  // Keep the variable names from the preact-cli days.
  envPrefix: 'PREACT_APP_',
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'build',
  },
  test: {
    environment: 'happy-dom',
    // Make all .env settings (e.g. NABU_CYCLES_DIR) visible to tests.
    env: loadEnv(mode, process.cwd(), ''),
  },
}));
