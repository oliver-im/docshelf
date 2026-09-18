import { context, build } from 'esbuild';

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@electron/remote', '@codemirror/state', '@codemirror/view'],
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  outfile: 'main.js',
  sourcemap: 'external',
  logLevel: 'info',
  banner: { js: '/* DocShelf for Obsidian. Source: src/main.ts. MIT licensed. */' },
};

if (process.argv.includes('--watch')) {
  const watcher = await context(options);
  await watcher.watch();
} else {
  await build(options);
}
