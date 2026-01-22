declare module 'html5-qrcode' {
  export interface Html5QrcodeConfig {
    fps?: number;
    qrbox?: { width: number; height: number } | ((viewfinderWidth: number, viewfinderHeight: number) => { width: number; height: number });
    aspectRatio?: number;
    disableFlip?: boolean;
    videoConstraints?: MediaTrackConstraints;
    formatsToSupport?: string[];
    experimentalFeatures?: {
      useBarCodeDetectorIfSupported?: boolean;
    };
  }

  export interface CameraDevice {
    id: string;
    label: string;
  }

  export class Html5Qrcode {
    constructor(elementId: string, verbose?: boolean);
    
    start(
      cameraIdOrConfig: string | { facingMode: string },
      config: Html5QrcodeConfig,
      qrCodeSuccessCallback: (decodedText: string, decodedResult: any) => void,
      qrCodeErrorCallback?: (errorMessage: string, error: any) => void
    ): Promise<void>;
    
    stop(): Promise<void>;
    clear(): Promise<void>;
    getState(): number;
    isScanning(): boolean;
    static getCameras(): Promise<CameraDevice[]>;
  }
}
