import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const virtualEnvironmentPython = process.platform === 'win32'
  ? 'eeg-calibration/.venv/Scripts/python.exe'
  : 'eeg-calibration/.venv/bin/python';
const calibrationPython = existsSync(virtualEnvironmentPython)
  ? virtualEnvironmentPython
  : process.env.NEUROSCAPE_PYTHON;

if (!calibrationPython) {
  console.error('Calibration environment is missing. Run `npm run calibration:setup` first.');
  process.exit(1);
}

function spawnNpm(args) {
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], {
      stdio: 'inherit',
    });
  }

  return spawn('npm', args, { stdio: 'inherit' });
}

const children = [
  spawn(
    calibrationPython,
    [
      '-m',
      'uvicorn',
      'app.main:app',
      '--app-dir',
      'eeg-calibration/backend',
      '--host',
      '127.0.0.1',
      '--port',
      '8000',
    ],
    { stdio: 'inherit' },
  ),
  spawnNpm(['run', 'study:server']),
  spawnNpm(['run', 'dev:frontend']),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
  process.exitCode = exitCode;
}

children.forEach((child) => {
  child.on('exit', (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`Development process stopped (${signal ?? code}).`);
      stop(code ?? 1);
    }
  });
});

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
