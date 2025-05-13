/**
 * Interception Test Script
 * 
 * Tests the sandboxed execution environment with interception of external calls
 */

import { Sandbox } from '../wrapper/sandbox.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Get the directory name from the current module's URL
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a test script that attempts various external calls
const testScript = `
// Test script that attempts various external calls - ESM version
// We need to wrap everything in an async function to use await
async function runTests() {
  console.log('Starting interception test script');

  // 1. Test file system operations
  console.log('Testing file system operations...');
  try {
    const fs = await import('fs/promises');
    
    await fs.writeFile('/test.txt', 'Hello, world!');
    console.log('File write succeeded');
    
    const content = await fs.readFile('/test.txt', 'utf8');
    console.log('File read succeeded, content:', content);
    
    await fs.unlink('/test.txt');
    console.log('File delete succeeded');
  } catch (error) {
    console.error('File system error:', error.message);
  }

  // 2. Test HTTP requests
  console.log('\\nTesting HTTP requests...');
  try {
    const makeHttpRequest = async (url) => {
      console.log('Making HTTP request to', url);
      const response = await fetch(url);
      console.log('HTTP response status:', response.status);
      const text = await response.text();
      console.log('HTTP response data:', text.substring(0, 50) + '...');
      return text;
    };
    
    await makeHttpRequest('http://example.com');
  } catch (error) {
    console.error('HTTP request error:', error.message);
  }

  // 3. Test HTTPS requests
  console.log('\\nTesting HTTPS requests...');
  try {
    const makeHttpsRequest = async (url) => {
      console.log('Making HTTPS request to', url);
      const response = await fetch(url);
      console.log('HTTPS response status:', response.status);
      const text = await response.text();
      console.log('HTTPS response data:', text.substring(0, 50) + '...');
      return text;
    };
    
    await makeHttpsRequest('https://example.com');
  } catch (error) {
    console.error('HTTPS request error:', error.message);
  }

  // 4. Test DNS lookup
  console.log('\\nTesting DNS lookup...');
  try {
    // In modern ESM environment, we can't directly access DNS module
    // Instead, use the fetch API which will trigger DNS resolution
    console.log('Looking up example.com via fetch...');
    await fetch('http://example.com');
    console.log('DNS resolution successful');
  } catch (error) {
    console.error('DNS lookup error:', error.message);
  }

  // 5. Test child process
  console.log('\\nTesting child process...');
  try {
    // Import dynamically to handle ESM context
    const childProcess = await import('child_process');
    console.log('Executing command: ls -la');
    
    const execPromise = (cmd) => {
      return new Promise((resolve, reject) => {
        childProcess.exec(cmd, (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        });
      });
    };
    
    const { stdout, stderr } = await execPromise('ls -la');
    console.log('Exec stdout:', stdout.substring(0, 100) + '...');
    if (stderr) {
      console.error('Exec stderr:', stderr);
    }
  } catch (error) {
    console.error('Child process error:', error.message);
  }

  // 6. Test network socket
  console.log('\\nTesting network socket...');
  try {
    // Import dynamically to handle ESM context
    const netModule = await import('net');
    const net = netModule.default || netModule;
    console.log('Connecting to example.com:80...');
    
    const socketPromise = (options) => {
      return new Promise((resolve, reject) => {
        const socket = net.createConnection(options, () => {
          console.log('Socket connected!');
          socket.write('GET / HTTP/1.1\\r\\nHost: example.com\\r\\n\\r\\n');
          
          let data = '';
          socket.on('data', (chunk) => {
            data += chunk.toString();
            socket.end();
          });
          
          socket.on('end', () => {
            resolve(data);
          });
        });
        
        socket.on('error', (error) => {
          reject(error);
        });
      });
    };
    
    const data = await socketPromise({ host: 'example.com', port: 80 });
    console.log('Socket data:', data.toString().substring(0, 50) + '...');
  } catch (error) {
    console.error('Socket error:', error.message);
  }

  console.log('\\nInterception test completed');
}

// Call the async function to run tests
runTests();
`;

// Write the test script to disk
const testScriptPath = path.join(__dirname, 'script_to_test.js');
fs.writeFileSync(testScriptPath, testScript);

// Create a sandbox instance
const sandboxDir = path.join(__dirname, 'sandbox_dir');
if (!fs.existsSync(sandboxDir)) {
  fs.mkdirSync(sandboxDir, { recursive: true });
}

console.log('Creating sandbox environment...');
const sandbox = new Sandbox(sandboxDir);

// Configure the bridge to log interception attempts
let interceptionCounter = 0;

// Set up interception counters
const interceptionLog = (type, details) => {
  interceptionCounter++;
  console.log(`[INTERCEPT ${interceptionCounter}] ${type}:`, details);
  return true;
};

// Override default handlers with ones that count interceptions
sandbox.bridge.onFetch(async (request) => {
  interceptionLog('Fetch', request.url);
  return {
    statusCode: 200,
    headers: { 'content-type': 'text/html' },
    body: '<html><body><h1>Intercepted Response</h1></body></html>'
  };
});

sandbox.bridge.onConnect(async (request) => {
  interceptionLog('Connect', request.args);
  return true;
});

sandbox.bridge.onDns(async (request) => {
  interceptionLog('DNS', request.hostname);
  return {
    address: '127.0.0.1',
    family: 4
  };
});

sandbox.bridge.onSpawn(async (request) => {
  interceptionLog('Process', request.command);
  return {
    stdout: 'Intercepted command output',
    stderr: '',
    exitCode: 0
  };
});

sandbox.bridge.onFileRead(async (request) => {
  interceptionLog('FileRead', request.path);
  return {
    data: 'Intercepted file content'
  };
});

sandbox.bridge.onFileWrite(async (request) => {
  interceptionLog('FileWrite', request.path);
  return { success: true };
});

sandbox.bridge.onFileDelete(async (request) => {
  interceptionLog('FileDelete', request.path);
  return { success: true };
});

// Run the test script in the sandbox
console.log('Running test script in sandbox...');
const start = Date.now();

// Activate the bridge manually for testing
sandbox.bridge.setBridgeId('test-bridge-id');
sandbox.bridge.setConnected(true);

const runTest = async () => {
  const process = await sandbox.runScript(testScriptPath);
  
  // Wait for script to complete
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  console.log(`\nTest completed in ${Date.now() - start}ms`);
  console.log(`Total interceptions: ${interceptionCounter}`);
  
  // Clean up
  await sandbox.cleanup();
  try {
    fs.unlinkSync(testScriptPath);
    console.log('Test script removed');
  } catch (error) {
    console.error('Error removing test script:', error);
  }
};

// Run the test
runTest(); 