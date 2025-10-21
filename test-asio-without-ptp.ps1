# Test ASIO audio source without PTP clock synchronization
# Example configuration - replace DeviceClsid and InputChannels with your ASIO device values

.\run-gstreamer-pipeline.ps1 `
    -AudioSource "asio" `
    -DeviceClsid "{YOUR-ASIO-DEVICE-CLSID-HERE}" `
    -InputChannels "0,1,2,3,4,5,6,7" `
    -Channels 8 `
    -SamplingRate 48000 `
    -MulticastAddress "239.69.100.1" `
    -Port 5004 `
    -DebugLevel 4

