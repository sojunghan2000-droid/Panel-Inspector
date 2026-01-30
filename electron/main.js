import { app, BrowserWindow, ipcMain, dialog } from 'electron';
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
      sandbox: false, // preload 스크립트 실행을 위해 필요
    },
    show: false, // 준비될 때까지 숨김
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
    // 프로덕션 모드에서는 빌드된 파일 사용
    // app.getAppPath()는 패키징된 앱에서 올바른 경로를 반환합니다
    const appPath = app.getAppPath();
    const indexPath = join(appPath, 'dist', 'index.html');
    
    // 디버깅을 위해 콘솔에 경로 출력
    console.log('App path:', appPath);
    console.log('Loading index.html from:', indexPath);
    console.log('__dirname:', __dirname);
    
    // 파일 존재 여부 확인
    if (existsSync(indexPath)) {
      console.log('index.html exists at:', indexPath);
    } else {
      console.error('index.html NOT found at:', indexPath);
      // 대체 경로 시도
      const altPath = join(__dirname, '../dist/index.html');
      console.log('Trying alternative path:', altPath);
      if (existsSync(altPath)) {
        console.log('Found at alternative path');
        mainWindow.loadFile(altPath);
        return;
      }
    }
    
    mainWindow.loadFile(indexPath).catch((error) => {
      console.error('Failed to load index.html:', error);
      // 폴백: 상대 경로 시도
      mainWindow.loadFile(join(__dirname, '../dist/index.html')).catch((err) => {
        console.error('Fallback path also failed:', err);
        // 개발자 도구 열기 (디버깅용)
        mainWindow.webContents.openDevTools();
      });
    });
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
