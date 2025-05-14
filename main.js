import { Sandbox } from './wrapper/sandbox.js';
import path from 'path';
import { WebSocketServer } from 'ws';
import http from 'http';
import { spawn } from 'child_process';
import crypto from 'crypto'; // Added for UUIDs

console.log('🚀 Serveur démarré avec nodemon - Test de rechargement automatique!');

// Add a DEBUG flag at the top of the file, right after imports
const PORT = process.env.PORT || 3000;
const DEBUG = false;  // Set to true to enable debug logs

// Replace the debug logging function
function debugLog(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

// Stockage des sessions actives
const sessions = new Map();
const activeBridgeIds = new Map(); // Changed to Map to store timeout info
const connectedBridges = new Map(); // Track connected bridges and their info
const pendingSandboxRequests = new Map(); // Added: track requests forwarded to Flutter bridges
const sandboxBridgeAssignments = new Map(); // Map to track which sandbox is assigned to which bridge

// Fonction pour générer un ID de bridge unique
function generateBridgeId() {
    let bridgeId;
    do {
        // Generate a random 8-character hex string
        bridgeId = Math.random().toString(16).substring(2, 10);
    } while (activeBridgeIds.has(bridgeId));

    const expiresAt = Date.now() + 60000; // 1 minute from now

    // Set a 1-minute timeout for the bridge ID
    const timeout = setTimeout(() => {
        console.log(`\n⌛ Bridge ID ${bridgeId} expired`);
        activeBridgeIds.delete(bridgeId);
    }, 60000); // 1 minute timeout

    // Store the bridge ID with its timeout and expiration time
    activeBridgeIds.set(bridgeId, {
        createdAt: Date.now(),
        expiresAt: expiresAt,
        timeout: timeout
    });

    return {
        bridgeId,
        expiresAt
    };
}

// Function to validate bridge ID
function validateBridgeId(bridgeId) {
    const bridgeInfo = activeBridgeIds.get(bridgeId);
    if (!bridgeInfo) {
        return false;
    }

    // Clear the timeout as the bridge ID is being used
    clearTimeout(bridgeInfo.timeout);
    activeBridgeIds.delete(bridgeId);
    return true;
}

// Fonction pour diffuser l'état des connexions à tous les clients
function broadcastConnections() {
    const connections = Array.from(sessions.entries()).map(([id, session]) => ({
        id,
        status: session.sandboxes.size > 0 ? 'running' : 'connected',
        startTime: session.startTime,
        scriptPath: session.sandboxes.size > 0 ? session.sandboxes.values().next().value.scriptPath : null,
    }));

    const message = JSON.stringify({
        type: 'connections_update',
        connections
    });

    sessions.forEach(session => {
        if (session.ws && session.ws.readyState === 1) { // 1 = OPEN
            session.ws.send(message);
        }
    });
}

// Function to broadcast bridge status to all clients
function broadcastBridgeStatus() {
    const bridgeStatus = Array.from(connectedBridges.entries()).map(([bridgeId, info]) => ({
        bridgeId,
        platform: info.platform,
        connectedAt: info.connectedAt,
        status: 'connected',
        capabilities: info.capabilities // Also include capabilities if available
    }));

    const message = JSON.stringify({
        type: 'bridge_status_update',
        bridges: bridgeStatus
    });

    // Also notify clients about bridge IDs that are no longer expiring
    const bridgeValidationMessage = JSON.stringify({
        type: 'bridge_validation_update',
        validBridgeIds: Array.from(connectedBridges.keys())
    });

    sessions.forEach(session => {
        if (session.ws && session.ws.readyState === 1) {
            session.ws.send(message);
            session.ws.send(bridgeValidationMessage);
        }
    });
}

// Function to get an available bridge ID (first connected bridge or null)
function getFirstAvailableBridgeId() {
    if (connectedBridges.size > 0) {
        // Return the first bridge ID from the connected bridges
        return Array.from(connectedBridges.keys())[0];
    }
    return null;
}

// Function to assign a bridge to a sandbox
function assignBridgeToSandbox(sandboxId, bridgeId) {
    sandboxBridgeAssignments.set(sandboxId, bridgeId);
    debugLog(`[MAIN] Assigned bridge ${bridgeId} to sandbox ${sandboxId}`);
    
    // Update any unassigned sandboxes when a new bridge connects
    broadcastBridgeAssignments();
}

// Function to get the bridge ID assigned to a sandbox
function getBridgeForSandbox(sandboxId) {
    return sandboxBridgeAssignments.get(sandboxId);
}

// Function to assign any unassigned sandboxes to a newly connected bridge
function assignUnassignedSandboxesToBridge(bridgeId) {
    // Get all sandboxes without a bridge assignment
    sessions.forEach((session, sessionId) => {
        session.sandboxes.forEach((sandboxInfo, sandboxId) => {
            if (!sandboxBridgeAssignments.has(sandboxId)) {
                assignBridgeToSandbox(sandboxId, bridgeId);
                debugLog(`[MAIN] Auto-assigned newly connected bridge ${bridgeId} to sandbox ${sandboxId}`);
            }
        });
    });
}

// Function to broadcast bridge assignments to clients
function broadcastBridgeAssignments() {
    const assignments = {};
    sandboxBridgeAssignments.forEach((bridgeId, sandboxId) => {
        assignments[sandboxId] = bridgeId;
    });
    
    const message = JSON.stringify({
        type: 'bridge_assignments_update',
        assignments
    });
    
    sessions.forEach(session => {
        if (session.ws && session.ws.readyState === 1) {
            session.ws.send(message);
        }
    });
}

// Fonction pour arrêter proprement une sandbox
async function stopSandbox(sessionId, sandboxId = null) {
    const session = sessions.get(sessionId);
    if (session) {
        console.log(`\n🛑 [DEBUG] Début de l'arrêt - Session: ${sessionId}, Sandbox: ${sandboxId || 'toutes'}`);
        try {
            if (sandboxId) {
                // Arrêter une sandbox spécifique
                if (session.sandboxes.has(sandboxId)) {
                    const sandboxInfo = session.sandboxes.get(sandboxId);
                    if (sandboxInfo.process) {
                        console.log(`\n[DEBUG] Informations du processus à arrêter:`);
                        console.log(`- PID: ${sandboxInfo.process.pid}`);
                        console.log(`- Exit Code: ${sandboxInfo.process.exitCode}`);
                        console.log(`- Killed: ${sandboxInfo.process.killed}`);
                        console.log(`- Platform: ${process.platform}`);

                        try {
                            // Importer execSync au début
                            const { execSync } = await import('child_process');
                            
                            // Lister tous les processus pour trouver les enfants
                            console.log(`[DEBUG] Recherche des processus enfants...`);
                            const wmic = `wmic process where (ParentProcessId=${sandboxInfo.process.process._handle.pid}) get ProcessId`;
                            console.log(`[DEBUG] Commande WMIC: ${wmic}`);
                            const childPids = execSync(wmic)
                                .toString()
                                .split('\n')
                                .slice(1) // Ignorer l'en-tête
                                .map(pid => pid.trim())
                                .filter(pid => pid); // Filtrer les lignes vides
                            
                            console.log(`[DEBUG] PIDs enfants trouvés:`, childPids);
                            
                            // Tuer chaque processus enfant
                            for (const childPid of childPids) {
                                try {
                                    const killCmd = `taskkill /F /T /PID ${childPid}`;
                                    console.log(`[DEBUG] Killing child process: ${killCmd}`);
                                    execSync(killCmd);
                                } catch (e) {
                                    console.error(`[DEBUG] Erreur lors de la tentative de kill du PID ${childPid}:`, e.message);
                                }
                            }

                            // Tuer le processus parent en dernier
                            const parentPid = sandboxInfo.process.process._handle.pid;
                            const parentCmd = `taskkill /F /T /PID ${parentPid}`;
                            console.log(`[DEBUG] Killing parent process: ${parentCmd}`);
                            execSync(parentCmd);
                            
                            console.log(`[DEBUG] Tous les processus ont été tués`);
                        } catch (error) {
                            console.error(`\n[DEBUG] Erreur lors de l'arrêt du processus:`, error);
                        }
                    } else {
                        console.log(`\n[DEBUG] Pas de processus trouvé pour la sandbox ${sandboxId}`);
                    }
                    session.sandboxes.delete(sandboxId);
                    
                    // Envoyer le message de mise à jour
                    if (session.ws && session.ws.readyState === 1) {
                        session.ws.send(JSON.stringify({
                            type: 'sandbox_updated',
                            connectionId: sessionId,
                            sandbox: {
                                id: sandboxId,
                                isRunning: false
                            }
                        }));
                    }
                } else {
                    console.log(`\n[DEBUG] Sandbox ${sandboxId} non trouvée`);
                }
            } else {
                // Arrêter toutes les sandboxes de la session
                if (session.sandboxes.size > 0) {
                    for (const [sandboxId, sandboxInfo] of session.sandboxes) {
                        if (sandboxInfo.process) {
                            try {
                                // Importer execSync au début
                                const { execSync } = await import('child_process');
                                
                                // Lister tous les processus pour trouver les enfants
                                console.log(`[DEBUG] Recherche des processus enfants...`);
                                const wmic = `wmic process where (ParentProcessId=${sandboxInfo.process.process._handle.pid}) get ProcessId`;
                                console.log(`[DEBUG] Commande WMIC: ${wmic}`);
                                const childPids = execSync(wmic)
                                    .toString()
                                    .split('\n')
                                    .slice(1) // Ignorer l'en-tête
                                    .map(pid => pid.trim())
                                    .filter(pid => pid); // Filtrer les lignes vides
                                
                                console.log(`[DEBUG] PIDs enfants trouvés:`, childPids);
                                
                                // Tuer chaque processus enfant
                                for (const childPid of childPids) {
                                    try {
                                        const killCmd = `taskkill /F /T /PID ${childPid}`;
                                        console.log(`[DEBUG] Killing child process: ${killCmd}`);
                                        execSync(killCmd);
                                    } catch (e) {
                                        console.error(`[DEBUG] Erreur lors de la tentative de kill du PID ${childPid}:`, e.message);
                                    }
                                }

                                // Tuer le processus parent en dernier
                                const parentPid = sandboxInfo.process.process._handle.pid;
                                const parentCmd = `taskkill /F /T /PID ${parentPid}`;
                                console.log(`[DEBUG] Killing parent process: ${parentCmd}`);
                                execSync(parentCmd);
                                
                                console.log(`[DEBUG] Tous les processus ont été tués`);
                            } catch (error) {
                                console.error(`\n[DEBUG] Erreur lors de l'arrêt du processus:`, error);
                            }
                        }
                    }
                    session.sandboxes.clear();
                    
                    // Envoyer le message de mise à jour
                    if (session.ws && session.ws.readyState === 1) {
                        session.ws.send(JSON.stringify({
                            type: 'sandbox_updated',
                            connectionId: sessionId,
                            sandbox: null
                        }));
                    }
                }
            }
            console.log(`\n[DEBUG] Fin de l'arrêt - Session: ${sessionId}, Sandbox: ${sandboxId || 'toutes'}`);
            broadcastConnections();
        } catch (error) {
            console.error(`\n[DEBUG] Erreur globale lors de l'arrêt:`, error);
        }
    } else {
        console.log(`\n[DEBUG] Session ${sessionId} non trouvée`);
    }
}

// Gestion des signaux pour l'arrêt propre
process.on('SIGINT', () => {
    console.log('\n⚠️ Signal SIGINT reçu');
    for (const sessionId of sessions.keys()) {
        stopSandbox(sessionId);
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n⚠️ Signal SIGTERM reçu');
    for (const sessionId of sessions.keys()) {
        stopSandbox(sessionId);
    }
    process.exit(0);
});

// Créer le serveur HTTP
const server = http.createServer();
const wss = new WebSocketServer({ server });

// Gestion des connexions WebSocket
wss.on('connection', (ws) => {
    const sessionId = Date.now().toString();
    console.log(`\n🔌 New client connected with session ID: ${sessionId}`);
    
    sessions.set(sessionId, { 
        ws,
        sandboxes: new Map()
    });

    // Envoyer l'état initial des connexions
    broadcastConnections();

    // Gestion des messages
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            console.log(`\n📨 Message received from session ${sessionId}:`, message);

            switch (message.type) {
                case 'generate_bridge_id': {
                    const { bridgeId, expiresAt } = generateBridgeId();
                    console.log(`\n🔑 Generated bridge ID: ${bridgeId}, expires at: ${new Date(expiresAt).toISOString()}`);
                    ws.send(JSON.stringify({
                        type: 'bridge_id_generated',
                        bridgeId,
                        requestId: message.requestId,
                        expiresAt
                    }));
                    break;
                }

                case 'bridge_register': {
                    // Bridge portal registering with server
                    console.log(`\n🔗 [FLOW] Bridge registration: ID ${message.bridgeId}, Origin: ${message.origin}`);
                    
                    // Handle the bridge registration
                    if (message.origin === 'flutter_bridge_portal') {
                        // This is a bridge portal connecting
                        const bridgeId = message.bridgeId;
                        if (!bridgeId) {
                            ws.send(JSON.stringify({
                                type: 'error',
                                error: 'Bridge ID is required for registration',
                                requestId: message.requestId
                            }));
                            break;
                        }
                        
                        // Store bridge portal information
                        connectedBridges.set(bridgeId, {
                            ws: ws,
                            platform: message.platform || 'unknown',
                            capabilities: message.capabilities || [],
                            connectedAt: Date.now()
                        });
                        
                        // Tag this WebSocket as a bridge portal
                        ws.isBridgePortal = true;
                        ws.bridgeId = bridgeId;
                        
                        console.log(`[MAIN] Bridge portal registered with ID ${bridgeId}`);
                        
                        // Acknowledge bridge registration
                        ws.send(JSON.stringify({
                            type: 'bridge_registered',
                            bridgeId: bridgeId,
                            requestId: message.requestId
                        }));
                        
                        // Assign any unassigned sandboxes to this newly connected bridge
                        assignUnassignedSandboxesToBridge(bridgeId);
                        
                        // Broadcast bridge status update to clients
                        broadcastBridgeStatus();
                        // Broadcast bridge assignments
                        broadcastBridgeAssignments();
                    }
                    // Registration from a Sandbox's Bridge Client
                    if (message.origin === 'sandbox_bridge_client') {
                        if (!message.bridgeId || !connectedBridges.has(message.bridgeId)) {
                             ws.send(JSON.stringify({ type: 'error', requestId: message.requestId, error: 'Target Flutter Bridge ID not provided or not connected.' }));
                             ws.close();
                             return;
                        }
                        ws.isSandboxBridgeClient = true;
                        ws.sandboxSessionId = message.sandboxSessionId; // The client session that owns the sandbox
                        ws.targetFlutterBridgeId = message.bridgeId; // The Flutter bridge this sandbox client talks to
                        ws.bridgeClientInstanceId = message.instanceId; // Unique ID for this specific sandbox bridge client

                        console.log(`\n🔗 Sandbox Bridge Client registered: instanceId=${message.instanceId}, targetFlutterBridgeId=${message.bridgeId}, for client session ${message.sandboxSessionId}`);
                        ws.send(JSON.stringify({ type: 'bridge_registered', requestId: message.requestId, bridgeClientInstanceId: message.instanceId }));
                        // No broadcast needed for sandbox client registration itself
                        break;
                    }

                    // Registration from a Flutter Bridge Portal
                    if (!message.bridgeId || !validateBridgeId(message.bridgeId)) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'Invalid or expired bridge ID'
                        }));
                        // Close the connection for invalid bridge IDs
                        ws.close();
                        return;
                    }
                    
                    // Store bridge connection info for Flutter Bridge Portal
                    ws.isFlutterBridge = true;
                    ws.bridgeId = message.bridgeId; // Store bridgeId on the ws object for Flutter bridges

                    connectedBridges.set(message.bridgeId, {
                        platform: message.platform || 'unknown',
                        connectedAt: Date.now(),
                        ws: ws,
                        capabilities: null // Initialize capabilities
                    });

                    console.log(`\n🔗 Flutter Bridge Portal registered with ID: ${message.bridgeId}, Platform: ${message.platform || 'unknown'}`);
                    ws.send(JSON.stringify({
                        type: 'bridge_registered',
                        bridgeId: message.bridgeId
                    }));

                    // Broadcast updated bridge status to all clients
                    broadcastBridgeStatus();
                    break;
                }

                case 'bridge_capabilities_report':
                    if (message.bridgeId && message.capabilities) {
                        const clientBridgeInfo = connectedBridges.get(message.bridgeId);
                        if (clientBridgeInfo && clientBridgeInfo.ws === ws) {
                            clientBridgeInfo.capabilities = message.capabilities;
                            console.log(`\n📊 Received and stored capabilities from bridge ${message.bridgeId}:`, message.capabilities);
                            // Optionally, send an ack if needed, though not strictly necessary for a report
                            // ws.send(JSON.stringify({ type: 'capabilities_received', bridgeId: message.bridgeId }));
                        } else {
                            console.warn(`⚠️ Received bridge_capabilities_report for bridge ${message.bridgeId} from an unexpected WebSocket session or bridge not found.`);
                            // ws.send(JSON.stringify({ type: 'error', error: 'Invalid session for capabilities report' }));
                        }
                    } else {
                        console.warn('⚠️ Received malformed bridge_capabilities_report:', message);
                        // ws.send(JSON.stringify({ type: 'error', error: 'Malformed capabilities report' }));
                    }
                    break;

                // Intercepted calls from Sandbox Bridge Client to be forwarded to Flutter Bridge
                case 'fs_read':
                case 'fs_write':
                case 'fs_stat':
                case 'fs_list': // Assuming 'fs_list' will be a type
                case 'fs_mkdir':
                case 'fs_rmdir':
                case 'fs_unlink':
                case 'http_request':
                // Add other interceptable types here, e.g. 'child_process_spawn', 'dns_lookup'
                {
                    if (!ws.isSandboxBridgeClient) {
                        console.warn(`⚠️ Received ${message.type} from non-sandbox-bridge client:`, ws.sandboxSessionId || sessionId);
                        ws.send(JSON.stringify({ type: 'bridge_response', requestId: message.requestId, response: { error: 'Operation only allowed for sandbox bridge clients.' } }));
                        break;
                    }

                    // Эти поля теперь приходят от wrapper/bridge.js
                    const targetFlutterBridgeId = message.targetFlutterBridgeId; 
                    const sandboxSessionIdFromMsg = message.sandboxSessionId;
                    const actualSandboxIdFromMsg = message.actualSandboxId;
                    const originalRequestIdFromSandbox = message.requestId;

                    if (!targetFlutterBridgeId || !sandboxSessionIdFromMsg || !actualSandboxIdFromMsg) {
                        console.error(`❌ Missing routing info in ${message.type} from sandbox client: targetFlutterBridgeId, sandboxSessionId, or actualSandboxId.`);
                        ws.send(JSON.stringify({ type: 'bridge_response', requestId: originalRequestIdFromSandbox, response: { error: 'Internal server error: Missing routing information from sandbox client.' } }));
                        break;
                    }

                    const flutterBridgeInfo = connectedBridges.get(targetFlutterBridgeId);

                    if (!flutterBridgeInfo || !flutterBridgeInfo.ws) {
                        console.error(`❌ Target Flutter bridge ${targetFlutterBridgeId} not found or disconnected for ${message.type}`);
                        ws.send(JSON.stringify({ type: 'bridge_response', requestId: originalRequestIdFromSandbox, response: { error: `Target Flutter bridge ${targetFlutterBridgeId} not available.` } }));
                        break;
                    }

                    const forwardedRequestId = crypto.randomUUID(); // Unique ID for main.js <-> Flutter Portal leg
                    pendingSandboxRequests.set(forwardedRequestId, {
                        originalRequestId: originalRequestIdFromSandbox,
                        sandboxClientWs: ws, // The WebSocket of the sandbox_bridge_client
                        originalType: message.type,
                        // Store for routing the response back correctly
                        targetFlutterBridgeId: targetFlutterBridgeId,
                        sandboxSessionId: sandboxSessionIdFromMsg,
                        actualSandboxId: actualSandboxIdFromMsg
                    });

                    const requestToFlutter = {
                        // method: message.type, // Use 'method' for JSON-RPC style to Flutter
                        // Use the original type for now, BridgeService expects these types directly
                        type: message.type, 
                        requestId: forwardedRequestId, // This is for main.js <-> Flutter Portal tracking
                        payload: message.payload,
                        // Echo these back from Flutter Portal in its response so main.js can route to the correct sandbox client
                        routingInfo: {
                            targetFlutterBridgeId: targetFlutterBridgeId,
                            sandboxSessionId: sandboxSessionIdFromMsg,
                            actualSandboxId: actualSandboxIdFromMsg
                        }
                    };

                    console.log(`\n↪️ Forwarding ${message.type} (sandboxReqId: ${originalRequestIdFromSandbox} -> mainFwdId: ${forwardedRequestId}) to Flutter bridge ${targetFlutterBridgeId}`);
                    flutterBridgeInfo.ws.send(JSON.stringify(requestToFlutter));
                    break;
                }

                // Response from Flutter Bridge Portal to be routed back to Sandbox Bridge Client
                case 'bridge_response_from_portal': {
                    if (!ws.isFlutterBridge) {
                        console.warn(`⚠️ Received 'bridge_response_from_portal' from non-Flutter bridge:`, sessionId);
                        break;
                    }

                    const forwardedRequestId = message.requestId; // This was generated by main.js for the main.js <-> Flutter leg
                    const pendingReq = pendingSandboxRequests.get(forwardedRequestId);

                    if (!pendingReq) {
                        console.error(`❌ No pending sandbox request found for forwardedRequestId: ${forwardedRequestId} from Flutter bridge ${ws.bridgeId}`);
                        break;
                    }
                    pendingSandboxRequests.delete(forwardedRequestId);

                    // const { originalRequestId, sandboxClientWs, originalType, sandboxSessionId, actualSandboxId } = pendingReq;
                    // The sandboxClientWs is the key. The other stored IDs (sandboxSessionId, actualSandboxId) were for context/logging if needed here.
                    const { originalRequestId, sandboxClientWs, originalType } = pendingReq;


                    if (sandboxClientWs && sandboxClientWs.readyState === 1) { // 1 = OPEN
                        const responseToSandbox = {
                            type: 'bridge_response', // Generic response type for wrapper/bridge.js
                            requestId: originalRequestId, // The ID the sandbox client is waiting for
                            response: message.response // This is the {data: ..., error: ...} part from Flutter
                        };
                        console.log(`\n↩️ Routing response for ${originalType} (mainFwdId: ${forwardedRequestId} -> sandboxReqId: ${originalRequestId}) back to sandbox client (instance: ${sandboxClientWs.bridgeClientInstanceId})`);
                        sandboxClientWs.send(JSON.stringify(responseToSandbox));
                    } else {
                        console.warn(`⚠️ Sandbox client for originalRequestId ${originalRequestId} (forwarded ${forwardedRequestId}, instance: ${sandboxClientWs ? sandboxClientWs.bridgeClientInstanceId : 'N/A'}) is disconnected or not available.`);
                    }
                    break;
                }

                case 'register_handler': {
                    // Handle registration of message handlers
                    console.log(`\n📝 Registering handler for session ${sessionId}`);
                    ws.send(JSON.stringify({
                        type: 'handler_registered',
                        success: true
                    }));
                    break;
                }

                case 'start':
                    console.log(`\n▶️ Start request received from session ${sessionId}`);
                    // If targetFlutterBridgeId is not specified, use the first available bridge
                    const targetBridgeId = message.config?.targetFlutterBridgeId || getFirstAvailableBridgeId();
                    const sandboxId = message.sandboxId || crypto.randomUUID();
                    
                    // If we have a bridge ID, assign it to this sandbox
                    if (targetBridgeId) {
                        assignBridgeToSandbox(sandboxId, targetBridgeId);
                    }

                    console.log(`\n🚀 Démarrage de la sandbox pour la session ${sessionId}`);
                    console.log(`📁 Chemin du script: ${message.config.scriptPath}`);
                    console.log(`⚙️ Variables d'environnement:`, message.config.env || {});

                    const sandbox = new Sandbox(message.config.scriptPath, message.config.env || {});
                    const bridge = sandbox.getBridge();

                    // Configuration des handlers du bridge
                    bridge
                        .onStdout(async ({ message }) => {
                            console.log(`\n📤 [Session ${sessionId}] stdout:`, message);
                            ws.send(JSON.stringify({
                                type: 'stdout',
                                connectionId: sessionId,
                                sandboxId: message.sandboxId,
                                message
                            }));
                            return true;
                        })
                        .onStderr(async ({ message }) => {
                            console.log(`\n📤 [Session ${sessionId}] stderr:`, message);
                            ws.send(JSON.stringify({
                                type: 'stderr',
                                connectionId: sessionId,
                                sandboxId: message.sandboxId,
                                message
                            }));
                            return true;
                        })
                        .onError(async ({ source, error }) => {
                            console.log(`\n❌ [Session ${sessionId}] Erreur (${source}):`, error);
                            ws.send(JSON.stringify({
                                type: 'error',
                                connectionId: sessionId,
                                sandboxId: message.sandboxId,
                                source,
                                error: error.message
                            }));
                        });

                    // Démarrer le script
                    console.log(`\n▶️ Exécution du script pour la session ${sessionId}`);
                    sandbox.runScript(message.config.scriptPath).then(processController => {
                        console.log(`\n[DEBUG] Processus démarré. PID: ${processController.process.pid}`);
                        
                        // Stocker la sandbox immédiatement
                        const session = sessions.get(sessionId);
                        console.log(`\n[DEBUG] === DÉBUT ENREGISTREMENT SANDBOX ===`);
                        console.log(`[DEBUG] Session ID: ${sessionId}`);
                        console.log(`[DEBUG] Sandbox ID: ${message.sandboxId}`);
                        console.log(`[DEBUG] Session existe: ${!!session}`);
                        console.log(`[DEBUG] État actuel des sandboxes:`, Array.from(session.sandboxes.keys()));
                        
                        // Créer l'objet sandbox
                        const sandboxInfo = {
                            sandbox,
                            process: processController.process,
                            scriptPath: message.config.scriptPath,
                            env: message.config.env || {},
                            isRunning: true
                        };

                        // Enregistrer la sandbox
                        session.sandboxes.set(message.sandboxId, sandboxInfo);
                        
                        // Vérifier que la sandbox est bien enregistrée
                        console.log(`[DEBUG] Sandbox enregistrée. Nouvel état:`, Array.from(session.sandboxes.keys()));
                        console.log(`[DEBUG] Vérification de l'enregistrement:`, session.sandboxes.has(message.sandboxId));
                        console.log(`[DEBUG] Contenu de la sandbox:`, JSON.stringify(sandboxInfo, null, 2));
                        console.log(`[DEBUG] === FIN ENREGISTREMENT SANDBOX ===\n`);

                        // Vérification finale
                        console.log(`[DEBUG] Vérification finale - Sandbox toujours présente:`, session.sandboxes.has(message.sandboxId));
                        console.log(`[DEBUG] État final des sandboxes:`, Array.from(session.sandboxes.keys()));

                        console.log(`\n✅ Script démarré pour la session ${sessionId}`);

                        // Instruct the sandbox child process to initialize its real bridge client
                        if (processController && processController.process && typeof processController.process.send === 'function') {
                            const targetFlutterBridgeId = message.config.targetFlutterBridgeId; 
                            if (!targetFlutterBridgeId) {
                                console.error(`[MAIN] Error starting sandbox for session ${sessionId}: 'targetFlutterBridgeId' missing in start message config.`);
                                ws.send(JSON.stringify({ type: 'error', connectionId: sessionId, sandboxId: message.sandboxId, error: "'targetFlutterBridgeId' is required in start config." }));
                                // Consider stopping the sandbox here
                                return; 
                            }

                            if (connectedBridges.has(targetFlutterBridgeId)) {
                                console.log(`[MAIN] Instructing sandbox child process (PID: ${processController.process.pid}) to initialize its Bridge client. Target Flutter Bridge ID: ${targetFlutterBridgeId}, Sandbox Session (Client) ID: ${sessionId}, Actual Sandbox ID: ${message.sandboxId}`);
                                processController.process.send({
                                    type: 'bridge_register',                // Tells sandbox.js to init its Bridge instance
                                    targetFlutterBridgeId: targetFlutterBridgeId, // The ID of the Flutter Bridge Portal to use (renamed from bridgeId for clarity)
                                    sandboxSessionId: sessionId,             // The mcp_client session ID (main.js context)
                                    actualSandboxId: message.sandboxId     // The unique ID for this sandbox instance, from mcp_client
                                });
                            } else {
                                console.error(`[MAIN] Cannot instruct sandbox for session ${sessionId} to register bridge: Target Flutter Bridge '${targetFlutterBridgeId}' is not connected.`);
                                ws.send(JSON.stringify({ type: 'error', connectionId: sessionId, sandboxId: message.sandboxId, error: `Target Flutter Bridge '${targetFlutterBridgeId}' not connected.` }));
                                // Optionally, stop the sandbox, as it won't have a functional bridge.
                                // sandboxInfo.process.stop(); or similar cleanup
                            }
                        } else {
                             console.error(`[MAIN] Sandbox process for session ${sessionId} not available or no send method, cannot send bridge_register instruction.`);
                             ws.send(JSON.stringify({ type: 'error', connectionId: sessionId, sandboxId: message.sandboxId, error: "Sandbox process communication channel not available." }));
                        }

                        ws.send(JSON.stringify({
                            type: 'sandbox_updated',
                            connectionId: sessionId,
                            sandbox: {
                                id: message.sandboxId,
                                scriptPath: message.config.scriptPath,
                                env: message.config.env,
                                isRunning: true
                            }
                        }));
                        broadcastConnections();
                    }).catch(error => {
                        console.error(`\n❌ Erreur lors du démarrage du script:`, error);
                        ws.send(JSON.stringify({
                            type: 'error',
                            connectionId: sessionId,
                            error: error.message
                        }));
                    });
                    break;

                case 'stop':
                    // Arrêter la sandbox
                    console.log(`\n🛑 Arrêt demandé pour la session ${sessionId}`);
                    const currentSession = sessions.get(sessionId);
                    console.log(`\n[DEBUG] État des sandboxes avant arrêt:`, Array.from(currentSession.sandboxes.keys()));
                    
                    if (currentSession && currentSession.sandboxes.has(message.sandboxId)) {
                        console.log(`\n[DEBUG] Sandbox ${message.sandboxId} trouvée, début de l'arrêt`);
                        const sandboxInfo = currentSession.sandboxes.get(message.sandboxId);
                        if (sandboxInfo.process) {
                            try {
                                // Importer execSync au début
                                const { execSync } = await import('child_process');
                                
                                // Lister tous les processus pour trouver les enfants
                                console.log(`[DEBUG] Recherche des processus enfants...`);
                                const wmic = `wmic process where (ParentProcessId=${sandboxInfo.process.process._handle.pid}) get ProcessId`;
                                console.log(`[DEBUG] Commande WMIC: ${wmic}`);
                                const childPids = execSync(wmic)
                                    .toString()
                                    .split('\n')
                                    .slice(1) // Ignorer l'en-tête
                                    .map(pid => pid.trim())
                                    .filter(pid => pid); // Filtrer les lignes vides
                                
                                console.log(`[DEBUG] PIDs enfants trouvés:`, childPids);
                                
                                // Tuer chaque processus enfant
                                for (const childPid of childPids) {
                                    try {
                                        const killCmd = `taskkill /F /T /PID ${childPid}`;
                                        console.log(`[DEBUG] Killing child process: ${killCmd}`);
                                        execSync(killCmd);
                                    } catch (e) {
                                        console.error(`[DEBUG] Erreur lors de la tentative de kill du PID ${childPid}:`, e.message);
                                    }
                                }

                                // Tuer le processus parent en dernier
                                const parentPid = sandboxInfo.process.process._handle.pid;
                                const parentCmd = `taskkill /F /T /PID ${parentPid}`;
                                console.log(`[DEBUG] Killing parent process: ${parentCmd}`);
                                execSync(parentCmd);
                                
                                console.log(`[DEBUG] Tous les processus ont été tués`);
                            } catch (error) {
                                console.error(`\n[DEBUG] Erreur lors de l'arrêt du processus:`, error);
                            }
                        }
                        currentSession.sandboxes.delete(message.sandboxId);
                        console.log(`\n[DEBUG] Sandbox supprimée. État final:`, Array.from(currentSession.sandboxes.keys()));
                        
                        ws.send(JSON.stringify({
                            type: 'sandbox_updated',
                            connectionId: sessionId,
                            sandbox: {
                                id: message.sandboxId,
                                isRunning: false
                            }
                        }));
                    } else {
                        console.log(`\n[DEBUG] Sandbox ${message.sandboxId} non trouvée pour la session ${sessionId}`);
                        console.log(`[DEBUG] Sandboxes disponibles:`, Array.from(currentSession.sandboxes.keys()));
                    }
                    broadcastConnections();
                    // Add this line before or after removing the sandbox from the session
                    sandboxBridgeAssignments.delete(message.sandboxId);
                    break;

                case 'command':
                    // Envoyer une commande au processus
                    const commandSession = sessions.get(sessionId);
                    console.log(`\n[DEBUG] Traitement commande pour session ${sessionId}`);
                    console.log(`[DEBUG] Session existe: ${!!commandSession}`);
                    
                    if (!commandSession) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'Session non trouvée',
                            connectionId: sessionId
                        }));
                        break;
                    }

                    console.log(`[DEBUG] Sandboxes disponibles:`, Array.from(commandSession.sandboxes.keys()));
                    console.log(`[DEBUG] Recherche sandbox: ${message.sandboxId}`);
                    
                    if (!message.sandboxId) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'ID de sandbox manquant',
                            connectionId: sessionId,
                            availableSandboxes: Array.from(commandSession.sandboxes.keys())
                        }));
                        break;
                    }

                    if (!commandSession.sandboxes.has(message.sandboxId)) {
                        console.log(`\n[DEBUG] Sandbox ${message.sandboxId} non trouvée. Sandboxes disponibles:`, 
                            Array.from(commandSession.sandboxes.keys()));
                        
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: `Sandbox ${message.sandboxId} non trouvée`,
                            connectionId: sessionId,
                            details: {
                                requestedSandbox: message.sandboxId,
                                availableSandboxes: Array.from(commandSession.sandboxes.keys()),
                                suggestion: 'Veuillez vérifier que vous utilisez le bon ID de sandbox ou redémarrer la sandbox si nécessaire'
                            }
                        }));
                        break;
                    }

                    const sandboxInfo = commandSession.sandboxes.get(message.sandboxId);
                    if (!sandboxInfo.process || !sandboxInfo.process.stdin) {
                        console.log('\n[DEBUG] État du processus:');
                        console.log('- sandboxInfo.process existe:', !!sandboxInfo.process);
                        if (sandboxInfo.process) {
                            console.log('- Structure du processus:', JSON.stringify({
                                hasStdin: !!sandboxInfo.process.stdin,
                                processKeys: Object.keys(sandboxInfo.process)
                            }, null, 2));
                        }
                        
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'Le processus n\'est pas prêt à recevoir des commandes',
                            connectionId: sessionId,
                            sandboxId: message.sandboxId,
                            details: {
                                processState: sandboxInfo.process ? 'exists' : 'missing',
                                stdinState: sandboxInfo.process?.stdin ? 'ready' : 'not_ready'
                            }
                        }));
                        break;
                    }

                    console.log(`\n📝 Commande reçue pour la session ${sessionId}:`, message.command);
                    
                    try {
                        // Parse the command string to get the JSON-RPC request
                        const jsonRpcRequest = typeof message.command === 'string' 
                            ? JSON.parse(message.command)
                            : message.command;

                        // Important flow log - always show regardless of DEBUG setting
                        console.log(`\n🔄 [FLOW] JSON-RPC command ${jsonRpcRequest.method} (id: ${jsonRpcRequest.id}) for sandbox ${message.sandboxId} (session ${sessionId})`);
                        
                        debugLog('\n[DEBUG] Envoi de la commande JSON-RPC:', JSON.stringify(jsonRpcRequest, null, 2));
                        
                        // Send the parsed JSON-RPC request directly
                        sandboxInfo.process.stdin.write(JSON.stringify(jsonRpcRequest) + '\n');
                        
                        ws.send(JSON.stringify({
                            type: 'command_sent',
                            connectionId: sessionId,
                            sandboxId: message.sandboxId,
                            command: jsonRpcRequest
                        }));
                    } catch (error) {
                        console.error('\n❌ [ERROR] Command parsing failed:', error.message);
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'Format de commande invalide',
                            connectionId: sessionId,
                            sandboxId: message.sandboxId,
                            details: {
                                originalError: error.message,
                                command: message.command
                            }
                        }));
                    }
                    break;

                // stdout/stderr from a Sandbox Bridge Client (wrapper/bridge.js instance)
                case 'stdout': // Note: type 'stdout' might also be used by mcp_client for other things.
                case 'stderr': // We rely on ws.isSandboxBridgeClient to differentiate.
                    if (ws.isSandboxBridgeClient) {
                        const actualSandboxId = message.actualSandboxId;
                        const sandboxSessionId = message.sandboxSessionId; // This is the mcp_client's session ID
                        const outputMessage = message.message;
                        const messageType = message.type; // 'stdout' or 'stderr'

                        if (!actualSandboxId || !sandboxSessionId || outputMessage === undefined) {
                            console.warn(`[MAIN] Malformed ${messageType} from sandbox bridge client:`, message);
                            // Optionally send an error back to the sandbox bridge client if it had a requestId
                            break;
                        }

                        const clientSession = sessions.get(sandboxSessionId);
                        if (clientSession && clientSession.ws && clientSession.ws.readyState === 1) {
                            // Important flow log for command responses
                            if (message.isJson) {
                                try {
                                    const jsonOutput = JSON.parse(outputMessage);
                                    if (jsonOutput.id && jsonOutput.result && jsonOutput.jsonrpc === "2.0") {
                                        console.log(`\n✅ [FLOW] JSON-RPC response (id: ${jsonOutput.id}) from sandbox ${actualSandboxId}`);
                                    }
                                } catch (e) {
                                    // Not valid JSON or not a JSON-RPC response
                                }
                            }
                            
                            debugLog(`\n📠 Forwarding ${messageType} from sandbox ${actualSandboxId} (session ${sandboxSessionId}) to MCP Client:`, 
                                outputMessage.substring(0, 100) + (outputMessage.length > 100 ? '...' : ''));
                            
                            clientSession.ws.send(JSON.stringify({
                                type: messageType,
                                connectionId: sandboxSessionId,
                                sandboxId: actualSandboxId,
                                message: outputMessage,
                                isJson: message.isJson || false
                            }));
                        } else {
                            debugLog(`\n[DEBUG] MCP Client session ${sandboxSessionId} not found or not connected for forwarding ${messageType} from sandbox ${actualSandboxId}.`);
                        }
                    } else {
                        // This stdout/stderr is NOT from a sandbox_bridge_client.
                        // It might be from mcp_client if it ever sends such types, or an old handler.
                        // For now, let it fall through to default or a pre-existing general handler if any.
                        // Based on current structure, it would hit the default error.
                        // This section might need to be merged with the general stdout/stderr handler later if one exists and is intended.
                        console.log(`\n⚠️ Received ${message.type} from non-SandboxBridgeClient (session ${sessionId}). Message:`, message);
                        // Let it fall to default for now, which throws an error.
                        // This helps identify if any other component is unexpectedly sending these types.
                        throw new Error(`Unhandled ${message.type} from non-SandboxBridgeClient.`);
                    }
                    break;

                case 'get_bridge_status': {
                    const bridgeStatus = Array.from(connectedBridges.entries()).map(([bridgeId, info]) => ({
                        bridgeId,
                        platform: info.platform,
                        connectedAt: info.connectedAt,
                        status: 'connected',
                        capabilities: info.capabilities // Also include capabilities if available
                    }));

                    ws.send(JSON.stringify({
                        type: 'bridge_status_update',
                        bridges: bridgeStatus
                    }));
                    break;
                }

                case 'get_connected_sandboxes': {
                    const requestedBridgeId = message.bridgeId;
                    if (!requestedBridgeId) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'Missing bridgeId parameter'
                        }));
                        break;
                    }
                    
                    // Find all sandboxes assigned to this bridge
                    const connectedSandboxes = [];
                    
                    // Always log this without DEBUG check - important for troubleshooting
                    console.log(`[MAIN] Getting connected sandboxes for bridge ID: ${requestedBridgeId}`);
                    console.log(`[MAIN] Current assignments:`, Array.from(sandboxBridgeAssignments.entries()));
                    
                    // Collect all sandboxes from all sessions
                    sessions.forEach((sessionInfo, sessionId) => {
                        sessionInfo.sandboxes.forEach((sandboxInfo, sandboxId) => {
                            const assignedBridgeId = sandboxBridgeAssignments.get(sandboxId);
                            
                            // Check if this sandbox is assigned to the requested bridge
                            if (assignedBridgeId === requestedBridgeId) {
                                connectedSandboxes.push({
                                    id: sandboxId,
                                    scriptPath: sandboxInfo.scriptPath || 'Unknown script',
                                    sessionId: sessionId,
                                    status: 'connected',
                                    bridgeId: assignedBridgeId
                                });
                            }
                        });
                    });
                    
                    // Send the response with full details of the connected sandboxes
                    console.log(`[MAIN] Sending connected sandboxes update to bridge ${requestedBridgeId} with ${connectedSandboxes.length} sandboxes: `, connectedSandboxes.length > 0 ? JSON.stringify(connectedSandboxes) : "[]");
                    ws.send(JSON.stringify({
                        type: 'connected_sandboxes_update',
                        sandboxes: connectedSandboxes
                    }));
                    
                    // Also notify this specific bridge about sandbox assignments
                    const bridgeSpecificAssignments = {};
                    sandboxBridgeAssignments.forEach((bridgeId, sandboxId) => {
                        if (bridgeId === requestedBridgeId) {
                            bridgeSpecificAssignments[sandboxId] = bridgeId;
                        }
                    });
                    
                    // Send a direct bridge_assignments_update to this bridge
                    console.log(`[MAIN] Also sending direct bridge assignments to ${requestedBridgeId}:`, bridgeSpecificAssignments);
                    ws.send(JSON.stringify({
                        type: 'bridge_assignments_update',
                        assignments: bridgeSpecificAssignments
                    }));
                    
                    break;
                }

                default:
                    console.log(`\n⚠️ Type de message non reconnu pour la session ${sessionId}:`, message.type);
                    throw new Error('Type de message non reconnu');
            }
        } catch (error) {
            console.error('❌ Erreur pour la session', sessionId + ':', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message
            }));
        }
    });

    // Handle bridge disconnection
    ws.on('close', () => {
        console.log(`\n🔌 Déconnexion WebSocket (session ${sessionId})`);
        
        // Check if this was a Flutter bridge connection
        if (ws.isFlutterBridge && ws.bridgeId) {
            if (connectedBridges.has(ws.bridgeId)) {
                console.log(`\n🔌 Flutter Bridge Portal ${ws.bridgeId} disconnected`);
                connectedBridges.delete(ws.bridgeId);
                broadcastBridgeStatus();
            }
        } else if (ws.isSandboxBridgeClient && ws.bridgeClientInstanceId) {
            console.log(`\n🔌 Sandbox Bridge Client ${ws.bridgeClientInstanceId} (targeting ${ws.targetFlutterBridgeId}) disconnected.`);
            // Clean up pending requests that were expecting a response via this client, if any
            // (though responses go via Flutter bridge connection, not this one directly typically)
            // No specific cleanup needed here for pendingSandboxRequests as they are keyed by requests *to* Flutter.
        } else {
            // This was a client (e.g. mcp_client) connection
            if (sessions.has(sessionId)) {
                 console.log(`\n🔌 MCP Client ${sessionId} disconnected.`);
                 stopSandbox(sessionId); // Stop all sandboxes for this client session
                 sessions.delete(sessionId);
                 broadcastConnections(); // Update other clients about the disconnection
            }
        }
        
        // Original logic for stopping sandboxes if client disconnects (covers mcp_client)
        // The new logic above handles specific bridge types first.
        // If it was an MCP client, the 'else' block for sessions.has(sessionId) now handles it.
        // The old call to stopSandbox(sessionId) here is now conditional.
    });
});

// Démarrer le serveur
server.listen(PORT, () => {
    console.log(`\n🚀 Bridge démarré sur le port ${PORT}`);
    console.log(`📊 Sessions actives: ${sessions.size}`);
}); 