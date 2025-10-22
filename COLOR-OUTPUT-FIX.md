# Color Output Fix for GStreamer Pipeline

## Problem
When running the GStreamer pipeline through PowerShell from Node.js, all output appeared white (no colors) even though the PowerShell script used color formatting.

## Root Cause
1. PowerShell's `Write-Host -ForegroundColor` doesn't output ANSI escape codes when piped to another process
2. Environment variables for color support weren't being passed to child processes
3. GStreamer's color mode wasn't explicitly enabled

## Solution

### 1. PowerShell Script (`run-gstreamer-pipeline.ps1`)

**Changed from:**
```powershell
Write-Host "Executing GStreamer pipeline:" -ForegroundColor Cyan
Write-Host "gst-launch-1.0 $($gstArgs -join ' ')" -ForegroundColor Yellow
```

**Changed to:**
```powershell
# ANSI color codes for terminal output
$ColorCyan = "`e[36m"
$ColorYellow = "`e[33m"
$ColorReset = "`e[0m"

Write-Output "${ColorCyan}Executing GStreamer pipeline:${ColorReset}"
Write-Output "${ColorYellow}gst-launch-1.0 $($gstArgs -join ' ')${ColorReset}"
```

**Why it works:**
- Uses ANSI escape codes directly instead of PowerShell color parameters
- `Write-Output` preserves the escape codes when piped
- Added `$PSStyle.OutputRendering = Ansi` for PowerShell 7+
- Set `$env:TERM = "xterm-256color"` to enable terminal color support

### 2. Node.js (`src/gstreamer.ts`)

**Added environment variables:**
```typescript
const env = {
  ...process.env,
  FORCE_COLOR: "1",              // Force color output in general
  TERM: "xterm-256color",         // Terminal type with 256 color support
  COLORTERM: "truecolor",         // Indicate true color support
  GST_DEBUG_COLOR_MODE: "on",     // Force GStreamer to use colors
};
```

These environment variables are passed when spawning PowerShell, which then passes them to GStreamer.

### 3. Color Preservation in `pipes.ts`

Already implemented in the previous refactoring:
- When `preserveColors: true`, output is written directly to `process.stdout` and `process.stderr`
- This preserves ANSI escape codes instead of stripping them through the logger

## ANSI Color Codes Used

The PowerShell script now uses these ANSI codes:

| Code | Color | Usage |
|------|-------|-------|
| `\e[36m` | Cyan | "Executing GStreamer pipeline:" header |
| `\e[33m` | Yellow | The actual command being executed |
| `\e[0m` | Reset | Reset to default color |

GStreamer uses various colors based on log level:
- **Red** - Errors
- **Yellow** - Warnings
- **White/Gray** - Info messages
- **Green** - Debug messages

## Testing

### Test PowerShell script directly:
```powershell
.\test-jack-without-ptp.ps1
```

You should see:
- **Cyan** text for "Executing GStreamer pipeline:"
- **Yellow** text for the command
- **Various colors** from GStreamer debug output

### Test from Node.js:
```bash
npm start
```

You should see the same colored output through the Node.js application.

## Compatibility

### PowerShell Versions
- **PowerShell 7+**: Full support with `$PSStyle`
- **PowerShell 5.1**: Works with ANSI codes, but without `$PSStyle` (degrades gracefully)

### Terminals
Works best with:
- Windows Terminal
- PowerShell 7+ console
- VS Code integrated terminal
- Any terminal with ANSI/VT100 support

### GStreamer
- Requires GStreamer 1.0+
- Color support works on Windows, Linux, and macOS

## Environment Variables Reference

| Variable | Value | Purpose |
|----------|-------|---------|
| `FORCE_COLOR` | `"1"` | Force color in general (many tools respect this) |
| `TERM` | `"xterm-256color"` | Declare 256-color terminal capability |
| `COLORTERM` | `"truecolor"` | Indicate true color (24-bit) support |
| `GST_DEBUG_COLOR_MODE` | `"on"` | Force GStreamer to output colors |

## Troubleshooting

### Still seeing white text?

1. **Check your terminal:**
   - Ensure you're using Windows Terminal or PowerShell 7+ console
   - Old cmd.exe may not support ANSI colors well

2. **Check PowerShell version:**
   ```powershell
   $PSVersionTable.PSVersion
   ```
   Upgrade to PowerShell 7+ for best results

3. **Verify environment variables are passed:**
   Add this to the PowerShell script temporarily:
   ```powershell
   Write-Output "TERM: $env:TERM"
   Write-Output "GST_DEBUG_COLOR_MODE: $env:GST_DEBUG_COLOR_MODE"
   ```

4. **Test ANSI codes directly:**
   In PowerShell, run:
   ```powershell
   Write-Output "`e[31mRed text`e[0m"
   ```
   If this doesn't show red, your terminal doesn't support ANSI codes

### Colors work in PowerShell but not in Node.js?

- Check that `preserveColors: true` is set in the `spawnLongRunning` call
- Verify the environment variables are being passed correctly
- Ensure `process.stdout` and `process.stderr` are not being redirected

## Benefits

✅ **Better debugging** - Color-coded log levels are easier to parse  
✅ **Professional appearance** - Colored output looks more polished  
✅ **Error visibility** - Red errors stand out immediately  
✅ **Consistency** - Same colors whether run via PowerShell or Node.js  

## Technical Notes

### Why ANSI escape codes?
ANSI escape codes are a standard way to add colors to terminal output. They work across platforms and are preserved when piped between processes.

Format: `\e[<code>m` where `<code>` is:
- 0: Reset
- 30-37: Foreground colors (black, red, green, yellow, blue, magenta, cyan, white)
- 40-47: Background colors
- 90-97: Bright foreground colors

### Why not use PowerShell colors directly?
PowerShell's `Write-Host -ForegroundColor` is great for interactive scripts, but:
1. It doesn't output ANSI codes when piped
2. It's PowerShell-specific (not portable)
3. It can't be captured/redirected reliably

By using raw ANSI codes, we get:
1. Universal support across terminals
2. Proper piping behavior
3. Compatibility with standard I/O streams


