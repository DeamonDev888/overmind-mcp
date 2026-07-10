/**
 * HermesPoolClient — Thin wrapper over the native Hermes credential pool.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  WHY THIS EXISTS                                                          ║
 * ║                                                                            ║
 * ║  Hermes manages API keys centrally via `hermes auth add <provider>`.        ║
 * ║  Credentials are stored in a global pool with automatic rotation            ║
 * ║  (round_robin by default) and rate-limit aware failover.                   ║
 * ║                                                                            ║
 * ║  Overmind previously wrote `.env` files with hardcoded credentials per     ║
 * ║  profile. That defeated the pool — one key per profile, no rotation,        ║
 * ║  no failover. The right approach is to add credentials to the POOL          ║
 * ║  and let Hermes resolve them per profile.                                  ║
 * ║                                                                            ║
 * ║  Providers in the pool (from `hermes auth list`):                          ║
 * ║    - anthropic, copilot, deepseek, minimax, minimax-cn,                    ║
 * ║      openai-api, qwen-oauth, xai, zai                                      ║
 * ║                                                                            ║
 * ║  Per-profile: only config.yaml's `model.provider` is needed.               ║
 * ║  Hermes resolves the credentials + base_url from the pool automatically.    ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { rootLogger } from '../lib/logger.js';

const execAsync = promisify(exec);
const logger = rootLogger.child({ module: 'HermesPoolClient' });

export interface PoolCredential {
  /** Display label, e.g. "GLM coding 34" or "DeepSeek 7" */
  label: string;
  /** Where the credential came from: env var, manual entry, OAuth file, etc. */
  source: 'env' | 'manual' | 'oauth' | 'gh_cli' | 'unknown';
  /** Currently active in the rotation (← marker) */
  active: boolean;
  /** Raw suffix of the key for display, e.g. "sk-o...e25b" */
  preview?: string;
  /** If rate-limited, e.g. "rate-limited rate_limit_error (429) (10m 10s left)" */
  status?: string;
}

export interface PoolProvider {
  /** Canonical Hermes provider id, e.g. "zai", "minimax-cn", "deepseek" */
  id: string;
  /** Total number of credentials in this provider's pool */
  count: number;
  /** True if at least one credential is currently active (not rate-limited) */
  hasActive: boolean;
  /** All credentials in the pool, in rotation order */
  credentials: PoolCredential[];
}

export class HermesPoolClient {
  /**
   * List all providers and their credentials from `hermes auth list`.
   * The output format is:
   *
   *   <provider-id> (N credentials):
   *     #1  <label>  api_key <source> [<status>] [←]
   *     #2  <label>  api_key <source>
   *     ...
   */
  static async list(): Promise<PoolProvider[]> {
    const { stdout } = await execAsync('hermes auth list', { timeout: 10000 });
    return this.parseAuthList(stdout);
  }

  static parseAuthList(raw: string): PoolProvider[] {
    const providers: PoolProvider[] = [];
    const lines = raw.split(/\r?\n/);
    let current: PoolProvider | null = null;

    for (const line of lines) {
      // Header line: "<provider-id> (N credentials):"
      const headerMatch = line.match(/^([a-z0-9_-]+)\s+\((\d+)\s+credentials?\):\s*$/i);
      if (headerMatch) {
        if (current) providers.push(current);
        current = {
          id: headerMatch[1],
          count: parseInt(headerMatch[2], 10),
          hasActive: false,
          credentials: [],
        };
        continue;
      }

      // Credential line: "  #1  <label>  api_key <source> [<status>] [←]"
      const credMatch = line.match(
        /^\s*#\d+\s+(.+?)\s{2,}api_key\s+(\S+)(?:\s+(.+?))?(?:\s+←)?\s*$/,
      );
      if (credMatch && current) {
        const label = credMatch[1].trim();
        const rawSource = credMatch[2];
        const statusField = credMatch[3]?.trim();
        const active = line.includes('←');

        // Detect source type
        let source: PoolCredential['source'] = 'unknown';
        if (rawSource.startsWith('env:')) source = 'env';
        else if (rawSource === 'manual') source = 'manual';
        else if (rawSource === 'oauth') source = 'oauth';
        else if (rawSource === 'gh_cli') source = 'gh_cli';

        current.credentials.push({
          label,
          source,
          active,
          preview: statusField && /^[a-z]+-/i.test(statusField) ? statusField : undefined,
          status: statusField && (statusField.includes('rate-limited') || statusField.includes('error'))
            ? statusField
            : undefined,
        });
        if (active) current.hasActive = true;
        continue;
      }
    }

    if (current) providers.push(current);
    return providers;
  }

  /**
   * Get a specific provider's pool info. Returns null if provider doesn't exist.
   */
  static async getProvider(providerId: string): Promise<PoolProvider | null> {
    const all = await this.list();
    return all.find((p) => p.id === providerId) ?? null;
  }

  /**
   * Add a credential to a provider's pool.
   * Wraps `hermes auth add <provider> --api-key <key> [--inference-url <url>]`.
   */
  static async addCredential(
    providerId: string,
    apiKey: string,
    opts: { label?: string; inferenceUrl?: string } = {},
  ): Promise<void> {
    const args = ['hermes', 'auth', 'add', providerId, '--type', 'api-key', '--api-key', apiKey];
    if (opts.label) args.push('--label', opts.label);
    if (opts.inferenceUrl) args.push('--inference-url', opts.inferenceUrl);
    await execAsync(args.join(' '), { timeout: 30000 });
    logger.info({ providerId, label: opts.label }, '[POOL] Credential added.');
  }

  /**
   * Remove a credential from a provider's pool by label.
   * Hermes auth remove uses positional <provider> <label>.
   */
  static async removeCredential(providerId: string, label: string): Promise<void> {
    await execAsync(`hermes auth remove "${providerId}" "${label}"`, { timeout: 15000 });
    logger.info({ providerId, label }, '[POOL] Credential removed.');
  }

  /**
   * Sync a list of credentials into the pool, deduped by label.
   * Useful for bulk-importing from an Overmind workspace .env.
   */
  static async syncCredentials(
    providerId: string,
    credentials: Array<{ apiKey: string; label?: string; inferenceUrl?: string }>,
  ): Promise<{ added: number; skipped: number }> {
    const existing = await this.getProvider(providerId);
    const existingLabels = new Set(existing?.credentials.map((c) => c.label) ?? []);

    let added = 0;
    let skipped = 0;
    for (const cred of credentials) {
      const label = cred.label ?? `imported-${Date.now()}-${added}`;
      if (existingLabels.has(label)) {
        skipped++;
        continue;
      }
      try {
        await this.addCredential(providerId, cred.apiKey, {
          label,
          inferenceUrl: cred.inferenceUrl,
        });
        added++;
      } catch (e) {
        logger.warn({ providerId, label, error: e }, '[POOL] Failed to add credential.');
        skipped++;
      }
    }
    return { added, skipped };
  }

  /**
   * Check if a provider has at least one healthy credential available.
   */
  static async isProviderHealthy(providerId: string): Promise<boolean> {
    const provider = await this.getProvider(providerId);
    return provider?.hasActive ?? false;
  }

  /**
   * List all healthy providers (at least one non-rate-limited credential).
   */
  static async listHealthyProviders(): Promise<string[]> {
    const all = await this.list();
    return all.filter((p) => p.hasActive).map((p) => p.id);
  }

  /**
   * Compute a short summary of the pool state — useful for status embeds / dashboards.
   */
  static async summary(): Promise<{
    totalProviders: number;
    totalCredentials: number;
    healthyProviders: string[];
    rateLimitedProviders: string[];
  }> {
    const all = await this.list();
    const healthy: string[] = [];
    const rateLimited: string[] = [];
    let totalCreds = 0;

    for (const p of all) {
      totalCreds += p.credentials.length;
      if (p.hasActive) healthy.push(p.id);
      else rateLimited.push(p.id);
    }

    return {
      totalProviders: all.length,
      totalCredentials: totalCreds,
      healthyProviders: healthy,
      rateLimitedProviders: rateLimited,
    };
  }
}
