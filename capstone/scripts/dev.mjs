// Starts the API server (port 4000) and the Vite dev server together. No extra packages needed.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const procs = [
  spawn(process.execPath, ['--no-warnings', '--watch', 'server/index.js'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [vite], { cwd: root, stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => { try { p.kill(); } catch { /* already stopped */ } });
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
