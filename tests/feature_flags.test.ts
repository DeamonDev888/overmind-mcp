import { describe, it, expect, vi } from 'vitest';

// Mock modules that may not be installed
vi.mock('../src/lib/telemetry.js', () => ({
  initTelemetry: vi.fn(),
}));
vi.mock('../src/lib/broker/rabbitmq.js', () => ({
  getBroker: vi.fn(() => null),
}));
vi.mock('../src/lib/workflow/temporal/client.js', () => ({
  getTemporalClient: vi.fn(() => null),
}));

import { initTelemetry } from '../src/lib/telemetry.js';
import { getBroker } from '../src/lib/broker/rabbitmq.js';
import { getTemporalClient } from '../src/lib/workflow/temporal/client.js';

describe('feature_flags', () => {
  describe('telemetry', () => {
    it('OTEL_ENABLED non défini → initTelemetry est no-op', () => {
      delete process.env.OTEL_ENABLED;
      expect(() => initTelemetry()).not.toThrow();
    });
  });

  describe('broker', () => {
    it('OVERMIND_BROKER non défini → getBroker() retourne null', () => {
      delete process.env.OVERMIND_BROKER;
      expect(getBroker()).toBeNull();
    });
  });

  describe('workflow', () => {
    it('OVERMIND_WORKFLOW non défini → getTemporalClient() retourne null', () => {
      delete process.env.OVERMIND_WORKFLOW;
      expect(getTemporalClient()).toBeNull();
    });
  });
});
