const { Sandbox } = require('./wrapper/sandbox');
const path = require('path');

// Configurations des différentes sandbox
const sandboxConfigs = [
    {
        name: 'Sandbox Dev',
        mount: path.join(__dirname, 'mount/dev'),
        env: {
            APP_ENV: 'development',
            CUSTOM_VAR: 'dev_value',
            SERVER_ID: 'dev-001',
            SCRIPT_TYPE: 'development'
        }
    },
    {
        name: 'Sandbox Test',
        mount: path.join(__dirname, 'mount/test'),
        env: {
            APP_ENV: 'testing',
            CUSTOM_VAR: 'test_value',
            SERVER_ID: 'test-001',
            SCRIPT_TYPE: 'testing'
        }
    },
    {
        name: 'Sandbox Prod',
        mount: path.join(__dirname, 'mount/prod'),
        env: {
            APP_ENV: 'production',
            CUSTOM_VAR: 'prod_value',
            SERVER_ID: 'prod-001',
            SCRIPT_TYPE: 'production'
        }
    }
];

// Simuler un client externe qui gère les requêtes
class ExternalClient {
    async handleHttpRequest(request) {
        console.log('🌐 Client externe: Requête HTTP reçue:', {
            url: request.url,
            method: request.method,
            headers: request.headers
        });

        return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'Réponse du client externe' })
        };
    }
}

// Fonction pour configurer une sandbox
function configureSandbox(config) {
    const sandbox = new Sandbox(config.mount, config.env);
    const client = new ExternalClient();
    const bridge = sandbox.getBridge();

    bridge
        .onFetch(async (request) => {
            console.log(`⚡ ${config.name}: Requête HTTP interceptée`);
            try {
                const response = await client.handleHttpRequest(request);
                console.log(`✅ ${config.name}: Réponse reçue du client:`, response);
                return true;
            } catch (error) {
                console.error(`❌ ${config.name}: Erreur lors de la redirection:`, error);
                return false;
            }
        })
        .onConnect(async (connection) => {
            console.log(`🔌 ${config.name}: Tentative de connexion TCP/UDP:`, connection);
            return false;
        })
        .onFileWrite(async ({ path }) => {
            console.log(`📝 ${config.name}: Écriture fichier:`, path);
            return true;
        })
        .onStdout(async ({ message }) => {
            console.log(`📤 ${config.name}: ${message}`);
            return true;
        })
        .onStderr(async ({ message }) => {
            console.error(`⚠️ ${config.name}: ${message}`);
            return true;
        })
        .onError(async ({ source, error }) => {
            console.error(`❌ ${config.name} [${source}]:`, error);
        });

    return sandbox;
}

async function runSandboxTests(sandbox, config) {
    console.log(`\n=== Tests de ${config.name} ===\n`);

    try {
        // Tests des variables d'environnement Node.js
        console.log('1. Test des variables d\'environnement Node.js:');
        console.log('----------------------------------------');
        await sandbox.runScript(path.join(__dirname, 'server/env_test.js'));
        console.log('\n');

        // Tests des variables d'environnement Python
        console.log('2. Test des variables d\'environnement Python:');
        console.log('----------------------------------------');
        await sandbox.runScript(path.join(__dirname, 'server/env_test.py'));
        console.log('\n');

        console.log(`✅ Tests de ${config.name} terminés avec succès!\n`);
        console.log('------------------------------------------------\n');
    } catch (error) {
        console.error(`❌ Erreur dans ${config.name}:`, error.message);
        throw error;
    }
}

async function runAllTests() {
    console.log('🚀 Démarrage des tests multi-sandbox\n');

    try {
        // Créer et tester chaque sandbox
        for (const config of sandboxConfigs) {
            const sandbox = configureSandbox(config);
            await runSandboxTests(sandbox, config);
        }

        console.log('✅ Tous les tests multi-sandbox terminés avec succès!');
    } catch (error) {
        console.error('❌ Erreur lors des tests:', error.message);
        process.exit(1);
    }
}

// Lancer les tests
runAllTests(); 