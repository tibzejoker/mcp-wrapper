// MCP Wrapper: Bundle Interception Shim (NullBridge Hard Fail)
// Original script: %%SCRIPT_PATH%%

console.log('[MCP-BUNDLE-SHIM] Initializing for %%SCRIPT_PATH%%');

const mcp_bridge_is_null_or_disconnected = %%IS_BRIDGE_NULL_OR_DISCONNECTED%%;

if (mcp_bridge_is_null_or_disconnected) {
    console.error('[MCP-BUNDLE-SHIM] NullBridge or disconnected bridge detected. Network calls will fail hard.');
}

const http = require('http');
const https = require('https');
// Note: 'fetch' is typically global, but we'll check for its existence.

const originalHttpRequest = http.request;
const originalHttpGet = http.get;
const originalHttpsRequest = https.request;
const originalHttpsGet = https.get;
const originalFetch = (typeof fetch === 'function' ? fetch : null);

function createBlockedRequest(type, url) {
    const msg = '[MCP-BUNDLE-SHIM] Network request (' + type + ') to "' + url + '" blocked - No active bridge.';
    console.error(msg);
    const err = new Error(msg);
    err.code = 'ECONNREFUSED'; // Simulate a connection refused error

    // Emulate a request object that errors out
    const EventEmitter = require('events');
    const fakeReq = new EventEmitter();

    // Ensure error is emitted on the next tick to allow event listeners to be set up
    fakeReq.end = () => { process.nextTick(() => fakeReq.emit('error', err)); return fakeReq; };
    fakeReq.write = () => { /* no-op */ return fakeReq; }; // Write does nothing for a blocked request
    fakeReq.abort = () => { /* no-op */ }; // Abort does nothing

    // For http.get, a callback is often directly passed, or it returns a ClientRequest.
    // We will make it emit 'error' directly.
    return fakeReq;
}

http.request = function(urlOrOptions, optionsOrCallback, callback) {
    let urlString = '';
    if (typeof urlOrOptions === 'string') {
        urlString = urlOrOptions;
    } else if (urlOrOptions) {
        if (typeof urlOrOptions.href === 'string') {
            urlString = urlOrOptions.href;
        } else if (typeof urlOrOptions.hostname === 'string') {
            const protocol = urlOrOptions.protocol || 'http:';
            const port = urlOrOptions.port ? ':' + urlOrOptions.port : '';
            const path = urlOrOptions.path || '/';
            urlString = protocol + '//' + urlOrOptions.hostname + port + path;
        }
    }

    if (mcp_bridge_is_null_or_disconnected) {
        const req = createBlockedRequest('http.request', urlString);
        // http.request might be used with a callback or by attaching event listeners.
        // Emitting error on nextTick in createBlockedRequest().end() handles most cases.
        // If a callback is provided, it might expect an IncomingMessage-like object,
        // but we're erroring out the request itself.
        return req;
    }
    return originalHttpRequest.apply(http, arguments);
};

http.get = function(urlOrOptions, optionsOrCallback, callback) {
    let urlString = '';
    if (typeof urlOrOptions === 'string') {
        urlString = urlOrOptions;
    } else if (urlOrOptions) {
        if (typeof urlOrOptions.href === 'string') {
            urlString = urlOrOptions.href;
        } else if (typeof urlOrOptions.hostname === 'string') {
            const protocol = urlOrOptions.protocol || 'http:';
            const port = urlOrOptions.port ? ':' + urlOrOptions.port : '';
            const path = urlOrOptions.path || '/';
            urlString = protocol + '//' + urlOrOptions.hostname + port + path;
        }
    }

    let actualCallback;
    if (typeof optionsOrCallback === 'function') {
        actualCallback = optionsOrCallback;
    } else if (typeof callback === 'function') {
        actualCallback = callback;
    }

    if (mcp_bridge_is_null_or_disconnected) {
        const req = createBlockedRequest('http.get', urlString);
        // For http.get, a callback expecting (res) is common.
        // We'll simulate an error being passed to this callback or emitted on the request.
        if (actualCallback) {
            // Create a minimal fake response object that can emit an error
            const EventEmitter = require('events');
            const fakeRes = new EventEmitter();
            fakeRes.statusCode = 503; // Service Unavailable
             process.nextTick(() => {
                const err = new Error('[MCP-BUNDLE-SHIM] Blocked http.get to ' + urlString + ' - No active bridge.');
                err.code = 'ECONNREFUSED';
                actualCallback(fakeRes); // Pass the fake response
                fakeRes.emit('error', err); // Emit error on the fake response
                req.emit('error', err); // Also emit error on the request object itself
            });
        }
        // The .end() call from createBlockedRequest will also emit an error on `req`
        return req;
    }
    return originalHttpGet.apply(http, arguments);
};

https.request = function(urlOrOptions, optionsOrCallback, callback) {
    let urlString = '';
    if (typeof urlOrOptions === 'string') {
        urlString = urlOrOptions;
    } else if (urlOrOptions) {
        if (typeof urlOrOptions.href === 'string') {
            urlString = urlOrOptions.href;
        } else if (typeof urlOrOptions.hostname === 'string') {
            const protocol = urlOrOptions.protocol || 'https:';
            const port = urlOrOptions.port ? ':' + urlOrOptions.port : '';
            const path = urlOrOptions.path || '/';
            urlString = protocol + '//' + urlOrOptions.hostname + port + path;
        }
    }

    if (mcp_bridge_is_null_or_disconnected) {
        const req = createBlockedRequest('https.request', urlString);
        return req;
    }
    return originalHttpsRequest.apply(https, arguments);
};

https.get = function(urlOrOptions, optionsOrCallback, callback) {
    let urlString = '';
    if (typeof urlOrOptions === 'string') {
        urlString = urlOrOptions;
    } else if (urlOrOptions) {
        if (typeof urlOrOptions.href === 'string') {
            urlString = urlOrOptions.href;
        } else if (typeof urlOrOptions.hostname === 'string') {
            const protocol = urlOrOptions.protocol || 'https:';
            const port = urlOrOptions.port ? ':' + urlOrOptions.port : '';
            const path = urlOrOptions.path || '/';
            urlString = protocol + '//' + urlOrOptions.hostname + port + path;
        }
    }

    let actualCallback;
    if (typeof optionsOrCallback === 'function') {
        actualCallback = optionsOrCallback;
    } else if (typeof callback === 'function') {
        actualCallback = callback;
    }

    if (mcp_bridge_is_null_or_disconnected) {
        const req = createBlockedRequest('https.get', urlString);
         if (actualCallback) {
            const EventEmitter = require('events');
            const fakeRes = new EventEmitter();
            fakeRes.statusCode = 503;
            process.nextTick(() => {
                const err = new Error('[MCP-BUNDLE-SHIM] Blocked https.get to ' + urlString + ' - No active bridge.');
                err.code = 'ECONNREFUSED';
                actualCallback(fakeRes);
                fakeRes.emit('error', err);
                req.emit('error', err);
            });
        }
        return req;
    }
    return originalHttpsGet.apply(https, arguments);
};

if (originalFetch) {
    fetch = function(url, options) { // Re-declare fetch in this scope
        const urlString = (url instanceof URL) ? url.href : String(url);
        if (mcp_bridge_is_null_or_disconnected) {
            const msg = '[MCP-BUNDLE-SHIM] fetch call to "' + urlString + '" blocked - No active bridge.';
            console.error(msg);
            return Promise.reject(new Error(msg));
        }
        return originalFetch.apply(globalThis, arguments);
    };
    console.log('[MCP-BUNDLE-SHIM] Global fetch intercepted.');
} else {
    console.log('[MCP-BUNDLE-SHIM] Global fetch not found, skipping interception.');
}

console.log('[MCP-BUNDLE-SHIM] Shim applied. Executing original bundle...');

// Execute the original bundled script content
// This placeholder will be replaced by the actual script content by sandbox.js
%%ORIGINAL_SCRIPT_CONTENT%% 