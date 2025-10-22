# Test ASIO audio source without PTP clock synchronization
# Example configuration - replace DeviceClsid, InputChannels, and MulticastIface with your values

.\run-gstreamer-pipeline.ps1 `
    -AudioSource "asio" `
    -DeviceClsid "{YOUR-ASIO-DEVICE-CLSID-HERE}" `
    -InputChannels "0,1,2,3,4,5,6,7" `
    -Channels 8 `
    -SamplingRate 48000 `
    -MulticastAddress "239.69.100.1" `
    -MulticastIface "Realtek USB GbE Family Controller" `
    -Port 5004 `
    -DebugLevel 4

