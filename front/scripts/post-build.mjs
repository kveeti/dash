import { readdir, readFile, stat, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'dist/assets');

async function main() {
  const files = await readdir(assetsDir);

  const sqlite3Files = files.filter(f => f.startsWith('sqlite3'));

  const candidatesByBaseName = new Map();
  for (const file of sqlite3Files) {
    const baseName = file.replace(/-[A-Za-z0-9]+(\.wasm|\.js)$/, '$1');
    const filePath = join(assetsDir, file);
    const fileStat = await stat(filePath);
    const candidates = candidatesByBaseName.get(baseName) ?? [];
    candidates.push({ file, size: fileStat.size });
    candidatesByBaseName.set(baseName, candidates);
  }

  const nameToHashed = {};
  for (const [baseName, candidates] of candidatesByBaseName.entries()) {
    candidates.sort((a, b) => {
      if (b.size !== a.size) return b.size - a.size;
      return a.file.localeCompare(b.file);
    });
    nameToHashed[baseName] = candidates[0].file;
    if (candidates.length > 1) {
      console.log(
        `Duplicate basename ${baseName}; chose ${candidates[0].file} (${candidates[0].size} bytes)`,
      );
    }
  }

  console.log('Mapping base names to hashed names:', nameToHashed);
  const canonicalSqliteWasm = nameToHashed['sqlite3.wasm'];
  const canonicalWorker1Js = nameToHashed['sqlite3-worker1.js'];

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

    if (canonicalSqliteWasm) {
      const wasmRegex = /sqlite3-[A-Za-z0-9_-]+\.wasm/g;
      if (wasmRegex.test(content)) {
        content = content.replace(wasmRegex, canonicalSqliteWasm);
        modified = true;
      }
    }

    if (canonicalWorker1Js) {
      const workerRegex = /sqlite3-worker1-[A-Za-z0-9_-]+\.js/g;
      if (workerRegex.test(content)) {
        content = content.replace(workerRegex, canonicalWorker1Js);
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

    if (canonicalSqliteWasm) {
      const wasmRegex = /sqlite3-[A-Za-z0-9_-]+\.wasm/g;
      if (wasmRegex.test(content)) {
        content = content.replace(wasmRegex, canonicalSqliteWasm);
        modified = true;
      }
    }

    if (canonicalWorker1Js) {
      const workerRegex = /sqlite3-worker1-[A-Za-z0-9_-]+\.js/g;
      if (workerRegex.test(content)) {
        content = content.replace(workerRegex, canonicalWorker1Js);
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
