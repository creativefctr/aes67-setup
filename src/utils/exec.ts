import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export class ExecError extends Error {
  public readonly command: string;
  public readonly code: number | null;
  public readonly stdout: string;
  public readonly stderr: string;

  constructor(command: string, code: number | null, stdout: string, stderr: string) {
    super(`Command failed (${command})`);
    this.command = command;
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export const execCommand = async (command: string): Promise<ExecResult> => {
  const { stdout, stderr } = await execAsync(command, { encoding: "utf-8" });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
};

export const execCommandSafe = async (command: string): Promise<ExecResult> => {
  try {
    return await execCommand(command);
  } catch (error) {
    const { stdout = "", stderr = "", code = null } = error as ExecError as ExecError & {
      stdout?: string;
      stderr?: string;
      code?: number | null;
    };
    throw new ExecError(command, code, stdout, stderr);
  }
};

