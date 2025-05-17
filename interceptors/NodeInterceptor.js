/**
 * NodeInterceptor.js
 * 
 * This class implements the InterceptorInterface for Node.js.
 * It intercepts all external calls from sandboxed Node.js scripts.
 */

import { InterceptorInterface } from './InterceptorInterface.js';
import { EventEmitter } from 'events';

// Store module references instead of trying to modify them directly
let modules = {
  http: null,
  https: null,
  fs: null,
  net: null,
  dns: null,
  childProcess: null,
  WebSocket: null,
  stream: null
};

// Create proxies for each module
const proxies = {};

// We'll proxy the entire global object to intercept imports
let originalGlobalThis = null;

// Dynamic imports for ESM compatibility
async function loadModules() {
  try {
    const httpModule = await import('http');
    modules.http = httpModule.default || httpModule;
    
    const httpsModule = await import('https');
    modules.https = httpsModule.default || httpsModule;
    
    const fsModule = await import('fs');
    modules.fs = fsModule.default || fsModule;
    
    const netModule = await import('net');
    modules.net = netModule.default || netModule;
    
    const dnsModule = await import('dns');
    modules.dns = dnsModule.default || dnsModule;
    
    const cpModule = await import('child_process');
    const cp = cpModule.default || cpModule;
    modules.childProcess = { 
      spawn: cp.spawn, 
      exec: cp.exec 
    };
    
    try {
      const wsModule = await import('ws');
      const ws = wsModule.default || wsModule;
      modules.WebSocket = ws.WebSocket;
    } catch (e) {
      // WebSocket module might not be available
      console.warn('WebSocket module not available:', e.message);
    }
    
    const streamModule = await import('stream');
    modules.stream = streamModule.default || streamModule;
    
    return true;
  } catch (e) {
    console.error('Error loading modules:', e);
    return false;
  }
}

// Load modules synchronously if in CommonJS context
try {
  modules.http = require('http');
  modules.https = require('https');
  modules.fs = require('fs');
  modules.net = require('net');
  modules.dns = require('dns');
  const cp = require('child_process');
  modules.childProcess = { spawn: cp.spawn, exec: cp.exec };
  
  try {
    const ws = require('ws');
    modules.WebSocket = ws.WebSocket;
  } catch (e) {
    // WebSocket module might not be available
    console.warn('WebSocket module not available');
  }
} catch (e) {
  // If require is not available, we're in ESM mode
  // Modules will be loaded asynchronously in constructor
}

export class NodeInterceptor extends InterceptorInterface {
  constructor(options = {}) {
    super();
    
    this.options = {
      proxyEndpoint: options.proxyEndpoint || 'http://localhost:3000/intercept',
      language: 'node',
      bridgeId: options.bridgeId || null,
      debug: options.debug || false,
      bridge: options.bridge || null,
      ...options
    };
    
    // Store original implementations to restore them when needed
    this.originalImplementations = {};
    
    // Track which events are intercepted
    this.implementedEvents = [];
    
    // Initialize proxies collection
    this.proxies = {};
    
    // Set static instance for constructor interceptions
    NodeInterceptor.instance = this;
    
    // Check if modules are loaded, if not load them asynchronously
    this.isESM = false;
    if (!modules.http || !modules.fs) {
      this._debug('Loading modules asynchronously (ESM mode)');
      this.isESM = true;
      this._modulesLoaded = loadModules().then(() => {
        this._debug('Modules loaded asynchronously');
        return true;
      });
    } else {
      this._modulesLoaded = Promise.resolve(true);
      this._debug('Modules loaded synchronously (CommonJS mode)');
    }
    
    // Apply hooks on instantiation if autoApply is true
    if (options.autoApply) {
      this._modulesLoaded.then(() => {
        this.applyHooks();
      });
    }
  }
  
  /**
   * Debug log if debug is enabled
   * @private
   */
  _debug(...args) {
    if (this.options.debug) {
      console.error('[NodeInterceptor]', ...args);
    }
  }
  
  /**
   * Get the bridge instance
   * @returns {Bridge|null} The bridge instance or null if not available
   */
  getBridge() {
    return this.options.bridge;
  }
  
  /**
   * Set the bridge instance
   * @param {Bridge} bridge The bridge instance to use
   */
  setBridge(bridge) {
    this.options.bridge = bridge;
  }
  
  /**
   * Apply all hooks to intercept external calls
   * @returns {Promise<boolean>} True if all hooks were applied successfully
   */
  async applyHooks() {
    this._debug('Applying hooks to intercept external calls');
    
    // Ensure modules are loaded
    await this._modulesLoaded;
    
    this.implementedEvents = [];
    
    // Handle ESM mode differently - we need to proxy the modules
    if (this.isESM) {
      // Double-check that modules are available or retry loading them
      if (!modules.fs || !modules.http || !modules.stream) {
        this._debug('Modules not loaded properly, retrying load');
        await loadModules();
      }
      
      this._applyESMHooks();
    } else {
      // Traditional interception for CommonJS
      this._interceptFs();
      this._interceptHttp();
      this._interceptNet();
      this._interceptDns();
      this._interceptChildProcess();
      this._interceptWebSocket();
    }
    
    // Intercept fetch in both modes
    this._interceptFetch();
    
    // Validate that all required events are intercepted
    this.validateEvents(this.implementedEvents);
    
    this._debug('All hooks successfully applied');
    return true;
  }
  
  /**
   * Apply hooks for ES modules using proxies
   * @private
   */
  _applyESMHooks() {
    this._debug('Applying hooks for ES modules using proxies');
    
    // Save original globalThis.fetch for restoration
    if (typeof globalThis.fetch === 'function') {
      this.originalImplementations.fetch = globalThis.fetch;
    }
    
    // Use the direct interception methods instead of proxies
    this._interceptHttp();
    this._interceptNet();
    this._interceptDns();
    this._interceptChildProcess();
    this._interceptWebSocket();
    
    // Store original module references for imports
    this.originalModules = { ...modules };
    
    // If possible, intercept future imports
    if (typeof globalThis !== 'undefined') {
      this._setupImportInterception();
    }
    
    // Mark all events as implemented
    this.implementedEvents = [
      'fs_readFile',
      'fs_writeFile',
      'fs_unlink',
      'fs_stat',
      'http_request',
      'https_request',
      'fetch',
      'net_connect',
      'dns_lookup',
      'spawn',
      'exec',
      'websocket_connect'
    ];
  }
  
  /**
   * Set up interception of future imports
   * @private
   */
  _setupImportInterception() {
    // Store original import function
    if (typeof globalThis.import === 'function') {
      this.originalImplementations.import = globalThis.import;
      
      const interceptor = this;
      globalThis.import = async function(specifier) {
        const originalModule = await interceptor.originalImplementations.import(specifier);
        
        // Check if this is a module we want to intercept
        if (specifier === 'fs' || specifier === 'node:fs') {
          return interceptor.proxies.fs || originalModule;
        } else if (specifier === 'http' || specifier === 'node:http') {
          return interceptor.proxies.http || originalModule;
        } else if (specifier === 'https' || specifier === 'node:https') {
          return interceptor.proxies.https || originalModule;
        } else if (specifier === 'net' || specifier === 'node:net') {
          return interceptor.proxies.net || originalModule;
        } else if (specifier === 'dns' || specifier === 'node:dns') {
          return interceptor.proxies.dns || originalModule;
        } else if (specifier === 'child_process' || specifier === 'node:child_process') {
          return interceptor.proxies.childProcess || originalModule;
        }
        
        return originalModule;
      };
    }
  }
  
  /**
   * Create a proxy for the fs module
   * @private
   */
  _createFsProxy() {
    const interceptor = this;
    
    // We need to create a copy that we can modify
    if (!modules.fs) {
      this._debug('fs module not available, skipping proxy creation');
      return;
    }
    
    const fsProxy = { ...modules.fs };
    
    // Replace specific methods
    fsProxy.readFile = async function(...args) {
      const filePath = args[0];
      const options = typeof args[1] === 'object' ? args[1] : { encoding: args[1] };
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      
      interceptor._debug(`Intercepted fs.readFile: ${filePath}`);
      
      try {
        const response = await interceptor.sendIntercept('fs_readFile', {
          args: [filePath, options]
        });
        
        if (callback) {
          callback(null, response.data);
          return undefined;
        }
        return response.data;
      } catch (error) {
        if (callback) {
          callback(error);
          return undefined;
        }
        throw error;
      }
    };
    
    fsProxy.writeFile = async function(...args) {
      const filePath = args[0];
      const data = args[1];
      const options = typeof args[2] === 'object' ? args[2] : { encoding: args[2] };
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      
      interceptor._debug(`Intercepted fs.writeFile: ${filePath}`);
      
      try {
        const response = await interceptor.sendIntercept('fs_writeFile', {
          args: [filePath, data, options]
        });
        
        if (callback) {
          callback(null);
          return undefined;
        }
        return response;
      } catch (error) {
        if (callback) {
          callback(error);
          return undefined;
        }
        throw error;
      }
    };
    
    fsProxy.unlink = async function(...args) {
      const filePath = args[0];
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      
      interceptor._debug(`Intercepted fs.unlink: ${filePath}`);
      
      try {
        const response = await interceptor.sendIntercept('fs_unlink', {
          args: [filePath]
        });
        
        if (callback) {
          callback(null);
          return undefined;
        }
        return response;
      } catch (error) {
        if (callback) {
          callback(error);
          return undefined;
        }
        throw error;
      }
    };
    
    fsProxy.stat = async function(...args) {
      const filePath = args[0];
      const options = typeof args[1] === 'object' ? args[1] : {};
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      
      interceptor._debug(`Intercepted fs.stat: ${filePath}`);
      
      try {
        const response = await interceptor.sendIntercept('fs_stat', {
          args: [filePath, options]
        });
        
        if (callback) {
          callback(null, response.stats);
          return undefined;
        }
        return response.stats;
      } catch (error) {
        if (callback) {
          callback(error);
          return undefined;
        }
        throw error;
      }
    };
    
    // Store the proxy
    this.proxies.fs = fsProxy;
    
    // Try to replace the module for future imports
    try {
      if (typeof globalThis !== 'undefined' && globalThis.fs) {
        Object.assign(globalThis.fs, fsProxy);
      }
    } catch (e) {
      this._debug('Could not replace globalThis.fs:', e);
    }
    
    this.implementedEvents.push('fs_readFile', 'fs_writeFile', 'fs_unlink', 'fs_stat');
  }
  
  /**
   * Intercept HTTP and HTTPS modules
   * @private
   */
  _interceptHttp() {
    this._debug('Intercepting HTTP and HTTPS modules');
    
    try {
      // Ensure the modules are loaded
      const http = modules.http;
      const https = modules.https;
      
      if (!http || !https) {
        this._debug('HTTP or HTTPS module not available, skipping interception');
        return;
      }
      
      // Store original methods
      this.originalImplementations.http = {
        get: http.get,
        request: http.request
      };
      
      this.originalImplementations.https = {
        get: https.get,
        request: https.request
      };
      
      // Intercept HTTP methods
      const interceptor = this;
      
      // Create a simpler HTTP interception approach for get methods that directly returns a response
      // without complex event handling which can lead to issues
      http.get = function(url, options, callback) {
        // Normalize arguments
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        
        interceptor._debug(`Direct intercepted http.get for ${typeof url === 'string' ? url : url.href}`);
        
        // Send the intercepted request directly
        const urlString = typeof url === 'string' ? url : url.href;
        
        // Create a simple request object with minimal properties
        const req = new EventEmitter();
        
        // If no callback is provided, set up to handle 'response' event
        if (typeof callback !== 'function') {
          interceptor._debug('No callback provided to http.get, will use response event');
        }
        
        // Process immediately
        process.nextTick(() => {
          interceptor.sendIntercept('http_request', {
            url: urlString,
            options
          }).then(response => {
            // Create a simple response object
            const res = new EventEmitter();
            
            // Set response properties
            res.statusCode = response.statusCode || 200;
            res.headers = response.headers || {};
            
            // Call the callback if provided
            if (typeof callback === 'function') {
              try {
                callback(res);
              } catch (err) {
                interceptor._debug(`Error in http.get callback: ${err.message}`);
                req.emit('error', err);
                return;
              }
            }
            
            // Emit the response event for event-based handling
            req.emit('response', res);
            
            // Schedule the data and end events
            const body = response.body || '';
            
            // Emit data event if there's a body
            if (body) {
              process.nextTick(() => {
                res.emit('data', Buffer.from(body));
                
                // Always end the response
                process.nextTick(() => {
                  res.emit('end');
                });
              });
            } else {
              // Just end immediately if no body
              process.nextTick(() => {
                res.emit('end');
              });
            }
          }).catch(error => {
            interceptor._debug(`Error in direct http.get: ${error.message}`);
            req.emit('error', error);
          });
        });
        
        return req;
      };
      
      // Do the same for https.get
      https.get = function(url, options, callback) {
        // Normalize arguments
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        
        interceptor._debug(`Direct intercepted https.get for ${typeof url === 'string' ? url : url.href}`);
        
        // Send the intercepted request directly
        const urlString = typeof url === 'string' ? url : url.href;
        
        // Create a simple request object with minimal properties
        const req = new EventEmitter();
        
        // Process immediately
        process.nextTick(() => {
          interceptor.sendIntercept('https_request', {
            url: urlString,
            options
          }).then(response => {
            // Create a simple response object
            const res = new EventEmitter();
            
            // Set response properties
            res.statusCode = response.statusCode || 200;
            res.headers = response.headers || {};
            
            // Call the callback if provided
            if (typeof callback === 'function') {
              try {
                callback(res);
              } catch (err) {
                interceptor._debug(`Error in https.get callback: ${err.message}`);
                req.emit('error', err);
                return;
              }
            }
            
            // Emit the response event for event-based handling
            req.emit('response', res);
            
            // Schedule the data and end events
            const body = response.body || '';
            
            // Emit data event if there's a body
            if (body) {
              process.nextTick(() => {
                res.emit('data', Buffer.from(body));
                
                // Always end the response
                process.nextTick(() => {
                  res.emit('end');
                });
              });
            } else {
              // Just end immediately if no body
              process.nextTick(() => {
                res.emit('end');
              });
            }
          }).catch(error => {
            interceptor._debug(`Error in direct https.get: ${error.message}`);
            req.emit('error', error);
          });
        });
        
        return req;
      };
      
      // For the full request method, use our more complex handler
      http.request = function(url, options, callback) {
        return interceptor._handleHttpRequest('http_request', url, options, callback);
      };
      
      https.request = function(url, options, callback) {
        return interceptor._handleHttpRequest('https_request', url, options, callback);
      };
      
      // If globalThis is available, try to intercept there as well for maximum coverage
      if (typeof globalThis !== 'undefined') {
        if (globalThis.http) {
          globalThis.http.get = http.get;
          globalThis.http.request = http.request;
        }
        if (globalThis.https) {
          globalThis.https.get = https.get;
          globalThis.https.request = https.request;
        }
      }
      
      // Override global require if it exists (for CommonJS)
      if (typeof require === 'function' && typeof require.cache === 'object') {
        const httpPath = require.resolve('http');
        const httpsPath = require.resolve('https');
        
        if (require.cache[httpPath]) {
          require.cache[httpPath].exports.get = http.get;
          require.cache[httpPath].exports.request = http.request;
        }
        
        if (require.cache[httpsPath]) {
          require.cache[httpsPath].exports.get = https.get;
          require.cache[httpsPath].exports.request = https.request;
        }
      }
      
      // Mark these events as implemented
      this.implementedEvents.push('http_request', 'https_request');
      
      this._debug('HTTP and HTTPS modules successfully intercepted');
    } catch (e) {
      this._debug(`Error intercepting HTTP and HTTPS modules: ${e.message}`);
      throw e;
    }
  }
  
  /**
   * Intercept fetch operations
   * @private
   */
  _interceptFetch() {
    // Check if fetch is available
    const hasFetch = typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function';
    
    if (hasFetch) {
      // Store original fetch
      this.originalImplementations.fetch = globalThis.fetch;
      
      // Intercept fetch
      const interceptor = this; // Save reference for closure
      globalThis.fetch = async function(url, options = {}) {
        const urlString = url instanceof URL ? url.toString() : url;
        interceptor._debug(`Intercepted fetch: ${urlString}`);
        
        try {
          const response = await interceptor.sendIntercept('fetch', {
            url: urlString,
            options
          });
          
          // Detect if this is a "no bridge" response
          const isBridgeMissing = response.headers && response.headers['x-no-bridge'] === 'true';
          
          if (isBridgeMissing) {
            interceptor._debug('No bridge connected for fetch request, using no-bridge response');
          }
          
          // Create a custom response if the bridge doesn't provide one
          const customResponse = {
            statusCode: 200,
            headers: {
              'content-type': 'application/json',
              'x-intercepted-by': 'NodeInterceptor',
              'x-interception-type': 'fetch',
              'x-intercepted-url': urlString,
              'x-intercepted-time': new Date().toISOString(),
              'server': 'NodeInterceptor/1.0'
            },
            body: JSON.stringify({
              message: 'This request was intercepted by NodeInterceptor',
              intercepted: true,
              originalUrl: urlString,
              method: options.method || 'GET',
              requestHeaders: options.headers || {},
              timestamp: Date.now(),
              interceptionType: 'fetch'
            }, null, 2)
          };
          
          // Use bridge response if available, otherwise use our custom response
          const finalResponse = response || customResponse;
          
          // Convert headers object to Headers instance
          const responseHeaders = new Headers();
          Object.entries(finalResponse.headers || {}).forEach(([key, value]) => {
            responseHeaders.append(key, value);
          });
          
          // Create a fake response
          return {
            ok: (finalResponse.statusCode >= 200 && finalResponse.statusCode < 300),
            status: finalResponse.statusCode,
            statusText: finalResponse.statusCode === 200 ? 'OK' : (isBridgeMissing ? 'Service Unavailable' : 'Intercepted'),
            headers: responseHeaders,
            text: () => Promise.resolve(finalResponse.body || ''),
            json: () => Promise.resolve(
              typeof finalResponse.body === 'string' 
              ? JSON.parse(finalResponse.body || '{}') 
              : finalResponse.body || {}
            ),
            arrayBuffer: () => Promise.resolve(new TextEncoder().encode(finalResponse.body || '').buffer),
            blob: () => Promise.resolve(new Blob([finalResponse.body || ''])),
            formData: () => {
              throw new Error('formData() is not implemented in intercepted fetch');
            },
            clone: function() {
              return this;
            }
          };
        } catch (error) {
          interceptor._debug(`Error intercepting fetch: ${error.message}`);
          throw new Error(`Intercepted fetch error: ${error.message}`);
        }
      };
      
      this.implementedEvents.push('fetch');
    } else {
      this._debug('fetch not available, skipping interception');
    }
  }
  
  /**
   * Intercept network connections via the net module
   * @private
   */
  _interceptNet() {
    this._debug('Intercepting net module');
    
    try {
      // Ensure the module is loaded
      const net = modules.net;
      
      if (!net) {
        this._debug('Net module not available, skipping interception');
        return;
      }
      
      // Store original methods
      this.originalImplementations.net = {
        createConnection: net.createConnection,
        connect: net.connect
      };
      
      // Intercept net methods
      const interceptor = this;
      
      // Create intercepted network connection
      function interceptedCreateConnection(...args) {
        const options = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
        const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
        
        interceptor._debug(`Intercepted net.createConnection to ${options.host}:${options.port}`);
        
        // Create a fake socket
        const fakeSocket = new net.Socket();
        
        // Send the intercepted connection request
        interceptor.sendIntercept('net_connect', {
          host: options.host,
          port: options.port,
          options
        })
        .then(response => {
          // If successful, emit 'connect' event
          if (callback) {
            callback(fakeSocket);
          }
          process.nextTick(() => fakeSocket.emit('connect'));
        })
        .catch(error => {
          // If error, emit 'error' event
          process.nextTick(() => fakeSocket.emit('error', error));
        });
        
        return fakeSocket;
      }
      
      // Replace the methods in the original module
      net.createConnection = interceptedCreateConnection;
      net.connect = interceptedCreateConnection; // Alias
      
      // If globalThis is available, try to intercept there as well
      if (typeof globalThis !== 'undefined' && globalThis.net) {
        globalThis.net.createConnection = interceptedCreateConnection;
        globalThis.net.connect = interceptedCreateConnection;
      }
      
      // Mark these events as implemented
      this.implementedEvents.push('net_connect');
      
      this._debug('Net module successfully intercepted');
    } catch (e) {
      this._debug(`Error intercepting net module: ${e.message}`);
      throw e;
    }
  }
  
  /**
   * Intercept DNS lookups
   * @private
   */
  _interceptDns() {
    this._debug('Intercepting DNS lookups');
    
    try {
      // Ensure the module is loaded
      const dns = modules.dns;
      
      if (!dns) {
        this._debug('DNS module not available, skipping interception');
        return;
      }
      
      // Store original methods
      this.originalImplementations.dns = {
        lookup: dns.lookup,
        resolve: dns.resolve,
        resolve4: dns.resolve4,
        resolve6: dns.resolve6
      };
      
      // Intercept DNS methods
      const interceptor = this;
      
      // Create intercepted DNS lookup
      function interceptedLookup(hostname, options, callback) {
        // Normalize arguments
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        
        interceptor._debug(`Intercepted dns.lookup for ${hostname}`);
        
        // Send the intercepted DNS lookup
        interceptor.sendIntercept('dns_lookup', {
          hostname,
          options
        })
        .then(response => {
          if (typeof callback === 'function') {
            // If the response provides an address, use it
            if (response.success === false) {
              const error = new Error(response.error || 'DNS lookup failed');
              error.code = 'ENOTFOUND';
              callback(error);
            } else {
              const address = response.address || '0.0.0.0';
              const family = response.family || 4;
              callback(null, address, family);
            }
          }
        })
        .catch(error => {
          if (typeof callback === 'function') {
            callback(error);
          }
        });
      }
      
      // Replace the methods in the original module
      dns.lookup = interceptedLookup;
      
      // Simplistic implementations for other DNS functions
      dns.resolve = (hostname, callback) => {
        interceptedLookup(hostname, (err, address) => {
          if (err) {
            callback(err);
          } else {
            callback(null, [address]);
          }
        });
      };
      
      dns.resolve4 = dns.resolve;
      dns.resolve6 = (hostname, callback) => {
        interceptedLookup(hostname, { family: 6 }, (err, address) => {
          if (err) {
            callback(err);
          } else {
            callback(null, [address]);
          }
        });
      };
      
      // If globalThis is available, try to intercept there as well
      if (typeof globalThis !== 'undefined' && globalThis.dns) {
        globalThis.dns.lookup = interceptedLookup;
        globalThis.dns.resolve = dns.resolve;
        globalThis.dns.resolve4 = dns.resolve4;
        globalThis.dns.resolve6 = dns.resolve6;
      }
      
      // Mark these events as implemented
      this.implementedEvents.push('dns_lookup');
      
      this._debug('DNS module successfully intercepted');
    } catch (e) {
      this._debug(`Error intercepting DNS module: ${e.message}`);
      throw e;
    }
  }
  
  /**
   * Intercept child process executions
   * @private
   */
  _interceptChildProcess() {
    this._debug('Intercepting child process executions');
    
    try {
      // Ensure the module is loaded
      const cp = modules.childProcess;
      
      if (!cp) {
        this._debug('Child process module not available, skipping interception');
        return;
      }
      
      // Store original methods
      this.originalImplementations.childProcess = {
        spawn: cp.spawn,
        exec: cp.exec,
        execFile: cp.execFile,
        fork: cp.fork
      };
      
      // Intercept child process methods
      const interceptor = this;
      
      // Handle spawn intercept
      cp.spawn = function(command, args, options) {
        interceptor._debug(`Intercepted spawn: ${command} ${args ? args.join(' ') : ''}`);
        
        // Create a fake event emitter to mimic ChildProcess
        const EventEmitter = require('events');
        const fakeProc = new EventEmitter();
        
        // Set up standard methods and properties
        fakeProc.pid = Math.floor(Math.random() * 10000) + 1000;
        fakeProc.connected = false;
        fakeProc.killed = false;
        fakeProc.exitCode = null;
        fakeProc.signalCode = null;
        
        // Setup standard streams
        fakeProc.stdin = new EventEmitter();
        fakeProc.stdin.write = () => true;
        fakeProc.stdin.end = () => {};
        
        fakeProc.stdout = new EventEmitter();
        fakeProc.stdout.pipe = () => fakeProc.stdout;
        
        fakeProc.stderr = new EventEmitter();
        fakeProc.stderr.pipe = () => fakeProc.stderr;
        
        // Methods
        fakeProc.kill = () => {
          fakeProc.killed = true;
          return true;
        };
        
        fakeProc.disconnect = () => {
          fakeProc.connected = false;
        };
        
        // Send the intercepted spawn
        interceptor.sendIntercept('spawn', {
          command,
          args,
          options
        })
        .then(response => {
          // Process exit code and output 
          const exitCode = response.exitCode || 0;
          const stdout = response.stdout || '';
          const stderr = response.stderr || '';
          
          // Emit stdout data
          if (stdout) {
            fakeProc.stdout.emit('data', Buffer.from(stdout));
          }
          
          // Emit stderr data
          if (stderr) {
            fakeProc.stderr.emit('data', Buffer.from(stderr));
          }
          
          // Emit close and exit events
          process.nextTick(() => {
            fakeProc.exitCode = exitCode;
            fakeProc.emit('exit', exitCode, null);
            fakeProc.emit('close', exitCode, null);
          });
        })
        .catch(error => {
          // Emit error and exit with code 1
          process.nextTick(() => {
            fakeProc.emit('error', error);
            fakeProc.exitCode = 1;
            fakeProc.emit('exit', 1, null);
            fakeProc.emit('close', 1, null);
          });
        });
        
        return fakeProc;
      };
      
      // Handle exec intercept (uses spawn internally)
      cp.exec = function(command, options, callback) {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        
        interceptor._debug(`Intercepted exec: ${command}`);
        
        // Convert command to spawn format
        const cmdParts = command.split(' ');
        const cmd = cmdParts[0];
        const cmdArgs = cmdParts.slice(1);
        
        // Use spawn for the intercepted command
        const proc = cp.spawn(cmd, cmdArgs, options);
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        proc.on('close', (code) => {
          if (typeof callback === 'function') {
            if (code !== 0) {
              const error = new Error(`Command failed: ${command}`);
              error.code = code;
              error.stdout = stdout;
              error.stderr = stderr;
              callback(error, stdout, stderr);
            } else {
              callback(null, stdout, stderr);
            }
          }
        });
        
        proc.on('error', (err) => {
          if (typeof callback === 'function') {
            callback(err, '', '');
          }
        });
        
        return proc;
      };
      
      // Handle execFile (similar to exec)
      cp.execFile = function(file, args, options, callback) {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        
        if (Array.isArray(args) && args.length > 0) {
          return cp.exec(`${file} ${args.join(' ')}`, options, callback);
        } else {
          return cp.exec(file, options, callback);
        }
      };
      
      // Handle fork (simplified implementation)
      cp.fork = function(modulePath, args, options) {
        interceptor._debug(`Intercepted fork: ${modulePath}`);
        
        // Use spawn to create the process
        const nodeExec = process.execPath;
        return cp.spawn(nodeExec, [modulePath].concat(args || []), options);
      };
      
      // If globalThis is available, try to intercept there as well
      if (typeof globalThis !== 'undefined') {
        if (globalThis.spawn) {
          globalThis.spawn = cp.spawn;
        }
        if (globalThis.exec) {
          globalThis.exec = cp.exec;
        }
        if (globalThis.execFile) {
          globalThis.execFile = cp.execFile;
        }
        if (globalThis.fork) {
          globalThis.fork = cp.fork;
        }
      }
      
      // Mark these events as implemented
      this.implementedEvents.push('spawn', 'exec');
      
      this._debug('Child process module successfully intercepted');
    } catch (e) {
      this._debug(`Error intercepting child process module: ${e.message}`);
      throw e;
    }
  }
  
  /**
   * Intercept WebSocket connections
   * @private
   */
  _interceptWebSocket() {
    this._debug('Intercepting WebSocket connections');
    
    try {
      // The WebSocket module is optional, it might not be available
      const WebSocket = modules.WebSocket;
      
      if (!WebSocket) {
        this._debug('WebSocket module not available, skipping interception');
        return;
      }
      
      // Store original constructor
      this.originalImplementations.WebSocket = WebSocket;
      
      // Intercept WebSocket constructor
      const interceptor = this;
      
      // Create a proxy for the WebSocket constructor
      const InterceptedWebSocket = function(url, protocols, options) {
        interceptor._debug(`Intercepted WebSocket connection to ${url}`);
        
        // Create a fake event emitter to mimic WebSocket
        const EventEmitter = require('events');
        const fakeWs = new EventEmitter();
        
        // Set up standard properties
        fakeWs.url = url;
        fakeWs.readyState = 0; // CONNECTING
        fakeWs.protocol = '';
        fakeWs.extensions = '';
        fakeWs.bufferedAmount = 0;
        
        // Set up methods
        fakeWs.send = (data) => {
          interceptor._debug(`Intercepted WebSocket send: ${typeof data === 'string' ? data : '[binary data]'}`);
          return true;
        };
        
        fakeWs.close = (code, reason) => {
          fakeWs.readyState = 3; // CLOSED
          process.nextTick(() => {
            fakeWs.emit('close', code || 1000, reason || 'Connection closed by client');
          });
        };
        
        fakeWs.terminate = () => {
          fakeWs.readyState = 3; // CLOSED
          process.nextTick(() => {
            fakeWs.emit('close', 1006, 'Connection terminated');
          });
        };
        
        // Send the intercepted WebSocket connection
        interceptor.sendIntercept('websocket_connect', {
          url,
          protocols,
          options
        })
        .then(response => {
          if (response.success === false) {
            // Connection failed
            fakeWs.readyState = 3; // CLOSED
            process.nextTick(() => {
              fakeWs.emit('error', new Error(response.error || 'WebSocket connection failed'));
              fakeWs.emit('close', 1006, response.error || 'Connection failed');
            });
          } else {
            // Connection succeeded
            fakeWs.readyState = 1; // OPEN
            process.nextTick(() => {
              fakeWs.emit('open');
              
              // Send initial message if provided
              if (response.initialMessage) {
                fakeWs.emit('message', response.initialMessage);
              }
            });
          }
        })
        .catch(error => {
          fakeWs.readyState = 3; // CLOSED
          process.nextTick(() => {
            fakeWs.emit('error', error);
            fakeWs.emit('close', 1006, error.message);
          });
        });
        
        return fakeWs;
      };
      
      // Replace the WebSocket constructor
      modules.WebSocket = InterceptedWebSocket;
      
      // If globalThis is available, try to intercept there as well
      if (typeof globalThis !== 'undefined' && globalThis.WebSocket) {
        globalThis.WebSocket = InterceptedWebSocket;
      }
      
      // Mark this event as implemented
      this.implementedEvents.push('websocket_connect');
      
      this._debug('WebSocket module successfully intercepted');
    } catch (e) {
      this._debug(`Error intercepting WebSocket module: ${e.message}`);
      // Don't throw for WebSocket as it's optional
    }
  }
  
  /**
   * Intercept filesystem operations
   * @private
   */
  _interceptFs() {
    this._debug('Intercepting filesystem operations');
    
    try {
      // Ensure the module is loaded
      const fs = modules.fs;
      
      if (!fs) {
        this._debug('FS module not available, skipping interception');
        return;
      }
      
      // Store original methods
      this.originalImplementations.fs = {
        readFile: fs.readFile,
        readFileSync: fs.readFileSync,
        writeFile: fs.writeFile,
        writeFileSync: fs.writeFileSync,
        unlink: fs.unlink,
        unlinkSync: fs.unlinkSync,
        stat: fs.stat,
        statSync: fs.statSync
      };
      
      // Intercept fs methods
      const interceptor = this;
      
      // Intercept fs.readFile
      fs.readFile = function(path, options, callback) {
        // Normalize arguments
        if (typeof options === 'function') {
          callback = options;
          options = { encoding: null, flag: 'r' };
        } else if (typeof options === 'string') {
          options = { encoding: options, flag: 'r' };
        } else if (!options) {
          options = { encoding: null, flag: 'r' };
        }
        
        interceptor._debug(`Intercepted fs.readFile for ${path}`);
        
        // Send the intercepted file read
        interceptor.sendIntercept('fs_readFile', {
          path,
          options
        })
        .then(response => {
          if (typeof callback === 'function') {
            if (response.success === false) {
              const error = new Error(response.error || 'File not found');
              error.code = 'ENOENT';
              callback(error);
            } else {
              let data = response.data;
              if (options.encoding && typeof data === 'string') {
                // Already encoded as string due to options
              } else if (typeof data === 'string') {
                // Convert string to Buffer if no encoding specified
                data = Buffer.from(data, 'utf8');
              }
              callback(null, data);
            }
          }
        })
        .catch(error => {
          if (typeof callback === 'function') {
            callback(error);
          }
        });
      };
      
      // Intercept fs.writeFile
      fs.writeFile = function(path, data, options, callback) {
        // Normalize arguments
        if (typeof options === 'function') {
          callback = options;
          options = { encoding: 'utf8', mode: 0o666, flag: 'w' };
        } else if (typeof options === 'string') {
          options = { encoding: options, mode: 0o666, flag: 'w' };
        } else if (!options) {
          options = { encoding: 'utf8', mode: 0o666, flag: 'w' };
        }
        
        interceptor._debug(`Intercepted fs.writeFile for ${path}`);
        
        // Convert Buffer to string for transmission
        let dataStr = data;
        if (Buffer.isBuffer(data)) {
          dataStr = data.toString(options.encoding || 'utf8');
        }
        
        // Send the intercepted file write
        interceptor.sendIntercept('fs_writeFile', {
          path,
          data: dataStr,
          options
        })
        .then(response => {
          if (typeof callback === 'function') {
            if (response.success === false) {
              const error = new Error(response.error || 'Failed to write file');
              error.code = response.code || 'EPERM';
              callback(error);
            } else {
              callback(null);
            }
          }
        })
        .catch(error => {
          if (typeof callback === 'function') {
            callback(error);
          }
        });
      };
      
      // Intercept fs.unlink
      fs.unlink = function(path, callback) {
        interceptor._debug(`Intercepted fs.unlink for ${path}`);
        
        // Send the intercepted file delete
        interceptor.sendIntercept('fs_unlink', {
          path
        })
        .then(response => {
          if (typeof callback === 'function') {
            if (response.success === false) {
              const error = new Error(response.error || 'Failed to unlink file');
              error.code = response.code || 'EPERM';
              callback(error);
            } else {
              callback(null);
            }
          }
        })
        .catch(error => {
          if (typeof callback === 'function') {
            callback(error);
          }
        });
      };
      
      // Intercept fs.stat
      fs.stat = function(path, options, callback) {
        // Normalize arguments
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }
        
        interceptor._debug(`Intercepted fs.stat for ${path}`);
        
        // Send the intercepted file stat
        interceptor.sendIntercept('fs_stat', {
          path,
          options
        })
        .then(response => {
          if (typeof callback === 'function') {
            if (response.success === false) {
              const error = new Error(response.error || 'Failed to stat file');
              error.code = response.code || 'ENOENT';
              callback(error);
            } else {
              // Create a fake Stats object
              const stats = {
                isFile: () => response.isFile || true,
                isDirectory: () => response.isDirectory || false,
                isSymbolicLink: () => response.isSymbolicLink || false,
                size: response.size || 0,
                mtime: new Date(response.mtime || Date.now()),
                atime: new Date(response.atime || Date.now()),
                ctime: new Date(response.ctime || Date.now()),
                birthtime: new Date(response.birthtime || Date.now())
              };
              callback(null, stats);
            }
          }
        })
        .catch(error => {
          if (typeof callback === 'function') {
            callback(error);
          }
        });
      };
      
      // If globalThis is available, try to intercept there as well
      if (typeof globalThis !== 'undefined' && globalThis.fs) {
        globalThis.fs.readFile = fs.readFile;
        globalThis.fs.writeFile = fs.writeFile;
        globalThis.fs.unlink = fs.unlink;
        globalThis.fs.stat = fs.stat;
      }
      
      // Mark these events as implemented
      this.implementedEvents.push('fs_readFile', 'fs_writeFile', 'fs_unlink', 'fs_stat');
      
      this._debug('Filesystem operations successfully intercepted');
    } catch (e) {
      this._debug(`Error intercepting filesystem operations: ${e.message}`);
      throw e;
    }
  }
  
  /**
   * Send an intercepted call to the proxy
   * @param {string} type - The type of event being intercepted
   * @param {Object} payload - The details of the intercepted call
   * @returns {Promise<any>} The response from the proxy
   */
  async sendIntercept(type, payload) {
    this._debug(`Sending intercepted ${type} to proxy`);
    
    const requestUrl = payload && payload.url ? payload.url : 'unknown URL';

    if (this.options.bridge) {
      this._debug(`Bridge isConnected() called: ${this.options.bridge.isConnected()} (connected: ${this.options.bridge.isConnected ? this.options.bridge.isConnected() : false} bridgeId: ${this.options.bridge.getBridgeId ? this.options.bridge.getBridgeId() : null} )`);
      
      // If it's a NullBridge (or any disconnected bridge) and a network request, make it fail hard.
      if ((this.options.bridge.constructor.name === 'NullBridge' || !this.options.bridge.isConnected()) &&
          (type === 'http_request' || type === 'https_request' || type === 'fetch')) {
        this._debug(`NullBridge or disconnected bridge detected for network request ${type} to ${requestUrl}. Aborting.`);
        return Promise.reject(new Error(`No active bridge: ${type} to ${requestUrl} aborted.`));
      }

      try {
        const response = await this.options.bridge.handleInterceptedCall(type, payload);
        
        if (response !== null) {
          this._debug(`Bridge returned response for ${type}`);
          return response;
        }
        
        this._debug(`Bridge returned null for ${type}, using default response`);
      } catch (error) {
        this._debug(`Bridge error handling ${type}: ${error.message}`);
        // If the bridge itself threw an error during handling, reject with that error.
        return Promise.reject(error);
      }
    }
    
    this._debug(`No bridge available or bridge did not handle ${type}, returning default failure response`);
    
    switch (type) {
      case 'http_request':
      case 'https_request':
      case 'fetch':
        this._debug(`Defaulting to failure for ${type} request to ${requestUrl} as no bridge handled it.`);
        return Promise.reject(new Error(`No bridge available to handle ${type} to ${requestUrl}.`));
      
      case 'net_connect':
        return {
          success: false,
          error: 'No bridge connected',
          message: 'Network connection attempt was intercepted, but no bridge is connected'
        };
      
      case 'dns_lookup':
        return {
          success: false,
          error: 'No bridge connected',
          message: 'DNS lookup was intercepted, but no bridge is connected',
          addresses: []
        };
      
      case 'fs_readFile':
      case 'fs_writeFile':
      case 'fs_unlink':
      case 'fs_stat':
        return {
          success: false,
          error: 'No bridge connected',
          message: 'File system operation was intercepted, but no bridge is connected'
        };
      
      case 'spawn':
      case 'exec':
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'Process execution was intercepted, but no bridge is connected'
        };
      
      case 'websocket_connect':
        return {
          success: false,
          error: 'No bridge connected',
          message: 'WebSocket connection was intercepted, but no bridge is connected'
        };
      
      default:
        return {
          success: false,
          error: 'No bridge connected',
          message: `Unknown operation type "${type}" was intercepted, but no bridge is connected`
        };
    }
  }
  
  /**
   * Disable all hooks and restore original functionality
   * @returns {Promise<boolean>} True if all hooks were successfully reset
   */
  async resetHooks() {
    this._debug('Resetting hooks and restoring original implementations');
    
    // Ensure modules are loaded before trying to reset hooks
    await this._modulesLoaded;
    
    if (this.isESM) {
      // In ESM mode, we need to handle reset differently
      // We don't directly modify the modules, so there's less to reset
      
      // Reset fetch if we intercepted it
      if (this.originalImplementations.fetch && typeof globalThis !== 'undefined') {
        globalThis.fetch = this.originalImplementations.fetch;
      }
      
      // Reset global import if we intercepted it
      if (this.originalImplementations.import && typeof globalThis !== 'undefined') {
        globalThis.import = this.originalImplementations.import;
      }
    } else {
      // Traditional reset for CommonJS
      // Restore filesystem operations
      if (this.originalImplementations.fs) {
        Object.assign(modules.fs, this.originalImplementations.fs);
      }
      
      // Restore HTTP/HTTPS operations
      if (this.originalImplementations.http) {
        Object.assign(modules.http, this.originalImplementations.http);
      }
      if (this.originalImplementations.https) {
        Object.assign(modules.https, this.originalImplementations.https);
      }
      
      // Restore net operations
      if (this.originalImplementations.net) {
        Object.assign(modules.net, this.originalImplementations.net);
      }
      
      // Restore DNS operations
      if (this.originalImplementations.dns) {
        Object.assign(modules.dns, this.originalImplementations.dns);
      }
      
      // Restore child process operations
      if (this.originalImplementations.childProcess) {
        if (modules.childProcess) {
          modules.childProcess.spawn = this.originalImplementations.childProcess.spawn;
          modules.childProcess.exec = this.originalImplementations.childProcess.exec;
        }
        
        // Restore global functions if they existed
        if (typeof global !== 'undefined') {
          if (this.originalImplementations.globalSpawn) {
            global.spawn = this.originalImplementations.globalSpawn;
          }
          if (this.originalImplementations.globalExec) {
            global.exec = this.originalImplementations.globalExec;
          }
        }
      }
      
      // Restore WebSocket
      if (this.originalImplementations.WebSocket && typeof modules.WebSocket !== 'undefined') {
        if (typeof global !== 'undefined') {
          global.WebSocket = this.originalImplementations.WebSocket;
        } else if (typeof globalThis !== 'undefined') {
          globalThis.WebSocket = this.originalImplementations.WebSocket;
        }
      }
    }
    
    // Clear all implemented events
    this.implementedEvents = [];
    
    this._debug('All hooks successfully reset');
    return true;
  }
  
  // Static reference for access in constructor interceptions
  static instance = null;

  /**
   * Centralized handler for HTTP/HTTPS requests after interception.
   * This method sends the request details to the bridge and simulates
   * a Node.js IncomingMessage stream with the bridge's response.
   * 
   * @param {string} type - 'http_request' or 'https_request'
   * @param {string} urlString - The full URL
   * @param {object} options - Original request options
   * @param {string|Buffer|null} requestBody - The body of the outgoing request
   * @returns {Promise<{response: Readable, rawBridgeResponse: object}>} Resolves with a mock IncomingMessage and raw bridge data.
   * @private
   */
  async _handleHttpRequest(type, urlString, options, requestBody = null) {
    const bridge = this.getBridge();
    if (!bridge) {
      this._debug('Bridge not available for HTTP request');
      return Promise.reject(new Error('Bridge not available'));
    }

    // Prepare payload for the bridge
    const payload = {
      url: urlString,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: requestBody ? (Buffer.isBuffer(requestBody) ? requestBody.toString('base64') : requestBody) : null,
      // Indicate if the body sent to bridge is base64 (for bridge to know)
      isRequestBodyBase64: Buffer.isBuffer(requestBody)
    };

    this._debug(`Sending ${type} to bridge:`, payload.method, payload.url);

    return this.sendIntercept(type, payload)
      .then(async bridgeResponse => {
        this._debug(`Bridge response for ${type} ${payload.url}:`, bridgeResponse.statusCode, bridgeResponse.headers);

        const PassThrough = modules.stream.PassThrough;
        const responseStream = new PassThrough();

        if (bridgeResponse.body !== undefined && bridgeResponse.body !== null) {
          let bodyData = bridgeResponse.body;
          // Check if the bridge indicates the response body is base64 encoded
          if (bridgeResponse.headers && (bridgeResponse.headers['content-encoding'] === 'base64' || bridgeResponse.isResponseBodyBase64)) {
            this._debug('Decoding base64 response body from bridge');
            bodyData = Buffer.from(bodyData, 'base64');
          } else if (typeof bodyData === 'object') {
            // If the bridge sent a parsed JSON object (not ideal, string is better), stringify it.
            this._debug('Stringifying JSON object response body from bridge');
            bodyData = JSON.stringify(bodyData);
          } else if (typeof bodyData !== 'string' && !Buffer.isBuffer(bodyData)) {
            this._debug('Converting non-string/buffer response body to string');
            bodyData = String(bodyData); // Ensure it's a string or buffer for push
          }
          responseStream.push(bodyData);
        }
        responseStream.push(null); // End the stream

        // Attach properties to the stream to make it look like an IncomingMessage
        responseStream.statusCode = parseInt(bridgeResponse.statusCode, 10) || 500;
        responseStream.headers = bridgeResponse.headers || {};
        responseStream.httpVersion = bridgeResponse.httpVersion || '1.1';
        // Use STATUS_CODES from the http module, ensure http module is loaded
        const httpModule = modules.http || (this.isESM ? (await import('http')).default : require('http'));
        responseStream.statusMessage = bridgeResponse.statusMessage || httpModule.STATUS_CODES[responseStream.statusCode] || '';

        // Make it more like an IncomingMessage for event listeners
        responseStream.socket = null; // Mock socket
        responseStream.connection = null; // Mock connection
        responseStream.method = payload.method; // For context, though not on IncomingMessage
        responseStream.url = payload.url; // For context

        return {
          response: responseStream, // This is the IncomingMessage-like stream
          rawBridgeResponse: bridgeResponse // Original data from bridge for debugging or other uses
        };
      })
      .catch(error => {
        this._debug(`Error in _handleHttpRequest for ${type} ${payload.url}:`, error);
        // Ensure the error is re-thrown so the caller (e.g., proxiedRequest) can emit it.
        throw error;
      });
  }
}

// Add CommonJS exports for compatibility with require() in bundled scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NodeInterceptor };
} 