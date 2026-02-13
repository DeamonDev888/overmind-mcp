import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Helpers ---
function getAgentsDir() {
  const currentFileUrl = import.meta.url;
  const currentFilePath = fileURLToPath(currentFileUrl);
  // src/tools/manage_prompts.ts -> src/tools -> src -> Workflow
  const projectRoot = path.resolve(path.dirname(currentFilePath), '../../');
  return path.resolve(projectRoot, '.claude', 'agents');
}

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

export async function createPrompt(args: z.infer<typeof createPromptSchema>): Promise<any> {
  const { name, content } = args;
  const agentsDir = getAgentsDir();

  await fs.mkdir(agentsDir, { recursive: true });

  const filePath = path.join(agentsDir, `${name}.md`);

  // Check if exists to avoid accidental overwrite? User didn't ask, but "create" implies new.
  // We'll allow overwrite but log it.
  const exists = await fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);

  await fs.writeFile(filePath, content, 'utf-8');

  return {
    content: [
      {
        type: 'text',
        text: `✅ Prompt '${name}' ${exists ? 'mis à jour' : 'créé'} avec succès.\n📍 ${filePath}`,
      },
    ],
  };
}

export async function editPrompt(args: z.infer<typeof editPromptSchema>): Promise<any> {
  const { name, search, replace } = args;
  const agentsDir = getAgentsDir();
  const filePath = path.join(agentsDir, `${name}.md`);

  try {
    const content = await fs.readFile(filePath, 'utf-8');

    if (!content.includes(search)) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `❌ Erreur : Le texte recherché n'a pas été trouvé dans '${name}.md'.\n\nTexte recherché :\n${search}`,
          },
        ],
      };
    }

    const newContent = content.replace(search, replace);
    await fs.writeFile(filePath, newContent, 'utf-8');

    return {
      content: [
        {
          type: 'text',
          text: `✅ Prompt '${name}' modifié avec succès.\n\n🔻 Avant :\n${search}\n\n🔺 Après :\n${replace}`,
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `❌ Erreur lors de la lecture du fichier '${name}.md': ${error.message}`,
        },
      ],
    };
  }
}
