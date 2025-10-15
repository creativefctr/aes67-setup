import chalk from "chalk";
import { execCommandSafe } from "./utils/exec.js";
import { Aes67DeviceConfig, ManagedProcessHandle, PipewireRoutingState } from "./types.js";
import { Logger } from "./utils/logger.js";
import { spawnLongRunning } from "./pipes.js";
import { setupPipewireRouting, teardownPipewireRouting } from "./pipewire.js";

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
  const args = ["-i", config.networkInterface, "-m", "-2", "-s", "-l", "7", "-f", "/etc/linuxptp/ptp4l.conf", "-d", `${config.ptpDomain}`];
  return spawnLongRunning("ptp4l", args, {}, logger, "ptp4l daemon");
};

export const runRuntimeLoop = async (config: Aes67DeviceConfig, logger: Logger): Promise<void> => {
  logger.info("Starting AES67 runtime process.");
  await ensurePipewireRunning(logger);
  let routingState: PipewireRoutingState | undefined;
  let ptpHandle: ManagedProcessHandle | undefined;
  let clockSyncHandle: ManagedProcessHandle | undefined;
  let stopRequested = false;

  const handleSignal = (signal: NodeJS.Signals) => {
    logger.warn(`Received ${signal}. Initiating shutdown of AES67 runtime.`);
    stopRequested = true;
  };

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  signals.forEach((signal) => process.on(signal, handleSignal));

  try {
    routingState = await configureMultichannelRouting(config, logger);
    ptpHandle = startPtpDaemon(config, logger);
    clockSyncHandle = startClockSync(config, logger);

    console.log(chalk.green("AES67 setup is active. Monitoring..."));
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

