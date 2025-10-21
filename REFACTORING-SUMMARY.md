# GStreamer Integration Refactoring Summary

## Overview

The codebase has been refactored to fix the GStreamer pipeline execution issues on Windows. The problem was that Node.js's `spawn()` function was not properly escaping complex GStreamer arguments (especially caps filters with parentheses) when passing them to PowerShell.

## Solution

Instead of building GStreamer commands directly in Node.js and spawning `gst-launch-1.0`, we now:
1. Use a PowerShell script (`run-gstreamer-pipeline.ps1`) to build and execute the GStreamer pipeline
2. Spawn PowerShell with parameters and let it handle the proper quoting/escaping
3. Preserve ANSI color codes from GStreamer output for better visibility

## Files Changed

### 1. `src/gstreamer.ts`

**Removed:**
- `formatCommandForWindows()` function - no longer needed
- Direct GStreamer command building logic
- Complex argument array construction for `gst-launch-1.0`

**Added:**
- PowerShell script path resolution
- PowerShell argument building based on configuration
- Simplified stream launching using PowerShell as intermediary

**Key Changes:**
```typescript
// OLD: Spawned gst-launch-1.0 directly with complex args
const handle = spawnLongRunning("gst-launch-1.0", args, {}, logger, ...);

// NEW: Spawn PowerShell which runs the script
const psArgs = [
  "-ExecutionPolicy", "Bypass",
  "-NoProfile",
  "-File", scriptPath,
  "-AudioSource", audioSource,
  "-Channels", String(stream.channelCount),
  // ... more parameters
];
const handle = spawnLongRunning("powershell", psArgs, {}, logger, ..., undefined, true);
```

### 2. `src/pipes.ts`

**Added:**
- `preserveColors` parameter to `createProcessHandle()`
- `preserveColors` parameter to `spawnLongRunning()`
- Color-preserving output mode that writes directly to `process.stdout` and `process.stderr`

**Key Changes:**
```typescript
// When preserveColors is true, write directly to stdout/stderr
if (preserveColors) {
  process.stdout.write(prefix + line + '\n');
} else {
  logger.info(`[${description}] ${line}`);
}
```

This ensures ANSI escape codes (colors) from GStreamer and PowerShell are displayed correctly in the terminal.

### 3. New PowerShell Script: `run-gstreamer-pipeline.ps1`

This script:
- Accepts parameters for all GStreamer pipeline configuration
- Builds the argument array properly for PowerShell
- Uses PowerShell's call operator (`&`) to invoke `gst-launch-1.0` with correct argument passing
- Supports both ASIO and JACK audio sources
- Handles PTP clock synchronization mode (enabled/disabled)

### 4. Test Scripts

Created for independent testing:
- `test-jack-with-ptp.ps1` - JACK with PTP enabled
- `test-jack-without-ptp.ps1` - JACK without PTP
- `test-asio-without-ptp.ps1` - ASIO example

## Benefits

1. **Correct Argument Passing**: PowerShell properly handles complex arguments like `channel-mask=(bitmask)0x0`
2. **Color Preservation**: GStreamer's colored debug output is now visible
3. **Easier Debugging**: The PowerShell script can be tested independently
4. **Platform Consistency**: PowerShell handles Windows-specific escaping rules
5. **Maintainability**: Pipeline logic is separated into a testable script

## How It Works

```
Node.js (index.ts)
    ↓
gstreamer.ts (startGstreamerStreams)
    ↓
pipes.ts (spawnLongRunning)
    ↓
PowerShell (run-gstreamer-pipeline.ps1)
    ↓
gst-launch-1.0 (GStreamer pipeline)
```

## Configuration Flow

1. **Read config** from `aes67-config.json`
2. **Calculate streams** based on channel count and channels per receiver
3. **Build PowerShell args** with:
   - Audio source type (ASIO/JACK)
   - Device-specific parameters (CLSID for ASIO, client name for JACK)
   - Channel configuration
   - Network parameters (multicast address, port)
   - PTP settings (enabled/disabled, domain)
4. **Spawn PowerShell** with the script and parameters
5. **PowerShell builds** the GStreamer command with proper escaping
6. **GStreamer runs** with correct arguments
7. **Output flows** back through PowerShell → Node.js → Terminal (with colors preserved)

## Testing

### Test the PowerShell Script Independently

```powershell
# Without PTP
.\test-jack-without-ptp.ps1

# With PTP
.\test-jack-with-ptp.ps1
```

### Run from Node.js

```bash
npm start
```

The Node.js application will now use the PowerShell script automatically.

## Expected Output

With color preservation enabled, you should see:
- **Cyan** - "Executing GStreamer pipeline:" header from PowerShell
- **Yellow** - The actual command being executed
- **GStreamer colors** - Debug output from GStreamer (various colors based on log level)
- **PowerShell colors** - Any PowerShell status messages

## Troubleshooting

### Script Not Found
If you get "PowerShell script not found", ensure `run-gstreamer-pipeline.ps1` is in the project root directory.

### Execution Policy Error
The script uses `-ExecutionPolicy Bypass` to avoid PowerShell execution policy issues, but if you still encounter problems, run:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### No Colors Showing
Ensure your terminal supports ANSI colors. Windows Terminal and PowerShell 7+ support colors by default.

### GStreamer Not Found
Make sure GStreamer is installed and `gst-launch-1.0` is in your PATH.

## Migration Notes

If you were previously running this project:

1. **No config changes needed** - `aes67-config.json` format remains the same
2. **New file required** - Ensure `run-gstreamer-pipeline.ps1` is present
3. **Rebuild** - Run `npm run build` to compile the TypeScript changes
4. **Test** - Test the PowerShell script independently before running from Node.js

## Future Improvements

Potential enhancements:
- Add PowerShell script validation before spawning
- Support for Linux/macOS using shell scripts instead of PowerShell
- Automatic fallback to direct `gst-launch-1.0` spawning on non-Windows platforms
- Error handling for PowerShell-specific issues

