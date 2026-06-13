/**
 * E2E smoke test — launches the built Electron app and verifies core UI renders.
 *
 * Run with: pnpm test:e2e
 *
 * Prerequisites: `pnpm package:mac` must have been run first (produces release/mac-arm64/).
 * Requires the unpacked .app bundle (electron-builder --dir or --mac output).
 *
 * Note: dev Electron binary (node_modules/electron) is broken on Node 23;
 * this test uses the packaged .app which bundles its own Electron runtime.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const APP_PATH = path.resolve(
  __dirname,
  '../../release/mac-arm64/Codex Switch.app/Contents/MacOS/Codex Switch',
);

test.describe('Codex Switch E2E smoke', () => {
  test('app launches and shows main window', async () => {
    // Skip if packaged app not built yet
    if (!fs.existsSync(APP_PATH)) {
      test.skip(true, 'packaged app not found — run pnpm package:mac first');
      return;
    }

    const app = await electron.launch({
      executablePath: APP_PATH,
      args: ['--no-sandbox'],
    });

    const window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    const title = await window.title();
    expect(title).toBe('Codex Switch');

    const root = await window.$('#root');
    expect(root).toBeTruthy();

    await app.close();
  });
});
