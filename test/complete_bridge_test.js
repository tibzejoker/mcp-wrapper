// Complete test of bridge-based network request handling
const SelectiveBridge = require('./selective_bridge');
const http = require('http');
const https = require('https');
const dns = require('dns');
const { promisify } = require('util');

// Promisify DNS lookup for easier async testing
const dnsLookupPromise = promisify(dns.lookup);

console.log('===== COMPLETE MCP WRAPPER BRIDGE TEST =====');
console.log('This test demonstrates how network requests are intercepted');
console.log('and redirected through the bridge when connected');
console.log('Starting local test server for internal request testing...');

// Create a real network bridge
const bridge = new SelectiveBridge();

// Create a simple local HTTP server for testing internal requests
const localServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from local test server');
});

// Helper function to make an HTTP request with proper error handling
async function makeHttpRequest(url) {
  console.log(`\n----- Attempting HTTP request to ${url} -----`);
  
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
    
    console.log(`✅ HTTP request succeeded with status code: ${response.statusCode}`);
    console.log(`✅ Received ${response.data.length} bytes of data`);
    return true;
  } catch (error) {
    console.log(`❌ HTTP request failed: ${error.message}`);
    return false;
  }
}

// Helper function to make an HTTPS request
async function makeHttpsRequest(url) {
  console.log(`\n----- Attempting HTTPS request to ${url} -----`);
  
  try {
    // Create a promise-based HTTPS request
    const response = await new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
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
    
    console.log(`✅ HTTPS request succeeded with status code: ${response.statusCode}`);
    console.log(`✅ Received ${response.data.length} bytes of data`);
    return true;
  } catch (error) {
    console.log(`❌ HTTPS request failed: ${error.message}`);
    return false;
  }
}

// Helper function to test DNS lookup
async function performDnsLookup(hostname) {
  console.log(`\n----- Attempting DNS lookup for ${hostname} -----`);
  
  try {
    // Use the Node.js callback style instead of promisify to handle our wrapper
    const result = await new Promise((resolve, reject) => {
      dns.lookup(hostname, (err, address, family) => {
        if (err) {
          reject(err);
        } else {
          resolve({ address, family });
        }
      });
    });
    
    if (result && result.address) {
      console.log(`✅ DNS lookup succeeded: ${hostname} -> ${result.address} (IPv${result.family})`);
      return true;
    } else {
      console.log(`❌ DNS lookup failed: Invalid result`);
      return false;
    }
  } catch (error) {
    console.log(`❌ DNS lookup failed: ${error.message}`);
    return false;
  }
}

// Test function to demonstrate proper network handling
async function runComprehensiveTest() {
  try {
    // Part 1: No bridge connected
    console.log('\n==========================================');
    console.log('PART 1: NO BRIDGE CONNECTED');
    console.log('==========================================');
    
    // Test 1.1: Internal HTTP request (should always work)
    console.log('\n[TEST 1.1] Internal HTTP request - Should SUCCEED');
    await makeHttpRequest('http://localhost:8080');
    
    // Test 1.2: External HTTP request (should fail)
    console.log('\n[TEST 1.2] External HTTP request - Should FAIL');
    await makeHttpRequest('http://example.com');
    
    // Test 1.3: External HTTPS request (should fail)
    console.log('\n[TEST 1.3] External HTTPS request - Should FAIL');
    await makeHttpsRequest('https://example.com');
    
    // Test 1.4: DNS lookup (should fail)
    console.log('\n[TEST 1.4] DNS lookup - Should FAIL');
    await performDnsLookup('example.com');
    
    // Part 2: Bridge connected
    console.log('\n==========================================');
    console.log('PART 2: BRIDGE CONNECTED');
    console.log('==========================================');
    
    // Connect the bridge
    console.log('\nConnecting bridge...');
    bridge.connect();
    
    // Test 2.1: Internal HTTP request (should still work)
    console.log('\n[TEST 2.1] Internal HTTP request - Should SUCCEED');
    await makeHttpRequest('http://localhost:8080');
    
    // Test 2.2: External HTTP request (should work through bridge)
    console.log('\n[TEST 2.2] External HTTP request - Should SUCCEED through bridge');
    await makeHttpRequest('http://example.com');
    
    // Test 2.3: External HTTPS request (should work through bridge)
    console.log('\n[TEST 2.3] External HTTPS request - Should SUCCEED through bridge');
    await makeHttpsRequest('https://example.com');
    
    // Test 2.4: DNS lookup (should work through bridge)
    console.log('\n[TEST 2.4] DNS lookup - Should SUCCEED through bridge');
    await performDnsLookup('example.com');
    
    // Part 3: Bridge disconnected
    console.log('\n==========================================');
    console.log('PART 3: BRIDGE DISCONNECTED');
    console.log('==========================================');
    
    // Disconnect the bridge
    console.log('\nDisconnecting bridge...');
    bridge.disconnect();
    
    // Test 3.1: Internal HTTP request (should still work)
    console.log('\n[TEST 3.1] Internal HTTP request - Should SUCCEED');
    await makeHttpRequest('http://localhost:8080');
    
    // Test 3.2: External HTTP request (should fail again)
    console.log('\n[TEST 3.2] External HTTP request - Should FAIL');
    await makeHttpRequest('http://example.com');
    
    // Test 3.3: External HTTPS request (should fail again)
    console.log('\n[TEST 3.3] External HTTPS request - Should FAIL');
    await makeHttpsRequest('https://example.com');
    
    // Test 3.4: DNS lookup (should fail again)
    console.log('\n[TEST 3.4] DNS lookup - Should FAIL');
    await performDnsLookup('example.com');
    
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
    } else {
      console.log('\nNo requests handled by bridge');
    }
  } catch (error) {
    console.error('Error during test execution:', error);
  } finally {
    // After tests, close the local server and exit
    console.log('\nClosing local test server...');
    localServer.close(() => {
      console.log('Server closed');
    });
  }
}

// Function to run tests after server is ready
function runTests() {
  console.log('Running tests...');
  runComprehensiveTest();
}

// Start the server on port 8080
const PORT = 8080;
localServer.listen(PORT, () => {
  console.log(`Local test server running at http://localhost:${PORT}`);
  runTests();
}); 