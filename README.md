# MCP Wrapper

A secure sandbox system for running MCP servers with controlled resource access and system isolation.

## Core Concept

MCP Wrapper creates a secure execution environment where MCP servers operate with restricted permissions. The architecture:

1. **Intercepts system calls** from MCP servers
2. **Redirects operations** through an authenticated bridge portal
3. **Controls access** to network, file system, and system resources

This allows running MCP servers in isolated environments while still providing necessary capabilities through secure, authenticated channels.

## Architecture Components

### Main Server

- Central WebSocket server that manages sandbox environments
- Handles bridges registration and authentication
- Manages communication between components
- Controls sandbox lifecycle (create, run, terminate)

### MCP Client

- Management interface for the entire system
- Controls MCP server instances
- Generates bridge authentication tokens
- Monitors running sandboxes
- Sends commands to sandbox instances
- Views output and responses

### Bridge Portal

- Privileged intermediary for secured operations
- Handles actual network requests, file access, and system commands
- Can have multiple instances with different capabilities
- Only one active bridge at a time (determined by environment)
- Connects to main server using secure authentication tokens

### Sandbox Environment

- Isolated execution context for MCP servers
- Intercepts all system calls and external interactions
- Redirects operations to the active bridge portal
- Prevents direct access to host system

## Features

- Complete file system isolation
- Multi-language support (Node.js and Python)
- Customizable environment variables
- Path virtualization (conversion of system paths to virtual paths)
- Prevention of access outside the sandbox
- Blocking of unauthorized network access
- Bridge authentication via secure tokens
- Multiple bridge support with environment-based activation

## Installation

```bash
npm install
```

## Usage

To run the tests:

```bash
npm run start
```

## Communication Flow

1. **MCP Client** connects to Main Server
2. Client generates authentication tokens for Bridge Portal
3. **Bridge Portal** connects to Main Server using token
4. Client starts MCP server in **Sandbox Environment**
5. Sandboxed MCP server executes with restricted permissions
6. When MCP server needs privileged access:
   - Request is intercepted by wrapper
   - Request is forwarded to active Bridge Portal
   - Bridge Portal performs operation with proper permissions
   - Results are returned to sandboxed MCP server

## Project Structure

- `/server`: Main server code
- `/wrapper`: Sandbox and wrapper code
- `/mount`: Virtual mount point for scripts
- `/mcp_client`: Flutter control interface for the system
- `/mcp_bridge_portal`: Flutter application for privileged access bridge

## Security Benefits

- **Isolation**: MCP servers cannot directly access host system
- **Access Control**: All privileged operations pass through authenticated bridge
- **Environment Separation**: Different bridges can provide different capabilities
- **Token Authentication**: Only authorized bridges can connect
- **Operation Auditing**: All bridge operations can be monitored and logged

## Tests

The project includes tests for:

- File operations in Node.js
- File operations in Python
- Security restriction tests
- HTTP request tests
- Bridge authentication and communication

## System Architecture Diagram (Mermaid)

```mermaid
graph TD
    subgraph "MCP Client (Flutter App)"
        ClientUI["UI Components - mcp_client/lib/main.dart"]
        ClientWebsocketService["WebSocketService - mcp_client/lib/services/websocket_service.dart"]
    end

    subgraph "Main Server (Node.js - main.js)"
        MainWSS["WebSocket Server"]
        SessionManager["Session Management"]
        BridgeRegistry["Connected Flutter Bridges Registry"]
        SandboxLifecycle["Sandbox Lifecycle Management"]
        RequestRouter["Request/Response Router"]
    end

    subgraph "Sandbox Process (Node.js - Child Process)"
        SandboxWrapper["Sandbox - wrapper/sandbox.js"]
        SandboxBridgeClient["Bridge (Client to Main Server) - wrapper/bridge.js"]
        NodeInterceptor["NodeInterceptor - interceptors/NodeInterceptor.js"]
        UserScript["User's Node.js Script"]
    end

    subgraph "MCP Bridge Portal (Flutter App - mcp_bridge_portal/lib/main.dart)"
        PortalUI["UI Components"]
        BridgePortalService["BridgeService - mcp_bridge_portal/lib/services/bridge_service.dart"]
    end

    ClientUI -->|"Sends commands (start, stop, tool calls)"| ClientWebsocketService
    ClientWebsocketService -->|"WebSocket (ws://localhost:3000)"| MainWSS

    MainWSS -->|"Manages"| SessionManager
    MainWSS -->|"Manages"| BridgeRegistry
    MainWSS -->|"Delegates to"| SandboxLifecycle
    MainWSS -->|"Uses"| RequestRouter

    SandboxLifecycle --spawns--> SandboxProcess["Sandbox Process"]

    SandboxProcess --ipc--> MainWSS

    subgraph "SandboxProcess"
        SandboxWrapper --instantiates--> SandboxBridgeClient
        SandboxWrapper --instantiates--> NodeInterceptor
        NodeInterceptor --uses--> SandboxBridgeClient
        NodeInterceptor --"intercepts calls from"--> UserScript
        SandboxBridgeClient -->|"WebSocket (ws://localhost:3000)"| MainWSS
    end

    PortalUI -->|"Bridge Registration, Handles intercepted calls"| BridgePortalService
    BridgePortalService -->|"WebSocket (ws://localhost:3000)"| MainWSS

    RequestRouter -->|"Forwards intercepted calls to"| BridgeRegistry
    BridgeRegistry -->|"Routes to specific"| BridgePortalService
    BridgePortalService -->|"Executes native operation"| DevicePlatform
    DevicePlatform -->|"Response"| BridgePortalService
    BridgePortalService -->|"Response to"| MainWSS
    RequestRouter -->|"Forwards response back to"| SandboxBridgeClient
    SandboxBridgeClient -->|"Response to"| UserScript

    MainWSS -->|"Forwards stdout/stderr"| ClientWebsocketService
    ClientWebsocketService -->|"Displays logs"| ClientUI
```

## Operational Flow Diagram (Mermaid)

```mermaid
sequenceDiagram
    participant ClientUI as MCP Client UI
    participant ClientWS as MCP Client WebSocketService
    participant MainServer as Main.js Server (WSS)
    participant SandboxProcess as Sandbox Child Process
    participant SandboxBridge as Sandbox Bridge (wrapper/bridge.js)
    participant Interceptor as NodeInterceptor
    participant UserScript as User's Script
    participant BridgePortal as MCP Bridge Portal (Flutter)

    ClientUI->>+ClientWS: User clicks "Start Script" (selects script, targetFlutterBridgeId)
    ClientWS->>+MainServer: Send 'start' (scriptPath, env, sandboxId, config.targetFlutterBridgeId)
    MainServer->>MainServer: Create Sandbox Process entry in session.sandboxes (keyed by sandboxId)
    MainServer-->>-SandboxProcess: Fork sandbox.js process
    MainServer->>SandboxProcess: IPC: 'bridge_register' (targetFlutterBridgeId, clientSessionId, actualSandboxId)

    SandboxProcess->>+SandboxBridge: Instantiate Bridge(clientSessionId, actualSandboxId)
    SandboxProcess->>SandboxBridge: Set targetFlutterBridgeId
    SandboxBridge->>+MainServer: WebSocket: 'bridge_register' (origin: sandbox_bridge_client, targetFlutterBridgeId, clientSessionId, actualSandboxId, instanceId)
    MainServer->>-SandboxBridge: WebSocket: 'bridge_registered' (ack)
    activate SandboxProcess
    SandboxProcess->>MainServer: IPC: 'sandbox_ready' (actualSandboxId)
    deactivate SandboxProcess

    SandboxProcess->>Interceptor: Apply Hooks
    SandboxProcess->>UserScript: Execute User Script

    Note over ClientUI,UserScript: Standard Intercepted Operation Flow

    activate UserScript
    UserScript->>+Interceptor: Makes an intercepted call (e.g., fs.readFile)
    Interceptor->>+SandboxBridge: handleInterceptedCall(type, payload)
    SandboxBridge->>+MainServer: WebSocket: Intercepted Call (fs_read, payload, targetFlutterBridgeId, clientSessionId, actualSandboxId, requestId)

    MainServer->>MainServer: Store in pendingSandboxRequests (key: newForwardedId, value: {originalSandboxReqId, sandboxClientWs, routingInfo})
    MainServer->>+BridgePortal: WebSocket: Forwarded Call (fs_read, payload, newForwardedId, routingInfo)

    BridgePortal->>BridgePortal: Execute native operation (e.g., actual file read)
    BridgePortal->>-MainServer: WebSocket: Response (bridge_response_from_portal, data/error, newForwardedId, routingInfo)

    MainServer->>MainServer: Retrieve from pendingSandboxRequests using newForwardedId
    MainServer->>-SandboxBridge: WebSocket: Response (bridge_response, data/error, originalSandboxReqId)
    SandboxBridge->>-Interceptor: Return result/error
    Interceptor->>-UserScript: Return result/error
    deactivate UserScript

    Note over ClientUI,UserScript: JSON-RPC Command Flow

    ClientUI->>ClientWS: Send command to sandbox (e.g., tools/list)
    ClientWS->>MainServer: WebSocket: 'sandbox_command' (command, params, actualSandboxId)
    MainServer->>MainServer: Find sandbox by actualSandboxId
    MainServer->>SandboxBridge: WebSocket: 'sandbox_command' (command, params, requestId)
    SandboxBridge->>SandboxProcess: Handle command
    SandboxProcess->>SandboxProcess: Process command (e.g., list available tools)
    SandboxProcess->>SandboxBridge: Command result
    SandboxBridge->>MainServer: WebSocket: 'sandbox_command_result' (result, requestId, actualSandboxId)
    MainServer->>ClientWS: WebSocket: 'sandbox_command_result' (result, actualSandboxId)
    ClientWS->>ClientUI: Display command result

    Note over ClientUI,UserScript: Console Output Flow

    UserScript->>SandboxBridge: console.log() / console.error()
    SandboxBridge->>MainServer: WebSocket: 'stdout'/'stderr' (message, actualSandboxId, clientSessionId)
    MainServer->>ClientWS: WebSocket: 'stdout'/'stderr' (message, actualSandboxId, clientSessionId)
    ClientWS->>ClientUI: Display log
```
