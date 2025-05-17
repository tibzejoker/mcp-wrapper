console.log('Test des variables d\'environnement en Node.js:');

// Test des variables d'environnement
console.log('\n1. Variables d\'environnement:');
console.log('- APP_ENV:', process.env.APP_ENV);
console.log('- CUSTOM_VAR:', process.env.CUSTOM_VAR);
console.log('- SERVER_ID:', process.env.SERVER_ID);
console.log('- SANDBOX_ROOT:', process.env.SANDBOX_ROOT);
console.log('- SCRIPT_TYPE:', process.env.SCRIPT_TYPE);

// Test des chemins
console.log('\n2. Chemins:');
console.log('- process.cwd():', process.cwd());
console.log('- __dirname:', __dirname);
console.log('- __filename:', __filename);

// Test des opérations sur les fichiers
console.log('\n3. Test des opérations fichiers:');
const fs = require('fs');
const path = require('path');

try {
    // Créer un fichier
    fs.writeFileSync('/test.txt', 'Test de fichier');
    console.log('✓ Création de fichier réussie');

    // Lire le fichier
    const content = fs.readFileSync('/test.txt', 'utf8');
    console.log('✓ Lecture de fichier réussie:', content);

    // Tester l'accès à un fichier hors sandbox
    try {
        fs.readFileSync('/../hors_sandbox.txt');
        console.log('❌ Accès non autorisé réussi');
    } catch (error) {
        console.log('✓ Accès hors sandbox bloqué:', error.message);
    }

    // Supprimer le fichier de test
    fs.unlinkSync('/test.txt');
    console.log('✓ Suppression de fichier réussie');
} catch (error) {
    console.error('❌ Erreur lors des tests fichiers:', error.message);
}

// Test des modules
console.log('\n4. Test des modules:');
try {
    require('fs');
    console.log('✓ Module fs chargé');
    require('path');
    console.log('✓ Module path chargé');
} catch (error) {
    console.error('❌ Erreur lors du chargement des modules:', error.message);
} 