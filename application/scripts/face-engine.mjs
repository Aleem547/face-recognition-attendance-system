import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2];
if (!['models', 'doctor', 'test', 'smoke'].includes(action) || process.argv.length !== 3) {
  console.error('Use npm run face:models, face:doctor, face:test, or face:smoke.');
  process.exitCode = 1;
} else {
  const executable = resolve(root, '.venv-face', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  try {
    await access(executable);
    const child = spawn(executable, [resolve(root, 'face-engine/manage.py'), action], {
      cwd: root, stdio: 'inherit', shell: false,
    });
    child.on('error', () => { console.error('Could not start the dedicated face-engine environment.'); process.exitCode = 1; });
    child.on('exit', (code) => { process.exitCode = code ?? 1; });
  } catch {
    console.error('Create .venv-face with scripts/Setup-FaceEngine.ps1 first.');
    process.exitCode = 1;
  }
}
