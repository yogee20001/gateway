// ============================================================
// AI Gateway — Config Validation Tests
// ============================================================

import { maskApiKey, inferProviderPatternsFromId } from '../src/config';

describe('maskApiKey', () => {
  it('masks long keys', () => {
    expect(maskApiKey('sk-proj-abcdef123456')).toBe('sk-…56');
  });

  it('masks short keys', () => {
    expect(maskApiKey('short')).toBe('***');
  });

  it('handles empty key', () => {
    expect(maskApiKey('')).toBe('***');
  });
});

describe('inferProviderPatternsFromId', () => {
  it('returns gpt patterns for openai', () => {
    const patterns = inferProviderPatternsFromId('openai');
    expect(patterns).toContain('gpt-*');
  });

  it('returns claude patterns for anthropic', () => {
    const patterns = inferProviderPatternsFromId('anthropic');
    expect(patterns).toContain('claude-*');
  });

  it('returns catch-all for unknown provider', () => {
    const patterns = inferProviderPatternsFromId('unknown-provider');
    expect(patterns).toEqual(['*']);
  });

  it('is case insensitive', () => {
    const patterns = inferProviderPatternsFromId('OpenAI');
    expect(patterns).toContain('gpt-*');
  });
});