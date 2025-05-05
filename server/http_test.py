import urllib.request
import urllib.error
import http.client
import requests  # Cette importation devrait être bloquée

print('Test des requêtes HTTP en Python:')

def test_urllib():
    print('\n1. Test avec urllib:')
    try:
        with urllib.request.urlopen('http://example.com') as response:
            print('✓ Status:', response.status)
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
        conn.close()
    except Exception as e:
        print('✓ Erreur capturée:', str(e))

def test_requests():
    print('\n3. Test avec requests:')
    try:
        response = requests.get('https://jsonplaceholder.typicode.com/posts/1')
        print('✓ Status:', response.status_code)
    except Exception as e:
        print('✓ Erreur capturée:', str(e))

# Exécuter les tests
test_urllib()
test_http_client()
test_requests() 