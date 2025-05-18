import 'package:flutter/material.dart';
import 'services/bridge_service.dart';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:async';

void main() {
  runApp(const MCPBridgePortal());
}

class MCPBridgePortal extends StatelessWidget {
  const MCPBridgePortal({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MCP Bridge Portal',
      themeMode: ThemeMode.dark,
      darkTheme: ThemeData.dark(useMaterial3: true).copyWith(
        colorScheme: const ColorScheme.dark(
          primary: Colors.blueGrey,
          secondary: Colors.teal,
          surface: Color(0xFF1E1E1E),
          background: Color(0xFF121212),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1E1E1E),
          foregroundColor: Colors.white,
        ),
        cardTheme: const CardTheme(
          color: Color(0xFF242424),
        ),
        scaffoldBackgroundColor: const Color(0xFF121212),
      ),
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
      ),
      debugShowCheckedModeBanner: false,
      home: const BridgePortalPage(),
    );
  }
}

class BridgePortalPage extends StatefulWidget {
  const BridgePortalPage({super.key});

  @override
  State<BridgePortalPage> createState() => _BridgePortalPageState();
}

class _BridgePortalPageState extends State<BridgePortalPage> {
  final _serverUrlController =
      TextEditingController(text: 'ws://192.168.1.27:3000');
  final _bridgeIdController = TextEditingController();
  final _outputController = TextEditingController();
  final _testParamsController = TextEditingController();
  final _allowedPathsController =
      TextEditingController(text: '/tmp,${Directory.systemTemp.path}');
  String _selectedTestMethod = 'bridgeFetch';
  Map<String, dynamic>? _lastRequestParams;
  Map<String, dynamic>? _lastResponse;
  BridgeService? _bridgeService;
  bool _isConnected = false;
  bool _enforceFilePathRestrictions = true;
  String _connectionStatusMessage = 'Not connected';

  // New fields to track connected sandboxes
  List<Map<String, dynamic>> _connectedSandboxes = [];

  final List<String> _availableTestMethods = [
    'bridgeFetch',
    'bridgeListMethods',
    'bridgeFsRead',
    'bridgeFsWrite',
  ];

  @override
  void initState() {
    super.initState();

    // Generate a random bridge ID if none is provided
    _bridgeIdController.text = _generateRandomBridgeId();
  }

  // Generate a random bridge ID
  String _generateRandomBridgeId() {
    final random = Random();
    final values = List<int>.generate(8, (i) => random.nextInt(255));
    return values.map((v) => v.toRadixString(16).padLeft(2, '0')).join('');
  }

  void _connect() {
    if (_serverUrlController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a server URL')),
      );
      return;
    }

    if (_bridgeIdController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a bridge ID')),
      );
      return;
    }

    setState(() {
      _connectionStatusMessage = 'Connecting...';
    });

    _bridgeService = BridgeService(
      bridgeId: _bridgeIdController.text.trim(),
      onConnected: (message) {
        setState(() {
          _isConnected = true;
          _connectionStatusMessage = message;
          _log('Connected with ID: ${_bridgeIdController.text.trim()}');
        });

        // Configure security settings
        _updateSecuritySettings();

        // Request connected sandboxes as soon as we connect
        _requestConnectedSandboxes();

        // Set up a timer to periodically refresh the sandbox list
        _startSandboxRefreshTimer();
      },
      onDisconnected: (message) {
        setState(() {
          _isConnected = false;
          _connectionStatusMessage = message;
          _connectedSandboxes.clear();
          _log('Disconnected: $message');
        });

        // Cancel the refresh timer when disconnected
        _cancelSandboxRefreshTimer();
      },
      onError: (message) {
        setState(() {
          _isConnected = false;
          _connectionStatusMessage = 'Error: $message';
        });
        _log('Error: $message');
      },
      onSandboxUpdate: (sandboxes) {
        setState(() {
          if (sandboxes.isEmpty) {
            _log(
                'Received empty sandboxes update. Current count: ${_connectedSandboxes.length}');
          } else {
            _log('Updated connected sandboxes: ${sandboxes.length}');
            for (final sandbox in sandboxes) {
              _log(
                  '  - Sandbox: ${sandbox['id']}, Script: ${sandbox['scriptPath']}');
            }
          }
          _connectedSandboxes = sandboxes;
        });
      },
    );

    // Register handlers for supported methods
    _registerHandlers();

    // Connect to the server
    _bridgeService!.connect(_serverUrlController.text);
  }

  void _updateSecuritySettings() {
    if (_bridgeService == null) return;

    // Parse allowed paths
    List<String> allowedPaths = [];
    if (_allowedPathsController.text.isNotEmpty) {
      allowedPaths = _allowedPathsController.text
          .split(',')
          .map((path) => path.trim())
          .where((path) => path.isNotEmpty)
          .toList();
    }

    _bridgeService!.configureSecurity(
      allowedFilePaths: allowedPaths,
      enforceFilePathRestrictions: _enforceFilePathRestrictions,
    );

    _log(
        'Security settings updated: enforceRestrictions=$_enforceFilePathRestrictions, allowedPaths=$allowedPaths');
  }

  void _disconnect() {
    _bridgeService?.disconnect();
    _bridgeService = null;
    setState(() {
      _isConnected = false;
      _connectionStatusMessage = 'Manually disconnected';
      _log('Manually disconnected');
    });
  }

  void _registerHandlers() {
    // Register file system handler
    _bridgeService?.registerHandler(
      'fs_access',
      (params) {
        _log('Received file system request: ${params.toString()}');
        setState(() {
          _lastRequestParams = params;
        });
        // Implement file system access
        return {'status': 'success'};
      },
    );

    // Register web request handler
    _bridgeService?.registerHandler(
      'web_request',
      (params) {
        _log('Received web request: ${params.toString()}');
        setState(() {
          _lastRequestParams = params;
        });
        // Implement web request handling
        return {'status': 'success'};
      },
    );

    // Register system command handler
    _bridgeService?.registerHandler(
      'system_command',
      (params) {
        _log('Received system command: ${params.toString()}');
        setState(() {
          _lastRequestParams = params;
        });
        // Implement system command execution
        return {'status': 'success'};
      },
    );
  }

  void _executeTestMethod() async {
    if (!_isConnected || _bridgeService == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please connect to a server first')),
      );
      return;
    }

    // Parse the test parameters
    Map<String, dynamic> params = {};
    try {
      if (_testParamsController.text.isNotEmpty) {
        params = Map<String, dynamic>.from(
            jsonDecode(_testParamsController.text) as Map);
      }
    } catch (e) {
      _log('Error parsing parameters: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Invalid JSON parameters: $e')),
      );
      return;
    }

    _log('Testing method: $_selectedTestMethod with params: $params');
    setState(() {
      _lastRequestParams = params;
      _lastResponse = null; // Clear previous response
    });

    try {
      // Use the public executeMethod for testing
      final result =
          await _bridgeService!.executeMethod(_selectedTestMethod, params);
      _log('Test completed successfully');
      setState(() {
        _lastResponse = result;
      });
    } catch (e) {
      _log('Error executing test: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Test failed: $e')),
      );
    }
  }

  void _log(String message) {
    setState(() {
      _outputController.text = '${_outputController.text}\n$message';
    });
  }

  // New method to request connected sandboxes
  void _requestConnectedSandboxes() {
    if (_bridgeService != null && _isConnected) {
      _bridgeService!.requestConnectedSandboxes();
    }
  }

  // Start a timer to refresh the sandbox list
  Timer? _sandboxRefreshTimer;

  void _startSandboxRefreshTimer() {
    // Cancel any existing timer
    _cancelSandboxRefreshTimer();

    // Create a new timer that refreshes every 10 seconds
    _sandboxRefreshTimer = Timer.periodic(const Duration(seconds: 10), (timer) {
      if (_isConnected) {
        _requestConnectedSandboxes();
      } else {
        _cancelSandboxRefreshTimer();
      }
    });
  }

  void _cancelSandboxRefreshTimer() {
    _sandboxRefreshTimer?.cancel();
    _sandboxRefreshTimer = null;
  }

  @override
  void dispose() {
    _cancelSandboxRefreshTimer();
    _bridgeService?.disconnect();
    _serverUrlController.dispose();
    _bridgeIdController.dispose();
    _outputController.dispose();
    _testParamsController.dispose();
    _allowedPathsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('MCP Bridge Portal'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        actions: [
          // Add a connection status indicator in the app bar
          Container(
            margin: const EdgeInsets.only(right: 16),
            child: Chip(
              label: Text(
                _isConnected ? 'CONNECTED' : 'DISCONNECTED',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: _isConnected ? Colors.white : Colors.grey[800],
                ),
              ),
              backgroundColor: _isConnected ? Colors.green : Colors.grey[300],
              padding: const EdgeInsets.symmetric(horizontal: 8),
            ),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Status Card with Bridge ID
              Card(
                elevation: 2,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8)),
                child: Padding(
                  padding: const EdgeInsets.all(12.0),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Icon(
                            _isConnected
                                ? Icons.check_circle
                                : (_connectionStatusMessage == 'Connecting...'
                                    ? Icons.pending
                                    : Icons.info_outline),
                            color: _isConnected
                                ? Colors.green
                                : (_connectionStatusMessage == 'Connecting...'
                                    ? Colors.orange
                                    : Colors.grey),
                            size: 24,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _isConnected
                                      ? 'CONNECTED'
                                      : (_connectionStatusMessage ==
                                              'Connecting...'
                                          ? 'CONNECTING...'
                                          : 'NOT CONNECTED'),
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                    color: _isConnected
                                        ? Colors.green.shade800
                                        : (_connectionStatusMessage ==
                                                'Connecting...'
                                            ? Colors.orange.shade800
                                            : Colors.grey.shade800),
                                  ),
                                ),
                                Text(
                                  _connectionStatusMessage,
                                  style: const TextStyle(fontSize: 12),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          if (_isConnected)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.green.shade50,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: Colors.green),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.verified,
                                      color: Colors.green, size: 14),
                                  const SizedBox(width: 4),
                                  Text(
                                    'ID: ${_bridgeIdController.text}',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: Colors.green,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Connection settings card
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Connection Settings',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            flex: 2,
                            child: TextField(
                              controller: _serverUrlController,
                              decoration: const InputDecoration(
                                border: OutlineInputBorder(),
                                labelText: 'Server URL',
                                hintText: 'ws://localhost:3000',
                              ),
                              enabled: !_isConnected,
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            flex: 1,
                            child: TextField(
                              controller: _bridgeIdController,
                              decoration: const InputDecoration(
                                border: OutlineInputBorder(),
                                labelText: 'Bridge ID',
                                hintText: 'Enter your bridge ID',
                              ),
                              enabled: !_isConnected,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: ElevatedButton(
                              onPressed: _isConnected ? null : _connect,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.green,
                                foregroundColor: Colors.white,
                              ),
                              child: const Text('Connect'),
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: ElevatedButton(
                              onPressed: _isConnected ? _disconnect : null,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: Colors.red,
                                foregroundColor: Colors.white,
                              ),
                              child: const Text('Disconnect'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),

              // Security settings
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Security Settings',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Checkbox(
                            value: _enforceFilePathRestrictions,
                            onChanged: _isConnected
                                ? (value) {
                                    setState(() {
                                      _enforceFilePathRestrictions =
                                          value ?? true;
                                      _updateSecuritySettings();
                                    });
                                  }
                                : null,
                          ),
                          const Text('Enforce file path restrictions'),
                        ],
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _allowedPathsController,
                        decoration: const InputDecoration(
                          labelText: 'Allowed File Paths (comma-separated)',
                          border: OutlineInputBorder(),
                          hintText: '/tmp,C:/temp',
                        ),
                        enabled: _isConnected && _enforceFilePathRestrictions,
                        onChanged: (_) {
                          if (_isConnected) {
                            _updateSecuritySettings();
                          }
                        },
                      ),
                    ],
                  ),
                ),
              ),

              // Display connected sandboxes (new section)
              if (_isConnected) ...[
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'Connected Sandboxes',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            Row(
                              children: [
                                Text(
                                  'Count: ${_connectedSandboxes.length}',
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: _connectedSandboxes.isEmpty
                                        ? Colors.orange
                                        : Colors.green,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                IconButton(
                                  icon: const Icon(Icons.refresh),
                                  onPressed: _requestConnectedSandboxes,
                                  tooltip: 'Refresh sandbox list',
                                ),
                              ],
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        if (_connectedSandboxes.isEmpty)
                          Container(
                            padding: const EdgeInsets.all(16.0),
                            decoration: BoxDecoration(
                              color: Colors.orange.shade50,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: Colors.orange.shade300),
                            ),
                            child: Column(
                              children: [
                                const Icon(
                                  Icons.warning_amber_rounded,
                                  color: Colors.orange,
                                  size: 32,
                                ),
                                const SizedBox(height: 8),
                                const Text(
                                  'No sandboxes connected to this bridge',
                                  style: TextStyle(
                                    color: Colors.orange,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                const Text(
                                  'Start a Node.js script from the MCP Client and ensure it is assigned to this bridge.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: Colors.grey),
                                ),
                                const SizedBox(height: 16),
                                ElevatedButton.icon(
                                  icon: const Icon(Icons.refresh),
                                  label: const Text('Check for Assignments'),
                                  onPressed: _requestConnectedSandboxes,
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: Colors.orange,
                                    foregroundColor: Colors.white,
                                  ),
                                ),
                              ],
                            ),
                          )
                        else
                          Column(
                            children: _connectedSandboxes.map((sandbox) {
                              return Card(
                                margin: const EdgeInsets.only(bottom: 8.0),
                                child: ListTile(
                                  leading: const Icon(Icons.code,
                                      color: Colors.blue),
                                  title: Text(
                                    'Sandbox ID: ${sandbox['id'] ?? 'Unknown'}',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.bold),
                                  ),
                                  subtitle: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                          'Script: ${sandbox['scriptPath'] ?? 'Unknown'}'),
                                      Text(
                                          'Client Session: ${sandbox['sessionId'] ?? 'Unknown'}'),
                                    ],
                                  ),
                                  trailing: Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: Colors.green.shade100,
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Text(
                                      sandbox['status'] ?? 'Connected',
                                      style: TextStyle(
                                        color: Colors.green.shade800,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                  isThreeLine: true,
                                ),
                              );
                            }).toList(),
                          ),
                      ],
                    ),
                  ),
                ),
              ],

              // Method testing section
              if (_isConnected) ...[
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Test Bridge Methods',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            const Text('Method: '),
                            const SizedBox(width: 8),
                            DropdownButton<String>(
                              value: _selectedTestMethod,
                              items: _availableTestMethods
                                  .map((method) => DropdownMenuItem<String>(
                                        value: method,
                                        child: Text(method),
                                      ))
                                  .toList(),
                              onChanged: (value) {
                                if (value != null) {
                                  setState(() {
                                    _selectedTestMethod = value;
                                    // Set default params based on selected method
                                    if (value == 'bridgeFetch') {
                                      _testParamsController.text =
                                          '{"url": "https://example.com", "method": "GET"}';
                                    } else if (value == 'bridgeFsRead') {
                                      _testParamsController.text =
                                          '{"path": "/path/to/file", "encoding": "utf8"}';
                                    } else if (value == 'bridgeFsWrite') {
                                      _testParamsController.text =
                                          '{"path": "/path/to/file", "content": "Hello World", "encoding": "utf8"}';
                                    } else {
                                      _testParamsController.text = '{}';
                                    }
                                  });
                                }
                              },
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        const Text('Parameters (JSON):'),
                        const SizedBox(height: 4),
                        TextField(
                          controller: _testParamsController,
                          decoration: const InputDecoration(
                            border: OutlineInputBorder(),
                            hintText: '{"key": "value"}',
                          ),
                          maxLines: 5,
                          minLines: 3,
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _executeTestMethod,
                          child: const Text('Execute Method'),
                        ),
                        if (_lastRequestParams != null ||
                            _lastResponse != null) ...[
                          const SizedBox(height: 16),
                          const Divider(),
                          const SizedBox(height: 8),
                          const Text('Last Request/Response:',
                              style: TextStyle(fontWeight: FontWeight.bold)),
                          const SizedBox(height: 8),
                          if (_lastRequestParams != null) ...[
                            const Text('Request Parameters:'),
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: Colors.grey[200],
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: SelectableText(
                                const JsonEncoder.withIndent('  ')
                                    .convert(_lastRequestParams!),
                                style: const TextStyle(fontFamily: 'monospace'),
                              ),
                            ),
                          ],
                          if (_lastResponse != null) ...[
                            const SizedBox(height: 8),
                            const Text('Response:'),
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: Colors.grey[200],
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: SelectableText(
                                const JsonEncoder.withIndent('  ')
                                    .convert(_lastResponse!),
                                style: const TextStyle(fontFamily: 'monospace'),
                              ),
                            ),
                          ],
                        ],
                      ],
                    ),
                  ),
                ),
              ],

              // Output log
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        'Activity Log',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Container(
                        height: 200, // Set a fixed height for the log area
                        decoration: BoxDecoration(
                          border: Border.all(color: Colors.grey),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: SingleChildScrollView(
                          child: Padding(
                            padding: const EdgeInsets.all(8.0),
                            child: SelectableText(
                              _outputController.text,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 12,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton(
                            onPressed: () {
                              setState(() {
                                _outputController.clear();
                              });
                            },
                            child: const Text('Clear Log'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
