// ============================================================
// AI Gateway — Router Tests
// ============================================================

import { matchModelPattern, calculateSpecificity, findProvidersForModel } from '../src/router';
import type { AppConfig, Provider } from '../src/types';

describe('matchModelPattern', () => {
  it('exact match returns true', () => {
    expect(matchModelPattern('gpt-4o', 'gpt-4o')).toBe(true);
  });

  it('prefix glob matches', () => {
    expect(matchModelPattern('gpt-4o', 'gpt-*')).toBe(true);
    expect(matchModelPattern('gpt-4-turbo', 'gpt-*')).toBe(true);
    expect(matchModelPattern('o1-preview', 'o1-*')).toBe(true);
  });

  it('prefix glob does not match wrong prefix', () => {
    expect(matchModelPattern('claude-3', 'gpt-*')).toBe(false);
  });

  it('suffix glob matches', () => {
    expect(matchModelPattern('model-v2', '*-v2')).toBe(true);
    expect(matchModelPattern('test-v2', '*-v2')).toBe(true);
  });

  it('wildcard in middle matches', () => {
    expect(matchModelPattern('nvidia/llama-3.1', 'nvidia/*')).toBe(true);
    expect(matchModelPattern('meta/llama', 'meta/*')).toBe(true);
    expect(matchModelPattern('mistralai/mistral-7b', 'mistralai/*')).toBe(true);
  });

  it('wildcard in middle does not match wrong prefix', () => {
    expect(matchModelPattern('openai/gpt-4o', 'nvidia/*')).toBe(false);
  });

  it('catch-all matches everything', () => {
    expect(matchModelPattern('anything-here', '*')).toBe(true);
    expect(matchModelPattern('gpt-4o', '*')).toBe(true);
  });

  it('is case insensitive', () => {
    expect(matchModelPattern('GPT-4o', 'gpt-*')).toBe(true);
    expect(matchModelPattern('gpt-4o', 'GPT-*')).toBe(true);
  });

  it('complex wildcard pattern', () => {
    expect(matchModelPattern('llama-3.1-sonar-large', 'llama-*-sonar*')).toBe(true);
    expect(matchModelPattern('llama-sonar', 'llama-*-sonar*')).toBe(false);
  });
});

describe('calculateSpecificity', () => {
  it('exact match has highest specificity', () => {
    expect(calculateSpecificity('gpt-4o')).toBe(100);
  });

  it('prefix glob has medium specificity', () => {
    expect(calculateSpecificity('gpt-*')).toBe(4);
  });

  it('catch-all has lowest specificity', () => {
    expect(calculateSpecificity('*')).toBe(0);
  });
});

describe('findProvidersForModel', () => {
  const createTestConfig = (providers: Provider[]): AppConfig => ({
    providers,
  });

  it('finds matching provider', () => {
    const config = createTestConfig([
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeys: ['sk-test'],
        isActive: true,
        modelPatterns: ['gpt-*', 'o1-*'],
      },
    ]);

    const matches = findProvidersForModel('gpt-4o', config);
    expect(matches).toHaveLength(1);
    expect(matches[0].provider.id).toBe('openai');
  });

  it('returns empty array for unknown model', () => {
    const config = createTestConfig([
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeys: ['sk-test'],
        isActive: true,
        modelPatterns: ['gpt-*'],
      },
    ]);

    const matches = findProvidersForModel('claude-3', config);
    expect(matches).toHaveLength(0);
  });

  it('skips inactive providers', () => {
    const config = createTestConfig([
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeys: ['sk-test'],
        isActive: false,
        modelPatterns: ['gpt-*'],
      },
    ]);

    const matches = findProvidersForModel('gpt-4o', config);
    expect(matches).toHaveLength(0);
  });

  it('sorts by specificity descending', () => {
    const config = createTestConfig([
      {
        id: 'provider1',
        name: 'Provider 1',
        baseUrl: 'https://api1.com',
        apiKeys: ['key1'],
        isActive: true,
        modelPatterns: ['gpt-*'],
      },
      {
        id: 'provider2',
        name: 'Provider 2',
        baseUrl: 'https://api2.com',
        apiKeys: ['key2'],
        isActive: true,
        modelPatterns: ['gpt-4o'],
      },
    ]);

    const matches = findProvidersForModel('gpt-4o', config);
    expect(matches).toHaveLength(2);
    expect(matches[0].provider.id).toBe('provider2');
    expect(matches[1].provider.id).toBe('provider1');
  });

  it('uses inferred patterns when modelPatterns is empty', () => {
    const config = createTestConfig([
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeys: ['sk-test'],
        isActive: true,
        modelPatterns: [],
      },
    ]);

    const matches = findProvidersForModel('gpt-4o', config);
    expect(matches).toHaveLength(1);
    expect(matches[0].provider.id).toBe('openai');
  });

  it('uses inferred patterns when modelPatterns is null', () => {
    const config = createTestConfig([
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeys: ['sk-test'],
        isActive: true,
        modelPatterns: null,
      },
    ]);

    const matches = findProvidersForModel('gpt-4o', config);
    expect(matches).toHaveLength(1);
  });

});