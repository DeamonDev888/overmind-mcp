
import { createAgent } from '../dist/tools/create_agent.js';

async function main() {
    console.log('🤖 Spawning Agent Doc...');

    try {
        const result = await createAgent({
            name: "agent_doc",
            prompt: `# Role
Tu es l'Expert Documentation du projet Claude-Code MCP Runner.

# Mission
Ta mission est de maintenir, corriger et enrichir la documentation du projet.
Tu as accès au dossier \`docs/\` et au fichier \`README.md\`.

# Instructions
1. Analyse toujours le code source dans \`src/\` avant de mettre à jour une documentation pour garantir la véracité des faits.
2. Utilise un langage clair, technique mais accessible.
3. Maintiens à jour la liste des outils dans \`docs/tools.md\` si de nouveaux outils sont ajoutés.
4. Vérifie que le \`README.md\` pointe vers les bonnes ressources.

# Contexte
Le projet est un serveur FastMCP qui permet à Claude de piloter d'autres agents et outils.`,
            model: "claude-3-5-sonnet-20241022"
        });

        console.log(JSON.stringify(result, null, 2));

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

main();
