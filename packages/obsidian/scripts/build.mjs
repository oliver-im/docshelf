import { context, build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { createThirdPartyNotices, embeddedLicenses } from './third-party-notices.mjs';

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
  write: false,
  logLevel: 'info',
  banner: { js: '/* DocShelf for Obsidian. Source: src/main.ts. MIT and bundled dependency licenses are included below. */' },
  plugins: [{
    name: 'third-party-notices',
    setup(builder) {
      builder.onEnd(async result => {
        if (result.errors.length) return;
        const notices = await createThirdPartyNotices(result.metafile, process.cwd());
        const license = await readFile('LICENSE', 'utf8');
        for (const output of result.outputFiles) {
          await writeFile(output.path, output.path.endsWith('.js') ? output.text + embeddedLicenses(license, notices) : output.contents);
        }
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
