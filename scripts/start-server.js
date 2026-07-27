#!/usr/bin/env node
/**
 * Reliable start/restart for SocietyHub.
 * Prefer this over `lsof -ti :4000 | xargs kill`, which can leave the port empty
 * if the follow-up start fails or is cancelled.
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const port = Number(process.env.PORT) || 4000;
const serverEntry = path.join(root, 'server.js');
const pidFile = path.join(root, '.server.pid');

function pidsOnPort() {
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
    if (!out) return [];
    return out.split(/\s+/).map((p) => Number(p)).filter(Boolean);
  } catch {
    return [];
  }
}

function stopExisting() {
  const pids = new Set(pidsOnPort());
  if (fs.existsSync(pidFile)) {
    const stored = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (stored) pids.add(stored);
  }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[start] stopped pid ${pid}`);
    } catch {
      // already gone
    }
  }

  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && pidsOnPort().length) {
    execSync('sleep 0.2');
  }

  for (const pid of pidsOnPort()) {
    try {
      process.kill(pid, 'SIGKILL');
      console.log(`[start] force-stopped pid ${pid}`);
    } catch {
      // ignore
    }
  }

  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
}

function start() {
  stopExisting();

  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  fs.writeFileSync(pidFile, String(child.pid));
  console.log(`[start] server pid ${child.pid} on port ${port}`);

  child.on('exit', (code, signal) => {
    if (fs.existsSync(pidFile)) {
      const stored = Number(fs.readFileSync(pidFile, 'utf8').trim());
      if (stored === child.pid) fs.unlinkSync(pidFile);
    }
    if (signal) {
      console.log(`[start] server exited via ${signal}`);
      process.exit(0);
    }
    process.exit(code || 0);
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

start();
