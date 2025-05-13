/**
 * Simple NodeInterceptor Test
 */
import { NodeInterceptor } from '../interceptors/NodeInterceptor.js';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name from the current module's URL
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create test file
const testFilePath = path.join(__dirname, 'test_file.txt');
fs.writeFileSync(testFilePath, 'Original content');

console.log('Starting NodeInterceptor test...');

// Create a NodeInterceptor instance
const interceptor = new NodeInterceptor({
  debug: true,
  bridgeId: 'test-bridge-id'
});

// Track interceptions
let interceptionCount = 0;

// Override sendIntercept to log interceptions
interceptor.sendIntercept = async (type, payload) => {
  interceptionCount++;
  console.log(`[INTERCEPT ${interceptionCount}] ${type}:`, JSON.stringify(payload, null, 2));
  
  // Return mock responses based on type
  switch (type) {
    case 'fs_readFile':
      return { data: 'Intercepted file content' };
    case 'fs_writeFile':
      return { success: true };
    case 'fs_unlink':
      return { success: true };
    case 'http_request':
    case 'https_request':
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        body: 'Intercepted HTTP response'
      };
    default:
      return { success: true };
  }
};

// Apply hooks
console.log('Applying interception hooks...');
interceptor.applyHooks();

// Test file operations
console.log('\nTesting file operations:');

try {
  // Read file
  console.log('Reading file...');
  const content = fs.readFileSync(testFilePath, 'utf8');
  console.log(`File content: "${content}"`);
  
  // Write file
  console.log('Writing to file...');
  fs.writeFileSync(testFilePath, 'New content');
  
  // Read file again to verify
  console.log('Reading file again...');
  const newContent = fs.readFileSync(testFilePath, 'utf8');
  console.log(`New file content: "${newContent}"`);
  
  // Delete file
  console.log('Deleting file...');
  fs.unlinkSync(testFilePath);
} catch (error) {
  console.error('File operation error:', error);
}

// Test HTTP requests
console.log('\nTesting HTTP requests:');

try {
  // Make HTTP request
  console.log('Making HTTP request...');
  const req = http.get('http://example.com', (res) => {
    console.log('HTTP status:', res.statusCode);
    res.on('data', (chunk) => {
      console.log(`HTTP response: "${chunk.toString()}"`);
    });
  });
  
  req.on('error', (error) => {
    console.error('HTTP request error:', error);
  });
} catch (error) {
  console.error('HTTP request setup error:', error);
}

// Wait for async operations to complete
setTimeout(() => {
  // Reset hooks
  console.log('\nResetting interception hooks...');
  interceptor.resetHooks();
  
  // Verify original file is still there (unaffected by intercepted delete)
  try {
    const exists = fs.existsSync(testFilePath);
    console.log(`Original file still exists: ${exists}`);
    if (exists) {
      const content = fs.readFileSync(testFilePath, 'utf8');
      console.log(`Original file content: "${content}"`);
      fs.unlinkSync(testFilePath);
    }
  } catch (error) {
    console.error('Final file check error:', error);
  }
  
  console.log(`\nTest completed. Total interceptions: ${interceptionCount}`);
}, 2000); 