import { spawn } from "child_process";
const noop = async () => { };
const createProcessHandle = (child, logger, description) => {
    const stop = async () => {
        if (!child.killed) {
            logger.verboseLog(`Stopping ${description} (pid: ${child.pid ?? "unknown"})`);
            child.kill();
        }
    };
    if (child.stdout) {
        child.stdout.setEncoding("utf-8");
        child.stdout.on("data", (data) => {
            logger.verboseLog(`${description} stdout: ${data.trim()}`);
        });
    }
    if (child.stderr) {
        child.stderr.setEncoding("utf-8");
        child.stderr.on("data", (data) => {
            logger.warn(`${description} stderr: ${data.trim()}`);
        });
    }
    child.on("exit", (code, signal) => {
        logger.verboseLog(`${description} exited with code ${code} signal ${signal ?? "none"}`);
    });
    return { stop };
};
export const spawnLongRunning = (command, args, options = {}, logger, description) => {
    logger.verboseLog(`Spawning ${description}: ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
    });
    if (!child.pid) {
        logger.error(`Failed to start ${description}`);
        return { stop: noop };
    }
    logger.verboseLog(`${description} started with pid ${child.pid}`);
    return createProcessHandle(child, logger, description);
};
