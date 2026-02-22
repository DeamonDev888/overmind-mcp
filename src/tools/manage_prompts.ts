import { z } from 'zod';
import { PromptManager } from '../services/PromptManager.js';

// --- Schemas ---

export const createPromptSchema = z.object({
  name: z.string().describe("Nom du fichier prompt (sans extension). Ex: 'analyse_financiere'"),
  content: z.string().describe('Contenu Markdown du prompt'),
});

export const editPromptSchema = z.object({
  name: z.string().describe("Nom du fichier prompt à modifier (ex: 'agent_news')"),
  search: z.string().describe('Le texte exact à rechercher et remplacer'),
  replace: z.string().describe('Le nouveau texte de remplacement'),
});

// --- Tools ---

export async function createPrompt(args: z.infer<typeof createPromptSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const manager = new PromptManager();
  const { name, content } = args;

  const result = await manager.createPrompt(name, content);

  return {
    content: [
      {
        type: 'text',
        text: `✅ Prompt '${name}' ${result.existed ? 'mis à jour' : 'créé'} avec succès.\n📍 ${result.filePath}`,
      },
    ],
  };
}

export async function editPrompt(args: z.infer<typeof editPromptSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  const manager = new PromptManager();
  const { name, search, replace } = args;

  const result = await manager.editPrompt(name, search, replace);

  if (!result.success) {
    if (result.error === 'SEARCH_NOT_FOUND') {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `❌ Erreur : Le texte recherché n'a pas été trouvé dans '${name}.md'.\n\nTexte recherché :\n${search}`,
          },
        ],
      };
    } else {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `❌ Erreur lors de la lecture du fichier '${name}.md': ${result.error}`,
          },
        ],
      };
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: `✅ Prompt '${name}' modifié avec succès.\n\n🔻 Avant :\n${search}\n\n🔺 Après :\n${replace}`,
      },
    ],
  };
}
