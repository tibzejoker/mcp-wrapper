import 'package:flutter/material.dart';
import 'services/bridge_service.dart';

void main() {
  runApp(const MCPBridgePortal());
}

class MCPBridgePortal extends StatelessWidget {
  const MCPBridgePortal({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MCP Bridge Portal',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
      ),
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
  final _serverUrlController = TextEditingController(text: 'ws://localhost:3000');
  final _bridgeIdController = TextEditingController();
  final _outputController = TextEditingController();
  BridgeService? _bridgeService;
  bool _isConnected = false;

  @override
  void dispose() {
    _serverUrlController.dispose();
    _bridgeIdController.dispose();
    _outputController.dispose();
    _bridgeService?.disconnect();
    super.dispose();
  }

  void _connect() {
    if (_bridgeIdController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a Bridge ID')),
      );
      return;
    }

    _bridgeService = BridgeService(
      bridgeId: _bridgeIdController.text,
      onConnected: (message) {
        setState(() {
          _isConnected = true;
          _log('Connected: $message');
        });
        _registerHandlers();
      },
      onDisconnected: (message) {
        setState(() {
          _isConnected = false;
          _log('Disconnected: $message');
        });
      },
      onError: (error) {
        _log('Error: $error');
      },
    );

    _bridgeService!.connect(_serverUrlController.text);
  }

  void _disconnect() {
    _bridgeService?.disconnect();
    setState(() {
      _isConnected = false;
      _log('Manually disconnected');
    });
  }

  void _registerHandlers() {
    // Register file system handler
    _bridgeService?.registerHandler(
      'fs_access',
      (params) {
        _log('Received file system request: ${params.toString()}');
        // Implement file system access
        return {'status': 'success'};
      },
    );

    // Register web request handler
    _bridgeService?.registerHandler(
      'web_request',
      (params) {
        _log('Received web request: ${params.toString()}');
        // Implement web request handling
        return {'status': 'success'};
      },
    );

    // Register system command handler
    _bridgeService?.registerHandler(
      'system_command',
      (params) {
        _log('Received system command: ${params.toString()}');
        // Implement system command execution
        return {'status': 'success'};
      },
    );
  }

  void _log(String message) {
    setState(() {
      _outputController.text = '${_outputController.text}\n$message';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('MCP Bridge Portal'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Connection controls
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
                    TextField(
                      controller: _serverUrlController,
                      decoration: const InputDecoration(
                        labelText: 'Server URL',
                        border: OutlineInputBorder(),
                      ),
                      enabled: !_isConnected,
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _bridgeIdController,
                      decoration: const InputDecoration(
                        labelText: 'Bridge ID',
                        border: OutlineInputBorder(),
                      ),
                      enabled: !_isConnected,
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        if (_isConnected)
                          ElevatedButton(
                            onPressed: _disconnect,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.red,
                              foregroundColor: Colors.white,
                            ),
                            child: const Text('Disconnect'),
                          )
                        else
                          ElevatedButton(
                            onPressed: _connect,
                            child: const Text('Connect'),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Status indicators
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Bridge Status',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Icon(
                          _isConnected ? Icons.check_circle : Icons.error,
                          color: _isConnected ? Colors.green : Colors.red,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _isConnected ? 'Connected' : 'Disconnected',
                          style: TextStyle(
                            color: _isConnected ? Colors.green : Colors.red,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Output log
            Expanded(
              child: Card(
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
                      Expanded(
                        child: Container(
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
            ),
          ],
        ),
      ),
    );
  }
}
