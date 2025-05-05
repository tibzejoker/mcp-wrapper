const { Sandbox } = require('./sandbox');
const path = require('path');

// Variables d'environnement pour les tests
const envVars = {
    APP_ENV: 'sandbox',
    CUSTOM_VAR: 'test123',
    SERVER_ID: 'sandbox-001'
};

// Obtenir le chemin absolu du dossier racine du projet
const projectRoot = path.resolve(__dirname, '..');

// Créer une instance de la sandbox avec C:\mount comme racine
const sandbox = new Sandbox('C:\\mount', envVars);

console.log('=== Test de la sandbox ===\n');

// Fonction pour exécuter les tests séquentiellement
async function runTests() {
    try {
        console.log('1. Test des opérations fichiers Node.js:');
        console.log('------------------------');
        await sandbox.runScript(path.join(projectRoot, 'server/index.js'));
        
        console.log('\n2. Test des opérations fichiers Python:');
        console.log('------------------------');
        await sandbox.runScript(path.join(projectRoot, 'server/test.py'));

        console.log('\n3. Test des requêtes HTTP Node.js:');
        console.log('------------------------');
        await sandbox.runScript(path.join(projectRoot, 'server/http_test.js'));

        console.log('\n4. Test des requêtes HTTP Python:');
        console.log('------------------------');
        await sandbox.runScript(path.join(projectRoot, 'server/http_test.py'));
        
        console.log('\n✅ Tous les tests sont terminés');
    } catch (error) {
        console.error('\n❌ Erreur lors des tests:', error.message);
    }
}

// Créer le dossier C:\mount s'il n'existe pas
const fs = require('fs');
if (!fs.existsSync('C:\\mount')) {
    try {
        fs.mkdirSync('C:\\mount');
    } catch (error) {
        console.error('❌ Erreur: Impossible de créer C:\\mount. Assurez-vous d\'avoir les droits administrateur.');
        process.exit(1);
    }
}

// Lancer les tests
runTests(); 