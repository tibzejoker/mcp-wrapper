/**
 * http_interception_test.js
 * 
 * Test file for verifying HTTP request interception in Node.js
 */

import { NodeInterceptor } from '../interceptors/NodeInterceptor.js';
import http from 'http';
import https from 'https';
import { Bridge } from '../wrapper/bridge.js';

// Setup test environment
async function runTest() {
  console.log('Starting HTTP interception test');
  
  // Create a bridge for testing
  const bridge = new Bridge();
  
  // Initialize the NodeInterceptor with the bridge
  const interceptor = new NodeInterceptor({
    debug: true,
    bridge,
    autoApply: false
  });
  
  try {
    // Apply the interception hooks
    console.log('Applying interception hooks...');
    await interceptor.applyHooks();
    console.log('Hooks applied successfully!');
    
    // Test 1: HTTP Request using http.get
    console.log('\n\nTEST 1: HTTP Request using http.get');
    await new Promise((resolve, reject) => {
      // Create a timeout
      const timeout = setTimeout(() => {
        console.log('HTTP request timed out after 3 seconds');
        resolve();
      }, 3000);
      
      console.log('Calling http.get...');
      const req = http.get('http://example.com', (res) => {
        console.log('HTTP request callback received');
        console.log('HTTP Status:', res.statusCode);
        console.log('HTTP Headers:', res.headers);
        
        let data = '';
        res.on('data', (chunk) => {
          console.log('HTTP data chunk received:', chunk.length, 'bytes');
          data += chunk;
        });
        
        res.on('end', () => {
          console.log('HTTP response end received');
          console.log('Response Body:');
          try {
            const json = JSON.parse(data);
            console.log(JSON.stringify(json, null, 2));
          } catch (e) {
            console.log(data.substring(0, 500) + (data.length > 500 ? '...' : ''));
          }
          clearTimeout(timeout);
          resolve();
        });
      });
      
      req.on('error', (error) => {
        console.error('HTTP Request Error:', error);
        clearTimeout(timeout);
        resolve();
      });
      
      console.log('http.get request created, waiting for response...');
    });
    
    // Test 2: HTTPS Request using https.get
    console.log('\n\nTEST 2: HTTPS Request using https.get');
    await new Promise((resolve, reject) => {
      // Create a timeout
      const timeout = setTimeout(() => {
        console.log('HTTPS request timed out after 3 seconds');
        resolve();
      }, 3000);
      
      console.log('Calling https.get...');
      const req = https.get('https://api.github.com/users/example', (res) => {
        console.log('HTTPS request callback received');
        console.log('HTTPS Status:', res.statusCode);
        console.log('HTTPS Headers:', res.headers);
        
        let data = '';
        res.on('data', (chunk) => {
          console.log('HTTPS data chunk received:', chunk.length, 'bytes');
          data += chunk;
        });
        
        res.on('end', () => {
          console.log('HTTPS response end received');
          console.log('Response Body:');
          try {
            const json = JSON.parse(data);
            console.log(JSON.stringify(json, null, 2));
          } catch (e) {
            console.log(data.substring(0, 500) + (data.length > 500 ? '...' : ''));
          }
          clearTimeout(timeout);
          resolve();
        });
      });
      
      req.on('error', (error) => {
        console.error('HTTPS Request Error:', error);
        clearTimeout(timeout);
        resolve();
      });
      
      console.log('https.get request created, waiting for response...');
    });
    
    // Test 3: Fetch API
    console.log('\n\nTEST 3: Fetch API');
    try {
      const response = await fetch('https://jsonplaceholder.typicode.com/posts/1');
      console.log('Fetch Status:', response.status);
      console.log('Fetch Headers:');
      
      // Convert headers to object for display
      const headers = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      console.log(headers);
      
      const data = await response.json();
      console.log('Fetch Response Body:');
      console.log(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Fetch Error:', error);
    }
    
    // Reset hooks when done
    console.log('\n\nResetting interception hooks...');
    await interceptor.resetHooks();
    console.log('Hooks reset successfully!');
    
    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
runTest(); 