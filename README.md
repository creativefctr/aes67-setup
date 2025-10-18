# AES67 Setup CLI

`aes67-setup` is a Node.js TypeScript CLI that helps you provision and run multichannel AES67 audio streaming as either a **sender** (Windows with JackAudio + Gstreamer) or **receiver** (Raspberry Pi 5 with PipeWire).

## Features

- **Dual Mode Operation**: Configure as sender (transmit audio) or receiver (playback audio)
- Interactive first-run wizard to configure device mode and capture all necessary details
- **Sender Mode (Windows)**:
  - Uses JackAudio as audio source and Gstreamer for AES67 streaming
  - Supports multiple streams with configurable channels per receiver
  - Automatic stream distribution (e.g., 16 channels split into 2x8 channel streams)
  - PTP time synchronization (grandmaster or slave mode)
- **Receiver Mode (Raspberry Pi)**:
  - PipeWire-based multichannel AES67 playback
  - Automatic routing to multichannel sound cards
  - PTP synchronization with sender or external clock
- Validates inputs including multicast addresses, channel counts, network interfaces
- Generates a JSON configuration file for easy reconfiguration
- Verbose logging option to aid troubleshooting during deployment

## Requirements

### For Receiver Mode (Raspberry Pi)
- Raspberry Pi OS 64-bit with PipeWire-based audio stack
- PipeWire utilities (`pw-cli`, `pw-dump`), PTP daemon (`ptp4l`), and clock sync utility (`phc2sys`) installed and accessible on `PATH`
- Node.js 20+ runtime and npm
- Multichannel USB audio interface

### For Sender Mode (Windows)
- Windows 10 or 11
- [JackAudio for Windows](https://jackaudio.org/) installed and configured
- [Gstreamer 1.24+ for Windows](https://gstreamer.freedesktop.org/download/) with required plugins (PTP support added in 1.24)
- [Python 3.7+](https://www.python.org/downloads/) with PyGObject (GStreamer Python bindings)
- Node.js 20+ runtime and npm
- Wired Ethernet connection (Gigabit recommended)

## Getting Started

```bash
npm install
npm run build
```

To test in development without compiling:

```bash
npm run dev -- --help
```

## PTP Clock Topology: Grandmaster and Slave Modes

AES67 requires precise time synchronization between all devices using PTP (Precision Time Protocol). This tool now supports two PTP modes to accommodate different network topologies:

### Grandmaster Mode

Configure a Raspberry Pi as a **PTP grandmaster clock** when you want it to be the master timing source for your AES67 network. This is **required** when using a Windows sender, as Windows does not have a suitable PTP grandmaster implementation.

**Example Topology:**
```
                     ┌──→ Raspberry Pi #1 (Grandmaster - provides PTP timing + receives audio)
                     │
Network Switch ──────┼──→ Raspberry Pi #2 (Slave - receives audio)
                     │
                     ├──→ Raspberry Pi #3 (Slave - receives audio)
                     │
                     └──→ Windows Sender (Slave - syncs to Pi #1, sends audio)
```

In this setup:
- **Raspberry Pi #1** runs in grandmaster mode, provides the timing reference for the entire network, AND receives/plays audio
- **Raspberry Pi #2 and #3** run in slave mode and sync their clocks to Pi #1 while receiving audio
- **Windows Sender** runs in slave mode, syncing to Pi #1's clock while transmitting AES67 audio
- All devices stay perfectly synchronized to the grandmaster Pi
- The grandmaster Pi performs dual duty: timing source and audio receiver

### Slave Mode

Configure a device as a **PTP slave** when it should synchronize to an external timing source. This is the mode used by:

- **Windows sender**: Must always run in slave mode (syncing to a Raspberry Pi grandmaster)
- **Raspberry Pi receivers**: When receiving audio while another Pi acts as grandmaster
- **Any device syncing to a professional PTP grandmaster clock**

**Example Topology with External Grandmaster:**
```
Professional PTP Grandmaster ──→ Network Switch ──┬──→ Raspberry Pi #1 (Slave - receives audio)
                                                   ├──→ Raspberry Pi #2 (Slave - receives audio)
                                                   └──→ Windows Sender (Slave - sends audio)
```

### Configuration Notes

- All devices must be on the same **PTP domain** (typically domain `0`)
- All devices must be on the same network segment (same subnet, no routing)
- Only **one device** should be configured as grandmaster in a given PTP domain
- **When using a Windows sender, you MUST have at least one Raspberry Pi configured as grandmaster** (Windows does not support PTP grandmaster mode)
- **The grandmaster Pi is also an audio receiver** - it needs a sound card and receives audio like any other Pi receiver
- When using a Raspberry Pi as grandmaster, ensure it has a stable network connection (wired, not Wi-Fi)
- The Windows sender will always operate in slave mode, syncing to the Raspberry Pi grandmaster

## Complete Setup Guide: Sender and Receiver

This guide walks through setting up a complete AES67 audio streaming solution using this tool. The sender (Windows with JackAudio + Gstreamer) automatically generates SDP files that the receiver (Raspberry Pi with PipeWire) uses for configuration, ensuring perfect compatibility.

### Integrated End-to-End Solution

This tool provides a fully integrated solution where:
- **Sender automatically generates SDP files** for each stream with all the correct parameters
- **Receivers use these SDP files** to ensure configuration matches perfectly
- **All parameters are synchronized**: multicast addresses, ports, channel counts, sample rates
- **No manual configuration errors**: The sender creates the exact SDP files that receivers need

#### Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Setup Raspberry Pi Grandmaster (PTP Clock + Receiver)   │
│ - Configure one Pi in grandmaster mode (provides timing)        │
│ - This Pi ALSO receives and plays audio from the sender         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Configure Windows Sender                                │
│ - Total channels: 16                                             │
│ - Channels per receiver: 8                                       │
│ - Base multicast: 239.69.100.1                                   │
│ - Sample rate: 48000 Hz                                          │
│ - PTP mode: Slave (syncs to Pi grandmaster)                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Sender Generates SDP Files Automatically                │
│ - sdp-files/stream1.sdp (8ch @ 239.69.100.1:5004)              │
│ - sdp-files/stream2.sdp (8ch @ 239.69.100.2:5005)              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Copy SDP Files to Raspberry Pi Receiver(s)              │
│ scp sdp-files/*.sdp pi@raspberrypi:/home/pi/                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Configure Additional Receivers (if needed)              │
│ - Additional Pi 1: Uses stream1.sdp (slave mode)               │
│ - Additional Pi 2: Uses stream2.sdp (slave mode)               │
│ - Note: Grandmaster Pi is already configured as a receiver     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Start All Devices                                       │
│ ✓ Pi grandmaster provides timing AND receives audio            │
│ ✓ Windows sender syncs to Pi grandmaster, sends audio          │
│ ✓ Additional receivers sync to Pi grandmaster, receive audio   │
│ ✓ Perfect multichannel audio streaming across all devices      │
└─────────────────────────────────────────────────────────────────┘
```

#### Example Generated SDP File

When you start the sender, it generates SDP files like this:

```
v=0
o=- 1729612345000 1729612345000 IN IP4 239.69.100.1
s=AES67 Sender - Stream 1
c=IN IP4 239.69.100.1/32
t=0 0
m=audio 5004 RTP/AVP 96
a=rtpmap:96 L24/48000/8
a=recvonly
a=ptime:1
a=mediaclk:direct=0
```

This file contains all the information the receiver needs:
- Multicast address: `239.69.100.1`
- Port: `5004`
- Encoding: `L24` (24-bit PCM, AES67 standard)
- Sample rate: `48000` Hz
- Channels: `8`

### Prerequisites

#### For Windows Sender Setup
- Windows 10 or 11
- [JackAudio for Windows](https://jackaudio.org/downloads/) installed and running
- [Gstreamer 1.24+ for Windows](https://gstreamer.freedesktop.org/download/) with plugins (Windows PTP support added in 1.24)
- [Python 3.7+](https://www.python.org/downloads/) with PyGObject installed
- Node.js 20+ runtime and npm
- Wired Ethernet connection (Gigabit recommended)
- Audio application that can output to Jack (e.g., DAW, media player with Jack support)
- **At least one Raspberry Pi configured as PTP grandmaster** (provides PTP timing reference)

#### For Raspberry Pi Receiver/Grandmaster Setup
- Raspberry Pi 5 with Raspberry Pi OS 64-bit
- Multichannel USB audio interface (e.g., Behringer UMC404HD, Focusrite Scarlett series) - **required for all receivers including grandmaster**
- Wired Ethernet connection
- This tool installed
- **One Pi must be configured as grandmaster** to provide PTP timing for the Windows sender (this Pi also receives audio)

### Network Setup

All devices **must** be on the same network segment (same subnet) for multicast to work properly.

1. **Connect all devices** to the same network switch (avoid Wi-Fi)
2. **Verify connectivity**: Ping between devices to ensure they can communicate
3. **Disable firewalls** temporarily during setup, or configure them to allow:
   - UDP ports 5004 (RTP audio data)
   - UDP ports 319-320 (PTP clock sync)
   - Multicast traffic in the 239.x.x.x range

#### Important: PTP Clock Setup Order

1. **First**, configure and start the Raspberry Pi grandmaster (which also receives audio)
2. **Then**, start the Windows sender (it will sync to the Pi grandmaster and send audio)
3. **Finally**, start any additional Raspberry Pi receivers (they will sync to the grandmaster)

This order ensures proper PTP synchronization across all devices. Remember: the grandmaster Pi is both a timing source AND an audio receiver.

### Step 0: Setup Raspberry Pi Grandmaster (Required First Step)

Before configuring the Windows sender, you must set up at least one Raspberry Pi as the PTP grandmaster clock. This Pi provides timing synchronization for all devices on the network AND receives/plays audio.

#### Quick Grandmaster Setup

1. **Install this tool** on a Raspberry Pi following the standard installation steps (see Step 2 below)
2. **Connect your USB audio interface** to this Pi (it will receive and play audio)
3. **Run the configuration wizard** and select **"Receiver"** mode
4. **When asked for PTP mode**, select **"Grandmaster"** 
5. **Configure it like any other receiver** - select sound card, channels, SDP file, etc.
6. **Start the tool** - it will provide PTP timing to the network AND receive audio

**Note:** The grandmaster Pi performs dual duty:
- Provides PTP clock synchronization for the entire network (Windows sender + all other receivers)
- Receives and plays audio from the Windows sender (just like any other receiver)
- Must remain running for the entire duration of your AES67 session

### Step 1: Configure the Sender (Windows with JackAudio + Gstreamer)

#### Install and Configure JackAudio

1. **Download and install** JackAudio for Windows from [jackaudio.org](https://jackaudio.org/downloads/)
2. **Launch QjackCtl** (Jack control application) or Jack server
3. **Configure Jack**:
   - Set **Sample Rate** to `48000 Hz` (this must match the receiver)
   - Set **Frames/Period** to `256` or `512` (lower for less latency)
   - Select your audio **Interface** (could be ASIO, Windows Audio, etc.)
   - Click **"Start"** to start the Jack server
4. **Verify Jack is running**:
   - Open a command prompt and run: `jack_lsp`
   - You should see a list of available Jack ports

#### Install Gstreamer

1. **Download Gstreamer 1.24+** for Windows from [gstreamer.freedesktop.org](https://gstreamer.freedesktop.org/download/)
   - **Important:** Version 1.24 or later is required for Windows PTP clock support
2. **Install both packages**:
   - gstreamer-1.0-msvc-x86_64.msi (runtime)
   - gstreamer-1.0-devel-msvc-x86_64.msi (development, includes plugins)
3. **Add Gstreamer to PATH**:
   - Add `C:\gstreamer\1.0\msvc_x86_64\bin` to your system PATH environment variable
4. **Verify installation**:
   - Open a command prompt and run: `gst-launch-1.0 --version`
   - You should see version 1.24 or later

#### Install Python and Dependencies

1. **Download and install Python 3.7+** from [python.org](https://www.python.org/downloads/)
   - Make sure to check "Add Python to PATH" during installation
2. **Verify Python installation**:
   ```bash
   python --version
   ```
3. **Install PyGObject** (GStreamer Python bindings):
   ```bash
   pip install PyGObject
   ```
   - On Windows, you may need to download a wheel from [pygobject releases](https://github.com/pygobject/pygobject/releases)
4. **Verify PyGObject installation**:
   ```bash
   python -c "import gi; gi.require_version('Gst', '1.0'); print('PyGObject OK')"
   ```

#### Configure Your Audio Application

1. **Configure your DAW or audio application** to output to Jack
   - Most professional audio applications support Jack audio routing
   - Examples: Reaper, Ardour, VLC (with Jack plugin), etc.
2. **Set the application's sample rate** to `48000 Hz` to match Jack
3. **Route audio to Jack ports** using QjackCtl's patchbay or connections window

#### Install and Configure This Tool

1. **Clone or download this repository**:
   ```bash
   cd C:\path\to\your\projects
   git clone <repository-url> aes67-setup
   cd aes67-setup
   ```

2. **Install and build**:
   ```bash
   npm install
   npm run build
   ```

3. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
   This installs PyGObject (GStreamer Python bindings) needed for PTP synchronization.

4. **Run the configuration wizard**:
   ```bash
   node dist\index.js --verbose
   ```
   
   The tool will automatically verify that Python and PyGObject are installed.

5. **Select "Sender" mode** and answer the prompts:

   | Prompt | Example Value | Notes |
   |--------|--------------|-------|
   | Device Mode | `Sender` | Choose sender for Windows with Gstreamer |
   | Total channels | `16` | Total number of audio channels to send |
   | Channels per receiver | `8` | Creates multiple streams (e.g., 16 channels = 2 streams of 8 channels each) |
   | Jack client name | `MyAudioApp` | Name of your Jack client providing audio |
   | Sampling rate | `48000` | Must match Jack and receiver configuration |
   | Base multicast address | `239.69.100.1` | Will auto-increment for each stream |
   | Network interface | `Ethernet` | Your wired network adapter name |
   | PTP domain | `0` | Must match the Raspberry Pi grandmaster's PTP domain |
   | PTP mode | `Slave` | Always Slave for Windows (syncs to Raspberry Pi grandmaster) |
   | Base RTP port | `5004` | Will auto-increment for each stream |
   | Session name | `AES67 Sender` | Friendly name for logging |

6. **Start the sender**:
   ```bash
   node dist\index.js --verbose
   ```

   The tool will:
   - Verify Python and PyGObject are installed
   - Start Python PTP sender script with proper PTP synchronization
   - Create Gstreamer pipelines for each stream
   - **Automatically generate SDP files** in the `sdp-files` directory
   - Display Jack client names for connection

   Example output:
   ```
   [INFO] Starting Python PTP sender script...
   ✓ PTP clock synchronized successfully
   Generated SDP file: C:\path\to\aes67-setup\sdp-files\stream1.sdp
   Generated SDP file: C:\path\to\aes67-setup\sdp-files\stream2.sdp
   ```

7. **Connect Jack audio**:
   - The tool creates Jack clients named `<YourClientName>_stream0`, `<YourClientName>_stream1`, etc.
   - Use QjackCtl's "Connect" window or `jack_connect` command to route audio from your application to these clients
   - Each stream client will have inputs corresponding to the channels for that stream

8. **Transfer SDP files to receivers**:
   - The generated SDP files in the `sdp-files` directory contain all configuration for each stream
   - Copy these files to your Raspberry Pi receiver(s) using SCP, USB drive, or network share
   - Example: `scp sdp-files/*.sdp pi@raspberrypi:/home/pi/`

### Step 1.5: Python Dependencies for PTP Clock Synchronization

This tool uses GStreamer's native PTP clock support for proper AES67 synchronization. This requires Python and PyGObject (GStreamer Python bindings).

**Why Python?**
GStreamer's PTP clock requires API calls (`gst_ptp_init()`, `gst_ptp_clock_new()`) that aren't accessible from the `gst-launch-1.0` command-line tool. The Node.js tool automatically invokes a Python script that uses GStreamer's Python bindings to properly initialize PTP synchronization.

**Setup:**
1. **Ensure you have GStreamer 1.24 or later** installed (Windows PTP support added in 1.24):
   ```bash
   gst-launch-1.0 --version
   ```

2. **Install Python 3.7+** from [python.org](https://www.python.org/downloads/) if not already installed

3. **Install PyGObject** (GStreamer Python bindings):
   ```bash
   pip install PyGObject
   ```
   
   Or download the appropriate wheel from [here](https://github.com/pygobject/pygobject/releases)

4. **Install Python dependencies** (from the project directory):
   ```bash
   pip install -r requirements.txt
   ```

**How it works:**
1. You configure and run the Node.js tool as normal
2. The tool automatically detects Python and PyGObject
3. Behind the scenes, it invokes `ptp-sender.py` which:
   - Initializes GStreamer's PTP subsystem
   - Creates a PTP clock synchronized to your Raspberry Pi grandmaster
   - Sets up GStreamer pipelines with proper PTP timestamps
4. All streams use PTP-synchronized RTP timestamps for perfect multi-device sync

**Benefits:**
- ✅ Direct PTP synchronization within GStreamer (no external PTP daemon needed)
- ✅ Best possible clock precision (pipeline clock IS the PTP clock)
- ✅ Fully automated - the Node.js tool handles everything
- ✅ Native GStreamer 1.24+ feature

The integration is seamless - you use the Node.js tool as documented, and it automatically uses Python for proper PTP support.

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

5. **Create the SDP directory and copy SDP files** from sender:
   ```bash
   sudo mkdir -p /etc/aes67
   sudo chmod 755 /etc/aes67
   ```

6. **Copy the SDP file(s)** generated by the sender to the Raspberry Pi:
   ```bash
   # If you copied them to your home directory
   sudo cp ~/stream1.sdp /etc/aes67/
   sudo chmod 644 /etc/aes67/stream1.sdp
   ```
   
   The SDP files from the sender already contain all the correct configuration:
   - Multicast address
   - RTP port
   - Sample rate
   - Channel count
   - AES67-compliant encoding (L24)
   
   No manual editing required!

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

4. **Select "Receiver" mode** and answer the prompts:

   | Prompt | Example Value | Notes |
   |--------|--------------|-------|
   | Device Mode | `Receiver` | Choose receiver for Raspberry Pi |
   | Sound card | Select your USB audio interface | Choose the device you want audio to play through |
   | Channel count | `8` | Match the channel count from sender's SDP file |
   | Channel names | `Left, Right, Center, LFE, LS, RS, LB, RB` | Name them in order for your application |
   | Sampling rate | `48000` | Match the sample rate from sender (usually 48000) |
   | Multicast address | `239.69.100.1` | Match the multicast address from sender's SDP file |
   | SDP file path | `/etc/aes67/stream1.sdp` | Path to the SDP file copied from sender |
   | Network interface | `eth0` | Your wired Ethernet interface (check with `ip link`) |
   | PTP domain | `0` | Match sender's PTP domain (usually 0) |
   | PTP mode | `Slave` | Choose **Slave** to sync to sender grandmaster |
   | RTP destination port | `5004` | Match the port from sender's SDP file |
   | Session name | `AES67 Receiver Stream 1` | Friendly name for logging |
   
   **Tip:** The SDP file from the sender contains all the network parameters. You can view it to see the exact values:
   ```bash
   cat /etc/aes67/stream1.sdp
   ```

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

1. **Verify Jack connections** in QjackCtl:
   - Open the "Connect" window
   - Ensure your audio source is connected to the stream clients
   - You should see audio flowing in the Jack meter

2. **Check Gstreamer output** in the console:
   - Look for successful pipeline creation messages
   - Verify no error messages

3. **Play audio** from your application (routed through Jack)

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
   cat /etc/aes67/stream1.sdp
   ```
   Ensure the multicast address and port match the sender's configuration.

#### Configuration Mismatch Issues

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| No RTP packets received | Wrong multicast address | Verify address in receiver config matches sender's SDP file |
| Audio stuttering/dropouts | Network congestion or PTP not synced | Use dedicated network switch, verify PTP lock status |
| Wrong channel count | Mismatch between sender and receiver | Use the exact channel count from sender's SDP file |
| No clock sync | PTP domain mismatch | Verify both use same PTP domain (usually 0) |
| Choppy audio | Sample rate mismatch | Ensure receiver uses same sample rate as sender (check SDP file) |
| No audio | SDP file mismatch | Re-copy SDP file from sender, ensure it's the correct stream |

#### Key Configuration Matching Points

These settings **must match** between sender and receiver:

- ✅ **Sample Rate**: 48000 Hz (defined in sender, contained in SDP file)
- ✅ **Multicast Address**: Exact match (contained in SDP file)
- ✅ **RTP Port**: Same port (contained in SDP file)
- ✅ **Channel Count**: Same number of channels (contained in SDP file)
- ✅ **PTP Domain**: Same domain number (usually 0, configured on both)
- ✅ **Network Segment**: Both on same subnet

**Important:** The sender automatically generates SDP files with all the correct parameters. Using these SDP files on the receiver ensures perfect configuration matching.

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

Run the CLI to generate `aes67-config.json`:

```bash
node dist/index.js --verbose
```

You will be prompted to:

1. **Select device mode** (Sender or Receiver)

#### For Receiver Mode:

- Select the multichannel sound card detected via `aplay -l`.
  - *Note:* Choose the physical audio interface that exposes the outputs you intend to drive. If unsure, unplug/plug the device and re-run to see which entry disappears/appears.
- Provide channel count and names.
  - *Note:* Enter the number of discrete outputs you plan to use (e.g., 8 for 7.1) and name them in playback order, such as `Left, Right, Center, LFE, Left Surround, Right Surround`.
- Specify sampling rate, multicast address, SDP file, network interface, PTP domain, RTP destination port, and session name.
  - *Sampling rate:* Use the stream's sample rate (commonly `48000`). All devices on the network must match.
  - *Multicast address:* Enter the AES67 sender's multicast IPv4 address (typically `239.x.x.x`).
  - *SDP file:* Provide the path where the sender's `.sdp` description is stored (e.g., `/etc/aes67/program.sdp`). The file must remain accessible.
  - *Network interface:* Specify the wired network interface that carries AES67 traffic (for example `eth0`). Avoid Wi-Fi interfaces.
  - *PTP domain:* Match the PTP domain used by the AES67 clock master (often `0`).
  - *PTP mode:* 
    - Select **Grandmaster** if this Pi will provide PTP timing for the network (required when using Windows sender)
    - Select **Slave** to sync to an external PTP clock or another Pi grandmaster
  - *RTP destination port:* Use the UDP port announced by the sender (commonly `5004`). Ensure firewall rules allow this port.
  - *Session name:* Friendly label for logs (e.g., `Main Program Feed`).

#### For Sender Mode:

- Specify total number of channels to send.
- Specify channels per receiver (determines how many streams will be created).
- Provide Jack client name (your audio application's Jack client).
- Specify sampling rate, base multicast address, network interface, PTP domain, base RTP port, and session name.
  - *Total channels:* Total number of audio channels your application provides (e.g., `16`).
  - *Channels per receiver:* How many channels per stream (e.g., `8` would create 2 streams for 16 channels).
  - *Jack client name:* Name to identify the Jack clients created for streaming.
  - *Sampling rate:* Sample rate (commonly `48000`). Must match Jack configuration.
  - *Base multicast address:* Starting multicast address (e.g., `239.69.100.1`). Each stream will increment the last octet.
  - *Network interface:* Your wired network interface name (e.g., `Ethernet` on Windows).
  - *PTP domain:* PTP domain number (typically `0`). Must match the Raspberry Pi grandmaster.
  - *PTP mode:* Always **Slave** for Windows sender (syncs to Raspberry Pi grandmaster). Windows does not support grandmaster mode.
  - *Base RTP port:* Starting UDP port (e.g., `5004`). Each stream will increment by 1.
  - *Session name:* Friendly label for logs (e.g., `AES67 Sender`).

The tool persists the configuration and exits after the wizard completes.

### Runtime Mode

Subsequent invocations in the same directory reuse the saved configuration and start the runtime loop:

```bash
node dist/index.js --verbose
```

**For Receiver Mode:**
- Performs health checks on PipeWire
- Starts PTP synchronization
- Loads RTP session and routes audio to sound card
- Stays alive as a monitoring process

**For Sender Mode:**
- Verifies Jack, Gstreamer, Python, and PyGObject are installed
- Starts Python PTP sender script for proper PTP clock synchronization
- Creates Gstreamer pipelines for each stream with PTP-synchronized RTP timestamps
- Generates SDP files for receivers
- Stays alive as a monitoring process
- You need to manually connect Jack ports from your audio source to the stream clients

Use your init system (e.g., `systemd` service) to launch it on boot.

### Global Install (optional)

```bash
npm install -g .
aes67-setup --help
```

## How It Works

AES67 is a standard for moving high-quality audio streams across a network using regular Ethernet. This tool automates the moving pieces for both sending and receiving audio. Below is a simplified overview of what happens after the configuration wizard finishes:

### Receiver Mode (Raspberry Pi)

- **Why multicast matters**
  - AES67 streams are normally delivered using *multicast* networking. Multicast is a one-to-many delivery method: the sender pushes the audio once, and any listener that "joins" the multicast group receives the same packets. This avoids the sender having to duplicate traffic for each listener.
  - The configuration prompts you for a multicast IPv4 address (usually in the range `239.x.x.x`). PipeWire subscribes to that address so the Raspberry Pi can join the group and hear the program audio. Using the wrong address means the device will not see the packets, so the audio will never reach the sound card.

- **Clock alignment (PTP + phc2sys)**
  - Audio devices must share an accurate clock so that channels stay in sync. The tool launches `ptp4l`, which listens on the network for PTP (Precision Time Protocol) packets and aligns the Raspberry Pi to the studio clock source. It also starts `phc2sys`, which keeps the system clock and hardware clock aligned.

- **Receiving the AES67 audio (PipeWire RTP session)**
  - AES67 audio arrives as RTP (Real-time Transport Protocol) packets. Using `pw-cli`, the tool loads PipeWire's `libpipewire-module-rtp-session` with the SDP file configuration, turning the network stream into a PipeWire audio node.
  - SDP stands for *Session Description Protocol*; it is a simple text file that spells out what the stream looks like (network address, port, codecs, sample rate, channel layout, and timing details). The tool provides the SDP file path to the RTP session module so the stream can be decoded properly.
  - The tool inspects the PipeWire graph (`pw-dump`) to discover the freshly created stream node and the chosen output sound card. It then links the stream's outputs to the sound card inputs according to the channel names you provided.

### Sender Mode (Windows)

- **JackAudio for flexible routing**
  - JackAudio provides a professional audio routing system on Windows. Your audio applications (DAW, media players, etc.) output to Jack, and this tool connects to Jack to capture the audio for streaming.
  - You configure the tool with your Jack client name and channel count. The tool creates Jack clients for each stream that you manually connect using QjackCtl or `jack_connect`.

- **Python PTP sender for proper synchronization**
  - The Node.js tool automatically invokes a Python script (`ptp-sender.py`) that handles GStreamer pipeline creation with proper PTP clock synchronization.
  - The Python script uses PyGObject (GStreamer Python bindings) to access GStreamer's PTP clock API:
    - Calls `gst_ptp_init()` to initialize PTP subsystem
    - Creates `GstPtpClock` synchronized to Raspberry Pi grandmaster
    - Sets PTP clock as pipeline clock
    - This ensures RTP timestamps are based directly on PTP time
  - This approach is necessary because PTP clock initialization requires C API access not available from `gst-launch-1.0`.

- **Gstreamer pipelines for AES67 streaming**
  - The Python script creates one Gstreamer pipeline for each stream. Each pipeline:
    - Connects to Jack using `jackaudiosrc` to capture audio
    - Converts and resamples audio to the correct format
    - Packages audio as RTP with 24-bit PCM encoding (`rtpL24pay`) for AES67 compatibility
    - Uses PTP-synchronized pipeline clock for RTP timestamps
    - Sends to multicast address using `udpsink`
  - Multiple streams are automatically configured based on your channels-per-receiver setting. For example, 16 channels with 8 channels-per-receiver creates 2 streams at sequential multicast addresses.

- **SDP file generation**
  - The Node.js tool automatically generates SDP files for each stream containing all network parameters
  - These SDP files are used by receivers to ensure perfect configuration matching

Everything runs inside a long-lived loop so the AES67 session stays active. If the process receives a shutdown signal (like Ctrl+C), it tears down connections and stops the helper processes cleanly.

## Configuration File Structure

The generated JSON includes:

- `deviceMode` - Either `"sender"` or `"receiver"`
- `soundCardId`, `soundCardName` (receiver mode only)
- `channelCount`, `channelNames`
- `samplingRate`
- `multicastAddress`
- `sdpFilePath` (receiver mode only)
- `networkInterface`
- `ptpDomain`
- `ptpMode` - Either `"grandmaster"` or `"slave"`
- `rtpDestinationPort`
- `sessionName`
- `lastUpdated`
- `jackClientName` (sender mode only)
- `channelsPerReceiver` (sender mode only)
- `baseMulticastAddress` (sender mode only)

## Contributing

1. Fork the repo
2. Create a feature branch
3. Run linting (`npm run lint`) and tests/build
4. Submit a PR

## License

MIT

