/**
 * PythonInterceptor.js
 * 
 * This class implements the InterceptorInterface for Python.
 * It intercepts all external calls from sandboxed Python scripts.
 */

import { InterceptorInterface } from './InterceptorInterface.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export class PythonInterceptor extends InterceptorInterface {
  constructor(options = {}) {
    super();
    
    this.options = {
      proxyEndpoint: options.proxyEndpoint || 'http://localhost:3000/intercept',
      language: 'python',
      bridgeId: options.bridgeId || null,
      debug: options.debug || false,
      bridge: options.bridge || null,
      pythonPath: options.pythonPath || 'python3',
      interceptorScriptPath: options.interceptorScriptPath || path.join(process.cwd(), 'interceptors', 'python'),
      ...options
    };
    
    // Track which events are intercepted
    this.implementedEvents = [];
    
    // Store generated Python script to clean up later
    this.generatedScriptPath = null;
    
    // Apply hooks on instantiation if autoApply is true
    if (options.autoApply) {
      this.applyHooks();
    }
  }
  
  /**
   * Debug log if debug is enabled
   * @private
   */
  _debug(...args) {
    if (this.options.debug) {
      console.error('[PythonInterceptor]', ...args);
    }
  }
  
  /**
   * Get the bridge instance
   * @returns {Bridge|null} The bridge instance or null if not available
   */
  getBridge() {
    return this.options.bridge;
  }
  
  /**
   * Set the bridge instance
   * @param {Bridge} bridge The bridge instance to use
   */
  setBridge(bridge) {
    this.options.bridge = bridge;
  }
  
  /**
   * Apply all hooks to intercept external calls
   * @returns {boolean} True if all hooks were applied successfully
   */
  applyHooks() {
    this._debug('Generating Python interceptor script');
    
    // Create Python wrapper scripts that will be injected into the Python environment
    this._generatePythonInterceptorScript();
    
    // Mark all required events as implemented since Python interceptor handles them via script injection
    this.implementedEvents = [
      'fs_readFile',
      'fs_writeFile',
      'fs_unlink',
      'fs_stat',
      'http_request',
      'https_request',
      'fetch',
      'net_connect',
      'dns_lookup',
      'spawn',
      'exec',
      'websocket_connect'
    ];
    
    // Validate that all required events are intercepted
    this.validateEvents(this.implementedEvents);
    
    this._debug('All hooks successfully applied through Python wrapper scripts');
    return true;
  }
  
  /**
   * Generate the Python interceptor script
   * @private
   */
  _generatePythonInterceptorScript() {
    // Ensure Python interceptor directory exists
    const interceptorDir = this.options.interceptorScriptPath;
    if (!fs.existsSync(interceptorDir)) {
      fs.mkdirSync(interceptorDir, { recursive: true });
    }
    
    // Generate the main interceptor module
    const initPath = path.join(interceptorDir, '__init__.py');
    this._writeInterceptorInitScript(initPath);
    
    // Generate the file system interceptor
    const fsPath = path.join(interceptorDir, 'fs_interceptor.py');
    this._writeFsInterceptorScript(fsPath);
    
    // Generate the network interceptor
    const networkPath = path.join(interceptorDir, 'network_interceptor.py');
    this._writeNetworkInterceptorScript(networkPath);
    
    // Generate the process interceptor
    const processPath = path.join(interceptorDir, 'process_interceptor.py');
    this._writeProcessInterceptorScript(processPath);
    
    // Generate the bridge communication module
    const bridgePath = path.join(interceptorDir, 'bridge.py');
    this._writeBridgeScript(bridgePath);
    
    this._debug(`Python interceptor scripts generated in ${interceptorDir}`);
  }
  
  /**
   * Write the Python interceptor initialization script
   * @private
   */
  _writeInterceptorInitScript(filePath) {
    const script = `
# Python Interceptor Module
# This module intercepts all external calls from Python scripts

import sys
import os
import importlib.util
import builtins

# Store the bridge ID for communication
BRIDGE_ID = "${this.options.bridgeId || ''}"

# Import submodules
from . import fs_interceptor
from . import network_interceptor
from . import process_interceptor
from . import bridge

# Apply all hooks
def apply_hooks():
    """Apply all interception hooks"""
    fs_interceptor.apply_hooks()
    network_interceptor.apply_hooks()
    process_interceptor.apply_hooks()

# Apply hooks on module import
apply_hooks()

# Export the send_intercept function
def send_intercept(type, payload):
    """Send an intercepted call to the bridge"""
    return bridge.send_intercept(type, payload, BRIDGE_ID)
`;
    
    fs.writeFileSync(filePath, script);
  }
  
  /**
   * Write the file system interceptor script
   * @private
   */
  _writeFsInterceptorScript(filePath) {
    const script = `
# File System Interceptor
# Intercepts all file system operations

import os
import builtins
import io
import sys
from . import bridge

# Store original implementations
original_open = builtins.open
original_os_remove = os.remove
original_os_stat = os.stat

def intercepted_open(file, mode='r', buffering=-1, encoding=None, errors=None, newline=None, closefd=True, opener=None):
    """Intercept open() calls"""
    
    # Only intercept when reading or writing files
    if 'r' in mode:
        # Reading a file
        try:
            response = bridge.send_intercept('fs_readFile', {
                'args': [file, {'encoding': encoding}]
            })
            return io.StringIO(response.get('data', ''))
        except Exception as e:
            sys.stderr.write(f"Error intercepting file read: {str(e)}\\n")
            # Fall back to original implementation
            return original_open(file, mode, buffering, encoding, errors, newline, closefd, opener)
    elif 'w' in mode or 'a' in mode:
        # Writing to a file - we return a custom file-like object that intercepts writes
        return InterceptedWriteFile(file, mode, encoding)
    else:
        # Pass through for other modes
        return original_open(file, mode, buffering, encoding, errors, newline, closefd, opener)

class InterceptedWriteFile:
    """A file-like object that intercepts writes"""
    
    def __init__(self, path, mode, encoding=None):
        self.path = path
        self.mode = mode
        self.encoding = encoding
        self.buffer = io.StringIO()
        self.closed = False
    
    def write(self, data):
        """Intercept write operations"""
        return self.buffer.write(data)
    
    def close(self):
        """Intercept file close and send the data"""
        if not self.closed:
            content = self.buffer.getvalue()
            try:
                bridge.send_intercept('fs_writeFile', {
                    'args': [self.path, content, {'encoding': self.encoding}]
                })
            except Exception as e:
                sys.stderr.write(f"Error intercepting file write: {str(e)}\\n")
            self.buffer.close()
            self.closed = True
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

def intercepted_remove(path, dir_fd=None):
    """Intercept file deletion"""
    try:
        response = bridge.send_intercept('fs_unlink', {
            'args': [path]
        })
        return None
    except Exception as e:
        sys.stderr.write(f"Error intercepting file deletion: {str(e)}\\n")
        return original_os_remove(path, dir_fd)

def intercepted_stat(path, dir_fd=None, follow_symlinks=True):
    """Intercept file stat operations"""
    try:
        response = bridge.send_intercept('fs_stat', {
            'args': [path]
        })
        # Create a fake stat result
        class FakeStat:
            def __init__(self):
                self.st_mode = 33188  # Regular file
                self.st_size = 1024   # 1KB size
                self.st_mtime = 1640995200  # 2022-01-01
        return FakeStat()
    except Exception as e:
        sys.stderr.write(f"Error intercepting file stat: {str(e)}\\n")
        return original_os_stat(path, dir_fd, follow_symlinks)

def apply_hooks():
    """Apply all file system hooks"""
    builtins.open = intercepted_open
    os.remove = intercepted_remove
    os.stat = intercepted_stat
    
    sys.stderr.write("File system interception hooks applied\\n")
`;
    
    fs.writeFileSync(filePath, script);
  }
  
  /**
   * Write the network interceptor script
   * @private
   */
  _writeNetworkInterceptorScript(filePath) {
    const script = `
# Network Interceptor
# Intercepts all network operations

import sys
import socket
import urllib.request
import http.client
from . import bridge

# Store original implementations
original_urlopen = urllib.request.urlopen
original_socket_connect = socket.socket.connect
original_http_client_connect = http.client.HTTPConnection.connect

class InterceptedResponse:
    """A fake response object for intercepted HTTP requests"""
    
    def __init__(self, data, status=200, headers=None):
        self.data = data
        self.status = status
        self.headers = headers or {}
        self._closed = False
    
    def read(self):
        """Read the response data"""
        return self.data.encode('utf-8') if isinstance(self.data, str) else self.data
    
    def close(self):
        """Close the response"""
        self._closed = True
    
    def getcode(self):
        """Get the status code"""
        return self.status
    
    def getheaders(self):
        """Get the response headers"""
        return list(self.headers.items())
    
    def info(self):
        """Get the response info"""
        class FakeInfo:
            def __init__(self, headers):
                self.headers = headers
            
            def get(self, name, default=None):
                return self.headers.get(name, default)
        
        return FakeInfo(self.headers)

def intercepted_urlopen(url, data=None, timeout=None, *args, **kwargs):
    """Intercept URL open operations"""
    try:
        response = bridge.send_intercept('fetch', {
            'url': url if isinstance(url, str) else url.full_url,
            'method': 'POST' if data else 'GET',
            'headers': kwargs.get('headers', {})
        })
        return InterceptedResponse(
            response.get('body', ''),
            response.get('statusCode', 200),
            response.get('headers', {})
        )
    except Exception as e:
        sys.stderr.write(f"Error intercepting URL open: {str(e)}\\n")
        return original_urlopen(url, data, timeout, *args, **kwargs)

def intercepted_socket_connect(self, address):
    """Intercept socket connections"""
    host, port = address if isinstance(address, tuple) else (address, 0)
    try:
        bridge.send_intercept('net_connect', {
            'args': {
                'host': host,
                'port': port
            }
        })
        # Don't actually connect, but make the socket think it's connected
        self.connected = True
    except Exception as e:
        sys.stderr.write(f"Error intercepting socket connection: {str(e)}\\n")
        return original_socket_connect(self, address)

def intercepted_http_connect(self):
    """Intercept HTTP connections"""
    try:
        bridge.send_intercept('net_connect', {
            'args': {
                'host': self.host,
                'port': self.port
            }
        })
        # Pretend the connection was successful
        self.sock = True
    except Exception as e:
        sys.stderr.write(f"Error intercepting HTTP connection: {str(e)}\\n")
        return original_http_client_connect(self)

def apply_hooks():
    """Apply all network hooks"""
    urllib.request.urlopen = intercepted_urlopen
    socket.socket.connect = intercepted_socket_connect
    http.client.HTTPConnection.connect = intercepted_http_connect
    
    # Intercept DNS resolution
    original_getaddrinfo = socket.getaddrinfo
    def intercepted_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        try:
            response = bridge.send_intercept('dns_lookup', {
                'hostname': host
            })
            # Return a fake address
            addr = response.get('address', '127.0.0.1')
            return [(2, 1, 6, '', (addr, port))]
        except Exception as e:
            sys.stderr.write(f"Error intercepting DNS lookup: {str(e)}\\n")
            return original_getaddrinfo(host, port, family, type, proto, flags)
    
    socket.getaddrinfo = intercepted_getaddrinfo
    
    sys.stderr.write("Network interception hooks applied\\n")
`;
    
    fs.writeFileSync(filePath, script);
  }
  
  /**
   * Write the process interceptor script
   * @private
   */
  _writeProcessInterceptorScript(filePath) {
    const script = `
# Process Interceptor
# Intercepts all process operations

import sys
import subprocess
from . import bridge

# Store original implementations
original_subprocess_run = subprocess.run
original_subprocess_popen = subprocess.Popen

def intercepted_run(cmd, *args, **kwargs):
    """Intercept subprocess.run calls"""
    try:
        command = cmd if isinstance(cmd, str) else ' '.join(cmd)
        response = bridge.send_intercept('spawn', {
            'command': command,
            'args': kwargs
        })
        
        # Create a fake CompletedProcess object
        class FakeCompletedProcess:
            def __init__(self, returncode, stdout, stderr):
                self.returncode = returncode
                self.stdout = stdout.encode('utf-8') if isinstance(stdout, str) else stdout
                self.stderr = stderr.encode('utf-8') if isinstance(stderr, str) else stderr
        
        return FakeCompletedProcess(
            response.get('exitCode', 0),
            response.get('stdout', ''),
            response.get('stderr', '')
        )
    except Exception as e:
        sys.stderr.write(f"Error intercepting process run: {str(e)}\\n")
        return original_subprocess_run(cmd, *args, **kwargs)

def intercepted_popen(cmd, *args, **kwargs):
    """Intercept subprocess.Popen calls"""
    try:
        command = cmd if isinstance(cmd, str) else ' '.join(cmd)
        
        # Create a fake Popen object
        class FakePopen:
            def __init__(self, cmd, returncode=0, stdout='', stderr=''):
                self.cmd = cmd
                self.returncode = returncode
                self._stdout = stdout.encode('utf-8') if isinstance(stdout, str) else stdout
                self._stderr = stderr.encode('utf-8') if isinstance(stderr, str) else stderr
                self.pid = 12345  # Fake PID
            
            def communicate(self, input=None, timeout=None):
                return self._stdout, self._stderr
            
            def poll(self):
                return self.returncode
            
            def wait(self, timeout=None):
                return self.returncode
            
            def kill(self):
                pass
            
            def terminate(self):
                pass
        
        # Intercept the process creation
        response = bridge.send_intercept('spawn', {
            'command': command,
            'args': kwargs
        })
        
        return FakePopen(
            cmd,
            response.get('exitCode', 0),
            response.get('stdout', ''),
            response.get('stderr', '')
        )
    except Exception as e:
        sys.stderr.write(f"Error intercepting process popen: {str(e)}\\n")
        return original_subprocess_popen(cmd, *args, **kwargs)

def apply_hooks():
    """Apply all process hooks"""
    subprocess.run = intercepted_run
    subprocess.Popen = intercepted_popen
    
    sys.stderr.write("Process interception hooks applied\\n")
`;
    
    fs.writeFileSync(filePath, script);
  }
  
  /**
   * Write the bridge communication script
   * @private
   */
  _writeBridgeScript(filePath) {
    const script = `
# Bridge Communication Module
# Handles communication with the Node.js bridge

import sys
import json
import urllib.request
import urllib.error

# Endpoint for sending intercepts
PROXY_ENDPOINT = "${this.options.proxyEndpoint}"

def send_intercept(type, payload, bridge_id=None):
    """Send an intercepted call to the proxy"""
    
    # Prepare the request body
    request_body = {
        "type": type,
        "lang": "python",
        "timestamp": __import__('time').time() * 1000,
        "bridgeId": bridge_id,
        "payload": payload
    }
    
    try:
        # Send HTTP request to proxy
        request_data = json.dumps(request_body).encode('utf-8')
        req = urllib.request.Request(
            PROXY_ENDPOINT,
            data=request_data,
            headers={
                'Content-Type': 'application/json'
            },
            method='POST'
        )
        
        with urllib.request.urlopen(req) as response:
            if response.getcode() != 200:
                sys.stderr.write(f"Proxy request failed: {response.getcode()} {response.msg}\\n")
                return {}
            
            response_data = response.read().decode('utf-8')
            return json.loads(response_data)
    except urllib.error.URLError as e:
        sys.stderr.write(f"Error sending intercepted {type} to proxy: {str(e)}\\n")
        return {}
    except json.JSONDecodeError as e:
        sys.stderr.write(f"Error parsing proxy response: {str(e)}\\n")
        return {}
    except Exception as e:
        sys.stderr.write(f"Unexpected error in send_intercept: {str(e)}\\n")
        return {}
`;
    
    fs.writeFileSync(filePath, script);
  }
  
  /**
   * Send an intercepted call to the proxy
   * @param {string} type - The type of event being intercepted
   * @param {Object} payload - The details of the intercepted call
   * @returns {Promise<any>} The response from the proxy
   */
  async sendIntercept(type, payload) {
    this._debug(`Sending intercepted ${type} to proxy`);
    
    // If we have a bridge available, use it
    if (this.options.bridge) {
      try {
        const response = await this.options.bridge.handleInterceptedCall(type, payload);
        return response;
      } catch (error) {
        this._debug(`Bridge error for ${type}:`, error);
        throw error;
      }
    }
    
    // Otherwise use HTTP endpoint
    const requestBody = {
      type,
      lang: this.options.language,
      timestamp: Date.now(),
      bridgeId: this.options.bridgeId,
      payload
    };
    
    try {
      // Send the request to the proxy endpoint
      const response = await fetch(this.options.proxyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        throw new Error(`Proxy request failed: ${response.status} ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      this._debug(`Error sending intercepted ${type} to proxy:`, error);
      throw error;
    }
  }
  
  /**
   * Disable all hooks and restore original functionality
   * @returns {boolean} True if all hooks were successfully reset
   */
  resetHooks() {
    this._debug('Python interceptor does not directly reset hooks');
    // Python hooks can't be directly reset since they're injected via PYTHONPATH
    // The hooks will be disabled when the Python process exits
    return true;
  }
  
  /**
   * Create a Python run command that includes the interceptor in PYTHONPATH
   * @param {string} scriptPath - Path to the Python script to run
   * @returns {Object} Command configuration for running the script
   */
  createPythonRunCommand(scriptPath) {
    const interceptorDir = path.dirname(this.options.interceptorScriptPath);
    
    return {
      command: this.options.pythonPath,
      args: [
        '-m', 'interceptors.python', // Run the interceptor module first
        scriptPath
      ],
      env: {
        ...process.env,
        PYTHONPATH: `${process.env.PYTHONPATH || ''}:${interceptorDir}`
      }
    };
  }
} 