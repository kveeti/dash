import { copyFile, readdir, readFile, stat, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'dist/assets');
const sqliteVendorDir = join(__dirname, '..', 'src/lib/sqlite-custom');

function dehashAssetBasename(fileName) {
  const match = fileName.match(/^(.*)-([A-Za-z0-9_-]+)\.([A-Za-z0-9]+)$/);
  if (!match) return fileName;
  return `${match[1]}.${match[3]}`;
}

async function main() {
  const [files, vendorFiles] = await Promise.all([
    readdir(assetsDir),
    readdir(sqliteVendorDir),
  ]);
  const distFileSet = new Set(files);

  const sqliteVendorBaseNames = new Set(
    vendorFiles.filter((f) => f.startsWith('sqlite3')),
  );
  if (sqliteVendorBaseNames.size === 0) {
    console.log('No sqlite3* vendor files found, skipping sqlite post-build rewrite.');
    return;
  }

  const sqlite3Files = files.filter((f) => f.startsWith('sqlite3'));

  const candidatesByBaseName = new Map();
  for (const file of sqlite3Files) {
    const baseName = dehashAssetBasename(file);
    if (!sqliteVendorBaseNames.has(baseName)) continue;

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

  // Some sqlite runtime files (notably sqlite3-opfs-async-proxy.js) are
  // loaded via dynamic URL construction inside sqlite3.mjs, so Vite does not
  // always emit them. Ensure those vendor sqlite3* files exist in dist/assets.
  for (const vendorFile of sqliteVendorBaseNames) {
    const hashedVariant = nameToHashed[vendorFile];
    if (distFileSet.has(vendorFile) || (hashedVariant && distFileSet.has(hashedVariant))) {
      continue;
    }
    const sourcePath = join(sqliteVendorDir, vendorFile);
    const destPath = join(assetsDir, vendorFile);
    await copyFile(sourcePath, destPath);
    distFileSet.add(vendorFile);
    console.log(`Copied missing sqlite runtime asset: ${vendorFile}`);
  }
  const targetFiles = files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));

  for (const file of targetFiles) {
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
