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
        
        // Use a null bridge by default
        this.bridge = new NullBridge();
        
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
        process.on('message', (message) => {
            if (message.type === 'bridge_register') {
                console.error('[SANDBOX] Bridge registration received:', message.bridgeId);
                
                // Create a real bridge and swap it in
                const realBridge = new Bridge();
                realBridge.setBridgeId(message.bridgeId);
                realBridge.setConnected(true);
                
                // Swap the bridge
                this.setBridge(realBridge);
                
                console.error('[SANDBOX] Bridge swapped:', this.bridge.isConnected());
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
        if (newBridge instanceof Bridge) {
            // Configure the bridge handlers
            this._setupBridgeInterceptorHandlers();
        }
        
        // Return the old bridge in case it needs to be cleaned up
        return oldBridge;
    }

    // Setup handlers for the bridge to interact with the interceptor
    _setupBridgeInterceptorHandlers() {
        console.error('[SANDBOX] Setting up bridge handlers');
        
        // Only set up handlers if we have a real bridge
        if (!(this.bridge instanceof Bridge)) {
            console.error('[SANDBOX] Not setting up handlers for null bridge');
            return;
        }
        
        // Add handlers for the Bridge to handle intercepted calls
        this.bridge.onStdout(({ message }) => console.log('[Script]', message));
        this.bridge.onStderr(({ message }) => console.error('[Script]', message));
        this.bridge.onError(({ source, error }) => console.error(`[${source}]`, error));

        // Add network handlers with custom test response
        this.bridge.onFetch(async (request) => {
            this.emitDebug('Fetch intercepted:', request.url);
            // Return a custom test response to verify interception is working
            return {
                statusCode: 200,
                headers: { 
                    'content-type': 'application/json',
                    'x-intercept-test': 'true',
                    'server': 'NodeInterceptor-TestServer/1.0'
                },
                body: JSON.stringify({
                    message: "This is a test response from NodeInterceptor",
                    intercepted: true,
                    timestamp: new Date().toISOString(),
                    requestUrl: request.url,
                    requestMethod: request.options?.method || 'GET'
                }, null, 2)
            };
        });
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
            shimContent = shimContent.replace(/%%IS_BRIDGE_NULL_OR_DISCONNECTED%%/g, (this.bridge.constructor.name === 'NullBridge' || !this.bridge.isConnected()).toString());
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
                this.emitDebug('Raw stdout:', dataStr);
                // Forward to bridge if connected
                if (this.bridge) {
                    this.bridge.emit('stdout', { message: dataStr });
                }
            });

            child.stderr.on('data', (data) => {
                console.error('[Script Error]', data.toString());
                if (this.bridge) {
                    this.bridge.emit('stderr', { message: data.toString() });
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