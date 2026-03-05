const { app, BrowserWindow, dialog, session, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 3001;
let mainWindow = null;
let serverProcess = null;

function getResourcePath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(__dirname, ...segments);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = getResourcePath('backend', 'dist', 'server.js');
    const backendCwd = getResourcePath('backend');

    serverProcess = spawn(process.execPath, [serverPath], {
      cwd: backendCwd,
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'production',
        ELECTRON: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      console.log('[server]', data.toString().trim());
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[server]', data.toString().trim());
    });

    serverProcess.on('error', (err) => {
      reject(new Error(`Failed to start server: ${err.message}`));
    });

    serverProcess.on('exit', (code) => {
      console.log(`Server process exited with code ${code}`);
      serverProcess = null;
    });

    let attempts = 0;
    const maxAttempts = 40;
    const poll = setInterval(() => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(poll);
          resolve();
        }
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          clearInterval(poll);
          reject(new Error('Server did not start within 20 seconds'));
        }
      });
      req.setTimeout(500, () => req.destroy());
    }, 500);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Kappa Plannung',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.cjs')
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Handle standard file downloads triggered by the browser
  session.defaultSession.on('will-download', (event, item) => {
    const fileName = item.getFilename();
    const ext = path.extname(fileName).toLowerCase();
    const filterMap = {
      '.pdf': { name: 'PDF', extensions: ['pdf'] },
      '.xlsx': { name: 'Excel', extensions: ['xlsx'] },
      '.csv': { name: 'CSV', extensions: ['csv'] },
      '.json': { name: 'JSON', extensions: ['json'] },
      '.db': { name: 'Database', extensions: ['db'] },
    };
    const filter = filterMap[ext] || { name: 'All Files', extensions: ['*'] };

    const savePath = dialog.showSaveDialogSync(mainWindow, {
      defaultPath: fileName,
      filters: [filter]
    });

    if (savePath) {
      item.setSavePath(savePath);
    } else {
      item.cancel();
    }
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handler for blob downloads from renderer (jsPDF, file-saver, <a> blob clicks)
ipcMain.handle('save-file', async (event, { buffer, filename }) => {
  const ext = path.extname(filename).toLowerCase();
  const filterMap = {
    '.pdf': { name: 'PDF', extensions: ['pdf'] },
    '.xlsx': { name: 'Excel', extensions: ['xlsx'] },
    '.csv': { name: 'CSV', extensions: ['csv'] },
    '.json': { name: 'JSON', extensions: ['json'] },
    '.db': { name: 'Database', extensions: ['db'] },
  };
  const filter = filterMap[ext] || { name: 'All Files', extensions: ['*'] };

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: filename,
    filters: [filter]
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, Buffer.from(buffer));
    return { saved: true, path: result.filePath };
  }
  return { saved: false };
});

app.whenReady().then(async () => {
  try {
    console.log('Starting Kappa Plannung server...');
    await startServer();
    console.log('Server ready on port', PORT);
    createWindow();
  } catch (err) {
    dialog.showErrorBox(
      'Kappa Plannung - Fehler',
      `Die Anwendung konnte nicht gestartet werden:\n\n${err.message}\n\nBitte versuchen Sie es erneut.`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
