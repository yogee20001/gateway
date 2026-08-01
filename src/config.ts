// ============================================================
// AI Gateway — Configuration Loader & Validation
// ============================================================

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AppConfig, Provider, ValidationResult } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// Default Provider Templates
// ============================================================
export const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeys: [],
    keyStrategy: 'round-robin',
    modelPatterns: ['gpt-*', 'o1-*', 'o3-*', 'davinci-*', 'text-*'],
    isActive: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeys: [],
    keyStrategy: 'round-robin',
    modelPatterns: ['claude-*'],
    isActive: true,
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeys: [],
    keyStrategy: 'round-robin',
    modelPatterns: ['gemini-*', 'palm-*'],
    isActive: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeys: [],
    keyStrategy: 'round-robin',
    modelPatterns: ['deepseek-*'],
    isActive: true,
  },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKeys: [],
    keyStrategy: 'round-robin',
    modelPatterns: ['nvidia/*', 'meta/*', 'mistralai/*'],
    isActive: true,
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    apiKeys: [],
    keyStrategy: 'round-robin',
    modelPatterns: ['sonar-*', 'llama-*-sonar*'],
    isActive: true,
  },
];

// ============================================================
// Default Config
// ============================================================
export function createDefaultConfig(): AppConfig {
  return {
    port: 8787,
    host: '0.0.0.0',
    logLevel: 'info',
    maxLogEntries: 1000,
    defaultMaxRetries: 1,
    defaultCooldownMs: 60000,
    healthCheckIntervalMs: 60000,
    maxConcurrentRequests: 50,
    maxQueuedRequests: 100,
    queueTimeoutMs: 30000,
    maxBodyBytes: 10485760,
    hedging: { enabled: false },
    providers: DEFAULT_PROVIDERS.map(p => ({ ...p, apiKeys: [...(p.apiKeys || [])], rateLimit: null })),
  };
}

// ============================================================
// Config Loading
// ============================================================
export function loadConfig(filePath?: string): AppConfig | null {
  const path = filePath || join(process.cwd(), 'config.json');

  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    const config = JSON.parse(raw) as AppConfig;
    return config;
  } catch (err) {
    console.error('❌ Failed to parse config.json:', (err as Error).message);
    return null;
  }
}

// ============================================================
// Config Saving
// ============================================================
export function saveConfig(config: AppConfig, filePath?: string): void {
  const path = filePath || join(process.cwd(), 'config.json');

  // Mask keys for display in saved config? No — save actual keys.
  // Masking is only for API responses.
  try {
    writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('❌ Failed to save config.json:', (err as Error).message);
  }
}

// ============================================================
// Config Validation
// ============================================================
export function validateConfig(config: AppConfig): ValidationResult {
  const errors: string[] = [];

  if (!config.providers || !Array.isArray(config.providers)) {
    errors.push('config.providers must be an array');
    return { valid: false, errors };
  }

  const seenIds = new Set<string>();

  // Validate optional performance fields (positive numbers when present)
  const perfFields: Array<[string, unknown]> = [
    ['maxConcurrentRequests', config.maxConcurrentRequests],
    ['maxQueuedRequests', config.maxQueuedRequests],
    ['queueTimeoutMs', config.queueTimeoutMs],
    ['maxBodyBytes', config.maxBodyBytes],
    ['healthCheckIntervalMs', config.healthCheckIntervalMs],
    ['defaultMaxRetries', config.defaultMaxRetries],
    ['defaultCooldownMs', config.defaultCooldownMs],
  ];
  for (const [field, value] of perfFields) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
      errors.push(`config.${field} must be a positive number`);
    }
  }

  for (let i = 0; i < config.providers.length; i++) {
    const p = config.providers[i];
    const prefix = `providers[${i}]`;

    if (!p.id || typeof p.id !== 'string') {
      errors.push(`${prefix}.id is required`);
    } else if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(p.id)) {
      errors.push(`${prefix}.id "${p.id}" must be alphanumeric with optional hyphens`);
    } else if (seenIds.has(p.id)) {
      errors.push(`${prefix}.id "${p.id}" is not unique`);
    }
    seenIds.add(p.id);

    if (!p.name || typeof p.name !== 'string') {
      errors.push(`${prefix}.name is required`);
    }

    if (!p.baseUrl || typeof p.baseUrl !== 'string') {
      errors.push(`${prefix}.baseUrl is required`);
    } else if (!p.baseUrl.startsWith('http://') && !p.baseUrl.startsWith('https://')) {
      errors.push(`${prefix}.baseUrl must be a valid HTTP/HTTPS URL`);
    }

    // Warn about missing keys but don't fail validation — users can add keys via dashboard
    const hasApiKey = p.apiKey && typeof p.apiKey === 'string' && p.apiKey.length > 0;
    const hasApiKeys = p.apiKeys && Array.isArray(p.apiKeys) && p.apiKeys.length > 0;
    if (!hasApiKey && !hasApiKeys) {
      console.warn(`⚠ ${prefix} has no API keys configured (add them via the dashboard)`);
    }

    if (p.keyStrategy && !['round-robin', 'least-used', 'random'].includes(p.keyStrategy)) {
      errors.push(`${prefix}.keyStrategy must be one of: round-robin, least-used, random`);
    }

    if (p.keyWeights && p.apiKeys && p.keyWeights.length !== p.apiKeys.length) {
      errors.push(`${prefix}.keyWeights length must match apiKeys length`);
    }

    if (p.rateLimit) {
      if (typeof p.rateLimit.requestsPerWindow !== 'number' || p.rateLimit.requestsPerWindow <= 0) {
        errors.push(`${prefix}.rateLimit.requestsPerWindow must be a positive number`);
      }
      if (typeof p.rateLimit.windowMs !== 'number' || p.rateLimit.windowMs <= 0) {
        errors.push(`${prefix}.rateLimit.windowMs must be a positive number (milliseconds)`);
      }
    }

  }

  return { valid: errors.length === 0, errors };
}

// ============================================================
// Key Masking
// ============================================================
export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '***';
  return key.substring(0, 3) + '…' + key.substring(key.length - 4);
}

// ============================================================
// Pattern Inference Fallback
// ============================================================
export function inferProviderPatternsFromId(providerId: string): string[] {
  const map: Record<string, string[]> = {
    openai: ['gpt-*', 'o1-*', 'o3-*', 'davinci-*', 'text-*'],
    anthropic: ['claude-*'],
    google: ['gemini-*', 'palm-*'],
    deepseek: ['deepseek-*'],
    nvidia: ['nvidia/*', 'meta/*', 'mistralai/*'],
    perplexity: ['sonar-*', 'llama-*-sonar*'],
  };

  return map[providerId.toLowerCase()] || ['*'];
}

// ============================================================
// Get all keys for a provider (normalizes apiKey + apiKeys)
// ============================================================
export function getProviderKeys(provider: Provider): string[] {
  const keys: string[] = [];
  if (provider.apiKey && typeof provider.apiKey === 'string' && provider.apiKey.length > 0) {
    keys.push(provider.apiKey);
  }
  if (provider.apiKeys && Array.isArray(provider.apiKeys)) {
    keys.push(...provider.apiKeys.filter(k => typeof k === 'string' && k.length > 0));
  }
  return keys;
}