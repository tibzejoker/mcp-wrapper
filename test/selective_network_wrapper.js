// Selective network interception layer for MCP wrapper
const originalHttp = require('http');
const originalHttps = require('https');
const originalDns = require('dns');
const url = require('url');
const EventEmitter = require('events');

// Keep the original modules safe
const safeModules = {
  http: { ...originalHttp },
  https: { ...originalHttps },
  dns: { ...originalDns }
};

// Bridge connection state
let bridgeConnected = false;
let bridgeInstance = null;

// Event emitter for bridge communication
const bridgeEvents = new EventEmitter();

// List of allowed internal addresses
const internalAddresses = [
  'localhost',
  '127.0.0.1',
  '::1'
];

// Check if a destination is allowed without bridge
function isInternalRequest(host) {
  if (!host) return false;
  return internalAddresses.includes(host);
}

// Function to check if network access is allowed
function checkNetworkAccess(operation, host) {
  // Always allow internal requests
  if (isInternalRequest(host)) {
    console.log(`[Wrapper] Allowing internal request to ${host}`);
    return true;
  }
  
  // Block external requests if no bridge
  if (!bridgeConnected || !bridgeInstance) {
    const error = new Error(`Network access denied: ${operation} - No bridge connected`);
    error.code = 'EACCES';
    throw error;
  }
  
  return true;
}

// Create a proper mocked request object
function createMockRequest() {
  const mockReq = new EventEmitter();
  
  // Add required methods
  mockReq.end = () => {};
  mockReq.setTimeout = (ms, callback) => {
    if (callback) setTimeout(callback, ms);
    return mockReq;
  };
  mockReq.destroy = () => {};
  mockReq.abort = () => {};
  mockReq.write = () => true;
  
  return mockReq;
}

// Intercept HTTP module's request method
originalHttp.request = function(...args) {
  const options = args[0] || {};
  const callback = typeof args[1] === 'function' ? args[1] : null;
  let host = null;
  let isHttps = false;
  let requestUrl = '';
  
  if (typeof options === 'string') {
    // If the first argument is a string URL
    const parsedUrl = new URL(options);
    host = parsedUrl.hostname;
    requestUrl = options;
  } else {
    // If the first argument is an options object
    host = options.hostname || options.host || null;
    
    // Reconstruct URL from options
    const protocol = 'http:';
    const port = options.port ? `:${options.port}` : '';
    const path = options.path || '/';
    requestUrl = `${protocol}//${host}${port}${path}`;
  }
  
  if (host) {
    console.log(`[Wrapper] Intercepted HTTP request to ${host}`);
    
    // For internal requests, use the original implementation
    if (isInternalRequest(host)) {
      return safeModules.http.request.apply(this, args);
    }
    
    // For external requests, check bridge connection
    checkNetworkAccess(`HTTP request to ${host}`, host);
    
    // If we reach here, we should redirect through the bridge
    console.log(`[Wrapper] Redirecting HTTP request to bridge: ${requestUrl}`);
    
    // Create a mock request object with proper methods
    const mockReq = createMockRequest();
    
    // Handle request asynchronously through bridge
    process.nextTick(() => {
      bridgeInstance.handleHttpRequest(requestUrl, { 
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body || null
      })
      .then(bridgeResponse => {
        // Create a mock response object
        const mockRes = new EventEmitter();
        mockRes.statusCode = bridgeResponse.statusCode;
        mockRes.headers = bridgeResponse.headers;
        
        // Call the original callback if provided
        if (callback) {
          callback(mockRes);
        }
        
        // Emit response event
        mockReq.emit('response', mockRes);
        
        // Emit the data event with response data
        mockRes.emit('data', bridgeResponse.data);
        
        // Emit end event
        mockRes.emit('end');
      })
      .catch(error => {
        // Emit error event on the request
        mockReq.emit('error', error);
      });
    });
    
    return mockReq;
  }
  
  // Fallback to original implementation if we couldn't determine host
  return safeModules.http.request.apply(this, args);
};

// Also intercept HTTP get
originalHttp.get = function(...args) {
  const req = originalHttp.request.apply(this, args);
  req.end();
  return req;
};

// Intercept HTTPS module
originalHttps.request = function(...args) {
  const options = args[0] || {};
  const callback = typeof args[1] === 'function' ? args[1] : null;
  let host = null;
  let requestUrl = '';
  
  if (typeof options === 'string') {
    const parsedUrl = new URL(options);
    host = parsedUrl.hostname;
    requestUrl = options;
  } else {
    host = options.hostname || options.host || null;
    
    // Reconstruct URL from options
    const protocol = 'https:';
    const port = options.port ? `:${options.port}` : '';
    const path = options.path || '/';
    requestUrl = `${protocol}//${host}${port}${path}`;
  }
  
  if (host) {
    console.log(`[Wrapper] Intercepted HTTPS request to ${host}`);
    
    // For internal requests, use the original implementation
    if (isInternalRequest(host)) {
      return safeModules.https.request.apply(this, args);
    }
    
    // For external requests, check bridge connection
    checkNetworkAccess(`HTTPS request to ${host}`, host);
    
    // If we reach here, we should redirect through the bridge
    console.log(`[Wrapper] Redirecting HTTPS request to bridge: ${requestUrl}`);
    
    // Create a mock request object with proper methods
    const mockReq = createMockRequest();
    
    // Handle request asynchronously through bridge
    process.nextTick(() => {
      bridgeInstance.handleHttpRequest(requestUrl, { 
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body || null
      })
      .then(bridgeResponse => {
        // Create a mock response object
        const mockRes = new EventEmitter();
        mockRes.statusCode = bridgeResponse.statusCode;
        mockRes.headers = bridgeResponse.headers;
        
        // Call the original callback if provided
        if (callback) {
          callback(mockRes);
        }
        
        // Emit response event
        mockReq.emit('response', mockRes);
        
        // Emit the data event with response data
        mockRes.emit('data', bridgeResponse.data);
        
        // Emit end event
        mockRes.emit('end');
      })
      .catch(error => {
        // Emit error event on the request
        mockReq.emit('error', error);
      });
    });
    
    return mockReq;
  }
  
  // Fallback to original implementation
  return safeModules.https.request.apply(this, args);
};

// Intercept HTTPS get
originalHttps.get = function(...args) {
  const req = originalHttps.request.apply(this, args);
  req.end();
  return req;
};

// Intercept DNS lookups
originalDns.lookup = function(hostname, options, callback) {
  // Handle optional options parameter
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  
  if (hostname) {
    console.log(`[Wrapper] Intercepted DNS lookup for ${hostname}`);
    
    // For internal hostnames, use original implementation
    if (isInternalRequest(hostname)) {
      return safeModules.dns.lookup.apply(this, [hostname, options, callback]);
    }
    
    // For external hostnames, check bridge connection
    try {
      checkNetworkAccess(`DNS lookup for ${hostname}`, hostname);
    } catch (error) {
      if (callback) {
        process.nextTick(() => callback(error));
      }
      return;
    }
    
    // If bridge supports DNS lookups, use it
    if (bridgeInstance && typeof bridgeInstance.handleDnsLookup === 'function') {
      // Async lookup through bridge
      bridgeInstance.handleDnsLookup(hostname, options)
        .then(result => {
          if (callback && result) {
            callback(null, result.address, result.family);
          } else if (callback) {
            callback(new Error('Invalid DNS result'));
          }
        })
        .catch(error => {
          if (callback) {
            callback(error);
          }
        });
      return;
    }
  }
  
  // Fallback to original implementation
  return safeModules.dns.lookup.apply(this, arguments);
};

// Export functions to control the bridge connection state
module.exports = {
  // Set bridge connection state and instance
  setBridge: (bridge) => {
    bridgeInstance = bridge;
    bridgeConnected = !!bridge;
    console.log(`[Wrapper] Bridge ${bridgeConnected ? 'connected' : 'disconnected'}`);
    return bridgeConnected;
  },
  
  // Get current bridge connection state
  isBridgeConnected: () => bridgeConnected,
  
  // Check if a host is internal
  isInternalHost: isInternalRequest,
  
  // Original modules (for testing/comparison)
  originalModules: safeModules
}; 