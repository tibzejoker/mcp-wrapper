import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:convert';
import 'dart:async';
import 'package:shared_preferences/shared_preferences.dart';
import 'services/websocket_service.dart';
import 'services/script_service.dart';

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
  final _serverUrlController = TextEditingController(text: 'ws://localhost:3000');
  final _commandController = TextEditingController();
  final _outputController = TextEditingController();
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
  bool _isConnected = false;
  String _sandboxFilter = 'running'; // 'all', 'running', 'stopped'
  String? _selectedSandboxId;

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
                    'status': connection.isConnected ? 'connected' : 'disconnected',
                    'sandboxes': connection.sandboxes.map((s) => s.toJson()).toList(),
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
                  formattedMessage = const JsonEncoder.withIndent('  ').convert(jsonData);
                } catch (e) {
                  formattedMessage = message;
                }
              } else {
                formattedMessage = message;
              }
              
              // Set the controller text and force a rebuild
              _outputController.text = '${_outputController.text}\n${type.toUpperCase()}: $formattedMessage';
              
              // Force scroll to end and rebuild
              setState(() {
                _outputController.selection = TextSelection.fromPosition(
                  TextPosition(offset: _outputController.text.length),
                );
              });
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
    if (_currentConnectionId != null && _selectedScript != null) {
      final connection = _wsService.getConnection(_currentConnectionId!);
      if (connection != null) {
        final Map<String, String> env = _selectedEnvironment != null
            ? Map<String, String>.from(_savedEnvironments[_selectedEnvironment]!)
            : <String, String>{};
        connection.startSandbox(_selectedScript!, env);
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

  void _sendCommand(String command) {
    if (_currentConnectionId != null && _selectedSandboxId != null) {
      final connection = _wsService.getConnection(_currentConnectionId!);
      if (connection != null) {
        connection.sendCommand(_selectedSandboxId!, command);
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
            final formattedJson = const JsonEncoder.withIndent('  ').convert(sandbox.lastResponse);
            _outputController.text = 'Last Response from Sandbox $sandboxId:\n$formattedJson';
            _outputController.selection = TextSelection.fromPosition(
              TextPosition(offset: _outputController.text.length),
            );
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
              _buildCommandInput(),
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
                        controller: ScrollController(),
                        child: SelectableText(
                          _outputController.text,
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        TextButton(
                          onPressed: () {
                            setState(() {
                              _outputController.clear();
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
              if (_isConnected) Padding(
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
                            final expiresAt = DateTime.fromMillisecondsSinceEpoch(bridgeId['expiresAt']);
                            final now = DateTime.now();
                            
                            // Check if this bridge is connected
                            final connection = _wsService.getConnection(_currentConnectionId!);
                            final connectedBridge = connection?.connectedBridges
                              .firstWhere(
                                (b) => b['bridgeId'] == id,
                                orElse: () => <String, dynamic>{},
                              );
                            final isConnected = connectedBridge?.isNotEmpty ?? false;
                            
                            // Check if this bridge ID is valid (no expiration)
                            final isValidated = connection?.validBridgeIds.contains(id) ?? false;
                            
                            // Only check expiration if not validated
                            final isExpired = !isValidated && now.isAfter(expiresAt);
                            
                            return ListTile(
                              leading: Icon(
                                isConnected ? Icons.link : Icons.link_off,
                                color: isConnected ? Colors.green : Colors.grey,
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
                                    Text(
                                      isExpired 
                                        ? 'Expired'
                                        : 'Expires at ${expiresAt.hour.toString().padLeft(2, '0')}:${expiresAt.minute.toString().padLeft(2, '0')}:${expiresAt.second.toString().padLeft(2, '0')}'
                                    ),
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
                                        Clipboard.setData(ClipboardData(text: id)).then((_) {
                                          ScaffoldMessenger.of(context).showSnackBar(
                                            const SnackBar(
                                              content: Text('Bridge ID copied to clipboard'),
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
              }).toList() ?? [];

              return Card(
                color: isCurrentConnection ? Colors.blue.withOpacity(0.1) : null,
                child: Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            info['status'] == 'connected' ? Icons.link : Icons.link_off,
                            color: info['status'] == 'connected' ? Colors.green : Colors.red,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Session $connectionId',
                              style: const TextStyle(fontWeight: FontWeight.bold),
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
                        const Text('Sandboxes:', style: TextStyle(fontWeight: FontWeight.bold)),
                        ...filteredSandboxes.map((sandbox) {
                          return Card(
                            margin: const EdgeInsets.only(top: 4),
                            color: _selectedSandboxId == sandbox.id ? Colors.blue.withOpacity(0.1) : null,
                            child: InkWell(
                              onTap: () {
                                _selectSandbox(sandbox.id);
                              },
                              child: Padding(
                                padding: const EdgeInsets.all(8.0),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Icon(
                                          sandbox.isRunning ? Icons.play_circle : Icons.stop_circle,
                                          color: sandbox.isRunning ? Colors.green : Colors.red,
                                          size: 16,
                                        ),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                'Script: ${sandbox.scriptPath}',
                                                style: const TextStyle(fontWeight: FontWeight.bold),
                                              ),
                                              if (sandbox.env.isNotEmpty) ...[
                                                const SizedBox(height: 4),
                                                Text(
                                                  'Variables d\'environnement:',
                                                  style: TextStyle(
                                                    fontSize: 12,
                                                    color: Colors.grey[600],
                                                  ),
                                                ),
                                                ...sandbox.env.entries.map((env) {
                                                  return Padding(
                                                    padding: const EdgeInsets.only(left: 8.0),
                                                    child: Text(
                                                      '${env.key}: ${env.value}',
                                                      style: const TextStyle(fontSize: 12),
                                                    ),
                                                  );
                                                }),
                                              ],
                                            ],
                                          ),
                                        ),
                                        if (_selectedSandboxId == sandbox.id)
                                          const Padding(
                                            padding: EdgeInsets.only(right: 8.0),
                                            child: Icon(Icons.check_circle, color: Colors.blue, size: 16),
                                          ),
                                        if (sandbox.isRunning)
                                          IconButton(
                                            icon: const Icon(Icons.stop, size: 16),
                                            onPressed: () => _stopSandbox(sandbox.id),
                                            tooltip: 'Arrêter la sandbox',
                                          ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
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
                      final connection = _wsService.getConnection(_currentConnectionId!);
                      if (connection != null) {
                        final Map<String, String> env = _selectedEnvironment != null
                            ? Map<String, String>.from(_savedEnvironments[_selectedEnvironment]!)
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
    _updateTimer?.cancel();
    _serverUrlController.dispose();
    _commandController.dispose();
    _outputController.dispose();
    if (_currentConnectionId != null) {
      _wsService.removeConnection(_currentConnectionId!);
    }
    super.dispose();
  }

  Widget _buildCommandInput() {
    final bool canSendCommand = _currentConnectionId != null && 
                              _selectedSandboxId != null && 
                              _wsService.getConnection(_currentConnectionId!)
                                ?.sandboxes.any((s) => s.id == _selectedSandboxId && s.isRunning) == true;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (!canSendCommand)
              const Padding(
                padding: EdgeInsets.only(bottom: 8.0),
                child: Text(
                  'Sélectionnez une sandbox en cours d\'exécution pour envoyer des commandes',
                  style: TextStyle(color: Colors.orange),
                ),
              ),
            TextField(
              controller: _commandController,
              decoration: const InputDecoration(
                labelText: 'Command',
                border: OutlineInputBorder(),
              ),
              onSubmitted: canSendCommand ? (_) => _sendCommand(_commandController.text) : null,
              enabled: canSendCommand,
            ),
            const SizedBox(height: 8),
            ElevatedButton(
              onPressed: canSendCommand ? () => _sendCommand(_commandController.text) : null,
              child: const Text('Send Command'),
            ),
          ],
        ),
      ),
    );
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
    _outputController.text = '${_outputController.text}\nSTDOUT: $p1';
    setState(() {
      _outputController.selection = TextSelection.fromPosition(
        TextPosition(offset: _outputController.text.length),
      );
    });
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

class _AddScriptDialogState extends State<AddScriptDialog> with SingleTickerProviderStateMixin {
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
    if (_envKeyController.text.isNotEmpty && _envValueController.text.isNotEmpty) {
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
        _currentEnv = Map<String, String>.from(widget.savedEnvironments[name] ?? {});
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
                                      widget.onRemoveEnvironment(_selectedEnvironment!);
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
                                          _envJsonController.text = _exportEnvToJson();
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
                                      child: Text('${entry.key}: ${entry.value}'),
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
                              onPressed: _envNameController.text.isNotEmpty && _currentEnv.isNotEmpty
                                  ? () {
                                      widget.onSaveEnvironment(_envNameController.text, _currentEnv);
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