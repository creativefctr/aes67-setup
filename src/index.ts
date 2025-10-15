#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import path from "path";
import fs from "fs-extra";
import inquirer from "inquirer";
import { execCommandSafe } from "./utils/exec.js";

import { loadConfig, saveConfig, getDefaultConfigPath } from "./config.js";
import { promptForSoundCard } from "./soundcard.js";
import { runRuntimeLoop } from "./runtime.js";
import { Aes67DeviceConfig, RuntimeOptions } from "./types.js";
import { Logger } from "./utils/logger.js";

const pkgUrl = new URL("../package.json", import.meta.url);
const pkg = fs.readJSONSync(pkgUrl);

const validateNetworkInterface = async (interfaceName: string): Promise<boolean> => {
  try {
    const { stdout } = await execCommandSafe("ip link show");
    const interfaces = stdout.split("\n").filter((line) => line.match(/^\d+:\s+(\w+):/));
    return interfaces.some((line) => line.includes(`${interfaceName}:`));
  } catch (error) {
    // If ip command fails, just accept the input
    return true;
  }
};

const createProgram = (): Command => {
  const program = new Command();

  program
    .name("aes67-setup")
    .description("CLI tool to simplify multichannel AES67 playback setup on Raspberry Pi 5 with PipeWire")
    .version(pkg.version)
    .option("-c, --config <path>", "Path to configuration file", "")
    .option("-v, --verbose", "Enable verbose logging", false)
    .action(async (options: RuntimeOptions) => {
      const logger = new Logger(options.verbose);
      const cwd = process.cwd();
      const configPath = options.config ? path.resolve(options.config) : getDefaultConfigPath(cwd);

      logger.verboseLog(`Using configuration file: ${configPath}`);

      let config = await loadConfig(configPath);

      if (!config) {
        logger.warn("No configuration found. Starting initial setup.");
        config = await handleInitialSetup(configPath, logger);
      }

      await runRuntimeLoop(config, logger);
    });

  return program;
};

const handleInitialSetup = async (configPath: string, logger: Logger): Promise<Aes67DeviceConfig> => {
  const soundCard = await promptForSoundCard();

  logger.verboseLog(`Selected sound card ${soundCard.name} (${soundCard.id})`);

  // First, get the channel count
  const { channelCount } = await inquirer.prompt<{ channelCount: number }>([
    {
      type: "number",
      name: "channelCount",
      message: "How many playback channels should be configured?",
      default: soundCard.channels,
      validate: (input: number) => (input > 0 ? true : "Channel count must be greater than 0"),
    },
  ]);

  // Then get the rest of the configuration
  const answers = await inquirer.prompt<{
    channelNames: string[];
    samplingRate: number;
    multicastAddress: string;
    sdpFilePath: string;
    networkInterface: string;
    ptpDomain: number;
    rtpDestinationPort: number;
    sessionName: string;
  }>([
    {
      type: "input",
      name: "channelNames",
      message: `Provide ${channelCount} comma-separated channel names (in order):`,
      filter: (input: string) => input.split(",").map((name) => name.trim()).filter(Boolean),
      validate: (input: string[]) => {
        if (!Array.isArray(input) || input.length === 0) {
          return "At least one channel name is required";
        }
        if (input.length !== channelCount) {
          return `Expected ${channelCount} channel names but got ${input.length}. Please provide exactly ${channelCount} names.`;
        }
        return true;
      },
    },
    {
      type: "number",
      name: "samplingRate",
      message: "Sampling rate (Hz):",
      default: 48000,
      validate: (input: number) => (input > 0 ? true : "Sampling rate must be positive"),
    },
    {
      type: "input",
      name: "multicastAddress",
      message: "Multicast address for AES67 stream:",
      default: "239.255.0.1",
      validate: (input: string) =>
        /^((22[4-9])|(23[0-9]))\.((25[0-5])|([01]?\d?\d))\.((25[0-5])|([01]?\d?\d))\.((25[0-5])|([01]?\d?\d))$/.test(input)
          ? true
          : "Enter a valid multicast IPv4 address",
    },
    {
      type: "input",
      name: "sdpFilePath",
      message: "Path to SDP file for AES67 stream:",
      default: "/etc/aes67/aes67.sdp",
      validate: async (input: string) => {
        if (input.trim().length === 0) {
          return "SDP file path cannot be empty";
        }
        const exists = await fs.pathExists(input.trim());
        if (!exists) {
          return `Warning: SDP file does not exist at '${input}'. Please ensure it will be available before starting runtime.`;
        }
        return true;
      },
    },
    {
      type: "input",
      name: "networkInterface",
      message: "Network interface name for AES67 traffic (e.g., eth0):",
      default: "eth0",
      validate: async (input: string) => {
        if (input.trim().length === 0) {
          return "Interface name cannot be empty";
        }
        const isValid = await validateNetworkInterface(input.trim());
        if (!isValid) {
          return `Warning: Network interface '${input}' not found on system. Please verify the interface name.`;
        }
        return true;
      },
    },
    {
      type: "number",
      name: "ptpDomain",
      message: "PTP domain number:",
      default: 0,
      validate: (input: number) => (input >= 0 && input <= 127 ? true : "PTP domain must be between 0 and 127"),
    },
    {
      type: "number",
      name: "rtpDestinationPort",
      message: "RTP destination port:",
      default: 5004,
      validate: (input: number) => (input >= 1024 && input <= 65535 ? true : "Port must be between 1024 and 65535"),
    },
    {
      type: "input",
      name: "sessionName",
      message: "Session name for logging/identification:",
      default: "AES67 Playback",
      validate: (input: string) => (input.trim().length > 0 ? true : "Session name cannot be empty"),
    },
  ]);

  const config: Aes67DeviceConfig = {
    soundCardId: soundCard.id,
    soundCardName: soundCard.name,
    channelCount,
    channelNames: answers.channelNames,
    samplingRate: answers.samplingRate,
    multicastAddress: answers.multicastAddress,
    sdpFilePath: answers.sdpFilePath,
    networkInterface: answers.networkInterface,
    ptpDomain: answers.ptpDomain,
    rtpDestinationPort: answers.rtpDestinationPort,
    sessionName: answers.sessionName,
    lastUpdated: new Date().toISOString(),
  };

  await saveConfig(configPath, config);

  logger.info(`Configuration saved to ${configPath}`);

  return config;
};

const program = createProgram();

program.parseAsync(process.argv).catch((error) => {
  console.error(chalk.red(`Error: ${error.message}`));
  process.exit(1);
});

