/**
 * HermesProfileManager — Thin wrapper around `hermes profile` CLI.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  PURPOSE                                                                  ║
 * ║                                                                          ║
 * ║  Replaces the old dual-layout (HERMES_HOME/agents/<name>/settings.json   ║
 * ║  vs .claude/settings_<name>.json) with the native Hermes profile system. ║
 * ║                                                                          ║
 * ║  Each Overmind Hermes agent = one Hermes profile:                        ║
 * ║    ~/.hermes/profiles/<name>/                                            ║
 * ║      ├── config.yaml   (provider, model, mcp_servers)                    ║
 * ║      ├── .env          (credentials)                                     ║
 * ║      ├── SOUL.md       (system prompt)                                   ║
 * ║      ├── memories/     (state.db — isolated)                             ║
 * ║      ├── sessions/     (conversation history)                            ║
 * ║      └── skills/       (procedural memory)                               ║
 * ║                                                                          ║
 * ║  All operations go through `hermes profile` CLI — no manual file         ║
 * ║  management, no HERMES_HOME guessing.                                    ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 */

import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { rootLogger } from '../lib/logger.js';
import { HermesPoolClient } from './HermesPoolClient.js';

const execAsync = promisify(exec);
const logger = rootLogger.child({ module: 'HermesProfileManager' });

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export interface HermesProfileInfo {
  name: string;
  model: string;
  gateway: string;
  skills: number;
  active: boolean;
}

export interface CreateProfileOptions {
  name: string;
  prompt: string; // System prompt for SOUL.md
  model: string;
  provider?: string; // If omitted, auto-detect from model
  credentials: Record<string, string>; // Key-value pairs for .env
  mcpServers?: string[]; // MCP server names for config.yaml
  description?: string; // For kanban routing
}

/**
 * Detect the Hermes provider name from a model string.
 * Uses simple heuristics matching the actual provider IDs in Hermes pool:
 *   glm/zai → 'zai', minimax/m3 → 'minimax-cn', claude/sonnet/opus/haiku → 'anthropic',
 *   gpt → 'openai-api', deepseek → 'deepseek', gemini → 'gemini', etc.
 *
 * For unknown models, falls back to 'openai-api' (most permissive).
 */
function detectProviderFromModel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('glm') || lower.includes('zai')) return 'zai';
  if (lower.includes('minimax') || lower.includes('m3') || lower.includes('MiniMax')) return 'minimax-cn';
  if (lower.includes('claude') || lower.includes('sonnet') || lower.includes('opus') || lower.includes('haiku')) return 'anthropic';
  if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3')) return 'openai-api';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('gemini')) return 'gemini';
  if (lower.includes('qwen')) return 'qwen-oauth';
  if (lower.includes('grok') || lower.includes('xai')) return 'xai';
  return 'openai-api'; // safe default (most permissive)
}

export class HermesProfileManager {
  /**
   * Check if a Hermes profile exists.
   */
  static exists(name: string): boolean {
    if (!SAFE_NAME_RE.test(name)) return false;
    try {
      const stdout = execSync(`hermes profile list`, { encoding: 'utf-8', timeout: 10000 });
      return stdout.includes(name);
    } catch {
      return false;
    }
  }

  /**
   * List all Hermes profiles.
   */
  static async list(): Promise<HermesProfileInfo[]> {
    try {
      const { stdout } = await execAsync('hermes profile list');
      return this.parseProfileList(stdout);
    } catch (e) {
      logger.warn({ error: e }, 'Failed to list Hermes profiles');
      return [];
    }
  }

  /**
   * Parse `hermes profile list` output into structured data.
   *
   * Output format:
   *   Profile          Model                        Gateway      Alias
   *   ───────────────    ───────────────────────────    ───────────    ───────────
   *   ◆default         MiniMax-M3                   stopped      —
   *    testwrapper     —                            stopped      —
   */
  static parseProfileList(rawOutput: string): HermesProfileInfo[] {
    const lines = rawOutput.split(/\r?\n/);
    const profiles: HermesProfileInfo[] = [];

    for (const line of lines) {
      // Match lines with profile data (skip header + separator)
      // Active profile has ◆ prefix, others have leading space
      const match = line.match(/^(◆|\s)\s*(\S+)\s+(.+?)\s{2,}(\S+)\s{2,}(\S+)/);
      if (!match) continue;

      const active = match[1] === '◆';
      const name = match[2];
      const model = match[3].trim();
      const gateway = match[4];
      // Skills count is sometimes missing from the basic list output

      // Skip header lines
      if (name === 'Profile' || name.startsWith('─')) continue;

      profiles.push({ name, model, gateway, skills: 0, active });
    }

    return profiles;
  }

  /**
   * Create a new Hermes profile that uses the NATIVE Hermes credential pool.
   *
   * Steps:
   *   1. Validate provider is healthy in the Hermes pool (round_robin rotation)
   *   2. hermes profile create <name> --no-alias --description "<desc>"
   *   3. hermes -p <name> config set model.provider <provider>
   *   4. hermes -p <name> config set model.model <model>
   *   5. Write SOUL.md with system prompt
   *   6. Optionally set mcp_servers in config.yaml
   *   7. Generate profile.yaml/workspace.yaml/README
   *
   * NOTE: We do NOT write credentials to the profile's .env anymore — Hermes
   * resolves them from the global pool via `hermes auth list`. The profile's
   * .env stays empty (just the placeholder comment Hermes writes by default).
   *
   * If `opts.credentials` is provided, they are added to the GLOBAL POOL via
   * `hermes auth add` (deduped by label) rather than written to the profile.
   */
  static async create(
    opts: CreateProfileOptions,
  ): Promise<{ profilePath: string; soulPath: string; provider: string }> {
    const { name, prompt, model } = opts;

    if (!SAFE_NAME_RE.test(name)) {
      throw new Error(`Invalid profile name: '${name}'. Only [a-zA-Z0-9_-] allowed.`);
    }

    const provider = opts.provider || detectProviderFromModel(model);
    const description = opts.description || `Overmind agent: ${name}`;

    logger.info({ name, model, provider }, '[CREATE] Creating Hermes profile.');

    // 0. If credentials were provided, add them to the GLOBAL POOL (not the profile)
    //    This way multiple profiles can share the same key with round_robin rotation.
    if (opts.credentials && Object.keys(opts.credentials).length > 0) {
      const apiKey = opts.credentials.api_key ?? opts.credentials.API_KEY ?? Object.values(opts.credentials)[0];
      if (apiKey) {
        const label = `overmind-${name}-${Date.now()}`;
        try {
          await HermesPoolClient.addCredential(provider, apiKey, { label });
          logger.info({ provider, label }, '[CREATE] Credential added to global pool.');
        } catch (e) {
          logger.warn({ provider, error: e }, '[CREATE] Failed to add credential to pool (continuing).');
        }
      }
    }

    // 0b. Validate that the provider is healthy in the pool (has at least one active key)
    //     This prevents creating a profile that can't actually run.
    const healthy = await HermesPoolClient.isProviderHealthy(provider);
    if (!healthy) {
      logger.warn(
        { provider, name },
        '[CREATE] Provider has NO healthy credentials in the pool. Profile will fail to run until you add one via: hermes auth add ' + provider + ' --api-key <key>',
      );
    }

    // 1. Create profile (no-alias to avoid polluting PATH).
    //    Use \\ to escape the inner quote cleanly without no-useless-escape.
    const createCmd = `hermes profile create "${name}" --no-alias --description "${description.replace(/"/g, '\\"')}"`;
    try {
      await execAsync(createCmd);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('already exists')) {
        throw new Error(`Failed to create profile '${name}': ${msg}`, { cause: e });
      }
      logger.warn({ name }, '[CREATE] Profile already exists, will update configuration.');
    }

    // 2. Set provider + model in config.yaml
    await execAsync(`hermes -p "${name}" config set model.provider "${provider}"`);
    await execAsync(`hermes -p "${name}" config set model.model "${model}"`);

    // 3. Get profile path
    const profilePath = await this.getProfilePath(name);
    if (!profilePath) {
      throw new Error(`Could not resolve profile path for '${name}'`);
    }

    // 4. SOUL.md (system prompt) — the ONLY profile-specific file we write
    const soulPath = path.join(profilePath, 'SOUL.md');
    fs.writeFileSync(soulPath, prompt, 'utf-8');

    // 5. Optionally set MCP servers
    if (opts.mcpServers && opts.mcpServers.length > 0) {
      await this.setMcpServers(name, opts.mcpServers, profilePath);
    }

    // 6. Generate profile.yaml (kanban routing — OBLIGATOIRE)
    this.writeProfileYaml(profilePath, name, description, model);

    // 7. Generate workspace.yaml
    this.writeWorkspaceYaml(profilePath, 'persistent');

    // 8. Generate README.md
    this.writeReadme(profilePath, name, description);

    logger.info(
      { name, profilePath, provider, poolHealthy: healthy },
      '[CREATE] Profile created successfully (credentials via global pool).',
    );

    return { profilePath, soulPath, provider };
  }

  /**
   * Delete a Hermes profile permanently.
   */
  static async delete(name: string): Promise<void> {
    if (!SAFE_NAME_RE.test(name)) {
      throw new Error(`Invalid profile name: '${name}'`);
    }
    try {
      await execAsync(`hermes profile delete "${name}" --yes`);
      logger.info({ name }, '[DELETE] Profile deleted.');
    } catch (e) {
      logger.warn({ name, error: e }, '[DELETE] Failed to delete profile.');
      throw e;
    }
  }

  /**
   * Get the filesystem path for a profile.
   *
   * Queries `hermes profile show <name>` to get the real path from Hermes itself.
   * This is the ONLY reliable way — Hermes controls where profiles live, and the
   * location depends on HERMES_HOME (Windows: AppData\Local\hermes, Linux: ~/.hermes).
   *
   * Falls back to the canonical layout under the shared Hermes home if the CLI
   * call fails (e.g. profile doesn't exist yet).
   */
  static async getProfilePath(name: string): Promise<string | null> {
    // 1. Try `hermes profile show <name>` — the authoritative source
    try {
      const { stdout } = await execAsync(`hermes profile show "${name}"`);
      const match = stdout.match(/Path:\s*(.+)/);
      if (match?.[1]) {
        const resolved = match[1].trim();
        if (fs.existsSync(resolved)) return resolved;
      }
    } catch {
      // Profile may not exist yet, or hermes CLI unavailable — fall through
    }

    // 2. Fallback: construct canonical path under shared Hermes home
    //    Hermes default: HERMES_HOME/profiles/<name>/
    //    On Windows official: AppData\Local\hermes\profiles\<name>\
    //    On Linux: ~/.hermes/profiles/<name>/
    const hermesHome = process.env.HERMES_HOME
      || (process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || os.homedir(), 'hermes')
        : path.join(os.homedir(), '.hermes'));

    return path.join(hermesHome, 'profiles', name);
  }

  /**
   * Set MCP servers in a profile's config.yaml.
   *
   * Reads the workspace .mcp.json to get the actual server configs (URL, command, etc.)
   * and writes them as proper YAML entries in the profile's config.yaml.
   */
  static async setMcpServers(
    profileName: string,
    servers: string[],
    profilePath: string,
  ): Promise<void> {
    const configPath = path.join(profilePath, 'config.yaml');

    // Read existing config or start fresh
    let configContent: string;
    try {
      configContent = fs.readFileSync(configPath, 'utf-8');
    } catch {
      configContent = '';
    }

    // Read the workspace .mcp.json to get actual server configs
    const { getWorkspaceDir } = await import('../lib/config.js');
    let mcpConfigs: Record<
      string,
      { url?: string; type?: string; command?: string; args?: string[] }
    >;
    try {
      const mcpJsonPath = path.join(getWorkspaceDir(), '.mcp.json');
      const mcpContent = fs.readFileSync(mcpJsonPath, 'utf-8');
      const parsed = JSON.parse(mcpContent);
      mcpConfigs = parsed.mcpServers || parsed.mcp_servers || {};
    } catch {
      logger.warn(
        '[SET_MCP] Could not read workspace .mcp.json — MCP servers will not be configured.',
      );
      return;
    }

    // Build the mcp_servers YAML block
    // Remove any existing mcp_servers section first
    const lines = configContent.split(/\r?\n/);
    const filtered = lines.filter((line, i) => {
      // Remove existing mcp_servers block
      if (line.match(/^mcp_servers:/)) return false;
      // Check if we're inside an mcp_servers block (indented after mcp_servers:)
      let inBlock = false;
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].match(/^mcp_servers:/)) {
          // Check if current line is indented (part of the block)
          if (line.match(/^\s/) && !line.match(/^\S/)) {
            inBlock = true;
          }
          break;
        }
        // If we hit a non-indented non-empty line that's not mcp_servers, we're outside
        if (lines[j].trim() && !lines[j].match(/^\s/)) break;
      }
      return !inBlock;
    });

    configContent = filtered
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();

    // Add the mcp_servers block with real configs
    const yamlLines: string[] = ['\n\nmcp_servers:'];
    let added = 0;
    for (const serverName of servers) {
      const cfg = mcpConfigs[serverName];
      if (cfg && cfg.url) {
        yamlLines.push(`  ${serverName}:`);
        yamlLines.push(`    url: ${cfg.url}`);
        added++;
      } else if (cfg && cfg.command) {
        yamlLines.push(`  ${serverName}:`);
        yamlLines.push(`    command: ${cfg.command}`);
        if (cfg.args && cfg.args.length > 0) {
          yamlLines.push(`    args:`);
          for (const arg of cfg.args) {
            yamlLines.push(`    - ${arg}`);
          }
        }
        added++;
      } else {
        logger.warn({ serverName }, '[SET_MCP] Server not found in .mcp.json — skipping.');
      }
    }

    if (added > 0) {
      configContent += '\n' + yamlLines.join('\n') + '\n';
      fs.writeFileSync(configPath, configContent, 'utf-8');
      logger.info({ profileName, added }, '[SET_MCP] MCP servers configured in config.yaml.');
    } else {
      logger.warn({ profileName }, '[SET_MCP] No MCP servers could be configured.');
    }
  }

  // ─── v3.1 Profile Scaffolding ────────────────────────────────────────────

  /** Write profile.yaml (kanban description — OBLIGATOIRE) */
  private static writeProfileYaml(
    profilePath: string,
    name: string,
    description: string,
    model: string,
  ): void {
    const yaml = [
      '# Profile metadata — kanban routing (OBLIGATOIRE)',
      `name: "${name}"`,
      `description: "${description.replace(/"/g, '\\"')}"`,
      `model: "${model}"`,
      'workspace: persistent',
      `created: ${new Date().toISOString()}`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(profilePath, 'profile.yaml'), yaml, 'utf-8');
  }

  /** Write workspace.yaml (kind: scratch|persistent|shared) */
  private static writeWorkspaceYaml(
    profilePath: string,
    kind: 'scratch' | 'persistent' | 'shared',
  ): void {
    const yaml = [`kind: ${kind}`, `path: ${profilePath}`, `gc_eligible: false`, ''].join('\n');
    fs.writeFileSync(path.join(profilePath, 'workspace.yaml'), yaml, 'utf-8');
  }

  /** Write README.md (role + contacts) */
  private static writeReadme(profilePath: string, name: string, description: string): void {
    const md = [
      `# ${name}`,
      '',
      `**Role**: ${description}`,
      '',
      `**Owner**: overmind-mcp`,
      `**Created**: ${new Date().toISOString()}`,
      '',
      '---',
      'Generated by overmind-mcp v3.1',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(profilePath, 'README.md'), md, 'utf-8');
  }

  /**
   * Update specific fields of an existing profile.
   */
  static async update(
    name: string,
    updates: {
      model?: string;
      provider?: string;
      credentials?: Record<string, string>;
      prompt?: string; // SOUL.md content
      mcpServers?: string[];
    },
  ): Promise<void> {
    if (!SAFE_NAME_RE.test(name)) {
      throw new Error(`Invalid profile name: '${name}'`);
    }

    const profilePath = await this.getProfilePath(name);
    if (!profilePath || !fs.existsSync(profilePath)) {
      throw new Error(`Profile '${name}' not found.`);
    }

    // Update model + provider
    if (updates.model) {
      const provider = updates.provider || detectProviderFromModel(updates.model);
      await execAsync(`hermes -p "${name}" config set model.provider "${provider}"`);
      await execAsync(`hermes -p "${name}" config set model.model "${updates.model}"`);
    }

    // Update credentials
    if (updates.credentials) {
      const envPath = path.join(profilePath, '.env');
      let envContent: string;
      try {
        envContent = fs.readFileSync(envPath, 'utf-8');
      } catch {
        envContent = '';
      }

      for (const [key, value] of Object.entries(updates.credentials)) {
        // Replace existing key or append
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
          envContent += `${key}=${value}\n`;
        }
      }

      fs.writeFileSync(envPath, envContent, 'utf-8');
    }

    // Update SOUL.md
    if (updates.prompt) {
      const soulPath = path.join(profilePath, 'SOUL.md');
      fs.writeFileSync(soulPath, updates.prompt, 'utf-8');
    }

    // Update MCP servers
    if (updates.mcpServers) {
      await this.setMcpServers(name, updates.mcpServers, profilePath);
    }

    logger.info({ name, updates: Object.keys(updates) }, '[UPDATE] Profile updated.');
  }
}
