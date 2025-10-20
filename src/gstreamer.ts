import { Logger } from "./utils/logger.js";
import { Aes67DeviceConfig, ManagedProcessHandle } from "./types.js";
import { spawnLongRunning } from "./pipes.js";
import { execCommandSafe } from "./utils/exec.js";
import fs from "fs-extra";
import path from "path";

/**
 * Format GStreamer command arguments for Windows terminal (PowerShell)
 * Uses single quotes for caps filters and escapes parentheses for PowerShell
 */
const formatCommandForWindows = (command: string, args: string[]): string => {
  const escapeForWindows = (arg: string): string => {
    // Escape parentheses for PowerShell (backtick is PowerShell escape character)
    if (arg === "(") {
      return "`(";
    }
    if (arg === ")") {
      return "`)";
    }
    
    // Don't quote simple operators and element names
    if (arg === "!" || /^[a-z0-9]+$/.test(arg)) {
      return arg;
    }
    
    // Caps filters (audio/x-raw) - use single quotes to preserve parentheses in bitmask
    if (arg.startsWith("audio/")) {
      return `'${arg}'`;
    }
    
    // Properties with values (key=value) - use double quotes if contains special chars
    if (arg.includes("=")) {
      // Check if value part has spaces or quotes that need escaping
      if (arg.includes(" ") || arg.includes("&") || arg.includes("|")) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    }
    
    // Default: return as-is for simple args
    return arg;
  };

  const formattedArgs = args.map(escapeForWindows);
  return `${command} ${formattedArgs.join(" ")}`;
};

export interface GstreamerStream {
  streamIndex: number;
  multicastAddress: string;
  port: number;
  channelCount: number;
  startChannel: number;
  endChannel: number;
  handle?: ManagedProcessHandle;
}

/**
 * Calculate stream configurations based on total channels and channels per receiver
 */
export const calculateStreamConfig = (config: Aes67DeviceConfig): GstreamerStream[] => {
  if (!config.channelsPerReceiver || !config.baseMulticastAddress) {
    throw new Error("Sender configuration is missing required fields");
  }

  const streams: GstreamerStream[] = [];
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
export const verifyGstreamerInstallation = async (logger: Logger, audioSource: "jack" | "asio" = "asio"): Promise<void> => {
  try {
    await execCommandSafe("gst-launch-1.0 --version");
    logger.verboseLog("Gstreamer found");
  } catch (error) {
    throw new Error(
      "Gstreamer not found. Please install Gstreamer from https://gstreamer.freedesktop.org/download/",
    );
  }

  // Check for required plugins based on audio source
  const requiredPlugins = ["audioconvert", "audioresample", "rtpL24pay", "udpsink", "clockselect", "queue"];
  
  if (audioSource === "asio") {
    requiredPlugins.push("asio");
  } else if (audioSource === "jack") {
    requiredPlugins.push("jack");
  }
  
  for (const plugin of requiredPlugins) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await execCommandSafe(`gst-inspect-1.0 ${plugin}`);
      logger.verboseLog(`Gstreamer plugin '${plugin}' found`);
    } catch (error) {
      throw new Error(
        `Required Gstreamer plugin '${plugin}' not found. Please install GStreamer 1.24+ with all plugin packages (base, good, bad).\n` +
        `The 'clockselect' and 'ptp' plugins are required for PTP clock synchronization.\n` +
        `The 'asio' plugin requires proper ASIO driver installation on Windows.\n` +
        `The 'jack' plugin requires JACK Audio Connection Kit to be installed.`,
      );
    }
  }
};

/**
 * Verify that ASIO device is available
 * Note: ASIO doesn't require a running server like Jack, but we can verify the plugin
 */
export const verifyAsioAvailable = async (logger: Logger): Promise<void> => {
  try {
    // Check if asiosrc element can be instantiated
    await execCommandSafe("gst-inspect-1.0 asiosrc");
    logger.verboseLog("ASIO source plugin is available");
  } catch (error) {
    throw new Error(
      "ASIO source plugin not found. Please ensure:\n" +
      "1. GStreamer is installed with the ASIO plugin\n" +
      "2. ASIO drivers are properly installed on your Windows system\n" +
      "3. You have a compatible ASIO audio interface or ASIO4ALL installed"
    );
  }
};

/**
 * Verify that JACK is available
 */
export const verifyJackAvailable = async (logger: Logger): Promise<void> => {
  try {
    // Check if jackaudiosrc element can be instantiated
    await execCommandSafe("gst-inspect-1.0 jackaudiosrc");
    logger.verboseLog("JACK audio source plugin is available");
  } catch (error) {
    throw new Error(
      "JACK audio source plugin not found. Please ensure:\n" +
      "1. GStreamer is installed with the JACK plugin\n" +
      "2. JACK Audio Connection Kit is properly installed\n" +
      "3. JACK server is running before starting the sender"
    );
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
 * Start all Gstreamer streams for the sender using clockselect PTP synchronization
 */
export const startGstreamerStreams = async (
  config: Aes67DeviceConfig,
  logger: Logger,
): Promise<GstreamerStream[]> => {
  const audioSource = config.audioSource || "asio";
  logger.info(`Starting Gstreamer sender with PTP synchronization (clockselect) using ${audioSource.toUpperCase()}...`);

  // Verify prerequisites
  await verifyGstreamerInstallation(logger, audioSource);
  
  if (audioSource === "asio") {
    await verifyAsioAvailable(logger);
  } else if (audioSource === "jack") {
    await verifyJackAvailable(logger);
  }

  // Calculate stream configuration
  const streams = calculateStreamConfig(config);
  logger.info(`Configured ${streams.length} stream(s):`);
  for (const stream of streams) {
    logger.info(
      `  Stream ${stream.streamIndex + 1}: ${stream.channelCount} channels @ ${stream.multicastAddress}:${stream.port}`,
    );
  }

  // Start a GStreamer pipeline for each stream
  for (const stream of streams) {
    const samplingRate = config.samplingRate;
    const ptpDomain = config.ptpDomain || 0;
    const debugLevel = config.gstreamerDebugLevel ?? 2; // Default to WARNING level
    
    // Calculate channel mask based on channel count: (2^channels - 1) in hex
    const channelMask = `0x${(2 ** stream.channelCount - 1).toString(16)}`;
    
    // Build the pipeline using clockselect syntax from GStreamer docs
    // Format: gst-launch-1.0 -v clockselect. \( clock-id=ptp ptp-domain=X pipeline \)
    //
    // Working examples:
    // ASIO: asiosrc device-clsid="{...}" input-channels="0,1,2,3,..." ! audio/x-raw,format=F32LE,rate=48000,channels=N,layout=interleaved,channel-mask=(bitmask)0x... ! queue ! audioconvert ! audioresample
    // JACK: jackaudiosrc connect=0 client-name="..." ! audio/x-raw,format=F32LE,rate=48000,channels=N,layout=interleaved,channel-mask=(bitmask)0x... ! queue ! audioconvert ! audioresample
    //
    // Debug levels: 0=none, 1=ERROR, 2=WARNING, 3=INFO, 4=DEBUG, 5+=TRACE
    const args = [
      "-v",
      `--gst-debug-level=${debugLevel}`,
      "clockselect.",
      "(",
      `clock-id=ptp`,
      `ptp-domain=${ptpDomain}`,
    ];
    
    // Add audio source element based on configuration
    if (audioSource === "asio") {
      args.push("asiosrc");
      
      // Add ASIO device selection
      if (config.asioDeviceClsid) {
        args.push(`device-clsid=${config.asioDeviceClsid}`);
      }
      
      // Generate input-channels list based on stream channels
      // For stream with channels 0-7: "0,1,2,3,4,5,6,7"
      // For stream with channels 8-15: "8,9,10,11,12,13,14,15"
      const inputChannels: string[] = [];
      for (let i = 0; i < stream.channelCount; i++) {
        inputChannels.push(String(stream.startChannel - 1 + i)); // startChannel is 1-indexed, convert to 0-indexed
      }
      args.push(`input-channels="${inputChannels.join(",")}"`);
    } else if (audioSource === "jack") {
      args.push("jackaudiosrc");
      args.push("connect=0");
      
      // Add JACK client name
      if (config.jackClientName) {
        args.push(`client-name="${config.jackClientName}"`);
      }
    }
    
    // Add caps filter matching the working examples
    // Note: When using spawn() with an args array, Node.js handles escaping automatically
    // so we don't need to add quotes around the caps strings
    args.push(
      "!",
      `audio/x-raw,format=F32LE,rate=${samplingRate},channels=${stream.channelCount},layout=interleaved,channel-mask=(bitmask)${channelMask}`,
      "!",
      "queue",
      "!",
      "audioconvert",
      "!",
      "audioresample",
      "!",
      // Convert to S24BE for RTP L24 payload
      `audio/x-raw,format=S24BE,rate=${samplingRate},channels=${stream.channelCount},layout=interleaved,channel-mask=(bitmask)${channelMask}`,
      "!",
      "rtpL24pay",
      "mtu=1500",
      "pt=96",
      "timestamp-offset=0",
      "!",
      "udpsink",
      `host=${stream.multicastAddress}`,
      `port=${stream.port}`,
      "auto-multicast=true",
      "ttl-mc=32",
      "sync=false",
      "async=false",
      ")"
    );
    
    // Format command for Windows terminal (can be copy-pasted directly)
    const windowsCommand = formatCommandForWindows("gst-launch-1.0", args);
    
    logger.info(`\nStream ${stream.streamIndex + 1} pipeline command (copy-paste ready for Windows terminal):`);
    logger.info(windowsCommand);
    logger.info("");
    
    // Start the GStreamer pipeline as a long-running process
    // eslint-disable-next-line no-await-in-loop
    const handle = spawnLongRunning("gst-launch-1.0", args, {}, logger, `gst-stream${stream.streamIndex}`);
    
    stream.handle = handle;
    
    logger.info(`Started stream ${stream.streamIndex + 1}`);
  }

  logger.info("\n✓ All streams started successfully with PTP clock synchronization");
  logger.info(`Note: ${audioSource.toUpperCase()} device will be used for audio input`);
  
  return streams;
};

/**
 * Generate SDP file content for a stream
 */
const generateSdpContent = (config: Aes67DeviceConfig, stream: GstreamerStream): string => {
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
export const generateSdpFiles = async (
  config: Aes67DeviceConfig,
  streams: GstreamerStream[],
  outputDir: string,
  logger: Logger,
): Promise<string[]> => {
  await fs.ensureDir(outputDir);
  
  const sdpFilePaths: string[] = [];
  
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
export const stopGstreamerStreams = async (
  streams: GstreamerStream[] | undefined,
  logger: Logger,
): Promise<void> => {
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
      } catch (error) {
        logger.warn(`Failed to stop stream ${stream.streamIndex}: ${(error as Error).message}`);
      }
    }
  }

  logger.info("All Gstreamer streams stopped");
};

