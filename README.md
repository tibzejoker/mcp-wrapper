# MCP Wrapper

Une sandbox sécurisée pour l'exécution de scripts Node.js et Python avec isolation du système de fichiers.

## Fonctionnalités

- Isolation complète du système de fichiers
- Support multi-langage (Node.js et Python)
- Variables d'environnement personnalisables
- Virtualisation des chemins (conversion des chemins système en chemins virtuels)
- Prévention des accès hors sandbox
- Blocage des accès réseau non autorisés

## Installation

```bash
npm install
```

## Utilisation

Pour lancer les tests :
```bash
npm run start
```

## Structure du projet

- `/server` : Code du serveur principal
- `/wrapper` : Code de la sandbox et des wrappers
- `/mount` : Point de montage virtuel pour les scripts

## Sécurité

- Isolation complète du système de fichiers
- Virtualisation des chemins (les scripts voient "/" comme racine)
- Blocage des accès réseau
- Variables d'environnement contrôlées

## Tests

Le projet inclut des tests pour :
- Opérations sur les fichiers en Node.js
- Opérations sur les fichiers en Python
- Tests des restrictions de sécurité
- Tests des requêtes HTTP 