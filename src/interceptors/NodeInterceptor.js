/**
 * NodeInterceptor class for intercepting Node.js API calls and redirecting them to a Flutter bridge
 */
class NodeInterceptor {
    static instance = null;

    constructor(options = {}) {
        this.options = {
            debug: options.debug || false,
            proxyEndpoint: options.proxyEndpoint || null,
            bridge: options.bridge || null,
            autoApply: options.autoApply !== undefined ? options.autoApply : true
        };

        this.bridge = this.options.bridge;
        this.interceptedModules = new Map();
        this.moduleHooks = new Map();

        // Setup interceptors for common Node.js modules
        this._setupModuleHooks();

        if (this.options.autoApply) {
            this.applyHooks();
        }

        // For debugging
        if (this.options.debug) {
            console.error('[NodeInterceptor] Initialized with options:', this.options);
        }
    }

    /**
     * Set up the interception hooks for Node.js core modules
     * @private
     */
    _setupModuleHooks() {
        // File system operations
        this.registerModuleHook('fs', {
            readFile: this._interceptFsReadFile.bind(this),
            writeFile: this._interceptFsWriteFile.bind(this),
            readdir: this._interceptFsReaddir.bind(this),
            stat: this._interceptFsStat.bind(this),
            mkdir: this._interceptFsMkdir.bind(this),
            rmdir: this._interceptFsRmdir.bind(this),
            unlink: this._interceptFsUnlink.bind(this)
        });

        // HTTP operations
        this.registerModuleHook('http', {
            request: this._interceptHttpRequest.bind(this),
            get: this._interceptHttpGet.bind(this)
        });

        // HTTPS operations
        this.registerModuleHook('https', {
            request: this._interceptHttpsRequest.bind(this),
            get: this._interceptHttpsGet.bind(this)
        });

        // Child process operations
        this.registerModuleHook('child_process', {
            spawn: this._interceptChildProcessSpawn.bind(this),
            exec: this._interceptChildProcessExec.bind(this)
        });

        // Network operations
        this.registerModuleHook('dns', {
            lookup: this._interceptDnsLookup.bind(this),
            resolve: this._interceptDnsResolve.bind(this)
        });
    }

    /**
     * Register hooks for a specific module
     * @param {string} moduleName - Name of the module to hook
     * @param {Object} hooks - Object mapping function names to interceptor functions
     */
    registerModuleHook(moduleName, hooks) {
        this.moduleHooks.set(moduleName, hooks);
        
        if (this.options.debug) {
            console.error(`[NodeInterceptor] Registered hooks for module: ${moduleName}`, Object.keys(hooks));
        }
    }

    /**
     * Apply all registered hooks
     */
    applyHooks() {
        // Make interception hooks active
        const originalRequire = Module.prototype.require;
        
        Module.prototype.require = (id) => {
            const originalModule = originalRequire.call(this, id);
            
            if (this.moduleHooks.has(id)) {
                const hooks = this.moduleHooks.get(id);
                
                // If we haven't intercepted this module instance yet
                if (!this.interceptedModules.has(originalModule)) {
                    const intercepted = { ...originalModule };
                    
                    // Apply hooks to the module
                    for (const [fnName, interceptFn] of Object.entries(hooks)) {
                        if (typeof originalModule[fnName] === 'function') {
                            intercepted[fnName] = (...args) => {
                                return interceptFn(originalModule[fnName], ...args);
                            };
                        }
                    }
                    
                    this.interceptedModules.set(originalModule, intercepted);
                    return intercepted;
                }
                
                return this.interceptedModules.get(originalModule);
            }
            
            return originalModule;
        };
        
        if (this.options.debug) {
            console.error('[NodeInterceptor] Applied all hooks');
        }
    }

    /**
     * Set the bridge used for intercepted calls
     * @param {Object} bridge - The bridge instance
     */
    setBridge(bridge) {
        this.bridge = bridge;
        
        if (this.options.debug) {
            console.error('[NodeInterceptor] Bridge updated:', bridge?.constructor?.name || 'null');
        }
    }

    /**
     * Handle intercepted calls by forwarding them to the bridge
     * @param {string} type - The type of intercepted call
     * @param {Object} payload - The call payload
     * @returns {Promise<any>} - The result of the bridge call
     */
    async handleInterceptedCall(type, payload) {
        if (!this.bridge) {
            throw new Error('No bridge available for intercepted call');
        }
        
        if (this.options.debug) {
            console.error(`[NodeInterceptor] Intercepted ${type} call:`, payload);
        }
        
        return this.bridge.sendRequest(type, payload);
    }

    // Interceptor implementations for each module
    
    // FS module interceptors
    async _interceptFsReadFile(original, path, options, callback) {
        try {
            const result = await this.handleInterceptedCall('fs_read', { path, options });
            if (callback) {
                callback(null, result);
                return;
            }
            return result;
        } catch (error) {
            if (callback) {
                callback(error);
                return;
            }
            throw error;
        }
    }

    async _interceptFsWriteFile(original, path, data, options, callback) {
        try {
            const result = await this.handleInterceptedCall('fs_write', { path, data, options });
            if (callback) {
                callback(null, result);
                return;
            }
            return result;
        } catch (error) {
            if (callback) {
                callback(error);
                return;
            }
            throw error;
        }
    }

    async _interceptFsReaddir(original, path, options, callback) {
        try {
            const result = await this.handleInterceptedCall('fs_list', { path, options });
            if (callback) {
                callback(null, result);
                return;
            }
            return result;
        } catch (error) {
            if (callback) {
                callback(error);
                return;
            }
            throw error;
        }
    }

    async _interceptFsStat(original, path, options, callback) {
        try {
            const result = await this.handleInterceptedCall('fs_stat', { path, options });
            if (callback) {
                callback(null, result);
                return;
            }
            return result;
        } catch (error) {
            if (callback) {
                callback(error);
                return;
            }
            throw error;
        }
    }

    async _interceptFsMkdir(original, path, options, callback) {
        try {
            const result = await this.handleInterceptedCall('fs_mkdir', { path, options });
            if (callback) {
                callback(null, result);
                return;
            }
            return result;
        } catch (error) {
            if (callback) {
                callback(error);
                return;
            }
            throw error;
        }
    }

    async _interceptFsRmdir(original, path, options, callback) {
        try {
            const result = await this.handleInterceptedCall('fs_rmdir', { path, options });
            if (callback) {
                callback(null, result);
                return;
            }
            return result;
        } catch (error) {
            if (callback) {
                callback(error);
                return;
            }
            throw error;
        }
    }

    async _interceptFsUnlink(original, path, options, callback) {
        try {
            const result = await this.handleInterceptedCall('fs_unlink', { path, options });
            if (callback) {
                callback(null, result);
                return;
            }
            return result;
        } catch (error) {
            if (callback) {
                callback(error);
                return;
            }
            throw error;
        }
    }

    // HTTP module interceptors
    async _interceptHttpRequest(original, ...args) {
        // Implementation for HTTP request interception
        return original(...args);
    }

    async _interceptHttpGet(original, ...args) {
        // Implementation for HTTP get interception
        return original(...args);
    }

    // HTTPS module interceptors
    async _interceptHttpsRequest(original, ...args) {
        // Implementation for HTTPS request interception
        return original(...args);
    }

    async _interceptHttpsGet(original, ...args) {
        // Implementation for HTTPS get interception
        return original(...args);
    }

    // Child process interceptors
    async _interceptChildProcessSpawn(original, ...args) {
        // Implementation for child_process spawn interception
        return original(...args);
    }

    async _interceptChildProcessExec(original, ...args) {
        // Implementation for child_process exec interception
        return original(...args);
    }

    // DNS module interceptors
    async _interceptDnsLookup(original, ...args) {
        // Implementation for DNS lookup interception
        return original(...args);
    }

    async _interceptDnsResolve(original, ...args) {
        // Implementation for DNS resolve interception
        return original(...args);
    }
}

// Add Module reference if it's not available
let Module;
try {
    Module = require('module');
} catch (e) {
    // If we can't get the Module object, create a stub that won't break
    Module = { 
        prototype: { 
            require: function(id) { 
                return require(id); 
            } 
        } 
    };
    console.error('[NodeInterceptor] Warning: Could not load Node.js Module object for hooking require.');
}

export { NodeInterceptor }; 