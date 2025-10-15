import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
export class ExecError extends Error {
    command;
    code;
    stdout;
    stderr;
    constructor(command, code, stdout, stderr) {
        super(`Command failed (${command})`);
        this.command = command;
        this.code = code;
        this.stdout = stdout;
        this.stderr = stderr;
    }
}
export const execCommand = async (command) => {
    const { stdout, stderr } = await execAsync(command, { encoding: "utf-8" });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
};
export const execCommandSafe = async (command) => {
    try {
        return await execCommand(command);
    }
    catch (error) {
        const { stdout = "", stderr = "", code = null } = error;
        throw new ExecError(command, code, stdout, stderr);
    }
};
