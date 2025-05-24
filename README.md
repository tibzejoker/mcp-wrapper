# MCP Interceptor (MCP Proxy Server)

The MCP Interceptor, also referred to as the "MCP Proxy Server" in its logs, is a Node.js application designed to act as an intermediary between an MCP (Model Context Protocol) client and a real MCP server. It forwards requests and responses, allowing for observation and potentially modification of the communication.

A key capability of this proxy is the "Server Interception Feature," which provides insights into the internal operations of the wrapped Node.js server.

## Server Interception Feature

This feature allows for capturing and logging various low-level activities performed by the wrapped Node.js server application. Specifically, it can intercept:

*   File system access attempts (e.g., reading, writing, creating directories).
*   Network access attempts (e.g., making HTTP/HTTPS requests, starting servers).
*   Child process creation attempts.

This interception is achieved by preloading a special script, `interceptor-node.js`, into the target Node.js server process when it's launched by the proxy.

### How it Works

1.  The `main.js` script of the MCP Proxy Server launches the target Node.js server (specified by the `realLaunchCommand` and `realMcpServerPath` command-line arguments).
2.  The launch command is effectively modified to: `node --require /path/to/interceptor-node.js <realMcpServerPath> [other_server_args...]`.
3.  The `interceptor-node.js` script, once loaded into the target server's process, performs "monkey-patching" on several standard Node.js built-in modules. These include:
    *   `fs` (File System)
    *   `net` (Networking)
    *   `http` (HTTP)
    *   `https` (HTTPS)
    *   `child_process` (Child Processes)
4.  By patching these modules, the interceptor can log calls to their functions, along with key arguments (like file paths, URLs, or commands), before allowing the original function to execute.

### Prerequisites and Assumptions

*   **Node.js Target**: This feature critically assumes that the `realMcpServerPath` argument points to a **Node.js script** (e.g., `your-server.js`).
*   **Node Launch Command**: It also assumes that `realLaunchCommand` is `node` or a command that transparently passes the `--require` option and script path to a Node.js runtime (e.g., `nodemon`, `ts-node` might work, but dedicated Node.js process managers might not).
*   **Not for Binaries**: The interception will **not** work for binary executables or non-Node.js scripts.

### Enabling the Feature

The Server Interception Feature is **enabled by default** under the following condition:

*   The `interceptor-node.js` script must be present in the same directory as `main.js`.

If `interceptor-node.js` is not found at startup, `main.js` will log a critical warning message, and the target server will be launched without interception capabilities.

### Viewing Interception Logs

Intercepted call logs are formatted with a specific prefix to distinguish them:

*   **Format**: `[INTERCEPTOR:module.functionName]`
    *   Example: `[INTERCEPTOR:fs.readFile] Called with path/fd: /path/to/your/file.txt`
    *   Example: `[INTERCEPTOR:ERROR:http.request] Error during call for with URL: http://example.com: Error: connect ECONNREFUSED`

**Log Destination**:

1.  The `interceptor-node.js` script writes these logs directly to the `stderr` stream of the wrapped server process.
2.  The `main.js` proxy server captures the `stderr` (and `stdout`) output of the child (wrapped server) process.
3.  If the `MCP_WRAPPER_LOG_PATH` environment variable is set (e.g., `MCP_WRAPPER_LOG_PATH=.`), `main.js` will write these captured logs, along with its own proxy activity logs, into a unified log file (e.g., `./mcp-proxy.log`).
    *   Logs from the child process's `stdout` are also captured and prefixed with `[CHILD_STDOUT]` by `main.js`.

This means you can find both the proxy's operational logs and the detailed interception logs from the target server within the same log file when `MCP_WRAPPER_LOG_PATH` is used. If not set, all logs (proxy and intercepted) will appear on the console's `stderr`.

### How to Test the Interception

The repository includes a `test-server.js` script designed to perform various file, network, and child process operations, making it ideal for observing the interception feature.

**Example Test Command**:

```bash
# Ensure you are in the root directory of the mcp-interceptor project.
# This command sets the log path to the current directory, launches main.js,
# tells it to use 'node' to run 'test-server.js'.

MCP_WRAPPER_LOG_PATH=. node main.js node test-server.js
```

After running this command:

1.  You will see output from `main.js` and `test-server.js` on your console.
2.  A log file named `mcp-proxy.log` will be created in the current directory (due to `MCP_WRAPPER_LOG_PATH=.`).
3.  This `mcp-proxy.log` file will contain:
    *   Timestamped logs from `main.js` (prefixed with `[MCP Proxy]`).
    *   Timestamped logs from `test-server.js`'s own logging (prefixed with `[TestServer]`).
    *   Crucially, detailed interception logs prefixed with `[INTERCEPTOR:...]`, showing the activities performed by `test-server.js` as captured by `interceptor-node.js`.
    *   Any direct `stdout` from `test-server.js` (if it had any not captured by its own logger) would be prefixed with `[CHILD_STDOUT]`.

This provides a clear demonstration of the Server Interception Feature in action.
