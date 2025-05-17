const https = require('https');
const http = require('http');

console.log('Test des requêtes HTTP en Node.js:');

// Test avec le module http natif
function testNativeHttp() {
    console.log('\n1. Test avec http.get:');
    const req = http.get('http://example.com', (res) => {
        console.log('✓ Status:', res.statusCode);
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('✓ Données reçues:', data);
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
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('✓ Données reçues:', data);
            testHttpPost();
        });
    });

    req.on('error', (error) => {
        console.log('✓ Erreur capturée:', error.message);
        testHttpPost();
    });

    req.end();
}

// Test avec une requête POST
function testHttpPost() {
    console.log('\n3. Test avec http.request (POST):');
    const postData = JSON.stringify({
        title: 'Test Post',
        body: 'Contenu du test'
    });

    const options = {
        hostname: 'jsonplaceholder.typicode.com',
        path: '/posts',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = http.request(options, (res) => {
        console.log('✓ Status:', res.statusCode);
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            console.log('✓ Données reçues:', data);
            testFetch();
        });
    });

    req.on('error', (error) => {
        console.log('✓ Erreur capturée:', error.message);
        testFetch();
    });

    req.write(postData);
    req.end();
}

// Test avec fetch API
async function testFetch() {
    console.log('\n4. Test avec fetch:');
    
    // Test GET
    try {
        const response = await fetch('https://jsonplaceholder.typicode.com/posts/1');
        console.log('✓ Status GET:', response.status);
        const data = await response.json();
        console.log('✓ Données GET reçues:', data);
    } catch (error) {
        console.log('✓ Erreur GET capturée:', error.message);
    }

    // Test POST
    try {
        const response = await fetch('https://jsonplaceholder.typicode.com/posts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: 'Test Fetch Post',
                body: 'Contenu du test fetch'
            })
        });
        console.log('✓ Status POST:', response.status);
        const data = await response.json();
        console.log('✓ Données POST reçues:', data);
    } catch (error) {
        console.log('✓ Erreur POST capturée:', error.message);
    }
}

// Démarrer les tests
testNativeHttp(); 