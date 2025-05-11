import 'dart:convert';
import 'dart:io';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'dart:async';

class Sandbox {
  final String id;
  final String scriptPath;
  final Map<String, String> env;
  bool isRunning;
  dynamic lastResponse;

  Sandbox({
    required this.id,
    required this.scriptPath,
    required this.env,
    this.isRunning = false,
    this.lastResponse,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'scriptPath': scriptPath,
    'env': env,
    'isRunning': isRunning,
    'lastResponse': lastResponse,
  };
}

class WebSocketConnection {
  final String id;
  final String url;
  WebSocketChannel? channel;
  bool isConnected;
  final List<Sandbox> sandboxes;
  final List<Map<String, dynamic>> connectedBridges = [];
  final Set<String> validBridgeIds = {};
  final Function(String) onMessage;
  final Function(String) onError;
  final Function(String) onStdout;

  WebSocketConnection({
    required this.id,
    required this.url,
    required this.onMessage,
    required this.onError,
    required this.onStdout,
  }) : isConnected = false,
       sandboxes = [];

  void connect() {
    try {
      channel = WebSocketChannel.connect(Uri.parse(url));
      channel!.stream.listen(
        (message) {
          print('Message reçu: $message');
          final data = jsonDecode(message);
          switch(data['type']) {
            case 'bridge_validation_update':
              print('Bridge validation update received');
              final validIds = List<String>.from(data['validBridgeIds']);
              validBridgeIds
                ..clear()
                ..addAll(validIds);
              onMessage(message);
              break;

            case 'bridge_status_update':
              print('Bridge status update received');
              final bridges = List<Map<String, dynamic>>.from(data['bridges']);
              connectedBridges
                ..clear()
                ..addAll(bridges);
              onMessage(message);
              break;

            case 'bridge_id_generated':
              print('Bridge ID generated response received');
              onMessage(message);
              break;

            case 'bridge_registered':
              print('Bridge registration confirmed');
              onMessage(message);
              break;

            case 'sandbox_status':
              final sandboxId = data['sandboxId'];
              final status = data['status'];
              print('Mise à jour du statut de la sandbox $sandboxId: $status');
              final sandbox = sandboxes.firstWhere(
                (s) => s.id == sandboxId,
                orElse: () => throw Exception('Sandbox not found'),
              );
              sandbox.isRunning = status == 'running';
              onMessage(message);
              break;

            case 'stdout':
              final outputMessage = data['message'];
              onStdout(outputMessage);
              break;

            case 'stderr':
              final sandboxId = data['sandboxId'];
              final outputMessage = data['message'];
              final isJson = data['isJson'] ?? false;
              
              // Update the sandbox's last response if it's JSON
              if (isJson) {
                try {
                  final jsonResponse = jsonDecode(outputMessage);
                  final sandbox = sandboxes.firstWhere(
                    (s) => s.id == sandboxId,
                    orElse: () => Sandbox(
                      id: sandboxId,
                      scriptPath: '',
                      env: {},
                      isRunning: false,
                    ),
                  );
                  sandbox.lastResponse = jsonResponse;
                } catch (e) {
                  print('Error parsing JSON response: $e');
                }
              }
              
              // Forward the message to update UI
              onMessage(message);
              break;

            default:
              onMessage(message);
              break;
          }
        },
        onError: (error) {
          print('Erreur WebSocket: $error');
          isConnected = false;
          onError(error.toString());
        },
        onDone: () {
          print('WebSocket fermé');
          isConnected = false;
          onMessage('{"type": "disconnected", "connectionId": "$id"}');
        },
      );
      isConnected = true;

      // Request initial bridge status
      channel!.sink.add(jsonEncode({
        'type': 'get_bridge_status',
      }));
    } catch (e) {
      print('Erreur de connexion: $e');
      isConnected = false;
      onError(e.toString());
    }
  }

  void disconnect() {
    channel?.sink.close();
    channel = null;
    isConnected = false;
  }

  void startSandbox(String scriptPath, Map<String, String> env) {
    if (!isConnected) {
      onError('Not connected to server');
      return;
    }

    final sandboxId = DateTime.now().millisecondsSinceEpoch.toString();
    final sandbox = Sandbox(
      id: sandboxId,
      scriptPath: scriptPath,
      env: env,
      isRunning: true,
      lastResponse: null,
    );
    sandboxes.add(sandbox);

    final message = {
      'type': 'start',
      'sandboxId': sandboxId,
      'config': {
        'scriptPath': scriptPath,
        'env': env,
      }
    };

    channel!.sink.add(jsonEncode(message));
  }

  void stopSandbox(String sandboxId) {
    if (!isConnected) {
      onError('Not connected to server');
      return;
    }

    try {
      final sandbox = sandboxes.firstWhere(
        (s) => s.id == sandboxId,
        orElse: () => throw Exception('Sandbox not found'),
      );

      final message = {
        'type': 'stop',
        'sandboxId': sandboxId,
      };

      channel!.sink.add(jsonEncode(message));
      sandbox.isRunning = false;
    } catch (e) {
      print('Erreur lors de l\'arrêt de la sandbox $sandboxId: $e');
      // Ne rien faire si la sandbox n'existe pas
    }
  }

  void stopAllSandboxes() {
    if (!isConnected) {
      onError('Not connected to server');
      return;
    }

    for (final sandbox in sandboxes) {
      stopSandbox(sandbox.id);
    }
  }

  void sendCommand(String sandboxId, String command) {
    if (!isConnected) {
      onError('Not connected to server');
      return;
    }

    final sandbox = sandboxes.firstWhere(
      (s) => s.id == sandboxId,
      orElse: () => throw Exception('Sandbox not found'),
    );

    final message = {
      'type': 'command',
      'sandboxId': sandboxId,
      'command': command,
    };

    channel!.sink.add(jsonEncode(message));
  }

  Future<Map<String, dynamic>> generateBridgeId() async {
    if (!isConnected) {
      throw Exception('Not connected to server');
    }

    final completer = Completer<Map<String, dynamic>>();
    final requestId = DateTime.now().millisecondsSinceEpoch.toString();

    // Add a one-time message handler for the bridge ID response
    void messageHandler(dynamic message) {
      try {
        final data = jsonDecode(message);
        if (data['type'] == 'bridge_id_generated' && data['requestId'] == requestId) {
          completer.complete({
            'bridgeId': data['bridgeId'],
            'expiresAt': data['expiresAt'],
          });
        }
      } catch (e) {
        completer.completeError('Failed to parse bridge ID response: $e');
      }
    }

    // Send the request
    channel!.sink.add(jsonEncode({
      'type': 'generate_bridge_id',
      'requestId': requestId,
    }));

    // Set a timeout
    Future.delayed(const Duration(seconds: 5), () {
      if (!completer.isCompleted) {
        completer.completeError('Bridge ID generation timeout');
      }
    });

    return completer.future;
  }
}

class WebSocketService {
  final Map<String, WebSocketConnection> _connections = {};
  final Function(String) onMessage;
  final Function(String) onError;
  final Function(String) onStdout;

  WebSocketService({
    required this.onMessage,
    required this.onError,
    required this.onStdout,
  });

  String addConnection(String url) {
    final id = DateTime.now().millisecondsSinceEpoch.toString();
    final connection = WebSocketConnection(
      id: id,
      url: url,
      onMessage: onMessage,
      onError: onError,
      onStdout: onStdout,
    );
    _connections[id] = connection;
    connection.connect();
    return id;
  }

  void removeConnection(String id) {
    _connections[id]?.disconnect();
    _connections.remove(id);
  }

  List<WebSocketConnection> get connections => _connections.values.toList();

  WebSocketConnection? getConnection(String id) => _connections[id];
} 