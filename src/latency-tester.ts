// ============================================================
// AI Gateway — Professional Latency Testing Framework
// ============================================================

import type { ChatCompletionRequest, Provider, AppConfig } from './types';
import { findProvidersForModel } from './router';
import { forwardWithRetry } from './forwarder';
import { initializeKeyStates, getKeyHealthSummary } from './key-pool';
import { initializeRateLimiters } from './rate-limiter';
import { loadConfig, createDefaultConfig, saveConfig } from './config';

export interface LatencyTestConfig {
  model: string;
  providerId?: string;
  messageCount?: number;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  iterations?: number;
  concurrency?: number;
  warmupIterations?: number;
}

export interface LatencyMetrics {
  dnsLookup: number[];
  tcpConnect: number[];
  tlsHandshake: number[];
  ttfb: number[];
  totalLatency: number[];
  download: number[];
  firstTokenLatency: number[];
  interTokenLatency: number[];
  tokensPerSecond: number[];
  gatewayOverhead: number[];
  routingLatency: number[];
  keySelectionLatency: number[];
  rateLimiterLatency: number[];
  retryCount: number[];
  retryLatency: number[];
  errors: number;
  timeouts: number;
  rateLimited: number;
  summary: LatencySummary;
}

export interface LatencySummary {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  ttfbP50: number;
  ttfbP90: number;
  ttfbP99: number;
  firstTokenP50: number;
  firstTokenP90: number;
  firstTokenP99: number;
  requestsPerSecond: number;
  tokensPerSecond: number;
  successRate: number;
  errorRate: number;
  timeoutRate: number;
  rateLimitRate: number;
  avgGatewayOverhead: number;
  avgRoutingLatency: number;
  avgKeySelectionLatency: number;
  avgRateLimiterLatency: number;
}

export interface DetailedLatencyBreakdown {
  requestId: string;
  timestamp: number;
  model: string;
  provider: string;
  stream: boolean;
  gatewayStart: number;
  routingEnd: number;
  keySelectionEnd: number;
  rateLimiterEnd: number;
  upstreamRequestStart: number;
  dnsLookupEnd: number;
  tcpConnectEnd: number;
  tlsHandshakeEnd: number;
  ttfbEnd: number;
  downloadEnd: number;
  gatewayEnd: number;
  gatewayOverhead: number;
  routingLatency: number;
  keySelectionLatency: number;
  rateLimiterLatency: number;
  networkLatency: number;
  upstreamLatency: number;
  totalLatency: number;
  firstTokenLatency?: number;
  interTokenLatencies?: number[];
  tokensGenerated?: number;
  tokensPerSecond?: number;
  retryCount: number;
  retryLatencies: number[];
  status: number;
  success: boolean;
  error?: string;
}

interface DetailedNetworkTiming {
  upstreamRequestStart: number;
  rateLimiterWaitMs: number;
  dnsLookupEnd?: number;
  tcpConnectEnd?: number;
  tlsHandshakeEnd?: number;
  ttfbEnd?: number;
  downloadEnd?: number;
  firstTokenLatency?: number;
  interTokenLatencies: number[];
  tokensGenerated: number;
}

class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];
  
  constructor(permits: number) {
    this.permits = permits;
  }
  
  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.waitQueue.push(() => resolve(() => this.release()));
    });
  }
  
  private release(): void {
    this.permits++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      this.permits--;
      next();
    }
  }
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length);
}

export class LatencyTester {
  private config: AppConfig;
  private results: DetailedLatencyBreakdown[] = [];
  
  constructor(config?: AppConfig) {
    this.config = config || loadConfig() || createDefaultConfig();
    initializeKeyStates(this.config);
    initializeRateLimiters(this.config.providers);
    saveConfig(this.config);
  }
  
  async runTest(testConfig: LatencyTestConfig): Promise<LatencyMetrics> {
    const {
      model,
      providerId,
      messageCount = 5,
      maxTokens = 500,
      temperature = 0.7,
      stream = false,
      iterations = 10,
      concurrency = 1,
      warmupIterations = 2,
    } = testConfig;
    
    console.log(`\n🚀 Starting Latency Test`);
    console.log(`   Model: ${model}`);
    console.log(`   Provider: ${providerId || 'auto'}`);
    console.log(`   Iterations: ${iterations} (${warmupIterations} warmup)`);
    console.log(`   Concurrency: ${concurrency}`);
    console.log(`   Streaming: ${stream}`);
    console.log(`   Messages: ${messageCount}, Max Tokens: ${maxTokens}\n`);
    
    if (warmupIterations > 0) {
      console.log(`🔥 Running ${warmupIterations} warmup iterations...`);
      for (let i = 0; i < warmupIterations; i++) {
        await this.runSingleRequest(model, providerId, messageCount, maxTokens, temperature, stream, `warmup-${i}`);
      }
      console.log(`✅ Warmup complete\n`);
    }
    
    this.results = [];
    const startTime = Date.now();
    
    if (concurrency === 1) {
      for (let i = 0; i < iterations; i++) {
        const result = await this.runSingleRequest(
          model, providerId, messageCount, maxTokens, temperature, stream, `test-${i}`
        );
        this.results.push(result);
        this.printProgress(i + 1, iterations, result);
      }
    } else {
      await this.runConcurrentRequests(
        model, providerId, messageCount, maxTokens, temperature, stream, iterations, concurrency
      );
    }
    
    const totalTime = Date.now() - startTime;
    const metrics = this.calculateMetrics(totalTime);
    
    this.printResults(metrics);
    return metrics;
  }
  
  private async runSingleRequest(
    model: string,
    providerId: string | undefined,
    messageCount: number,
    maxTokens: number,
    temperature: number,
    stream: boolean,
    requestId: string
  ): Promise<DetailedLatencyBreakdown> {
    const gatewayStart = Date.now();
    
    const messages = this.generateMessages(messageCount);
    
    const body: ChatCompletionRequest = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream,
    };
    
    let routingEnd = 0;
    let keySelectionEnd = 0;
    let rateLimiterEnd = 0;
    let upstreamRequestStart = 0;
    let dnsLookupEnd = 0;
    let tcpConnectEnd = 0;
    let tlsHandshakeEnd = 0;
    let ttfbEnd = 0;
    let downloadEnd = 0;
    let gatewayEnd = 0;
    
    let retryCount = 0;
    const retryLatencies: number[] = [];
    let firstTokenLatency: number | undefined;
    const interTokenLatencies: number[] = [];
    let tokensGenerated = 0;
    let success = false;
    let error: string | undefined;
    let status = 0;
    let provider = 'unknown';
    
    try {
      const routingStart = Date.now();
      const matches = findProvidersForModel(model, this.config);
      routingEnd = Date.now();
      
      if (matches.length === 0) {
        throw new Error(`No provider found for model: ${model}`);
      }
      
      let selectedMatch = matches[0];
      if (providerId) {
        const found = matches.find(m => m.provider.id === providerId);
        if (found) selectedMatch = found;
      }
      provider = selectedMatch.provider.id;
      
      const keySelectionStart = Date.now();
      keySelectionEnd = Date.now();
      
      const rateLimiterStart = Date.now();
      
      const result = await this.executeWithTiming(selectedMatch.provider, body, stream);
      
      rateLimiterEnd = Date.now();
      status = result.status;
      success = status >= 200 && status < 300;
      error = success ? undefined : result.body?.error?.message || `HTTP ${status}`;
      
      if (result.timing) {
        dnsLookupEnd = result.timing.dnsLookupEnd || 0;
        tcpConnectEnd = result.timing.tcpConnectEnd || 0;
        tlsHandshakeEnd = result.timing.tlsHandshakeEnd || 0;
        ttfbEnd = result.timing.ttfbEnd || 0;
        downloadEnd = result.timing.downloadEnd || 0;
        upstreamRequestStart = result.timing.upstreamRequestStart || 0;
        firstTokenLatency = result.timing.firstTokenLatency;
        interTokenLatencies.push(...(result.timing.interTokenLatencies || []));
        tokensGenerated = result.timing.tokensGenerated || 0;
      }
      
      gatewayEnd = Date.now();
      
      if (result.retries !== undefined) {
        retryCount = result.retries;
        retryLatencies.push(...(result.retryLatencies || []));
      }
      
    } catch (err: any) {
      gatewayEnd = Date.now();
      success = false;
      error = err.message;
      status = 500;
    }
    
    const totalLatency = gatewayEnd - gatewayStart;
    const routingLatency = routingEnd - gatewayStart;
    const keySelectionLatency = keySelectionEnd - routingEnd;
    const rateLimiterLatency = rateLimiterEnd - keySelectionEnd;
    const upstreamLatency = ttfbEnd - upstreamRequestStart;
    const networkLatency = upstreamLatency;
    const gatewayOverhead = totalLatency - upstreamLatency;
    
    return {
      requestId,
      timestamp: gatewayStart,
      model,
      provider,
      stream,
      gatewayStart,
      routingEnd,
      keySelectionEnd,
      rateLimiterEnd,
      upstreamRequestStart,
      dnsLookupEnd,
      tcpConnectEnd,
      tlsHandshakeEnd,
      ttfbEnd,
      downloadEnd,
      gatewayEnd,
      gatewayOverhead,
      routingLatency,
      keySelectionLatency,
      rateLimiterLatency,
      networkLatency,
      upstreamLatency,
      totalLatency,
      firstTokenLatency,
      interTokenLatencies: interTokenLatencies.length > 0 ? interTokenLatencies : undefined,
      tokensGenerated,
      tokensPerSecond: tokensGenerated > 0 && firstTokenLatency ? (tokensGenerated / (totalLatency / 1000)) : undefined,
      retryCount,
      retryLatencies,
      status,
      success,
      error,
    };
  }
  
  private async executeWithTiming(
    provider: Provider,
    body: ChatCompletionRequest,
    stream: boolean
  ): Promise<{
    status: number;
    body: any;
    timing?: DetailedNetworkTiming;
    retries?: number;
    retryLatencies?: number[];
  }> {
    const { forwardWithRetry } = await import('./forwarder');
    const { selectBestApiKey, getKeyHash } = await import('./key-pool');
    const { providerRateLimiter } = await import('./rate-limiter');
    
    const keyResult = selectBestApiKey(provider);
    if (!keyResult) {
      return { status: 503, body: { error: { message: 'No healthy keys' } } };
    }
    
    const keyHash = getKeyHash(keyResult.key);
    
    const rateLimiterStart = Date.now();
    await providerRateLimiter.waitForSlot(provider.id, keyHash);
    const rateLimiterEnd = Date.now();
    
    const requestStart = Date.now();
    
    const timing: DetailedNetworkTiming = {
      upstreamRequestStart: requestStart,
      rateLimiterWaitMs: rateLimiterEnd - rateLimiterStart,
      interTokenLatencies: [],
      tokensGenerated: 0,
    };
    
    try {
      // Use the actual forwarder with retry logic
      const result = await forwardWithRetry(provider, body, this.config);
      
      timing.ttfbEnd = Date.now();
      timing.downloadEnd = Date.now();
      
      // For streaming, measure first token and inter-token latency
      if (stream && result.streamResponse) {
        const reader = result.streamResponse.body!.getReader();
        let firstToken = true;
        let tokenCount = 0;
        let lastTokenTime = Date.now();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const now = Date.now();
          if (firstToken) {
            timing.firstTokenLatency = now - requestStart;
            firstToken = false;
            lastTokenTime = now;
          } else {
            timing.interTokenLatencies.push(now - lastTokenTime);
            lastTokenTime = now;
          }
          
          const text = new TextDecoder().decode(value);
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.choices?.[0]?.delta?.content) tokenCount++;
              } catch {}
            }
          }
        }
        timing.tokensGenerated = tokenCount;
        timing.downloadEnd = Date.now();
      }
      
      return {
        status: result.status,
        body: result.body,
        timing,
        retries: result.retries,
        retryLatencies: [], // Could be enhanced to track individual retry latencies
      };
      
    } catch (err: any) {
      timing.downloadEnd = Date.now();
      return {
        status: err.name === 'TimeoutError' ? 504 : 500,
        body: { error: { message: err.message } },
        timing,
        retries: 0,
        retryLatencies: [],
      };
    }
  }
  
  private async runConcurrentRequests(
    model: string,
    providerId: string | undefined,
    messageCount: number,
    maxTokens: number,
    temperature: number,
    stream: boolean,
    iterations: number,
    concurrency: number
  ): Promise<void> {
    const semaphore = new Semaphore(concurrency);
    const promises: Promise<void>[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const requestId = `test-${i}`;
      promises.push(
        semaphore.acquire().then(async (release) => {
          try {
            const result = await this.runSingleRequest(
              model, providerId, messageCount, maxTokens, temperature, stream, requestId
            );
            this.results.push(result);
            this.printProgress(this.results.length, iterations, result);
          } finally {
            release();
          }
        })
      );
    }
    
    await Promise.all(promises);
  }
  
  private generateMessages(count: number): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    for (let i = 0; i < count; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `This is test message ${i + 1}. Please respond briefly.`
      });
    }
    return messages;
  }
  
  private printProgress(current: number, total: number, result: DetailedLatencyBreakdown): void {
    const statusIcon = result.success ? '✅' : '❌';
    const latency = result.totalLatency;
    const ttfb = result.upstreamLatency;
    const overhead = result.gatewayOverhead;
    console.log(`   ${statusIcon} [${current}/${total}] ${latency}ms total | ${ttfb}ms upstream | ${overhead}ms gateway | ${result.provider}`);
  }
  
  private calculateMetrics(totalTestTime: number): LatencyMetrics {
    const successful = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);
    
    const metrics: LatencyMetrics = {
      dnsLookup: [],
      tcpConnect: [],
      tlsHandshake: [],
      ttfb: [],
      totalLatency: [],
      download: [],
      firstTokenLatency: [],
      interTokenLatency: [],
      tokensPerSecond: [],
      gatewayOverhead: [],
      routingLatency: [],
      keySelectionLatency: [],
      rateLimiterLatency: [],
      retryCount: [],
      retryLatency: [],
      errors: failed.length,
      timeouts: failed.filter(r => r.status === 504).length,
      rateLimited: failed.filter(r => r.status === 429).length,
      summary: {
        p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0, stdDev: 0,
        ttfbP50: 0, ttfbP90: 0, ttfbP99: 0,
        firstTokenP50: 0, firstTokenP90: 0, firstTokenP99: 0,
        requestsPerSecond: 0,
        tokensPerSecond: 0,
        successRate: 0,
        errorRate: 0,
        timeoutRate: 0,
        rateLimitRate: 0,
        avgGatewayOverhead: 0,
        avgRoutingLatency: 0,
        avgKeySelectionLatency: 0,
        avgRateLimiterLatency: 0,
      },
    };
    
    if (successful.length === 0) return metrics;
    
    // Collect all metrics
    for (const r of successful) {
      metrics.totalLatency.push(r.totalLatency);
      metrics.ttfb.push(r.upstreamLatency);
      metrics.gatewayOverhead.push(r.gatewayOverhead);
      metrics.routingLatency.push(r.routingLatency);
      metrics.keySelectionLatency.push(r.keySelectionLatency);
      metrics.rateLimiterLatency.push(r.rateLimiterLatency);
      metrics.retryCount.push(r.retryCount);
      metrics.retryLatency.push(...r.retryLatencies);
      
      if (r.firstTokenLatency !== undefined) {
        metrics.firstTokenLatency.push(r.firstTokenLatency);
      }
      if (r.interTokenLatencies) {
        metrics.interTokenLatency.push(...r.interTokenLatencies);
      }
      if (r.tokensPerSecond !== undefined) {
        metrics.tokensPerSecond.push(r.tokensPerSecond);
      }
    }
    
    // Calculate percentiles
    metrics.summary.p50 = percentile(metrics.totalLatency, 50);
    metrics.summary.p90 = percentile(metrics.totalLatency, 90);
    metrics.summary.p95 = percentile(metrics.totalLatency, 95);
    metrics.summary.p99 = percentile(metrics.totalLatency, 99);
    metrics.summary.min = Math.min(...metrics.totalLatency);
    metrics.summary.max = Math.max(...metrics.totalLatency);
    metrics.summary.mean = mean(metrics.totalLatency);
    metrics.summary.stdDev = stdDev(metrics.totalLatency);
    
    metrics.summary.ttfbP50 = percentile(metrics.ttfb, 50);
    metrics.summary.ttfbP90 = percentile(metrics.ttfb, 90);
    metrics.summary.ttfbP99 = percentile(metrics.ttfb, 99);
    
    metrics.summary.firstTokenP50 = percentile(metrics.firstTokenLatency, 50);
    metrics.summary.firstTokenP90 = percentile(metrics.firstTokenLatency, 90);
    metrics.summary.firstTokenP99 = percentile(metrics.firstTokenLatency, 99);
    
    metrics.summary.requestsPerSecond = successful.length / (totalTestTime / 1000);
    metrics.summary.tokensPerSecond = mean(metrics.tokensPerSecond);
    
    metrics.summary.successRate = successful.length / this.results.length;
    metrics.summary.errorRate = failed.length / this.results.length;
    metrics.summary.timeoutRate = metrics.timeouts / this.results.length;
    metrics.summary.rateLimitRate = metrics.rateLimited / this.results.length;
    
    metrics.summary.avgGatewayOverhead = mean(metrics.gatewayOverhead);
    metrics.summary.avgRoutingLatency = mean(metrics.routingLatency);
    metrics.summary.avgKeySelectionLatency = mean(metrics.keySelectionLatency);
    metrics.summary.avgRateLimiterLatency = mean(metrics.rateLimiterLatency);
    
    return metrics;
  }
  
  private printResults(metrics: LatencyMetrics): void {
    console.log('\n📊 =================================================');
    console.log('📊 LATENCY TEST RESULTS');
    console.log('📊 =================================================');
    
    console.log(`\n✅ Success Rate: ${(metrics.summary.successRate * 100).toFixed(1)}%`);
    console.log(`❌ Error Rate: ${(metrics.summary.errorRate * 100).toFixed(1)}%`);
    console.log(`⏱️  Timeout Rate: ${(metrics.summary.timeoutRate * 100).toFixed(1)}%`);
    console.log(`🚫 Rate Limit Rate: ${(metrics.summary.rateLimitRate * 100).toFixed(1)}%`);
    console.log(`🚀 Throughput: ${metrics.summary.requestsPerSecond.toFixed(2)} req/s`);
    
    console.log('\n📈 Total Latency Percentiles:');
    console.log(`   P50: ${metrics.summary.p50.toFixed(0)}ms`);
    console.log(`   P90: ${metrics.summary.p90.toFixed(0)}ms`);
    console.log(`   P95: ${metrics.summary.p95.toFixed(0)}ms`);
    console.log(`   P99: ${metrics.summary.p99.toFixed(0)}ms`);
    console.log(`   Min: ${metrics.summary.min.toFixed(0)}ms`);
    console.log(`   Max: ${metrics.summary.max.toFixed(0)}ms`);
    console.log(`   Mean: ${metrics.summary.mean.toFixed(0)}ms ± ${metrics.summary.stdDev.toFixed(0)}ms`);
    
    console.log('\n⚡ Upstream Latency (TTFB) Percentiles:');
    console.log(`   P50: ${metrics.summary.ttfbP50.toFixed(0)}ms`);
    console.log(`   P90: ${metrics.summary.ttfbP90.toFixed(0)}ms`);
    console.log(`   P99: ${metrics.summary.ttfbP99.toFixed(0)}ms`);
    
    if (metrics.firstTokenLatency.length > 0) {
      console.log('\n🎯 First Token Latency (Streaming):');
      console.log(`   P50: ${metrics.summary.firstTokenP50.toFixed(0)}ms`);
      console.log(`   P90: ${metrics.summary.firstTokenP90.toFixed(0)}ms`);
      console.log(`   P99: ${metrics.summary.firstTokenP99.toFixed(0)}ms`);
    }
    
    if (metrics.interTokenLatency.length > 0) {
      console.log('\n🔤 Inter-Token Latency:');
      console.log(`   P50: ${percentile(metrics.interTokenLatency, 50).toFixed(0)}ms`);
      console.log(`   P90: ${percentile(metrics.interTokenLatency, 90).toFixed(0)}ms`);
      console.log(`   Mean: ${mean(metrics.interTokenLatency).toFixed(0)}ms`);
      console.log(`   Tokens/sec: ${metrics.summary.tokensPerSecond.toFixed(1)}`);
    }
    
    console.log('\n🏗️  Gateway Overhead Breakdown:');
    console.log(`   Total Gateway Overhead: ${metrics.summary.avgGatewayOverhead.toFixed(1)}ms (avg)`);
    console.log(`   Routing: ${metrics.summary.avgRoutingLatency.toFixed(1)}ms (avg)`);
    console.log(`   Key Selection: ${metrics.summary.avgKeySelectionLatency.toFixed(1)}ms (avg)`);
    console.log(`   Rate Limiter: ${metrics.summary.avgRateLimiterLatency.toFixed(1)}ms (avg)`);
    
    if (metrics.retryCount.length > 0) {
      const retries = metrics.retryCount.filter(r => r > 0).length;
      console.log(`\n🔄 Retries: ${retries}/${this.results.length} requests (${(retries/this.results.length*100).toFixed(1)}%)`);
    }
    
    console.log('\n📊 =================================================\n');
  }
}