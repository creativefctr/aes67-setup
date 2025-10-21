# Test JACK audio source without PTP clock synchronization
# Based on aes67-config.json configuration

.\run-gstreamer-pipeline.ps1 `
    -AudioSource "jack" `
    -JackClientName "test-jack" `
    -Channels 8 `
    -SamplingRate 48000 `
    -MulticastAddress "239.69.100.1" `
    -Port 5004 `
    -DebugLevel 4

