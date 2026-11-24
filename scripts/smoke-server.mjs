#!/usr/bin/env node
// Boots the built bundle exactly as the desktop app does, then proves the two
// handshake contracts: server.json under TUFFCODE_HOME and GET /health.
//
// Runs against temp TUFFCODE_HOME and LOCALAPPDATA so it never touches the
// developer's real ~/.tuffcode or database.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = join(root, 'packages', 'server', 'dist', 'server.js');
const home = mkdtempSync(join(tmpdir(), 'tuffcode-smoke-home-'));
const localAppData = mkdtempSync(join(tmpdir(), 'tuffcode-smoke-data-'));
const serverJson = join(home, 'server.json');
const READY_TIMEOUT_MS = 15_000;

function fail(message, output) {
  process.stderr.write(`server smoke failed: ${message}\n`);
  if (output !== undefined && output.length > 0) process.stderr.write(`${output}\n`);
  process.exitCode = 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.on('exit', resolve);
      killer.on('error', resolve);
    });
  } else {
    child.kill('SIGTERM');
  }
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await exited;
  clearTimeout(timer);
}

let child;
let output = '';

try {
  child = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      TUFFCODE_HOME: home,
      LOCALAPPDATA: localAppData,
      USERPROFILE: home,
      HOME: home,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let raw;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`server exited before writing server.json (code ${child.exitCode})`, output);
      break;
    }
    try {
      raw = readFileSync(serverJson, 'utf8');
      break;
    } catch {
      await sleep(100);
    }
  }
  if (process.exitCode === 1) {
    // already reported
  } else if (raw === undefined) {
    fail(`server.json was not written within ${READY_TIMEOUT_MS}ms`, output);
  } else {
    const info = JSON.parse(raw);
    if (typeof info.port !== 'number' || info.port <= 0) {
      fail(`server.json has no valid port: ${raw}`, output);
    } else if (typeof info.token !== 'string' || info.token.length === 0) {
      fail(`server.json has no token: ${raw}`, output);
    } else {
      const response = await fetch(`http://127.0.0.1:${info.port}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      const body = await response.json();
      if (response.status !== 200 || body.ok !== true || body.pid !== info.pid) {
        fail(`GET /health returned ${response.status}: ${JSON.stringify(body)}`, output);
      } else {
        process.stdout.write(
          `server smoke ok: port ${info.port}, pid ${info.pid}, version ${body.version}\n`,
        );
      }
    }
  }
} finally {
  if (child !== undefined) await killTree(child);
  rmSync(home, { recursive: true, force: true });
  rmSync(localAppData, { recursive: true, force: true });
}
