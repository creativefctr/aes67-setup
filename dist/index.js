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
import { Logger } from "./utils/logger.js";
const pkgUrl = new URL("../package.json", import.meta.url);
const pkg = fs.readJSONSync(pkgUrl);
const validateNetworkInterface = async (interfaceName) => {
    try {
        const { stdout } = await execCommandSafe("ip link show");
        const interfaces = stdout.split("\n").filter((line) => line.match(/^\d+:\s+(\w+):/));
        return interfaces.some((line) => line.includes(`${interfaceName}:`));
    }
    catch (error) {
        // If ip command fails, just accept the input
        return true;
    }
};
const getWindowsNetworkInterfaces = async () => {
    try {
        const { stdout } = await execCommandSafe("wmic path win32_networkadapter get name,netconnectionstatus /format:csv");
        const lines = stdout.split("\n").filter(line => line.trim() && !line.startsWith("Node"));
        const interfaces = [];
        for (const line of lines) {
            const parts = line.split(",");
            if (parts.length >= 3) {
                const name = parts[1]?.trim();
                const statusCode = parts[2]?.trim();
                if (name && name !== "Name" && name.length > 0) {
                    // Filter out virtual adapters and miniports that aren't useful for AES67
                    const isVirtualAdapter = name.includes("Virtual") ||
                        name.includes("Miniport") ||
                        name.includes("TAP-") ||
                        name.includes("Tunnel") ||
                        name.includes("Debug") ||
                        name.includes("Hyper-V") ||
                        name.includes("Bluetooth") ||
                        name.includes("Wi-Fi Direct");
                    if (!isVirtualAdapter) {
                        let status = "Unknown";
                        switch (statusCode) {
                            case "2":
                                status = "Connected";
                                break;
                            case "7":
                                status = "Disconnected";
                                break;
                            case "0":
                                status = "Disconnected";
                                break;
                            case "":
                                status = "Unknown";
                                break;
                            default:
                                status = `Status ${statusCode}`;
                                break;
                        }
                        interfaces.push({
                            name,
                            description: name,
                            status
                        });
                    }
                }
            }
        }
        return interfaces;
    }
    catch (error) {
        // Fallback to PowerShell if wmic fails
        try {
            const { stdout } = await execCommandSafe('powershell "Get-NetAdapter | Where-Object {$_.InterfaceDescription -notlike \'*Virtual*\' -and $_.InterfaceDescription -notlike \'*Miniport*\' -and $_.InterfaceDescription -notlike \'*TAP*\' -and $_.InterfaceDescription -notlike \'*Tunnel*\' -and $_.InterfaceDescription -notlike \'*Debug*\' -and $_.InterfaceDescription -notlike \'*Hyper-V*\' -and $_.InterfaceDescription -notlike \'*Bluetooth*\' -and $_.InterfaceDescription -notlike \'*Wi-Fi Direct*\'} | Select-Object Name,InterfaceDescription,Status | ConvertTo-Csv -NoTypeInformation"');
            const lines = stdout.split("\n").filter(line => line.trim() && !line.startsWith("\"Name\""));
            const interfaces = [];
            for (const line of lines) {
                const parts = line.split(",");
                if (parts.length >= 3) {
                    const name = parts[0]?.replace(/"/g, "").trim();
                    const description = parts[1]?.replace(/"/g, "").trim();
                    const status = parts[2]?.replace(/"/g, "").trim();
                    if (name && name !== "Name" && name.length > 0) {
                        interfaces.push({
                            name,
                            description: description || name,
                            status: status || "Unknown"
                        });
                    }
                }
            }
            return interfaces;
        }
        catch (psError) {
            // If both fail, return empty array
            return [];
        }
    }
};
const createProgram = () => {
    const program = new Command();
    program
        .name("aes67-setup")
        .description("CLI tool to simplify multichannel AES67 playback setup on Raspberry Pi 5 with PipeWire")
        .version(pkg.version)
        .option("-c, --config <path>", "Path to configuration file", "")
        .option("-v, --verbose", "Enable verbose logging", false)
        .action(async (options) => {
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
const handleInitialSetup = async (configPath, logger) => {
    // First, ask for device mode
    const { deviceMode } = await inquirer.prompt([
        {
            type: "list",
            name: "deviceMode",
            message: "Is this device being configured as a sender or receiver?",
            choices: [
                {
                    name: "Receiver (receive and play AES67 streams)",
                    value: "receiver",
                },
                {
                    name: "Sender (send audio via AES67 using Gstreamer - Windows only)",
                    value: "sender",
                },
            ],
            default: "receiver",
        },
    ]);
    if (deviceMode === "receiver") {
        return handleReceiverSetup(configPath, logger);
    }
    else {
        return handleSenderSetup(configPath, logger);
    }
};
const handleReceiverSetup = async (configPath, logger) => {
    const soundCard = await promptForSoundCard();
    logger.verboseLog(`Selected sound card ${soundCard.name} (${soundCard.id})`);
    // First, get the channel count
    const { channelCount } = await inquirer.prompt([
        {
            type: "number",
            name: "channelCount",
            message: "How many playback channels should be configured?",
            default: soundCard.channels,
            validate: (input) => (input > 0 ? true : "Channel count must be greater than 0"),
        },
    ]);
    // Then get the rest of the configuration
    const answers = await inquirer.prompt([
        {
            type: "input",
            name: "channelNames",
            message: `Provide ${channelCount} comma-separated channel names (in order):`,
            filter: (input) => input.split(",").map((name) => name.trim()).filter(Boolean),
            validate: (input) => {
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
            validate: (input) => (input > 0 ? true : "Sampling rate must be positive"),
        },
        {
            type: "input",
            name: "multicastAddress",
            message: "Multicast address for AES67 stream:",
            default: "239.255.0.1",
            validate: (input) => /^((22[4-9])|(23[0-9]))\.((25[0-5])|([01]?\d?\d))\.((25[0-5])|([01]?\d?\d))\.((25[0-5])|([01]?\d?\d))$/.test(input)
                ? true
                : "Enter a valid multicast IPv4 address",
        },
        {
            type: "input",
            name: "sdpFilePath",
            message: "Path to SDP file for AES67 stream:",
            default: "/etc/aes67/aes67.sdp",
            validate: async (input) => {
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
            validate: async (input) => {
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
            validate: (input) => (input >= 0 && input <= 127 ? true : "PTP domain must be between 0 and 127"),
        },
        {
            type: "list",
            name: "ptpMode",
            message: "PTP mode - Select the role for this Raspberry Pi:",
            choices: [
                {
                    name: "Slave (sync to external PTP grandmaster)",
                    value: "slave",
                },
                {
                    name: "Grandmaster (act as the PTP clock master for other devices)",
                    value: "grandmaster",
                },
            ],
            default: "slave",
        },
        {
            type: "number",
            name: "rtpDestinationPort",
            message: "RTP destination port:",
            default: 5004,
            validate: (input) => (input >= 1024 && input <= 65535 ? true : "Port must be between 1024 and 65535"),
        },
        {
            type: "input",
            name: "sessionName",
            message: "Session name for logging/identification:",
            default: "AES67 Playback",
            validate: (input) => (input.trim().length > 0 ? true : "Session name cannot be empty"),
        },
    ]);
    const config = {
        deviceMode: "receiver",
        soundCardId: soundCard.id,
        soundCardName: soundCard.name,
        channelCount,
        channelNames: answers.channelNames,
        samplingRate: answers.samplingRate,
        multicastAddress: answers.multicastAddress,
        sdpFilePath: answers.sdpFilePath,
        networkInterface: answers.networkInterface,
        ptpDomain: answers.ptpDomain,
        ptpMode: answers.ptpMode,
        rtpDestinationPort: answers.rtpDestinationPort,
        sessionName: answers.sessionName,
        lastUpdated: new Date().toISOString(),
    };
    await saveConfig(configPath, config);
    logger.info(`Configuration saved to ${configPath}`);
    return config;
};
const handleSenderSetup = async (configPath, logger) => {
    logger.info("Configuring device as AES67 sender (Windows with JACK/ASIO + Gstreamer)");
    // Get sender-specific configuration
    const senderAnswers = await inquirer.prompt([
        {
            type: "list",
            name: "audioSource",
            message: "Select audio source type:",
            choices: [
                {
                    name: "ASIO (recommended for low latency on Windows)",
                    value: "asio",
                },
                {
                    name: "JACK Audio Connection Kit",
                    value: "jack",
                },
            ],
            default: "asio",
        },
        {
            type: "number",
            name: "channelCount",
            message: "Total number of channels to send:",
            default: 16,
            validate: (input) => (input > 0 ? true : "Channel count must be greater than 0"),
        },
        {
            type: "number",
            name: "channelsPerReceiver",
            message: "Channels per receiver (determines number of streams):",
            default: 8,
            validate: (input, answers) => {
                if (input <= 0)
                    return "Channels per receiver must be greater than 0";
                const totalChannels = answers?.channelCount ?? 0;
                if (totalChannels > 0 && input > totalChannels) {
                    return `Channels per receiver cannot exceed total channels (${totalChannels})`;
                }
                return true;
            },
        },
    ]);
    // Get audio source-specific configuration
    let jackClientName;
    let asioDeviceClsid;
    if (senderAnswers.audioSource === "jack") {
        const jackAnswers = await inquirer.prompt([
            {
                type: "input",
                name: "jackClientName",
                message: "JACK client name (the client providing audio channels):",
                default: "AudioSource",
                validate: (input) => (input.trim().length > 0 ? true : "JACK client name cannot be empty"),
            },
        ]);
        jackClientName = jackAnswers.jackClientName;
    }
    else if (senderAnswers.audioSource === "asio") {
        const asioAnswers = await inquirer.prompt([
            {
                type: "input",
                name: "asioDeviceClsid",
                message: "ASIO device CLSID (e.g., {838FE50A-C1AB-4B77-B9B6-0A40788B53F3} for JackRouter):",
                default: "{838FE50A-C1AB-4B77-B9B6-0A40788B53F3}",
                validate: (input) => {
                    if (input.trim().length === 0)
                        return "ASIO device CLSID cannot be empty";
                    if (!/^\{[A-F0-9-]+\}$/i.test(input.trim())) {
                        return "CLSID must be in format {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}";
                    }
                    return true;
                },
            },
        ]);
        asioDeviceClsid = asioAnswers.asioDeviceClsid;
    }
    const numStreams = Math.ceil(senderAnswers.channelCount / senderAnswers.channelsPerReceiver);
    logger.info(`Configuration will create ${numStreams} stream(s) with ${senderAnswers.channelsPerReceiver} channels each`);
    // Generate channel names
    const channelNames = [];
    for (let i = 1; i <= senderAnswers.channelCount; i++) {
        channelNames.push(`Channel ${i}`);
    }
    // Get available network interfaces for Windows
    logger.info("Detecting available network interfaces...");
    const networkInterfaces = await getWindowsNetworkInterfaces();
    // Prepare network interface choices
    const networkInterfaceChoices = networkInterfaces.length > 0
        ? networkInterfaces.map(iface => ({
            name: `${iface.name} (${iface.status}) - ${iface.description}`,
            value: iface.name
        }))
        : [
            { name: "Ethernet (Manual entry)", value: "Ethernet" },
            { name: "Wi-Fi (Manual entry)", value: "Wi-Fi" }
        ];
    // Get common configuration
    const commonAnswers = await inquirer.prompt([
        {
            type: "number",
            name: "samplingRate",
            message: "Sampling rate (Hz):",
            default: 48000,
            validate: (input) => (input > 0 ? true : "Sampling rate must be positive"),
        },
        {
            type: "input",
            name: "baseMulticastAddress",
            message: "Base multicast address (will increment for each stream):",
            default: "239.69.100.1",
            validate: (input) => /^((22[4-9])|(23[0-9]))\.((25[0-5])|([01]?\d?\d))\.((25[0-5])|([01]?\d?\d))\.((25[0-5])|([01]?\d?\d))$/.test(input)
                ? true
                : "Enter a valid multicast IPv4 address",
        },
        {
            type: "list",
            name: "networkInterface",
            message: "Select network interface for AES67 traffic:",
            choices: networkInterfaceChoices,
            default: networkInterfaceChoices[0]?.value || "Ethernet",
        },
        {
            type: "number",
            name: "ptpDomain",
            message: "PTP domain number:",
            default: 0,
            validate: (input) => (input >= 0 && input <= 127 ? true : "PTP domain must be between 0 and 127"),
        },
        {
            type: "list",
            name: "ptpMode",
            message: "PTP mode - Windows sender must sync to a Raspberry Pi grandmaster:",
            choices: [
                {
                    name: "Slave (sync to Raspberry Pi grandmaster) - Required for Windows",
                    value: "slave",
                },
            ],
            default: "slave",
        },
        {
            type: "number",
            name: "rtpDestinationPort",
            message: "Base RTP destination port (will increment for each stream):",
            default: 5004,
            validate: (input) => (input >= 1024 && input <= 65535 ? true : "Port must be between 1024 and 65535"),
        },
        {
            type: "input",
            name: "sessionName",
            message: "Session name for logging/identification:",
            default: "AES67 Sender",
            validate: (input) => (input.trim().length > 0 ? true : "Session name cannot be empty"),
        },
    ]);
    const config = {
        deviceMode: "sender",
        audioSource: senderAnswers.audioSource,
        channelCount: senderAnswers.channelCount,
        channelNames,
        channelsPerReceiver: senderAnswers.channelsPerReceiver,
        jackClientName,
        asioDeviceClsid,
        samplingRate: commonAnswers.samplingRate,
        multicastAddress: commonAnswers.baseMulticastAddress,
        baseMulticastAddress: commonAnswers.baseMulticastAddress,
        networkInterface: commonAnswers.networkInterface,
        ptpDomain: commonAnswers.ptpDomain,
        ptpMode: commonAnswers.ptpMode,
        rtpDestinationPort: commonAnswers.rtpDestinationPort,
        sessionName: commonAnswers.sessionName,
        lastUpdated: new Date().toISOString(),
    };
    await saveConfig(configPath, config);
    logger.info(`Configuration saved to ${configPath}`);
    logger.info(`Sender will create ${numStreams} stream(s):`);
    for (let i = 0; i < numStreams; i++) {
        const streamChannelCount = Math.min(senderAnswers.channelsPerReceiver, senderAnswers.channelCount - i * senderAnswers.channelsPerReceiver);
        const baseAddress = commonAnswers.baseMulticastAddress.split(".");
        baseAddress[3] = String(parseInt(baseAddress[3], 10) + i);
        const streamAddress = baseAddress.join(".");
        logger.info(`  Stream ${i + 1}: ${streamChannelCount} channels @ ${streamAddress}:${commonAnswers.rtpDestinationPort + i}`);
    }
    return config;
};
const program = createProgram();
program.parseAsync(process.argv).catch((error) => {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
});
