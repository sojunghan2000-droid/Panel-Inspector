import { contextBridge, ipcRenderer } from 'electron';

// Electron API를 렌더러 프로세스에 안전하게 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // 엑셀 파일 저장
  saveExcelFile: (buffer, defaultFileName) =>
    ipcRenderer.invoke('save-excel-file', buffer, defaultFileName),

  // 엑셀 파일 열기
  openExcelFile: () =>
    ipcRenderer.invoke('open-excel-file'),

  // 저장 폴더 선택
  getSaveDirectory: () =>
    ipcRenderer.invoke('get-save-directory'),

  // 플랫폼 정보
  platform: process.platform,
  
  // Electron 환경 여부
  isElectron: true,
});
