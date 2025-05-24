#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Proxy Server
 * Acts as a bridge between MCP clients and a real MCP server.
 * Takes the path to the real MCP server as a command line argument.
 */

// Load environment variables from .env file
dotenv.config();

// Configure logging
let LOG_FILE = null;
let loggingEnabled = false;

// If MCP_WRAPPER_LOG_PATH is defined in environment, enable logging to file
if (process.env.MCP_WRAPPER_LOG_PATH) {
  const logPath = process.env.MCP_WRAPPER_LOG_PATH;
  LOG_FILE = path.join(logPath, 'mcp-proxy.log');
  
  // Ensure log directory exists
  try {
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    // Enable logging explicitly
    loggingEnabled = true;
    console.error(`[MCP Proxy] Logging enabled to: ${LOG_FILE}`);
  } catch (error) {
    console.error(`[Error] Failed to create log directory: ${error.message}`);
    console.error('[MCP Proxy] Continuing without file logging');
  }
} else {
  console.error('[MCP Proxy] MCP_WRAPPER_LOG_PATH not found in environment, file logging disabled');
}

// Function to write logs to file and console
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  
  // Log to console
  console.error(message);
  
  // Log to file if enabled
  if (loggingEnabled && LOG_FILE) {
    try {
      fs.appendFileSync(LOG_FILE, logMessage);
    } catch (error) {
      console.error(`[Error] Failed to write to log file: ${error.message}`);
      // Disable logging if we can't write to the file
      loggingEnabled = false;
    }
  }
}

// Verify command line arguments
const realLaunchCommand = process.argv[2];
if (!realLaunchCommand) {
  log('Error: Real MCP server launch command is required');
  log('Usage: node index.js <real_launch_command> <real_mcp_server_path>');
  process.exit(1);
}

const realMcpServerPath = process.argv[3];
if (!realMcpServerPath) {
  log('Error: Path to real MCP server is required');
  log('Usage: node index.js <real_launch_command> <real_mcp_server_path>');
  process.exit(1);
}

async function main() {
  try {
    log(`[MCP Proxy] Starting proxy for MCP server at: ${realMcpServerPath}`);

    // --- Interceptor Injection ---
    let interceptorPath = '';
    try {
      // Resolve path to interceptor-node.js, which is in the same directory as main.js
      const currentScriptPath = new URL(import.meta.url).pathname;
      const currentDir = path.dirname(currentScriptPath.substring(process.platform === "win32" ? 1 : 0)); // Handle potential leading '/' on Windows
      interceptorPath = path.resolve(currentDir, 'interceptor-node.js');
      log(`[MCP Proxy] Resolved interceptor path: ${interceptorPath}`);
    } catch (e) {
      log(`[MCP Proxy] Error resolving interceptor path: ${e.message}. Interception will likely fail.`);
    }

    const newArgs = [];
    if (interceptorPath && fs.existsSync(interceptorPath)) {
      log(`[MCP Proxy] Interceptor script found at ${interceptorPath}. Injecting.`);
      newArgs.push('--require', interceptorPath);
    } else {
      log(`[MCP Proxy] CRITICAL WARNING: Interceptor script not found at ${interceptorPath || 'resolved path'}. Interception will NOT be active.`);
      // Depending on policy, could exit here: process.exit(1);
    }
    newArgs.push(realMcpServerPath);
    // If realMcpServerPath was supposed to have its own arguments, they would need to be
    // parsed from process.argv and added here. Currently, it's treated as a single path.
    // For example, if process.argv was [node, main.js, realLaunchCmd, realServerPath, ...serverArgs],
    // then serverArgs (process.argv.slice(4)) should be added to newArgs.
    // The current problem description implies realMcpServerPath is the only argument to the server itself.

    // Initialize the real MCP server client
    const realServerTransport = new StdioClientTransport({
      command: realLaunchCommand, // Assumed to be 'node' or a command that passes args to node
      args: newArgs,
      // Pass environment variables from the current process
      env: process.env,
    });
    
    const realServerClient = new Client({
      name: 'mcp-proxy-client',
      version: '1.0.0',
    });
    
    // Connect to the real server once and maintain the connection
    log('[MCP Proxy] Connecting to real server...');
    await realServerClient.connect(realServerTransport);
    log('[MCP Proxy] Successfully connected to real server');

    // --- Capture and log stderr from the real MCP server (child process) ---
    if (realServerTransport.process && realServerTransport.process.stderr) {
      log('[MCP Proxy] Attaching stderr listener to the real MCP server process.');
      realServerTransport.process.stderr.on('data', (data) => {
        const messages = data.toString().split('\n').filter(line => line.trim().length > 0);
        messages.forEach(message => {
          // The log() function will add its own timestamp and handle file logging.
          // The [INTERCEPTOR:] prefix from interceptor-node.js will be part of the message.
          log(message); 
        });
      });
      realServerTransport.process.stderr.on('error', (err) => {
        log(`[MCP Proxy] Error on real MCP server stderr stream: ${err.message}`);
      });
       // Also capture stdout for completeness, in case the interceptor or server logs there unexpectedly
      if (realServerTransport.process.stdout) {
        realServerTransport.process.stdout.on('data', (data) => {
            const messages = data.toString().split('\n').filter(line => line.trim().length > 0);
            messages.forEach(message => {
              log(`[CHILD_STDOUT] ${message}`);
            });
        });
        realServerTransport.process.stdout.on('error', (err) => {
            log(`[MCP Proxy] Error on real MCP server stdout stream: ${err.message}`);
        });
      }
      log('[MCP Proxy] Interceptor logs (from the wrapped server) will be prefixed with [INTERCEPTOR:] and other child process outputs will be prefixed with [CHILD_STDOUT] or will appear directly if they are from the interceptor.');
    } else {
      log('[MCP Proxy] Warning: Could not attach stderr/stdout listener to the real MCP server process. Interceptor or server logs might not be fully captured in the main log file.');
    }
    
    // Initialize our proxy server
    const proxyServer = new Server(
      {
        name: 'mcp-proxy-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );
    
    // Set handlers to proxy requests to the real server
    
    // Tools
    proxyServer.setRequestHandler(ListToolsRequestSchema, async () => {
      log('[MCP Proxy] Listing tools from real server');
      try {
        const toolsResponse = await realServerClient.listTools();
        log(`[MCP Proxy] Retrieved ${toolsResponse.tools?.length || 0} tools from real server`);
        return toolsResponse;
      } catch (error) {
        log(`[MCP Proxy] Error listing tools: ${error.message}`);
        throw new McpError(ErrorCode.InternalError, `Failed to list tools: ${error.message}`);
      }
    });
    
    proxyServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      log(`[MCP Proxy] Calling tool '${name}' on real server with args: ${JSON.stringify(args)}`);
      try {
        const callResult = await realServerClient.callTool({
          name,
          arguments: args,
        });
        log(`[MCP Proxy] Tool '${name}' executed successfully`);
        return callResult;
      } catch (error) {
        log(`[MCP Proxy] Error calling tool '${name}': ${error.message}`);
        throw new McpError(ErrorCode.InternalError, `Failed to call tool '${name}': ${error.message}`);
      }
    });
    
    // Resources
    proxyServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      log('[MCP Proxy] Listing resources from real server');
      try {
        const resourcesResponse = await realServerClient.listResources();
        log(`[MCP Proxy] Retrieved ${resourcesResponse.resources?.length || 0} resources from real server`);
        return resourcesResponse;
      } catch (error) {
        log(`[MCP Proxy] Error listing resources: ${error.message}`);
        throw new McpError(ErrorCode.InternalError, `Failed to list resources: ${error.message}`);
      }
    });
    
    proxyServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      log(`[MCP Proxy] Reading resource '${uri}' from real server`);
      try {
        const readResult = await realServerClient.readResource({ uri });
        log(`[MCP Proxy] Resource '${uri}' read successfully`);
        return readResult;
      } catch (error) {
        log(`[MCP Proxy] Error reading resource '${uri}': ${error.message}`);
        throw new McpError(ErrorCode.InternalError, `Failed to read resource '${uri}': ${error.message}`);
      }
    });
    
    // Prompts
    proxyServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      log('[MCP Proxy] Listing prompts from real server');
      try {
        const promptsResponse = await realServerClient.listPrompts();
        log(`[MCP Proxy] Retrieved ${promptsResponse.prompts?.length || 0} prompts from real server`);
        return promptsResponse;
      } catch (error) {
        log(`[MCP Proxy] Error listing prompts: ${error.message}`);
        throw new McpError(ErrorCode.InternalError, `Failed to list prompts: ${error.message}`);
      }
    });
    
    proxyServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      log(`[MCP Proxy] Getting prompt '${name}' from real server with args: ${JSON.stringify(args)}`);
      try {
        const promptResult = await realServerClient.getPrompt({
          name,
          arguments: args,
        });
        log(`[MCP Proxy] Prompt '${name}' retrieved successfully`);
        return promptResult;
      } catch (error) {
        log(`[MCP Proxy] Error getting prompt '${name}': ${error.message}`);
        throw new McpError(ErrorCode.InternalError, `Failed to get prompt '${name}': ${error.message}`);
      }
    });
    
    // Connect our proxy server to stdio
    const proxyTransport = new StdioServerTransport();
    await proxyServer.connect(proxyTransport);
    
    log('[MCP Proxy] Server connected and ready');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      log('[MCP Proxy] Shutting down...');
      await proxyServer.close();
      await realServerClient.close();
      process.exit(0);
    });
  } catch (error) {
    log(`[MCP Proxy] Error starting proxy server: ${error.message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  log(`[MCP Proxy] Unhandled error: ${error.message}`);
  process.exit(1);
});
