param(
    [string]$AudioSource = "asio",
    [string]$DeviceClsid = "",
    [string]$InputChannels = "",
    [string]$JackClientName = "",
    [int]$Channels = 8,
    [int]$SamplingRate = 48000,
    [string]$MulticastAddress = "239.69.100.1",
    [string]$MulticastIface = "",
    [int]$Port = 5004,
    [int]$DebugLevel = 4,
    [switch]$EnablePtp,
    [int]$PtpDomain = 0
)

# Enable ANSI/VT100 escape sequences in PowerShell
# This ensures colors work when output is piped
if ($PSVersionTable.PSVersion.Major -ge 7) {
    # PowerShell 7+ has PSStyle
    $PSStyle.OutputRendering = [System.Management.Automation.OutputRendering]::Ansi
}

# Set environment variable to enable virtual terminal processing
$env:TERM = "xterm-256color"

# Build the GStreamer pipeline arguments as an array
$gstArgs = @(
    "-v",
    "--gst-debug-level=$DebugLevel"
)

# Add PTP clock wrapper if enabled
if ($EnablePtp) {
    $gstArgs += "clockselect."
    $gstArgs += "("
    $gstArgs += "clock-id=ptp"
    $gstArgs += "ptp-domain=$PtpDomain"
}

# Add audio source based on configuration
if ($AudioSource -eq "asio") {
    $gstArgs += "asiosrc"
    
    if ($DeviceClsid) {
        $gstArgs += "device-clsid=$DeviceClsid"
    }
    
    if ($InputChannels) {
        $gstArgs += "input-channels=$InputChannels"
    }
} elseif ($AudioSource -eq "jack") {
    $gstArgs += "jackaudiosrc"
    $gstArgs += "connect=0"
    
    if ($JackClientName) {
        $gstArgs += "client-name=$JackClientName"
    }
}

# Add the complete pipeline
# Note: Caps filters with parentheses need to be passed as single arguments
$gstArgs += "!"
$gstArgs += "audio/x-raw,format=F32LE,rate=$SamplingRate,channels=$Channels,layout=interleaved,channel-mask=(bitmask)0x0"
$gstArgs += "!"
$gstArgs += "queue"
$gstArgs += "!"
$gstArgs += "audioconvert"
$gstArgs += "!"
$gstArgs += "audioresample"
$gstArgs += "!"
$gstArgs += "audio/x-raw,format=S24BE,rate=$SamplingRate,channels=$Channels,layout=interleaved,channel-mask=(bitmask)0x0"
$gstArgs += "!"
$gstArgs += "rtpL24pay"
$gstArgs += "mtu=1500"
$gstArgs += "pt=96"
$gstArgs += "timestamp-offset=0"
$gstArgs += "!"
$gstArgs += "udpsink"
$gstArgs += "host=$MulticastAddress"
$gstArgs += "port=$Port"
if ($MulticastIface) {
    $gstArgs += "multicast-iface=$MulticastIface"
}
$gstArgs += "auto-multicast=true"
$gstArgs += "ttl-mc=32"
$gstArgs += "sync=false"
$gstArgs += "async=false"

# Close PTP clock wrapper if enabled
if ($EnablePtp) {
    $gstArgs += ")"
}

# ANSI color codes for terminal output
$ColorCyan = "`e[36m"
$ColorYellow = "`e[33m"
$ColorReset = "`e[0m"

# Display the command for reference using ANSI codes
Write-Output "${ColorCyan}Executing GStreamer pipeline:${ColorReset}"
Write-Output "${ColorYellow}gst-launch-1.0 $($gstArgs -join ' ')${ColorReset}"
Write-Output ""

# Execute using the call operator with argument array
# This properly passes each argument to gst-launch-1.0 without PowerShell interpretation
& gst-launch-1.0 @gstArgs

