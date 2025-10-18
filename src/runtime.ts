import chalk from "chalk";
import path from "path";
import { execCommandSafe } from "./utils/exec.js";
import { Aes67DeviceConfig, ManagedProcessHandle, PipewireRoutingState } from "./types.js";
import { Logger } from "./utils/logger.js";
import { spawnLongRunning } from "./pipes.js";
import { setupPipewireRouting, teardownPipewireRouting } from "./pipewire.js";
import { startGstreamerStreams, stopGstreamerStreams, GstreamerStream, generateSdpFiles } from "./gstreamer.js";

export const ensurePipewireRunning = async (logger: Logger): Promise<void> => {
  try {
    await execCommandSafe("systemctl --user is-active --quiet pipewire.service");
    logger.verboseLog("PipeWire service is active.");
  } catch (error) {
    throw new Error("PipeWire is not running. Ensure PipeWire is started before launching this tool.");
  }
};

export const startClockSync = (config: Aes67DeviceConfig, logger: Logger): ManagedProcessHandle => {
  logger.info(`Starting clock discipline with phc2sys on ${config.networkInterface}.`);
  const args = ["-a", "-r", "-n", "24", "-O", "0", "-E", config.networkInterface, "-L", "7"];
  return spawnLongRunning("phc2sys", args, {}, logger, "phc2sys synchroniser");
};

export const configureMultichannelRouting = async (
  config: Aes67DeviceConfig,
  logger: Logger,
): Promise<PipewireRoutingState> => {
  logger.info(`Configuring PipeWire routing for ${config.channelCount} playback channels.`);
  logger.verboseLog(`Channel names: ${config.channelNames.join(", ")}`);
  return setupPipewireRouting(config, logger);
};

const startPtpDaemon = (config: Aes67DeviceConfig, logger: Logger): ManagedProcessHandle => {
  const baseArgs = ["-i", config.networkInterface, "-m", "-2"];
  
  // Add mode-specific arguments
  if (config.ptpMode === "grandmaster") {
    logger.info(`Starting PTP daemon in GRANDMASTER mode on ${config.networkInterface}.`);
    // -p: Set priority1 to 128 (default grandmaster priority)
    // -d: PTP domain
    baseArgs.push("-l", "7", "-f", "/etc/linuxptp/ptp4l.conf", "-d", `${config.ptpDomain}`);
  } else {
    logger.info(`Starting PTP daemon in SLAVE mode on ${config.networkInterface}.`);
    // -s: Slave-only mode
    baseArgs.push("-s", "-l", "7", "-f", "/etc/linuxptp/ptp4l.conf", "-d", `${config.ptpDomain}`);
  }
  
  return spawnLongRunning("ptp4l", baseArgs, {}, logger, "ptp4l daemon");
};

const runReceiverRuntimeLoop = async (config: Aes67DeviceConfig, logger: Logger): Promise<void> => {
  logger.info("Starting AES67 receiver runtime process.");
  await ensurePipewireRunning(logger);
  let routingState: PipewireRoutingState | undefined;
  let ptpHandle: ManagedProcessHandle | undefined;
  let clockSyncHandle: ManagedProcessHandle | undefined;
  let stopRequested = false;

  const handleSignal = (signal: NodeJS.Signals) => {
    logger.warn(`Received ${signal}. Initiating shutdown of AES67 receiver runtime.`);
    stopRequested = true;
  };

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  signals.forEach((signal) => process.on(signal, handleSignal));

  try {
    routingState = await configureMultichannelRouting(config, logger);
    ptpHandle = startPtpDaemon(config, logger);
    clockSyncHandle = startClockSync(config, logger);

    console.log(chalk.green("AES67 receiver is active. Monitoring..."));
    // eslint-disable-next-line no-unmodified-loop-condition
    while (!stopRequested) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }

    logger.info("Shutdown requested, cleaning up resources.");
  } finally {
    signals.forEach((signal) => process.off(signal, handleSignal));

    if (clockSyncHandle) {
      await clockSyncHandle.stop();
    }

    if (ptpHandle) {
      await ptpHandle.stop();
    }

    await teardownPipewireRouting(routingState, logger);
  }
};

const runSenderRuntimeLoop = async (config: Aes67DeviceConfig, logger: Logger, configPath: string): Promise<void> => {
  logger.info("Starting AES67 sender runtime process.");
  let gstreamerStreams: GstreamerStream[] | undefined;
  let stopRequested = false;

  const handleSignal = (signal: NodeJS.Signals) => {
    logger.warn(`Received ${signal}. Initiating shutdown of AES67 sender runtime.`);
    stopRequested = true;
  };

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  signals.forEach((signal) => process.on(signal, handleSignal));

  try {
    // Start Gstreamer streams with PTP synchronization
    gstreamerStreams = await startGstreamerStreams(config, logger, configPath);

    // Generate SDP files for receivers
    const sdpOutputDir = path.join(process.cwd(), "sdp-files");
    const sdpFiles = await generateSdpFiles(config, gstreamerStreams, sdpOutputDir, logger);
    
    console.log(chalk.green("AES67 sender is active. Monitoring..."));
    logger.info("Manual Jack connections required:");
    logger.info(`  Connect your audio source ports to the Jack clients named: ${config.jackClientName}_stream*`);
    logger.info("  Use jack_connect or a Jack patchbay tool like QjackCtl");
    logger.info("");
    logger.info("SDP files for receivers generated:");
    sdpFiles.forEach((file, index) => {
      logger.info(`  Stream ${index + 1}: ${file}`);
    });
    logger.info("Copy these SDP files to your receiver(s) for configuration.");

    // eslint-disable-next-line no-unmodified-loop-condition
    while (!stopRequested) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }

    logger.info("Shutdown requested, cleaning up resources.");
  } finally {
    signals.forEach((signal) => process.off(signal, handleSignal));

    await stopGstreamerStreams(gstreamerStreams, logger);
  }
};

export const runRuntimeLoop = async (config: Aes67DeviceConfig, logger: Logger, configPath: string): Promise<void> => {
  if (config.deviceMode === "receiver") {
    await runReceiverRuntimeLoop(config, logger);
  } else if (config.deviceMode === "sender") {
    await runSenderRuntimeLoop(config, logger, configPath);
  } else {
    throw new Error(`Unknown device mode: ${config.deviceMode}`);
  }
};

