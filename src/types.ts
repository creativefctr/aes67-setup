export interface Aes67DeviceConfig {
  soundCardId: string;
  soundCardName: string;
  channelCount: number;
  channelNames: string[];
  samplingRate: number;
  multicastAddress: string;
  sdpFilePath: string;
  networkInterface: string;
  ptpDomain: number;
  ptpMode: "grandmaster" | "slave";
  rtpDestinationPort: number;
  sessionName: string;
  lastUpdated: string;
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

