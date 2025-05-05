import os
import sys
import json

print("Script Python démarré dans la sandbox")
print("Informations système:")
print(f"- Dossier actuel: {os.getcwd()}")
print(f"- Dossier absolu: {os.path.abspath('.')}")
print(f"- PYTHONPATH: {os.getenv('PYTHONPATH')}")

# Collecter les variables d'environnement et informations système
env_vars = {
    'APP_ENV': os.getenv('APP_ENV'),
    'CUSTOM_VAR': os.getenv('CUSTOM_VAR'),
    'SERVER_ID': os.getenv('SERVER_ID'),
    'SANDBOX_ROOT': os.getenv('SANDBOX_ROOT'),
    'SCRIPT_TYPE': 'Python',
    'CWD': os.getcwd(),
    'ABS_PATH': os.path.abspath('.'),
    'REAL_PATH': os.path.realpath('.')
}

# Test de création de fichiers
print("\nTest de création de fichiers:")
try:
    # Créer un fichier à la racine
    with open('/python_test.txt', 'w', encoding='utf-8') as f:
        json.dump(env_vars, f, indent=2, ensure_ascii=False)
    print("✅ Écriture dans /python_test.txt réussie")
    
    # Tenter d'accéder à un dossier parent
    try:
        with open('../outside.txt') as f:
            print("⚠️ ATTENTION: Accès ../ possible!")
    except Exception as e:
        print(f"✅ Accès ../ bloqué: {str(e)}")
    
    try:
        with open('/../../outside.txt') as f:
            print("⚠️ ATTENTION: Accès /../../ possible!")
    except Exception as e:
        print(f"✅ Accès /../../ bloqué: {str(e)}")
        
except Exception as e:
    print(f"❌ Erreur lors des tests: {str(e)}")

# Afficher les variables pour vérification
print("\nVariables d'environnement et système:")
for key, value in env_vars.items():
    print(f"- {key}: {value or '(non défini)'}") 