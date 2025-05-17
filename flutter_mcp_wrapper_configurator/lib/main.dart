import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:convert';
import 'dart:async';
import 'package:shared_preferences/shared_preferences.dart';
import 'services/websocket_service.dart';
import 'services/script_service.dart';
import 'dart:math';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(MyApp(prefs: prefs));
}

class MyApp extends StatelessWidget {
  final SharedPreferences prefs;

  const MyApp({super.key, required this.prefs});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MCP Client',
      theme: ThemeData(
        primarySwatch: Colors.blue,
        useMaterial3: true,
      ),
      debugShowCheckedModeBanner: false,
      home: MCPClientPage(prefs: prefs),
    );
  }
}

class MCPClientPage extends StatefulWidget {
  final SharedPreferences prefs;

  const MCPClientPage({super.key, required this.prefs});

  @override
  State<MCPClientPage> createState() => _MCPClientPageState();
}

class _MCPClientPageState extends State<MCPClientPage> {
  final _serverUrlController =
      TextEditingController(text: 'ws://localhost:3000');
  final _toolNameController = TextEditingController();
  final _paramsController = TextEditingController();
  final _outputController = TextEditingController();
  final _outputScrollController = ScrollController();
  final List<Map<String, dynamic>> _generatedBridgeIds = [];
  Timer? _updateTimer;

  late WebSocketService _wsService;
  late ScriptService _scriptService;
  List<String> _savedScripts = [];
  Map<String, Map<String, String>> _savedEnvironments = {};
  String? _selectedScript;
  String? _selectedEnvironment;
  String? _currentConnectionId;
  Map<String, dynamic> _connectionInfo = {};
  List<Map<String, dynamic>> _connections = [];
  List<Map<String, dynamic>> _connectedBridges = [];
  Map<String, String> _bridgeAssignments = {}; // Map of sandboxId -> bridgeId
  bool _isConnected = false;
  String _sandboxFilter = 'running'; // 'all', 'running', 'stopped'
  String? _selectedSandboxId;

  // Liste des méthodes disponibles
  final List<String> _availableMethods = ['tools/list', 'tools/call'];
  String _selectedMethod = 'tools/list'; // Méthode par défaut

  @override
  void initState() {
    super.initState();
    _wsService = WebSocketService(
      onMessage: _handleMessage,
      onError: _handleError,
      onStdout: _handleStdout,
    );
    _scriptService = ScriptService(widget.prefs);
    _loadSavedScripts();
    _loadSavedEnvironments();

    // Setup auto-scrolling behavior for output
    _outputScrollController.addListener(() {
      // This will be called whenever the scroll position changes
      // Could be used to track if user has manually scrolled up
    });

    // Start the update timer
    _updateTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_generatedBridgeIds.isNotEmpty) {
        setState(() {
          // This will trigger a rebuild of the list
        });
      }
    });
  }

  Future<void> _loadSavedScripts() async {
    final scripts = await _scriptService.getSavedScripts();
    setState(() {
      _savedScripts = scripts;
    });
  }

  Future<void> _loadSavedEnvironments() async {
    final environments = await _scriptService.getSavedEnvironments();
    setState(() {
      _savedEnvironments = environments;
    });
  }

  // Function to append text to the output with line limiting
  void _appendToOutput(String newText) {
    // Add the new text
    String currentText = _outputController.text;
    String updatedText =
        currentText.isEmpty ? newText : '$currentText\n$newText';

    // Count lines and limit to 200 if needed
    List<String> lines = updatedText.split('\n');
    if (lines.length > 200) {
      // Keep only the last 200 lines
      lines = lines.sublist(lines.length - 200);
      updatedText = lines.join('\n');
    }

    // Update the controller
    setState(() {
      _outputController.text = updatedText;
      _outputController.selection = TextSelection.fromPosition(
        TextPosition(offset: _outputController.text.length),
      );
    });

    // Force scroll to bottom after the frame is rendered
    WidgetsBinding.instance.addPostFrameCallback((_) {
      try {
        // Check that the controller is still attached to a scroll view
        if (_outputScrollController.hasClients) {
          // Jump to the end immediately
          _outputScrollController
              .jumpTo(_outputScrollController.position.maxScrollExtent);
        }
      } catch (e) {
        print('Scroll error: $e');
      }
    });
  }

  void _handleMessage(String message) {
    try {
      final data = jsonDecode(message);
      final type = data['type'];
      final connectionId = data['connectionId'];

      switch (type) {
        case 'bridge_id_generated':
          print('Bridge ID generated: ${data['bridgeId']}');
          setState(() {
            _generatedBridgeIds.add({
              'id': data['bridgeId'],
              'generatedAt': DateTime.now().millisecondsSinceEpoch,
              'expiresAt': data['expiresAt'],
            });
          });
          break;

        case 'bridge_registered':
          print('Bridge registered: ${data['bridgeId']}');
          break;

        case 'bridge_status_update':
          print('Bridge status update received');
          if (data['bridges'] != null) {
            setState(() {
              _connectedBridges =
                  List<Map<String, dynamic>>.from(data['bridges']);
            });
          }
          break;

        case 'bridge_assignments_update':
          print('Bridge assignments update received');
          if (data['assignments'] != null) {
            setState(() {
              _bridgeAssignments =
                  Map<String, String>.from(data['assignments']);
            });
          }
          break;
      }

      if (connectionId != null) {
        final connection = _wsService.getConnection(connectionId);
        if (connection != null) {
          print('Mise à jour de la connexion $connectionId');
          setState(() {
            _connectionInfo[connectionId] = {
              'url': connection.url,
              'status': connection.isConnected ? 'connected' : 'disconnected',
              'sandboxes': connection.sandboxes.map((s) => s.toJson()).toList(),
            };
          });

          switch (type) {
            case 'disconnected':
              if (_currentConnectionId == connectionId) {
                _currentConnectionId = null;
                _isConnected = false;
              }
              break;
            case 'sandbox_updated':
              print('Rafraîchissement des sandboxes demandé');
              final sandboxData = data['sandbox'];
              if (sandboxData != null) {
                final sandbox = Sandbox(
                  id: sandboxData['id'],
                  scriptPath: sandboxData['scriptPath'],
                  env: Map<String, String>.from(sandboxData['env'] ?? {}),
                  isRunning: sandboxData['isRunning'] ?? false,
                );
                connection.sandboxes.removeWhere((s) => s.id == sandbox.id);
                connection.sandboxes.add(sandbox);
              }
              setState(() {
                if (_connectionInfo.containsKey(connectionId)) {
                  _connectionInfo[connectionId] = {
                    'url': connection.url,
                    'status':
                        connection.isConnected ? 'connected' : 'disconnected',
                    'sandboxes':
                        connection.sandboxes.map((s) => s.toJson()).toList(),
                  };
                }
              });
              break;
            case 'sandbox_status':
              final sandboxId = data['sandboxId'];
              final status = data['status'];
              print('Status sandbox $sandboxId: $status');
              break;
            case 'stdout':
            case 'stderr':
              final sandboxId = data['sandboxId'];
              final message = data['message'];
              final isJson = data['isJson'] ?? false;

              String formattedMessage;
              if (isJson) {
                try {
                  final jsonData = jsonDecode(message);
                  formattedMessage =
                      const JsonEncoder.withIndent('  ').convert(jsonData);
                } catch (e) {
                  formattedMessage = message;
                }
              } else {
                formattedMessage = message;
              }

              // Set the controller text and force a rebuild
              _appendToOutput(type.toUpperCase() + ': ' + formattedMessage);
              break;
            case 'sandbox_response_updated':
              final sandboxId = data['sandboxId'];
              if (sandboxId == _selectedSandboxId) {
                _updateOutputFromSandbox(sandboxId);
              }
              break;
          }
        }
      }
    } catch (e) {
      print('Error handling message: $e');
    }
  }

  void _handleError(String error) {
    print('WebSocket error: $error');
    setState(() {
      _isConnected = false;
    });
  }

  Future<void> _connect() async {
    final url = _serverUrlController.text;
    if (url.isNotEmpty) {
      final connectionId = await _wsService.addConnection(url);
      if (connectionId != null) {
        setState(() {
          _currentConnectionId = connectionId;
          _isConnected = true;
          _connectionInfo[connectionId] = {
            'sandboxes': [],
            'status': 'connected',
          };
        });
      }
    }
  }

  Future<void> _disconnect() async {
    if (_currentConnectionId != null) {
      _wsService.removeConnection(_currentConnectionId!);
      setState(() {
        _isConnected = false;
        _currentConnectionId = null;
      });
    }
  }

  void _startSandbox() {
    if (_selectedScript == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a script')),
      );
      return;
    }

    final env = _selectedEnvironment != null
        ? Map<String, String>.from(
            _savedEnvironments[_selectedEnvironment!] ?? {})
        : <String, String>{};

    // Get the connection
    final connection = _wsService.getConnection(_currentConnectionId!);
    if (connection == null) {
      _appendToOutput('❌ No active connection to start sandbox');
      return;
    }

    // Only add targetFlutterBridgeId if a bridge is selected
    final selectedBridgeId = _getSelectedBridgeId();

    // Call startSandbox with the correct parameters (scriptPath, env, targetFlutterBridgeId)
    connection.startSandbox(
      _selectedScript!,
      env,
      targetFlutterBridgeId: selectedBridgeId,
    );

    _appendToOutput('▶️ Starting sandbox with script: $_selectedScript');
  }

  // Helper to get the currently selected bridge ID (if any)
  String? _getSelectedBridgeId() {
    // Return the currently selected bridge ID (if implemented with a dropdown)
    // For now, we'll just return null to let the server auto-assign
    return null;
  }

  void _stopSandbox(String sandboxId) {
    if (_currentConnectionId != null) {
      final connection = _wsService.getConnection(_currentConnectionId!);
      if (connection != null) {
        connection.stopSandbox(sandboxId);
        setState(() {
          _connectionInfo[_currentConnectionId!] = {
            'url': connection.url,
            'status': connection.isConnected ? 'connected' : 'disconnected',
            'sandboxes': connection.sandboxes.map((s) => s.toJson()).toList(),
          };
        });
      }
    }
  }

  void _sendCommand() {
    if (_currentConnectionId != null && _selectedSandboxId != null) {
      final connection = _wsService.getConnection(_currentConnectionId!);
      if (connection != null) {
        try {
          final method = _selectedMethod;
          final toolName = _toolNameController.text.trim();
          final paramsText = _paramsController.text.trim();

          // Prépare les paramètres selon la méthode
          Map<String, dynamic> params;
          if (method == 'tools/call') {
            if (toolName.isEmpty) {
              throw Exception('Tool name is required for tools/call');
            }

            // Parse les arguments JSON si non vide
            Map<String, dynamic> arguments;
            try {
              arguments = paramsText.isNotEmpty
                  ? Map<String, dynamic>.from(jsonDecode(paramsText))
                  : {};
            } catch (e) {
              throw Exception('Invalid JSON arguments format: ${e.toString()}');
            }

            // Format spécial pour tools/call
            params = {'name': toolName, 'arguments': arguments};
          } else {
            // Pour les autres méthodes, parse les paramètres JSON
            try {
              params = paramsText.isNotEmpty
                  ? Map<String, dynamic>.from(jsonDecode(paramsText))
                  : {};
            } catch (e) {
              throw Exception(
                  'Invalid JSON parameters format: ${e.toString()}');
            }
          }

          // Envoyer la commande
          connection.sendCommand(
              _selectedSandboxId!, method, jsonEncode(params));

          // Clear params field but keep tool name for reuse
          _paramsController.clear();

          setState(() {
            final paramsStr = method == 'tools/call'
                ? 'name: $toolName, arguments: ${jsonEncode(params['arguments'])}'
                : jsonEncode(params);
            _appendToOutput('Sending method: $method with params: $paramsStr');
          });
        } catch (e) {
          setState(() {
            _appendToOutput('Error: ${e.toString()}');
          });
        }
      }
    }
  }

  Future<void> _saveCurrentScript() async {
    if (_selectedScript != null) {
      await _scriptService.saveScript(_selectedScript!);
      await _loadSavedScripts();
    }
  }

  Future<void> _removeScript(String scriptPath) async {
    await _scriptService.removeScript(scriptPath);
    await _loadSavedScripts();
    if (_selectedScript == scriptPath) {
      setState(() {
        _selectedScript = null;
      });
    }
  }

  // Add new method to update output based on sandbox response
  void _updateOutputFromSandbox(String sandboxId) {
    if (_currentConnectionId != null) {
      final connection = _wsService.getConnection(_currentConnectionId!);
      if (connection != null) {
        final sandbox = connection.sandboxes.firstWhere(
          (s) => s.id == sandboxId,
          orElse: () => Sandbox(
            id: sandboxId,
            scriptPath: '',
            env: {},
            isRunning: false,
          ),
        );
        if (sandbox.lastResponse != null) {
          setState(() {
            final formattedJson = const JsonEncoder.withIndent('  ')
                .convert(sandbox.lastResponse);
            _appendToOutput(
                'Last Response from Sandbox $sandboxId:\n$formattedJson');
          });
        }
      }
    }
  }

  // Modify the sandbox selection handler
  void _selectSandbox(String sandboxId) {
    setState(() {
      _selectedSandboxId = sandboxId;
      _updateOutputFromSandbox(sandboxId);
    });
  }

  Future<void> _generateBridgeId() async {
    if (_currentConnectionId != null) {
      final connection = _wsService.getConnection(_currentConnectionId!);
      if (connection != null) {
        try {
          final result = await connection.generateBridgeId();
          final bridgeId = result['bridgeId'];
          final expiresAt = result['expiresAt'];

          setState(() {
            _generatedBridgeIds.add({
              'id': bridgeId,
              'generatedAt': DateTime.now().millisecondsSinceEpoch,
              'expiresAt': expiresAt,
            });
          });

          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Bridge ID generated: $bridgeId')),
          );
        } catch (e) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Failed to generate bridge ID: $e')),
          );
        }
      }
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Not connected to server')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('MCP Client'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () async {
              await _loadSavedScripts();
              await _loadSavedEnvironments();
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Scripts et environnements rafraîchis'),
                  duration: Duration(seconds: 2),
                ),
              );
            },
            tooltip: 'Rafraîchir les scripts et environnements',
          ),
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: _showSettingsDialog,
            tooltip: 'Gérer les scripts et environnements',
          ),
        ],
      ),
      body: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Server connection
              Padding(
                padding: const EdgeInsets.all(8.0),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _serverUrlController,
                        decoration: const InputDecoration(
                          labelText: 'Server URL',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: _isConnected ? _disconnect : _connect,
                      child: Text(_isConnected ? 'Disconnect' : 'Connect'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Sessions list
              _buildSessionsList(),
              const SizedBox(height: 16),

              // Sandbox controls
              _buildSandboxControls(),
              const SizedBox(height: 16),

              // Command input
              Row(
                children: [
                  Expanded(
                    flex: 2,
                    child: DropdownButtonFormField<String>(
                      value: _selectedMethod,
                      decoration: const InputDecoration(
                        labelText: 'Method',
                        border: OutlineInputBorder(),
                      ),
                      items: _availableMethods.map((method) {
                        return DropdownMenuItem(
                          value: method,
                          child: Text(method),
                        );
                      }).toList(),
                      onChanged: (value) {
                        if (value != null) {
                          setState(() {
                            _selectedMethod = value;
                            // Clear params when changing method
                            _paramsController.clear();
                          });
                        }
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (_selectedMethod == 'tools/call') ...[
                    Expanded(
                      flex: 2,
                      child: TextField(
                        controller: _toolNameController,
                        decoration: const InputDecoration(
                          labelText: 'Tool Name',
                          border: OutlineInputBorder(),
                          hintText: 'execute_jql',
                        ),
                        enabled: _currentConnectionId != null &&
                            _selectedSandboxId != null,
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    flex: 3,
                    child: TextField(
                      controller: _paramsController,
                      decoration: InputDecoration(
                        labelText: _selectedMethod == 'tools/call'
                            ? 'Tool Arguments (JSON)'
                            : 'Parameters (JSON)',
                        border: const OutlineInputBorder(),
                        hintText: _selectedMethod == 'tools/call'
                            ? '{"jql": "project = GENIA"}'
                            : '{}',
                      ),
                      enabled: _currentConnectionId != null &&
                          _selectedSandboxId != null,
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: _currentConnectionId != null &&
                            _selectedSandboxId != null
                        ? () => _sendCommand()
                        : null,
                    child: const Text('Send'),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Output
              Container(
                height: 300,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Column(
                  children: [
                    Expanded(
                      child: SingleChildScrollView(
                        controller: _outputScrollController,
                        physics: const AlwaysScrollableScrollPhysics(),
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: 8.0),
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
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.arrow_downward),
                          tooltip: 'Scroll to bottom',
                          onPressed: () {
                            if (_outputScrollController.hasClients) {
                              _outputScrollController.jumpTo(
                                  _outputScrollController
                                      .position.maxScrollExtent);
                            }
                          },
                        ),
                        TextButton(
                          onPressed: () {
                            setState(() {
                              _outputController.clear();
                              // Reset scroll position on clear
                              WidgetsBinding.instance.addPostFrameCallback((_) {
                                if (_outputScrollController.hasClients) {
                                  _outputScrollController.jumpTo(0);
                                }
                              });
                            });
                          },
                          child: const Text('Clear'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // Bridge ID controls
              if (_isConnected)
                Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ElevatedButton(
                        onPressed: _generateBridgeId,
                        child: const Text('Generate Bridge ID'),
                      ),
                      if (_generatedBridgeIds.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        const Text('Generated Bridge IDs:'),
                        Container(
                          height: 100,
                          decoration: BoxDecoration(
                            border: Border.all(color: Colors.grey),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: ListView.builder(
                            itemCount: _generatedBridgeIds.length,
                            itemBuilder: (context, index) {
                              final bridgeId = _generatedBridgeIds[index];
                              final id = bridgeId['id'];
                              final expiresAt =
                                  DateTime.fromMillisecondsSinceEpoch(
                                      bridgeId['expiresAt']);
                              final now = DateTime.now();

                              // Check if this bridge is connected
                              final connection = _wsService
                                  .getConnection(_currentConnectionId!);
                              final connectedBridge =
                                  connection?.connectedBridges.firstWhere(
                                (b) => b['bridgeId'] == id,
                                orElse: () => <String, dynamic>{},
                              );
                              final isConnected =
                                  connectedBridge?.isNotEmpty ?? false;

                              // Check if this bridge ID is valid (no expiration)
                              final isValidated =
                                  connection?.validBridgeIds.contains(id) ??
                                      false;

                              // Only check expiration if not validated
                              final isExpired =
                                  !isValidated && now.isAfter(expiresAt);

                              return ListTile(
                                leading: Icon(
                                  isConnected ? Icons.link : Icons.link_off,
                                  color:
                                      isConnected ? Colors.green : Colors.grey,
                                  size: 20,
                                ),
                                title: Text('ID: $id'),
                                subtitle: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    if (isValidated)
                                      const Text(
                                        'Active - No Expiration',
                                        style: TextStyle(
                                          color: Colors.green,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      )
                                    else
                                      Text(isExpired
                                          ? 'Expired'
                                          : 'Expires at ${expiresAt.hour.toString().padLeft(2, '0')}:${expiresAt.minute.toString().padLeft(2, '0')}:${expiresAt.second.toString().padLeft(2, '0')}'),
                                    if (!isExpired && !isValidated)
                                      Text(
                                        'Remaining: ${_formatDuration(expiresAt.difference(now))}',
                                        style: TextStyle(
                                          color: Colors.grey[600],
                                          fontSize: 12,
                                        ),
                                      ),
                                    if (isConnected) ...[
                                      const SizedBox(height: 4),
                                      Text(
                                        'Platform: ${connectedBridge!['platform']}',
                                        style: const TextStyle(
                                          color: Colors.green,
                                          fontSize: 12,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      Text(
                                        'Connected since: ${DateTime.fromMillisecondsSinceEpoch(connectedBridge['connectedAt']).hour.toString().padLeft(2, '0')}:${DateTime.fromMillisecondsSinceEpoch(connectedBridge['connectedAt']).minute.toString().padLeft(2, '0')}:${DateTime.fromMillisecondsSinceEpoch(connectedBridge['connectedAt']).second.toString().padLeft(2, '0')}',
                                        style: TextStyle(
                                          color: Colors.grey[600],
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                                tileColor: isExpired ? Colors.grey[200] : null,
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    if (!isExpired || isValidated)
                                      IconButton(
                                        icon: const Icon(Icons.copy),
                                        onPressed: () {
                                          Clipboard.setData(
                                                  ClipboardData(text: id))
                                              .then((_) {
                                            ScaffoldMessenger.of(context)
                                                .showSnackBar(
                                              const SnackBar(
                                                content: Text(
                                                    'Bridge ID copied to clipboard'),
                                                duration: Duration(seconds: 2),
                                              ),
                                            );
                                          });
                                        },
                                        tooltip: 'Copy Bridge ID',
                                        iconSize: 20,
                                      ),
                                    IconButton(
                                      icon: const Icon(Icons.delete),
                                      onPressed: () {
                                        setState(() {
                                          _generatedBridgeIds.removeAt(index);
                                        });
                                      },
                                      tooltip: 'Delete Bridge ID',
                                      iconSize: 20,
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSessionsList() {
    if (_connectionInfo.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16.0),
          child: Text('Aucune session active'),
        ),
      );
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Sessions actives',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Row(
                  children: [
                    const Text('Filtrer les sandboxes: '),
                    const SizedBox(width: 8),
                    DropdownButton<String>(
                      value: _sandboxFilter,
                      items: const [
                        DropdownMenuItem(
                          value: 'all',
                          child: Text('Toutes'),
                        ),
                        DropdownMenuItem(
                          value: 'running',
                          child: Text('En cours'),
                        ),
                        DropdownMenuItem(
                          value: 'stopped',
                          child: Text('Arrêtées'),
                        ),
                      ],
                      onChanged: (value) {
                        if (value != null) {
                          setState(() {
                            _sandboxFilter = value;
                          });
                        }
                      },
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
            ..._connectionInfo.entries.map((entry) {
              final connectionId = entry.key;
              final info = entry.value;
              final isCurrentConnection = connectionId == _currentConnectionId;
              final connection = _wsService.getConnection(connectionId);

              // Filtrer les sandboxes selon le filtre sélectionné
              final filteredSandboxes = connection?.sandboxes.where((sandbox) {
                    switch (_sandboxFilter) {
                      case 'running':
                        return sandbox.isRunning;
                      case 'stopped':
                        return !sandbox.isRunning;
                      default:
                        return true;
                    }
                  }).toList() ??
                  [];

              return Card(
                color:
                    isCurrentConnection ? Colors.blue.withOpacity(0.1) : null,
                child: Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            info['status'] == 'connected'
                                ? Icons.link
                                : Icons.link_off,
                            color: info['status'] == 'connected'
                                ? Colors.green
                                : Colors.red,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Session $connectionId',
                              style:
                                  const TextStyle(fontWeight: FontWeight.bold),
                            ),
                          ),
                          if (!isCurrentConnection)
                            TextButton(
                              onPressed: () {
                                setState(() {
                                  _currentConnectionId = connectionId;
                                });
                              },
                              child: const Text('Sélectionner'),
                            ),
                          if (isCurrentConnection)
                            const Padding(
                              padding: EdgeInsets.only(left: 8.0),
                              child: Chip(
                                label: Text('Active'),
                                backgroundColor: Colors.blue,
                                labelStyle: TextStyle(color: Colors.white),
                              ),
                            ),
                          IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () {
                              _wsService.removeConnection(connectionId);
                              setState(() {
                                _connectionInfo.remove(connectionId);
                                if (_currentConnectionId == connectionId) {
                                  _currentConnectionId = null;
                                  _isConnected = false;
                                }
                              });
                            },
                            tooltip: 'Fermer la connexion',
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text('URL: ${info['url']}'),
                      Text('Status: ${info['status']}'),
                      if (filteredSandboxes.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        const Text('Sandboxes:',
                            style: TextStyle(fontWeight: FontWeight.bold)),
                        ...filteredSandboxes.map((sandbox) {
                          return _buildSandboxCard(sandbox);
                        }).toList(),
                      ],
                    ],
                  ),
                ),
              );
            }).toList(),
          ],
        ),
      ),
    );
  }

  Widget _buildSandboxControls() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _selectedScript,
                    decoration: const InputDecoration(
                      labelText: 'Script',
                      border: OutlineInputBorder(),
                    ),
                    items: _savedScripts.map((script) {
                      return DropdownMenuItem(
                        value: script,
                        child: Text(script),
                      );
                    }).toList(),
                    onChanged: (value) {
                      setState(() {
                        _selectedScript = value;
                      });
                    },
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _selectedEnvironment,
                    decoration: const InputDecoration(
                      labelText: 'Environnement',
                      border: OutlineInputBorder(),
                    ),
                    items: [
                      const DropdownMenuItem(
                        value: null,
                        child: Text('Aucun environnement'),
                      ),
                      ..._savedEnvironments.keys.map((name) {
                        return DropdownMenuItem(
                          value: name,
                          child: Text(name),
                        );
                      }).toList(),
                    ],
                    onChanged: (value) {
                      setState(() {
                        _selectedEnvironment = value;
                      });
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _currentConnectionId != null && _selectedScript != null
                  ? () {
                      final connection =
                          _wsService.getConnection(_currentConnectionId!);
                      if (connection != null) {
                        final Map<String, String> env =
                            _selectedEnvironment != null
                                ? Map<String, String>.from(
                                    _savedEnvironments[_selectedEnvironment]!)
                                : <String, String>{};
                        connection.startSandbox(_selectedScript!, env);
                      }
                    }
                  : null,
              child: const Text('Lancer la sandbox'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    _toolNameController.dispose();
    _paramsController.dispose();
    _outputController.dispose();
    _outputScrollController.dispose();
    _updateTimer?.cancel();
    if (_currentConnectionId != null) {
      _wsService.removeConnection(_currentConnectionId!);
    }
    super.dispose();
  }

  Future<void> _showSettingsDialog() async {
    await showDialog(
      context: context,
      builder: (context) => AddScriptDialog(
        savedScripts: _savedScripts,
        savedEnvironments: _savedEnvironments,
        onSave: (scriptPath) async {
          await _scriptService.saveScript(scriptPath);
          await _loadSavedScripts();
        },
        onRemove: (scriptPath) async {
          await _removeScript(scriptPath);
          await _loadSavedScripts();
        },
        onSaveEnvironment: (name, env) async {
          await _scriptService.saveEnvironment(name, env);
          await _loadSavedEnvironments();
        },
        onRemoveEnvironment: (name) async {
          await _scriptService.removeEnvironment(name);
          await _loadSavedEnvironments();
        },
      ),
    );
  }

  _handleStdout(String p1) {
    // Handle stdout messages here
    print('STDOUT: $p1');
    _appendToOutput('STDOUT: $p1');
  }

  String _formatDuration(Duration duration) {
    if (duration.isNegative) return 'Expired';

    final minutes = duration.inMinutes;
    final seconds = duration.inSeconds % 60;

    if (minutes > 0) {
      return '${minutes}m ${seconds}s';
    } else {
      return '${seconds}s';
    }
  }

  // Add this helper to get bridge name for a sandbox
  String _getBridgeNameForSandbox(String sandboxId) {
    final bridgeId = _bridgeAssignments[sandboxId];
    if (bridgeId == null) {
      return 'Not assigned';
    }

    // Look up the bridge details
    final bridge = _connectedBridges.firstWhere(
        (b) => b['bridgeId'] == bridgeId,
        orElse: () => {'bridgeId': bridgeId, 'platform': 'unknown'});

    return '${bridge['platform']} (${bridge['bridgeId']})';
  }

  // Modify the sandbox display to show bridge assignments
  Widget _buildSandboxCard(Sandbox sandbox) {
    final sandboxId = sandbox.id;
    final isRunning = sandbox.isRunning;
    final scriptPath = sandbox.scriptPath;
    final bridgeInfo = _getBridgeNameForSandbox(sandboxId);

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Sandbox: $sandboxId',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color:
                        isRunning ? Colors.green.shade100 : Colors.red.shade100,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    isRunning ? 'Running' : 'Stopped',
                    style: TextStyle(
                      color: isRunning
                          ? Colors.green.shade800
                          : Colors.red.shade800,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text('Script: $scriptPath'),
            const SizedBox(height: 4),
            Row(
              children: [
                const Icon(Icons.link, size: 16),
                const SizedBox(width: 4),
                Text('Bridge: $bridgeInfo'),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                if (isRunning)
                  ElevatedButton.icon(
                    icon: const Icon(Icons.stop, size: 16),
                    label: const Text('Stop'),
                    onPressed: () => _stopSandbox(sandboxId),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.red,
                      foregroundColor: Colors.white,
                    ),
                  ),
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  icon: const Icon(Icons.terminal, size: 16),
                  label: const Text('Send Command'),
                  onPressed: () => _selectSandbox(sandboxId),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue,
                    foregroundColor: Colors.white,
                  ),
                ),
              ],
            )
          ],
        ),
      ),
    );
  }
}

class AddScriptDialog extends StatefulWidget {
  final List<String> savedScripts;
  final Map<String, Map<String, String>> savedEnvironments;
  final Function(String) onSave;
  final Function(String) onRemove;
  final Function(String, Map<String, String>) onSaveEnvironment;
  final Function(String) onRemoveEnvironment;

  const AddScriptDialog({
    super.key,
    required this.savedScripts,
    required this.savedEnvironments,
    required this.onSave,
    required this.onRemove,
    required this.onSaveEnvironment,
    required this.onRemoveEnvironment,
  });

  @override
  State<AddScriptDialog> createState() => _AddScriptDialogState();
}

class _AddScriptDialogState extends State<AddScriptDialog>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final _scriptPathController = TextEditingController();
  final _envNameController = TextEditingController();
  final _envKeyController = TextEditingController();
  final _envValueController = TextEditingController();
  final _envJsonController = TextEditingController();
  String? _selectedScript;
  String? _selectedEnvironment;
  Map<String, String> _currentEnv = {};
  String? _jsonError;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _scriptPathController.dispose();
    _envNameController.dispose();
    _envKeyController.dispose();
    _envValueController.dispose();
    _envJsonController.dispose();
    super.dispose();
  }

  void _addEnvVar() {
    if (_envKeyController.text.isNotEmpty &&
        _envValueController.text.isNotEmpty) {
      setState(() {
        _currentEnv[_envKeyController.text] = _envValueController.text;
        _envKeyController.clear();
        _envValueController.clear();
      });
    }
  }

  void _removeEnvVar(String key) {
    setState(() {
      _currentEnv.remove(key);
    });
  }

  void _selectEnvironment(String? name) {
    setState(() {
      _selectedEnvironment = name;
      if (name != null) {
        _currentEnv =
            Map<String, String>.from(widget.savedEnvironments[name] ?? {});
      } else {
        _currentEnv = {};
      }
    });
  }

  void _importEnvFromJson() {
    setState(() {
      _jsonError = null;
      try {
        final jsonStr = _envJsonController.text.trim();
        if (jsonStr.isEmpty) return;

        final Map<String, dynamic> jsonData = jsonDecode(jsonStr);
        final newEnvVars = <String, String>{};

        jsonData.forEach((key, value) {
          if (value is String) {
            newEnvVars[key] = value;
          } else {
            newEnvVars[key] = value.toString();
          }
        });

        _currentEnv.addAll(newEnvVars);
        _envJsonController.clear();
      } catch (e) {
        _jsonError = 'Format JSON invalide: ${e.toString()}';
      }
    });
  }

  String _exportEnvToJson() {
    return jsonEncode(_currentEnv);
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: SizedBox(
        width: 600,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TabBar(
              controller: _tabController,
              tabs: const [
                Tab(text: 'Scripts'),
                Tab(text: 'Environnements'),
              ],
            ),
            SizedBox(
              height: 400,
              child: TabBarView(
                controller: _tabController,
                children: [
                  // Scripts tab
                  SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Gérer les scripts',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 16),
                        DropdownButtonFormField<String>(
                          value: _selectedScript,
                          decoration: const InputDecoration(
                            labelText: 'Scripts sauvegardés',
                            border: OutlineInputBorder(),
                          ),
                          items: widget.savedScripts.map((script) {
                            return DropdownMenuItem(
                              value: script,
                              child: Text(script),
                            );
                          }).toList(),
                          onChanged: (value) {
                            setState(() {
                              _selectedScript = value;
                              _scriptPathController.text = value ?? '';
                            });
                          },
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _scriptPathController,
                                decoration: const InputDecoration(
                                  labelText: 'Chemin du script',
                                  border: OutlineInputBorder(),
                                ),
                                onChanged: (value) {
                                  setState(() {
                                    if (value.isEmpty) {
                                      _selectedScript = null;
                                    }
                                  });
                                },
                              ),
                            ),
                            const SizedBox(width: 16),
                            IconButton(
                              onPressed: _selectedScript != null
                                  ? () {
                                      widget.onRemove(_selectedScript!);
                                      setState(() {
                                        _selectedScript = null;
                                        _scriptPathController.clear();
                                      });
                                    }
                                  : null,
                              icon: const Icon(Icons.delete),
                              tooltip: 'Supprimer le script sélectionné',
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            TextButton(
                              onPressed: () => Navigator.of(context).pop(),
                              child: const Text('Fermer'),
                            ),
                            const SizedBox(width: 8),
                            ElevatedButton(
                              onPressed: _scriptPathController.text.isNotEmpty
                                  ? () {
                                      widget.onSave(_scriptPathController.text);
                                      Navigator.of(context).pop();
                                    }
                                  : null,
                              child: const Text('Sauvegarder'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  // Environments tab
                  SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Gérer les environnements',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 16),
                        DropdownButtonFormField<String>(
                          value: _selectedEnvironment,
                          decoration: const InputDecoration(
                            labelText: 'Environnements sauvegardés',
                            border: OutlineInputBorder(),
                          ),
                          items: [
                            const DropdownMenuItem(
                              value: null,
                              child: Text('Nouvel environnement'),
                            ),
                            ...widget.savedEnvironments.keys.map((name) {
                              return DropdownMenuItem(
                                value: name,
                                child: Text(name),
                              );
                            }).toList(),
                          ],
                          onChanged: _selectEnvironment,
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _envNameController,
                                decoration: const InputDecoration(
                                  labelText: 'Nom de l\'environnement',
                                  border: OutlineInputBorder(),
                                ),
                              ),
                            ),
                            const SizedBox(width: 16),
                            IconButton(
                              onPressed: _selectedEnvironment != null
                                  ? () {
                                      widget.onRemoveEnvironment(
                                          _selectedEnvironment!);
                                      setState(() {
                                        _selectedEnvironment = null;
                                        _envNameController.clear();
                                        _currentEnv = {};
                                      });
                                    }
                                  : null,
                              icon: const Icon(Icons.delete),
                              tooltip: 'Supprimer l\'environnement sélectionné',
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(8.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Import/Export JSON',
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                TextField(
                                  controller: _envJsonController,
                                  maxLines: 3,
                                  decoration: InputDecoration(
                                    hintText: 'Collez votre JSON ici...',
                                    border: const OutlineInputBorder(),
                                    errorText: _jsonError,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.end,
                                  children: [
                                    TextButton(
                                      onPressed: () {
                                        setState(() {
                                          _envJsonController.text =
                                              _exportEnvToJson();
                                        });
                                      },
                                      child: const Text('Exporter'),
                                    ),
                                    const SizedBox(width: 8),
                                    TextButton(
                                      onPressed: () {
                                        setState(() {
                                          _envJsonController.clear();
                                          _jsonError = null;
                                        });
                                      },
                                      child: const Text('Effacer'),
                                    ),
                                    const SizedBox(width: 8),
                                    ElevatedButton(
                                      onPressed: _importEnvFromJson,
                                      child: const Text('Importer'),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _envKeyController,
                                decoration: const InputDecoration(
                                  labelText: 'Variable',
                                  border: OutlineInputBorder(),
                                ),
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: TextField(
                                controller: _envValueController,
                                decoration: const InputDecoration(
                                  labelText: 'Valeur',
                                  border: OutlineInputBorder(),
                                ),
                              ),
                            ),
                            const SizedBox(width: 16),
                            IconButton(
                              onPressed: _addEnvVar,
                              icon: const Icon(Icons.add),
                              tooltip: 'Ajouter la variable',
                            ),
                          ],
                        ),
                        if (_currentEnv.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              border: Border.all(color: Colors.grey),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: _currentEnv.entries.map((entry) {
                                return Row(
                                  children: [
                                    Expanded(
                                      child:
                                          Text('${entry.key}: ${entry.value}'),
                                    ),
                                    IconButton(
                                      icon: const Icon(Icons.delete, size: 16),
                                      onPressed: () => _removeEnvVar(entry.key),
                                    ),
                                  ],
                                );
                              }).toList(),
                            ),
                          ),
                        ],
                        const SizedBox(height: 16),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            TextButton(
                              onPressed: () => Navigator.of(context).pop(),
                              child: const Text('Fermer'),
                            ),
                            const SizedBox(width: 8),
                            ElevatedButton(
                              onPressed: _envNameController.text.isNotEmpty &&
                                      _currentEnv.isNotEmpty
                                  ? () {
                                      widget.onSaveEnvironment(
                                          _envNameController.text, _currentEnv);
                                      Navigator.of(context).pop();
                                    }
                                  : null,
                              child: const Text('Sauvegarder'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
