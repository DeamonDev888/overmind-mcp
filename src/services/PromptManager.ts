import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export class PromptManager {
  private baseDir: string;
  private agentsDir: string;

  constructor(customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDir = customBaseDir;
    } else {
      const currentFileUrl = import.meta.url;
      const currentFilePath = fileURLToPath(currentFileUrl);
      const projectRoot = path.resolve(path.dirname(currentFilePath), '../../');
      this.baseDir = path.resolve(projectRoot, '.claude');
    }
    this.agentsDir = path.join(this.baseDir, 'agents');
  }

  async createPrompt(
    name: string,
    content: string,
  ): Promise<{ filePath: string; existed: boolean }> {
    await fs.mkdir(this.agentsDir, { recursive: true });
    const filePath = path.join(this.agentsDir, `${name}.md`);

    const existed = await fs
      .stat(filePath)
      .then(() => true)
      .catch(() => false);
    await fs.writeFile(filePath, content, 'utf-8');

    return { filePath, existed };
  }

  async editPrompt(
    name: string,
    search: string,
    replace: string,
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    const filePath = path.join(this.agentsDir, `${name}.md`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (!content.includes(search)) {
        return { success: false, error: 'SEARCH_NOT_FOUND', filePath };
      }

      const newContent = content.replace(search, replace);
      await fs.writeFile(filePath, newContent, 'utf-8');

      return { success: true, filePath };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), filePath };
    }
  }

  async getPromptContent(name: string): Promise<string | null> {
    const filePath = path.join(this.agentsDir, `${name}.md`);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
