const { Sandbox } = require('./wrapper/sandbox');
const path = require('path');

// Créer une instance de la sandbox
const sandbox = new Sandbox('C:\\mount');
const bridge = sandbox.getBridge();

// Configuration des tests
bridge
    // Test des requêtes réseau
    .onFetch(async (request) => {
        console.log('⚡ Test - Requête HTTP:', request);
        return true;
    })
    .onConnect(async (connection) => {
        console.log('🔌 Test - Connexion:', connection);
        return true;
    })
    .onDns(async (query) => {
        console.log('🔍 Test - Résolution DNS:', query);
        return true;
    })

    // Test des opérations fichiers
    .onFileRead(async ({ path }) => {
        console.log('📖 Test - Lecture:', path);
        return true;
    })
    .onFileWrite(async ({ path }) => {
        console.log('📝 Test - Écriture:', path);
        return true;
    })
    .onFileDelete(async ({ path }) => {
        console.log('🗑️ Test - Suppression:', path);
        return true;
    })

    // Test des E/S
    .onStdout(async ({ message }) => {
        console.log('📤 Test - Stdout:', message);
        return true;
    })
    .onStderr(async ({ message }) => {
        console.log('⚠️ Test - Stderr:', message);
        return true;
    })

    // Test des processus et modules
    .onSpawn(async ({ command, args }) => {
        console.log('🚀 Test - Processus:', { command, args });
        return true;
    })
    .onImport(async ({ module }) => {
        console.log('📦 Test - Import:', module);
        return true;
    })
    .onEnv(async ({ name, value }) => {
        console.log('🔧 Test - Variable env:', { name, value });
        return true;
    })

    // Gestion des erreurs
    .onError(async ({ source, error }) => {
        console.error('❌ Test - Erreur:', { source, error });
    });

// Tests séquentiels
async function runTests() {
    try {
        console.log('\n=== Tests de la sandbox ===\n');

        // 1. Test des opérations fichiers
        console.log('1. Test des opérations fichiers:');
        console.log('------------------------------');
        await sandbox.runScript(path.join(__dirname, 'server/index.js'));

        // 2. Test des requêtes HTTP
        console.log('\n2. Test des requêtes HTTP:');
        console.log('------------------------');
        await sandbox.runScript(path.join(__dirname, 'server/http_test.js'));

        // 3. Test Python
        console.log('\n3. Test Python:');
        console.log('-------------');
        await sandbox.runScript(path.join(__dirname, 'server/test.py'));

        console.log('\n✅ Tous les tests terminés');
    } catch (error) {
        console.error('\n❌ Erreur lors des tests:', error);
    }
}

// Lancer les tests
runTests(); 