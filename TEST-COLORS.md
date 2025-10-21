# Color Output Testing Guide

## What Changed

Fixed the Node.js output handling in `src/pipes.ts`:

**Before:**
```typescript
child.stdout.setEncoding("utf-8");  // ❌ Converts to string
child.stdout.on("data", (data) => {
  const lines = data.split('\n');   // ❌ Splits and reconstructs
  process.stdout.write(prefix + line + '\n');  // ❌ Adds prefix
});
```

**After:**
```typescript
// No encoding set - keeps as raw Buffer
child.stdout.on("data", (data: Buffer) => {
  process.stdout.write(data);  // ✅ Direct passthrough
});
```

## Testing Steps

### 1. Rebuild the project
```bash
npm run build
```

### 2. Test from Node.js
```bash
npm start
```

You should now see:
- **Cyan** text from PowerShell ("Executing GStreamer pipeline:")
- **Yellow** text from PowerShell (the command)
- **Colored output** from GStreamer (errors in red, warnings in yellow, etc.)

### 3. Compare with direct PowerShell
```powershell
.\test-jack-without-ptp.ps1
```

The colors should look identical whether run from:
- PowerShell directly
- Node.js application

## What You Should See

### PowerShell Script Colors
- **Cyan** - "Executing GStreamer pipeline:"
- **Yellow** - The gst-launch-1.0 command

### GStreamer Colors
GStreamer uses color-coded debug levels:
- **White/Gray** - Normal output
- **Cyan** - Info messages
- **Yellow** - Warnings
- **Red** - Errors
- **Green** - Debug messages (at higher debug levels)

## Verify It's Working

Run this test command in PowerShell to verify ANSI codes work in your terminal:

```powershell
Write-Output "`e[31mThis should be RED`e[0m"
Write-Output "`e[32mThis should be GREEN`e[0m"
Write-Output "`e[33mThis should be YELLOW`e[0m"
Write-Output "`e[36mThis should be CYAN`e[0m"
```

If you don't see colors above, your terminal doesn't support ANSI codes.

## Troubleshooting

### Still no colors?

1. **Check your terminal:**
   - ✅ Windows Terminal
   - ✅ PowerShell 7+ console
   - ✅ VS Code integrated terminal
   - ❌ Old cmd.exe (limited support)

2. **Check Node.js is writing to a TTY:**
   Add this to your code temporarily:
   ```typescript
   console.log('stdout is TTY:', process.stdout.isTTY);
   console.log('stderr is TTY:', process.stderr.isTTY);
   ```
   Both should be `true`

3. **Verify the environment variables:**
   The script passes these to GStreamer:
   - `FORCE_COLOR="1"`
   - `TERM="xterm-256color"`
   - `COLORTERM="truecolor"`
   - `GST_DEBUG_COLOR_MODE="on"`

4. **Test raw ANSI passthrough:**
   Create a simple test:
   ```typescript
   // test-ansi.ts
   process.stdout.write("\x1b[31mRED TEXT\x1b[0m\n");
   process.stdout.write("\x1b[36mCYAN TEXT\x1b[0m\n");
   ```
   
   Run: `npx tsx test-ansi.ts`
   
   If you see colors here, the issue is with how the child process is spawning.

## Technical Details

### Why Raw Buffers?

ANSI escape codes are byte sequences like:
- `\x1b[31m` - Red color
- `\x1b[0m` - Reset

When we:
1. Convert to UTF-8 string → ANSI codes are preserved ✅
2. Split by '\n' → ANSI codes get separated from text ❌
3. Reconstruct with prefixes → ANSI codes may be in wrong place ❌

By passing raw buffers directly:
- No parsing/reconstruction
- No string manipulation
- Byte-for-byte passthrough
- All ANSI codes arrive intact

### Stream Flow

```
GStreamer output (with ANSI codes)
    ↓
PowerShell stdout (raw bytes)
    ↓
Node.js child.stdout (Buffer)
    ↓
process.stdout.write(buffer) [DIRECT]
    ↓
Your terminal (displays colors)
```

## Success Criteria

✅ PowerShell colors (cyan, yellow) display correctly  
✅ GStreamer colors (red, yellow, etc.) display correctly  
✅ Colors match whether run from PowerShell or Node.js  
✅ No performance degradation  
✅ Error messages are clearly visible in red  

## Performance Note

Raw buffer passthrough is actually **faster** than:
- String encoding/decoding
- Line splitting
- String concatenation

So you get better performance AND better colors! 🎨⚡

