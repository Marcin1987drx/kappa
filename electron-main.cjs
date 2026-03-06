const { app, BrowserWindow, dialog, session, shell, ipcMain, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const http = require('http');
const net = require('net');

const PORT = 3001;
let mainWindow = null;
let serverProcess = null;

// ──── Single Instance Lock ────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Another instance is already running – quit immediately
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to open a second instance – focus the existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function getResourcePath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(__dirname, ...segments);
}

// ──── Kill any leftover process on PORT (previous crash) ────
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is in use – attempting to free it...`);
        // Try to kill the process holding the port (Windows)
        try {
          if (process.platform === 'win32') {
            const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', timeout: 5000 });
            const lines = result.trim().split('\n');
            const pids = new Set();
            for (const line of lines) {
              const parts = line.trim().split(/\s+/);
              const pid = parts[parts.length - 1];
              if (pid && pid !== '0') pids.add(pid);
            }
            for (const pid of pids) {
              try { execSync(`taskkill /F /PID ${pid}`, { timeout: 5000 }); } catch (_) {}
            }
            console.log(`Killed leftover processes on port ${port}`);
          }
        } catch (_) {
          // Could not kill – will fail later with a clear error
        }
        // Wait a moment for the port to free up
        setTimeout(resolve, 1000);
      } else {
        resolve();
      }
    });
    server.once('listening', () => {
      server.close(() => resolve());
    });
    server.listen(port, '127.0.0.1');
  });
}

function startServer() {
  return new Promise(async (resolve, reject) => {
    // Free port if a leftover process from a previous crash is holding it
    await killProcessOnPort(PORT);

    const serverPath = getResourcePath('backend', 'dist', 'server.js');
    const backendCwd = getResourcePath('backend');

    // Verify server file exists
    if (!fs.existsSync(serverPath)) {
      reject(new Error(`Server file not found: ${serverPath}`));
      return;
    }

    let serverStderr = '';

    // Use Electron's utilityProcess.fork() – runs a proper Node.js environment
    // that supports ESM modules without needing ELECTRON_RUN_AS_NODE
    try {
      serverProcess = utilityProcess.fork(serverPath, [], {
        cwd: backendCwd,
        env: {
          ...process.env,
          PORT: String(PORT),
          NODE_ENV: 'production',
          ELECTRON: '1'
        },
        stdio: 'pipe'
      });
    } catch (err) {
      reject(new Error(`Failed to fork server process: ${err.message}`));
      return;
    }

    serverProcess.stdout.on('data', (data) => {
      console.log('[server]', data.toString().trim());
    });

    serverProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      console.error('[server]', msg);
      serverStderr += msg + '\n';
    });

    let earlyExit = false;
    serverProcess.on('exit', (code) => {
      console.log(`Server process exited with code ${code}`);
      if (!earlyExit) {
        earlyExit = true;
        reject(new Error(`Server process crashed (exit code ${code}).\n\n${serverStderr}`));
      }
      serverProcess = null;
    });

    let attempts = 0;
    const maxAttempts = 40;
    const poll = setInterval(() => {
      if (earlyExit) {
        clearInterval(poll);
        return;
      }
      attempts++;
      const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(poll);
          earlyExit = true; // prevent the exit handler from rejecting
          resolve();
        }
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          clearInterval(poll);
          reject(new Error(`Server did not respond within 20 seconds.\n\nServer logs:\n${serverStderr}`));
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
  // If we didn't get the lock, quit was already called
  if (!gotTheLock) return;

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
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    app.quit();
  }
});

function cleanupServer() {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch (_) {}
    serverProcess = null;
  }
}

app.on('window-all-closed', () => {
  cleanupServer();
  app.quit();
});

app.on('before-quit', () => {
  cleanupServer();
});

app.on('will-quit', () => {
  cleanupServer();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
