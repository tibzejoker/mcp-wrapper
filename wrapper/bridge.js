export class Bridge {
    constructor() {
        // Handlers pour les différents événements
        this.handlers = {
            // Requêtes réseau
            fetch: new Set(),          // Requêtes HTTP/HTTPS
            connect: new Set(),        // Connexions TCP/UDP
            dns: new Set(),            // Résolutions DNS

            // Système de fichiers
            fileRead: new Set(),       // Lecture de fichiers
            fileWrite: new Set(),      // Écriture de fichiers
            fileDelete: new Set(),     // Suppression de fichiers
            
            // Entrées/Sorties
            stdout: new Set(),         // Sortie standard
            stderr: new Set(),         // Sortie d'erreur
            stdin: new Set(),          // Entrée standard
            
            // Processus
            spawn: new Set(),          // Création de processus
            env: new Set(),            // Accès aux variables d'environnement
            
            // Modules
            import: new Set(),         // Import/require de modules
            
            // Erreurs et événements système
            error: new Set(),          // Erreurs générales
            exit: new Set()            // Sortie du processus
        };
    }

    // Méthodes pour ajouter des handlers
    onFetch(handler) {
        this.handlers.fetch.add(handler);
        return this; // Pour le chaînage
    }

    onConnect(handler) {
        this.handlers.connect.add(handler);
        return this;
    }

    onDns(handler) {
        this.handlers.dns.add(handler);
        return this;
    }

    onFileRead(handler) {
        this.handlers.fileRead.add(handler);
        return this;
    }

    onFileWrite(handler) {
        this.handlers.fileWrite.add(handler);
        return this;
    }

    onFileDelete(handler) {
        this.handlers.fileDelete.add(handler);
        return this;
    }

    onStdout(handler) {
        this.handlers.stdout.add(handler);
        return this;
    }

    onStderr(handler) {
        this.handlers.stderr.add(handler);
        return this;
    }

    onStdin(handler) {
        this.handlers.stdin.add(handler);
        return this;
    }

    onSpawn(handler) {
        this.handlers.spawn.add(handler);
        return this;
    }

    onEnv(handler) {
        this.handlers.env.add(handler);
        return this;
    }

    onImport(handler) {
        this.handlers.import.add(handler);
        return this;
    }

    onError(handler) {
        this.handlers.error.add(handler);
        return this;
    }

    onExit(handler) {
        this.handlers.exit.add(handler);
        return this;
    }

    // Méthodes pour émettre des événements
    async emit(eventName, data) {
        if (!this.handlers[eventName]) {
            throw new Error(`Event "${eventName}" not supported`);
        }

        const results = [];
        for (const handler of this.handlers[eventName]) {
            try {
                const result = await handler(data);
                results.push(result);
            } catch (error) {
                this.emit('error', { source: eventName, error });
            }
        }
        return results;
    }

    // Méthodes utilitaires pour les handlers par défaut
    async handleFetch(request) {
        const results = await this.emit('fetch', request);
        // Si au moins un handler retourne false, bloquer la requête
        return !results.includes(false);
    }

    async handleFileAccess(type, path, options = {}) {
        const results = await this.emit(type, { path, options });
        return !results.includes(false);
    }

    async handleProcess(command, args, options = {}) {
        const results = await this.emit('spawn', { command, args, options });
        return !results.includes(false);
    }

    log(message, type = 'stdout') {
        this.emit(type, { message });
    }
} 