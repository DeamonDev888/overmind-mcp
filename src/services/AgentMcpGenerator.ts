import fs from 'fs';
import path from 'path';
import { resolveConfigPath, getWorkspaceDir } from '../lib/config.js';

interface McpConfig {
  mcpServers: Record<string, { command: string; args: string[] }>;
}

interface AgentSettings {
  enableAllProjectMcpServers?: boolean;
  enabledMcpjsonServers?: string[];
}

/**
 * Service pour générer et mettre à jour les fichiers MCP individuels par agent
 *
 * Chaque agent dispose de son propre fichier .mcp.{agent_name}.json
 * qui ne contient QUE les serveurs MCP autorisés pour cet agent.
 */
export class AgentMcpGenerator {
  private workspaceDir: string;
  private agentsDir: string;
  private mcpConfigPath: string;

  constructor() {
    this.workspaceDir = getWorkspaceDir();
    this.agentsDir = path.join(this.workspaceDir, 'Workflow', '.claude');
    this.mcpConfigPath = resolveConfigPath('./.mcp.json');
  }

  /**
   * Génère le fichier MCP individuel pour un agent spécifique
   */
  generateAgentMcp(agentName: string): boolean {
    const settingsPath = path.join(this.agentsDir, `settings_${agentName}.json`);

    if (!fs.existsSync(settingsPath)) {
      console.warn(`[AgentMcpGenerator] Settings non trouvé pour l'agent: ${agentName}`);
      return false;
    }

    try {
      const settings: AgentSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

      // Si l'agent utilise tous les MCPs, on ne crée pas de fichier dédié
      if (
        settings.enableAllProjectMcpServers !== false ||
        !Array.isArray(settings.enabledMcpjsonServers)
      ) {
        // Supprimer le fichier MCP s'il existe
        const agentMcpPath = path.join(this.agentsDir, `.mcp.${agentName}.json`);
        if (fs.existsSync(agentMcpPath)) {
          fs.unlinkSync(agentMcpPath);
          console.log(`[AgentMcpGenerator] Supprimé: ${agentMcpPath}`);
        }
        return false;
      }

      // Lire la configuration MCP principale
      if (!fs.existsSync(this.mcpConfigPath)) {
        console.warn(`[AgentMcpGenerator] Fichier MCP non trouvé: ${this.mcpConfigPath}`);
        return false;
      }

      const fullMcp: McpConfig = JSON.parse(fs.readFileSync(this.mcpConfigPath, 'utf8'));
      const filteredMcp: McpConfig = { mcpServers: {} };

      // Filtrer uniquement les MCPs autorisés
      for (const serverName of settings.enabledMcpjsonServers) {
        if (fullMcp.mcpServers && fullMcp.mcpServers[serverName]) {
          filteredMcp.mcpServers[serverName] = fullMcp.mcpServers[serverName];
        }
      }

      // Écrire le fichier MCP individuel de l'agent
      const agentMcpPath = path.join(this.agentsDir, `.mcp.${agentName}.json`);
      fs.writeFileSync(agentMcpPath, JSON.stringify(filteredMcp, null, 2));

      console.log(
        `[AgentMcpGenerator] ✅ Généré: .mcp.${agentName}.json (${Object.keys(filteredMcp.mcpServers).length} serveurs)`,
      );
      return true;
    } catch (err) {
      console.error(`[AgentMcpGenerator] ❌ Erreur pour ${agentName}:`, err);
      return false;
    }
  }

  /**
   * Régénère tous les fichiers MCP pour tous les agents
   */
  regenerateAll(): { generated: number; skipped: number; errors: number } {
    console.log('[AgentMcpGenerator] 🔄 Régénération de tous les fichiers MCP...');

    const result = { generated: 0, skipped: 0, errors: 0 };

    if (!fs.existsSync(this.agentsDir)) {
      console.error('[AgentMcpGenerator] Dossier agents non trouvé:', this.agentsDir);
      return result;
    }

    const settingsFiles = fs
      .readdirSync(this.agentsDir)
      .filter((f) => f.startsWith('settings_') && f.endsWith('.json'))
      .sort();

    for (const settingsFile of settingsFiles) {
      const agentName = settingsFile.replace('settings_', '').replace('.json', '');

      try {
        const generated = this.generateAgentMcp(agentName);
        if (generated) {
          result.generated++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        console.error(`[AgentMcpGenerator] ❌ ${agentName}:`, err);
        result.errors++;
      }
    }

    console.log(
      `[AgentMcpGenerator] ✅ Terminé: ${result.generated} générés, ${result.skipped} ignorés, ${result.errors} erreurs`,
    );
    return result;
  }

  /**
   * Retourne le chemin du fichier MCP individuel d'un agent
   */
  getAgentMcpPath(agentName: string): string | null {
    const agentMcpPath = path.join(this.agentsDir, `.mcp.${agentName}.json`);
    return fs.existsSync(agentMcpPath) ? agentMcpPath : null;
  }

  /**
   * Vérifie si un fichier MCP existe pour un agent
   */
  hasAgentMcp(agentName: string): boolean {
    return this.getAgentMcpPath(agentName) !== null;
  }
}

// Instance singleton
let generatorInstance: AgentMcpGenerator | null = null;

export function getAgentMcpGenerator(): AgentMcpGenerator {
  if (!generatorInstance) {
    generatorInstance = new AgentMcpGenerator();
  }
  return generatorInstance;
}
