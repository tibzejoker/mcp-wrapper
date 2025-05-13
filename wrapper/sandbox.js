import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Bridge } from './bridge.js';
import vm from 'vm';

class Sandbox {
    constructor(rootDir, envVars = {}) {
        this.rootDir = path.resolve(rootDir);
        this.envVars = envVars;
        this.bridge = new Bridge();

        // Configuration par défaut du bridge
        this.bridge.onStdout(({ message }) => console.log('[Script]', message));
        this.bridge.onStderr(({ message }) => console.error('[Script]', message));
        this.bridge.onError(({ source, error }) => console.error(`[${source}]`, error));
        
        // Par défaut, bloquer toutes les requêtes réseau
        this.bridge.onFetch(() => false);
        this.bridge.onConnect(() => false);
        this.bridge.onDns(() => false);

        // Listen for bridge registration
        process.on('message', (message) => {
            if (message.type === 'bridge_register') {
                console.error('[SANDBOX] Bridge registration received:', message.bridgeId);
                this.bridge.setBridgeId(message.bridgeId);
                this.bridge.setConnected(true);
                console.error('[SANDBOX] Bridge connection status updated:', this.bridge.isConnected());
            }
        });
    }

    // Getter pour accéder au bridge
    getBridge() {
        return this.bridge;
    }

    // Convertit un chemin sandbox en chemin réel
    resolveSandboxPath(filePath) {
        const normalizedPath = path.normalize(filePath);
        if (normalizedPath.startsWith('/')) {
            return path.join(this.rootDir, normalizedPath.slice(1));
        }
        return path.join(this.rootDir, normalizedPath);
    }

    // Convertit un chemin réel en chemin sandbox
    toSandboxPath(realPath) {
        return '/' + path.relative(this.rootDir, realPath).replace(/\\/g, '/');
    }

    // Masque les chemins réels dans les messages d'erreur
    maskErrorMessage(error) {
        if (!error.message) return error;
        let message = error.message;
        // Remplacer les chemins Windows complets
        message = message.replace(new RegExp(this.rootDir.replace(/\\/g, '\\\\'), 'g'), '');
        message = message.replace(/[A-Z]:\\[^'"]*/g, (match) => {
            return '/' + path.relative(this.rootDir, match).replace(/\\/g, '/');
        });
        error.message = message;
        return error;
    }

    // Vérifie si un chemin est dans le rootDir
    isPathAllowed(filePath) {
        const resolvedPath = this.resolveSandboxPath(filePath);
        return resolvedPath.startsWith(this.rootDir);
    }

    // Crée un proxy pour intercepter les appels réseau
    createNetworkProxy() {
        const sandbox = this;
        
        const handleRequest = async (url, options = {}) => {
            const allowed = await sandbox.bridge.handleFetch({ url, ...options });
            if (!allowed) {
                throw new Error('Accès réseau non autorisé dans la sandbox');
            }
            
            // Simuler une réponse HTTP
            const mockResponse = {
                status: 200,
                statusCode: 200,
                headers: { 'content-type': 'application/json' },
                on: (event, callback) => {
                    if (event === 'data') {
                        callback(Buffer.from(JSON.stringify({ message: 'Réponse simulée' })));
                    }
                    if (event === 'end') {
                        callback();
                    }
                },
                json: () => Promise.resolve({ message: 'Réponse simulée' }),
                text: () => Promise.resolve('Réponse simulée'),
                body: { message: 'Réponse simulée' }
            };

            return mockResponse;
        };

        // Proxy pour http et https
        const httpProxy = {
            get: (url, callback) => {
                const req = {
                    on: (event, handler) => {
                        if (event === 'error') {
                            // Ne rien faire, la requête est simulée
                        }
                    },
                    end: () => {
                        handleRequest(url)
                            .then(response => callback(response))
                            .catch(error => {
                                const errorEvent = { on: (type, handler) => handler() };
                                callback(errorEvent);
                            });
                    }
                };
                return req;
            },
            request: (url, options, callback) => {
                if (typeof options === 'function') {
                    callback = options;
                    options = {};
                }
                const req = {
                    on: (event, handler) => {
                        if (event === 'error') {
                            // Ne rien faire, la requête est simulée
                        }
                    },
                    end: () => {
                        handleRequest(url, options)
                            .then(response => callback(response))
                            .catch(error => {
                                const errorEvent = { on: (type, handler) => handler() };
                                callback(errorEvent);
                            });
                    }
                };
                return req;
            },
            createServer: () => {
                throw new Error('Création de serveur non autorisée dans la sandbox');
            }
        };

        // Proxy pour fetch
        const fetchProxy = (url, options) => handleRequest(url, options);

        return { http: httpProxy, https: httpProxy, fetch: fetchProxy };
    }

    // Crée un proxy pour intercepter les appels fs
    createFsProxy() {
        const sandbox = this;
        return new Proxy(fs, {
            get(target, prop) {
                const original = target[prop];
                if (typeof original !== 'function') return original;

                return function (...args) {
                    let filePath = args[0];
                    if (typeof filePath === 'string') {
                        const sandboxPath = sandbox.resolveSandboxPath(filePath);
                        if (!sandbox.isPathAllowed(sandboxPath)) {
                            throw new Error(`Accès refusé: ${filePath} est en dehors de la racine`);
                        }
                        args[0] = sandboxPath;
                    }
                    try {
                        return original.apply(target, args);
                    } catch (error) {
                        throw sandbox.maskErrorMessage(error);
                    }
                };
            }
        });
    }

    // Crée une version modifiée de console pour la sandbox
    createConsoleProxy() {
        return {
            log: (...args) => console.log('[Script]', ...args),
            error: (...args) => console.error('[Script]', ...args),
            warn: (...args) => console.warn('[Script]', ...args),
            info: (...args) => console.info('[Script]', ...args),
            debug: (...args) => console.debug('[Script]', ...args)
        };
    }

    // Prépare l'environnement pour le script Node.js
    prepareEnvironment() {
        const networkProxy = this.createNetworkProxy();
        
        const env = {
            fs: this.createFsProxy(),
            require: (id) => {
                throw new Error('require() n\'est pas supporté en mode ES module dans la sandbox.');
            },
            console: this.createConsoleProxy(),
            __dirname: '/',
            __filename: '/' + path.basename(process.argv[1]),
            process: {
                ...process,
                cwd: () => '/',
                env: {
                    ...process.env,
                    ...this.envVars,
                    SANDBOX_ROOT: '/'
                }
            },
            fetch: networkProxy.fetch,
            Buffer: Buffer,
            setTimeout: setTimeout,
            setInterval: setInterval,
            setImmediate: setImmediate,
            clearTimeout: clearTimeout,
            clearInterval: clearInterval,
            clearImmediate: clearImmediate
        };

        Object.getOwnPropertyNames(global).forEach(prop => {
            if (!env[prop]) env[prop] = global[prop];
        });

        return env;
    }

    // Exécute un script Python
    runPythonScript(scriptPath) {
        return new Promise((resolve) => {
            // Créer le dossier de la sandbox s'il n'existe pas
            if (!fs.existsSync(this.rootDir)) {
                fs.mkdirSync(this.rootDir, { recursive: true });
            }

            const sandboxedScriptPath = this.resolveSandboxPath('script.py');
            const content = fs.readFileSync(scriptPath, 'utf8');
            fs.writeFileSync(sandboxedScriptPath, content, 'utf8');
            
            const wrapperCode = `# -*- coding: utf-8 -*-
import os
import sys
import posixpath
import traceback
import socket
import urllib.request
import http.client

# Bloquer les connexions réseau
def block_network(*args, **kwargs):
    raise Exception("Accès réseau non autorisé dans la sandbox")

# Patcher les modules réseau
socket.socket = block_network
urllib.request.urlopen = block_network
http.client.HTTPConnection = block_network
http.client.HTTPSConnection = block_network

# Redéfinir la racine comme /
ROOT_DIR = '${this.rootDir.replace(/\\/g, '\\\\')}'

# Surcharger os.environ pour masquer les chemins
original_environ = dict(os.environ)
os.environ = {
    k: v.replace(ROOT_DIR, '/').replace('\\\\', '/') if isinstance(v, str) else v
    for k, v in original_environ.items()
}

# Surcharger os.getcwd
os.getcwd = lambda: '/'

# Surcharger os.path.abspath
original_abspath = os.path.abspath
os.path.abspath = lambda path: '/' + os.path.relpath(original_abspath(path), ROOT_DIR).replace('\\\\', '/')

# Surcharger os.path pour utiliser des chemins POSIX
os.path = posixpath

def to_sandbox_path(real_path):
    if not real_path.startswith(ROOT_DIR):
        return real_path
    rel_path = os.path.relpath(real_path, ROOT_DIR)
    return '/' + rel_path.replace('\\\\', '/')

def mask_error_message(error):
    if not hasattr(error, 'filename') or not error.filename:
        return error
    if hasattr(error, 'message'):
        error.message = error.message.replace(ROOT_DIR, '/').replace('\\\\', '/')
    if hasattr(error, 'strerror'):
        error.strerror = str(error.strerror).replace(ROOT_DIR, '/').replace('\\\\', '/')
    error.filename = to_sandbox_path(error.filename)
    return error

def resolve_sandbox_path(path):
    if path.startswith('/'):
        return os.path.join(ROOT_DIR, path[1:])
    return os.path.join(ROOT_DIR, path)

def is_path_allowed(path):
    resolved = resolve_sandbox_path(path)
    return resolved.startswith(ROOT_DIR)

# Surcharger les fonctions d'accès aux fichiers
original_open = open
def sandboxed_open(file, *args, **kwargs):
    try:
        sandbox_path = resolve_sandbox_path(file)
        if not is_path_allowed(sandbox_path):
            raise PermissionError(f"Accès refusé: {file} est en dehors de la racine")
        return original_open(sandbox_path, *args, **kwargs)
    except Exception as e:
        raise mask_error_message(e)

# Surcharger os.makedirs et autres fonctions os
original_makedirs = os.makedirs
def sandboxed_makedirs(path, *args, **kwargs):
    try:
        sandbox_path = resolve_sandbox_path(path)
        if not is_path_allowed(sandbox_path):
            raise PermissionError(f"Accès refusé: {path} est en dehors de la racine")
        return original_makedirs(sandbox_path, *args, **kwargs)
    except Exception as e:
        raise mask_error_message(e)

# Surcharger os.remove
original_remove = os.remove
def sandboxed_remove(path, *args, **kwargs):
    try:
        sandbox_path = resolve_sandbox_path(path)
        if not is_path_allowed(sandbox_path):
            raise PermissionError(f"Accès refusé: {path} est en dehors de la racine")
        return original_remove(sandbox_path, *args, **kwargs)
    except Exception as e:
        raise mask_error_message(e)

# Appliquer les surcharges
open = sandboxed_open
os.makedirs = sandboxed_makedirs
os.remove = sandboxed_remove

# Exécuter le script utilisateur avec gestion des erreurs
try:
    with open('/script.py', 'r', encoding='utf-8') as f:
        exec(f.read())
except Exception as e:
    print(f"Erreur: {mask_error_message(e)}")
    sys.exit(1)
`;
            
            const wrapperPath = path.join(this.rootDir, '_sandbox_wrapper.py');
            fs.writeFileSync(wrapperPath, wrapperCode, 'utf8');

            const pythonProcess = spawn('python', [wrapperPath], {
                cwd: this.rootDir,
                env: {
                    ...process.env,
                    ...this.envVars,
                    SANDBOX_ROOT: '/',
                    PYTHONPATH: this.rootDir,
                    PYTHONIOENCODING: 'utf-8'
                }
            });

            pythonProcess.stdout.on('data', (data) => {
                console.log('[Script]', data.toString('utf8').trim());
            });

            pythonProcess.stderr.on('data', (data) => {
                // Masquer les chemins dans les messages d'erreur
                let message = data.toString('utf8');
                message = message.replace(new RegExp(this.rootDir.replace(/\\/g, '\\\\'), 'g'), '');
                message = message.replace(/[A-Z]:\\[^'"\\n]*/g, (match) => {
                    return '/' + path.relative(this.rootDir, match).replace(/\\/g, '/');
                });
                console.error('[Script]', message.trim());
            });

            pythonProcess.on('close', (code) => {
                try {
                    fs.unlinkSync(wrapperPath);
                    fs.unlinkSync(sandboxedScriptPath);
                } catch (err) {
                    console.warn('Impossible de supprimer les fichiers temporaires:', err);
                }
            });

            // Retourner immédiatement le contrôleur de processus
            resolve({
                process: pythonProcess,
                stop: () => {
                    pythonProcess.kill();
                    try {
                        fs.unlinkSync(wrapperPath);
                        fs.unlinkSync(sandboxedScriptPath);
                    } catch (err) {
                        console.warn('Impossible de supprimer les fichiers temporaires:', err);
                    }
                }
            });
        });
    }

    // Helper method to log debug messages
    emitDebug(...args) {
        console.error(['[SANDBOX]', ...args].join(' '));
    }

    // Exécute un script Node.js
    async runNodeScript(scriptPath) {
        this.emitDebug('Executing Node.js script:', scriptPath);
        const content = fs.readFileSync(scriptPath, 'utf8');
        
        // Détection du type de module
        const isESModule = /(^|\n)\s*import\s|export\s/m.test(content);
        const nodeArgs = [];

        // Configuration spécifique selon le type de module
        if (isESModule) {
            // Pour les modules ES, on crée un wrapper temporaire
            const wrapperContent = `
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';
import { spawn } from 'child_process';

// Setup global require for ES modules
global.require = createRequire(import.meta.url);

// Setup __filename and __dirname for ES modules
global.__filename = fileURLToPath(import.meta.url);
global.__dirname = dirname(global.__filename);

// Convert the path to a proper file URL
const scriptUrl = new URL('file://' + '${scriptPath.replace(/\\/g, '/')}');

// Create a proxy for all network requests
const networkProxy = {
    fetch: async (url, options = {}) => {
        // Send request details to parent process
        const request = {
            type: 'fetch',
            url,
            options
        };
        return new Promise((resolve, reject) => {
            const requestId = Date.now();
            process.stdout.write(JSON.stringify({
                jsonrpc: '2.0',
                method: 'bridge_request',
                id: requestId,
                params: request
            }) + '\\n');

            // Set up response handler
            const responseHandler = (data) => {
                try {
                    const response = JSON.parse(data);
                    if (response.jsonrpc === '2.0' && response.id === requestId) {
                        if (response.error) {
                            reject(new Error(response.error.message));
                        } else {
                            resolve(response.result);
                        }
                        process.stdin.removeListener('data', responseHandler);
                    }
                } catch (e) {
                    // Ignore non-JSON or unrelated messages
                }
            };

            process.stdin.on('data', responseHandler);
        });
    }
};

// Setup message handling from parent process
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
    try {
        const message = JSON.parse(data);
        if (message.jsonrpc === '2.0') {
            if (message.error) {
                console.error('[Bridge Error]', message.error.message);
            }
        }
    } catch (error) {
        // Ignore parse errors for non-JSON messages
    }
});

// Inject proxies into global scope
global.fetch = networkProxy.fetch;

// Import and run the actual script
import(scriptUrl)
    .catch(error => {
        console.error('Error importing script:', error);
        process.exit(1);
    });
`;
            const wrapperPath = path.join(path.dirname(scriptPath), '_es_wrapper.mjs');
            fs.writeFileSync(wrapperPath, wrapperContent, 'utf8');
            nodeArgs.push('--experimental-vm-modules');
            nodeArgs.push(wrapperPath);
        } else {
            nodeArgs.push(scriptPath);
        }

        return new Promise((resolve) => {
            const child = spawn(process.execPath, nodeArgs, {
                cwd: path.dirname(scriptPath),
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

            // Écouter les sorties du processus
            child.stdout.on('data', (data) => {
                try {
                    this.emitDebug('Raw stdout:', data.toString());
                    const message = JSON.parse(data.toString());
                    this.emitDebug('Parsed message:', JSON.stringify(message, null, 2));
                    
                    if (message.jsonrpc === '2.0') {
                        this.emitDebug('Bridge connection status:', this.bridge?.isConnected());
                        this.emitDebug('Bridge instance exists:', !!this.bridge);
                        
                        // Handle both bridge requests and direct JSON-RPC methods
                        if (message.method === 'bridge_request') {
                            this.emitDebug('Handling bridge_request');
                            // Check if bridge is connected
                            if (!this.bridge || !this.bridge.isConnected()) {
                                this.emitDebug('Bridge not connected, sending error response');
                                const response = {
                                    jsonrpc: '2.0',
                                    id: message.id,
                                    error: {
                                        code: -32001,
                                        message: 'Bridge not connected',
                                        data: {
                                            details: 'Operation cannot be executed because the bridge is not connected.',
                                            requestType: message.params.type
                                        }
                                    }
                                };
                                this.emitDebug('Error response:', JSON.stringify(response, null, 2));
                                child.stdin.write(JSON.stringify(response) + '\n');
                                return;
                            }

                            this.emitDebug('Routing request through bridge');
                            // Route the request through the bridge
                            const { type, ...params } = message.params;
                            this.bridge.handleRequest(type, params)
                                .then(response => {
                                    this.emitDebug('Bridge request succeeded:', JSON.stringify(response, null, 2));
                                    child.stdin.write(JSON.stringify({
                                        jsonrpc: '2.0',
                                        id: message.id,
                                        result: response
                                    }) + '\n');
                                })
                                .catch(error => {
                                    this.emitDebug('Bridge request failed:', error);
                                    child.stdin.write(JSON.stringify({
                                        jsonrpc: '2.0',
                                        id: message.id,
                                        error: {
                                            code: -32000,
                                            message: error.message
                                        }
                                    }) + '\n');
                                });
                        } else if (message.method === 'tools/list') {
                            this.emitDebug('Handling tools/list');
                            // Check if bridge is connected for tools/list
                            this.emitDebug('Bridge exists:', !!this.bridge);
                            if (this.bridge) {
                                this.emitDebug('Bridge ID:', this.bridge.getBridgeId());
                                this.emitDebug('Bridge connected status:', this.bridge.isConnected());
                            }
                            if (!this.bridge || !this.bridge.isConnected()) {
                                this.emitDebug('Bridge not connected for tools/list, sending error response');
                                child.stdin.write(JSON.stringify({
                                    jsonrpc: '2.0',
                                    id: message.id,
                                    error: {
                                        code: -32001,
                                        message: 'Bridge not connected',
                                        data: {
                                            details: 'Tool listing is not available because the bridge is not connected.'
                                        }
                                    }
                                }) + '\n');
                                return;
                            }

                            this.emitDebug('Forwarding tools/list to bridge');
                            // Forward tools/list request to bridge
                            this.bridge.handleRequest('tool', { action: 'list' })
                                .then(tools => {
                                    this.emitDebug('Tools list received:', JSON.stringify(tools, null, 2));
                                    child.stdin.write(JSON.stringify({
                                        jsonrpc: '2.0',
                                        id: message.id,
                                        result: { tools }
                                    }) + '\n');
                                })
                                .catch(error => {
                                    this.emitDebug('Tools list failed:', error);
                                    child.stdin.write(JSON.stringify({
                                        jsonrpc: '2.0',
                                        id: message.id,
                                        error: {
                                            code: -32000,
                                            message: error.message
                                        }
                                    }) + '\n');
                                });
                        } else if (message.method === 'tools/call') {
                            this.emitDebug('Handling tools/call');
                            // Check if bridge is connected for tools/call
                            if (!this.bridge || !this.bridge.isConnected()) {
                                this.emitDebug('Bridge not connected for tools/call');
                                child.stdin.write(JSON.stringify({
                                    jsonrpc: '2.0',
                                    id: message.id,
                                    error: {
                                        code: -32001,
                                        message: 'Bridge not connected',
                                        data: {
                                            details: 'Tool execution is not available because the bridge is not connected.',
                                            tool: message.params?.name
                                        }
                                    }
                                }) + '\n');
                                return;
                            }

                            this.emitDebug('Forwarding tool call to bridge:', message.params?.name);
                            // Forward tool call to bridge
                            this.bridge.handleRequest('tool', { 
                                action: 'call',
                                ...message.params 
                            })
                                .then(result => {
                                    this.emitDebug('Tool call succeeded:', JSON.stringify(result, null, 2));
                                    child.stdin.write(JSON.stringify({
                                        jsonrpc: '2.0',
                                        id: message.id,
                                        result
                                    }) + '\n');
                                })
                                .catch(error => {
                                    this.emitDebug('Tool call failed:', error);
                                    child.stdin.write(JSON.stringify({
                                        jsonrpc: '2.0',
                                        id: message.id,
                                        error: {
                                            code: -32000,
                                            message: error.message
                                        }
                                    }) + '\n');
                                });
                        } else {
                            this.emitDebug('Unknown method:', message.method);
                            // Handle unknown methods
                            child.stdin.write(JSON.stringify({
                                jsonrpc: '2.0',
                                id: message.id,
                                error: {
                                    code: -32601,
                                    message: `Method not found: ${message.method}`
                                }
                            }) + '\n');
                        }
                    } else {
                        this.emitDebug('Non-JSON-RPC message:', data.toString());
                        // Forward regular stdout messages
                        if (this.bridge) {
                            this.bridge.emit('stdout', { message: data.toString() });
                        }
                    }
                } catch (e) {
                    this.emitDebug('Error processing message:', e);
                    this.emitDebug('Raw message that caused error:', data.toString());
                    // If parsing fails, treat as regular stdout
                    if (this.bridge) {
                        this.bridge.emit('stdout', { message: data.toString() });
                    }
                }
            });

            child.stderr.on('data', (data) => {
                console.log('[DEBUG] Erreur standard:', data.toString());
                if (this.bridge) {
                    this.bridge.handleStderr({ message: data.toString() });
                }
            });

            // Nettoyage du wrapper si nécessaire
            if (isESModule) {
                child.on('exit', () => {
                    const wrapperPath = path.join(path.dirname(scriptPath), '_es_wrapper.mjs');
                    try {
                        if (fs.existsSync(wrapperPath)) {
                            fs.unlinkSync(wrapperPath);
                            console.log(`Wrapper supprimé: ${wrapperPath}`);
                        } else {
                            console.log(`Le wrapper n'existe plus ou a déjà été supprimé: ${wrapperPath}`);
                        }
                    } catch (err) {
                        console.log(`Note: Impossible de supprimer le wrapper (${wrapperPath}), il a peut-être déjà été nettoyé`);
                    }
                });
            }

            // Retourner immédiatement le contrôleur de processus avec le processus complet
            const processController = {
                process: child,
                stdin: child.stdin,
                stdout: child.stdout,
                stderr: child.stderr,
                stop: async () => {
                    try {
                        if (process.platform === 'win32') {
                            const taskkill = spawn('taskkill', ['/pid', child.pid, '/T', '/F']);
                            await new Promise((resolve, reject) => {
                                taskkill.on('close', (code) => {
                                    if (code === 0) {
                                        resolve();
                                    } else {
                                        reject(new Error(`taskkill exited with code ${code}`));
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

            console.log('\n[DEBUG] Création du processus:');
            console.log('- child.stdin existe:', !!child.stdin);
            console.log('- processController.stdin existe:', !!processController.stdin);
            console.log('- Structure du processController:', JSON.stringify({
                hasProcess: !!processController.process,
                hasStdin: !!processController.stdin,
                stdinType: typeof processController.stdin
            }, null, 2));

            resolve(processController);
        });
    }

    // Exécute un script dans la sandbox
    runScript(scriptPath, envVars = {}) {
        const ext = path.extname(scriptPath).toLowerCase();
        
        if (ext === '.py') {
            return this.runPythonScript(scriptPath);
        } else {
            return this.runNodeScript(scriptPath);
        }
    }
}

export { Sandbox }; 