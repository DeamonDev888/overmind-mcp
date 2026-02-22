import fs from 'fs/promises';
import { CONFIG, resolveConfigPath } from '../lib/config.js';

export async function getAgentPrompt() {
  try {
    // Read settings.json to find the prompt file
    const settingsPath = resolveConfigPath(CONFIG.CLAUDE.PATHS.SETTINGS);
    const settingsContent = await fs.readFile(settingsPath, 'utf-8');
    JSON.parse(settingsContent);

    // Assume settings structure has "commands" or agent prompt definition
    // Just reading the raw content for now or looking for .md files in the same dir

    // List files in agents dir
    // This is a heuristic. Ideally settings.json tells us which prompt is active.
    // But for "Agent News", it's likely agent_news.md

    // Let's try to return the settings.json content + any specialized instructions
    return `Configuration actuelle (${settingsPath}):\n${settingsContent}`;
  } catch (error) {
    return `Erreur lors de la lecture du prompt: ${error instanceof Error ? error.message : String(error)}`;
  }
}
