# GStreamer PowerShell Script Solution

This solution addresses the issue where GStreamer caps filters get corrupted when spawned from Node.js on Windows.

## Problem

When running GStreamer pipelines from Node.js using `spawn()`, the caps filter arguments (e.g., `audio/x-raw,format=F32LE,...`) don't get properly escaped for Windows PowerShell, causing the pipeline to fail or behave incorrectly.

## Solution

Use a PowerShell script that properly handles quoting and escaping for GStreamer pipeline arguments.

## Files

- **run-gstreamer-pipeline.ps1** - Main script that builds and executes GStreamer pipelines
- **test-jack-with-ptp.ps1** - Example: JACK audio source WITH PTP synchronization
- **test-jack-without-ptp.ps1** - Example: JACK audio source WITHOUT PTP synchronization  
- **test-asio-without-ptp.ps1** - Example: ASIO audio source WITHOUT PTP synchronization

## Testing the Scripts

### Test 1: JACK without PTP (matches your working command)

```powershell
.\test-jack-without-ptp.ps1
```

This should produce the exact command you confirmed was working:
```
gst-launch-1.0 -v --gst-debug-level=4 jackaudiosrc connect=0 client-name="test-jack" ! "audio/x-raw,format=F32LE,rate=48000,channels=8,layout=interleaved,channel-mask=(bitmask)0x0" ! queue ! audioconvert ! audioresample ! "audio/x-raw,format=S24BE,rate=48000,channels=8,layout=interleaved,channel-mask=(bitmask)0x0" ! rtpL24pay mtu=1500 pt=96 timestamp-offset=0 ! udpsink host=239.69.100.1 port=5004 auto-multicast=true ttl-mc=32 sync=false async=false
```

### Test 2: JACK with PTP

```powershell
.\test-jack-with-ptp.ps1
```

This will run the same pipeline but wrapped with PTP clock synchronization:
```
gst-launch-1.0 -v --gst-debug-level=4 clockselect. ( clock-id=ptp ptp-domain=0 jackaudiosrc connect=0 client-name="test-jack" ! "audio/x-raw,format=F32LE,rate=48000,channels=8,layout=interleaved,channel-mask=(bitmask)0x0" ! queue ! audioconvert ! audioresample ! "audio/x-raw,format=S24BE,rate=48000,channels=8,layout=interleaved,channel-mask=(bitmask)0x0" ! rtpL24pay mtu=1500 pt=96 timestamp-offset=0 ! udpsink host=239.69.100.1 port=5004 auto-multicast=true ttl-mc=32 sync=false async=false )
```

### Test 3: ASIO (if you have ASIO device)

First, edit `test-asio-without-ptp.ps1` and replace `{YOUR-ASIO-DEVICE-CLSID-HERE}` with your actual ASIO device CLSID, then:

```powershell
.\test-asio-without-ptp.ps1
```

## Script Parameters

The main script (`run-gstreamer-pipeline.ps1`) accepts the following parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| AudioSource | string | "asio" | Audio source: "asio" or "jack" |
| DeviceClsid | string | "" | ASIO device CLSID (for ASIO source) |
| InputChannels | string | "" | Comma-separated channel list (for ASIO source) |
| JackClientName | string | "" | JACK client name (for JACK source) |
| Channels | int | 8 | Number of audio channels |
| SamplingRate | int | 48000 | Audio sampling rate in Hz |
| MulticastAddress | string | "239.69.100.1" | Multicast destination address |
| Port | int | 5004 | RTP destination port |
| DebugLevel | int | 4 | GStreamer debug level (0-5) |
| EnablePtp | switch | false | Enable PTP clock synchronization |
| PtpDomain | int | 0 | PTP domain number |

## Custom Usage

You can call the script with custom parameters:

```powershell
.\run-gstreamer-pipeline.ps1 -AudioSource "jack" -JackClientName "my-client" -Channels 2 -Port 5006
```

## Integration with Node.js

Once you confirm the PowerShell scripts work correctly, you can update `gstreamer.ts` to call the PowerShell script instead of trying to construct the GStreamer command directly:

```typescript
// Instead of spawning gst-launch-1.0 directly, spawn PowerShell with the script
const scriptPath = path.join(__dirname, '..', 'run-gstreamer-pipeline.ps1');
const psArgs = [
  '-ExecutionPolicy', 'Bypass',
  '-File', scriptPath,
  '-AudioSource', audioSource,
  // ... other parameters
];

if (usePtpClock) {
  psArgs.push('-EnablePtp', '-PtpDomain', String(ptpDomain));
}

const handle = spawnLongRunning('powershell', psArgs, {}, logger, `gst-stream${stream.streamIndex}`);
```

## Key Differences

The PowerShell script uses:
1. **Invoke-Expression** - Allows PowerShell to properly parse the complete command string
2. **Backtick escaping** - PowerShell escape character (`` ` ``) for special characters like `(` and `)`
3. **Double quotes** - Around caps filters and string parameters to preserve complex expressions like `channel-mask=(bitmask)0x0`

This ensures the GStreamer pipeline receives arguments exactly as it expects them.

