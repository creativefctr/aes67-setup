#!/usr/bin/env python3
"""
GStreamer AES67 Sender with PTP Clock Synchronization

This script creates GStreamer pipelines for AES67 audio streaming with proper
PTP clock synchronization. It uses GStreamer's native PTP clock support to
sync with a PTP grandmaster on the network.

Requirements:
- Python 3.7+
- GStreamer 1.24+ (with Windows PTP support)
- PyGObject (GStreamer Python bindings)

Install dependencies:
    pip install PyGObject
"""

import sys
import signal
import json
import argparse
from typing import List, Dict, Any
import gi

gi.require_version('Gst', '1.0')
gi.require_version('GstNet', '1.0')
from gi.repository import Gst, GstNet, GLib

class GstreamerPtpSender:
    def __init__(self, config_path: str, verbose: bool = False):
        self.config_path = config_path
        self.verbose = verbose
        self.pipelines: List[Gst.Pipeline] = []
        self.main_loop = None
        self.ptp_clock = None
        
        # Initialize GStreamer
        Gst.init(None)
        
        # Load configuration
        self.config = self.load_config()
        
    def load_config(self) -> Dict[str, Any]:
        """Load AES67 configuration from JSON file"""
        try:
            with open(self.config_path, 'r') as f:
                config = json.load(f)
                
            if config.get('deviceMode') != 'sender':
                raise ValueError("Configuration must be for sender mode")
                
            return config
        except FileNotFoundError:
            print(f"Error: Configuration file not found: {self.config_path}", file=sys.stderr)
            sys.exit(1)
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON in configuration file: {e}", file=sys.stderr)
            sys.exit(1)
            
    def init_ptp_clock(self) -> bool:
        """Initialize PTP clock subsystem and create PTP clock"""
        ptp_domain = self.config.get('ptpDomain', 0)
        
        print(f"Initializing PTP clock (domain {ptp_domain})...")
        
        # Initialize PTP subsystem
        # Parameters: clock_id (None for auto), interfaces (None for all interfaces)
        if not GstNet.ptp_init(GstNet.PTP_CLOCK_ID_NONE, None):
            print("Error: Failed to initialize PTP subsystem", file=sys.stderr)
            print("Ensure GStreamer 1.24+ is installed with PTP support", file=sys.stderr)
            return False
            
        if self.verbose:
            print("PTP subsystem initialized successfully")
            
        # Create PTP clock for the specified domain
        self.ptp_clock = GstNet.PtpClock.new("PTPClock", ptp_domain)
        
        if not self.ptp_clock:
            print(f"Error: Failed to create PTP clock for domain {ptp_domain}", file=sys.stderr)
            return False
            
        # Monitor synchronization status
        self.ptp_clock.connect("synced", self.on_clock_synced)
        
        # Wait for clock to sync
        print("Waiting for PTP clock to synchronize with grandmaster...")
        if self.ptp_clock.wait_for_sync(10 * Gst.SECOND):
            print("✓ PTP clock synchronized successfully")
            return True
        else:
            print("Warning: PTP clock sync timeout (continuing anyway)", file=sys.stderr)
            print("Ensure a PTP grandmaster is running on the network", file=sys.stderr)
            return True  # Continue anyway
            
    def on_clock_synced(self, clock, synced):
        """Callback when PTP clock synchronization status changes"""
        if synced:
            print("✓ PTP clock synchronized")
        else:
            print("⚠ PTP clock lost synchronization", file=sys.stderr)
            
    def calculate_streams(self) -> List[Dict[str, Any]]:
        """Calculate stream configurations"""
        channel_count = self.config['channelCount']
        channels_per_receiver = self.config['channelsPerReceiver']
        base_multicast = self.config['baseMulticastAddress']
        base_port = self.config['rtpDestinationPort']
        
        num_streams = (channel_count + channels_per_receiver - 1) // channels_per_receiver
        streams = []
        
        for i in range(num_streams):
            start_channel = i * channels_per_receiver
            end_channel = min(start_channel + channels_per_receiver, channel_count)
            stream_channels = end_channel - start_channel
            
            # Increment last octet of multicast address
            addr_parts = base_multicast.split('.')
            addr_parts[3] = str(int(addr_parts[3]) + i)
            stream_address = '.'.join(addr_parts)
            
            streams.append({
                'index': i,
                'multicast': stream_address,
                'port': base_port + i,
                'channels': stream_channels,
                'start_channel': start_channel + 1,  # 1-indexed for Jack
            })
            
        return streams
        
    def create_pipeline(self, stream: Dict[str, Any]) -> Gst.Pipeline:
        """Create a GStreamer pipeline for one stream"""
        jack_client_name = self.config['jackClientName']
        sampling_rate = self.config['samplingRate']
        
        client_name = f"{jack_client_name}_stream{stream['index']}"
        
        # Build pipeline string
        pipeline_str = (
            f"jackaudiosrc client-name=\"{client_name}\" connect=0 ! "
            f"audioconvert ! "
            f"audioresample ! "
            f"audio/x-raw,rate={sampling_rate},channels={stream['channels']} ! "
            f"rtpL24pay pt=96 timestamp-offset=0 ! "
            f"udpsink host={stream['multicast']} port={stream['port']} "
            f"auto-multicast=true ttl-mc=32 sync=false async=false"
        )
        
        if self.verbose:
            print(f"\nStream {stream['index'] + 1} pipeline:")
            print(f"  {pipeline_str}")
            
        # Create pipeline from string
        pipeline = Gst.parse_launch(pipeline_str)
        
        if not pipeline:
            raise RuntimeError(f"Failed to create pipeline for stream {stream['index']}")
            
        # Set the PTP clock as the pipeline clock
        pipeline.use_clock(self.ptp_clock)
        
        # Set base time to current clock time
        pipeline.set_start_time(Gst.CLOCK_TIME_NONE)
        pipeline.set_base_time(self.ptp_clock.get_time())
        
        # Connect to bus for error messages
        bus = pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message", self.on_bus_message, stream['index'])
        
        return pipeline
        
    def on_bus_message(self, bus, message, stream_index):
        """Handle GStreamer bus messages"""
        t = message.type
        
        if t == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            print(f"Error in stream {stream_index}: {err}", file=sys.stderr)
            if self.verbose and debug:
                print(f"Debug info: {debug}", file=sys.stderr)
            self.stop()
        elif t == Gst.MessageType.EOS:
            print(f"End-of-stream in stream {stream_index}")
            self.stop()
        elif t == Gst.MessageType.WARNING:
            warn, debug = message.parse_warning()
            print(f"Warning in stream {stream_index}: {warn}", file=sys.stderr)
            if self.verbose and debug:
                print(f"Debug info: {debug}", file=sys.stderr)
        elif t == Gst.MessageType.STATE_CHANGED:
            if message.src == self.pipelines[stream_index]:
                old_state, new_state, pending_state = message.parse_state_changed()
                if self.verbose:
                    print(f"Stream {stream_index} state changed: {old_state.value_nick} -> {new_state.value_nick}")
                    
    def start(self):
        """Start all streams"""
        # Initialize PTP clock
        if not self.init_ptp_clock():
            print("Failed to initialize PTP clock", file=sys.stderr)
            sys.exit(1)
            
        # Calculate stream configuration
        streams = self.calculate_streams()
        print(f"\nConfigured {len(streams)} stream(s):")
        for stream in streams:
            print(f"  Stream {stream['index'] + 1}: {stream['channels']} channels @ {stream['multicast']}:{stream['port']}")
            
        # Create and start pipelines
        for stream in streams:
            pipeline = self.create_pipeline(stream)
            self.pipelines.append(pipeline)
            
            print(f"\nStarting stream {stream['index'] + 1}...")
            ret = pipeline.set_state(Gst.State.PLAYING)
            if ret == Gst.StateChangeReturn.FAILURE:
                print(f"Error: Failed to start stream {stream['index']}", file=sys.stderr)
                sys.exit(1)
                
        print("\n✓ All streams started successfully")
        print(f"\nJack client names: {self.config['jackClientName']}_stream0, _stream1, etc.")
        print("Connect your audio sources to these Jack clients using jack_connect or QjackCtl")
        print("\nPress Ctrl+C to stop...\n")
        
        # Run main loop
        self.main_loop = GLib.MainLoop()
        
        # Handle Ctrl+C
        signal.signal(signal.SIGINT, lambda sig, frame: self.stop())
        signal.signal(signal.SIGTERM, lambda sig, frame: self.stop())
        
        try:
            self.main_loop.run()
        except KeyboardInterrupt:
            self.stop()
            
    def stop(self):
        """Stop all streams"""
        print("\nStopping streams...")
        
        for i, pipeline in enumerate(self.pipelines):
            if self.verbose:
                print(f"Stopping stream {i}...")
            pipeline.set_state(Gst.State.NULL)
            
        if self.main_loop and self.main_loop.is_running():
            self.main_loop.quit()
            
        # Cleanup PTP
        if self.ptp_clock:
            GstNet.ptp_deinit()
            
        print("All streams stopped.")
        sys.exit(0)


def main():
    parser = argparse.ArgumentParser(
        description='GStreamer AES67 Sender with PTP Clock Synchronization'
    )
    parser.add_argument(
        '-c', '--config',
        default='aes67-config.json',
        help='Path to configuration file (default: aes67-config.json)'
    )
    parser.add_argument(
        '-v', '--verbose',
        action='store_true',
        help='Enable verbose logging'
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("GStreamer AES67 Sender with PTP Clock Synchronization")
    print("=" * 60)
    
    sender = GstreamerPtpSender(args.config, args.verbose)
    sender.start()


if __name__ == '__main__':
    main()

