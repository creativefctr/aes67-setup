import { spawnLongRunning } from "./pipes.js";
import { execCommandSafe } from "./utils/exec.js";
import fs from "fs-extra";
import path from "path";
/**
 * Calculate stream configurations based on total channels and channels per receiver
 */
export const calculateStreamConfig = (config) => {
    if (!config.channelsPerReceiver || !config.baseMulticastAddress) {
        throw new Error("Sender configuration is missing required fields");
    }
    const streams = [];
    const numStreams = Math.ceil(config.channelCount / config.channelsPerReceiver);
    for (let i = 0; i < numStreams; i++) {
        const startChannel = i * config.channelsPerReceiver;
        const endChannel = Math.min(startChannel + config.channelsPerReceiver, config.channelCount);
        const channelCount = endChannel - startChannel;
        // Increment the last octet of the multicast address for each stream
        const baseAddress = config.baseMulticastAddress.split(".");
        baseAddress[3] = String(parseInt(baseAddress[3], 10) + i);
        const multicastAddress = baseAddress.join(".");
        streams.push({
            streamIndex: i,
            multicastAddress,
            port: config.rtpDestinationPort + i,
            channelCount,
            startChannel: startChannel + 1, // 1-indexed
            endChannel,
        });
    }
    return streams;
};
/**
 * Verify that Gstreamer is installed and has required plugins
 */
export const verifyGstreamerInstallation = async (logger, audioSource = "asio") => {
    try {
        await execCommandSafe("gst-launch-1.0 --version");
        logger.verboseLog("Gstreamer found");
    }
    catch (error) {
        throw new Error("Gstreamer not found. Please install Gstreamer from https://gstreamer.freedesktop.org/download/");
    }
    // Check for required plugins based on audio source
    const requiredPlugins = ["audioconvert", "audioresample", "rtpL24pay", "udpsink", "clockselect", "queue"];
    if (audioSource === "asio") {
        requiredPlugins.push("asio");
    }
    else if (audioSource === "jack") {
        requiredPlugins.push("jack");
    }
    for (const plugin of requiredPlugins) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await execCommandSafe(`gst-inspect-1.0 ${plugin}`);
            logger.verboseLog(`Gstreamer plugin '${plugin}' found`);
        }
        catch (error) {
            throw new Error(`Required Gstreamer plugin '${plugin}' not found. Please install GStreamer 1.24+ with all plugin packages (base, good, bad).\n` +
                `The 'clockselect' and 'ptp' plugins are required for PTP clock synchronization.\n` +
                `The 'asio' plugin requires proper ASIO driver installation on Windows.\n` +
                `The 'jack' plugin requires JACK Audio Connection Kit to be installed.`);
        }
    }
};
/**
 * Verify that ASIO device is available
 * Note: ASIO doesn't require a running server like Jack, but we can verify the plugin
 */
export const verifyAsioAvailable = async (logger) => {
    try {
        // Check if asiosrc element can be instantiated
        await execCommandSafe("gst-inspect-1.0 asiosrc");
        logger.verboseLog("ASIO source plugin is available");
    }
    catch (error) {
        throw new Error("ASIO source plugin not found. Please ensure:\n" +
            "1. GStreamer is installed with the ASIO plugin\n" +
            "2. ASIO drivers are properly installed on your Windows system\n" +
            "3. You have a compatible ASIO audio interface or ASIO4ALL installed");
    }
};
/**
 * Verify that JACK is available
 */
export const verifyJackAvailable = async (logger) => {
    try {
        // Check if jackaudiosrc element can be instantiated
        await execCommandSafe("gst-inspect-1.0 jackaudiosrc");
        logger.verboseLog("JACK audio source plugin is available");
    }
    catch (error) {
        throw new Error("JACK audio source plugin not found. Please ensure:\n" +
            "1. GStreamer is installed with the JACK plugin\n" +
            "2. JACK Audio Connection Kit is properly installed\n" +
            "3. JACK server is running before starting the sender");
    }
};
/**
 * GStreamer PTP Clock Synchronization Implementation
 * ===================================================
 *
 * This tool uses GStreamer's clockselect plugin for PTP clock synchronization.
 * The clockselect plugin (available in GStreamer 1.24+) allows direct PTP clock
 * selection from the command line without requiring Python bindings or external
 * PTP daemons.
 *
 * Synchronization Flow:
 * ---------------------
 * 1. gst-launch-1.0 with clockselect plugin initializes PTP clock
 * 2. Pipeline uses PTP clock synchronized to Raspberry Pi grandmaster
 * 3. asiosrc provides live audio samples from ASIO audio interface
 * 4. rtpL24pay timestamps packets using pipeline clock (= PTP time)
 * 5. RTP packets carry PTP-synchronized timestamps
 * 6. All receivers stay synchronized to the same PTP reference
 *
 * This approach eliminates the need for Python, PyGObject, and MSYS2.
 */
/**
 * Start all Gstreamer streams for the sender using PowerShell script
 * This avoids the quoting/escaping issues when spawning gst-launch-1.0 directly from Node.js
 */
export const startGstreamerStreams = async (config, logger) => {
    const audioSource = config.audioSource || "asio";
    logger.info(`Starting Gstreamer sender with PTP synchronization (clockselect) using ${audioSource.toUpperCase()}...`);
    // Verify prerequisites
    await verifyGstreamerInstallation(logger, audioSource);
    if (audioSource === "asio") {
        await verifyAsioAvailable(logger);
    }
    else if (audioSource === "jack") {
        await verifyJackAvailable(logger);
    }
    // Calculate stream configuration
    const streams = calculateStreamConfig(config);
    logger.info(`Configured ${streams.length} stream(s):`);
    for (const stream of streams) {
        logger.info(`  Stream ${stream.streamIndex + 1}: ${stream.channelCount} channels @ ${stream.multicastAddress}:${stream.port}`);
    }
    // Check if PTP clock should be used
    const usePtpClock = config.ptpMode !== "none";
    const ptpDomain = config.ptpDomain || 0;
    const debugLevel = config.gstreamerDebugLevel ?? 4; // Default to WARNING level
    // Get the path to the PowerShell script
    const scriptPath = path.join(process.cwd(), "run-gstreamer-pipeline.ps1");
    // Verify the script exists
    if (!await fs.pathExists(scriptPath)) {
        throw new Error(`PowerShell script not found at: ${scriptPath}`);
    }
    logger.info(`Using PowerShell script: ${scriptPath}`);
    // Start a GStreamer pipeline for each stream
    for (const stream of streams) {
        // Build the PowerShell command string
        let command = `& "${scriptPath}" -AudioSource "${audioSource}" -Channels ${stream.channelCount} -SamplingRate ${config.samplingRate} -MulticastAddress "${stream.multicastAddress}" -Port ${stream.port} -DebugLevel ${debugLevel}`;
        // Add multicast interface if specified
        if (config.multicastIface) {
            command += ` -MulticastIface "${config.multicastIface}"`;
        }
        // Add audio source specific parameters
        if (audioSource === "asio") {
            if (config.asioDeviceClsid) {
                command += ` -DeviceClsid "${config.asioDeviceClsid}"`;
            }
            // Generate input-channels list based on stream channels
            const inputChannels = [];
            for (let i = 0; i < stream.channelCount; i++) {
                inputChannels.push(String(stream.startChannel - 1 + i)); // startChannel is 1-indexed, convert to 0-indexed
            }
            command += ` -InputChannels "${inputChannels.join(",")}"`;
        }
        else if (audioSource === "jack") {
            if (config.jackClientName) {
                command += ` -JackClientName "${config.jackClientName}"`;
            }
        }
        // Add PTP parameters if enabled
        if (usePtpClock) {
            command += " -EnablePtp";
            command += ` -PtpDomain ${ptpDomain}`;
        }
        // Force PowerShell to output ANSI colors by setting OutputRendering
        const psCommand = `$PSStyle.OutputRendering = [System.Management.Automation.OutputRendering]::Ansi; ${command}`;
        // Build PowerShell arguments
        // -NoLogo: Don't show PowerShell banner
        // -NonInteractive: Don't wait for user input  
        // -Command: Execute the command string
        const psArgs = [
            "-NoLogo",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-NoProfile",
            "-Command",
            psCommand,
        ];
        logger.verboseLog(`PowerShell arguments: ${psArgs.join(" ")}`);
        // Start the PowerShell process which will launch GStreamer
        // Enable color preservation to see GStreamer's colored output
        // Set environment variables to ensure ANSI colors are enabled
        const env = {
            ...process.env,
            FORCE_COLOR: "1",
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            GST_DEBUG_COLOR_MODE: "on", // Force GStreamer to use colors
        };
        // eslint-disable-next-line no-await-in-loop
        const handle = spawnLongRunning("powershell", psArgs, { env }, logger, `gst-stream${stream.streamIndex}`, undefined, // onExit callback
        true);
        stream.handle = handle;
        logger.info(`Started stream ${stream.streamIndex + 1}`);
    }
    const clockInfo = usePtpClock ? "with PTP clock synchronization" : "without PTP clock (using system clock)";
    logger.info(`\n✓ All streams started successfully ${clockInfo}`);
    logger.info(`Note: ${audioSource.toUpperCase()} device will be used for audio input`);
    return streams;
};
/**
 * Generate SDP file content for a stream
 */
const generateSdpContent = (config, stream) => {
    const sessionId = Date.now();
    const sessionVersion = sessionId;
    // SDP file format for AES67
    const sdpLines = [
        "v=0",
        `o=- ${sessionId} ${sessionVersion} IN IP4 ${stream.multicastAddress}`,
        `s=${config.sessionName} - Stream ${stream.streamIndex + 1}`,
        `c=IN IP4 ${stream.multicastAddress}/32`,
        "t=0 0",
        `m=audio ${stream.port} RTP/AVP 96`,
        `a=rtpmap:96 L24/${config.samplingRate}/${stream.channelCount}`,
        "a=recvonly",
        "a=ptime:1",
        `a=mediaclk:direct=0`,
    ];
    return sdpLines.join("\n") + "\n";
};
/**
 * Generate SDP files for all streams
 */
export const generateSdpFiles = async (config, streams, outputDir, logger) => {
    await fs.ensureDir(outputDir);
    const sdpFilePaths = [];
    for (const stream of streams) {
        const sdpContent = generateSdpContent(config, stream);
        const fileName = `stream${stream.streamIndex + 1}.sdp`;
        const filePath = path.join(outputDir, fileName);
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(filePath, sdpContent, "utf-8");
        sdpFilePaths.push(filePath);
        logger.info(`Generated SDP file: ${filePath}`);
        logger.verboseLog(`SDP content:\n${sdpContent}`);
    }
    return sdpFilePaths;
};
/**
 * Stop all Gstreamer streams
 */
export const stopGstreamerStreams = async (streams, logger) => {
    if (!streams) {
        return;
    }
    logger.info("Stopping Gstreamer streams...");
    for (const stream of streams) {
        if (stream.handle) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await stream.handle.stop();
                logger.verboseLog(`Stopped stream ${stream.streamIndex}`);
            }
            catch (error) {
                logger.warn(`Failed to stop stream ${stream.streamIndex}: ${error.message}`);
            }
        }
    }
    logger.info("All Gstreamer streams stopped");
};
