import { spawn, ChildProcess } from "child_process";
import { Logger } from "./utils/logger.js";
import { ManagedProcessHandle } from "./types.js";

const noop = async (): Promise<void> => {};

const createProcessHandle = (
  child: ChildProcess,
  logger: Logger,
  description: string,
  onExit?: (code: number | null) => void,
): ManagedProcessHandle => {
  const stop = async (): Promise<void> => {
    if (!child.killed) {
      logger.verboseLog(`Stopping ${description} (pid: ${child.pid ?? "unknown"})`);
      child.kill();
    }
  };

  if (child.stdout) {
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (data) => {
      // Show stdout output (pipeline status messages) at info level
      const lines = data.trim().split('\n');
      for (const line of lines) {
        if (line) {
          logger.info(`[${description}] ${line}`);
        }
      }
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (data) => {
      // Show stderr output (warnings/errors) at warn level
      const lines = data.trim().split('\n');
      for (const line of lines) {
        if (line) {
          logger.warn(`[${description}] ${line}`);
        }
      }
    });
  }

  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      logger.error(`${description} exited unexpectedly with code ${code} signal ${signal ?? "none"}`);
    } else {
      logger.verboseLog(`${description} exited with code ${code} signal ${signal ?? "none"}`);
    }
    
    if (onExit) {
      onExit(code);
    }
  });

  return { stop };
};

export const spawnLongRunning = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  logger: Logger,
  description: string,
  onExit?: (code: number | null) => void,
): ManagedProcessHandle => {
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

  return createProcessHandle(child, logger, description, onExit);
};

