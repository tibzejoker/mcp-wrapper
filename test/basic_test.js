/**
 * Basic test for MCP Wrapper components
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name from the current module's URL
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Basic test for MCP Wrapper');
console.log('Current directory:', __dirname);

// Create test directories
const testDir = path.join(__dirname, 'test_dir');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
  console.log('Created test directory:', testDir);
}

// Create a test file
const testFilePath = path.join(testDir, 'test_file.txt');
fs.writeFileSync(testFilePath, 'Hello, world!');
console.log('Created test file:', testFilePath);

// Read the test file
const content = fs.readFileSync(testFilePath, 'utf8');
console.log('File content:', content);

// Clean up
fs.unlinkSync(testFilePath);
fs.rmdirSync(testDir);
console.log('Cleaned up test files and directories');

console.log('Basic test completed successfully'); 