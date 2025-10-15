import chalk from "chalk";
import inquirer from "inquirer";
import { execCommandSafe } from "./utils/exec.js";
const parseAplayOutput = (output) => {
    const cards = [];
    const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "");
    for (const line of lines) {
        const cardMatch = line.match(/^card (\d+): ([^[]+) \[([^\]]+)\], device (\d+): ([^[]+) \[([^\]]+)\]/i);
        if (cardMatch) {
            const [, cardId, cardName, cardLongName, deviceId, deviceName, deviceLongName] = cardMatch;
            const id = `${cardId}:${deviceId}`;
            const name = `${cardName.trim()} - ${deviceName.trim()}`;
            const description = `${cardLongName.trim()} / ${deviceLongName.trim()}`;
            // Fallback to stereo as default until parsed
            const channels = 2;
            cards.push({ id, name, description, channels });
        }
        const channelMatch = line.match(/Subdevices: (\d+)\/\d+/i);
        if (channelMatch && cards.length > 0) {
            const subdeviceCount = parseInt(channelMatch[1], 10);
            cards[cards.length - 1].channels = Math.max(subdeviceCount, cards[cards.length - 1].channels);
        }
    }
    return cards;
};
export const listSoundCards = async () => {
    const { stdout } = await execCommandSafe("aplay -l");
    return parseAplayOutput(stdout);
};
export const promptForSoundCard = async () => {
    const cards = await listSoundCards();
    if (cards.length === 0) {
        throw new Error("No sound cards detected. Ensure the device is connected and recognized by ALSA.");
    }
    const choices = cards.map((card) => ({
        name: `${card.name} (${chalk.gray(card.description)}) - Channels: ${card.channels}`,
        value: card.id,
        short: card.name,
    }));
    const { soundCardId } = await inquirer.prompt([
        {
            type: "list",
            name: "soundCardId",
            message: "Select the multichannel sound card to use for AES67 playback:",
            choices,
        },
    ]);
    const selectedCard = cards.find((card) => card.id === soundCardId);
    if (!selectedCard) {
        throw new Error("Selected sound card not found in list.");
    }
    return selectedCard;
};
