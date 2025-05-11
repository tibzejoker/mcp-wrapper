import { Sandbox } from './wrapper/sandbox.js';
import path from 'path';
import { WebSocketServer } from 'ws';
import http from 'http';
import { spawn } from 'child_process';

// Stockage des sessions actives
const sessions = new Map();

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
    console.log(`\n🔌 Nouvelle connexion WebSocket (session ${sessionId})`);

    // Stocker la session
    sessions.set(sessionId, { 
        ws, 
        sandboxes: new Map(), // Map des sandboxes actives
        startTime: new Date(),
    });

    // Envoyer l'état initial des connexions
    broadcastConnections();

    // Gestion des messages
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`\n📨 Message reçu pour la session ${sessionId}:`, JSON.stringify(data, null, 2));

            switch (data.type) {
                case 'start':
                    // Démarrer une nouvelle sandbox
                    if (!data.config || !data.config.scriptPath) {
                        throw new Error('Chemin du script requis');
                    }

                    console.log(`\n🚀 Démarrage de la sandbox pour la session ${sessionId}`);
                    console.log(`📁 Chemin du script: ${data.config.scriptPath}`);
                    console.log(`⚙️ Variables d'environnement:`, data.config.env || {});

                    const sandbox = new Sandbox(data.config.scriptPath, data.config.env || {});
                    const bridge = sandbox.getBridge();

                    // Configuration des handlers du bridge
                    bridge
                        .onStdout(async ({ message }) => {
                            console.log(`\n📤 [Session ${sessionId}] stdout:`, message);
                            ws.send(JSON.stringify({
                                type: 'stdout',
                                connectionId: sessionId,
                                sandboxId: data.sandboxId,
                                message
                            }));
                            return true;
                        })
                        .onStderr(async ({ message }) => {
                            console.log(`\n📤 [Session ${sessionId}] stderr:`, message);
                            ws.send(JSON.stringify({
                                type: 'stderr',
                                connectionId: sessionId,
                                sandboxId: data.sandboxId,
                                message
                            }));
                            return true;
                        })
                        .onError(async ({ source, error }) => {
                            console.log(`\n❌ [Session ${sessionId}] Erreur (${source}):`, error);
                            ws.send(JSON.stringify({
                                type: 'error',
                                connectionId: sessionId,
                                sandboxId: data.sandboxId,
                                source,
                                error: error.message
                            }));
                        });

                    // Démarrer le script
                    console.log(`\n▶️ Exécution du script pour la session ${sessionId}`);
                    sandbox.runScript(data.config.scriptPath).then(process => {
                        console.log(`\n[DEBUG] Processus démarré. PID: ${process.pid}`);
                        
                        // Stocker la sandbox immédiatement
                        const session = sessions.get(sessionId);
                        console.log(`\n[DEBUG] === DÉBUT ENREGISTREMENT SANDBOX ===`);
                        console.log(`[DEBUG] Session ID: ${sessionId}`);
                        console.log(`[DEBUG] Sandbox ID: ${data.sandboxId}`);
                        console.log(`[DEBUG] Session existe: ${!!session}`);
                        console.log(`[DEBUG] État actuel des sandboxes:`, Array.from(session.sandboxes.keys()));
                        
                        // Créer l'objet sandbox
                        const sandboxInfo = {
                            sandbox,
                            process,
                            scriptPath: data.config.scriptPath,
                            env: data.config.env || {},
                            isRunning: true
                        };

                        // Enregistrer la sandbox
                        session.sandboxes.set(data.sandboxId, sandboxInfo);
                        
                        // Vérifier que la sandbox est bien enregistrée
                        console.log(`[DEBUG] Sandbox enregistrée. Nouvel état:`, Array.from(session.sandboxes.keys()));
                        console.log(`[DEBUG] Vérification de l'enregistrement:`, session.sandboxes.has(data.sandboxId));
                        console.log(`[DEBUG] Contenu de la sandbox:`, JSON.stringify(sandboxInfo, null, 2));
                        console.log(`[DEBUG] === FIN ENREGISTREMENT SANDBOX ===\n`);

                        // Vérification finale
                        console.log(`[DEBUG] Vérification finale - Sandbox toujours présente:`, session.sandboxes.has(data.sandboxId));
                        console.log(`[DEBUG] État final des sandboxes:`, Array.from(session.sandboxes.keys()));

                        console.log(`\n✅ Script démarré pour la session ${sessionId}`);
                        ws.send(JSON.stringify({
                            type: 'sandbox_updated',
                            connectionId: sessionId,
                            sandbox: {
                                id: data.sandboxId,
                                scriptPath: data.config.scriptPath,
                                env: data.config.env,
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
                    
                    if (currentSession && currentSession.sandboxes.has(data.sandboxId)) {
                        console.log(`\n[DEBUG] Sandbox ${data.sandboxId} trouvée, début de l'arrêt`);
                        const sandboxInfo = currentSession.sandboxes.get(data.sandboxId);
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
                        currentSession.sandboxes.delete(data.sandboxId);
                        console.log(`\n[DEBUG] Sandbox supprimée. État final:`, Array.from(currentSession.sandboxes.keys()));
                        
                        ws.send(JSON.stringify({
                            type: 'sandbox_updated',
                            connectionId: sessionId,
                            sandbox: {
                                id: data.sandboxId,
                                isRunning: false
                            }
                        }));
                    } else {
                        console.log(`\n[DEBUG] Sandbox ${data.sandboxId} non trouvée pour la session ${sessionId}`);
                        console.log(`[DEBUG] Sandboxes disponibles:`, Array.from(currentSession.sandboxes.keys()));
                    }
                    broadcastConnections();
                    break;

                case 'command':
                    // Envoyer une commande au processus
                    const commandSession = sessions.get(sessionId);
                    if (commandSession && commandSession.sandboxes.has(data.sandboxId)) {
                        const sandboxInfo = commandSession.sandboxes.get(data.sandboxId);
                        if (sandboxInfo.process && sandboxInfo.process.stdin) {
                            console.log(`\n📝 Commande reçue pour la session ${sessionId}:`, data.command);
                            
                            // Formater la commande en JSON-RPC 2.0
                            const jsonRpcRequest = {
                                jsonrpc: "2.0",
                                method: data.command,
                                params: {},
                                id: Date.now()
                            };

                            console.log('\n[DEBUG] Envoi de la commande JSON-RPC:', JSON.stringify(jsonRpcRequest, null, 2));
                            sandboxInfo.process.stdin.write(JSON.stringify(jsonRpcRequest) + '\n');
                            
                            ws.send(JSON.stringify({
                                type: 'command_sent',
                                connectionId: sessionId,
                                sandboxId: data.sandboxId
                            }));
                        } else {
                            console.log('\n[DEBUG] État du processus:');
                            console.log('- sandboxInfo.process existe:', !!sandboxInfo.process);
                            if (sandboxInfo.process) {
                                console.log('- Structure du processus:', JSON.stringify({
                                    hasStdin: !!sandboxInfo.process.stdin,
                                    processKeys: Object.keys(sandboxInfo.process)
                                }, null, 2));
                            }
                            throw new Error('Le processus n\'est pas prêt à recevoir des commandes');
                        }
                    } else {
                        throw new Error('Sandbox non trouvée');
                    }
                    break;

                case 'stdout':
                case 'stderr':
                    const sandboxId = data['sandboxId'];
                    const message = data['message'];
                    const isJson = data['isJson'] || false;
                    
                    // Transmettre le message au client
                    if (sessions.get(sessionId).ws && sessions.get(sessionId).ws.readyState === 1) {
                        sessions.get(sessionId).ws.send(JSON.stringify({
                            type: data.type,
                            connectionId: sessionId,
                            sandboxId: sandboxId,
                            message: message,
                            isJson: isJson
                        }));

                        // Si c'est une réponse JSON, mettre à jour l'état de la sandbox
                        if (isJson) {
                            try {
                                const jsonResponse = JSON.parse(message);
                                const sandbox = sessions.get(sessionId).sandboxes.find(
                                    (s) => s.id === sandboxId
                                );
                                if (sandbox) {
                                    sandbox.lastResponse = jsonResponse;
                                    // Notifier le client de la mise à jour
                                    sessions.get(sessionId).ws.send(JSON.stringify({
                                        type: 'sandbox_response_updated',
                                        connectionId: sessionId,
                                        sandboxId: sandboxId,
                                        response: jsonResponse
                                    }));
                                }
                            } catch (e) {
                                console.error('Erreur lors du parsing de la réponse JSON:', e);
                            }
                        }
                    }
                    break;

                default:
                    console.log(`\n⚠️ Type de message non reconnu pour la session ${sessionId}:`, data.type);
                    throw new Error('Type de message non reconnu');
            }
        } catch (error) {
            console.error(`\n❌ Erreur pour la session ${sessionId}:`, error);
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message
            }));
        }
    });

    // Gestion de la déconnexion
    ws.on('close', () => {
        console.log(`\n🔌 Déconnexion WebSocket (session ${sessionId})`);
        stopSandbox(sessionId);
    });
});

// Démarrer le serveur
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Bridge démarré sur le port ${PORT}`);
    console.log(`📊 Sessions actives: ${sessions.size}`);
}); 