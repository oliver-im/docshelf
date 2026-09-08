import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupLocal } from './local-setup.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run setup [-- --direct]\n\nInstall DocShelf on macOS with https://shelf.localhost/ and automatic startup.\n--direct  Skip Portless and install with http://shelf.localhost:4321/.\n\nExisting shelf entries are preserved. Privileged setup requires interactive consent.');
} else {
  try {
    if (args.some((arg) => arg !== '--direct')) throw new Error('Unknown option. Use `npm run setup -- --help`.');
    if (process.getuid?.() === 0) throw new Error('Run setup as your regular user, without sudo. Portless requests elevation only for its own setup.');
    await setupLocal({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), direct: args.includes('--direct') }, {
      confirm: async (question) => {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
          console.error(`${question}\nRun setup in an interactive terminal to approve this step.`);
          return false;
        }
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        try { return /^y(?:es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim()); }
        finally { prompt.close(); }
      },
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
