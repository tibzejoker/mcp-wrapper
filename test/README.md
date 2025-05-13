# MCP Wrapper Network Test Servers

These test servers are designed to help debug network redirection from the MCP Wrapper to the Bridge Portal.

## Available Test Servers

### 1. Ping Test Server (`ping_server.js`)

- Sends a ping to 192.168.1.1 every second
- Useful for testing basic process spawning and network access

### 2. HTTP Test Server (`http_ping_server.js`)

- Makes HTTP requests to 192.168.1.1:80 every second
- Useful for testing HTTP network access redirection

### 3. Network Test Server (`network_test_server.js`)

- Comprehensive network test suite that runs every second:
  - Ping test to 192.168.1.1
  - DNS lookup for google.com
  - HTTP request to example.com
- Best for testing all aspects of network redirection

## Running the Tests

### Using the Script

The easiest way to run the tests is using the included shell script:

```bash
./run_tests.sh
```

This will present a menu to choose which test server to run.

### Running Individually

You can also run each test server individually:

```bash
# Run the ping test server
node ping_server.js
# or
node dist/ping_server.bundle.js

# Run the HTTP test server
node http_ping_server.js
# or
node dist/http_server.bundle.js

# Run the comprehensive network test server
node network_test_server.js
# or
node dist/network_server.bundle.js
```

### Using npm scripts

```bash
# Run the ping test server
npm run ping

# Run the HTTP test server
npm run http

# Run the comprehensive network test server
npm run network
```

## Building the Test Servers

The test servers can be bundled using webpack for easier distribution:

```bash
# Build all test servers
npm run build

# Build individual test servers
npm run build:ping
npm run build:http
npm run build:network
```

Bundled versions will be output to the `dist/` directory.

## Debugging

When running these test servers in the MCP Wrapper environment, you should see:

1. Network operations being intercepted by the wrapper
2. Requests being redirected to the Bridge Portal
3. Bridge Portal handling the actual network operations
4. Results being returned to the test server

Look for errors or missing redirections to identify issues in the network redirection pipeline.
