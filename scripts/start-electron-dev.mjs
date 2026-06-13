// Wait until tsc finished compiling main once, then spawn electron.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const mainJs = path.resolve('dist/electron/main.js');

async function waitForFile(file, timeoutMs = 20000) {
  const start = Date.now();
  while (!existsSync(file)) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${file}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

(async () => {
  await waitForFile(mainJs);
  const electronExe = require('electron');
  const child = spawn(electronExe, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
})();
