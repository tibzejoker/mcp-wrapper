// Mock bridge implementation for selective network wrapper
const http = require('http');
const https = require('https');
const dns = require('dns');
const { promisify } = require('util');
const url = require('url');
const wrapper = require('./selective_network_wrapper');

// Get the original modules directly
const originalHttp = wrapper.originalModules.http;
const originalHttps = wrapper.originalModules.https;
const originalDns = wrapper.originalModules.dns;

// Promisify DNS lookup for easier use
const dnsLookupPromise = promisify(originalDns.lookup);

class SelectiveBridge {
  constructor() {
    this.connected = false;
    this.requests = [];
  }
  
  // Connect bridge to wrapper
  connect() {
    this.connected = true;
    wrapper.setBridge(this);
    console.log('[Bridge] Connected to wrapper');
    return true;
  }
  
  // Disconnect bridge from wrapper
  disconnect() {
    this.connected = false;
    wrapper.setBridge(null);
    console.log('[Bridge] Disconnected from wrapper');
    return true;
  }
  
  // Parse a URL into components
  parseUrl(urlString) {
    try {
      const parsedUrl = new URL(urlString);
      return {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80'),
        path: parsedUrl.pathname + parsedUrl.search,
        isHttps: parsedUrl.protocol === 'https:'
      };
    } catch (error) {
      throw new Error(`Invalid URL format: ${error.message}`);
    }
  }
  
  // Handle HTTP/HTTPS request through the bridge
  async handleHttpRequest(url, options = {}) {
    if (!this.connected) {
      throw new Error('[Bridge] Not connected');
    }
    
    console.log(`[Bridge] Handling request to ${url}`);
    this.requests.push({ url, timestamp: Date.now() });
    
    // Parse the URL
    const parsedUrl = this.parseUrl(url);
    
    console.log(`[Bridge] Making ${parsedUrl.isHttps ? 'HTTPS' : 'HTTP'} request to ${parsedUrl.hostname}:${parsedUrl.port}${parsedUrl.path}`);
    
    // Choose the correct module
    const requestModule = parsedUrl.isHttps ? https : http;
    
    // Make an actual external request
    return new Promise((resolve, reject) => {
      try {
        const req = requestModule.request({
          hostname: parsedUrl.hostname,
          port: parsedUrl.port, 
          path: parsedUrl.path,
          method: options.method || 'GET',
          headers: options.headers || {},
          rejectUnauthorized: false, // Allow self-signed certs for testing
          timeout: 10000  // 10 second timeout
        }, (res) => {
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
        
        req.on('timeout', () => {
          console.log(`[Bridge] Request to ${url} timed out`);
          req.destroy();
          reject(new Error('Request timed out'));
        });
        
        req.end();
      } catch (error) {
        console.log(`[Bridge] Error setting up request to ${url}: ${error.message}`);
        reject(error);
      }
    });
  }
  
  // Handle DNS lookup through the bridge
  async handleDnsLookup(hostname, options = {}) {
    if (!this.connected) {
      throw new Error('[Bridge] Not connected');
    }
    
    console.log(`[Bridge] Handling DNS lookup for ${hostname}`);
    this.requests.push({ dns: hostname, timestamp: Date.now() });
    
    try {
      // Use the original DNS module (not the intercepted one)
      return await new Promise((resolve, reject) => {
        originalDns.lookup(hostname, (err, address, family) => {
          if (err) {
            console.log(`[Bridge] DNS lookup for ${hostname} failed: ${err.message}`);
            reject(err);
          } else {
            console.log(`[Bridge] DNS lookup for ${hostname} resolved to ${address} (IPv${family})`);
            resolve({ address, family });
          }
        });
      });
    } catch (error) {
      console.log(`[Bridge] DNS lookup for ${hostname} failed: ${error.message}`);
      throw error;
    }
  }
  
  // Get request history
  getRequestHistory() {
    return this.requests;
  }
}

module.exports = SelectiveBridge; 