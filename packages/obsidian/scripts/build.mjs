import { context, build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { createThirdPartyNotices } from './third-party-notices.mjs';

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@electron/remote', '@codemirror/state', '@codemirror/view'],
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  outfile: 'main.js',
  sourcemap: 'external',
  metafile: true,
  logLevel: 'info',
  banner: { js: '/* DocShelf for Obsidian. Source: src/main.ts. DocShelf: MIT. Bundled dependency licenses: THIRD_PARTY_NOTICES.txt. */' },
  plugins: [{
    name: 'third-party-notices',
    setup(builder) {
      builder.onEnd(async result => {
        if (result.errors.length) return;
        const notices = await createThirdPartyNotices(result.metafile, process.cwd());
        await writeFile('THIRD_PARTY_NOTICES.txt', notices);
      });
    },
  }],
};

if (process.argv.includes('--watch')) {
  const watcher = await context(options);
  await watcher.watch();
} else {
  await build(options);
}
