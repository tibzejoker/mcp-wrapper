import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:http/http.dart' as http;
import 'dart:async'; // For Completer and Future
import 'dart:io';

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

// --- Custom Exception Classes ---
class MethodNotFoundException implements Exception {
  final String methodName;
  MethodNotFoundException(this.methodName);
  @override
  String toString() => 'Method not found: $methodName';
}

class NotYetImplementedException implements Exception {
  final String methodName;
  NotYetImplementedException(this.methodName);
  @override
  String toString() => 'Method not yet implemented: $methodName';
}

class BridgeOperationException implements Exception {
  final String message;
  final dynamic originalError;
  BridgeOperationException(this.message, {this.originalError});
  @override
  String toString() =>
      'BridgeOperationException: $message (Original: ${originalError?.toString() ?? 'N/A'})';
}

// --- JSON-RPC Helper Model ---
class JsonRpcRequest {
  final String jsonrpc;
  final String method;
  final dynamic params;
  final String? id; // Can be null for notifications

  JsonRpcRequest({
    this.jsonrpc = "2.0",
    required this.method,
    this.params,
    this.id,
  });

  factory JsonRpcRequest.fromJson(Map<String, dynamic> json) {
    if (json['method'] == null) {
      throw ArgumentError('JSON-RPC request must contain a "method" field.');
    }
    return JsonRpcRequest(
      jsonrpc: json['jsonrpc'] ?? "2.0",
      method: json['method'] as String,
      params: json['params'],
      id: json['id']?.toString(),
    );
  }

  Map<String, dynamic> toJson() {
    final Map<String, dynamic> data = {
      'jsonrpc': jsonrpc,
      'method': method,
    };
    if (params != null) {
      data['params'] = params;
    }
    if (id != null) {
      data['id'] = id;
    }
    return data;
  }
}

class BridgeService {
  final String bridgeId;
  WebSocketChannel? _channel;
  bool _isConnected = false;
  final Map<String, BridgeHandler> _handlers = {};
  String? _currentSandboxId; // Track current sandbox ID
  bool _assignmentsReceived = false; // Add this flag to prevent infinite loops

  // Sandbox security settings
  List<String> _allowedFilePaths = [];
  bool _enforceFilePathRestrictions = false;

  // Track connected sandboxes and assignments
  List<Map<String, dynamic>> _connectedSandboxes = [];
  Map<String, String> _bridgeAssignments = {}; // sandboxId -> bridgeId

  // Getters for external access
  List<Map<String, dynamic>> get connectedSandboxes => _connectedSandboxes;
  Map<String, String> get bridgeAssignments => _bridgeAssignments;

  // Callbacks
  final Function(String) onConnected;
  final Function(String) onDisconnected;
  final Function(String) onError;
  final Function(List<Map<String, dynamic>>)?
      onSandboxUpdate; // Added callback for sandbox updates

  late final Map<String,
          Future<dynamic> Function(String? requestId, dynamic params)>
      _methodHandlers;

  final List<String> _implementedMethods = [
    'bridgeFetch',
    'bridgeListMethods',
    'bridgeFsRead',
    'bridgeFsWrite',
  ];

  BridgeService({
    required this.bridgeId,
    required this.onConnected,
    required this.onDisconnected,
    required this.onError,
    this.onSandboxUpdate, // Added optional callback
  }) {
    _methodHandlers = {
      'http_request': _handleHttpRequest,
      'fs_read': _handleFsReadRequest,
      'fs_write': _handleFsWriteRequest,
      'fs_stat': _handleFsStatRequest,
      'fs_list': _handleFsListRequest,
      'fs_mkdir': _handleFsMkdirRequest,
      'fs_unlink': _handleFsUnlinkRequest,
      'fs_rmdir': _handleFsRmdirRequest,
      'bridgeListMethods': _handleListMethodsRequest,
    };
  }

  bool get isConnected => _isConnected;

  void connect(String serverUrl) {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(serverUrl));
      _channel!.stream.listen(
        (message) {
          handleIncomingMessage(message);
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

      // Ensure we're using the clean bridgeId value
      final String actualBridgeId = bridgeId.trim();

      // Send bridge registration message
      _channel!.sink.add(jsonEncode({
        'type': 'bridge_register',
        'origin': 'flutter_bridge_portal',
        'bridgeId': actualBridgeId,
        'platform': Platform.operatingSystem,
        'requestId': DateTime.now().millisecondsSinceEpoch.toString(),
      }));

      _isConnected = true;
      // Don't call onConnected here - wait for the bridge_registered response
      _sendCapabilitiesReport();
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

  void handleIncomingMessage(String messageString) {
    Map<String, dynamic>? routingInfo; // Declare here to be accessible in catch
    try {
      final Map<String, dynamic> decodedMessage = jsonDecode(messageString);

      // Extract routingInfo if present. This comes from main.js for forwarded requests.
      routingInfo = decodedMessage['routingInfo'] as Map<String, dynamic>?;

      // Handle bridge_registered response
      if (decodedMessage['type'] == 'bridge_registered') {
        print(
            'Bridge registration confirmed with ID: ${decodedMessage['bridgeId'] ?? bridgeId}');
        // Call the onConnected callback to update the UI
        onConnected('Successfully registered with main server');
        return;
      }

      // Check for bridge_assignments_update message
      if (decodedMessage['type'] == 'bridge_assignments_update') {
        final Map<String, dynamic> assignments =
            decodedMessage['assignments'] ?? {};
        print(
            'Received bridge assignments update: ${assignments.length} assignments');

        // Store the assignments
        _bridgeAssignments.clear();
        assignments.forEach((sandboxId, assignedBridgeId) {
          _bridgeAssignments[sandboxId] = assignedBridgeId;
        });

        // Check if we have any assignments for our bridge ID
        int assignmentsForThisBridge = 0;
        assignments.forEach((sandboxId, assignedBridgeId) {
          if (assignedBridgeId == bridgeId) {
            assignmentsForThisBridge++;
            print('  - Sandbox $sandboxId is assigned to this bridge');
          }
        });

        // If we have assignments but no sandboxes yet, request sandboxes information
        // But only do this once to avoid infinite loops
        if (assignmentsForThisBridge > 0 && !_assignmentsReceived) {
          print(
              'We have $assignmentsForThisBridge assignments, requesting connected sandboxes');
          _assignmentsReceived = true;
          requestConnectedSandboxes();
        }

        // Notify about updates even if no sandboxes connected yet
        if (onSandboxUpdate != null) {
          // Combine the assignments with existing sandbox info if possible
          final List<Map<String, dynamic>> updatedSandboxes = [];

          // First add known sandboxes
          for (final sandbox in _connectedSandboxes) {
            updatedSandboxes.add(sandbox);
          }

          // Then add any assignments that don't have sandbox info yet
          assignments.forEach((sandboxId, assignedBridgeId) {
            if (assignedBridgeId == bridgeId &&
                !updatedSandboxes.any((s) => s['id'] == sandboxId)) {
              updatedSandboxes.add({
                'id': sandboxId,
                'status': 'assigned',
                'scriptPath': 'Pending...',
                'bridgeId': bridgeId
              });
            }
          });

          // Store the combined list
          _connectedSandboxes = updatedSandboxes;

          // Notify listeners
          onSandboxUpdate!(updatedSandboxes);
        }

        return;
      }

      // Handle connected_sandboxes_update message
      if (decodedMessage['type'] == 'connected_sandboxes_update') {
        final List<dynamic> sandboxesList = decodedMessage['sandboxes'] ?? [];
        final List<Map<String, dynamic>> sandboxes = sandboxesList
            .map((sandbox) => sandbox as Map<String, dynamic>)
            .toList();

        print(
            'Received connected sandboxes update: ${sandboxes.length} sandboxes');

        // Print more details for debugging
        if (sandboxes.isNotEmpty) {
          for (final sandbox in sandboxes) {
            print(
                '  - Sandbox: ${sandbox['id']}, Script: ${sandbox['scriptPath']}');
          }
        }

        // Store the sandboxes
        _connectedSandboxes = sandboxes;

        if (onSandboxUpdate != null) {
          onSandboxUpdate!(sandboxes);
        }
        return;
      }

      // For other message types, handle as before
      if (decodedMessage.containsKey('method')) {
        // Standard JSON-RPC call (e.g. from testing tool)
        final request = JsonRpcRequest.fromJson(decodedMessage);
        _dispatchRequest(request,
            routingInfo); // Pass routingInfo if available (though unlikely for direct RPC)
      } else if (decodedMessage.containsKey('type') &&
          decodedMessage.containsKey('requestId')) {
        // Forwarded call from main.js
        // Construct a JsonRpcRequest-like object for consistent handling by _dispatchRequest
        final request = JsonRpcRequest(
            method: decodedMessage['type']
                as String, // Use 'type' as method for our handlers
            params: decodedMessage['payload'], // 'payload' becomes params
            id: decodedMessage['requestId']
                as String? // 'requestId' is the ID main.js expects a response for
            );
        _dispatchRequest(
            request, routingInfo); // Pass the extracted routingInfo
      } else {
        print('Received message with unknown structure: $decodedMessage');
        // Potentially send an error if an ID was parsable but structure was wrong.
      }
    } catch (e, stackTrace) {
      print(
          'Error decoding or processing incoming message: $e\nStackTrace: $stackTrace');
      // Attempt to extract ID if possible, to send an error back for malformed JSON-RPC
      try {
        final Map<String, dynamic> potentialError = jsonDecode(messageString);
        if (potentialError['id'] != null) {
          _sendBridgedErrorResponse(potentialError['id'].toString(), '-32700',
              'Parse error: Malformed JSON received.', null, routingInfo);
        }
      } catch (_) {
        // If even parsing for ID fails, can't send a structured error.
        print(
            'Could not parse ID from malformed message to send error response.');
      }
    }
  }

  Future<void> _dispatchRequest(JsonRpcRequest request,
      [Map<String, dynamic>? routingInfo]) async {
    final handler = _methodHandlers[request.method];
    final String? requestId = request.id; // Store for clarity, can be null

    print(
        'Dispatching request: ID: ${requestId ?? "N/A (Notification)"}, Method: ${request.method}, Params: ${request.params}, RoutingInfo: $routingInfo');

    if (handler == null) {
      print('Method not found: ${request.method}');
      if (requestId != null) {
        _sendBridgedErrorResponse(requestId, 'MethodNotFound',
            'Method not found: ${request.method}', null, routingInfo);
      }
      return;
    }

    try {
      final dynamic resultData = await handler(requestId,
          request.params); // Pass requestId and params to actual handlers
      if (requestId != null) {
        _sendBridgedSuccessResponse(requestId, resultData, routingInfo);
      }
    } on NotYetImplementedException catch (e) {
      print('Method ${request.method} not yet implemented: $e');
      if (requestId != null) {
        _sendBridgedErrorResponse(requestId, 'NotImplemented',
            'Method not yet implemented: ${e.methodName}', null, routingInfo);
      }
    } on BridgeOperationException catch (e) {
      print('Bridge operation error executing ${request.method}: $e');
      if (requestId != null) {
        _sendBridgedErrorResponse(
            requestId,
            'OperationFailed',
            'Bridge operation failed: ${e.message}',
            e.originalError?.toString(),
            routingInfo);
      }
    } catch (e, stackTrace) {
      print(
          'Unexpected error executing ${request.method}: $e\nStackTrace: $stackTrace');
      if (requestId != null) {
        _sendBridgedErrorResponse(
            requestId,
            'ServerError',
            'Unexpected server error during ${request.method}: ${e.toString()}',
            null,
            routingInfo);
      }
    }
  }

  void _sendMessage(String jsonMessage) {
    if (_channel?.closeCode != null) {
      print(
          "Attempted to send message, but channel is closed. Message: $jsonMessage");
      return;
    }
    _channel!.sink.add(jsonMessage);
  }

  void _sendBridgedSuccessResponse(String requestId, dynamic data,
      [Map<String, dynamic>? routingInfo]) {
    final responsePayload = {
      'type': 'bridge_response_from_portal',
      'requestId': requestId,
      'bridgeId': bridgeId, // The ID of this Flutter Bridge Portal
      'response': {
        'data': data,
      },
      if (routingInfo != null)
        'routingInfo': routingInfo, // Echo back for main.js
    };
    print(
        'Sending success (bridged) for $requestId. RoutingInfo: $routingInfo');
    _sendMessage(jsonEncode(responsePayload));
  }

  void _sendBridgedErrorResponse(
      String requestId, String errorCode, String errorMessage,
      [dynamic errorDetails, Map<String, dynamic>? routingInfo]) {
    final errorObject = {
      'code': errorCode,
      'message': errorMessage,
    };
    if (errorDetails != null) {
      errorObject['details'] = errorDetails;
    }

    final responsePayload = {
      'type': 'bridge_response_from_portal',
      'requestId': requestId,
      'bridgeId': bridgeId, // The ID of this Flutter Bridge Portal
      'response': {
        'error': errorObject,
      },
      if (routingInfo != null)
        'routingInfo': routingInfo, // Echo back for main.js
    };
    print(
        'Sending error (bridged) for $requestId: Code $errorCode, Message "$errorMessage". RoutingInfo: $routingInfo');
    _sendMessage(jsonEncode(responsePayload));
  }

  // --- HTTP Handler ---
  Future<Map<String, dynamic>> _handleHttpRequest(
      String? requestId, dynamic params) async {
    if (params == null || params['url'] == null) {
      throw BridgeOperationException('Missing URL parameter for http_request');
    }

    final String urlString = params['url'] as String;
    final String method = (params['method'] as String?)?.toUpperCase() ?? 'GET';
    final Map<String, String> headers = params['headers'] != null
        ? Map<String, String>.from(params['headers'] as Map)
        : {};
    final dynamic requestBodyParam =
        params['body']; // Can be null, String (potentially base64), or other
    final bool isRequestBodyBase64 =
        params['isRequestBodyBase64'] as bool? ?? false;

    print(
        'bridgeFetch: $method $urlString, Headers: ${headers.keys.toList()}, isRequestBodyBase64: $isRequestBodyBase64');

    http.Response response;
    Uri uri;

    try {
      uri = Uri.parse(urlString);
    } catch (e) {
      throw BridgeOperationException(
          'Invalid URL format for bridgeFetch: $urlString',
          originalError: e);
    }

    List<int>? finalRequestBodyBytes;
    if (requestBodyParam != null) {
      if (isRequestBodyBase64 && requestBodyParam is String) {
        try {
          finalRequestBodyBytes = base64Decode(requestBodyParam);
          print(
              'Decoded Base64 request body, length: ${finalRequestBodyBytes.length}');
        } catch (e) {
          throw BridgeOperationException(
              'Failed to decode Base64 request body for bridgeFetch',
              originalError: e);
        }
      } else if (requestBodyParam is String) {
        finalRequestBodyBytes = utf8.encode(
            requestBodyParam); // Assume UTF-8 for string bodies not marked as base64
      } else if (requestBodyParam is List<int>) {
        finalRequestBodyBytes = requestBodyParam; // Already bytes
      } else {
        throw BridgeOperationException(
            'Unsupported request body type for bridgeFetch: ${requestBodyParam.runtimeType}');
      }
    }

    try {
      switch (method) {
        case 'POST':
          response = await http.post(uri,
              headers: headers, body: finalRequestBodyBytes);
          break;
        case 'PUT':
          response = await http.put(uri,
              headers: headers, body: finalRequestBodyBytes);
          break;
        case 'DELETE':
          // http.delete might not support body for all Dart versions/platforms consistently.
          // If body is needed, consider http.Request.
          if (finalRequestBodyBytes != null &&
              finalRequestBodyBytes.isNotEmpty) {
            final request = http.Request('DELETE', uri)
              ..headers.addAll(headers)
              ..bodyBytes = finalRequestBodyBytes;
            final streamedResponse = await request.send();
            response = await http.Response.fromStream(streamedResponse);
          } else {
            response = await http.delete(uri, headers: headers);
          }
          break;
        case 'PATCH':
          response = await http.patch(uri,
              headers: headers, body: finalRequestBodyBytes);
          break;
        case 'GET':
        default:
          response = await http.get(uri, headers: headers);
          break;
      }

      String responseBodyString;
      bool isResponseBodyBase64 = false;

      final contentType = response.headers['content-type']?.toLowerCase();
      final List<String> binaryContentTypes = [
        'image/', 'audio/', 'video/',
        'application/octet-stream', 'application/zip', 'application/pdf',
        'application/gzip', 'application/wasm'
        // Add more known binary types if needed
      ];

      bool isBinary =
          binaryContentTypes.any((ct) => contentType?.startsWith(ct) ?? false);

      if (isBinary) {
        responseBodyString = base64Encode(response.bodyBytes);
        isResponseBodyBase64 = true;
      } else {
        try {
          responseBodyString =
              utf8.decode(response.bodyBytes, allowMalformed: true);
        } catch (e) {
          print(
              'Failed to decode response body as UTF-8, using Base64 as fallback. Content-Type: $contentType. Error: $e');
          responseBodyString = base64Encode(response.bodyBytes);
          isResponseBodyBase64 = true;
        }
      }

      print(
          'bridgeFetch response: ${response.statusCode}, isBase64: $isResponseBodyBase64, Content-Type: $contentType');

      return {
        "statusCode": response.statusCode,
        "headers": response.headers,
        "body": responseBodyString,
        "isResponseBodyBase64": isResponseBodyBase64,
        "statusMessage": response.reasonPhrase,
      };
    } on http.ClientException catch (e) {
      print('HTTP ClientException during bridgeFetch for $urlString: $e');
      throw BridgeOperationException(
          'Network error during bridgeFetch: ${e.message}',
          originalError: e);
    } catch (e, stackTrace) {
      print(
          'Unexpected error during bridgeFetch for $urlString: $e\nStackTrace: $stackTrace');
      throw BridgeOperationException('Failed to execute fetch: ${e.toString()}',
          originalError: e);
    }
  }

  Future<Map<String, dynamic>> _handleListMethodsRequest(
      String? requestId, dynamic params) async {
    print('Handling bridgeListMethods request.');
    return {"implementedMethods": _implementedMethods};
  }

  void _sendCapabilitiesReport() {
    final String actualBridgeId = bridgeId.trim();
    final capabilitiesMessage = {
      "type": "bridge_capabilities_report",
      "bridgeId": actualBridgeId,
      "capabilities": _implementedMethods,
    };
    print('Sending capabilities: ${jsonEncode(capabilitiesMessage)}');
    _sendMessage(jsonEncode(capabilitiesMessage));
  }

  // Public method for testing bridge methods directly
  Future<Map<String, dynamic>> executeMethod(
      String methodName, Map<String, dynamic> params) async {
    final requestId = DateTime.now().millisecondsSinceEpoch.toString();
    final request = JsonRpcRequest(
      method: methodName,
      params: params,
      id: requestId,
    );

    final handler = _methodHandlers[request.method];
    if (handler == null) {
      throw MethodNotFoundException(request.method);
    }

    try {
      final result = await handler(requestId, request.params);
      return result;
    } catch (e) {
      if (e is BridgeOperationException || e is NotYetImplementedException) {
        rethrow;
      }
      throw BridgeOperationException(
          'Failed to execute $methodName: ${e.toString()}',
          originalError: e);
    }
  }

  void sendToolCommand(String toolName, Map<String, dynamic> arguments) {
    if (_isConnected) {
      _channel!.sink.add(jsonEncode(
          {'type': 'tools/call', 'name': toolName, 'arguments': arguments}));
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
        'params': {'name': commandType, 'arguments': params ?? {}},
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

  void dispose() {
    print('Disposed. Any cleanup if needed would go here.');
    // The channel itself is managed externally.
  }

  // Configure sandbox security
  void configureSecurity({
    List<String>? allowedFilePaths,
    bool enforceFilePathRestrictions = false,
  }) {
    if (allowedFilePaths != null) {
      _allowedFilePaths = allowedFilePaths;
    }
    _enforceFilePathRestrictions = enforceFilePathRestrictions;

    print(
        'Security configured: enforceFilePathRestrictions=$_enforceFilePathRestrictions, allowedPaths=$_allowedFilePaths');
  }

  // Check if a file path is allowed for access
  bool _isFilePathAllowed(String path) {
    if (!_enforceFilePathRestrictions) {
      return true; // No restrictions enforced
    }

    // Check if path starts with any of the allowed paths
    return _allowedFilePaths.any((allowedPath) {
      final normalizedPath = path.replaceAll('\\', '/');
      final normalizedAllowedPath = allowedPath.replaceAll('\\', '/');
      return normalizedPath.startsWith(normalizedAllowedPath);
    });
  }

  // --- File System Handlers ---
  Future<Map<String, dynamic>> _handleFsReadRequest(
      String? requestId, dynamic params) async {
    if (params == null || params['path'] == null) {
      throw BridgeOperationException('Missing path parameter for fs_read');
    }

    final String path = params['path'] as String;
    final String encoding = (params['encoding'] as String?) ?? 'utf8';
    final bool returnAsBase64 = params['returnAsBase64'] as bool? ?? false;

    // Check if file access is allowed
    if (!_isFilePathAllowed(path)) {
      throw BridgeOperationException(
          'Access denied: Path "$path" is not in the allowed paths list.');
    }

    print(
        'bridgeFsRead: Path=$path, Encoding=$encoding, AsBase64=$returnAsBase64');

    try {
      final File file = File(path);
      if (!await file.exists()) {
        throw BridgeOperationException('File not found: $path');
      }

      if (encoding.toLowerCase() == 'binary' || returnAsBase64) {
        // Read as binary and return as base64
        final bytes = await file.readAsBytes();
        return {
          "content": base64Encode(bytes),
          "encoding": "base64",
          "size": bytes.length,
        };
      } else {
        // Read as text
        final content = await file.readAsString();
        return {
          "content": content,
          "encoding": "utf8",
          "size": content.length,
        };
      }
    } catch (e) {
      if (e is BridgeOperationException) rethrow;
      throw BridgeOperationException('Failed to read file: ${e.toString()}',
          originalError: e);
    }
  }

  Future<Map<String, dynamic>> _handleFsWriteRequest(
      String? requestId, dynamic params) async {
    if (params == null || params['path'] == null || params['content'] == null) {
      throw BridgeOperationException(
          'Missing path or content parameter for fs_write');
    }

    final String path = params['path'] as String;
    final dynamic content = params['content'];
    final String encoding = (params['encoding'] as String?) ?? 'utf8';
    final bool isContentBase64 = params['isContentBase64'] as bool? ?? false;

    // Check if file access is allowed
    if (!_isFilePathAllowed(path)) {
      throw BridgeOperationException(
          'Access denied: Path "$path" is not in the allowed paths list.');
    }

    print(
        'bridgeFsWrite: Path=$path, Encoding=$encoding, IsBase64=$isContentBase64');

    try {
      final File file = File(path);

      // Ensure parent directory exists
      final Directory parent = Directory(file.parent.path);
      if (!await parent.exists()) {
        // Check if parent directory creation is allowed
        if (!_isFilePathAllowed(parent.path)) {
          throw BridgeOperationException(
              'Access denied: Cannot create directory "${parent.path}" as it is not in the allowed paths list.');
        }
        await parent.create(recursive: true);
      }

      // Write content to file
      if (isContentBase64 && content is String) {
        try {
          final bytes = base64Decode(content);
          await file.writeAsBytes(bytes);
          return {
            "success": true,
            "bytesWritten": bytes.length,
            "path": path,
          };
        } catch (e) {
          throw BridgeOperationException(
              'Failed to decode Base64 content for writing',
              originalError: e);
        }
      } else if (content is String) {
        await file.writeAsString(content);
        return {
          "success": true,
          "bytesWritten": content.length,
          "path": path,
        };
      } else {
        throw BridgeOperationException(
            'Unsupported content type for bridgeFsWrite: ${content.runtimeType}');
      }
    } catch (e) {
      if (e is BridgeOperationException) rethrow;
      throw BridgeOperationException('Failed to write file: ${e.toString()}',
          originalError: e);
    }
  }

  Future<Map<String, dynamic>> _handleFsStatRequest(
      String? requestId, dynamic params) async {
    if (params == null || params['path'] == null) {
      throw BridgeOperationException('Missing path parameter for fs_stat');
    }
    final String path = params['path'] as String;
    if (!_isFilePathAllowed(path)) {
      throw BridgeOperationException(
          'Access denied: Path "$path" is not allowed for fs_stat.');
    }
    print('fs_stat: Path=$path');

    try {
      final FileStat fileStat = await FileStat.stat(path);
      final type = await FileSystemEntity.type(path);
      String entityType;
      switch (type) {
        case FileSystemEntityType.file:
          entityType = 'file';
          break;
        case FileSystemEntityType.directory:
          entityType = 'directory';
          break;
        case FileSystemEntityType.link:
          entityType = 'link';
          break;
        default:
          entityType = 'unknown';
      }
      return {
        'type': entityType,
        'size': fileStat.size,
        'mode': fileStat.mode,
        'accessed': fileStat.accessed.toIso8601String(),
        'modified': fileStat.modified.toIso8601String(),
        'changed': fileStat.changed
            .toIso8601String(), // Typically same as modified on some systems
      };
    } catch (e) {
      if (e is FileSystemException && e.osError?.errorCode == 2) {
        // ENOENT (No such file or directory)
        throw BridgeOperationException('Path not found for fs_stat: $path',
            originalError: e.message);
      } else if (e is FileSystemException) {
        throw BridgeOperationException(
            'File system error during fs_stat for $path: ${e.message}',
            originalError: e.osError?.message);
      }
      throw BridgeOperationException(
          'Failed to stat path $path: ${e.toString()}',
          originalError: e);
    }
  }

  Future<List<Map<String, dynamic>>> _handleFsListRequest(
      String? requestId, dynamic params) async {
    if (params == null || params['path'] == null) {
      throw BridgeOperationException('Missing path parameter for fs_list');
    }
    final String path = params['path'] as String;
    if (!_isFilePathAllowed(path)) {
      throw BridgeOperationException(
          'Access denied: Path "$path" is not allowed for fs_list.');
    }
    print('fs_list: Path=$path');

    try {
      final dir = Directory(path);
      if (!await dir.exists()) {
        throw BridgeOperationException(
            'Directory not found for fs_list: $path');
      }
      final List<Map<String, dynamic>> entries = [];
      await for (final entity in dir.list()) {
        final stat = await FileStat.stat(entity.path);
        String entityType;
        switch (await FileSystemEntity.type(entity.path)) {
          case FileSystemEntityType.file:
            entityType = 'file';
            break;
          case FileSystemEntityType.directory:
            entityType = 'directory';
            break;
          case FileSystemEntityType.link:
            entityType = 'link';
            break;
          default:
            entityType = 'unknown';
        }
        entries.add({
          'name': entity.path.split(Platform.pathSeparator).last,
          'path': entity.path,
          'type': entityType,
          'size': stat.size,
          'modified': stat.modified.toIso8601String(),
        });
      }
      return entries;
    } catch (e) {
      if (e is FileSystemException) {
        throw BridgeOperationException(
            'File system error during fs_list for $path: ${e.message}',
            originalError: e.osError?.message);
      }
      throw BridgeOperationException(
          'Failed to list directory $path: ${e.toString()}',
          originalError: e);
    }
  }

  Future<Map<String, dynamic>> _handleFsMkdirRequest(
      String? requestId, dynamic params) async {
    final String path = params?['path'] as String? ?? '';
    final bool recursive = params?['recursive'] as bool? ?? false;

    if (path.isEmpty) {
      throw BridgeOperationException('Missing path parameter for fs_mkdir');
    }
    if (!_isFilePathAllowed(path)) {
      throw BridgeOperationException(
          'Access denied: Path "$path" is not allowed for fs_mkdir.');
    }
    print('fs_mkdir: Path=$path, Recursive=$recursive');
    try {
      final dir = Directory(path);
      await dir.create(recursive: recursive);
      return {'success': true, 'path': path};
    } catch (e) {
      if (e is FileSystemException) {
        throw BridgeOperationException(
            'File system error during fs_mkdir for $path: ${e.message}',
            originalError: e.osError?.message);
      }
      throw BridgeOperationException(
          'Failed to create directory $path: ${e.toString()}',
          originalError: e);
    }
  }

  Future<Map<String, dynamic>> _handleFsUnlinkRequest(
      String? requestId, dynamic params) async {
    final String path = params?['path'] as String? ?? '';
    if (path.isEmpty) {
      throw BridgeOperationException('Missing path parameter for fs_unlink');
    }
    if (!_isFilePathAllowed(path)) {
      throw BridgeOperationException(
          'Access denied: Path "$path" is not allowed for fs_unlink.');
    }
    print('fs_unlink: Path=$path');
    try {
      final file = File(path);
      if (await file.exists()) {
        await file.delete();
        return {'success': true, 'path': path};
      } else {
        throw BridgeOperationException('File not found for fs_unlink: $path');
      }
    } catch (e) {
      if (e is FileSystemException) {
        throw BridgeOperationException(
            'File system error during fs_unlink for $path: ${e.message}',
            originalError: e.osError?.message);
      }
      throw BridgeOperationException(
          'Failed to delete file $path: ${e.toString()}',
          originalError: e);
    }
  }

  Future<Map<String, dynamic>> _handleFsRmdirRequest(
      String? requestId, dynamic params) async {
    final String path = params?['path'] as String? ?? '';
    final bool recursive = params?['recursive'] as bool? ??
        false; // Node.js fs.rmdir has recursive option

    if (path.isEmpty) {
      throw BridgeOperationException('Missing path parameter for fs_rmdir');
    }
    if (!_isFilePathAllowed(path)) {
      throw BridgeOperationException(
          'Access denied: Path "$path" is not allowed for fs_rmdir.');
    }
    print('fs_rmdir: Path=$path, Recursive=$recursive');
    try {
      final dir = Directory(path);
      if (await dir.exists()) {
        await dir.delete(recursive: recursive);
        return {'success': true, 'path': path};
      } else {
        throw BridgeOperationException(
            'Directory not found for fs_rmdir: $path');
      }
    } catch (e) {
      if (e is FileSystemException) {
        // Check for specific errors e.g. directory not empty if recursive is false
        if (!recursive && e.osError?.errorCode == 39) {
          // ENOTEMPTY equivalent for Dart might vary or be less specific
          throw BridgeOperationException(
              'Directory not empty and recursive not set for fs_rmdir: $path',
              originalError: e.message);
        }
        throw BridgeOperationException(
            'File system error during fs_rmdir for $path: ${e.message}',
            originalError: e.osError?.message);
      }
      throw BridgeOperationException(
          'Failed to delete directory $path: ${e.toString()}',
          originalError: e);
    }
  }

  // Function to request connected sandboxes from the server
  void requestConnectedSandboxes() {
    if (!_isConnected || _channel == null) {
      print('Cannot request connected sandboxes: not connected to server');
      return;
    }

    print('Requesting connected sandboxes for bridge ID: $bridgeId');

    final message = {
      'type': 'get_connected_sandboxes',
      'bridgeId': bridgeId.trim() // Make sure to use trimmed ID
    };

    final messageStr = jsonEncode(message);
    print('Sending: $messageStr');
    _sendMessage(messageStr);
  }
}
