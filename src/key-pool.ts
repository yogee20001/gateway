// ============================================================
// AI Gateway — Key Pool & Health Monitoring
// ============================================================

import type { AppConfig, Provider, KeyState, KeyHealth, HealthResponse, ProviderHealth, KeyHealthEntry, HealthSummary } from './types';
import { getProviderKeys, maskApiKey } from './config';
import { createHash } from 'crypto';

// ============================================================
// Module-Level State
// ============================================================
const keyStates: Map<string, Map<string, KeyState>> = new Map();
const roundRobinIndices: Map<string, number> = new Map();
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

// ============================================================
// Key Hashing
// ============================================================
export function getKeyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex').substring(0, 16);
}

// ============================================================
// Initialization
// ============================================================
export function initializeKeyStates(config: AppConfig): void {
  keyStates.clear();
  roundRobinIndices.clear();

  for (const provider of config.providers) {
    const providerMap = new Map<string, KeyState>();
    const keys = getProviderKeys(provider);

    for (const key of keys) {
      const keyHash = getKeyHash(key);
      providerMap.set(keyHash, {
        key,
        keyHash,
        health: 'healthy',
        lastUsed: 0,
        usageCount: 0,
        errorCount: 0,
        cooldownUntil: null,
        lastError: null,
        lastErrorTime: null,
        consecutiveErrors: 0,
      });
    }

    keyStates.set(provider.id, providerMap);
    roundRobinIndices.set(provider.id, -1);
  }
}

// ============================================================
// Key Selection
// ============================================================
export function selectBestApiKey(provider: Provider): { key: string; index: number } | null {
  const providerMap = keyStates.get(provider.id);
  if (!providerMap || providerMap.size === 0) return null;

  const keys = getProviderKeys(provider);
  const healthyKeys: Array<{ key: string; index: number; state: KeyState }> = [];

  for (let i = 0; i < keys.length; i++) {
    const keyHash = getKeyHash(keys[i]);
    const state = providerMap.get(keyHash);
    if (!state) continue;

    if (state.health === 'healthy') {
      healthyKeys.push({ key: keys[i], index: i, state });
    }
  }

  if (healthyKeys.length === 0) return null;

  const strategy = provider.keyStrategy || 'round-robin';
  let selected: { key: string; index: number; state: KeyState } = healthyKeys[0];

  switch (strategy) {
    case 'round-robin': {
      let lastIdx = roundRobinIndices.get(provider.id) ?? -1;
      // Find the next healthy key after lastIdx
      const sorted = healthyKeys.sort((a, b) => a.index - b.index);
      const next = sorted.find(k => k.index > lastIdx) || sorted[0];
      selected = next;
      roundRobinIndices.set(provider.id, next.index);
      break;
    }
    case 'least-used': {
      selected = healthyKeys.reduce((a, b) =>
        a.state.usageCount <= b.state.usageCount ? a : b
      );
      break;
    }
    case 'random': {
      if (provider.keyWeights && provider.keyWeights.length > 0) {
        // Weighted random
        const weights = healthyKeys.map(k => provider.keyWeights![k.index] || 1);
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let random = Math.random() * totalWeight;
        for (let i = 0; i < healthyKeys.length; i++) {
          random -= weights[i];
          if (random <= 0) {
            selected = healthyKeys[i];
            break;
          }
        }
        selected = selected || healthyKeys[0];
      } else {
        selected = healthyKeys[Math.floor(Math.random() * healthyKeys.length)];
      }
      break;
    }
    default:
      selected = healthyKeys[0];
  }

  // Update state
  selected.state.lastUsed = Date.now();
  selected.state.usageCount++;

  return { key: selected.key, index: selected.index };
}

// ============================================================
// Health Management
// ============================================================
export function markKeyRateLimited(providerId: string, keyIndex: number, cooldownMs: number): void {
  const providerMap = keyStates.get(providerId);
  if (!providerMap) return;

  const provider = findProviderById(providerId);
  if (!provider) return;

  const keys = getProviderKeys(provider);
  if (keyIndex < 0 || keyIndex >= keys.length) return;

  const keyHash = getKeyHash(keys[keyIndex]);
  const state = providerMap.get(keyHash);
  if (!state) return;

  state.health = 'rate-limited';
  state.errorCount++;
  state.consecutiveErrors++;
  state.lastError = 'Rate limited (429)';
  state.lastErrorTime = Date.now();
  state.cooldownUntil = Date.now() + (cooldownMs * state.consecutiveErrors);
}

export function markKeyError(providerId: string, keyIndex: number, errorMessage: string): void {
  const providerMap = keyStates.get(providerId);
  if (!providerMap) return;

  const provider = findProviderById(providerId);
  if (!provider) return;

  const keys = getProviderKeys(provider);
  if (keyIndex < 0 || keyIndex >= keys.length) return;

  const keyHash = getKeyHash(keys[keyIndex]);
  const state = providerMap.get(keyHash);
  if (!state) return;

  state.health = 'error';
  state.errorCount++;
  state.consecutiveErrors++;
  state.lastError = errorMessage;
  state.lastErrorTime = Date.now();
  state.cooldownUntil = Date.now() + (60_000 * state.consecutiveErrors);
}

export function markKeySuccess(providerId: string, keyIndex: number): void {
  const providerMap = keyStates.get(providerId);
  if (!providerMap) return;

  const provider = findProviderById(providerId);
  if (!provider) return;

  const keys = getProviderKeys(provider);
  if (keyIndex < 0 || keyIndex >= keys.length) return;

  const keyHash = getKeyHash(keys[keyIndex]);
  const state = providerMap.get(keyHash);
  if (!state) return;

  state.consecutiveErrors = 0;
  // Don't change health here — let the health check timer restore keys
}

export function checkAndRestoreKeys(): void {
  const now = Date.now();

  for (const [providerId, providerMap] of keyStates.entries()) {
    for (const [keyHash, state] of providerMap.entries()) {
      if (state.health !== 'healthy' && state.cooldownUntil !== null && now >= state.cooldownUntil) {
        const oldHealth = state.health;
        state.health = 'healthy';
        state.cooldownUntil = null;
        state.consecutiveErrors = 0;
        console.log(`[health] Key ${maskApiKey(state.key)} restored: ${oldHealth} → healthy`);
      }
    }
  }
}

// ============================================================
// Health Summary
// ============================================================
export function getKeyHealthSummary(): HealthResponse {
  const providers: Record<string, ProviderHealth> = {};
  let totalKeys = 0;
  let healthyKeys = 0;
  let rateLimitedKeys = 0;
  let errorKeys = 0;
  let totalProviders = 0;
  let activeProviders = 0;

  for (const [providerId, providerMap] of keyStates.entries()) {
    totalProviders++;
    const keys: KeyHealthEntry[] = [];
    let idx = 0;

    for (const [, state] of providerMap.entries()) {
      totalKeys++;
      if (state.health === 'healthy') healthyKeys++;
      else if (state.health === 'rate-limited') rateLimitedKeys++;
      else if (state.health === 'error') errorKeys++;

      keys.push({
        index: idx++,
        masked: maskApiKey(state.key),
        health: state.health,
        usageCount: state.usageCount,
        errorCount: state.errorCount,
        cooldownRemaining: state.cooldownUntil ? Math.max(0, state.cooldownUntil - Date.now()) : null,
      });
    }

    const provider = findProviderById(providerId);
    if (provider?.isActive) activeProviders++;

    providers[providerId] = {
      name: provider?.name || providerId,
      isActive: provider?.isActive ?? true,
      keys,
      healthyKeyCount: keys.filter(k => k.health === 'healthy').length,
      totalKeyCount: keys.length,
    };
  }

  return {
    providers,
    summary: {
      totalProviders,
      activeProviders,
      totalKeys,
      healthyKeys,
      rateLimitedKeys,
      errorKeys,
    },
  };
}

// ============================================================
// Timer Management
// ============================================================
export function startHealthCheckTimer(intervalMs: number = 5000): void {
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  healthCheckTimer = setInterval(checkAndRestoreKeys, intervalMs);
}

export function stopHealthCheckTimer(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

// ============================================================
// Helpers
// ============================================================
let _providers: Provider[] = [];

export function setProviders(providers: Provider[]): void {
  _providers = providers;
}

function findProviderById(id: string): Provider | undefined {
  return _providers.find(p => p.id === id);
}