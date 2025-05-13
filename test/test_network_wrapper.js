// Test script for network wrapper
const wrapper = require('./network_wrapper');
const http = require('http');

// Helper function to perform HTTP request
async function testHttpRequest(url) {
  console.log(`\n----- Testing HTTP request to ${url} -----`);
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
            data: data
          });
        });
      });
      
      req.on('error', (error) => {
        reject(error);
      });
      
      req.end();
    });
    
    console.log(`✅ Request succeeded with status: ${response.statusCode}`);
    console.log(`✅ Response size: ${response.data.length} bytes`);
    return true;
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
    return false;
  }
}

// Run tests
async function runTests() {
  console.log('===== NETWORK WRAPPER TEST =====');
  
  // Test with bridge disconnected
  console.log('\n[TEST 1] Bridge disconnected - should FAIL');
  console.log(`Current bridge state: ${wrapper.isBridgeConnected() ? 'Connected' : 'Disconnected'}`);
  
  await testHttpRequest('http://192.168.1.1');
  
  // Test with bridge connected
  console.log('\n[TEST 2] Bridge connected - should SUCCEED');
  wrapper.setBridgeConnected(true);
  console.log(`Current bridge state: ${wrapper.isBridgeConnected() ? 'Connected' : 'Disconnected'}`);
  
  await testHttpRequest('http://192.168.1.1');
  
  // Test with bridge disconnected again
  console.log('\n[TEST 3] Bridge disconnected again - should FAIL');
  wrapper.setBridgeConnected(false);
  console.log(`Current bridge state: ${wrapper.isBridgeConnected() ? 'Connected' : 'Disconnected'}`);
  
  await testHttpRequest('http://192.168.1.1');
  
  console.log('\n===== TEST COMPLETE =====');
}

// Run the tests
runTests(); 