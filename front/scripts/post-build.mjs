import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'dist/assets');

async function main() {
  const files = await readdir(assetsDir);

  const sqlite3Files = files.filter(f => f.startsWith('sqlite3'));

  const nameToHashed = {};
  for (const file of sqlite3Files) {
    const baseName = file.replace(/-[A-Za-z0-9]+(\.wasm|\.js)$/, '$1');
    nameToHashed[baseName] = file;
  }

  console.log('Mapping base names to hashed names:', nameToHashed);

  const jsFiles = files.filter(f => f.endsWith('.js') && !f.startsWith('sqlite3'));

  for (const file of jsFiles) {
    const filePath = join(assetsDir, file);
    let content = await readFile(filePath, 'utf-8');
    let modified = false;

    for (const [baseName, hashedName] of Object.entries(nameToHashed)) {
      const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedBase, 'g');
      if (regex.test(content)) {
        content = content.replace(regex, hashedName);
        modified = true;
      }
    }

    if (modified) {
      await writeFile(filePath, content);
      console.log(`Updated: ${file}`);
    }
  }

  for (const file of sqlite3Files) {
    const filePath = join(assetsDir, file);
    let content = await readFile(filePath, 'utf-8');
    let modified = false;

    for (const [baseName, hashedName] of Object.entries(nameToHashed)) {
      const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedBase, 'g');
      if (regex.test(content)) {
        content = content.replace(regex, hashedName);
        modified = true;
      }
    }

    if (modified) {
      await writeFile(filePath, content);
      console.log(`Updated: ${file}`);
    }
  }
}

main();
