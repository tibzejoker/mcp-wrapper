import WebSocket from 'ws';
import readline from 'readline';

const BRIDGE_PORT = 3000;
const BRIDGE_HOST = 'localhost';
const WS_URL = `ws://${BRIDGE_HOST}:${BRIDGE_PORT}`;

class McpClient {
    constructor() {
        this.ws = null;
        this.sessionId = null;
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(WS_URL);

            this.ws.on('open', () => {
                console.log('🔌 Connecté au bridge');
                resolve();
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('❌ Erreur lors du parsing du message:', error);
                }
            });

            this.ws.on('error', (error) => {
                console.error('❌ Erreur WebSocket:', error);
                reject(error);
            });

            this.ws.on('close', () => {
                console.log('🔌 Déconnecté du bridge');
                this.sessionId = null;
            });
        });
    }

    handleMessage(message) {
        switch (message.type) {
            case 'started':
                this.sessionId = message.sessionId;
                console.log(`✅ Session démarrée (ID: ${this.sessionId})`);
                break;

            case 'stopped':
                console.log(`✅ Session arrêtée (ID: ${message.sessionId})`);
                this.sessionId = null;
                break;

            case 'stdout':
                console.log(`📤 ${message.message}`);
                break;

            case 'stderr':
                console.error(`⚠️ ${message.message}`);
                break;

            case 'error':
                console.error(`❌ Erreur [${message.source}]:`, message.error);
                break;

            case 'command_sent':
                console.log(`✅ Commande envoyée à la session ${message.sessionId}`);
                break;

            default:
                console.log('📨 Message reçu:', message);
        }
    }

    async startServer(config) {
        if (!this.ws) {
            throw new Error('Non connecté au bridge');
        }

        this.ws.send(JSON.stringify({
            type: 'start',
            config
        }));
    }

    async stopServer() {
        if (!this.ws || !this.sessionId) {
            throw new Error('Aucune session active');
        }

        this.ws.send(JSON.stringify({
            type: 'stop',
            sessionId: this.sessionId
        }));
    }

    async sendCommand(command) {
        if (!this.ws || !this.sessionId) {
            throw new Error('Aucune session active');
        }

        this.ws.send(JSON.stringify({
            type: 'command',
            sessionId: this.sessionId,
            command
        }));
    }

    async startInteractive() {
        console.log('\n🔧 Mode interactif');
        console.log('Commandes disponibles:');
        console.log('  start <path> - Démarrer un serveur MCP');
        console.log('  stop - Arrêter le serveur actuel');
        console.log('  list - Lister les outils disponibles');
        console.log('  exit - Quitter\n');

        this.rl.on('line', async (line) => {
            const trimmed = line.trim();
            const [cmd, ...args] = trimmed.split(' ');

            try {
                switch (cmd) {
                    case 'start': {
                        let rawPath = args.join(' ').trim();
                        rawPath = rawPath.replace(/^['"]+|['"]+$/g, '');
                        if (!rawPath) {
                            console.error('❌ Chemin du serveur MCP requis');
                            return;
                        }
                        await this.startServer({
                            mount: rawPath,
                            env: {}
                        });
                        break;
                    }

                    case 'stop':
                        await this.stopServer();
                        break;

                    case 'list':
                        await this.sendCommand({
                            jsonrpc: "2.0",
                            method: "tools/list",
                            params: {},
                            id: 1
                        });
                        break;

                    case 'exit':
                        if (this.sessionId) {
                            await this.stopServer();
                        }
                        this.rl.close();
                        process.exit(0);
                        break;

                    default:
                        console.log('❌ Commande non reconnue');
                }
            } catch (error) {
                console.error('❌ Erreur:', error.message);
            }
        });
    }
}

// Démarrer le client
async function main() {
    const client = new McpClient();
    try {
        await client.connect();
        await client.startInteractive();
    } catch (error) {
        console.error('❌ Erreur:', error);
        process.exit(1);
    }
}

main(); 