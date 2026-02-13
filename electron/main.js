import { app, BrowserWindow, ipcMain, dialog, session } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;

function createWindow() {
  // preload.js 경로 설정 (패키징된 앱과 개발 모드 모두 지원)
  const preloadPath = app.isPackaged
    ? join(app.getAppPath(), 'electron', 'preload.js')
    : join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: app.isPackaged
      ? join(app.getAppPath(), 'dist', 'icon-512.png')
      : join(__dirname, '../public/icon-512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
      sandbox: false,
      // 외부 CDN 리소스 로드 허용 (Tailwind, esm.sh, Google Fonts)
      webSecurity: false,
    },
    show: false,
  });

  // CSP 설정: 외부 CDN 허용
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: file: https: http:;"
        ]
      }
    });
  });

  // 창이 준비되면 표시
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 개발 모드에서는 Vite 개발 서버 사용
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    const appPath = app.getAppPath();
    const indexPath = join(appPath, 'dist', 'index.html');

    console.log('App path:', appPath);
    console.log('Loading index.html from:', indexPath);

    if (existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      const altPath = join(__dirname, '../dist/index.html');
      if (existsSync(altPath)) {
        mainWindow.loadFile(altPath);
      } else {
        console.error('index.html NOT found');
        mainWindow.webContents.openDevTools();
      }
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC 핸들러: 파일 저장
ipcMain.handle('save-excel-file', async (event, buffer, defaultFileName) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '엑셀 파일 저장',
      defaultPath: defaultFileName || '분전함_검사현황.xlsx',
      filters: [
        { name: 'Excel Files', extensions: ['xlsx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (canceled) {
      return { success: false, canceled: true };
    }

    await writeFile(filePath, Buffer.from(buffer));
    return { success: true, filePath };
  } catch (error) {
    console.error('파일 저장 오류:', error);
    return { success: false, error: error.message };
  }
});

// IPC 핸들러: 파일 열기
ipcMain.handle('open-excel-file', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '엑셀 파일 열기',
      filters: [
        { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = filePaths[0];
    const fileBuffer = await readFile(filePath);
    return { success: true, filePath, buffer: Array.from(fileBuffer) };
  } catch (error) {
    console.error('파일 열기 오류:', error);
    return { success: false, error: error.message };
  }
});

// IPC 핸들러: 파일 저장 위치 가져오기
ipcMain.handle('get-save-directory', async () => {
  try {
    const { canceled, filePath } = await dialog.showOpenDialog(mainWindow, {
      title: '저장 폴더 선택',
      properties: ['openDirectory'],
    });

    if (canceled) {
      return { success: false, canceled: true };
    }

    return { success: true, directory: filePath };
  } catch (error) {
    console.error('폴더 선택 오류:', error);
    return { success: false, error: error.message };
  }
});
