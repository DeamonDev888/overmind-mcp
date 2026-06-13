import { exec } from 'child_process';
import { ChildProcess } from 'child_process';
import pino from 'pino';

const logger = pino({ name: 'NousHermesRunner' });

/**
 * Kill a process tree reliably across platforms.
 *
 * On Windows, child.kill() only terminates the cmd.exe wrapper — the actual
 * child becomes orphaned. We use taskkill /F /T to propagate the kill to the
 * entire subtree. On Unix we escalate SIGTERM → SIGKILL after a 2s grace.
 */
export function killProcessTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child) {
      logger.debug('[KILL] No child process reference provided.');
      resolve();
      return;
    }
    if (child.exitCode !== null || child.killed) {
      logger.debug({ pid: child.pid, exitCode: child.exitCode, killed: child.killed }, '[KILL] Process is already dead or marked killed.');
      resolve();
      return;
    }
    logger.info({ pid: child.pid }, '[KILL] Initiating process tree termination...');
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      logger.debug({ pid: child.pid }, '[KILL] Process tree termination sequence completed.');
      resolve();
    };
    child.once('exit', finish);
    if (process.platform === 'win32' && child.pid && typeof child.pid === 'number' && child.pid > 0) {
      const cmd = `taskkill /F /T /PID ${child.pid}`;
      logger.debug({ cmd }, '[KILL] Executing Windows taskkill...');
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          logger.debug({ err, stderr }, '[KILL] taskkill failed or process was already dead.');
        } else {
          logger.debug({ stdout }, '[KILL] taskkill completed successfully.');
        }
      });
    } else {
      try {
        logger.debug({ pid: child.pid }, '[KILL] Dispatched SIGTERM signal.');
        child.kill('SIGTERM');
      } catch (e) {
        logger.debug({ pid: child.pid, error: e }, '[KILL] SIGTERM dispatch failed.');
      }
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          try {
            logger.warn({ pid: child.pid }, '[KILL] SIGTERM ignored. Escalating to SIGKILL...');
            child.kill('SIGKILL');
          } catch (e) {
            logger.debug({ pid: child.pid, error: e }, '[KILL] SIGKILL dispatch failed.');
          }
        }
      }, 2000);
    }
    setTimeout(finish, 5000);
  });
}
