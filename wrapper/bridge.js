export class Bridge {
    constructor() {
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
        console.error('[BRIDGE] Instance created, disconnected by default');

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
        if (this.handlers.stdout.size > 0) {
            this.emit('stdout', { message });
        } else {
            console.error(message);
        }
    }

    // Set bridge ID
    setBridgeId(id) {
        console.error('[BRIDGE] Setting bridge ID:', id);
        this._bridgeId = id;
    }

    // Get bridge ID
    getBridgeId() {
        return this._bridgeId;
    }

    // Check if bridge is connected
    isConnected() {
        const status = this._connected && this._bridgeId !== null;
        console.error('[BRIDGE] isConnected() called:', status, '(connected:', this._connected, 'bridgeId:', this._bridgeId, ')');
        return status;
    }

    // Set bridge connection status
    setConnected(status) {
        console.error('[BRIDGE] setConnected() called, old:', this._connected, 'new:', status, 'bridgeId:', this._bridgeId);
        this._connected = status;

        // Send immediate response when bridge is connected
        if (status) {
            console.error('[BRIDGE] Connected, sending initial tools list');
            const response = {
                jsonrpc: '2.0',
                result: {
                    tools: [
                        {
                            name: 'execute_jql',
                            description: 'Execute a JQL query',
                            parameters: {
                                jql: { type: 'string', description: 'JQL query to execute' }
                            }
                        }
                    ]
                }
            };
            // Use direct handler call instead of emit to avoid recursion
            for (const handler of this.handlers.stdout) {
                handler({ message: JSON.stringify(response) });
            }
        }
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
                // Don't recursively emit error events
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
        return `req_${++this.requestId}`;
    }

    // Handle a request and wait for response
    async handleRequest(type, data) {
        console.error('[BRIDGE] handleRequest() called', { type, data });
        const requestId = this.generateRequestId();
        
        return new Promise((resolve, reject) => {
            console.error('[BRIDGE] Creating pending request:', requestId);
            this.pendingRequests.set(requestId, { resolve, reject });
            
            this.emit(type, { ...data, requestId })
                .catch(error => {
                    console.error('[BRIDGE] Request failed:', requestId, error);
                    this.pendingRequests.delete(requestId);
                    reject(error);
                });
        });
    }

    // Handle response from the bridge portal
    handleResponse(requestId, response, error = null) {
        console.error('[BRIDGE] handleResponse() called', { requestId, response, error });
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            if (error) {
                console.error('[BRIDGE] Rejecting request:', requestId, error);
                pending.reject(error);
            } else {
                console.error('[BRIDGE] Resolving request:', requestId, response);
                pending.resolve(response);
            }
            this.pendingRequests.delete(requestId);
        } else {
            console.error('[BRIDGE] No pending request found for:', requestId);
        }
    }

    // Handler for stderr output from child process
    handleStderr({ message }) {
        return this.emit('stderr', { message });
    }

    // Méthodes utilitaires pour les handlers
    async handleFetch(request) {
        return this.handleRequest('fetch', request);
    }

    async handleWebSocket(params) {
        const { action, ...rest } = params;
        switch (action) {
            case 'connect':
                const wsId = this.generateRequestId();
                const connection = await this.handleRequest('websocket', { ...rest, wsId });
                this.activeWebSockets.set(wsId, connection);
                return { wsId, ...connection };

            case 'send':
                const ws = this.activeWebSockets.get(params.wsId);
                if (!ws) throw new Error('WebSocket connection not found');
                return this.handleRequest('websocket', { action: 'send', ws, ...rest });

            case 'close':
                const wsToClose = this.activeWebSockets.get(params.wsId);
                if (wsToClose) {
                    await this.handleRequest('websocket', { action: 'close', ws: wsToClose });
                    this.activeWebSockets.delete(params.wsId);
                }
                return true;

            default:
                throw new Error(`Unknown WebSocket action: ${action}`);
        }
    }

    async handleFs(params) {
        const { action, ...rest } = params;
        switch (action) {
            case 'readFile':
                return this.handleRequest('fileRead', rest);
            case 'writeFile':
                return this.handleRequest('fileWrite', rest);
            case 'deleteFile':
                return this.handleRequest('fileDelete', rest);
            default:
                throw new Error(`Unknown filesystem action: ${action}`);
        }
    }

    async handleToolCall(params) {
        const { name, arguments: args } = params;
        return this.handleRequest('tool', { name, arguments: args });
    }

    async handleCommand(params) {
        return this.handleRequest('command', params);
    }

    // Forward intercepted calls from NodeInterceptor
    async handleInterceptedCall(type, payload) {
        // Don't process requests unless the bridge is actually connected
        if (!this.isConnected()) {
            console.error('[BRIDGE] Cannot handle intercepted call, bridge not connected');
            return null; // Return null to indicate the bridge is not connected
        }
        
        console.error(`[BRIDGE] Handling intercepted ${type} call`);
        
        switch (type) {
            case 'fetch':
            case 'http_request':
            case 'https_request':
                return this.handleFetch(payload);
                
            case 'net_connect':
                return this.handleConnect(payload);
                
            case 'dns_lookup':
                return this.handleDns(payload);
                
            case 'fs_readFile':
                return this.handleFs({ action: 'read', ...payload });
                
            case 'fs_writeFile':
                return this.handleFs({ action: 'write', ...payload });
                
            case 'fs_unlink':
                return this.handleFs({ action: 'delete', ...payload });
                
            case 'fs_stat':
                return this.handleFs({ action: 'stat', ...payload });
                
            case 'spawn':
            case 'exec':
                return this.handleSpawn(payload);
                
            case 'websocket_connect':
                return this.handleWebSocket(payload);
                
            default:
                console.error(`[BRIDGE] Unsupported intercepted call type: ${type}`);
                return null;
        }
    }

    log(message, type = 'stdout') {
        this.emit(type, { message });
    }
}

// Add support for CommonJS require() in bundled scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Bridge, NullBridge };
} 