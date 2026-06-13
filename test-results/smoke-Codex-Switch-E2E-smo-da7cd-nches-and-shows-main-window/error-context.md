# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.test.ts >> Codex Switch E2E smoke >> app launches and shows main window
- Location: tests/e2e/smoke.test.ts:22:7

# Error details

```
Error: electron.launch: Target page, context or browser has been closed
Browser logs:

<launching> /Users/mark/work/gitspace/opensource/codex-switch/release/mac-arm64/Codex Switch.app/Contents/MacOS/Codex Switch --inspect=0 --remote-debugging-port=0 --no-sandbox
<launched> pid=37904
[pid=37904][err] Debugger listening on ws://127.0.0.1:60927/d0a0926b-4b90-47ae-a305-9e0ed1dd8699
[pid=37904][err] For help, see: https://nodejs.org/en/docs/inspector
[pid=37904][err] Debugger attached.
[pid=37904][err]
[pid=37904][err] DevTools listening on ws://127.0.0.1:60929/devtools/browser/7b94c7d8-d402-4864-9786-b99f77700ab4
[pid=37904][err] Waiting for the debugger to disconnect...
Call log:
  - <launching> /Users/mark/work/gitspace/opensource/codex-switch/release/mac-arm64/Codex Switch.app/Contents/MacOS/Codex Switch --inspect=0 --remote-debugging-port=0 --no-sandbox
  - <launched> pid=37904
  - [pid=37904][err] Debugger listening on ws://127.0.0.1:60927/d0a0926b-4b90-47ae-a305-9e0ed1dd8699
  - [pid=37904][err] For help, see: https://nodejs.org/en/docs/inspector
  - <ws connecting> ws://127.0.0.1:60927/d0a0926b-4b90-47ae-a305-9e0ed1dd8699
  - [pid=37904][err] Debugger attached.
  - <ws connected> ws://127.0.0.1:60927/d0a0926b-4b90-47ae-a305-9e0ed1dd8699
  - [pid=37904][err]
  - [pid=37904][err] DevTools listening on ws://127.0.0.1:60929/devtools/browser/7b94c7d8-d402-4864-9786-b99f77700ab4
  - <ws connecting> ws://127.0.0.1:60929/devtools/browser/7b94c7d8-d402-4864-9786-b99f77700ab4
  - <ws connected> ws://127.0.0.1:60929/devtools/browser/7b94c7d8-d402-4864-9786-b99f77700ab4
  - [pid=37904][err] Waiting for the debugger to disconnect...
  - <ws disconnecting> ws://127.0.0.1:60927/d0a0926b-4b90-47ae-a305-9e0ed1dd8699
  - <ws disconnected> ws://127.0.0.1:60927/d0a0926b-4b90-47ae-a305-9e0ed1dd8699 code=1005 reason=
  - <ws disconnected> ws://127.0.0.1:60929/devtools/browser/7b94c7d8-d402-4864-9786-b99f77700ab4 code=1006 reason=
  - [pid=37904] <kill>
  - [pid=37904] <will force kill>
  - [pid=37904] exception while trying to kill process: Error: kill EPERM
  - [pid=37904] <process did exit: exitCode=0, signal=null>
  - [pid=37904] starting temporary directories cleanup
  - [pid=37904] finished temporary directories cleanup

```

# Test source

```ts
  1  | /**
  2  |  * E2E smoke test — launches the built Electron app and verifies core UI renders.
  3  |  *
  4  |  * Run with: pnpm test:e2e
  5  |  *
  6  |  * Prerequisites: `pnpm package:mac` must have been run first (produces release/mac-arm64/).
  7  |  * Requires the unpacked .app bundle (electron-builder --dir or --mac output).
  8  |  *
  9  |  * Note: dev Electron binary (node_modules/electron) is broken on Node 23;
  10 |  * this test uses the packaged .app which bundles its own Electron runtime.
  11 |  */
  12 | import { test, expect, _electron as electron } from '@playwright/test';
  13 | import path from 'node:path';
  14 | import fs from 'node:fs';
  15 |
  16 | const APP_PATH = path.resolve(
  17 |   __dirname,
  18 |   '../../release/mac-arm64/Codex Switch.app/Contents/MacOS/Codex Switch',
  19 | );
  20 |
  21 | test.describe('Codex Switch E2E smoke', () => {
  22 |   test('app launches and shows main window', async () => {
  23 |     // Skip if packaged app not built yet
  24 |     if (!fs.existsSync(APP_PATH)) {
  25 |       test.skip(true, 'packaged app not found — run pnpm package:mac first');
  26 |       return;
  27 |     }
  28 |
> 29 |     const app = await electron.launch({
     |                 ^ Error: electron.launch: Target page, context or browser has been closed
  30 |       executablePath: APP_PATH,
  31 |       args: ['--no-sandbox'],
  32 |     });
  33 |
  34 |     const window = await app.firstWindow();
  35 |     await window.waitForLoadState('domcontentloaded');
  36 |
  37 |     const title = await window.title();
  38 |     expect(title).toBe('Codex Switch');
  39 |
  40 |     const root = await window.$('#root');
  41 |     expect(root).toBeTruthy();
  42 |
  43 |     await app.close();
  44 |   });
  45 | });
  46 |
```
