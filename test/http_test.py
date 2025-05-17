import urllib.request
import urllib.error
import http.client
import json

print('Test des requêtes HTTP en Python:')

def test_urllib():
    print('\n1. Test avec urllib:')
    try:
        with urllib.request.urlopen('http://example.com') as response:
            print('✓ Status:', response.status)
            data = response.read().decode('utf-8')
            print('✓ Données reçues:', data)
    except urllib.error.URLError as e:
        print('✓ Erreur capturée:', str(e))
    except Exception as e:
        print('✓ Autre erreur:', str(e))

def test_http_client():
    print('\n2. Test avec http.client:')
    try:
        conn = http.client.HTTPSConnection('api.github.com')
        conn.request('GET', '/users/octocat', headers={'User-Agent': 'Python Test'})
        response = conn.getresponse()
        print('✓ Status:', response.status)
        data = response.read().decode('utf-8')
        print('✓ Données reçues:', data)
        conn.close()
    except Exception as e:
        print('✓ Erreur capturée:', str(e))

def test_post_request():
    print('\n3. Test avec http.client (POST):')
    try:
        conn = http.client.HTTPConnection('jsonplaceholder.typicode.com')
        headers = {'Content-type': 'application/json'}
        data = json.dumps({
            'title': 'Test Post Python',
            'body': 'Contenu du test python'
        })
        conn.request('POST', '/posts', data, headers)
        response = conn.getresponse()
        print('✓ Status:', response.status)
        data = response.read().decode('utf-8')
        print('✓ Données reçues:', data)
        conn.close()
    except Exception as e:
        print('✓ Erreur capturée:', str(e))

# Exécuter les tests
try:
    test_urllib()
    test_http_client()
    test_post_request()
except Exception as e:
    print('❌ Erreur globale:', str(e)) 