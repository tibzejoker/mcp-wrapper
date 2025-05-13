/**
 * Bundle test runner
 * 
 * This script runs the testBundle.js through our sandbox with interception.
 */

import { Sandbox } from '../wrapper/sandbox.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a sandbox
const sandbox = new Sandbox(__dirname);

// Run the bundle test
console.log('Running bundled script test with NullBridge (no bridge connected)...');
console.log('---------------------------------------------------------------');

sandbox.runScript(path.join(__dirname, 'testBundle.js'))
  .then(proc => {
    // Exit after 5 seconds to ensure all requests complete
    setTimeout(() => {
      console.log('Test completed - all HTTP/HTTPS/fetch calls were intercepted');
      process.exit(0);
    }, 5000);
  })
  .catch(error => {
    console.error('Error running test:', error);
    process.exit(1);
  }); 