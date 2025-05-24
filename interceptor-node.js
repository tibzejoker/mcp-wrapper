(() => {
  'use strict';

  const logPrefix = '[INTERCEPTOR]';

  function log(moduleName, functionName, message) {
    console.error(`${logPrefix}:${moduleName}.${functionName}] ${message}`);
  }

  function logError(moduleName, functionName, error, customMessage = '') {
    const baseMessage = `${logPrefix}:ERROR:${moduleName}.${functionName}]`;
    const errorMessage = customMessage ? `${customMessage}: ${error.message}` : `Error: ${error.message}`;
    console.error(`${baseMessage} ${errorMessage}`);
  }

  // --- Patching for 'fs' module ---
  try {
    const fs = require('fs');
    const originalFsFunctions = {};

    const fsFunctionsToPatch = [
      // Async functions
      'readFile', 'writeFile', 'appendFile',
      'open', 'close', 'read', 'write', // 'read' and 'write' are more complex, might need special handling
      'access', 'stat', 'lstat', 'fstat',
      'mkdir', 'rmdir', 'readdir',
      'unlink', 'rename', 'exists',

      // Sync functions
      'readFileSync', 'writeFileSync', 'appendFileSync',
      'openSync', 'closeSync', 'readSync', 'writeSync', // 'readSync' and 'writeSync' are more complex
      'accessSync', 'statSync', 'lstatSync', 'fstatSync',
      'mkdirSync', 'rmdirSync', 'readdirSync',
      'unlinkSync', 'renameSync', 'existsSync'
    ];

    fsFunctionsToPatch.forEach(funcName => {
      if (Object.prototype.hasOwnProperty.call(fs, funcName)) {
        originalFsFunctions[funcName] = fs[funcName];

        fs[funcName] = function(...args) {
          let logMessage = `Called`;
          if (args.length > 0) {
            const firstArg = args[0];
            if (typeof firstArg === 'string' || Buffer.isBuffer(firstArg)) {
              logMessage += ` with path/fd: ${firstArg}`;
            }
            if (funcName.toLowerCase().includes('write') || funcName.toLowerCase().includes('append')) {
              if (args.length > 1 && (typeof args[1] === 'string' || Buffer.isBuffer(args[1]))) {
                logMessage += `, data length: ${args[1].length}`;
              }
            }
          }
          log('fs', funcName, logMessage);

          try {
            const result = originalFsFunctions[funcName].apply(this, args);
            
            // For async functions that return a promise (none in this core list, but good practice)
            if (result && typeof result.then === 'function') {
              return result.then(res => {
                log('fs', funcName, `Successfully completed for ${args[0]}`);
                return res;
              }).catch(err => {
                logError('fs', funcName, err, `Error during async operation for ${args[0]}`);
                throw err;
              });
            }
            
            // For sync functions or callback-based async, log success if no immediate error
            // Specific logging for callback results would need to wrap the callback.
            if (!funcName.endsWith('Sync') && typeof args[args.length - 1] === 'function') {
              const originalCallback = args[args.length - 1];
              args[args.length - 1] = function(err, ...callbackArgs) {
                if (err) {
                  logError('fs', funcName, err, `Error in callback for ${args[0]}`);
                } else {
                  log('fs', funcName, `Successfully completed via callback for ${args[0]}`);
                }
                return originalCallback.apply(this, [err, ...callbackArgs]);
              };
            } else if (funcName.endsWith('Sync')) {
                 log('fs', funcName, `Successfully completed for ${args[0]}`);
            }
            // For exists/existsSync, log the result directly if it's a boolean
            if ((funcName === 'exists' || funcName === 'existsSync') && typeof result === 'boolean') {
                log('fs', funcName, `Result for ${args[0]}: ${result}`);
            }


            return result;
          } catch (e) {
            logError('fs', funcName, e, `Error during call for ${args[0]}`);
            throw e;
          }
        };
      }
    });
    log('fs', 'patching', 'fs module patched.');
  } catch (e) {
    console.error(`${logPrefix}:ERROR:fs] Failed to patch fs module: ${e.message}`);
  }

  // --- Patching for 'net' module ---
  try {
    const net = require('net');
    const originalNetFunctions = {};

    // Patch net.connect
    if (Object.prototype.hasOwnProperty.call(net, 'connect')) {
      originalNetFunctions.connect = net.connect;
      net.connect = function(...args) {
        let logMessage = 'Called with args: ';
        try {
            // Standard (options, cb) or (port, host, cb)
            if (typeof args[0] === 'object' && args[0] !== null) { // options object
                logMessage += `options=${JSON.stringify(args[0])}`;
            } else if (typeof args[0] === 'number') { // port, [host], [cb]
                logMessage += `port=${args[0]}`;
                if (typeof args[1] === 'string') {
                    logMessage += `, host=${args[1]}`;
                }
            } else { // path, [cb]
                 logMessage += `path=${args[0]}`;
            }
        } catch(e){ /* Ignore logging error for args */ }
        log('net', 'connect', logMessage);
        try {
          const socket = originalNetFunctions.connect.apply(this, args);
          socket.on('error', (err) => {
            logError('net', 'connect', err, `Error on socket for ${logMessage}`);
          });
          log('net', 'connect', `Connection attempt initiated for ${logMessage}`);
          return socket;
        } catch (e) {
          logError('net', 'connect', e, `Error during call for ${logMessage}`);
          throw e;
        }
      };
    }

    // Patch net.createConnection
    if (Object.prototype.hasOwnProperty.call(net, 'createConnection')) {
      originalNetFunctions.createConnection = net.createConnection;
      net.createConnection = function(...args) {
        let logMessage = 'Called with args: ';
         try {
            if (typeof args[0] === 'object' && args[0] !== null) { // options object
                logMessage += `options=${JSON.stringify(args[0])}`;
            } else if (typeof args[0] === 'number') { // port, [host]
                logMessage += `port=${args[0]}`;
                if (typeof args[1] === 'string') {
                    logMessage += `, host=${args[1]}`;
                }
            } else { // path
                 logMessage += `path=${args[0]}`;
            }
        } catch(e){ /* Ignore logging error for args */ }
        log('net', 'createConnection', logMessage);
        try {
          const socket = originalNetFunctions.createConnection.apply(this, args);
          socket.on('error', (err) => {
            logError('net', 'createConnection', err, `Error on socket for ${logMessage}`);
          });
          log('net', 'createConnection', `Connection attempt initiated for ${logMessage}`);
          return socket;
        } catch (e) {
          logError('net', 'createConnection', e, `Error during call for ${logMessage}`);
          throw e;
        }
      };
    }

    // Patch Server.prototype.listen
    if (net.Server && net.Server.prototype && Object.prototype.hasOwnProperty.call(net.Server.prototype, 'listen')) {
      originalNetFunctions['Server.prototype.listen'] = net.Server.prototype.listen;
      net.Server.prototype.listen = function(...args) {
        let logMessage = 'Called with args: ';
        try {
            if (typeof args[0] === 'object' && args[0] !== null) { // options object or handle
                if(args[0].fd || args[0].path) { // handle or listen options object
                     logMessage += `options=${JSON.stringify(args[0])}`;
                } else { // options object (port, host)
                     logMessage += `port=${args[0].port}, host=${args[0].host || '0.0.0.0'}`;
                }
            } else if (typeof args[0] === 'number' || typeof args[0] === 'string') { // port or path
                 logMessage += `${typeof args[0] === 'number' ? 'port' : 'path'}=${args[0]}`;
                 if (typeof args[1] === 'string' && typeof args[0] === 'number') { // host if port was first
                     logMessage += `, host=${args[1]}`;
                 }
            }
        } catch(e){ /* Ignore logging error for args */ }
        log('net.Server.prototype', 'listen', logMessage);
        try {
          const server = originalNetFunctions['Server.prototype.listen'].apply(this, args);
          this.on('error', (err) => { // 'this' is the server instance
            logError('net.Server.prototype', 'listen', err, `Error on server for ${logMessage}`);
          });
          log('net.Server.prototype', 'listen', `Server listening attempt for ${logMessage}`);
          return server;
        } catch (e) {
          logError('net.Server.prototype', 'listen', e, `Error during call for ${logMessage}`);
          throw e;
        }
      };
    }
    log('net', 'patching', 'net module patched.');
  } catch (e) {
    console.error(`${logPrefix}:ERROR:net] Failed to patch net module: ${e.message}`);
  }


  // --- Patching for 'http' module ---
  try {
    const http = require('http');
    const originalHttpFunctions = {};

    // Patch http.request
    if (Object.prototype.hasOwnProperty.call(http, 'request')) {
      originalHttpFunctions.request = http.request;
      http.request = function(...args) {
        let logMessage = 'Called';
        const options = args[0];
        try {
            if (typeof options === 'string') { // URL string
                const url = new URL(options);
                logMessage += ` with URL: ${options} (method: GET, host: ${url.hostname}, path: ${url.pathname})`;
            } else if (options) { // Options object
                const method = options.method || 'GET';
                const host = options.hostname || options.host || 'localhost';
                const path = options.path || '/';
                logMessage += ` with options: (method: ${method}, host: ${host}, path: ${path})`;
            }
        } catch(e){ /* Ignore logging error for args */ }
        log('http', 'request', logMessage);
        try {
          const req = originalHttpFunctions.request.apply(this, args);
          req.on('error', (err) => {
            logError('http', 'request', err, `Error on ClientRequest for ${logMessage}`);
          });
          log('http', 'request', `ClientRequest created for ${logMessage}`);
          return req;
        } catch (e) {
          logError('http', 'request', e, `Error during call for ${logMessage}`);
          throw e;
        }
      };
    }

    // Patch http.get
    if (Object.prototype.hasOwnProperty.call(http, 'get')) {
      originalHttpFunctions.get = http.get;
      http.get = function(...args) {
        let logMessage = 'Called';
        const options = args[0];
         try {
            if (typeof options === 'string') { // URL string
                const url = new URL(options);
                logMessage += ` with URL: ${options} (host: ${url.hostname}, path: ${url.pathname})`;
            } else if (options) { // Options object
                const host = options.hostname || options.host || 'localhost';
                const path = options.path || '/';
                logMessage += ` with options: (host: ${host}, path: ${path})`;
            }
        } catch(e){ /* Ignore logging error for args */ }
        log('http', 'get', logMessage);
        try {
          const req = originalHttpFunctions.get.apply(this, args);
          req.on('error', (err) => {
            logError('http', 'get', err, `Error on ClientRequest for ${logMessage}`);
          });
          log('http', 'get', `ClientRequest created for ${logMessage}`);
          return req;
        } catch (e) {
          logError('http', 'get', e, `Error during call for ${logMessage}`);
          throw e;
        }
      };
    }
    
    // Patch http.Server.prototype.listen
    if (http.Server && http.Server.prototype && Object.prototype.hasOwnProperty.call(http.Server.prototype, 'listen')) {
      originalHttpFunctions['Server.prototype.listen'] = http.Server.prototype.listen;
      http.Server.prototype.listen = function(...args) {
        let logMessage = 'Called with args: ';
        try {
             if (typeof args[0] === 'object' && args[0] !== null) { // options object or handle
                if(args[0].fd || args[0].path) { // handle
                     logMessage += `handle/options=${JSON.stringify(args[0])}`;
                } else { // options object (port, host)
                     logMessage += `port=${args[0].port}, host=${args[0].host || '0.0.0.0'}`;
                }
            } else if (typeof args[0] === 'number' || typeof args[0] === 'string') { // port or path
                 logMessage += `${typeof args[0] === 'number' ? 'port' : 'path'}=${args[0]}`;
                 if (typeof args[1] === 'string' && typeof args[0] === 'number') { // host if port was first
                     logMessage += `, host=${args[1]}`;
                 }
            }
        } catch(e){ /* Ignore logging error for args */ }
        log('http.Server.prototype', 'listen', logMessage);
        try {
          const server = originalHttpFunctions['Server.prototype.listen'].apply(this, args);
           this.on('error', (err) => { // 'this' is the server instance
            logError('http.Server.prototype', 'listen', err, `Error on server for ${logMessage}`);
          });
          log('http.Server.prototype', 'listen', `Server listening attempt for ${logMessage}`);
          return server;
        } catch (e) {
          logError('http.Server.prototype', 'listen', e, `Error during call for ${logMessage}`);
          throw e;
        }
      };
    }
    log('http', 'patching', 'http module patched.');
  } catch (e) {
    console.error(`${logPrefix}:ERROR:http] Failed to patch http module: ${e.message}`);
  }

  // --- Patching for 'https' module ---
  try {
    const https = require('https');
    const originalHttpsFunctions = {};

    // Patch https.request
    if (Object.prototype.hasOwnProperty.call(https, 'request')) {
      originalHttpsFunctions.request = https.request;
      https.request = function(...args) {
        let logMessage = 'Called';
        const options = args[0];
        try {
            if (typeof options === 'string') { // URL string
                const url = new URL(options);
                logMessage += ` with URL: ${options} (method: GET, host: ${url.hostname}, path: ${url.pathname})`;
            } else if (options) { // Options object
                const method = options.method || 'GET';
                const host = options.hostname || options.host || 'localhost';
                const path = options.path || '/';
                logMessage += ` with options: (method: ${method}, host: ${host}, path: ${path})`;
            }
        } catch(e){ /* Ignore logging error for args */ }
        log('https', 'request', logMessage);
        try {
          const req = originalHttpsFunctions.request.apply(this, args);
          req.on('error', (err) => {
            logError('https', 'request', err, `Error on ClientRequest for ${logMessage}`);
          });
          log('https', 'request', `ClientRequest created for ${logMessage}`);
          return req;
        } catch (e) {
          logError('https', 'request', e, `Error during call for ${logMessage}`);
          throw e;
        }
      };
    }

    // Patch https.get
    if (Object.prototype.hasOwnProperty.call(https, 'get')) {
      originalHttpsFunctions.get = https.get;
      https.get = function(...args) {
        let logMessage = 'Called';
        const options = args[0];
        try {
            if (typeof options === 'string') { // URL string
                const url = new URL(options);
                logMessage += ` with URL: ${options} (host: ${url.hostname}, path: ${url.pathname})`;
            } else if (options) { // Options object
                const host = options.hostname || options.host || 'localhost';
                const path = options.path || '/';
                logMessage += ` with options: (host: ${host}, path: ${path})`;
            }
        } catch(e){ /* Ignore logging error for args */ }
        log('https', 'get', logMessage);
        try {
          const req = originalHttpsFunctions.get.apply(this, args);
          req.on('error', (err) => {
            logError('https', 'get', err, `Error on ClientRequest for ${logMessage}`);
          });
          log('https', 'get', `ClientRequest created for ${logMessage}`);
          return req;
        } catch (e) {
          logError('https', 'get', e, `Error during call for ${logMessage}`);
          throw e;
        }
      };
    }

    // Patch https.Server.prototype.listen
    // Note: https.Server inherits from tls.Server, which inherits from net.Server.
    // If net.Server.prototype.listen is already patched, this might double-patch or cause issues.
    // However, explicit patching ensures it's covered if `require('https').Server` is used directly.
    // We need to be careful about the order or ensure idempotency if possible.
    // For now, we assume distinct prototype chains or that patching the more specific one is desired.
    if (https.Server && https.Server.prototype && Object.prototype.hasOwnProperty.call(https.Server.prototype, 'listen')) {
        // Check if it's the same function as net.Server.prototype.listen to avoid double patching if possible
        // This check might not be perfectly robust if there are intermediate prototypes.
        const netServerListen = require('net').Server.prototype.listen;
        if (https.Server.prototype.listen !== netServerListen || !originalNetFunctions['Server.prototype.listen']) {
            originalHttpsFunctions['Server.prototype.listen'] = https.Server.prototype.listen;
            https.Server.prototype.listen = function(...args) {
                let logMessage = 'Called with args: ';
                try {
                    if (typeof args[0] === 'object' && args[0] !== null) { // options object or handle
                        if(args[0].fd || args[0].path) { // handle
                             logMessage += `handle/options=${JSON.stringify(args[0])}`;
                        } else { // options object (port, host)
                             logMessage += `port=${args[0].port}, host=${args[0].host || '0.0.0.0'}`;
                        }
                    } else if (typeof args[0] === 'number' || typeof args[0] === 'string') { // port or path
                         logMessage += `${typeof args[0] === 'number' ? 'port' : 'path'}=${args[0]}`;
                         if (typeof args[1] === 'string' && typeof args[0] === 'number') { // host if port was first
                             logMessage += `, host=${args[1]}`;
                         }
                    }
                } catch(e){ /* Ignore logging error for args */ }
                log('https.Server.prototype', 'listen', logMessage);
                try {
                  const server = originalHttpsFunctions['Server.prototype.listen'].apply(this, args);
                  this.on('error', (err) => { // 'this' is the server instance
                    logError('https.Server.prototype', 'listen', err, `Error on server for ${logMessage}`);
                  });
                  log('https.Server.prototype', 'listen', `Server listening attempt for ${logMessage}`);
                  return server;
                } catch (e) {
                  logError('https.Server.prototype', 'listen', e, `Error during call for ${logMessage}`);
                  throw e;
                }
            };
        } else {
            log('https.Server.prototype', 'listen', 'Skipping patch, already patched by net.Server.prototype.listen');
        }
    }
    log('https', 'patching', 'https module patched.');
  } catch (e) {
    console.error(`${logPrefix}:ERROR:https] Failed to patch https module: ${e.message}`);
  }

  // --- Patching for 'child_process' module ---
  try {
    const childProcess = require('child_process');
    const originalChildProcessFunctions = {};

    const cpFunctionsToPatch = ['exec', 'execFile', 'spawn', 'fork'];

    cpFunctionsToPatch.forEach(funcName => {
      if (Object.prototype.hasOwnProperty.call(childProcess, funcName)) {
        originalChildProcessFunctions[funcName] = childProcess[funcName];

        childProcess[funcName] = function(...args) {
          let logMessage = `Called`;
          if (funcName === 'exec') {
            logMessage += ` with command: ${args[0]}`;
          } else if (funcName === 'execFile') {
            logMessage += ` with file: ${args[0]}`;
            if (args.length > 1 && Array.isArray(args[1])) {
              logMessage += `, args: ${JSON.stringify(args[1])}`;
            } else if (typeof args[1] === 'function') {
              // no args, only callback
            } else if (args.length > 1) {
                 logMessage += `, args (omitted): ${typeof args[1]}`; // options object or other
            }
          } else if (funcName === 'spawn') {
            logMessage += ` with command: ${args[0]}`;
            if (args.length > 1 && Array.isArray(args[1])) {
              logMessage += `, args: ${JSON.stringify(args[1])}`;
            }
          } else if (funcName === 'fork') {
            logMessage += ` with modulePath: ${args[0]}`;
            if (args.length > 1 && Array.isArray(args[1])) {
              logMessage += `, args: ${JSON.stringify(args[1])}`;
            }
          }
          log('child_process', funcName, logMessage);

          try {
            const result = originalChildProcessFunctions[funcName].apply(this, args);
            if (result && typeof result.on === 'function') { // ChildProcess objects
                result.on('error', (err) => {
                    logError('child_process', funcName, err, `Error on ChildProcess for ${logMessage}`);
                });
            }
            log('child_process', funcName, `Process action initiated for ${logMessage}`);
            return result;
          } catch (e) {
            logError('child_process', funcName, e, `Error during call for ${logMessage}`);
            throw e;
          }
        };
      }
    });
    log('child_process', 'patching', 'child_process module patched.');
  } catch (e) {
    console.error(`${logPrefix}:ERROR:child_process] Failed to patch child_process module: ${e.message}`);
  }

  console.error(`${logPrefix} Interceptor script loaded and modules patched.`);
})();
