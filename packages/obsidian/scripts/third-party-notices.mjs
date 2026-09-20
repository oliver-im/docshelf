import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** Collect licenses for installed packages that contribute bytes to the bundle.
 * Host-provided externals and completely tree-shaken packages are excluded.
 * @param {import('esbuild').Metafile} metafile
 * @param {string} workingDirectory
 */
export async function createThirdPartyNotices(metafile, workingDirectory) {
  const directories = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, contribution] of Object.entries(output.inputs)) {
      if (!contribution.bytesInOutput) continue;
      const absolute = path.resolve(workingDirectory, input);
      const marker = `${path.sep}node_modules${path.sep}`;
      const offset = absolute.lastIndexOf(marker);
      if (offset < 0) continue; // DocShelf's own sources and shared workspace.
      const parent = absolute.slice(0, offset + marker.length);
      const parts = absolute.slice(parent.length).split(path.sep);
      directories.add(path.join(parent, ...parts.slice(0, parts[0].startsWith('@') ? 2 : 1)));
    }
  }

  const sections = [];
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    if (!manifest.name || !manifest.version) throw new Error(`Missing package identity in ${directory}`);
    const identity = `${manifest.name}@${manifest.version}`;
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^(?:licen[cs]e|copying|notice|copyright)(?:$|[.-])/i.test(entry.name))
      .map(entry => entry.name).sort();
    if (!files.some(name => /^(?:licen[cs]e|copying)(?:$|[.-])/i.test(name))) {
      throw new Error(`No license text found for bundled dependency ${identity}`);
    }
    const texts = [];
    for (const file of files) {
      const contents = await readFile(path.join(directory, file), 'utf8');
      if (!contents.trim()) throw new Error(`Empty ${file} for bundled dependency ${identity}`);
      texts.push(`--- ${file} ---\n${contents.trimEnd()}\n`);
    }
    const license = typeof manifest.license === 'string' ? `Declared license: ${manifest.license}\n` : '';
    sections.push(`## ${identity}\n\n${license}\n${texts.join('\n')}`);
  }

  return [
    'Third-party notices for DocShelf for Obsidian',
    '',
    'Generated from the installed packages contributing to main.js.',
    'Bundled dependencies retain their respective licenses below.',
    'DocShelf and its shared helpers are covered by the accompanying LICENSE.',
    'These notices and the DocShelf license are also embedded in main.js.',
    '',
    ...sections.sort(),
  ].join('\n') + '\n';
}

/** Line comments preserve arbitrary license text without allowing it to execute. */
export function embeddedLicenses(license, notices) {
  return '\n' + `DocShelf license\n\n${license}\n${notices}`
    .split(/\r\n|[\n\r\u2028\u2029]/u).map(line => `// ${line}`).join('\n') + '\n';
}
