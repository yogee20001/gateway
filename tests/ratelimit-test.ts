// ============================================================
// AI Gateway — Rate Limiter Verification Test
// ============================================================

import { ProviderRateLimiter, RateLimitConfig } from '../src/rate-limiter';

async function testRateLimiter() {
  console.log('🧪 Testing Per-Key Rate Limiter');
  console.log('================================\n');
  
  const limiter = new ProviderRateLimiter();
  const config: RateLimitConfig = { requestsPerWindow: 5, windowMs: 60000 };
  
  limiter.configure('test-provider', config);
  
  // Simulate 4 API keys
  const keyHashes = ['key1', 'key2', 'key3', 'key4'];
  
  console.log('Test 1: Sequential requests on single key');
  console.log('Expected: 5 requests allowed, 6th should wait');
  const start1 = Date.now();
  for (let i = 0; i < 5; i++) {
    const reqStart = Date.now();
    await limiter.waitForSlot('test-provider', keyHashes[0]);
    console.log(`  Request ${i+1}: ${Date.now() - reqStart}ms wait`);
  }
  console.log(`  Total time: ${Date.now() - start1}ms\n`);
  
  console.log('Test 2: Parallel requests across 4 keys');
  console.log('Expected: 4 requests instant (one per key), 5th waits');
  const start2 = Date.now();
  const promises = keyHashes.map((key, i) => {
    const reqStart = Date.now();
    return limiter.waitForSlot('test-provider', key).then(() =>
      console.log(`  Key ${key}: ${Date.now() - reqStart}ms wait`)
    );
  });
  await Promise.all(promises);
  console.log(`  Total time for 4 parallel: ${Date.now() - start2}ms\n`);
  
  console.log('Test 3: Status check');
  const status = limiter.getStatus('test-provider');
  console.log(`  Total tokens: ${status?.tokens}`);
  console.log(`  Limit: ${status?.limit}`);
  console.log(`  Key count: ${status?.keyCount}`);
  
  for (const key of keyHashes) {
    const keyStatus = limiter.getKeyStatus('test-provider', key);
    console.log(`  ${key}: ${keyStatus?.tokens}/${keyStatus?.limit} tokens`);
  }
  
  console.log('\n✅ Rate limiter test complete');
}

testRateLimiter().catch(console.error);