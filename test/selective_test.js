// Test for selective network wrapper
const SelectiveBridge = require('./selective_bridge');
const http = require('http');
const https = require('https');
const dns = require('dns');
const { promisify } = require('util');

// Promisify DNS lookup for easier async testing
const dnsLookupPromise = promisify(dns.lookup);

console.log('===== SELECTIVE NETWORK WRAPPER TEST =====');
console.log('This test demonstrates traffic redirection through the bridge');
console.log('External network requests will be handled by the bridge, not directly');

// Create our bridge
const bridge = new SelectiveBridge();

// Helper function to make an HTTP request
async function makeRequest(url) {
  console.log(`\n----- Attempting request to ${url} -----`);
  
  try {
    // Create a promise-based HTTP request
    const response = await new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data.substring(0, 100) + (data.length > 100 ? '...' : '') // Truncate long responses
          });
        });
      });
      
      req.on('error', (error) => {
        reject(error);
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
      
      req.end();
    });
    
    console.log(`✅ Request succeeded with status code: ${response.statusCode}`);
    console.log(`✅ Received ${response.data.length} bytes of data`);
    return true;
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
    return false;
  }
}

// Helper function to test DNS lookup
async function testDnsLookup(hostname) {
  console.log(`\n----- Attempting DNS lookup for ${hostname} -----`);
  
  try {
    const result = await dnsLookupPromise(hostname);
    console.log(`✅ DNS lookup succeeded: ${hostname} -> ${result.address} (IPv${result.family})`);
    return true;
  } catch (error) {
    console.log(`❌ DNS lookup failed: ${error.message}`);
    return false;
  }
}

// Test our wrapper with different configurations
async function runTests() {
  // Test 1: Internal request (localhost) - Should always work
  console.log('\n[TEST 1] Internal request (without bridge) - Should SUCCEED');
  await makeRequest('http://localhost:8080');
  
  // Test 2: External request without bridge - Should Fail
  console.log('\n[TEST 2] External request without bridge - Should FAIL');
  await makeRequest('http://example.com');
  
  // Test 3: DNS lookup without bridge - Should Fail
  console.log('\n[TEST 3] DNS lookup without bridge - Should FAIL');
  await testDnsLookup('example.com');
  
  // Test 4: Connect bridge and try external request - Should Succeed
  console.log('\n[TEST 4] External request with bridge - Should SUCCEED');
  bridge.connect();
  await makeRequest('http://example.com');
  
  // Test 5: DNS lookup with bridge - Should Succeed
  console.log('\n[TEST 5] DNS lookup with bridge - Should SUCCEED');
  await testDnsLookup('example.com');
  
  // Test 6: HTTPS request with bridge - Should Succeed
  console.log('\n[TEST 6] HTTPS request with bridge - Should SUCCEED');
  await makeRequest('https://example.com');
  
  // Test 7: Disconnect bridge - Should fail again
  console.log('\n[TEST 7] External request after bridge disconnect - Should FAIL');
  bridge.disconnect();
  await makeRequest('http://example.com');
  
  console.log('\n===== TEST COMPLETE =====');
  
  // Show request history from bridge
  const history = bridge.getRequestHistory();
  if (history.length > 0) {
    console.log('\nBridge Request History:');
    history.forEach((req, index) => {
      const date = new Date(req.timestamp);
      const requestType = req.dns ? `DNS lookup: ${req.dns}` : `HTTP(S) request: ${req.url}`;
      console.log(`${index + 1}. ${requestType} - ${date.toISOString()}`);
    });
  }
}

// Run the tests
runTests(); 