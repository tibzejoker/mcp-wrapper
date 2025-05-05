const https = require('https');
const http = require('http');

console.log('Test des requêtes HTTP en Node.js:');

// Test avec le module http natif
function testNativeHttp() {
    console.log('\n1. Test avec http.get:');
    const req = http.get('http://example.com', (res) => {
        console.log('✓ Status:', res.statusCode);
        res.on('data', () => {});
        res.on('end', () => {
            testHttpsRequest();
        });
    });

    req.on('error', (error) => {
        console.log('✓ Erreur capturée:', error.message);
        testHttpsRequest();
    });
}

// Test avec https
function testHttpsRequest() {
    console.log('\n2. Test avec https.request:');
    const options = {
        hostname: 'api.github.com',
        path: '/users/octocat',
        method: 'GET',
        headers: {
            'User-Agent': 'Node.js Test'
        }
    };

    const req = https.request(options, (res) => {
        console.log('✓ Status:', res.statusCode);
        res.on('data', () => {});
        res.on('end', () => {
            testFetch();
        });
    });

    req.on('error', (error) => {
        console.log('✓ Erreur capturée:', error.message);
        testFetch();
    });

    req.end();
}

// Test avec fetch API
async function testFetch() {
    console.log('\n3. Test avec fetch:');
    try {
        const response = await fetch('https://jsonplaceholder.typicode.com/posts/1');
        console.log('✓ Status:', response.status);
    } catch (error) {
        console.log('✓ Erreur capturée:', error.message);
    }
}

// Démarrer les tests
testNativeHttp(); 