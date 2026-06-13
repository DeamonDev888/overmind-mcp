import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import pino from 'pino';

const execAsync = promisify(exec);
const logger = pino({ name: 'NousHermesRunner' });

/**
 * Find the hermes binary across platforms (Windows, Linux, macOS).
 *
 * Priority: HERMES_BIN_PATH env > PATH > platform-specific paths > pip show
 * > bare "hermes" (lets spawn fail with a proper error).
 */
export async function findHermesBinary(): Promise<string> {
  const isWin = process.platform === 'win32';

  // 1. Check environment variable first (allows users to override)
  if (process.env.HERMES_BIN_PATH) {
    if (fs.existsSync(process.env.HERMES_BIN_PATH)) {
      logger.info({ path: process.env.HERMES_BIN_PATH }, 'Using HERMES_BIN_PATH');
      return process.env.HERMES_BIN_PATH;
    }
  }

  // 2. Try to find via PATH
  try {
    const command = isWin ? 'where hermes' : 'which hermes';
    const { stdout } = await execAsync(command);
    const hermesPath = stdout.trim().split('\n')[0];
    if (hermesPath && fs.existsSync(hermesPath)) {
      logger.info({ path: hermesPath }, 'Found hermes in PATH');
      return hermesPath;
    }
  } catch {
    // Not found in PATH
  }

  // 3. Platform-specific paths
  const platformPaths: string[] = [];
  if (isWin) {
    platformPaths.push(
      // Hermes venv (Nous Research install) — PRIORITÉ haute (v0.13.0, supporte -z)
      path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
      // Officiel installer Windows (install.ps1) — chemin natif
      path.join(process.env.LOCALAPPDATA || '', 'hermes', 'bin', 'hermes.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes.exe')
    );

    // Dynamically scan for Python versions in LOCALAPPDATA
    const programsPython = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python');
    if (fs.existsSync(programsPython)) {
      try {
        const dirs = fs.readdirSync(programsPython);
        for (const dir of dirs) {
          if (dir.toLowerCase().startsWith('python')) {
            platformPaths.push(path.join(programsPython, dir, 'Scripts', 'hermes.exe'));
          }
        }
      } catch { /* ignored */ }
    }

    platformPaths.push(
      // Fallback installations via pip (legacy)
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'Scripts', 'hermes.exe'),
      path.join(process.env.APPDATA || '', 'Python', 'Python312', 'Scripts', 'hermes.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'Scripts', 'hermes.exe'),
      path.join(process.env.APPDATA || '', 'Python', 'Python311', 'Scripts', 'hermes.exe'),
      'C:\\Python312\\Scripts\\hermes.exe',
      'C:\\Python311\\Scripts\\hermes.exe',
      'C:\\Program Files\\Hermes\\hermes.exe'
    );
  } else {
    platformPaths.push(
      path.join(process.env.HOME || '', '.local', 'bin', 'hermes'),
      path.join(process.env.HOME || '', 'miniconda3', 'bin', 'hermes'),
      path.join(process.env.HOME || '', 'anaconda3', 'bin', 'hermes'),
      '/usr/local/bin/hermes',
      '/usr/bin/hermes',
      '/opt/homebrew/bin/hermes'
    );
  }

  for (const p of platformPaths) {
    if (fs.existsSync(p)) {
      logger.info({ path: p }, 'Found hermes at platform path');
      return p;
    }
  }

  // 4. Try pip show to find installation
  try {
    const { stdout } = await execAsync('pip show hermes-agent 2>/dev/null || pip3 show hermes-agent');
    const match = stdout.match(/Location:\s*(.+)/);
    if (match) {
      const sitePackages = match[1].trim();
      const hermesPath = isWin
        ? path.join(sitePackages, 'Scripts', 'hermes.exe')
        : path.join(sitePackages, 'bin', 'hermes');
      if (fs.existsSync(hermesPath)) {
        logger.info({ path: hermesPath }, 'Found hermes via pip show');
        return hermesPath;
      }
    }
  } catch {
    // pip show failed
  }

  // 5. Fallback to 'hermes' and let spawn fail with proper error
  logger.warn('hermes binary not found, using "hermes" command');
  return 'hermes';
}
