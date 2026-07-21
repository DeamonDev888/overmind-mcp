/**
 * Tests unitaires — Modules Loi 25
 *
 * Teste les modules pures (sans DB) : types, anonymisation, rétention, transfer_map.
 * Les outils MCP (qui nécessitent PostgreSQL) ne sont pas testés ici.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── types.ts ─────────────────────────────────────────────────────────────────

describe('Loi25 types', () => {
  beforeEach(() => {
    delete process.env.OVERMIND_LOI25_ENABLED;
    delete process.env.OVERMIND_LOI25_RETENTION_DAYS;
    delete process.env.OVERMIND_LOI25_ARCHIVE_YEARS;
    delete process.env.OVERMIND_LOI25_DEFAULT_BASIS;
    delete process.env.OVERMIND_LOI25_INTERNAL_SUBJECTS;
  });

  it('isLoi25Enabled returns false by default', async () => {
    const { isLoi25Enabled } = await import('../lib/loi25/types.js');
    expect(isLoi25Enabled()).toBe(false);
  });

  it('isLoi25Enabled returns true when env var is "true"', async () => {
    process.env.OVERMIND_LOI25_ENABLED = 'true';
    const { isLoi25Enabled } = await import('../lib/loi25/types.js');
    expect(isLoi25Enabled()).toBe(true);
  });

  it('getDefaultRetentionDays returns 30 by default', async () => {
    const { getDefaultRetentionDays } = await import('../lib/loi25/types.js');
    expect(getDefaultRetentionDays()).toBe(30);
  });

  it('getDefaultRetentionDays reads from env', async () => {
    process.env.OVERMIND_LOI25_RETENTION_DAYS = '60';
    const { getDefaultRetentionDays } = await import('../lib/loi25/types.js');
    expect(getDefaultRetentionDays()).toBe(60);
  });

  it('getDefaultArchiveYears returns 5 by default', async () => {
    const { getDefaultArchiveYears } = await import('../lib/loi25/types.js');
    expect(getDefaultArchiveYears()).toBe(5);
  });

  it('getDefaultLegalBasis returns legitimate_interest by default', async () => {
    const { getDefaultLegalBasis } = await import('../lib/loi25/types.js');
    expect(getDefaultLegalBasis()).toBe('legitimate_interest');
  });

  it('getDefaultLegalBasis falls back on invalid value', async () => {
    process.env.OVERMIND_LOI25_DEFAULT_BASIS = 'invalid_value';
    const { getDefaultLegalBasis } = await import('../lib/loi25/types.js');
    expect(getDefaultLegalBasis()).toBe('legitimate_interest');
  });

  it('isInternalSubject checks allowlist', async () => {
    process.env.OVERMIND_LOI25_INTERNAL_SUBJECTS = 'hash1, hash2 ,hash3';
    const { isInternalSubject } = await import('../lib/loi25/types.js');
    expect(isInternalSubject('hash1')).toBe(true);
    expect(isInternalSubject('hash2')).toBe(true);
    expect(isInternalSubject('unknown')).toBe(false);
  });

  it('isInternalSubject handles empty allowlist', async () => {
    const { isInternalSubject } = await import('../lib/loi25/types.js');
    expect(isInternalSubject('any')).toBe(false);
  });
});

// ── anonymize.ts ─────────────────────────────────────────────────────────────

describe('Loi25 anonymize', () => {
  it('pseudonymize produces stable hash', async () => {
    const { pseudonymize } = await import('../lib/loi25/anonymize.js');
    const id1 = pseudonymize('user@example.com');
    const id2 = pseudonymize('user@example.com');
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(64); // SHA-256 hex
  });

  it('pseudonymize produces different hashes for different inputs', async () => {
    const { pseudonymize } = await import('../lib/loi25/anonymize.js');
    expect(pseudonymize('user1@example.com')).not.toBe(pseudonymize('user2@example.com'));
  });

  it('hashShort produces 16-char hash', async () => {
    const { hashShort } = await import('../lib/loi25/anonymize.js');
    const hash = hashShort('test-input');
    expect(hash).toHaveLength(16);
  });

  it('detectPii detects emails', async () => {
    const { detectPii } = await import('../lib/loi25/anonymize.js');
    const result = detectPii('Contactez user@example.com pour info');
    expect(result.found).toBe(true);
    expect(result.types).toContain('email');
  });

  it('detectPii detects phone numbers', async () => {
    const { detectPii } = await import('../lib/loi25/anonymize.js');
    const result = detectPii('Appelez au 514-555-1234');
    expect(result.found).toBe(true);
    expect(result.types).toContain('phone');
  });

  it('detectPii detects SIN format', async () => {
    const { detectPii } = await import('../lib/loi25/anonymize.js');
    const result = detectPii('NAS: 123 456 789');
    expect(result.found).toBe(true);
    expect(result.types).toContain('sin');
  });

  it('detectPii returns no PII for clean text', async () => {
    const { detectPii } = await import('../lib/loi25/anonymize.js');
    const result = detectPii('Analyse le code source du projet');
    expect(result.found).toBe(false);
    expect(result.types).toHaveLength(0);
  });

  it('sanitizeText replaces PII with placeholders', async () => {
    const { sanitizeText } = await import('../lib/loi25/anonymize.js');
    const sanitized = sanitizeText('Email: user@test.com, Tel: 514-555-1234');
    expect(sanitized).not.toContain('user@test.com');
    expect(sanitized).not.toContain('514-555-1234');
    expect(sanitized).toContain('ANONYMIZED');
  });

  it('generalizeTimestamp truncates to day', async () => {
    const { generalizeTimestamp } = await import('../lib/loi25/anonymize.js');
    const ts = new Date('2026-07-21T14:30:45.000Z').getTime();
    const generalized = generalizeTimestamp(ts);
    const dayMs = 24 * 60 * 60 * 1000;
    expect(generalized % dayMs).toBe(0); // midnight
  });

  it('addEmbeddingNoise returns same length vector', async () => {
    const { addEmbeddingNoise } = await import('../lib/loi25/anonymize.js');
    const embedding = [1, 2, 3, 4, 5];
    const noisy = addEmbeddingNoise(embedding, 0.1);
    expect(noisy).toHaveLength(5);
  });

  it('addEmbeddingNoise with 0 level returns identical vector', async () => {
    const { addEmbeddingNoise } = await import('../lib/loi25/anonymize.js');
    const embedding = [1, 2, 3, 4, 5];
    const noisy = addEmbeddingNoise(embedding, 0);
    expect(noisy).toEqual(embedding);
  });
});

// ── retention.ts ─────────────────────────────────────────────────────────────

describe('Loi25 retention', () => {
  beforeEach(() => {
    delete process.env.OVERMIND_LOI25_RETENTION_DAYS;
    delete process.env.OVERMIND_LOI25_ARCHIVE_YEARS;
  });

  it('calculateRetentionExpiry adds 30 days by default', async () => {
    const { calculateRetentionExpiry } = await import('../lib/loi25/retention.js');
    const now = Date.now();
    const expiry = calculateRetentionExpiry(now);
    expect(expiry - now).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('calculateRetentionExpiry respects override', async () => {
    const { calculateRetentionExpiry } = await import('../lib/loi25/retention.js');
    const now = Date.now();
    const expiry = calculateRetentionExpiry(now, 90);
    expect(expiry - now).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('calculateArchiveExpiry adds 5 years by default', async () => {
    const { calculateArchiveExpiry } = await import('../lib/loi25/retention.js');
    const now = Date.now();
    const expiry = calculateArchiveExpiry(now);
    const expected = 5 * 365 * 24 * 60 * 60 * 1000;
    expect(expiry - now).toBe(expected);
  });

  it('isExpired returns true for past timestamps', async () => {
    const { isExpired } = await import('../lib/loi25/retention.js');
    expect(isExpired(Date.now() - 1000, Date.now())).toBe(true);
    expect(isExpired(Date.now() + 1000, Date.now())).toBe(false);
  });

  it('getRetentionStage returns "active" for recent data', async () => {
    const { getRetentionStage, getDefaultPolicies } = await import('../lib/loi25/retention.js');
    const policies = getDefaultPolicies();
    const policy = policies[0];
    const now = Date.now();
    expect(getRetentionStage(now, policy, now)).toBe('active');
  });

  it('getDefaultPolicies returns 4 categories', async () => {
    const { getDefaultPolicies } = await import('../lib/loi25/retention.js');
    const policies = getDefaultPolicies();
    expect(policies).toHaveLength(4);
    expect(policies.map((p) => p.category)).toContain('agent_runs');
    expect(policies.map((p) => p.category)).toContain('knowledge_chunks');
  });
});

// ── transfer_map.ts ──────────────────────────────────────────────────────────

describe('Loi25 transfer_map', () => {
  it('getProviderInfo returns known provider', async () => {
    const { getProviderInfo } = await import('../lib/loi25/transfer_map.js');
    const info = getProviderInfo('anthropic');
    expect(info.name).toBe('anthropic');
    expect(info.region).toBe('US');
    expect(info.documented).toBe(true);
  });

  it('getProviderInfo returns unknown for unrecognized', async () => {
    const { getProviderInfo } = await import('../lib/loi25/transfer_map.js');
    const info = getProviderInfo('nonexistent-provider');
    expect(info.name).toBe('unknown');
    expect(info.region).toBe('OTHER');
  });

  it('requiresExplicitConsent returns true for CN providers', async () => {
    const { requiresExplicitConsent } = await import('../lib/loi25/transfer_map.js');
    expect(requiresExplicitConsent('zai')).toBe(true);
    expect(requiresExplicitConsent('kimi')).toBe(true);
    expect(requiresExplicitConsent('minimax-cn')).toBe(true);
  });

  it('requiresExplicitConsent returns true for US providers', async () => {
    const { requiresExplicitConsent } = await import('../lib/loi25/transfer_map.js');
    expect(requiresExplicitConsent('anthropic')).toBe(true);
    expect(requiresExplicitConsent('openai')).toBe(true);
  });

  it('listDocumentedProviders returns all known providers', async () => {
    const { listDocumentedProviders } = await import('../lib/loi25/transfer_map.js');
    const providers = listDocumentedProviders();
    expect(providers.length).toBeGreaterThan(5);
    expect(providers.some((p) => p.name === 'anthropic')).toBe(true);
  });
});
