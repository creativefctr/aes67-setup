import { execCommandSafe } from "./utils/exec.js";
const toStringRecord = (input) => {
    const output = {};
    if (!input) {
        return output;
    }
    for (const [key, value] of Object.entries(input)) {
        if (value === undefined || value === null) {
            // eslint-disable-next-line no-continue
            continue;
        }
        output[key] = String(value);
    }
    return output;
};
const sanitizeNodeName = (value) => {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-+|-+$)/g, "")
        .slice(0, 60) || "aes67-session";
};
const fetchGraph = async (logger) => {
    const { stdout } = await execCommandSafe("pw-dump");
    if (!stdout) {
        throw new Error("pw-dump returned no data. Ensure PipeWire is running with dumping enabled.");
    }
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch (error) {
        logger.error(`Failed to parse pw-dump output: ${error.message}`);
        throw new Error("Unable to parse PipeWire graph (pw-dump). Ensure pw-dump is available and returns JSON.");
    }
    const nodes = new Map();
    const ports = new Map();
    for (const entry of parsed) {
        const props = toStringRecord(entry.info?.props);
        if (entry.type.includes("Node")) {
            nodes.set(entry.id, {
                id: entry.id,
                props,
                ports: [],
            });
        }
        else if (entry.type.includes("Port")) {
            const nodeId = parseInt(props["node.id"] ?? "", 10);
            if (Number.isNaN(nodeId)) {
                continue;
            }
            const port = {
                id: entry.id,
                nodeId,
                props,
            };
            ports.set(entry.id, port);
            const node = nodes.get(nodeId);
            if (node) {
                node.ports.push(port);
            }
        }
    }
    return { nodes, ports };
};
const normalize = (value) => value.trim().toLowerCase();
const findSinkNode = (graph, logger, soundCardName) => {
    const target = normalize(soundCardName);
    const candidates = Array.from(graph.nodes.values()).filter((node) => node.props["media.class"] === "Audio/Sink");
    const match = candidates.find((candidate) => {
        const description = normalize(candidate.props["node.description"] ?? candidate.props["device.description"] ?? "");
        return description.includes(target);
    });
    if (match) {
        return match;
    }
    const fallback = candidates[0];
    if (!fallback) {
        logger.error("No PipeWire sink nodes found. Ensure ALSA/PipeWire bridge is active.");
    }
    return fallback;
};
const findSessionNode = (graph, logger, sessionName, sanitizedName) => {
    const target = normalize(sessionName);
    const nodes = Array.from(graph.nodes.values()).filter((node) => {
        const sessName = normalize(node.props["sess.name"] ?? "");
        const nodeName = normalize(node.props["node.name"] ?? "");
        const desc = normalize(node.props["node.description"] ?? "");
        return sessName.includes(target) || nodeName.includes(target) || nodeName.includes(sanitizedName) || desc.includes(target);
    });
    if (nodes.length > 0) {
        return nodes[0];
    }
    logger.warn(`Unable to locate PipeWire session node for '${sessionName}'. Dumping available node names: ${Array.from(graph.nodes.values())
        .map((node) => node.props["node.name"] ?? node.props["node.description"] ?? String(node.id))
        .join(", ")}`);
    return undefined;
};
const orderPorts = (ports, direction) => {
    return ports
        .filter((port) => (port.props["port.direction"] ?? "").toLowerCase() === direction)
        .sort((a, b) => a.id - b.id);
};
const matchPorts = (sessionPorts, sinkPorts, channelNames, logger) => {
    if (sessionPorts.length === 0) {
        throw new Error("Session node exposes no output ports. Check the RTP session configuration.");
    }
    if (sinkPorts.length < sessionPorts.length) {
        logger.warn(`Sink only has ${sinkPorts.length} inputs while session provides ${sessionPorts.length} outputs. Excess outputs will be dropped.`);
    }
    const normalizedChannels = channelNames.map((name) => normalize(name));
    const matches = [];
    const usedInputs = new Set();
    const findInputForChannel = (channel, fallbackIndex) => {
        const directMatch = sinkPorts.find((port) => {
            if (usedInputs.has(port.id)) {
                return false;
            }
            const portName = normalize(port.props["port.name"] ?? "");
            return portName.includes(channel);
        });
        if (directMatch) {
            return directMatch;
        }
        return sinkPorts.find((port, index) => !usedInputs.has(port.id) && index === fallbackIndex);
    };
    sessionPorts.forEach((sessionPort, index) => {
        const channel = normalizedChannels[index] ?? normalizedChannels[0] ?? "";
        const input = findInputForChannel(channel, index);
        if (!input) {
            logger.warn(`No available sink input port found for session output ${sessionPort.props["port.name"] ?? sessionPort.id}. Skipping link.`);
            return;
        }
        usedInputs.add(input.id);
        matches.push({ output: sessionPort, input });
    });
    return matches;
};
const shellQuote = (value) => {
    if (value === "") {
        return "''";
    }
    return `'${value.replace(/'/g, "'\\''")}'`;
};
const loadRtpSessionModule = async (config, logger, sanitizedName) => {
    const spaProps = {
        "sess.mode": "receiver",
        "sess.name": config.sessionName,
        "local.ifname": config.networkInterface,
        "remote.host": config.multicastAddress,
        "remote.port": config.rtpDestinationPort,
        "format.media": "audio",
        "format.rate": config.samplingRate,
        "format.channels": config.channelCount,
        "stream.props": JSON.stringify({
            "node.description": config.sessionName,
            "node.name": sanitizedName,
            "media.class": "Stream/Input/Audio",
        }),
        "sess.latency.msec": 20,
        "sdp.file": config.sdpFilePath,
    };
    const args = Object.entries(spaProps)
        .map(([key, value]) => `${key}=${shellQuote(String(value))}`)
        .join(" ");
    logger.verboseLog(`Loading PipeWire RTP session module with args: ${args}`);
    const { stdout } = await execCommandSafe(`pw-cli load-module libpipewire-module-rtp-session ${args}`);
    const match = stdout.match(/(\d+)/);
    if (!match) {
        throw new Error(`Failed to parse module id from PipeWire response: '${stdout}'`);
    }
    const moduleId = Number.parseInt(match[1], 10);
    if (Number.isNaN(moduleId)) {
        throw new Error(`PipeWire returned invalid module id: '${stdout}'`);
    }
    return moduleId;
};
const waitForSessionNode = async (logger, sanitizedName, sessionName, retries = 10, intervalMs = 500) => {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        const graph = await fetchGraph(logger);
        const node = findSessionNode(graph, logger, sessionName, sanitizedName);
        if (node) {
            return node;
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error("Timed out waiting for PipeWire RTP session node to appear.");
};
const createLink = async (outputPortId, inputPortId) => {
    const payload = shellQuote(JSON.stringify({ "output.port": outputPortId, "input.port": inputPortId }));
    const { stdout } = await execCommandSafe(`pw-cli create Link ${payload}`);
    const match = stdout.match(/(\d+)/);
    if (!match) {
        throw new Error(`Failed to create PipeWire link between ports ${outputPortId} and ${inputPortId}: ${stdout}`);
    }
    return Number.parseInt(match[1], 10);
};
export const setupPipewireRouting = async (config, logger) => {
    const sanitizedName = `aes67-${sanitizeNodeName(config.sessionName)}`;
    const moduleId = await loadRtpSessionModule(config, logger, sanitizedName);
    const sessionNode = await waitForSessionNode(logger, sanitizedName, config.sessionName);
    const graph = await fetchGraph(logger);
    const sinkNode = findSinkNode(graph, logger, config.soundCardName);
    if (!sinkNode) {
        throw new Error("Unable to locate PipeWire sink for selected sound card. Verify the ALSA device is available in PipeWire.");
    }
    const sessionOutputs = orderPorts(sessionNode.ports, "output");
    const sinkInputs = orderPorts(sinkNode.ports, "input");
    const matches = matchPorts(sessionOutputs, sinkInputs, config.channelNames, logger);
    if (matches.length === 0) {
        throw new Error("No port matches were established between session and sink. Cannot proceed with routing.");
    }
    const linkIds = [];
    for (const match of matches) {
        // eslint-disable-next-line no-await-in-loop
        const linkId = await createLink(match.output.id, match.input.id);
        linkIds.push(linkId);
    }
    logger.info(`Linked ${linkIds.length} PipeWire ports from RTP session '${config.sessionName}' to sink '${sinkNode.props["node.description"] ?? sinkNode.props["node.name"] ?? sinkNode.id}'.`);
    return {
        moduleId,
        linkIds,
        sessionNodeId: sessionNode.id,
        sessionNodeName: sessionNode.props["node.name"] ?? sanitizedName,
    };
};
export const teardownPipewireRouting = async (state, logger) => {
    if (!state) {
        return;
    }
    for (const linkId of state.linkIds) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await execCommandSafe(`pw-cli destroy ${linkId}`);
            logger.verboseLog(`Removed PipeWire link ${linkId}.`);
        }
        catch (error) {
            logger.warn(`Failed to remove PipeWire link ${linkId}: ${error.message}`);
        }
    }
    if (state.moduleId) {
        try {
            await execCommandSafe(`pw-cli destroy ${state.moduleId}`);
            logger.verboseLog(`Unloaded PipeWire module ${state.moduleId}.`);
        }
        catch (error) {
            logger.warn(`Failed to unload PipeWire module ${state.moduleId}: ${error.message}`);
        }
    }
};
