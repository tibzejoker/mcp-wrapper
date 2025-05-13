// Network interception layer for MCP wrapper
const originalNet = require('net');
const originalHttp = require('http');
const originalHttps = require('https');
const originalDns = require('dns');

// Bridge connection state (controlled by the wrapper)
let bridgeConnected = false;

// Function to check if network access is allowed
function checkNetworkAccess(operation) {
  if (!bridgeConnected) {
    const error = new Error(`Network access denied: ${operation} - No bridge connected`);
    error.code = 'EACCES';
    throw error;
  }
}

// We need a different approach than extending Socket
// Store the original Socket constructor
const OriginalSocket = originalNet.Socket;

// Replace with our intercepted version
originalNet.Socket = function(...args) {
  // Check before creating socket
  checkNetworkAccess('Socket creation');
  console.log('[Wrapper] Creating network socket');
  
  // Create the socket using the original constructor
  const socket = new OriginalSocket(...args);
  
  // Intercept the connect method
  const originalConnect = socket.connect;
  socket.connect = function(...connectArgs) {
    const [options] = connectArgs;
    const host = typeof options === 'object' ? options.host : connectArgs[1] || 'unknown';
    const port = typeof options === 'object' ? options.port : connectArgs[0] || 0;
    
    console.log(`[Wrapper] Intercepted socket connection to ${host}:${port}`);
    checkNetworkAccess(`Socket connection to ${host}:${port}`);
    
    // If we reach here, bridge is connected - allow but log the operation
    return originalConnect.apply(this, connectArgs);
  };
  
  return socket;
};

// Needed to maintain instanceof checks
originalNet.Socket.prototype = OriginalSocket.prototype;

// Intercept net.connect and net.createConnection
const netConnectMethods = ['connect', 'createConnection'];
netConnectMethods.forEach(method => {
  const original = originalNet[method];
  originalNet[method] = function(...args) {
    const options = args[0] || {};
    const host = typeof options === 'object' ? options.host : args[1] || 'unknown';
    const port = typeof options === 'object' ? options.port : args[0] || 0;
    
    console.log(`[Wrapper] Intercepted net.${method} to ${host}:${port}`);
    checkNetworkAccess(`net.${method} to ${host}:${port}`);
    
    return original.apply(this, args);
  };
});

// Intercept HTTP module
const originalHttpRequest = originalHttp.request;
originalHttp.request = function(...args) {
  const options = args[0] || {};
  const host = typeof options === 'string' ? options : options.hostname || options.host || 'unknown';
  const port = typeof options === 'object' ? options.port || 80 : 80;
  
  console.log(`[Wrapper] Intercepted HTTP request to ${host}:${port}`);
  checkNetworkAccess(`HTTP request to ${host}:${port}`);
  
  return originalHttpRequest.apply(this, args);
};

// Intercept HTTP get method
originalHttp.get = function(...args) {
  const options = args[0] || {};
  const host = typeof options === 'string' ? options : options.hostname || options.host || 'unknown';
  
  console.log(`[Wrapper] Intercepted HTTP GET to ${host}`);
  checkNetworkAccess(`HTTP GET to ${host}`);
  
  return originalHttpRequest.apply(this, args);
};

// Intercept HTTPS module
const originalHttpsRequest = originalHttps.request;
originalHttps.request = function(...args) {
  const options = args[0] || {};
  const host = typeof options === 'string' ? options : options.hostname || options.host || 'unknown';
  const port = typeof options === 'object' ? options.port || 443 : 443;
  
  console.log(`[Wrapper] Intercepted HTTPS request to ${host}:${port}`);
  checkNetworkAccess(`HTTPS request to ${host}:${port}`);
  
  return originalHttpsRequest.apply(this, args);
};

// Intercept HTTPS get method
originalHttps.get = function(...args) {
  const options = args[0] || {};
  const host = typeof options === 'string' ? options : options.hostname || options.host || 'unknown';
  
  console.log(`[Wrapper] Intercepted HTTPS GET to ${host}`);
  checkNetworkAccess(`HTTPS GET to ${host}`);
  
  return originalHttpsRequest.apply(this, args);
};

// Intercept DNS lookups
const originalLookup = originalDns.lookup;
originalDns.lookup = function(hostname, ...args) {
  console.log(`[Wrapper] Intercepted DNS lookup for ${hostname}`);
  checkNetworkAccess(`DNS lookup for ${hostname}`);
  
  return originalLookup.apply(this, [hostname, ...args]);
};

// Export functions to control the bridge connection state
module.exports = {
  // Set bridge connection state
  setBridgeConnected: (connected) => {
    const previous = bridgeConnected;
    bridgeConnected = connected;
    console.log(`[Wrapper] Bridge connection state changed: ${previous} -> ${connected}`);
    return previous;
  },
  
  // Get current bridge connection state
  isBridgeConnected: () => bridgeConnected,
  
  // Original modules (for testing/comparison)
  originalNet,
  originalHttp,
  originalHttps,
  originalDns
}; 