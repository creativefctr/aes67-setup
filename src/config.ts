import { z } from "zod";
import fs from "fs-extra";
import path from "path";
import { Aes67DeviceConfig } from "./types.js";

export const CONFIG_FILE_NAME = "aes67-config.json";

const multicastRegex =
  /^((22[4-9])|(23[0-9]))\.((25[0-5])|([01]?\d?\d))\.((25[0-5])|([01]?\d?\d))\.((25[0-5])|([01]?\d?\d))$/;

const configSchema = z
  .object({
    deviceMode: z.enum(["sender", "receiver"]),
    soundCardId: z.string().min(1).optional(),
    soundCardName: z.string().min(1).optional(),
    channelCount: z.number().int().positive(),
    channelNames: z.array(z.string().min(1)).nonempty(),
    samplingRate: z.number().int().positive(),
    multicastAddress: z.string().regex(multicastRegex, "Invalid multicast IPv4 address"),
    sdpFilePath: z.string().min(1).optional(),
    networkInterface: z.string().min(1),
    ptpDomain: z.number().int().min(0).max(127),
    ptpMode: z.enum(["grandmaster", "slave", "none"]),
    rtpDestinationPort: z.number().int().min(1024).max(65535),
    sessionName: z.string().min(1),
    lastUpdated: z.string(),
    // Sender-specific fields
    audioSource: z.enum(["jack", "asio"]).optional(),
    jackClientName: z.string().min(1).optional(),
    channelsPerReceiver: z.number().int().positive().optional(),
    baseMulticastAddress: z.string().regex(multicastRegex, "Invalid multicast IPv4 address").optional(),
    multicastIface: z.string().min(1).optional(),
    asioDeviceClsid: z.string().min(1).optional(),
    asioInputChannels: z.string().optional(),
    gstreamerDebugLevel: z.number().int().min(0).max(5).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.channelNames.length !== data.channelCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `channelNames length (${data.channelNames.length}) must match channelCount (${data.channelCount})`,
        path: ["channelNames"],
      });
    }
    
    // Receiver mode validation
    if (data.deviceMode === "receiver") {
      if (!data.soundCardId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "soundCardId is required for receiver mode",
          path: ["soundCardId"],
        });
      }
      if (!data.soundCardName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "soundCardName is required for receiver mode",
          path: ["soundCardName"],
        });
      }
      if (!data.sdpFilePath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sdpFilePath is required for receiver mode",
          path: ["sdpFilePath"],
        });
      }
    }
    
    // Sender mode validation
    if (data.deviceMode === "sender") {
      if (!data.audioSource) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "audioSource is required for sender mode",
          path: ["audioSource"],
        });
      }
      
      // Validate audio source-specific fields
      if (data.audioSource === "jack" && !data.jackClientName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "jackClientName is required when audioSource is 'jack'",
          path: ["jackClientName"],
        });
      }
      
      if (data.audioSource === "asio" && !data.asioDeviceClsid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "asioDeviceClsid is required when audioSource is 'asio'",
          path: ["asioDeviceClsid"],
        });
      }
      
      if (!data.channelsPerReceiver) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "channelsPerReceiver is required for sender mode",
          path: ["channelsPerReceiver"],
        });
      }
      if (!data.baseMulticastAddress) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "baseMulticastAddress is required for sender mode",
          path: ["baseMulticastAddress"],
        });
      }
    }
  });

export const loadConfig = async (configPath: string): Promise<Aes67DeviceConfig | null> => {
  if (!(await fs.pathExists(configPath))) {
    return null;
  }

  const raw = await fs.readFile(configPath, "utf-8");

  if (!raw.trim()) {
    throw new Error("Configuration file is empty.");
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse configuration JSON: ${(error as Error).message}`);
  }

  const parsed = configSchema.safeParse(data);

  if (!parsed.success) {
    throw new Error(`Invalid configuration file: ${parsed.error.message}`);
  }

  return parsed.data;
};

export const saveConfig = async (configPath: string, config: Aes67DeviceConfig): Promise<void> => {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Failed to save configuration: ${parsed.error.message}`);
  }

  await fs.writeJSON(configPath, config, { spaces: 2 });
};

export const getDefaultConfigPath = (cwd: string): string => {
  return path.join(cwd, CONFIG_FILE_NAME);
};

