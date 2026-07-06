// ============================================================
// AI Gateway — Latency Test Runner
// ============================================================

import { LatencyTester, LatencyTestConfig } from '../src/latency-tester';
import { loadConfig, createDefaultConfig, saveConfig } from '../src/config';

async function runLatencyTests() {
  console.log('🚀 AI Gateway Latency Testing Suite');
  console.log('====================================');
  
  // Load config
  let config = loadConfig();
  if (!config) {
    console.log('No config found, creating default...');
    config = createDefaultConfig();
    saveConfig(config);
  }
  
  const tester = new LatencyTester(config);
  
  // Test configurations
  const testConfigs: LatencyTestConfig[] = [
    // Non-streaming tests
    {
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      providerId: 'nvidia',
      messageCount: 3,
      maxTokens: 100,
      temperature: 0.7,
      stream: false,
      iterations: 10,
      concurrency: 1,
      warmupIterations: 2,
    },
    // Streaming tests
    {
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      providerId: 'nvidia',
      messageCount: 3,
      maxTokens: 200,
      temperature: 0.7,
      stream: true,
      iterations: 10,
      concurrency: 1,
      warmupIterations: 2,
    },
    // Concurrent test
    {
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      providerId: 'nvidia',
      messageCount: 2,
      maxTokens: 50,
      temperature: 0.7,
      stream: false,
      iterations: 20,
      concurrency: 5,
      warmupIterations: 2,
    },
  ];
  
  const allResults: Map<string, any> = new Map();
  
  for (const testConfig of testConfigs) {
    const testName = `${testConfig.stream ? 'stream' : 'non-stream'}-${testConfig.concurrency}c-${testConfig.iterations}i`;
    console.log(`\n\n{'='.repeat(60)}`);
    console.log(`TEST: ${testName}`);
    console.log(`{'='.repeat(60)}`);
    
    try {
      const metrics = await tester.runTest(testConfig);
      allResults.set(testName, metrics);
    } catch (error: any) {
      console.error(`❌ Test failed: ${error.message}`);
      allResults.set(testName, { error: error.message });
    }
  }
  
  // Print summary
  console.log('\n\n📋 =================================================');
  console.log('📋 TEST SUITE SUMMARY');
  console.log('📋 =================================================');
  
  for (const [name, result] of allResults.entries()) {
    if ('error' in result) {
      console.log(`\n❌ ${name}: FAILED - ${result.error}`);
      continue;
    }
    
    const s = result.summary;
    console.log(`\n✅ ${name}:`);
    console.log(`   Success Rate: ${(s.successRate * 100).toFixed(1)}%`);
    console.log(`   Throughput: ${s.requestsPerSecond.toFixed(2)} req/s`);
    console.log(`   Total Latency P50/P90/P99: ${s.p50.toFixed(0)}/${s.p90.toFixed(0)}/${s.p99.toFixed(0)}ms`);
    console.log(`   Upstream TTFB P50/P90/P99: ${s.ttfbP50.toFixed(0)}/${s.ttfbP90.toFixed(0)}/${s.ttfbP99.toFixed(0)}ms`);
    console.log(`   Gateway Overhead (avg): ${s.avgGatewayOverhead.toFixed(1)}ms`);
    console.log(`   Routing: ${s.avgRoutingLatency.toFixed(1)}ms | KeySel: ${s.avgKeySelectionLatency.toFixed(1)}ms | RateLimit: ${s.avgRateLimiterLatency.toFixed(1)}ms`);
  }
  
  console.log('\n📋 =================================================\n');
}

// Run tests
runLatencyTests().catch(console.error);