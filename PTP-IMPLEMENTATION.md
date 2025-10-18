# PTP Clock Synchronization Implementation

## Overview

This document explains the PTP (Precision Time Protocol) clock synchronization implementation for the AES67 sender on Windows.

## The Problem

GStreamer has native PTP clock support through the `GstPtpClock` API, but accessing it requires:
1. Calling `gst_ptp_init()` to initialize the PTP subsystem
2. Calling `gst_ptp_clock_new(domain)` to create a PTP clock instance
3. Calling `gst_pipeline_use_clock()` to set the pipeline to use the PTP clock

These functions are part of the GStreamer C API and **cannot be accessed** from the `gst-launch-1.0` command-line tool, which is what the Node.js implementation uses.

## Two Approaches to PTP Sync

### Approach 1: External PTP Client (System Clock Sync)

**Implementation:** Current Node.js tool (`src/gstreamer.ts`)

**How it works:**
```
PTP Client (PTPd) → System Clock → Jack Audio → GStreamer → RTP Packets
```

1. A Windows PTP client (like PTPd) syncs the system clock to the PTP grandmaster
2. Jack audio server uses the synchronized system clock
3. GStreamer's `jackaudiosrc` element gets timing from Jack
4. RTP payloader (`rtpL24pay`) timestamps packets based on the pipeline clock
5. Packets are sent with PTP-synchronized timestamps

**Requirements:**
- Windows PTP client (PTPd, Windows Time Service, etc.)
- Jack audio server
- GStreamer with Jack plugin
- This Node.js tool

**Pros:**
- System-wide synchronization
- All applications benefit from PTP-synced clock
- Works with existing Node.js implementation

**Cons:**
- Requires separate PTP client installation
- More complex setup
- Additional layer between PTP and GStreamer

### Approach 2: GStreamer Native PTP Clock

**Implementation:** Python script (`ptp-sender.py`)

**How it works:**
```
GStreamer PTP Clock API → Pipeline Clock → Jack Audio → RTP Packets
```

1. Python script calls `GstNet.ptp_init()` to initialize PTP subsystem
2. Creates `GstPtpClock` instance for the configured PTP domain
3. Sets this clock as the pipeline clock directly
4. GStreamer pipeline timestamps are based directly on PTP time
5. No external PTP daemon needed

**Requirements:**
- GStreamer 1.24+ (Windows PTP support added in this version)
- Python 3.7+
- PyGObject (GStreamer Python bindings)
- Jack audio server
- Configuration file created by Node.js tool

**Pros:**
- Direct PTP synchronization within GStreamer
- Better precision (pipeline clock IS the PTP clock)
- No external PTP daemon needed
- Native GStreamer 1.24+ feature

**Cons:**
- Requires Python runtime and PyGObject
- Only works with GStreamer 1.24+
- Different runtime than the Node.js tool

## File Overview

### 1. `src/gstreamer.ts`
The Node.js implementation that uses `gst-launch-1.0`. Updated to:
- Remove hallucinated PTP plugin checks
- Remove undefined PTP environment variables
- Document both synchronization approaches in comments
- Provide guidance on when to use the Python script

### 2. `ptp-sender.py`
Python script that uses GStreamer Python bindings to:
- Initialize PTP subsystem via `GstNet.ptp_init()`
- Create PTP clock for specified domain
- Create GStreamer pipelines programmatically
- Set PTP clock as pipeline clock
- Monitor synchronization status
- Handle multiple streams
- Generate SDP files

### 3. `requirements.txt`
Python dependencies for the PTP sender:
- PyGObject (GStreamer Python bindings)

### 4. `README.md`
Updated to include:
- Explanation of both PTP approaches
- Setup instructions for each approach
- Comparison of pros/cons
- Guidance on which approach to use

## Usage

### Using the Node.js Tool (Approach 1)

1. Install and configure Windows PTP client
2. Configure the tool:
   ```bash
   node dist\index.js
   ```
3. Run the sender:
   ```bash
   node dist\index.js --verbose
   ```

### Using the Python Script (Approach 2)

1. Ensure GStreamer 1.24+ is installed
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Create configuration using Node.js tool:
   ```bash
   node dist\index.js
   ```
   (This creates `aes67-config.json`)
4. Run the Python PTP sender:
   ```bash
   python ptp-sender.py -c aes67-config.json -v
   ```

## Technical Details

### GStreamer PTP Clock API

The Python script uses these GStreamer APIs:

```python
# Initialize PTP subsystem
GstNet.ptp_init(GstNet.PTP_CLOCK_ID_NONE, None)

# Create PTP clock for domain
ptp_clock = GstNet.PtpClock.new("PTPClock", domain)

# Wait for sync
ptp_clock.wait_for_sync(timeout)

# Set as pipeline clock
pipeline.use_clock(ptp_clock)

# Set base time
pipeline.set_base_time(ptp_clock.get_time())
```

### Why `gst-launch-1.0` Can't Use PTP Clock

The `gst-launch-1.0` tool:
- Parses command-line pipeline description
- Creates elements and links them
- Doesn't expose API for clock selection
- Uses default clock (system clock or element-provided clock)

To use `GstPtpClock`, you need:
- Programmatic pipeline creation (not command-line parsing)
- Access to GStreamer C API or language bindings
- Ability to call `gst_ptp_init()` before pipeline creation

This is why the Python script is necessary for native PTP support.

### GStreamer 1.24 Windows PTP Support

GStreamer 1.24 added Windows support for PTP clock:
- Previously PTP clock only worked on Linux/Unix
- Windows implementation added in version 1.24
- Uses Windows networking APIs for PTP communication
- Fully compatible with Linux PTP grandmasters

## Recommendations

For new installations on Windows with GStreamer 1.24+:
- ✅ **Use the Python script (Approach 2)** for best precision
- ✅ Provides direct PTP synchronization
- ✅ No external PTP daemon needed

For existing installations or if Python is not available:
- ✅ **Use the Node.js tool (Approach 1)** with external PTP client
- ✅ Works with any GStreamer version
- ✅ System-wide synchronization

Both approaches provide correct AES67 synchronization when properly configured.

## Testing Synchronization

To verify PTP synchronization is working:

### With Python Script
The script will print:
```
✓ PTP clock synchronized successfully
```

### With External PTP Client
Check PTP client logs for:
- "slave" state
- Small offset values (microseconds)
- No error messages

### Network Verification
Use Wireshark or tcpdump to verify:
- PTP Sync messages every 1-2 seconds
- PTP Follow_Up messages
- PTP Delay_Req/Resp exchanges

## Troubleshooting

### Python Script Issues

**"Failed to initialize PTP subsystem"**
- Ensure GStreamer 1.24+ is installed
- Check if running as administrator (Windows firewall)
- Verify network interface is up

**"PTP clock sync timeout"**
- Verify Raspberry Pi grandmaster is running
- Check network connectivity
- Ensure same PTP domain on both devices

### Node.js Tool Issues

**"PTP not synchronized"**
- Check external PTP client is running
- Verify PTP client is in slave mode
- Check PTP client logs for errors

## Future Enhancements

Possible improvements:
1. Native Node.js PTP implementation using N-API bindings
2. Auto-detection of GStreamer version to choose best approach
3. Unified interface that switches between approaches automatically
4. Real-time synchronization status monitoring in Node.js tool

