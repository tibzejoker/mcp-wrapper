#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Get MCP_WRAPPER_LOG_PATH from environment
const logPath = process.env.MCP_WRAPPER_LOG_PATH;
if (!logPath) {
  console.error('Error: MCP_WRAPPER_LOG_PATH not found in environment');
  console.error('Please set MCP_WRAPPER_LOG_PATH in .env or system environment');
  process.exit(1);
}

const LOG_FILE = path.join(logPath, 'mcp-proxy.log');

console.log(`Tailing log file: ${LOG_FILE}`);
console.log('Press Ctrl+C to exit');
console.log('-----------------------------------');

// Function to check if file exists and create it if it doesn't
function ensureFileExists(filePath) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
    
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '');
      console.log(`Created log file: ${filePath}`);
    }
    return true;
  } catch (error) {
    console.error(`Error creating log file: ${error.message}`);
    return false;
  }
}

// Check if log file exists, if not create it
if (!ensureFileExists(LOG_FILE)) {
  process.exit(1);
}

// Initial read of the entire file
function initialRead() {
  try {
    const fileContent = fs.readFileSync(LOG_FILE, 'utf8');
    if (fileContent) {
      console.log(fileContent.trim());
    }
  } catch (error) {
    console.error(`Error reading log file: ${error.message}`);
  }
}

// Watch for changes to the file
function watchFile() {
  let lastSize = fs.statSync(LOG_FILE).size;
  
  fs.watch(LOG_FILE, (eventType) => {
    if (eventType === 'change') {
      try {
        const stats = fs.statSync(LOG_FILE);
        const newSize = stats.size;
        
        if (newSize > lastSize) {
          // File has grown, read only the new part
          const buffer = Buffer.alloc(newSize - lastSize);
          const fileDescriptor = fs.openSync(LOG_FILE, 'r');
          
          fs.readSync(fileDescriptor, buffer, 0, newSize - lastSize, lastSize);
          fs.closeSync(fileDescriptor);
          
          process.stdout.write(buffer.toString());
          lastSize = newSize;
        } else if (newSize < lastSize) {
          // File was truncated, read the whole file again
          console.log('Log file was truncated, reading from the beginning...');
          initialRead();
          lastSize = newSize;
        }
      } catch (error) {
        console.error(`Error watching file: ${error.message}`);
      }
    }
  });
}

// Start watching
initialRead();
watchFile();

// Handle exit gracefully
process.on('SIGINT', () => {
  console.log('\nStopped tailing log file.');
  process.exit(0);
}); 