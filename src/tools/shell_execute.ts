import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export const shellExecuteSchema = z.object({
  command: z.string().describe('La commande shell à exécuter'),
  cwd: z.string().optional().describe('Le répertoire de travail'),
});

export async function shellExecute({ command, cwd }: { command: string; cwd?: string }) {
  try {
    const { stdout, stderr } = await execPromise(command, { 
      cwd: cwd || process.cwd(),
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    });
    
    return `SUCCESS:\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
  } catch (error: any) {
    const out = error.stdout?.trim() || '';
    const err = error.stderr?.trim() || error.message;
    return `FAILURE (Exit Code: ${error.code}):\nSTDOUT:\n${out}\n\nSTDERR:\n${err}`;
  }
}
