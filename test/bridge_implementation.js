// Mock bridge implementation for handling network requests
const http = require('http');
const wrapper = require('./network_wrapper');

class MockBridge {
  constructor() {
    this.connected = false;
    this.requests = [];
  }
  
  // Connect bridge to wrapper
  connect() {
    this.connected = true;
    wrapper.setBridgeConnected(true);
    console.log('[Bridge] Connected to wrapper');
  }
  
  // Disconnect bridge from wrapper
  disconnect() {
    this.connected = false;
    wrapper.setBridgeConnected(false);
    console.log('[Bridge] Disconnected from wrapper');
  }
  
  // Handle HTTP request through the bridge
  async handleHttpRequest(url, options = {}) {
    if (!this.connected) {
      throw new Error('[Bridge] Not connected');
    }
    
    console.log(`[Bridge] Handling HTTP request to ${url}`);
    this.requests.push({ url, timestamp: Date.now() });
    
    // Actually make the request using original http module
    return new Promise((resolve, reject) => {
      const req = wrapper.originalHttp.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          console.log(`[Bridge] Completed request to ${url}, status: ${res.statusCode}`);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data
          });
        });
      });
      
      req.on('error', (error) => {
        console.log(`[Bridge] Error handling request to ${url}: ${error.message}`);
        reject(error);
      });
      
      req.end();
    });
  }
  
  // Get request history
  getRequestHistory() {
    return this.requests;
  }
}

module.exports = MockBridge; 