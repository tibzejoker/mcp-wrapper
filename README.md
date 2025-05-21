# MCP Wrapper

A proxy wrapper for MCP (Model Context Protocol) servers.

## Overview

This project creates a proxy layer that sits between MCP clients and MCP servers. It forwards requests from clients to the real MCP server and returns the responses.

## Features

- Acts as a bridge between MCP clients and real MCP servers
- Transparently forwards all MCP protocol operations (tools, resources, prompts)
- Preserves environment variables and context
- Handles errors gracefully
- Detailed logging to a file in the directory specified by MCP_WRAPPER_LOG_PATH environment variable

## Usage

### Configuration

The MCP wrapper requires command-line arguments and environment variables:

1. Command-line arguments:

   - First argument: The command to run the real MCP server (e.g., "node")
   - Second argument: The path to the real MCP server script (e.g., "/path/to/real/mcp-server/build/index.js")

2. Environment variables (via .env file or system environment):
   - MCP_WRAPPER_LOG_PATH: The directory where logs should be stored (e.g., "/Users/username/logs")
   - Any environment variables required by the real MCP server

#### Configuration Change Note

The configuration structure has changed from the original version:

**Before (Original):**

```json
{
  "mcpServers": {
    "my mcp server": {
      "command": "node /path/to/real/mcp-server/build/index.js",
      "env": {
        "HOME_LOG_PATH": "/Users/username/logs",
        "OTHER_ENV_VAR": "value"
      }
    }
  }
}
```

**After (Current):**

```json
{
  "mcpServers": {
    "my mcp server": {
      "command": "node",
      "args": [
        "dist/index.js",
        "node",
        "/path/to/real/mcp-server/build/index.js"
      ],
      "env": {
        "MCP_WRAPPER_LOG_PATH": "/Users/username/logs",
        "OTHER_ENV_VAR": "value"
      }
    }
  }
}
```

Note that:

1. The wrapper itself is now specified in the command field ("node") with its path in args[0] ("dist/index.js")
2. The real MCP server command and path are now args[1] and args[2]
3. The environment variable has changed from HOME_LOG_PATH to MCP_WRAPPER_LOG_PATH

The wrapper is designed to be run automatically by tools like Claude and Cursor, not manually launched.

### Building

To build the wrapper:

```bash
npm run build
```

This will copy the main.js file to dist/index.js.

### Development

To watch for changes and automatically rebuild:

```bash
npm run watch
```

## How It Works

1. The MCP client connects to the wrapper server
2. The wrapper server connects to the real MCP server using the provided command and arguments
3. Requests from the client are forwarded to the real server
4. Responses from the real server are returned to the client
5. All operations are logged to the console and a log file in the MCP_WRAPPER_LOG_PATH directory

This allows you to add a proxy layer that can:

- Modify requests or responses
- Add logging
- Handle authentication
- Implement rate limiting
- Add caching

## Logs

The MCP wrapper logs all operations to:

- Console output (for real-time monitoring)
- Log file at `$MCP_WRAPPER_LOG_PATH/mcp-proxy.log` (if MCP_WRAPPER_LOG_PATH is set)

Each log entry includes:

- Timestamp (ISO format)
- Operation type (listing tools, calling tools, etc.)
- Request details
- Response summary
- Error information (when applicable)

### Monitoring Logs

To tail the log file and monitor activity in real-time, run:

```bash
npm run tail-log
```

This will display the existing log content and watch for new entries. Press Ctrl+C to exit.

## Requirements

- Node.js 14 or higher
- An MCP client
- A real MCP server to proxy to
- Write access to the MCP_WRAPPER_LOG_PATH directory
