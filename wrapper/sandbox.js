const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Bridge = require('./bridge');

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
                if (id === 'fs') return this.createFsProxy();
                if (id === 'http' || id === 'https') return networkProxy[id];
                if (id === 'path') {
                    return {
                        ...path,
                        resolve: (...parts) => '/' + path.relative(this.rootDir, this.resolveSandboxPath(path.join(...parts))),
                        join: (...parts) => '/' + path.relative(this.rootDir, this.resolveSandboxPath(path.join(...parts)))
                    };
                }
                return require(id);
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
        return new Promise((resolve, reject) => {
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

                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Script Python terminé avec le code ${code}`));
                }
            });
        });
    }

    // Exécute un script Node.js
    runNodeScript(scriptPath) {
        const vm = require('vm');
        // Copier le script dans la sandbox
        const content = fs.readFileSync(scriptPath, 'utf8');
        const context = vm.createContext(this.prepareEnvironment());
        const script = new vm.Script(content, { filename: '/script.js' });
        script.runInContext(context);
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

module.exports = { Sandbox }; 