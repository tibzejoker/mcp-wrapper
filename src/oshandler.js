import { execSync as execSyncImport } from 'child_process';

// OSHandler Class Definition
class OSHandler {
    constructor() {
        this.platform = process.platform;
    }

    async killProcessTree(pid) {
        console.log(`[OSHandler] Attempting to kill process tree for PID: ${pid} on platform: ${this.platform}`);
        try {
            if (this.platform === "win32") {
                // Windows-specific process killing
                console.log(`[OSHandler] Using Windows-specific kill command for PID: ${pid}`);
                const wmicCmd = `wmic process where (ParentProcessId=${pid}) get ProcessId`;
                console.log(`[OSHandler] WMIC command: ${wmicCmd}`);
                const childPidsOutput = execSyncImport(wmicCmd).toString();
                const childPids = childPidsOutput
                    .split('\n')
                    .slice(1)
                    .map(line => line.trim())
                    .filter(id => id && !isNaN(id)); // Ensure it's a number

                console.log(`[OSHandler] Child PIDs found:`, childPids);

                for (const childPid of childPids) {
                    try {
                        const killCmd = `taskkill /F /T /PID ${childPid}`;
                        console.log(`[OSHandler] Killing child process: ${killCmd}`);
                        execSyncImport(killCmd);
                    } catch (e) {
                        console.error(`[OSHandler] Error killing child PID ${childPid}:`, e.message);
                    }
                }

                const parentKillCmd = `taskkill /F /T /PID ${pid}`;
                console.log(`[OSHandler] Killing parent process: ${parentKillCmd}`);
                execSyncImport(parentKillCmd);
                console.log(`[OSHandler] Successfully killed process tree for PID: ${pid} on Windows.`);

            } else if (this.platform === "linux" || this.platform === "darwin") {
                // Linux/macOS specific process killing (using pkill or kill)
                console.log(`[OSHandler] Using Unix-like kill command for PID: ${pid}`);
                // First, try to kill the entire process group. This often gets children.
                // The '-' before pid signifies process group ID.
                try {
                    // Send SIGTERM to the process group
                    console.log(`[OSHandler] Attempting to kill process group ${pid} with SIGTERM.`);
                    execSyncImport(`kill -TERM -${pid}`);
                    await new Promise(resolve => setTimeout(resolve, 100)); // Give it a moment
                    // Send SIGKILL to the process group if still alive
                    console.log(`[OSHandler] Attempting to kill process group ${pid} with SIGKILL.`);
                    execSyncImport(`kill -KILL -${pid}`);
                } catch (pgError) {
                    console.warn(`[OSHandler] Killing process group -${pid} failed (this is sometimes expected if it died quickly or not a group leader): ${pgError.message}. Will attempt to kill PID ${pid} directly.`);
                    // If killing the group fails (e.g., not a group leader), kill the main PID.
                    // Children might become orphaned, but this is a fallback.
                    execSyncImport(`kill -9 ${pid}`);
                }
                console.log(`[OSHandler] Successfully sent kill signals to process tree for PID: ${pid} on ${this.platform}.`);
            } else {
                console.warn(`[OSHandler] Unsupported platform: ${this.platform}. Process killing might not be complete.`);
                // Fallback or generic kill if any (might not kill children)
                if (typeof process.kill === 'function') {
                    process.kill(pid, 'SIGKILL');
                }
            }
        } catch (error) {
            console.error(`[OSHandler] Error during process tree kill for PID ${pid}:`, error);
            // Rethrow or handle as appropriate for your application
            throw error;
        }
    }
}

export { OSHandler }; 