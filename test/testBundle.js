/**
 * Simple test bundle for HTTP interception
 * 
 * This mimics a bundled script that makes HTTP requests.
 */

// Self-contained module scope
(function() {
  // Simulate bundled imports
  const http = require('http');
  const https = require('https');
  
  function makeHttpRequest() {
    console.log('Making HTTP request from bundled script...');
    
    const req = http.get('http://example.com', (res) => {
      console.log('Bundle HTTP Status:', res.statusCode);
      console.log('Bundle HTTP Headers:', res.headers);
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString();
      });
      
      res.on('end', () => {
        console.log('Bundle HTTP Response:');
        console.log(data);
      });
    });
    
    req.on('error', (error) => {
      console.error('Bundle HTTP Error:', error.message);
    });
  }
  
  function makeHttpsRequest() {
    console.log('Making HTTPS request from bundled script...');
    
    const req = https.get('https://api.github.com/users/example', (res) => {
      console.log('Bundle HTTPS Status:', res.statusCode);
      console.log('Bundle HTTPS Headers:', res.headers);
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString();
      });
      
      res.on('end', () => {
        console.log('Bundle HTTPS Response:');
        console.log(data);
      });
    });
    
    req.on('error', (error) => {
      console.error('Bundle HTTPS Error:', error.message);
    });
  }
  
  function makeFetchRequest() {
    if (typeof fetch === 'function') {
      console.log('Making fetch request from bundled script...');
      
      fetch('https://jsonplaceholder.typicode.com/posts/1')
        .then(response => {
          console.log('Bundle Fetch Status:', response.status);
          console.log('Bundle Fetch Headers:', Object.fromEntries(response.headers));
          return response.json();
        })
        .then(data => {
          console.log('Bundle Fetch Response:');
          console.log(JSON.stringify(data, null, 2));
        })
        .catch(error => {
          console.error('Bundle Fetch Error:', error.message);
        });
    } else {
      console.log('Fetch API not available in this Node.js version');
    }
  }
  
  // Run all tests
  makeHttpRequest();
  setTimeout(makeHttpsRequest, 500);
  setTimeout(makeFetchRequest, 1000);
  
  // Export tests for CommonJS compatibility
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      makeHttpRequest,
      makeHttpsRequest,
      makeFetchRequest
    };
  }
})(); 