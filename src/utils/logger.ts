import chalk from "chalk";

export class Logger {
  private readonly verbose: boolean;

  constructor(verbose: boolean) {
    this.verbose = verbose;
  }

  info(message: string): void {
    console.log(chalk.cyan(`[INFO] ${message}`));
  }

  warn(message: string): void {
    console.warn(chalk.yellow(`[WARN] ${message}`));
  }

  error(message: string): void {
    console.error(chalk.red(`[ERROR] ${message}`));
  }

  verboseLog(message: string): void {
    if (this.verbose) {
      console.log(chalk.gray(`[VERBOSE] ${message}`));
    }
  }
}

