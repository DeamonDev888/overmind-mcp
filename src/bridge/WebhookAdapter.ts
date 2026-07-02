/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — WebhookAdapter (Generic Webhook → Bridge)        ║
 * ║                                                                      ║
 * ║   Normalise les webhooks de providers variés vers un format         ║
 * ║   uniforme consommable par l'API agent.run.                         ║
 * ║                                                                      ║
 *   PROVIDERS SUPPORTÉS                                                ║
 *   ────────────────────                                               ║
 *   - voipms    : VoIP.ms (from, to, message, id, date, media)        ║
 *   - twilio    : Twilio (From, To, Body, MessageSid, MediaUrl0)       ║
 *   - telegram  : Telegram Bot API (message.chat.id, message.from.id)  ║
 *   - discord   : Discord-like (channelId, userId, content)            ║
 *   - generic   : Format customisable (mapping field-by-field)         ║
 * ║                                                                      ║
 * ║   Chaque adapter retourne un NormalizedWebhook qui contient :        ║
 * ║     - externalKey : clé pour SessionStore (phone, user, etc.)       ║
 * ║     - prompt      : texte à envoyer à l'agent (déjà contextualisé)  ║
 * ║     - metadata    : données brutes pour audit                        ║
 * ║     - mediaUrls   : URLs de médias attachés                          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { createBridgeLogger, type BridgeLogger } from './utils.js';
import { formatDiscordContext } from './utils.js';

// ─── Public Types ──────────────────────────────────────────────────────────

export interface NormalizedWebhook {
  /** Clé externe pour SessionStore (ex: numéro de téléphone) */
  externalKey: string;
  /** Prompt à passer à l'agent (déjà contextualisé) */
  prompt: string;
  /** Liste des URLs de médias (optionnel) */
  mediaUrls: string[];
  /** Métadonnées brutes (provider, messageId, etc.) */
  metadata: Record<string, unknown>;
}

export type WebhookProvider = 'voipms' | 'twilio' | 'telegram' | 'generic' | 'discord';

export interface WebhookAdapterConfig {
  /** Nom du provider (default: 'voipms') */
  provider?: WebhookProvider;
  /** Pour 'generic' : mapping custom field → champ normalisé */
  fieldMap?: Partial<Record<keyof NormalizedWebhook, string>>;
  /** Préfixe ajouté au prompt (ex: '[SMS reçu]') */
  promptPrefix?: string;
  /** Inclure un contexte Discord-like dans le prompt */
  discordContext?: {
    channelId?: string;
    userId?: string;
    username?: string;
  };
  /** Logger */
  logger?: BridgeLogger;
}

// ─── WebhookAdapter ────────────────────────────────────────────────────────

export class WebhookAdapter {
  private readonly config: Required<Omit<WebhookAdapterConfig, 'fieldMap' | 'discordContext' | 'logger'>> &
    Pick<WebhookAdapterConfig, 'fieldMap' | 'discordContext'>;
  private readonly log: BridgeLogger;

  constructor(config: WebhookAdapterConfig = {}) {
    this.config = {
      provider: config.provider ?? 'voipms',
      promptPrefix: config.promptPrefix ?? '',
      fieldMap: config.fieldMap,
      discordContext: config.discordContext,
    };
    this.log = config.logger ?? createBridgeLogger('webhook-adapter');
  }

  /**
   * Adapte un payload brut vers un NormalizedWebhook.
   */
  adapt(rawPayload: Record<string, unknown>): NormalizedWebhook {
    switch (this.config.provider) {
      case 'voipms':
        return this.adaptVoipMs(rawPayload);
      case 'twilio':
        return this.adaptTwilio(rawPayload);
      case 'telegram':
        return this.adaptTelegram(rawPayload);
      case 'discord':
        return this.adaptDiscord(rawPayload);
      case 'generic':
        return this.adaptGeneric(rawPayload);
      default: {
        const _exhaustive: never = this.config.provider;
        throw new Error(`Unknown provider: ${String(_exhaustive)}`);
      }
    }
  }

  // ─── Provider Adapters ──────────────────────────────────────────────────

  /**
   * VoIP.ms callback format.
   * Params: from, to, message, id, date, media (URLs séparées par |)
   * Body peut être GET query ou POST form-encoded.
   */
  private adaptVoipMs(raw: Record<string, unknown>): NormalizedWebhook {
    const from = stringOr(raw.from ?? raw.From, 'unknown');
    const to = stringOr(raw.to ?? raw.To, 'unknown');
    const message = stringOr(raw.message ?? raw.Message ?? raw.Body ?? raw.body, '');
    const messageId = stringOr(raw.id ?? raw.MessageSid, '');
    const date = stringOr(raw.date ?? raw.Date, new Date().toISOString());
    const mediaRaw = stringOr(raw.media ?? raw.MediaUrl0 ?? '', '');
    const mediaUrls = mediaRaw ? mediaRaw.split('|').map((u) => u.trim()).filter(Boolean) : [];

    const promptParts: string[] = [];
    if (this.config.promptPrefix) promptParts.push(this.config.promptPrefix);
    promptParts.push(`[Webhook VoIP.ms]`);
    promptParts.push(`From: ${from}`);
    promptParts.push(`To: ${to}`);
    promptParts.push(`Date: ${date}`);
    if (messageId) promptParts.push(`MessageId: ${messageId}`);
    promptParts.push('---');
    promptParts.push(message);
    if (mediaUrls.length > 0) {
      promptParts.push('---');
      promptParts.push(`Médias (${mediaUrls.length}):`);
      for (const url of mediaUrls) promptParts.push(`- ${url}`);
    }

    return {
      externalKey: from,
      prompt: promptParts.join('\n'),
      mediaUrls,
      metadata: { provider: 'voipms', from, to, messageId, date },
    };
  }

  /**
   * Twilio format (snake_case ou CamelCase).
   */
  private adaptTwilio(raw: Record<string, unknown>): NormalizedWebhook {
    const from = stringOr(raw.From ?? raw.from, 'unknown');
    const to = stringOr(raw.To ?? raw.to, 'unknown');
    const body = stringOr(raw.Body ?? raw.body, '');
    const messageSid = stringOr(raw.MessageSid ?? raw.SmsSid ?? raw.messageId, '');
    const numMedia = Number(raw.NumMedia ?? 0);
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = raw[`MediaUrl${i}`];
      if (typeof url === 'string' && url) mediaUrls.push(url);
    }

    const promptParts: string[] = [];
    if (this.config.promptPrefix) promptParts.push(this.config.promptPrefix);
    promptParts.push(`[Webhook Twilio]`);
    promptParts.push(`From: ${from}`);
    promptParts.push(`To: ${to}`);
    if (messageSid) promptParts.push(`MessageSid: ${messageSid}`);
    promptParts.push('---');
    promptParts.push(body);
    if (mediaUrls.length > 0) {
      promptParts.push('---');
      promptParts.push(`Médias (${mediaUrls.length}):`);
      for (const url of mediaUrls) promptParts.push(`- ${url}`);
    }

    return {
      externalKey: from,
      prompt: promptParts.join('\n'),
      mediaUrls,
      metadata: { provider: 'twilio', from, to, messageSid, numMedia },
    };
  }

  /**
   * Telegram Bot API format.
   * Payload: { message: { chat: { id }, from: { id, username }, text, photo: [{ file_id }] } }
   */
  private adaptTelegram(raw: Record<string, unknown>): NormalizedWebhook {
    const message = (raw.message ?? raw.edited_message) as Record<string, unknown> | undefined;
    const chat = (message?.chat ?? {}) as { id?: unknown; title?: unknown };
    const from = (message?.from ?? {}) as { id?: unknown; username?: unknown; first_name?: unknown };

    const chatId = stringOr(chat.id, '');
    const userId = stringOr(from.id, '');
    const username = stringOr(from.username ?? from.first_name, 'unknown');
    const text = stringOr(message?.text, '');
    const messageId = stringOr(message?.message_id, '');

    // Photos/media: Telegram sends arrays of PhotoSize with file_id
    const mediaUrls: string[] = [];
    const photo = message?.photo as Array<{ file_id?: string }> | undefined;
    if (Array.isArray(photo) && photo.length > 0) {
      // Largest photo is last in array
      const largest = photo[photo.length - 1];
      if (largest?.file_id) mediaUrls.push(`telegram://file/${largest.file_id}`);
    }

    const promptParts: string[] = [];
    if (this.config.promptPrefix) promptParts.push(this.config.promptPrefix);
    promptParts.push(`[Telegram]`);
    promptParts.push(`From: @${username} (${userId})`);
    promptParts.push(`Chat: ${chatId}`);
    if (messageId) promptParts.push(`MessageId: ${messageId}`);
    promptParts.push('---');
    promptParts.push(text);
    if (mediaUrls.length > 0) {
      promptParts.push('---');
      promptParts.push(`Médias (${mediaUrls.length}):`);
      for (const url of mediaUrls) promptParts.push(`- ${url}`);
    }

    return {
      externalKey: `telegram:${chatId}:${userId}`,
      prompt: promptParts.join('\n'),
      mediaUrls,
      metadata: { provider: 'telegram', chatId, userId, username, messageId },
    };
  }

  /**
   * Discord-like format (channel, user, message).
   */
  private adaptDiscord(raw: Record<string, unknown>): NormalizedWebhook {
    const author = (raw.author as { id?: unknown; username?: unknown } | undefined) ?? undefined;
    const channelId = stringOr(raw.channelId ?? raw.channel_id, '');
    const userId = stringOr(raw.userId ?? raw.user_id ?? author?.id, '');
    const username = stringOr(raw.username ?? author?.username, 'unknown');
    const message = stringOr(raw.content ?? raw.message ?? raw.body, '');

    const prompt = formatDiscordContext({ channelId, userId, username, message });

    return {
      externalKey: userId || channelId,
      prompt: this.config.promptPrefix
        ? `${this.config.promptPrefix}\n${prompt}`
        : prompt,
      mediaUrls: Array.isArray(raw.attachments)
        ? (raw.attachments as Array<{ url?: string }>).map((a) => a.url).filter((u): u is string => Boolean(u))
        : [],
      metadata: { provider: 'discord', channelId, userId, username },
    };
  }

  /**
   * Generic — applique le fieldMap custom.
   */
  private adaptGeneric(raw: Record<string, unknown>): NormalizedWebhook {
    const map = this.config.fieldMap ?? {};
    const get = (key: keyof NormalizedWebhook): string => {
      const sourceKey = map[key];
      if (!sourceKey) return '';
      const v = raw[sourceKey];
      return typeof v === 'string' ? v : v != null ? JSON.stringify(v) : '';
    };

    const externalKey = get('externalKey') || 'default';
    const prompt = get('prompt') || JSON.stringify(raw);
    const mediaStr = get('mediaUrls');
    const mediaUrls = mediaStr ? mediaStr.split(',').map((s) => s.trim()).filter(Boolean) : [];

    return {
      externalKey,
      prompt: this.config.promptPrefix
        ? `${this.config.promptPrefix}\n${prompt}`
        : prompt,
      mediaUrls,
      metadata: { provider: 'generic', raw },
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function stringOr(value: unknown, defaultValue: string): string {
  if (typeof value === 'string') return value;
  if (value == null) return defaultValue;
  return String(value);
}
