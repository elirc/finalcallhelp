import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const env = { ...process.env };
// Editor terminals may set this for their own helpers; Electron must launch as an app.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  process.execPath,
  [require.resolve('@electron-forge/cli/dist/electron-forge.js'), 'start'],
  {
    cwd: new URL('..', import.meta.url),
    env,
    stdio: 'inherit',
    windowsHide: true,
  },
);
child.on('error', (err) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
