import { Logger } from "./utils/logger.js";
import { Aes67DeviceConfig, ManagedProcessHandle } from "./types.js";
import { spawnLongRunning } from "./pipes.js";
import { execCommandSafe } from "./utils/exec.js";
import fs from "fs-extra";
import path from "path";

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
      startChannel: startChannel + 1, // 1-indexed for Jack
      endChannel,
    });
  }

  return streams;
};

/**
 * Verify that Gstreamer is installed and has required plugins
 */
export const verifyGstreamerInstallation = async (logger: Logger): Promise<void> => {
  try {
    await execCommandSafe("gst-launch-1.0 --version");
    logger.verboseLog("Gstreamer found");
  } catch (error) {
    throw new Error(
      "Gstreamer not found. Please install Gstreamer from https://gstreamer.freedesktop.org/download/",
    );
  }

  // Check for required plugins
  const requiredPlugins = ["jack", "audioconvert", "audioresample", "rtpL24pay", "udpsink"];
  
  for (const plugin of requiredPlugins) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await execCommandSafe(`gst-inspect-1.0 ${plugin}`);
      logger.verboseLog(`Gstreamer plugin '${plugin}' found`);
    } catch (error) {
      throw new Error(
        `Required Gstreamer plugin '${plugin}' not found. Please install gstreamer1.0-plugins-good and gstreamer1.0-plugins-bad`,
      );
    }
  }
};

/**
 * Verify that Jack is running
 */
export const verifyJackRunning = async (logger: Logger): Promise<void> => {
  try {
    await execCommandSafe("jack_lsp");
    logger.verboseLog("Jack server is running");
  } catch (error) {
    throw new Error(
      "Jack server is not running. Please start Jack with your desired configuration before running this tool.",
    );
  }
};

/**
 * GStreamer PTP Clock Synchronization Implementation
 * ===================================================
 * 
 * For proper AES67 synchronization, this tool uses GStreamer's native PTP clock support
 * via the Python script (ptp-sender.py). This provides direct PTP synchronization without
 * requiring external PTP daemons.
 * 
 * Why Python Instead of gst-launch-1.0?
 * -------------------------------------
 * GStreamer's PTP clock requires calling C API functions that are not accessible from
 * the gst-launch-1.0 command-line tool:
 * 
 * - gst_ptp_init() - Initializes PTP subsystem
 * - gst_ptp_clock_new(domain) - Creates PTP clock for specific domain
 * - gst_pipeline_use_clock(ptp_clock) - Sets pipeline to use PTP clock
 * 
 * The Python script uses PyGObject (GStreamer Python bindings) to access these APIs
 * and create pipelines with proper PTP synchronization.
 * 
 * Synchronization Flow:
 * ---------------------
 * 1. Python script initializes GStreamer PTP subsystem
 * 2. Creates GstPtpClock synchronized to Raspberry Pi grandmaster
 * 3. Sets PTP clock as pipeline clock
 * 4. jackaudiosrc provides audio samples
 * 5. rtpL24pay timestamps packets using pipeline clock (= PTP time)
 * 6. RTP packets carry PTP-synchronized timestamps
 * 7. All receivers stay synchronized to the same PTP reference
 * 
 * This is the ONLY correct approach for Windows AES67 sender with proper PTP sync.
 */


/**
 * Verify Python and PyGObject are available
 */
const verifyPythonEnvironment = async (logger: Logger): Promise<void> => {
  // Check Python
  try {
    const result = await execCommandSafe("python --version");
    logger.verboseLog(`Python found: ${result.stdout.trim()}`);
  } catch (error) {
    try {
      const result = await execCommandSafe("python3 --version");
      logger.verboseLog(`Python found: ${result.stdout.trim()}`);
    } catch (error2) {
      throw new Error(
        "Python not found. Please install Python 3.7+ from https://www.python.org/downloads/",
      );
    }
  }

  // Check if PyGObject is installed
  try {
    await execCommandSafe("python -c \"import gi; gi.require_version('Gst', '1.0'); gi.require_version('GstNet', '1.0')\"");
    logger.verboseLog("PyGObject with GStreamer support found");
  } catch (error) {
    try {
      await execCommandSafe("python3 -c \"import gi; gi.require_version('Gst', '1.0'); gi.require_version('GstNet', '1.0')\"");
      logger.verboseLog("PyGObject with GStreamer support found");
    } catch (error2) {
      throw new Error(
        "PyGObject not found. Please install it with: pip install PyGObject\n" +
        "Or install from: https://github.com/pygobject/pygobject/releases",
      );
    }
  }
};

/**
 * Start all Gstreamer streams for the sender using Python PTP script
 */
export const startGstreamerStreams = async (
  config: Aes67DeviceConfig,
  logger: Logger,
  configPath: string,
): Promise<GstreamerStream[]> => {
  logger.info("Starting Gstreamer sender with PTP synchronization...");

  // Verify prerequisites
  await verifyGstreamerInstallation(logger);
  await verifyJackRunning(logger);
  await verifyPythonEnvironment(logger);

  // Calculate stream configuration (for display purposes)
  const streams = calculateStreamConfig(config);
  logger.info(`Configured ${streams.length} stream(s):`);
  for (const stream of streams) {
    logger.info(
      `  Stream ${stream.streamIndex + 1}: ${stream.channelCount} channels @ ${stream.multicastAddress}:${stream.port}`,
    );
  }

  // Determine Python command
  let pythonCmd = "python";
  try {
    await execCommandSafe("python --version");
  } catch (error) {
    try {
      await execCommandSafe("python3 --version");
      pythonCmd = "python3";
    } catch (error2) {
      throw new Error("Python not found");
    }
  }

  // Path to Python script (in the same directory as this tool)
  const scriptPath = path.join(process.cwd(), "ptp-sender.py");
  
  // Verify script exists
  if (!(await fs.pathExists(scriptPath))) {
    throw new Error(
      `PTP sender script not found at: ${scriptPath}\n` +
      "Please ensure ptp-sender.py is in the current directory.",
    );
  }

  logger.info("Starting Python PTP sender script...");
  logger.verboseLog(`Script: ${scriptPath}`);
  logger.verboseLog(`Config: ${configPath}`);

  // Build command arguments
  const args = [scriptPath, "-c", configPath];
  if (logger.isVerbose()) {
    args.push("-v");
  }

  // Start the Python script as a long-running process
  const handle = spawnLongRunning(pythonCmd, args, {}, logger, "ptp-sender");

  // Attach the handle to the first stream (for cleanup purposes)
  streams[0].handle = handle;

  logger.info("Python PTP sender started successfully");
  logger.info("Note: You need to manually connect Jack ports from your audio source to the stream clients");
  logger.info(`Jack client names: ${config.jackClientName}_stream0, ${config.jackClientName}_stream1, etc.`);
  
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

