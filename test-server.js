'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https'); // For jsonplaceholder
const { exec, spawn } = require('child_process');

const LOG_PREFIX = '[TestServer]';
const TEST_FILE_PATH = path.join(__dirname, 'test-output.txt');
const TEST_DIR_PATH = path.join(__dirname, 'test-dir');
const TEST_HTTP_PORT = 30000;

function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function logError(message, error) {
  console.error(`${LOG_PREFIX} ERROR: ${message}`, error ? error.message : '');
  if (error && error.stack) {
    console.error(error.stack);
  }
}

async function performFileSystemOperations() {
  log('Starting file system operations...');
  try {
    // Write file
    log(`Attempting to write to file: ${TEST_FILE_PATH}`);
    fs.writeFileSync(TEST_FILE_PATH, 'Hello from TestServer, via fs.writeFileSync!');
    log('File written successfully.');

    // Read file
    log(`Attempting to read from file: ${TEST_FILE_PATH}`);
    const fileContent = fs.readFileSync(TEST_FILE_PATH, 'utf8');
    log(`File content: "${fileContent}"`);

    // Create directory
    log(`Attempting to create directory: ${TEST_DIR_PATH}`);
    if (!fs.existsSync(TEST_DIR_PATH)) {
      fs.mkdirSync(TEST_DIR_PATH);
      log('Directory created successfully.');
    } else {
      log('Directory already exists, skipping creation.');
    }
    

    // Readdir
    log(`Attempting to read directory contents: ${__dirname}`);
    const dirContents = fs.readdirSync(__dirname);
    log(`Directory contents (first 5): ${dirContents.slice(0,5).join(', ')}...`);

    // Access non-existent file
    const nonExistentFilePath = path.join(__dirname, 'non-existent-file.txt');
    log(`Attempting to access non-existent file: ${nonExistentFilePath}`);
    try {
      fs.accessSync(nonExistentFilePath, fs.constants.F_OK);
      logError('Accessed a non-existent file, which is unexpected.');
    } catch (e) {
      log(`Successfully failed to access non-existent file: ${e.message}`);
    }

  } catch (error) {
    logError('Error during file system operations.', error);
    throw error; // Re-throw to be caught by main try-catch
  } finally {
    log('Starting file system cleanup...');
    try {
      if (fs.existsSync(TEST_FILE_PATH)) {
        log(`Cleaning up file: ${TEST_FILE_PATH}`);
        fs.unlinkSync(TEST_FILE_PATH);
        log('File cleaned up.');
      }
      if (fs.existsSync(TEST_DIR_PATH)) {
        log(`Cleaning up directory: ${TEST_DIR_PATH}`);
        fs.rmdirSync(TEST_DIR_PATH);
        log('Directory cleaned up.');
      }
    } catch (cleanupError) {
      logError('Error during file system cleanup.', cleanupError);
      // Don't re-throw cleanup errors, main operations might have succeeded
    }
    log('File system operations and cleanup finished.');
  }
}

function performNetworkOperations() {
  return new Promise((resolve, reject) => {
    log('Starting network operations...');

    // HTTP GET request
    const requestUrl = 'https://jsonplaceholder.typicode.com/todos/1';
    log(`Attempting HTTP GET request to: ${requestUrl}`);
    
    const req = https.get(requestUrl, (res) => {
      let data = '';
      log(`HTTP GET response status: ${res.statusCode}`);
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          log(`HTTP GET received data (title): ${jsonData.title}`);
          // Start local HTTP server after successfully completing the GET request
          startLocalHttpServer().then(resolve).catch(reject);
        } catch (parseError) {
          logError('Failed to parse JSON response from HTTP GET.', parseError)
          reject(parseError);
        }
      });
    });

    req.on('error', (error) => {
      logError('Error during HTTP GET request.', error);
      reject(error); // If GET fails, don't proceed to server
    });
    req.end();
  });
}

function startLocalHttpServer() {
  return new Promise((resolve, reject) => {
    log('Attempting to start local HTTP server...');
    const server = http.createServer((req, res) => {
      log(`Local HTTP server received request: ${req.method} ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello from TestServer HTTP Server!\n');
      
      // Close server after first request for test purposes
      log('Closing local HTTP server after request...');
      server.close((err) => {
        if (err) {
          logError('Error while closing local HTTP server.', err);
          return reject(err); // Propagate error if closing fails
        }
        log('Local HTTP server closed.');
        resolve(); // Resolve the promise when server is closed
      });
    });

    server.on('error', (error) => {
      logError('Error with local HTTP server.', error);
      if (error.code === 'EADDRINUSE') {
        logError(`Port ${TEST_HTTP_PORT} is already in use. Skipping server part of the test.`, null);
        resolve(); // Resolve if port is in use, as it's a common issue not related to interception.
      } else {
         reject(error);
      }
    });
    
    server.listen(TEST_HTTP_PORT, () => {
      log(`Local HTTP server listening on port ${TEST_HTTP_PORT}`);
      // Optional: set a timeout to close the server if no request comes in
      const timeout = setTimeout(() => {
        log('Local HTTP server timeout reached, closing server...');
        server.close((err) => {
          if (err) {
            logError('Error while closing local HTTP server on timeout.', err);
            // Do not reject here as the request part might have worked
          }
          log('Local HTTP server closed due to timeout.');
          resolve(); // Resolve the promise
        });
      }, 5000); // 5 seconds, adjust as needed
      server.on('close', () => clearTimeout(timeout)); // Clear timeout if server closes normally
    });
  });
}

function performChildProcessOperations() {
  return new Promise((resolve, reject) => {
    log('Starting child process operations...');

    const execCommand = process.platform === 'win32' ? 'dir /b' : 'ls -la'; // Show more details with ls -la
    log(`Attempting to execute command: "${execCommand}"`);
    exec(execCommand, (error, stdout, stderr) => {
      if (error) {
        logError(`Error executing command "${execCommand}".`, error);
        return reject(error);
      }
      if (stderr) {
        log(`Stderr from "${execCommand}":\n${stderr.substring(0,100)}...`);
      }
      log(`Stdout from "${execCommand}" (first 100 chars):\n${stdout.substring(0,100)}...`);

      const spawnCommand = 'node';
      const spawnArgs = ['--version'];
      log(`Attempting to spawn command: "${spawnCommand}" with args: ${spawnArgs.join(' ')}`);
      
      const spawnedProcess = spawn(spawnCommand, spawnArgs);
      let spawnStdout = '';
      let spawnStderr = '';

      spawnedProcess.stdout.on('data', (data) => {
        spawnStdout += data.toString();
      });
      spawnedProcess.stderr.on('data', (data) => {
        spawnStderr += data.toString();
      });

      spawnedProcess.on('error', (spawnError) => {
        logError(`Failed to start spawned process "${spawnCommand}".`, spawnError);
        return reject(spawnError);
      });

      spawnedProcess.on('close', (code) => {
        log(`Spawned process "${spawnCommand}" exited with code ${code}.`);
        if (spawnStderr) {
          log(`Stderr from spawned process:\n${spawnStderr}`);
        }
        log(`Stdout from spawned process:\n${spawnStdout}`);
        log('Child process operations finished.');
        resolve();
      });
    });
  });
}


async function main() {
  log('Starting all test operations...');
  try {
    await performFileSystemOperations();
    await performNetworkOperations(); // This includes starting and stopping the local server
    await performChildProcessOperations();
    log('All test operations completed successfully.');
    process.exitCode = 0; // Indicate success
  } catch (error) {
    logError('An unhandled error occurred during test operations.', error);
    process.exitCode = 1; // Indicate failure
  } finally {
    log('Exiting TestServer script.');
    // process.exit() will be called implicitly due to process.exitCode and event loop ending
  }
}

// Handle unhandled rejections and uncaught exceptions for robustness
process.on('unhandledRejection', (reason, promise) => {
  logError('Unhandled Rejection at:', promise);
  logError('Reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logError('Uncaught Exception:', error);
  process.exit(1);
});

main();
