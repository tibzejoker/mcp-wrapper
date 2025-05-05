const fs = require('fs');
const path = require('path');
const { Sandbox } = require('./sandbox');

// S'assurer que le dossier C:\mount existe
const mountPath = 'C:\\mount';
if (!fs.existsSync(mountPath)) {
    fs.mkdirSync(mountPath, { recursive: true });
}

// Chemins vers les scripts
const nodeScript = path.resolve(__dirname, '..', 'server', 'index.js');
const pythonScript = path.resolve(__dirname, '..', 'server', 'test.py');

// Variables d'environnement personnalisées pour les scripts
const customEnv = {
    APP_ENV: 'sandbox',
    CUSTOM_VAR: 'test_value',
    SERVER_ID: '12345'
};

async function runTests() {
    console.log('Wrapper: Démarrage des tests...');
    console.log('Variables d\'environnement injectées:', customEnv);

    try {
        const sandbox = new Sandbox(mountPath, customEnv);

        console.log('\n=== Test du script Node.js ===');
        await sandbox.runScript(nodeScript);
        
        console.log('\n=== Test du script Python ===');
        await sandbox.runScript(pythonScript);
       
    } catch (error) {
        console.error('Wrapper: Erreur lors de l\'exécution:', error.message);
        process.exit(1);
    }
}

runTests(); 