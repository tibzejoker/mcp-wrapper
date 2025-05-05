import os
import sys

print('Test des variables d\'environnement en Python:')

# Test des variables d'environnement
print('\n1. Variables d\'environnement:')
print('- APP_ENV:', os.environ.get('APP_ENV'))
print('- CUSTOM_VAR:', os.environ.get('CUSTOM_VAR'))
print('- SERVER_ID:', os.environ.get('SERVER_ID'))
print('- SANDBOX_ROOT:', os.environ.get('SANDBOX_ROOT'))
print('- SCRIPT_TYPE:', os.environ.get('SCRIPT_TYPE'))

# Test des chemins
print('\n2. Chemins:')
print('- Dossier actuel:', os.getcwd())
print('- Dossier absolu:', os.path.abspath('.'))
print('- PYTHONPATH:', os.environ.get('PYTHONPATH'))

# Test des opérations sur les fichiers
print('\n3. Test des opérations fichiers:')
try:
    # Créer un fichier
    with open('/test.txt', 'w') as f:
        f.write('Test de fichier Python')
    print('✓ Création de fichier réussie')

    # Lire le fichier
    with open('/test.txt', 'r') as f:
        content = f.read()
    print('✓ Lecture de fichier réussie:', content)

    # Tester l'accès à un fichier hors sandbox
    try:
        with open('/../hors_sandbox.txt', 'r') as f:
            print('❌ Accès non autorisé réussi')
    except Exception as e:
        print('✓ Accès hors sandbox bloqué:', str(e))

    # Supprimer le fichier de test
    os.remove('/test.txt')
    print('✓ Suppression de fichier réussie')
except Exception as e:
    print('❌ Erreur lors des tests fichiers:', str(e))

# Test des modules
print('\n4. Test des modules:')
try:
    import json
    print('✓ Module json chargé')
    import urllib
    print('✓ Module urllib chargé')
except Exception as e:
    print('❌ Erreur lors du chargement des modules:', str(e)) 