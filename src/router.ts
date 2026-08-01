// ============================================================
// AI Gateway — Pattern Routing Engine
// ============================================================

import type { AppConfig, Provider, ProviderMatch } from './types';
import { inferProviderPatternsFromId } from './config';

// ============================================================
// Model-to-Provider Cache
// ============================================================
const modelProviderCache: Map<string, ProviderMatch[]> = new Map();
// The cache is only valid while the config object identity is unchanged.
// Config is replaced wholesale on load and on dashboard save, so any
// new object (new identity) invalidates the cache automatically.
let cachedConfigRef: AppConfig | null = null;

// ============================================================
// Pattern Matching
// ============================================================
export function matchModelPattern(modelName: string, pattern: string): boolean {
  const model = modelName.toLowerCase();
  const pat = pattern.toLowerCase();

  // Catch-all
  if (pat === '*') return true;

  // Count wildcards
  const starCount = (pat.match(/\*/g) || []).length;

  // Prefix glob: "gpt-*" matches anything starting with "gpt-" (single trailing *)
  if (starCount === 1 && pat.endsWith('*') && !pat.startsWith('*')) {
    const prefix = pat.slice(0, -1);
    return model.startsWith(prefix);
  }

  // Suffix glob: "*-v2" matches anything ending with "-v2" (single leading *)
  if (starCount === 1 && pat.startsWith('*') && !pat.endsWith('*')) {
    const suffix = pat.slice(1);
    return model.endsWith(suffix);
  }

  // Wildcard in middle: "nvidia/*" or "llama-*-sonar*" (multiple or middle *)
  if (starCount > 0) {
    const regexStr = '^' + pat
      .split('*')
      .map(escapeRegex)
      .join('.*') + '$';
    return new RegExp(regexStr, 'i').test(modelName);
  }

  // Exact match
  return model === pat;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function calculateSpecificity(pattern: string): number {
  if (pattern === '*') return 0;
  if (!pattern.includes('*')) return 100; // exact match
  // Prefix glob: "gpt-*" → length - 1
  // Suffix glob: "*-v2" → length - 1
  // Wildcard: "nvidia/*" → length - 2
  const starCount = (pattern.match(/\*/g) || []).length;
  return pattern.length - starCount;
}

export function findProvidersForModel(requestedModel: string, config: AppConfig): ProviderMatch[] {
  // Config replaced since last lookup? Drop the whole cache (identity check).
  if (config !== cachedConfigRef) {
    modelProviderCache.clear();
    cachedConfigRef = config;
  }
  const cached = modelProviderCache.get(requestedModel);
  if (cached) return cached;

  const matches: ProviderMatch[] = [];

  for (const provider of config.providers) {
    if (!provider.isActive) continue;

    const patterns = provider.modelPatterns && provider.modelPatterns.length > 0
      ? provider.modelPatterns
      : inferProviderPatternsFromId(provider.id);

    for (const pattern of patterns) {
      if (matchModelPattern(requestedModel, pattern)) {
        matches.push({
          provider,
          specificity: calculateSpecificity(pattern),
          pattern,
        });
        break; // Only one pattern per provider
      }
    }
  }

// Sort by specificity descending (most specific first)
matches.sort((a, b) => b.specificity - a.specificity);
modelProviderCache.set(requestedModel, matches);
return matches;
}

export function invalidateModelCache(): void {
  modelProviderCache.clear();
}