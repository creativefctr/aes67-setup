# AES67 Setup CLI

`aes67-setup` is a Node.js TypeScript CLI that helps you provision and run multichannel AES67 playback on a Raspberry Pi 5 (64-bit) using PipeWire.

## Features

- Interactive first-run wizard to select a multichannel sound card and capture stream details.
- Validates inputs including multicast address, channel names/count, network interface, and SDP file existence.
- Generates a JSON configuration stored adjacent to the runtime folder.
- Long-running runtime mode that prepares PipeWire, spawns PTP daemon (`ptp4l`) and clock sync (`phc2sys`), and monitors output.
- Verbose logging option to aid troubleshooting during deployment.

## Requirements

- Raspberry Pi OS 64-bit with PipeWire-based audio stack.
- PipeWire utilities (`pw-cli`, `pw-dump`), PTP daemon (`ptp4l`), and clock sync utility (`phc2sys`) installed and accessible on `PATH`.
- Node.js 20+ runtime (for development) and npm.

## Getting Started

```bash
npm install
npm run build
```

To test in development without compiling:

```bash
npm run dev -- --help
```

## Complete Setup Guide: Sender and Receiver

This guide walks through setting up a complete AES67 audio streaming solution using a Windows PC as the sender (with Dante Virtual Soundcard) and a Raspberry Pi 5 as the receiver (with this tool).

### Prerequisites

#### Sender (Windows PC)
- Windows 10 or 11
- [Dante Virtual Soundcard](https://www.audinate.com/products/software/dante-virtual-soundcard) (free trial or licensed version)
- [Dante Controller](https://www.audinate.com/products/software/dante-controller) (free download)
- Wired Ethernet connection (Gigabit recommended)

#### Receiver (Raspberry Pi 5)
- Raspberry Pi 5 with Raspberry Pi OS 64-bit
- Multichannel USB audio interface (e.g., Behringer UMC404HD, Focusrite Scarlett series)
- Wired Ethernet connection on the same network as the Windows PC
- This tool installed

### Network Setup

Both devices **must** be on the same network segment (same subnet) for multicast to work properly.

1. **Connect both devices** to the same network switch (avoid Wi-Fi)
2. **Verify connectivity**: Ping between devices to ensure they can communicate
3. **Disable firewalls** temporarily during setup, or configure them to allow:
   - UDP ports 5004 (RTP audio data)
   - UDP ports 319-320 (PTP clock sync)
   - Multicast traffic in the 239.x.x.x range

### Step 1: Configure the Sender (Windows with Dante)

#### Install and Configure Dante Virtual Soundcard

1. **Download and install** Dante Virtual Soundcard from [Audinate's website](https://www.audinate.com/products/software/dante-virtual-soundcard)
2. **Launch Dante Virtual Soundcard**
3. **Configure the virtual device**:
   - Click **"Start"** to enable the Dante virtual sound card
   - Set **Sample Rate** to `48000 Hz` (this must match the receiver)
   - Set **Channels** to the number you need (e.g., `8` for 7.1 surround)
   - Under **Network Interface**, select your wired Ethernet adapter
   - Click **"Apply"** and restart if prompted

#### Configure Dante Controller

1. **Download and install** [Dante Controller](https://www.audinate.com/products/software/dante-controller) (free)
2. **Launch Dante Controller**
3. **Verify your Dante device appears** in the device list (it should show your computer name with "DVS" suffix)
4. **Enable AES67 mode**:
   - Right-click your Dante Virtual Soundcard device
   - Select **"AES67 Config"**
   - Enable **"AES67 Mode"**
   - Set **Encoding** to `L24` (24-bit PCM) or `L16` (16-bit PCM)
   - Click **"Apply"** (the device will reboot)

#### Create and Export an AES67 Stream

1. **In Dante Controller**, find your device in the transmit list
2. **Right-click a transmit channel** and select **"Create Multicast Flow"**
3. **Configure the multicast flow**:
   - **Multicast Address**: Use an address like `239.69.100.1` (note this down)
   - **Port**: Use `5004` (default) or any port between 1024-65535 (note this down)
   - **Number of Channels**: Set to match your channel count (e.g., 8)
   - **Name**: Give it a meaningful name (e.g., "Main Output")
   - Click **"Create"**

4. **Export the SDP file**:
   - Right-click the multicast flow you just created
   - Select **"Export SDP File"**
   - Save the `.sdp` file (e.g., `dante-output.sdp`)
   - **Transfer this file** to your Raspberry Pi (use SCP, USB drive, or network share)
   - Place it at `/etc/aes67/dante-output.sdp` on the Raspberry Pi

5. **Route audio to the multicast flow**:
   - In the **Dante Controller routing matrix**, click the box where your audio source row meets your multicast flow column
   - A green checkmark indicates the route is active
   - Audio from your application (DAW, media player, etc.) should now flow to the multicast stream

#### Configure PTP Clock

Dante Virtual Soundcard typically acts as a PTP clock master by default.

1. **In Dante Controller**, click on your device
2. **View the PTP status** in the device info panel
3. **Note the PTP Domain**: Usually `0` (this must match the receiver)
4. **Verify clock status**: Should show "Master" or stable "Slave" status

### Step 2: Configure the Receiver (Raspberry Pi)

#### Prepare the Raspberry Pi

1. **Update the system**:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

2. **Install required dependencies**:
   ```bash
   sudo apt install -y pipewire pipewire-pulse wireplumber \
       pipewire-audio pipewire-alsa linuxptp \
       git nodejs npm alsa-utils
   ```

3. **Enable and start PipeWire**:
   ```bash
   systemctl --user enable pipewire pipewire-pulse wireplumber
   systemctl --user start pipewire pipewire-pulse wireplumber
   ```

4. **Connect your USB audio interface** and verify it's detected:
   ```bash
   aplay -l
   ```
   You should see your multichannel interface listed.

5. **Create the SDP directory**:
   ```bash
   sudo mkdir -p /etc/aes67
   sudo chmod 755 /etc/aes67
   ```

6. **Transfer the SDP file** from Windows to `/etc/aes67/dante-output.sdp`

#### Install and Configure This Tool

1. **Clone or download this repository**:
   ```bash
   cd /home/pi
   git clone <repository-url> aes67-setup
   cd aes67-setup
   ```

2. **Install and build**:
   ```bash
   npm install
   npm run build
   ```

3. **Run the configuration wizard**:
   ```bash
   node dist/index.js --verbose
   ```

4. **Answer the prompts** using the values from your Dante setup:

   | Prompt | Example Value | Notes |
   |--------|--------------|-------|
   | Sound card | Select your USB audio interface | Choose the device you want audio to play through |
   | Channel count | `8` | Must match Dante multicast flow channel count |
   | Channel names | `Left, Right, Center, LFE, LS, RS, LB, RB` | Name them in order for your application |
   | Sampling rate | `48000` | Must match Dante Virtual Soundcard sample rate |
   | Multicast address | `239.69.100.1` | Must match the address from Dante Controller |
   | SDP file path | `/etc/aes67/dante-output.sdp` | Path where you copied the SDP file |
   | Network interface | `eth0` | Your wired Ethernet interface (check with `ip link`) |
   | PTP domain | `0` | Must match Dante's PTP domain |
   | RTP destination port | `5004` | Must match the port from Dante Controller |
   | Session name | `Dante Main Output` | Any friendly name for logging |

5. **Start the receiver**:
   ```bash
   node dist/index.js --verbose
   ```

   You should see output indicating:
   - PipeWire is active
   - PTP daemon started
   - Clock sync started
   - PipeWire routing configured
   - "AES67 setup is active. Monitoring..."

### Step 3: Verify the Connection

#### On Windows (Sender)

1. **In Dante Controller**, verify:
   - Device shows "PTP Master" or synced status
   - Multicast flow shows active (green indicators)
   - Transmit meters show activity when audio is playing

2. **Play audio** from any application on Windows (routed through Dante Virtual Soundcard)

#### On Raspberry Pi (Receiver)

1. **Check PipeWire status**:
   ```bash
   pw-cli ls Node | grep -i aes67
   ```
   You should see your AES67 session node.

2. **Monitor audio levels** (if your interface has visual indicators, they should show activity)

3. **Check logs** for errors:
   - Look for "Linked X PipeWire ports" message
   - Verify no error messages about missing nodes or ports

4. **Listen for audio** on the connected speakers/outputs

### Troubleshooting

#### No Audio Received

1. **Verify multicast routing**:
   ```bash
   # On Raspberry Pi
   ip maddress show dev eth0
   ```
   You should see the multicast group listed.

2. **Capture network traffic**:
   ```bash
   sudo tcpdump -i eth0 host 239.69.100.1
   ```
   You should see RTP packets if the stream is active.

3. **Check PTP sync**:
   ```bash
   # The tool spawns ptp4l, check its output in verbose mode
   # Look for "master offset" values close to 0
   ```

4. **Verify SDP file**:
   ```bash
   cat /etc/aes67/dante-output.sdp
   ```
   Ensure the multicast address and port match your configuration.

#### Configuration Mismatch Issues

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| No RTP packets received | Wrong multicast address | Double-check address in Dante Controller and receiver config |
| Audio stuttering/dropouts | Network congestion or PTP not synced | Use dedicated network switch, verify PTP lock status |
| Wrong channel count | Mismatch between sender and receiver | Ensure Dante flow channel count matches receiver config |
| No clock sync | PTP domain mismatch | Verify both use same PTP domain (usually 0) |
| Choppy audio | Sample rate mismatch | Ensure both sides use 48000 Hz |

#### Key Configuration Matching Points

These settings **must match** between sender and receiver:

- ✅ **Sample Rate**: 48000 Hz on both sides
- ✅ **Multicast Address**: Exact match (e.g., 239.69.100.1)
- ✅ **RTP Port**: Same port (e.g., 5004)
- ✅ **Channel Count**: Same number of channels
- ✅ **PTP Domain**: Same domain number (usually 0)
- ✅ **Network Segment**: Both on same subnet

### Running at Boot (Optional)

To run the receiver automatically on Raspberry Pi startup:

1. **Create a systemd service**:
   ```bash
   sudo nano /etc/systemd/system/aes67-receiver.service
   ```

2. **Add the following content**:
   ```ini
   [Unit]
   Description=AES67 Receiver
   After=network-online.target sound.target
   Wants=network-online.target

   [Service]
   Type=simple
   User=pi
   WorkingDirectory=/home/pi/aes67-setup
   ExecStart=/usr/bin/node /home/pi/aes67-setup/dist/index.js --verbose
   Restart=on-failure
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

3. **Enable and start the service**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable aes67-receiver.service
   sudo systemctl start aes67-receiver.service
   ```

4. **Check status**:
   ```bash
   sudo systemctl status aes67-receiver.service
   ```

## Usage

### First Run (Configuration Wizard)

Run the CLI in an empty directory to generate `aes67-config.json`:

```bash
node dist/index.js --verbose
```

You will be prompted to:

- Select the multichannel sound card detected via `aplay -l`.
  - *Note:* Choose the physical audio interface that exposes the outputs you intend to drive. If unsure, unplug/plug the device and re-run to see which entry disappears/appears.
- Provide channel count and names.
  - *Note:* Enter the number of discrete outputs you plan to use (e.g., 8 for 7.1) and name them in playback order, such as `Left, Right, Center, LFE, Left Surround, Right Surround`.
- Specify sampling rate, multicast address, SDP file, network interface, PTP domain, RTP destination port, and session name.
  - *Sampling rate:* Use the stream’s sample rate (commonly `48000`). All devices on the network must match.
  - *Multicast address:* Enter the AES67 sender’s multicast IPv4 address (typically `239.x.x.x`). Confirm with the audio network administrator.
  - *SDP file:* Provide the path where the sender’s `.sdp` description is stored (e.g., `/etc/aes67/program.sdp`). The file must remain accessible.
  - *Network interface:* Specify the wired network interface that carries AES67 traffic (for example `eth0`). Avoid Wi-Fi interfaces.
  - *PTP domain:* Match the PTP domain used by the AES67 clock master (often `0`; consult your broadcaster/audio-over-IP setup).
  - *RTP destination port:* Use the UDP port announced by the sender (commonly `5004`). Ensure firewall rules allow this port.
  - *Session name:* Friendly label for logs and PipeWire nodes (e.g., `Main Program Feed`).

The tool persists the configuration and exits after the wizard completes.

### Runtime Mode

Subsequent invocations in the same directory reuse the saved configuration and start the runtime loop:

```bash
node dist/index.js --verbose
```

This mode performs health checks, starts PTP synchronisation and AES67 stream playback, and stays alive as a monitoring process. Use your init system (e.g., `systemd` service) to launch it on boot.

### Global Install (optional)

```bash
npm install -g .
aes67-setup --help
```

## How It Works

AES67 is a standard for moving high-quality audio streams across a network using regular Ethernet. This tool automates the moving pieces so you do not have to know every protocol or command. Below is a simplified overview of what happens after the configuration wizard finishes:

- **Why multicast matters**
  - AES67 streams are normally delivered using *multicast* networking. Multicast is a one-to-many delivery method: the sender pushes the audio once, and any listener that “joins” the multicast group receives the same packets. This avoids the sender having to duplicate traffic for each listener.
  - The configuration prompts you for a multicast IPv4 address (usually in the range `239.x.x.x`). PipeWire subscribes to that address so the Raspberry Pi can join the group and hear the program audio. Using the wrong address means the device will not see the packets, so the audio will never reach the sound card.

- **Clock alignment (PTP + phc2sys)**
  - Audio devices must share an accurate clock so that channels stay in sync. The tool launches `ptp4l`, which listens on the network for PTP (Precision Time Protocol) packets and aligns the Raspberry Pi to the studio clock source. It also starts `phc2sys`, which keeps the system clock and hardware clock aligned.

- **Receiving the AES67 audio (PipeWire RTP session)**
  - AES67 audio arrives as RTP (Real-time Transport Protocol) packets. Using `pw-cli`, the tool loads PipeWire's `libpipewire-module-rtp-session` with the SDP file configuration, turning the network stream into a PipeWire audio node.
  - SDP stands for *Session Description Protocol*; it is a simple text file that spells out what the stream looks like (network address, port, codecs, sample rate, channel layout, and timing details). The tool provides the SDP file path to the RTP session module so the stream can be decoded properly.
  - The tool inspects the PipeWire graph (`pw-dump`) to discover the freshly created stream node and the chosen output sound card. It then links the stream's outputs to the sound card inputs according to the channel names you provided.

Everything runs inside a long-lived loop so the AES67 session stays active. If the process receives a shutdown signal (like Ctrl+C), it tears down PipeWire links and stops the helper processes cleanly.

## Configuration File Structure

The generated JSON includes:

- `soundCardId`, `soundCardName`
- `channelCount`, `channelNames`
- `samplingRate`
- `multicastAddress`
- `sdpFilePath`
- `networkInterface`
- `ptpDomain`
- `rtpDestinationPort`
- `sessionName`
- `lastUpdated`

## Contributing

1. Fork the repo
2. Create a feature branch
3. Run linting (`npm run lint`) and tests/build
4. Submit a PR

## License

MIT

