# Integration Summary: Node.js + Python PTP Sender

## Overview

The AES67 sender now uses an integrated Node.js + Python solution for proper PTP clock synchronization on Windows.

## How It Works

```
User runs:  node dist/index.js --verbose
     ↓
Node.js tool:
  - Interactive configuration wizard
  - Validates Jack, GStreamer, Python, PyGObject
  - Saves configuration to aes67-config.json
  - Spawns Python script with config path
  - Generates SDP files for receivers
  - Monitors and manages Python process
     ↓
Python script (ptp-sender.py):
  - Initializes GStreamer PTP subsystem
  - Creates GstPtpClock synced to Pi grandmaster
  - Creates GStreamer pipelines with PTP clock
  - Connects to Jack for audio capture
  - Sends RTP streams with PTP timestamps
```

## Key Changes

### 1. Updated `src/gstreamer.ts`
- **Removed**: Direct `gst-launch-1.0` invocation
- **Added**: `verifyPythonEnvironment()` - checks Python and PyGObject
- **Modified**: `startGstreamerStreams()` now:
  - Takes `configPath` parameter
  - Spawns Python script instead of gst-launch
  - Passes verbose flag if enabled
  - Monitors Python process lifecycle

### 2. Updated `src/runtime.ts`
- **Modified**: `runSenderRuntimeLoop()` accepts `configPath`
- **Modified**: `runRuntimeLoop()` accepts and passes `configPath`

### 3. Updated `src/index.ts`
- **Modified**: Passes `configPath` to `runRuntimeLoop()`

### 4. Updated `src/utils/logger.ts`
- **Added**: `isVerbose()` public method to check verbose flag

### 5. Python Script (`ptp-sender.py`)
- Standalone script that handles actual streaming
- Uses PyGObject for GStreamer Python bindings
- Implements proper PTP clock synchronization
- Creates multiple streams based on config
- Generates detailed logging
- Handles graceful shutdown

### 6. Updated `README.md`
- Removed confusing "two approaches" section
- Documented integrated solution clearly
- Added Python/PyGObject installation instructions
- Updated all step numbers and examples
- Explained why Python is necessary

## User Experience

### Before (Broken)
```bash
node dist/index.js --verbose
# Would use gst-launch-1.0 without proper PTP sync
# RTP timestamps not synchronized to PTP
```

### After (Integrated)
```bash
# 1. Configure (Node.js wizard)
node dist/index.js --verbose

# 2. Tool automatically:
#    - Verifies Python/PyGObject
#    - Starts Python PTP sender
#    - Manages entire lifecycle

# Output:
[INFO] Starting Python PTP sender script...
✓ PTP clock synchronized successfully
[INFO] All Gstreamer streams started successfully
Generated SDP file: ./sdp-files/stream1.sdp
```

## Dependencies

### Node.js Tool (existing)
- Node.js 20+
- TypeScript
- npm packages (commander, chalk, inquirer, etc.)

### Python Script (new)
- Python 3.7+
- PyGObject (GStreamer Python bindings)
- GStreamer 1.24+ (Windows PTP support)

### Installation
```bash
# Install Python dependencies
pip install -r requirements.txt

# Verify
python -c "import gi; gi.require_version('Gst', '1.0'); print('OK')"
```

## Technical Details

### Why Python?

GStreamer's PTP clock requires C API functions not accessible from `gst-launch-1.0`:

```c
// These functions are NOT available in gst-launch
gst_ptp_init(GST_PTP_CLOCK_ID_NONE, NULL);
GstClock *ptp_clock = gst_ptp_clock_new("PTPClock", domain);
gst_pipeline_use_clock(pipeline, ptp_clock);
```

Python (via PyGObject) provides access to the full GStreamer C API:

```python
# Python can access these APIs
GstNet.ptp_init(GstNet.PTP_CLOCK_ID_NONE, None)
ptp_clock = GstNet.PtpClock.new("PTPClock", domain)
pipeline.use_clock(ptp_clock)
```

### Clock Synchronization Flow

```
PTP Grandmaster (Raspberry Pi)
    ↓ PTP protocol (UDP ports 319-320)
GStreamer PTP Clock (GstPtpClock in Python script)
    ↓ Pipeline clock API
GStreamer Pipeline
    ↓ jackaudiosrc element
Jack Audio Server
    ↓ Audio samples
Audio Application (DAW, etc.)
```

### RTP Timestamp Generation

```python
# In Python script:
pipeline.use_clock(ptp_clock)  # Pipeline clock IS PTP clock
pipeline.set_base_time(ptp_clock.get_time())  # Sync to current PTP time

# Result: rtpL24pay uses pipeline running time = PTP time
# All RTP packets have PTP-synchronized timestamps
```

## Error Handling

The Node.js tool verifies all prerequisites before starting:

1. ✅ GStreamer installed (`gst-launch-1.0 --version`)
2. ✅ Jack running (`jack_lsp`)
3. ✅ Python installed (`python --version`)
4. ✅ PyGObject available (`import gi; gi.require_version('Gst', '1.0')`)
5. ✅ Python script exists (`ptp-sender.py`)

If any check fails, user gets clear error message with installation instructions.

## Files

### Core Implementation
- `src/gstreamer.ts` - Orchestration and Python process management
- `src/runtime.ts` - Sender runtime loop
- `src/index.ts` - CLI entry point
- `src/utils/logger.ts` - Logging with verbose support
- `ptp-sender.py` - Python GStreamer script with PTP clock

### Documentation
- `README.md` - User-facing documentation
- `PTP-IMPLEMENTATION.md` - Technical deep-dive
- `INTEGRATION-SUMMARY.md` - This file
- `requirements.txt` - Python dependencies

## Testing

To test the integrated solution:

```bash
# 1. Ensure Raspberry Pi grandmaster is running
# On Raspberry Pi:
node dist/index.js --verbose  # (configured as grandmaster)

# 2. On Windows, install dependencies
pip install -r requirements.txt

# 3. Start Jack audio server

# 4. Run the integrated tool
node dist/index.js --verbose

# Expected output:
[INFO] Starting Gstreamer sender with PTP synchronization...
[INFO] Gstreamer found
[INFO] Jack server is running
[INFO] Python found: Python 3.11.0
[INFO] PyGObject with GStreamer support found
[INFO] Configured 2 stream(s):
[INFO]   Stream 1: 8 channels @ 239.69.100.1:5004
[INFO]   Stream 2: 8 channels @ 239.69.100.2:5005
[INFO] Starting Python PTP sender script...
✓ PTP clock synchronized successfully
[INFO] All Gstreamer streams started successfully
```

## Troubleshooting

### "Python not found"
```bash
# Install Python 3.7+
https://www.python.org/downloads/

# Ensure python is in PATH
python --version
```

### "PyGObject not found"
```bash
# Install via pip
pip install PyGObject

# Or download wheel
https://github.com/pygobject/pygobject/releases
```

### "PTP clock sync timeout"
```bash
# Verify Raspberry Pi grandmaster is running
# Check network connectivity
# Ensure same PTP domain (usually 0)
# Check firewall allows UDP ports 319-320
```

### "ptp-sender.py not found"
```bash
# Ensure ptp-sender.py is in the project directory
ls ptp-sender.py

# Should be in same directory as package.json
```

## Benefits of Integration

✅ **Seamless UX**: User runs one command (Node.js tool)
✅ **Proper PTP Sync**: Python provides correct GStreamer PTP clock implementation
✅ **No Manual Steps**: Tool automatically manages Python script lifecycle
✅ **Clear Errors**: Validates all prerequisites with helpful error messages
✅ **Unified Config**: Single JSON config file used by both Node.js and Python
✅ **SDP Generation**: Node.js tool generates SDP files for receivers
✅ **Process Management**: Node.js monitors and cleanly shuts down Python script

## Conclusion

The integrated solution provides:
- Simple user experience (run Node.js tool)
- Correct PTP synchronization (via Python/PyGObject)
- Automated process management
- Clear documentation and error handling

This is the **only correct approach** for Windows AES67 sender with proper PTP-synchronized RTP timestamps.

