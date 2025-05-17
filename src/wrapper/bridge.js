import WebSocket from 'ws';
import crypto from 'crypto'; // For generating instanceId

export class Bridge {
    constructor(sandboxSessionId = 'unknown_session', actualSandboxId = null) { // Added actualSandboxId
        // Add a DEBUG flag
        this.DEBUG = false;
        
        // Debug logging function
        this.debugLog = (...args) => {
            if (this.DEBUG) {
                console.error(...args);
            }
        };

        // Handlers pour les différents événements
        this.handlers = {
            // Requêtes réseau
            fetch: new Set(),          // Requêtes HTTP/HTTPS
            connect: new Set(),        // Connexions TCP/UDP
            dns: new Set(),            // Résolutions DNS
            websocket: new Set(),      // WebSocket connections

            // Système de fichiers
            fileRead: new Set(),       // Lecture de fichiers
            fileWrite: new Set(),      // Écriture de fichiers
            fileDelete: new Set(),     // Suppression de fichiers
            
            // Entrées/Sorties
            stdout: new Set(),         // Sortie standard
            stderr: new Set(),         // Sortie d'erreur
            stdin: new Set(),          // Entrée standard
            
            // Processus
            spawn: new Set(),          // Création de processus
            env: new Set(),            // Accès aux variables d'environnement
            
            // Modules
            import: new Set(),         // Import/require de modules
            
            // Tools and Commands
            tool: new Set(),           // Tool execution
            command: new Set(),        // Command execution
            
            // Erreurs et événements système
            error: new Set(),          // Erreurs générales
            exit: new Set()            // Sortie du processus
        };

        // Keep track of active WebSocket connections
        this.activeWebSockets = new Map();
        // Keep track of pending requests
        this.pendingRequests = new Map();
        // Request ID counter
        this.requestId = 0;
        // Bridge connection status - explicitly disconnected by default
        this._connected = false;
        this._bridgeId = null;
        this.ws = null;
        this.wsUrl = process.env.MCP_SERVER_URL || 'ws://localhost:3000';
        this._sandboxSessionId = sandboxSessionId; // Store sandboxSessionId
        this._actualSandboxId = actualSandboxId; // Store actualSandboxId
        this._instanceId = crypto.randomUUID(); // Unique ID for this bridge client instance

        console.error(`[BRIDGE] Instance created (id: ${this._instanceId}, session: ${this._sandboxSessionId}, actualSandboxId: ${this._actualSandboxId}), disconnected by default`);

        // Default tool handler to return available tools
        this.onTool(async ({ action }) => {
            console.error('[BRIDGE] Tool handler called with action:', action);
            // Only respond if the bridge is connected
            if (!this.isConnected()) {
                console.error('[BRIDGE] Tool handler ignoring request: bridge not connected');
                return null;
            }
            
            if (action === 'list') {
                return [
                    {
                        name: 'execute_jql',
                        description: 'Execute a JQL query',
                        parameters: {
                            jql: { type: 'string', description: 'JQL query to execute' }
                        }
                    }
                ];
            }
            throw new Error(`Unknown tool action: ${action}`);
        });
    }

    // Helper method to emit debug messages
    emitDebug(...args) {
        const message = ['[BRIDGE_DEBUG]', ...args].join(' ');
        const logMessage = { type: 'stdout', message: `[BRIDGE_DEBUG] ${args.join(' ')}` };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(logMessage));
        } else {
            console.error(message);
        }
    }

    // Set bridge ID
    setBridgeId(id) {
        console.error('[BRIDGE] Setting bridge ID:', id);
        this._bridgeId = id;
        // this._tryConnect(); // Removed: explicit call from sandbox is better
    }

    // Get bridge ID
    getBridgeId() {
        return this._bridgeId;
    }

    // Check if bridge is connected
    isConnected() {
        const status = this._connected && this._bridgeId !== null && this.ws && this.ws.readyState === WebSocket.OPEN;
        console.error('[BRIDGE] isConnected() called:', status, '(connected:', this._connected, 'bridgeId:', this._bridgeId, 'ws.readyState:', this.ws ? this.ws.readyState : 'null', ')');
        return status;
    }

    // Set bridge connection status (internally managed by WebSocket events)
    setConnected(status) {
        console.error('[BRIDGE] setConnected() called, old:', this._connected, 'new:', status, 'bridgeId:', this._bridgeId);
        const oldStatus = this._connected;
        this._connected = status;

        if (status && !oldStatus) {
            this._tryConnect();
        } else if (!status && oldStatus && this.ws) {
            console.error('[BRIDGE] Disconnecting WebSocket due to setConnected(false)');
            this.ws.close();
        }
    }

    _tryConnect() {
        return new Promise((resolve, reject) => {
            // Ensure _bridgeId (targetFlutterBridgeId) is set before trying to connect
            if (!this._bridgeId) {
                console.error('[BRIDGE] Cannot connect WebSocket: Target Flutter Bridge ID (this._bridgeId) not set.');
                return reject(new Error('Target Flutter Bridge ID not set for sandbox bridge client'));
            }

            if (this._bridgeId && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) { // Check if not already connected or connecting
                console.error(`[BRIDGE] Attempting WebSocket connection to ${this.wsUrl} with targetFlutterBridgeId ${this._bridgeId} for instance ${this._instanceId}`);
                this.ws = new WebSocket(this.wsUrl);
                let openHandler, errorHandler, closeHandler;

                const cleanupListeners = () => {
                    if (this.ws) {
                        if (openHandler) this.ws.removeEventListener('open', openHandler);
                        if (errorHandler) this.ws.removeEventListener('error', errorHandler);
                        if (closeHandler) this.ws.removeEventListener('close', closeHandler);
                    }
                };

                openHandler = () => {
                    cleanupListeners(); // Clean up early listeners
                    this._connected = true;
                    console.error(`[BRIDGE] WebSocket connection opened for instance ${this._instanceId} (targetFlutterBridgeId ${this._bridgeId}).`);
                    
                    const registrationMessage = {
                        type: 'bridge_register',
                        origin: 'sandbox_bridge_client', // Identify as sandbox bridge client
                        bridgeId: this._bridgeId,         // This is the targetFlutterBridgeId
                        sandboxSessionId: this._sandboxSessionId,
                        actualSandboxId: this._actualSandboxId, // Added actualSandboxId
                        instanceId: this._instanceId,
                        requestId: this.generateRequestId(), // For tracking the registration itself
                        platform: 'node' 
                    };
                    this.ws.send(JSON.stringify(registrationMessage));
                    console.error('[BRIDGE] Sent sandbox_bridge_client register message:', registrationMessage);
                    
                    // Setup regular message, error, and close handlers
                    this.ws.on('message', this._handleServerMessage.bind(this));
                    this.ws.on('error', this._handleWsError.bind(this));
                    this.ws.on('close', this._handleWsClose.bind(this));

                    resolve(); 
                };

                errorHandler = (error) => {
                    cleanupListeners();
                    console.error(`[BRIDGE] WebSocket initial connection error for instance ${this._instanceId}:`, error);
                    this._connected = false;
                    this.ws = null;
                    this.pendingRequests.forEach(({ reject: reqReject }) => reqReject(new Error('WebSocket connection error during connect')));
                    this.pendingRequests.clear();
                    this.emit('error', { source: 'websocket_connect', error });
                    reject(error);
                };

                closeHandler = (code, reason) => {
                    cleanupListeners();
                    console.error(`[BRIDGE] WebSocket closed before registration complete for instance ${this._instanceId}. Code: ${code}, Reason: ${reason.toString()}`);
                    this._connected = false;
                    this.ws = null;
                    this.pendingRequests.forEach(({ reject: reqReject }) => reqReject(new Error('WebSocket closed during connect')));
                    this.pendingRequests.clear();
                    reject(new Error(`WebSocket closed before opening or registration. Code: ${code}, Reason: ${reason.toString()}`));
                };

                this.ws.once('open', openHandler);
                this.ws.once('error', errorHandler);
                this.ws.once('close', closeHandler);

            } else if (this.ws && this.ws.readyState === WebSocket.OPEN && this._bridgeId) {
                 console.error('[BRIDGE] WebSocket already connected and bridge ID is set.');
                 resolve();
            } else if (!this._bridgeId) { // Should be caught by the initial check, but as a fallback
                console.error('[BRIDGE] Cannot connect WebSocket: Bridge ID not set.');
                reject(new Error('Bridge ID not set'));
            } else {
                console.error('[BRIDGE] _tryConnect called in an unexpected state.');
                reject(new Error('Bridge in unexpected state for connection attempt'));
            }
        });
    }

    // Extracted message handler
    _handleServerMessage(data) {
        const messageString = data.toString();
        this.debugLog(`[BRIDGE] Received message from server (instance ${this._instanceId}):`, messageString);

        try {
            const message = JSON.parse(messageString);

            // Handle bridge_response from main.js (response to an intercepted call)
            if (message.type === 'bridge_response') {
                if (message.response) {
                    if (message.response.error) {
                        this.debugLog(`[BRIDGE] Received error for request ${message.requestId}:`, message.response.error);
                        this.handleResponse(message.requestId, null, message.response.error);
                    } else if (message.response.data !== undefined) {
                        this.debugLog(`[BRIDGE] Received result for request ${message.requestId}:`, message.response.data);
                        this.handleResponse(message.requestId, message.response.data);
                    } else {
                        this.debugLog(`[BRIDGE] Received malformed bridge_response for request ${message.requestId}:`, message);
                        this.handleResponse(message.requestId, null, new Error('Malformed bridge_response'));
                    }
                }
            } 
            // Handle sandbox_command (JSON-RPC from main.js)
            else if (message.type === 'sandbox_command') {
                // Important flow log - always show regardless of DEBUG setting
                console.log(`\n📥 [FLOW] Received JSON-RPC command: ${message.params.method} (id: ${message.params.id})`);
                
                // Process and send the command response
                this.handleCommand(message.params)
                    .then(result => {
                        console.log(`\n📤 [FLOW] Sending JSON-RPC response for command: ${message.params.method} (id: ${message.params.id})`);
                        // Send the command response back to main.js
                        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                            this.ws.send(JSON.stringify({
                                type: 'sandbox_command_result',
                                requestId: message.requestId,
                                actualSandboxId: this._actualSandboxId,
                                result: result
                            }));
                        }
                    })
                    .catch(error => {
                        console.error(`\n❌ [ERROR] Error processing command ${message.params.method}:`, error.message);
                        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                            this.ws.send(JSON.stringify({
                                type: 'sandbox_command_result',
                                requestId: message.requestId,
                                actualSandboxId: this._actualSandboxId,
                                error: error.message
                            }));
                        }
                    });
            }
            // Handle bridge_registered from main.js (response to bridge_register)
            else if (message.type === 'bridge_registered') {
                console.log(`[BRIDGE] Successfully registered with main.js (instance ${this._instanceId}, clientInstanceId: ${message.bridgeClientInstanceId})`);
                this.setConnected(true);
            }
            // Direct error from server (not in response to a pending request)
            else if (message.type === 'error') {
                console.error(`[BRIDGE] Received direct error from server for request ${message.requestId}:`, message.error);
                if (message.requestId && this.pendingRequests.has(message.requestId)) {
                    const { reject, timeout } = this.pendingRequests.get(message.requestId);
                    clearTimeout(timeout);
                    reject(new Error(message.error.message || message.error || 'Bridge request failed'));
                    this.pendingRequests.delete(message.requestId);
                }
                // Also emit the error for general handlers
                this.emit('error', { source: 'server', error: message.error });
            }
            else {
                console.warn(`[BRIDGE] Unhandled message type from server: ${message.type}`);
            }
        } catch (e) {
            console.error(`[BRIDGE] Error parsing message from server (instance ${this._instanceId}):`, e, 'Raw data:', messageString);
        }
    }

    // Extracted WebSocket error handler
    _handleWsError(error) {
        console.error(`[BRIDGE] WebSocket error (instance ${this._instanceId}):`, error);
        this._connected = false;
        this.pendingRequests.forEach(({ reject }) => reject(new Error('WebSocket connection error')));
        this.pendingRequests.clear();
        this.emit('error', { source: 'websocket', error });
        if (this.ws) {
            this.ws.removeAllListeners(); // Clean up all listeners
            this.ws.terminate(); // Force close
        }
        this.ws = null;
    }

    // Extracted WebSocket close handler
    _handleWsClose(code, reason) {
        console.error(`[BRIDGE] WebSocket connection closed (instance ${this._instanceId}). Code: ${code}, Reason: ${reason.toString()}`);
        this._connected = false;
        this.pendingRequests.forEach(({ reject }) => reject(new Error('WebSocket connection closed')));
        this.pendingRequests.clear();
        this.emit('exit', { code, reason: reason.toString() });
        if (this.ws) {
             this.ws.removeAllListeners(); // Clean up all listeners
        }
        this.ws = null;
    }

    // Méthodes pour ajouter des handlers
    onFetch(handler) {
        this.emitDebug('Adding fetch handler');
        this.handlers.fetch.add(handler);
        return this;
    }

    onConnect(handler) {
        this.emitDebug('Adding connect handler');
        this.handlers.connect.add(handler);
        return this;
    }

    onDns(handler) {
        this.handlers.dns.add(handler);
        return this;
    }

    onWebSocket(handler) {
        this.emitDebug('Adding websocket handler');
        this.handlers.websocket.add(handler);
        return this;
    }

    onFileRead(handler) {
        this.handlers.fileRead.add(handler);
        return this;
    }

    onFileWrite(handler) {
        this.handlers.fileWrite.add(handler);
        return this;
    }

    onFileDelete(handler) {
        this.handlers.fileDelete.add(handler);
        return this;
    }

    onStdout(handler) {
        this.handlers.stdout.add(handler);
        return this;
    }

    onStderr(handler) {
        this.handlers.stderr.add(handler);
        return this;
    }

    onStdin(handler) {
        this.handlers.stdin.add(handler);
        return this;
    }

    onSpawn(handler) {
        this.handlers.spawn.add(handler);
        return this;
    }

    onEnv(handler) {
        this.handlers.env.add(handler);
        return this;
    }

    onImport(handler) {
        this.handlers.import.add(handler);
        return this;
    }

    onTool(handler) {
        this.emitDebug('Adding tool handler');
        this.handlers.tool.add(handler);
        return this;
    }

    onCommand(handler) {
        this.handlers.command.add(handler);
        return this;
    }

    onError(handler) {
        this.handlers.error.add(handler);
        return this;
    }

    onExit(handler) {
        this.handlers.exit.add(handler);
        return this;
    }

    // Méthodes pour émettre des événements
    async emit(eventName, data) {
        console.error('[BRIDGE] emit() called', { eventName, data });
        if (!this.handlers[eventName]) {
            console.error('[BRIDGE] Event not supported:', eventName);
            throw new Error(`Event "${eventName}" not supported`);
        }

        const results = [];
        for (const handler of this.handlers[eventName]) {
            try {
                console.error('[BRIDGE] Calling handler for event:', eventName);
                const result = await handler(data);
                results.push(result);
                console.error('[BRIDGE] Handler result:', result);
            } catch (error) {
                console.error('[BRIDGE] Handler error:', error);
                if (eventName !== 'error') {
                    for (const errorHandler of this.handlers.error) {
                        try {
                            await errorHandler({ source: eventName, error });
                        } catch (e) {
                            console.error('[BRIDGE] Error handler failed:', e);
                        }
                    }
                }
            }
        }
        return results;
    }

    // Generate a unique request ID
    generateRequestId() {
        this.requestId = (this.requestId + 1) % Number.MAX_SAFE_INTEGER;
        return `bridge-${this._bridgeId}-${this.requestId}`;
    }

    // Handle a request and wait for response
    async handleRequest(type, data) {
        console.error(`[BRIDGE] handleRequest (local) called for type: ${type}`, data);
        if (this.handlers[type] && this.handlers[type].size > 0) {
            return this.emit(type, data);
        } else {
            console.warn(`[BRIDGE] No local handlers for type: ${type}. If this was meant for the external bridge, use a specific method.`);
            return null;
        }
    }

    // Handle response from the bridge portal
    handleResponse(requestId, response, error = null) {
        if (this.pendingRequests.has(requestId)) {
            const { resolve, reject, timeout } = this.pendingRequests.get(requestId);
            clearTimeout(timeout);
            if (error) {
                console.error(`[BRIDGE] Handling error for request ${requestId}:`, error);
                reject(error);
            } else {
                console.error(`[BRIDGE] Handling response for request ${requestId}:`, response);
                resolve(response);
            }
            this.pendingRequests.delete(requestId);
        } else {
            console.warn(`[BRIDGE] Received response for unknown or timed-out request ID: ${requestId}`);
        }
    }

    // Handler for stderr output from child process
    handleStdio(type, { message }) {
        if (!this.isConnected()) {
            console[type === 'stdout' ? 'log' : 'error'](`[BRIDGE_STDIO_FALLBACK] ${message}`);
            return;
        }
        
        // Check if this is a JSON-RPC response
        let isJsonRpcResponse = false;
        try {
            const parsedMessage = JSON.parse(message);
            if (parsedMessage.jsonrpc === "2.0" && parsedMessage.id && (parsedMessage.result !== undefined || parsedMessage.error !== undefined)) {
                isJsonRpcResponse = true;
                console.log(`\n✅ [FLOW] JSON-RPC response detected in ${type}: id=${parsedMessage.id}`);
            }
        } catch (e) {
            // Not valid JSON or not a JSON-RPC response
        }
        
        this.debugLog(`[BRIDGE] Forwarding ${type} to main server (actualSandboxId: ${this._actualSandboxId}, session: ${this._sandboxSessionId}):`, message);
        
        const stdioMessage = {
            type: type, // 'stdout' or 'stderr'
            sandboxSessionId: this._sandboxSessionId, // Added for routing in main.js
            actualSandboxId: this._actualSandboxId,    // Use actualSandboxId
            message: message,
            isJson: isJsonRpcResponse // Mark as JSON if it's a JSON-RPC response
        };
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(stdioMessage));
        } else {
            this.debugLog(`[BRIDGE] Cannot forward ${type}: WebSocket not ready.`);
        }
    }

    // Centralized method to send requests over WebSocket
    async _sendRequest(methodName, params) {
        if (!this.isConnected()) {
            console.error(`[BRIDGE] Cannot send request "${methodName}": WebSocket not connected.`);
            if(this._bridgeId && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
                console.error('[BRIDGE] Attempting to reconnect...');
                this._tryConnect();
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (!this.isConnected()) {
                     throw new Error(`Bridge not connected and reconnect failed for method ${methodName}`);
                }
            } else if (!this._bridgeId) {
                 throw new Error(`Bridge not connected (no bridge ID) for method ${methodName}`);
            } else {
                 throw new Error(`Bridge not connected for method ${methodName}`);
            }
        }

        const currentRequestId = this.generateRequestId();
        const request = {
            jsonrpc: '2.0',
            method: methodName,
            params: params,
            id: currentRequestId
        };

        console.error(`[BRIDGE] Sending request ${currentRequestId} (${methodName}):`, params);
        this.ws.send(JSON.stringify(request));

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(currentRequestId, { resolve, reject, timeout: setTimeout(() => {
                if (this.pendingRequests.has(currentRequestId)) {
                    console.error(`[BRIDGE] Request ${currentRequestId} (${methodName}) timed out.`);
                    reject(new Error(`Request ${methodName} timed out`));
                    this.pendingRequests.delete(currentRequestId);
                }
            }, 30000) });
        });
    }

    async handleFetch(request) {
        this.emitDebug('Bridge.handleFetch called with:', request);
        return this._sendRequest('bridgeFetch', request);
    }

    async handleWebSocket(params) {
        this.emitDebug('Bridge.handleWebSocket called with:', params);
        return this._sendRequest('bridgeWebSocket', params);
    }

    async handleFs(params) {
        this.emitDebug('Bridge.handleFs called with:', params);
        return this._sendRequest('bridgeFs', params);
    }

    async handleToolCall(params) {
        this.emitDebug('Bridge.handleToolCall called with:', params);
        return this._sendRequest('bridgeToolCall', params);
    }

    async handleCommand(params) {
        this.emitDebug('Bridge.handleCommand (to be sent out) called with:', params);
        return this._sendRequest('bridgeCommand', params);
    }

    // This method is for when the interceptor catches something and tells the bridge to handle it.
    async handleInterceptedCall(type, payload) {
        this.emitDebug(`[BRIDGE] handleInterceptedCall (instance ${this._instanceId}) received raw type: '${type}'`, payload);

        if (!this.isConnected()) {
            console.error(`[BRIDGE] Intercepted call '${type}' cannot be handled: Bridge (instance ${this._instanceId}) not connected to main server.`);
            // Optionally, try to reconnect or queue
            // For now, throw an error or return a specific error object
            throw new Error('Bridge not connected to handle intercepted call.');
        }

        // Standardize the type: 'fs:read' -> 'fs_read', 'http:request' -> 'http_request'
        const messageType = type.replace(':', '_');
        const currentRequestId = this.generateRequestId();

        const messageToServer = {
            type: messageType,                 // e.g., 'fs_read', 'http_request'
            targetFlutterBridgeId: this._bridgeId, // Target Flutter Bridge ID to route to
            sandboxSessionId: this._sandboxSessionId,    // Added: MCP Client's session ID
            actualSandboxId: this._actualSandboxId,     // Added: The specific sandbox instance ID
            requestId: currentRequestId,
            payload: payload
        };

        console.error(`[BRIDGE] Sending intercepted call to main.js (instance ${this._instanceId}, target: ${this._bridgeId}, session: ${this._sandboxSessionId}, sandbox: ${this._actualSandboxId}): ${messageType} (reqId: ${currentRequestId})`, payload);
        this.ws.send(JSON.stringify(messageToServer));

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (this.pendingRequests.has(currentRequestId)) {
                    console.error(`[BRIDGE] Intercepted call request ${currentRequestId} (${messageType}) timed out.`);
                    reject(new Error(`Intercepted call ${messageType} timed out`));
                    this.pendingRequests.delete(currentRequestId);
                }
            }, 30000); // 30-second timeout

            this.pendingRequests.set(currentRequestId, { resolve, reject, timeout: timeoutId });
        });
    }

    log(message, type = 'stdout') {
        this.emit(type, { message });
    }
}

// Add support for CommonJS require() in bundled scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Bridge, NullBridge };
} 