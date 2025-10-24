# Test JACK audio source with PTP clock synchronization and unicast streaming
# Sends audio to a specific IP address instead of multicast
# Based on aes67-config.json configuration

.\run-gstreamer-pipeline.ps1 `
    -AudioSource "jack" `
    -JackClientName "test-jack-unicast" `
    -Channels 8 `
    -SamplingRate 48000 `
    -UnicastAddress "192.168.1.176" `
    -Port 5004 `
    -DebugLevel 4 `
    -EnablePtp `
    -PtpDomain 0


