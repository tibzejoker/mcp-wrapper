/**
 * NullBridge.js
 * 
 * Default implementation of a bridge that returns "no bridge connected" responses.
 * Used when no actual bridge is connected to the sandbox.
 */

export class NullBridge {
    constructor() {
        console.error('[NULL_BRIDGE] Created - all operations will return "no bridge" responses');
    }
    
    // Connection methods
    isConnected() { return false; }
    getBridgeId() { return null; }
    setBridgeId() { /* no-op */ return this; }
    setConnected() { /* no-op */ return this; }
    
    // Event handlers - all return this for chaining
    onFetch() { return this; }
    onConnect() { return this; }
    onDns() { return this; }
    onFileRead() { return this; }
    onFileWrite() { return this; }
    onFileDelete() { return this; }
    onFileExists() { return this; }
    onStdout() { return this; }
    onStderr() { return this; }
    onStdin() { return this; }
    onWebSocket() { return this; }
    onError() { return this; }
    onTool() { return this; }
    onCommand() { return this; }
    onSpawn() { return this; }
    onEnv() { return this; }
    onImport() { return this; }
    onExit() { return this; }
    on() { return this; }
    off() { return this; }
    emit() { /* no-op */ return []; }
    
    // Handle stream events
    handleStdout(payload) { 
        console.log(`[NULL_BRIDGE:STDOUT] ${payload.message}`); 
        return []; 
    }
    
    handleStderr(payload) { 
        console.log(`[NULL_BRIDGE:STDERR] ${payload.message}`); 
        return []; 
    }
    
    handleStdin(payload) { return null; }
    
    // Core methods
    handleInterceptedCall(type, payload) {
        console.error(`[NULL_BRIDGE] Intercepted ${type} call with no active bridge`);
        console.error(`[NULL_BRIDGE] Payload:`, JSON.stringify(payload));
        
        // Return appropriate response based on type
        switch (type) {
            case 'http_request':
            case 'https_request':
            case 'fetch':
                return Promise.resolve({
                    statusCode: 503,
                    headers: {
                        'content-type': 'application/json',
                        'x-sandbox-bridge': 'null-bridge'
                    },
                    body: JSON.stringify({
                        error: 'No bridge connected',
                        message: 'This request was intercepted by the sandbox, but no bridge is connected to handle it',
                        type: type,
                        url: payload.url
                    })
                });
                
            case 'net_connect':
                return Promise.resolve({
                    success: false,
                    error: 'No bridge connected',
                    message: 'Network connection attempt was intercepted, but no bridge is connected'
                });
                
            case 'dns_lookup':
                return Promise.resolve({
                    success: false,
                    error: 'No bridge connected',
                    message: 'DNS lookup was intercepted, but no bridge is connected'
                });
                
            case 'fs_readFile':
            case 'fs_writeFile':
            case 'fs_unlink':
            case 'fs_stat':
                return Promise.resolve({
                    success: false,
                    error: 'No bridge connected',
                    message: 'File system operation was intercepted, but no bridge is connected'
                });
                
            case 'spawn':
            case 'exec':
                return Promise.resolve({
                    exitCode: 1,
                    stdout: '',
                    stderr: 'Process execution was intercepted, but no bridge is connected'
                });
                
            case 'websocket_connect':
                return Promise.resolve({
                    success: false,
                    error: 'No bridge connected',
                    message: 'WebSocket connection was intercepted, but no bridge is connected'
                });
                
            default:
                return Promise.resolve({
                    success: false,
                    error: 'No bridge connected',
                    message: `Unknown operation type "${type}" was intercepted, but no bridge is connected`
                });
        }
    }
    
    // Other bridge methods
    handleFetch() { return this.handleInterceptedCall('fetch'); }
    handleConnect() { return this.handleInterceptedCall('net_connect'); }
    handleDnsLookup() { return this.handleInterceptedCall('dns_lookup'); }
    handleRequest() { return Promise.resolve(null); }
}

// Add CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NullBridge };
} 