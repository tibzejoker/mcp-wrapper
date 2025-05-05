const { Sandbox } = require('./wrapper/sandbox');
const path = require('path');

// Simuler un client externe qui gère les requêtes
class ExternalClient {
    async handleHttpRequest(request) {
        console.log('🌐 Client externe: Requête HTTP reçue:', {
            url: request.url,
            method: request.method,
            headers: request.headers
        });

        // Simuler une réponse
        return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'Réponse du client externe' })
        };
    }
}

// Créer une instance de la sandbox et du client
const sandbox = new Sandbox('C:\\mount');
const client = new ExternalClient();
const bridge = sandbox.getBridge();

// Configurer l'interception des requêtes réseau
bridge
    .onFetch(async (request) => {
        console.log('⚡ Sandbox: Requête HTTP interceptée');
        
        try {
            // Rediriger la requête vers le client externe
            const response = await client.handleHttpRequest(request);
            console.log('✅ Réponse reçue du client:', response);
            return true; // Autoriser la requête
        } catch (error) {
            console.error('❌ Erreur lors de la redirection:', error);
            return false; // Bloquer la requête en cas d'erreur
        }
    })
    .onConnect(async (connection) => {
        console.log('🔌 Tentative de connexion TCP/UDP:', connection);
        return false; // Bloquer les connexions directes
    })
    .onFileWrite(async ({ path }) => {
        console.log('📝 Écriture fichier:', path);
        return true;
    })
    .onStdout(async ({ message }) => {
        console.log('📤 Sortie standard:', message);
        return true;
    })
    .onStderr(async ({ message }) => {
        console.log('⚠️ Erreur standard:', message);
        return true;
    })
    .onError(async ({ source, error }) => {
        console.error(`❌ Erreur [${source}]:`, error);
    });

// Fonction pour exécuter les tests
async function runTests() {
    try {
        console.log('\n=== Test des requêtes HTTP dans la sandbox ===\n');
        
        // Test avec Node.js
        console.log('1. Test Node.js:');
        console.log('---------------');
        await sandbox.runScript(path.join(__dirname, 'server/http_test.js'));
        
        // Test avec Python
        console.log('\n2. Test Python:');
        console.log('---------------');
        await sandbox.runScript(path.join(__dirname, 'server/http_test.py'));
        
    } catch (error) {
        console.error('\n❌ Erreur lors des tests:', error);
    }
}

// Lancer les tests
runTests(); 