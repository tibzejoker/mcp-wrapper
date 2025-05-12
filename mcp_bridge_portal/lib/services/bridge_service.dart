import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

class BridgeHandler {
  final String id;
  final String type;
  final Function(Map<String, dynamic>) handler;

  BridgeHandler({
    required this.id,
    required this.type,
    required this.handler,
  });
}

class BridgeService {
  final String bridgeId;
  WebSocketChannel? _channel;
  bool _isConnected = false;
  final Map<String, BridgeHandler> _handlers = {};
  String? _currentSandboxId;  // Track current sandbox ID

  // Callbacks
  final Function(String) onConnected;
  final Function(String) onDisconnected;
  final Function(String) onError;

  BridgeService({
    required this.bridgeId,
    required this.onConnected,
    required this.onDisconnected,
    required this.onError,
  });

  bool get isConnected => _isConnected;

  void connect(String serverUrl) { 
    try {
      _channel = WebSocketChannel.connect(Uri.parse(serverUrl));
      _channel!.stream.listen(
        (message) {
          _handleMessage(message);
        },
        onError: (error) {
          print('WebSocket error: $error');
          _isConnected = false;
          onError(error.toString());
        },
        onDone: () { 
          print('WebSocket connection closed');
          _isConnected = false;
          onDisconnected('Connection closed');
        },
      );

      // Send bridge registration message
      _channel!.sink.add(jsonEncode({
        'type': 'bridge_register',
        'bridgeId': bridgeId,
      }));

      _isConnected = true;
      onConnected('Connected to server');
    } catch (e) {
      print('Connection error: $e');
      _isConnected = false;
      onError(e.toString());
    }
  }

  void registerHandler(String type, Function(Map<String, dynamic>) handler) {
    final handlerId = DateTime.now().millisecondsSinceEpoch.toString();
    _handlers[handlerId] = BridgeHandler(
      id: handlerId,
      type: type,
      handler: handler,
    );

    // Notify server about new handler
    if (_isConnected) {
      _channel!.sink.add(jsonEncode({
        'type': 'register_handler',
        'bridgeId': bridgeId,
        'handlerId': handlerId,
        'handlerType': type,
      }));
    }
  }

  void _handleMessage(dynamic message) {
    try {
      final data = jsonDecode(message);
      final type = data['type'];

      switch (type) {
        case 'bridge_request':
          final handlerId = data['handlerId'];
          final handler = _handlers.values.firstWhere(
            (h) => h.type == data['requestType'],
            orElse: () => throw Exception('No handler found for type ${data["requestType"]}'),
          );
          
          try {
            final result = handler.handler(data['params'] ?? {});
            _sendResponse(handlerId, result);
          } catch (e) {
            _sendError(handlerId, e.toString());
          }
          break;

        case 'bridge_registered':
          print('Bridge registered successfully');
          break;

        case 'sandbox_updated':
          if (data['sandbox'] != null) {
            final sandboxData = data['sandbox'];
            if (sandboxData['isRunning'] == true) {
              _currentSandboxId = sandboxData['id'];
              print('Updated current sandbox ID to: $_currentSandboxId');
            } else {
              _currentSandboxId = null;
              print('Sandbox stopped, cleared sandbox ID');
            }
          }
          break;

        case 'stdout':
        case 'stderr':
          final message = data['message'];
          if (message != null) {
            try {
              // Try to parse as JSON
              final jsonData = jsonDecode(message);
              if (jsonData['error'] != null) {
                onError(jsonData['error']['message'] ?? 'Unknown error');
              }
            } catch (e) {
              // Not JSON, just log the message
              print('${type.toUpperCase()}: $message');
            }
          }
          break;

        case 'error':
          print('Error from server: ${data['error']}');
          if (data['details'] != null) {
            print('Error details: ${data['details']}');
          }
          onError(data['error']);
          break;

        default:
          print('Unknown message type: $type');
      }
    } catch (e) {
      print('Error handling message: $e');
      onError(e.toString());
    }
  }

  void _sendResponse(String handlerId, dynamic result) {
    if (_isConnected) {
      _channel!.sink.add(jsonEncode({
        'type': 'bridge_response',
        'bridgeId': bridgeId,
        'handlerId': handlerId,
        'result': result,
      }));
    }
  }

  void _sendError(String handlerId, String error) {
    if (_isConnected) {
      _channel!.sink.add(jsonEncode({
        'type': 'bridge_error',
        'bridgeId': bridgeId,
        'handlerId': handlerId,
        'error': error,
      }));
    }
  }

  void sendToolCommand(String toolName, Map<String, dynamic> arguments) {
    if (_isConnected) {
      _channel!.sink.add(jsonEncode({
        'type': 'tools/call',
        'name': toolName,
        'arguments': arguments
      }));
    }
  }

  void sendCommand(String commandType, [Map<String, dynamic>? params]) {
    if (!_isConnected) {
      onError('Not connected to server');
      return;
    }

    if (_currentSandboxId == null) {
      onError('No active sandbox available');
      return;
    }

    final message = {
      'type': 'command',
      'sandboxId': _currentSandboxId,
      'command': jsonEncode({
        'jsonrpc': '2.0',
        'method': 'tools/call',
        'params': {
          'name': commandType,
          'arguments': params ?? {}
        },
        'id': DateTime.now().millisecondsSinceEpoch.toString()
      })
    };

    print('Sending command message: ${jsonEncode(message)}');
    _channel!.sink.add(jsonEncode(message));
  }

  void sendCommandFromText(String commandText, String paramsText) {
    try {
      // Parse les paramètres JSON si non vide
      final params = paramsText.isNotEmpty ? jsonDecode(paramsText) : null;
      sendCommand(commandText, params);
    } catch (e) {
      print('Error parsing command: $e');
      onError('Invalid command format: $e');
    }
  }

  void sendToolCommandFromText(String toolName, String paramsText) {
    try {
      // Parse les paramètres JSON si non vide
      final arguments = paramsText.isNotEmpty ? jsonDecode(paramsText) : {};
      
      // Envoie la commande au format tools/call
      sendToolCommand(toolName, arguments);
    } catch (e) {
      print('Error parsing parameters: $e');
      onError('Invalid parameters format: $e');
    }
  }

  void disconnect() {
    _channel?.sink.close();
    _channel = null;
    _isConnected = false;
  }
} 