import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import https from 'https';

const CACHE_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Local'),
  'electron-builder',
  'Cache',
  'winCodeSign',
);
const TARGET_DIR = path.join(CACHE_DIR, 'winCodeSign-2.6.0');
const ZIP_URL =
  'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z';

// Locate local 7za.exe
const SEVEN_ZIP_EXE = path.join(process.cwd(), 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading: ${url} -> ${dest}`);
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Handle redirect
          downloadFile(response.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
  });
}

async function main() {
  console.log('=== winCodeSign Symlink Workaround Tool ===');

  if (process.platform !== 'win32') {
    console.log('This script is only needed and designed for Windows host systems.');
    return;
  }

  // Ensure CACHE_DIR exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  // Check if target directory already exists and has files
  if (fs.existsSync(TARGET_DIR) && fs.existsSync(path.join(TARGET_DIR, 'windows', 'rcedit.exe'))) {
    console.log(`[Success] Target dir already exists and is complete: ${TARGET_DIR}`);
    console.log('You can now run "pnpm package:win" directly!');
    return;
  }

  // Find any existing .7z file in CACHE_DIR
  let zipFile = '';
  const files = fs.readdirSync(CACHE_DIR);
  const existingZips = files.filter((f) => f.endsWith('.7z'));

  if (existingZips.length > 0) {
    // Sort by largest or just pick the first one matching 2.6.0 or any
    zipFile = path.join(CACHE_DIR, existingZips[0]);
    console.log(`Found existing winCodeSign archive in cache: ${zipFile}`);
  } else {
    // Need to download
    zipFile = path.join(CACHE_DIR, 'winCodeSign-2.6.0.7z');
    try {
      await downloadFile(ZIP_URL, zipFile);
    } catch (err) {
      console.error('Failed to download winCodeSign archive:', err.message);
      process.exit(1);
    }
  }

  // Double check if 7-zip executable exists
  if (!fs.existsSync(SEVEN_ZIP_EXE)) {
    console.error(`Error: Cannot find 7za.exe at expected path: ${SEVEN_ZIP_EXE}`);
    console.error('Please run "pnpm install" first.');
    process.exit(1);
  }

  // Clean-up target directory if partially written from previous attempts
  if (fs.existsSync(TARGET_DIR)) {
    console.log('Cleaning up previous partial target directory...');
    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  }

  console.log(`Extracting ${zipFile} directly to ${TARGET_DIR} ...`);
  console.log(
    'Excluding darwin/ and linux/ subdirectories to bypass symlink creations (and prevent privilege errors!)',
  );

  try {
    // -x!darwin and -x!linux excludes those folders from extraction, removing symlinks
    const cmd = `"${SEVEN_ZIP_EXE}" x -bd -y "-x!darwin" "-x!linux" "${zipFile}" "-o${TARGET_DIR}"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log('\n[Success] Manifest extracted safely without macOS/linux symlink dependency.');
    console.log(`Cache is prepopulated at: ${TARGET_DIR}`);
    console.log(
      'You can now run "pnpm package:win" successfully without Administrator / Developer Mode privileges!',
    );
  } catch (err) {
    console.error('Extraction failed:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
