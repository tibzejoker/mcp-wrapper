/**
 * bundle_interception_test.js
 * 
 * Test file for verifying HTTP request interception in bundled Node.js code
 */

import { Sandbox } from '../wrapper/sandbox.js';
import path from 'path';
import fs from 'fs';

// Path to the bundled script for testing
const BUNDLED_SCRIPT_PATH = path.join(__dirname, 'dist/http_server.bundle.cjs');

async function runTest() {
  console.log('Starting bundle interception test');
  
  if (!fs.existsSync(BUNDLED_SCRIPT_PATH)) {
    console.error(`Bundled script not found at ${BUNDLED_SCRIPT_PATH}`);
    console.error('Please make sure the bundled script exists before running this test');
    process.exit(1);
  }
  
  // Create a sandbox with a mount directory for the test
  const sandboxDir = path.join(__dirname, 'mount');
  
  // Ensure the mount directory exists
  if (!fs.existsSync(sandboxDir)) {
    fs.mkdirSync(sandboxDir, { recursive: true });
  }
  
  console.log(`Creating sandbox with mount directory: ${sandboxDir}`);
  const sandbox = new Sandbox(sandboxDir);
  
  try {
    console.log(`Running bundled script: ${BUNDLED_SCRIPT_PATH}`);
    
    // Run the script in the sandbox
    const proc = await sandbox.runScript(BUNDLED_SCRIPT_PATH, {
      DEBUG: 'true',
      NODE_ENV: 'development'
    });
    
    console.log('Script is running, watching for output...');
    console.log('Press Ctrl+C to stop the test');
    
    // Handle process termination
    process.on('SIGINT', async () => {
      console.log('\nStopping test...');
      
      try {
        // Cleanup sandbox resources
        await sandbox.cleanup();
        
        // Stop the process
        if (proc && proc.stop) {
          await proc.stop();
        }
        
        console.log('Test stopped successfully');
      } catch (error) {
        console.error('Error stopping test:', error);
      }
      
      process.exit(0);
    });
  } catch (error) {
    console.error('Error running test:', error);
    process.exit(1);
  }
}

// Run the test
runTest(); 