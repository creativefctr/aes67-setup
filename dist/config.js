import { z } from "zod";
import fs from "fs-extra";
import path from "path";
export const CONFIG_FILE_NAME = "aes67-config.json";
const multicastRegex = /^((22[4-9])|(23[0-9]))\.((25[0-5])|([01]?\d?\d))\.((25[0-5])|([01]?\d?\d))\.((25[0-5])|([01]?\d?\d))$/;
const configSchema = z
    .object({
    soundCardId: z.string().min(1),
    soundCardName: z.string().min(1),
    channelCount: z.number().int().positive(),
    channelNames: z.array(z.string().min(1)).nonempty(),
    samplingRate: z.number().int().positive(),
    multicastAddress: z.string().regex(multicastRegex, "Invalid multicast IPv4 address"),
    sdpFilePath: z.string().min(1),
    networkInterface: z.string().min(1),
    ptpDomain: z.number().int().min(0).max(127),
    rtpDestinationPort: z.number().int().min(1024).max(65535),
    sessionName: z.string().min(1),
    lastUpdated: z.string(),
})
    .superRefine((data, ctx) => {
    if (data.channelNames.length !== data.channelCount) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `channelNames length (${data.channelNames.length}) must match channelCount (${data.channelCount})`,
            path: ["channelNames"],
        });
    }
});
export const loadConfig = async (configPath) => {
    if (!(await fs.pathExists(configPath))) {
        return null;
    }
    const raw = await fs.readFile(configPath, "utf-8");
    if (!raw.trim()) {
        throw new Error("Configuration file is empty.");
    }
    let data;
    try {
        data = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Failed to parse configuration JSON: ${error.message}`);
    }
    const parsed = configSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(`Invalid configuration file: ${parsed.error.message}`);
    }
    return parsed.data;
};
export const saveConfig = async (configPath, config) => {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
        throw new Error(`Failed to save configuration: ${parsed.error.message}`);
    }
    await fs.writeJSON(configPath, config, { spaces: 2 });
};
export const getDefaultConfigPath = (cwd) => {
    return path.join(cwd, CONFIG_FILE_NAME);
};
