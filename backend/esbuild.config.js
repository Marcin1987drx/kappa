import { build } from 'esbuild';
import { cpSync } from 'fs';

// Bundle the backend into a single CJS file
// This eliminates node_modules resolution issues in Electron's utilityProcess
await build({
  entryPoints: ['dist/server.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/server.bundle.cjs',
  // sql.js loads a WASM file at runtime via __dirname - keep it external
  // so it resolves from node_modules normally
  external: ['sql.js'],
  sourcemap: false,
  minify: false,
});

// Copy sql-wasm.wasm next to the bundle (sql.js needs it)
// Not needed since sql.js is external and loads from its own node_modules path

console.log('✅ Backend bundled to dist/server.bundle.cjs');
