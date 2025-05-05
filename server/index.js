const fs = require('fs');
const path = require('path');

// Collecter les variables d'environnement et informations système
const envVars = {
    APP_ENV: process.env.APP_ENV || '',
    CUSTOM_VAR: process.env.CUSTOM_VAR || '',
    SERVER_ID: process.env.SERVER_ID || '',
    SANDBOX_ROOT: process.env.SANDBOX_ROOT || '',
    SCRIPT_TYPE: 'Node.js',
    CWD: process.cwd(),
    DIRNAME: __dirname,
    FILENAME: __filename
};

console.log('Script Node.js démarré dans la sandbox');
console.log('Informations système:');
console.log('- Dossier actuel:', process.cwd());
console.log('- __dirname:', __dirname);
console.log('- __filename:', __filename);

// Test de création de fichiers
console.log('\nTest de création de fichiers:');
try {
    // Créer un fichier à la racine
    fs.writeFileSync('/node_test.txt', JSON.stringify(envVars, null, 2), 'utf8');
    console.log('✅ Écriture dans /node_test.txt réussie');
    
    // Tenter d'accéder à un dossier parent
    try {
        fs.readFileSync('../outside.txt');
        console.log('⚠️ ATTENTION: Accès ../ possible!');
    } catch (error) {
        console.log('✅ Accès ../ bloqué:', error.message);
    }
    
    try {
        fs.readFileSync('/../../outside.txt');
        console.log('⚠️ ATTENTION: Accès /../../ possible!');
    } catch (error) {
        console.log('✅ Accès /../../ bloqué:', error.message);
    }
} catch (error) {
    console.error('❌ Erreur lors des tests:', error.message);
}

// Afficher les variables pour vérification
console.log('\nVariables d\'environnement et système:');
Object.entries(envVars).forEach(([key, value]) => {
    console.log(`- ${key}: ${value || '(non défini)'}`);
}); 