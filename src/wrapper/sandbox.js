import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { Bridge } from './bridge.js';
import vm from 'vm';
import { NodeInterceptor } from '../interceptors/NodeInterceptor.js';
import { NullBridge } from './NullBridge.js';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Sandbox {
    constructor(rootDir, envVars = {}) {
        this.rootDir = path.resolve(rootDir);
        this.envVars = envVars;
        this.actualSandboxId = null; // Added to store the ID assigned by main.js
        
        // Use a null bridge by default
        this.bridge = new NullBridge();
        
        // Flag to track bridge initialization state
        this._bridgeInitializing = true;
        
        // Promise to signal bridge initialization completion
        this.bridgeInitializationPromise = new Promise((resolve, reject) => {
            this._resolveBridgeInitialization = resolve;
            this._rejectBridgeInitialization = reject;
            
            // Set a timeout to automatically resolve the promise after 10 seconds
            // This prevents scripts from being blocked indefinitely
            // For HTTP server scripts, we need a longer timeout to ensure they have time to connect
            setTimeout(() => {
                if (this._bridgeInitializing) {
                    console.error('[SANDBOX] Auto-resolving bridge initialization after timeout');
                    this._bridgeInitializing = false;
                    resolve();
                }
            }, 10000); // 10 seconds timeout for bridge initialization
        });
        
        // Create a NodeInterceptor instance
        this.interceptor = new NodeInterceptor({
            debug: true,
            proxyEndpoint: process.env.PROXY_ENDPOINT || 'http://localhost:3000/intercept',
            bridge: this.bridge, // Use the null bridge by default
            autoApply: false // Don't apply hooks yet
        });

        // Set the NodeInterceptor static instance
        NodeInterceptor.instance = this.interceptor;

        // Listen for bridge registration
        process.on('message', async (message) => {
            if (message.type === 'bridge_register') {
                console.error('[SANDBOX] Bridge registration trigger received:', message);
                
                // Support both message.bridgeId and message.targetFlutterBridgeId for backward compatibility
                const bridgeId = message.bridgeId || message.targetFlutterBridgeId;
                
                // Validate required fields
                if (!bridgeId || !message.sandboxSessionId || !message.actualSandboxId) {
                    console.error('[SANDBOX] Invalid bridge_register message from parent: missing bridgeId/targetFlutterBridgeId, sandboxSessionId, or actualSandboxId.');
                    return;
                }

                // Set a timeout to continue execution even if bridge initialization doesn't complete
                // This is crucial for web servers and other long-running scripts
                const bridgeInitTimeout = setTimeout(() => {
                    console.error('[SANDBOX] Bridge initialization timed out. Continuing with NullBridge to allow script execution.');
                    // Don't overwrite _bridgeInitializing if it's already false (bridge was initialized)
                    if (this._bridgeInitializing) {
                        this._bridgeInitializing = false;
                        // Note: We keep the NullBridge active, but allow the script to continue
                        // For web server scripts, the NullBridge will block network operations but the server will still run
                    }
                }, 10000); // 10 seconds timeout for bridge initialization (matching the 10s promise timeout)

                try {
                    // Create new WebSocket client to connect to the bridge
                    const BridgeClient = require('../bridge/bridge-client.js').BridgeClient;
                    const websocket = require('ws');
                    
                    // We'll use this URL to connect back to main.js WebSocket server as a bridge client
                    // Use the same URL as the parent, if possible
                    // We can infer the URL from the parentUrl from the sandbox options
                    let url = 'ws://localhost:3000'; // Default fallback
                    if (this.options.parentUrl) {
                        url = this.options.parentUrl;
                    }
                    
                    console.error(`[SANDBOX] Connecting to bridge at: ${url}`);
                    
                    // Create a new bridge client to connect back to main.js
                    const bridgeClient = new BridgeClient(
                        url,
                        bridgeId,               // The Flutter bridge to route requests to
                        message.sandboxSessionId,  // The mcp_client session ID
                        message.actualSandboxId    // This sandbox's ID within the session
                    );
                    
                    // Start the connection to main.js
                    await bridgeClient.start();
                    
                    // Replace the nullBridge with the real bridge
                    // In the future, this is the bridge our NodeInterceptor will use for all Node.js API calls
                    this._bridge = bridgeClient;
                    
                    // CRITICAL: Also update this.bridge to the new instance and update the interceptor
                    this.setBridge(bridgeClient); // Use setBridge method to ensure proper updates
                    
                    this._bridgeInitializing = false;
                    
                    // Clear the timeout as we've successfully initialized
                    clearTimeout(bridgeInitTimeout);
                    
                    // Resolve the initialization promise to unblock any waiting scripts
                    if (this._resolveBridgeInitialization) {
                        this._resolveBridgeInitialization();
                    }
                    
                    console.error('[SANDBOX] Bridge initialized and ready.');
                } catch (error) {
                    console.error('[SANDBOX] Error initializing bridge:', error);
                    // Clear the initialization flag to allow the script to continue with NullBridge
                    this._bridgeInitializing = false;
                    // Clear the timeout since we're done with the initialization attempt
                    clearTimeout(bridgeInitTimeout);
                    
                    // Log clear message about continuing with NullBridge
                    console.error('[SANDBOX] Bridge initialization failed, continuing with NullBridge. Network operations will be blocked.');
                    
                    // Even though initialization failed, ensure the bridge status is updated
                    // This ensures the interceptor is aware we tried but failed
                    this.interceptor.updateBridgeStatus();
                    
                    // Resolve the initialization promise anyway to let scripts continue
                    if (this._resolveBridgeInitialization) {
                        this._resolveBridgeInitialization();
                    }
                }
            }
        });
    }

    // Method to swap the bridge at runtime
    setBridge(newBridge) {
        const oldBridge = this.bridge;
        console.error('[SANDBOX] Swapping bridge:', 
            oldBridge.constructor.name, '→', newBridge.constructor.name);
        
        // Update the bridge reference
        this.bridge = newBridge;
        
        // Update the interceptor to use the new bridge
        this.interceptor.setBridge(newBridge);
        
        // If this is a real Bridge (not NullBridge), set up handlers
        // and ensure it tries to connect if it hasn't already.
        if (newBridge instanceof Bridge) {
            // The bridge's setBridgeId (called from process.on message) and its own logic 
            // in _tryConnect should handle connection. We call _setupBridgeInterceptorHandlers
            // to set up any specific listeners on the bridge instance from the sandbox perspective.
            this._setupBridgeInterceptorHandlers(); 
            // Explicitly ensure connection is attempted if bridgeId is already set on newBridge
            if (newBridge.getBridgeId() && !newBridge.isConnected()) {
                newBridge._tryConnect(); // Ensure connection attempt if not already connected
            }
        }
        
        // Return the old bridge in case it needs to be cleaned up
        return oldBridge;
    }

    // Setup handlers for the bridge to interact with the interceptor
    _setupBridgeInterceptorHandlers() {
        console.error('[SANDBOX] Setting up bridge interceptor handlers');
        
        if (!(this.bridge instanceof Bridge)) {
            console.error('[SANDBOX] Not setting up handlers for null bridge or bridge not connected.');
            return;
        }

        // The bridge itself now handles sending its own debug/stdout/stderr over WebSocket if configured.
        // The sandbox is responsible for piping the *script's* output to the bridge's stdio methods.
        // NodeInterceptor will call bridge.handleInterceptedCall directly.

        // Listen for errors originating from the bridge's WebSocket or internal operations.
        this.bridge.onError(({ source, error }) => {
            console.error(`[SANDBOX_BRIDGE_ERROR] Source: ${source}, Error:`, error.message || error);
            // This error is from the bridge itself (e.g., WebSocket failed).
            // If these need to go to the client, the bridge should send them, 
            // or we can forward them from here if main.js needs sandbox-specific error context.
            // For now, just logging in the sandbox.
        });

        // Listen for the bridge explicitly exiting/disconnecting
        this.bridge.onExit(({ code, reason }) => {
            console.error(`[SANDBOX_BRIDGE_EVENT] Bridge exited/disconnected. Code: ${code}, Reason: ${reason}`);
            // Sandbox could take action here, like attempting to re-establish or cleaning up.
        });

        console.error('[SANDBOX] Bridge interceptor handlers setup (simplified).');
    }

    // Getter to access the bridge
    getBridge() {
        return this.bridge;
    }

    // Helper method to log debug messages
    emitDebug(...args) {
        console.error(['[SANDBOX]', ...args].join(' '));
    }

    // Exécute un script Node.js
    async runNodeScript(scriptPath) {
        console.error('[SANDBOX] Running Node.js script:', scriptPath);
        
        // Wait for bridge initialization with a timeout
        const waitForBridge = async () => {
            try {
                console.error('[SANDBOX] Waiting for bridge initialization...');
                
                // Create a timeout promise to avoid waiting indefinitely
                const timeoutPromise = new Promise((resolve) => {
                    setTimeout(() => {
                        console.error('[SANDBOX] Bridge initialization timeout, continuing with NullBridge');
                        resolve();
                    }, 10000); // 10 seconds timeout - matches other timeout values
                });
                
                // Wait for either bridge initialization or timeout
                await Promise.race([
                    this.bridgeInitializationPromise,
                    timeoutPromise
                ]);
                
                console.error('[SANDBOX] Bridge setup complete (or timed out), proceeding with script execution');
                return true;
            } catch (error) {
                console.error('[SANDBOX] Bridge initialization error, continuing with NullBridge:', error);
                return false;
            }
        };
        
        // Start bridge initialization but don't block script execution if it takes too long
        await waitForBridge();

        this.emitDebug('Executing Node.js script:', scriptPath);
        const content = fs.readFileSync(scriptPath, 'utf8');
        
        // Enhanced module type detection
        const moduleTypeDetection = {
            // ES Module detection
            isESM: /(^|\n)\s*import\s|export\s/.test(content) || scriptPath.endsWith('.mjs'),
            // CommonJS detection
            isCJS: /(^|\n)\s*(?:const|let|var)\s+\w+\s*=\s*require\(/.test(content) || 
                   /(^|\n)\s*module\.exports\s*=/.test(content) || 
                   scriptPath.endsWith('.cjs'),
            // Bundle detection (webpack, rollup, etc.)
            isBundle: content.includes('e.exports=require(') || 
                      content.includes('require(') ||
                      content.includes('__webpack_require__') ||
                      /\(\s*function\s*\(\s*\)\s*\{\s*return/.test(content),
            // Check if using Node.js specific APIs
            usesNodeAPIs: content.includes('process.') || 
                          content.includes('Buffer.') || 
                          content.includes('__dirname') || 
                          content.includes('__filename')
        };
        
        this.emitDebug('Script analysis:', JSON.stringify(moduleTypeDetection));
        
        const nodeArgs = [];
        // Keep track of temporary files to clean up
        const tempFiles = [];

        // Apply interception hooks before running the script
        this.emitDebug('Applying interception hooks');
        try {
            await this.interceptor.applyHooks();
            this.emitDebug('Interception hooks applied successfully');
        } catch (error) {
            this.emitDebug('Error applying interception hooks:', error);
            throw new Error(`Failed to apply interception hooks: ${error.message}`);
        }

        // Determine the best way to run the script
        let originalPath = scriptPath;
        
        // For bundled scripts that use require(), force CommonJS mode
        if (moduleTypeDetection.isBundle) {
            this.emitDebug('Creating special wrapper for bundled script to enforce hard failure with NullBridge');
            const originalScriptContent = fs.readFileSync(scriptPath, 'utf8');
            const fileExt = path.extname(scriptPath);

            // Read the shim template
            const shimTemplatePath = path.resolve(__dirname, 'bundle_shim_template.js');
            let shimContent = fs.readFileSync(shimTemplatePath, 'utf8');

            // Replace placeholders
            shimContent = shimContent.replace(/%%SCRIPT_PATH%%/g, scriptPath.replace(/\\/g, '\\\\')); // Escape backslashes in path for string literal
            // Make sure to properly check bridge status to avoid calling non-existent methods
            const isBridgeNullOrDisconnected = 
                !this.bridge || 
                this.bridge.constructor.name === 'NullBridge' || 
                (typeof this.bridge.isConnected === 'function' && !this.bridge.isConnected());
            
            shimContent = shimContent.replace(/%%IS_BRIDGE_NULL_OR_DISCONNECTED%%/g, isBridgeNullOrDisconnected.toString());
            shimContent = shimContent.replace(/%%ORIGINAL_SCRIPT_CONTENT%%/g, originalScriptContent);

            const wrapperContent = shimContent; // Assign the processed content

            const wrapperExt = '.bundle-wrapper.cjs';
            const baseName = path.basename(scriptPath, fileExt);
            const wrapperPath = path.join(path.dirname(scriptPath), baseName + wrapperExt);
            
            fs.writeFileSync(wrapperPath, wrapperContent, 'utf8');
            this.emitDebug(`Created bundle wrapper: ${wrapperPath}`);
            
            scriptPath = wrapperPath;
            tempFiles.push(wrapperPath); // Ensure this temporary wrapper is cleaned up
            
            nodeArgs.push('--no-warnings');
            nodeArgs.push(scriptPath);
        }
        // For CommonJS scripts that are NOT bundles, or if isCJS is true but isBundle is false
        else if (moduleTypeDetection.isCJS) {
            this.emitDebug('Using CommonJS compatibility mode');
            const fileExt = path.extname(scriptPath);
            
            // Create a temporary copy with .cjs extension to force CommonJS mode
            if (fileExt !== '.cjs') {
                // Create a temporary copy with .cjs extension to force CommonJS mode
                const cjsPath = scriptPath.replace(fileExt, '.cjs');
                fs.copyFileSync(scriptPath, cjsPath);
                // Use the .cjs file instead
                scriptPath = cjsPath;
                tempFiles.push(cjsPath);
            }
            
            // Add any necessary flags for CommonJS scripts
            nodeArgs.push('--no-warnings');
            nodeArgs.push(scriptPath);
        } 
        // For pure ES modules or scripts explicitly marked as ESM
        else if (moduleTypeDetection.isESM) {
            this.emitDebug('Using ES Module mode');
            nodeArgs.push('--experimental-vm-modules');
            nodeArgs.push('--no-warnings');
            nodeArgs.push(scriptPath);
        } 
        // For scripts with an ambiguous module type, try to run directly
        else {
            this.emitDebug('Using direct execution mode');
            nodeArgs.push('--no-warnings');
            
            // Try to add compatibility flags
            if (moduleTypeDetection.usesNodeAPIs) {
                nodeArgs.push('--require=node:module');
            }
            
            nodeArgs.push(scriptPath);
        }

        return new Promise((resolve) => {
            const child = spawn(process.execPath, nodeArgs, {
                cwd: path.dirname(originalPath || scriptPath),
                env: { 
                    ...process.env, 
                    ...this.envVars,
                    NODE_NO_WARNINGS: '1'
                },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // Configuration des streams
            child.stdin.setEncoding('utf-8');
            child.stdout.setEncoding('utf-8');
            child.stderr.setEncoding('utf-8');

            child.stdout.on('data', (data) => {
                const dataStr = data.toString();
                this.emitDebug('Raw stdout from script:', dataStr);
                // Forward to bridge if connected
                if (this.bridge && this.bridge.isConnected()) {
                    this.bridge.handleStdio('stdout', { message: dataStr });
                } else if (this.bridge instanceof Bridge) { // Bridge exists but not connected
                    // Log locally or queue if necessary
                    console.log('[Script stdout - Bridge not connected]:', dataStr);
                    // Optionally, the bridge could have a local emit for its own logging
                    // this.bridge.emit('stdout', { message: `[SCRIPT_STDOUT_OFFLINE] ${dataStr}` });
                } else {
                    console.log('[Script stdout - No real bridge]:', dataStr);
                }
            });

            child.stderr.on('data', (data) => {
                const dataStr = data.toString();
                console.error('[Script Error from child]:', dataStr);
                if (this.bridge && this.bridge.isConnected()) {
                    this.bridge.handleStdio('stderr', { message: dataStr });
                } else if (this.bridge instanceof Bridge) { // Bridge exists but not connected
                    console.error('[Script stderr - Bridge not connected]:', dataStr);
                    // this.bridge.emit('stderr', { message: `[SCRIPT_STDERR_OFFLINE] ${dataStr}` });
                } else {
                    console.error('[Script stderr - No real bridge]:', dataStr);
                }
            });

            // Clean up on exit
            child.on('exit', () => {
                for (const file of tempFiles) {
                    try {
                        if (fs.existsSync(file)) {
                            fs.unlinkSync(file);
                            this.emitDebug(`Temporary file removed: ${file}`);
                        }
                    } catch (err) {
                        this.emitDebug(`Could not remove temporary file (${file}): ${err.message}`);
                    }
                }
            });

            // Return process controller immediately
            const processController = {
                process: child,
                stdin: child.stdin,
                stdout: child.stdout,
                stderr: child.stderr,
                stop: async () => {
                    try {
                        if (process.platform === 'win32') {
                            const taskkill = spawn('taskkill', ['/pid', child.pid, '/T', '/F']);
                            await new Promise((resolveKill, rejectKill) => {
                                taskkill.on('close', (code) => {
                                    if (code === 0) {
                                        resolveKill();
                                    } else {
                                        rejectKill(new Error(`taskkill exited with code ${code}`));
                                    }
                                });
                            });
                        } else {
                            child.kill('SIGTERM');
                        }
                    } catch (err) {
                        console.error('Erreur lors de l\'arrêt du processus:', err);
                        child.kill('SIGKILL');
                    }
                }
            };

            resolve(processController);
        });
    }

    // Exécute un script dans la sandbox
    runScript(scriptPath, envVars = {}) {
        const ext = path.extname(scriptPath).toLowerCase();
        
        if (ext === '.py') {
            console.log('Python support not implemented in simplified version');
            return Promise.resolve(null);
        } else {
            return this.runNodeScript(scriptPath);
        }
    }

    // Clean up resources when the sandbox is destroyed
    async cleanup() {
        // Reset interception hooks if available
        this.emitDebug('Resetting interception hooks');
        await this.interceptor.resetHooks();
        
        // Disconnect bridge
        if (this.bridge && this.bridge.isConnected()) {
            this.bridge.setConnected(false);
        }
    }
}

export { Sandbox }; 