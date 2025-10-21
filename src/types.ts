export interface Aes67DeviceConfig {
  deviceMode: "sender" | "receiver";
  soundCardId?: string;
  soundCardName?: string;
  channelCount: number;
  channelNames: string[];
  samplingRate: number;
  multicastAddress: string;
  sdpFilePath?: string;
  networkInterface: string;
  ptpDomain: number;
  ptpMode: "grandmaster" | "slave" | "none";
  rtpDestinationPort: number;
  sessionName: string;
  lastUpdated: string;
  // Sender-specific fields
  audioSource?: "jack" | "asio"; // Audio source type for sender
  jackClientName?: string; // JACK client name to connect to
  channelsPerReceiver?: number;
  baseMulticastAddress?: string;
  asioDeviceClsid?: string; // ASIO device CLSID (e.g., '{838FE50A-C1AB-4B77-B9B6-0A40788B53F3}' for JackRouter)
  asioInputChannels?: string; // Comma-separated list of ASIO channels to capture (e.g., '0,1,2,3,4,5,6,7')
  // Debug settings
  gstreamerDebugLevel?: number; // 0=none, 1=error, 2=warning, 3=info, 4=debug, 5+=very verbose
}

export interface RuntimeOptions {
  verbose: boolean;
  config?: string;
}

export interface ManagedProcessHandle {
  stop: () => Promise<void> | void;
}

export interface PipewireRoutingState {
  moduleId: number;
  linkIds: number[];
  sessionNodeId: number;
  sessionNodeName: string;
}

