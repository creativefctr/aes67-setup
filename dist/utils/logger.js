import chalk from "chalk";
export class Logger {
    verbose;
    constructor(verbose) {
        this.verbose = verbose;
    }
    info(message) {
        console.log(chalk.cyan(`[INFO] ${message}`));
    }
    warn(message) {
        console.warn(chalk.yellow(`[WARN] ${message}`));
    }
    error(message) {
        console.error(chalk.red(`[ERROR] ${message}`));
    }
    verboseLog(message) {
        if (this.verbose) {
            console.log(chalk.gray(`[VERBOSE] ${message}`));
        }
    }
}
