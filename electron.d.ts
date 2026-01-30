// Electron API 타입 정의
interface ElectronAPI {
  saveExcelFile: (buffer: number[], defaultFileName?: string) => Promise<{
    success: boolean;
    canceled?: boolean;
    filePath?: string;
    error?: string;
  }>;
  openExcelFile: () => Promise<{
    success: boolean;
    canceled?: boolean;
    filePath?: string;
    buffer?: number[];
    error?: string;
  }>;
  getSaveDirectory: () => Promise<{
    success: boolean;
    canceled?: boolean;
    directory?: string;
    error?: string;
  }>;
  platform: string;
  isElectron: boolean;
}

interface Window {
  electronAPI?: ElectronAPI;
}
