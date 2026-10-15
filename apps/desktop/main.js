import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const testMode = !app.isPackaged && process.env.LL_DESKTOP_TEST === '1';
const dataDir = testMode
  ? resolve(process.env.LL_DATA_DIR)
  : join(process.env.LOCALAPPDATA || app.getPath('userData'), 'LimitedLibrary');
// Test overrides are never accepted by the distributed application.
if (testMode) app.setPath('userData', `${dataDir}-profile`);
app.setName('Limited Library');
app.setAppUserModelId('com.oldbeer.limitedlibrary');
let backend;
let window;
let quitting = false;
let readyUrl;
let backupBusy = false;
function log(message) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    appendFileSync(
      join(app.getPath('userData'), 'desktop.log'),
      `${new Date().toISOString()} ${message}\n`,
    );
  } catch {
    /* Startup errors must still reach the native dialog. */
  }
}
function allowed(url) {
  try {
    return new URL(url).origin === new URL(readyUrl).origin;
  } catch {
    return false;
  }
}
async function stopBackend() {
  if (!backend || backend.exitCode !== null) return;
  const child = backend;
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      log('Backend shutdown timed out; disconnecting IPC for graceful cleanup.');
      if (child.connected) child.disconnect();
      resolveStop();
    }, 8000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveStop();
    });
    if (child.connected) child.send('shutdown');
    else resolveStop();
  });
}
async function startBackend() {
  const payload = app.isPackaged ? join(process.resourcesPath, 'backend') : resolve(here, '../..');
  const runtime = app.isPackaged ? join(payload, 'runtime/node.exe') : process.env.LL_NODE_PATH;
  if (!runtime || !existsSync(runtime)) throw new Error('未找到随程序提供的运行环境，请重新安装。');
  backend = fork(join(payload, 'apps/server/dist/desktop.js'), [], {
    execPath: runtime,
    execArgv: [],
    cwd: payload,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      NODE_PATH: '',
      LL_MODE: 'production',
      LL_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  backend.stdout.on('data', (bytes) => log(bytes.toString().trim()));
  backend.stderr.on('data', (bytes) => log(bytes.toString().trim()));
  backend.on('error', (error) => log(error.message));
  const child = backend;
  const result = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(
      () => reject(new Error('本地资料库启动超时，请查看诊断日志。')),
      20000,
    );
    const done = (error, value) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else resolveReady(value);
    };
    const onMessage = (message) => {
      if (message?.kind === 'ready') done(null, message);
      if (message?.kind === 'fatal') done(new Error(message.message));
    };
    const onExit = () => done(new Error('本地资料库未能启动，请查看诊断日志。'));
    const onError = (error) => done(error);
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
  child.on('exit', (code) => {
    if (!quitting) {
      log(`Backend unexpectedly exited: ${code}`);
      dialog.showErrorBox('资料库服务已停止', '请退出后重新打开程序。已有资料保留在本机。');
      app.quit();
    }
  });
  return `http://127.0.0.1:${result.port}`;
}
async function makeBackup() {
  if (backupBusy || !backend?.connected) return;
  backupBusy = true;
  try {
    const choice = await dialog.showMessageBox(window, {
      type: 'question',
      title: '备份资料库',
      message: '请先保存正在编辑的内容。',
      detail: '备份会短暂停止服务并重新载入界面。接下来选择备份存放的文件夹；原有文件不会被覆盖。',
      buttons: ['取消', '选择备份位置'],
      defaultId: 1,
      cancelId: 0,
    });
    if (choice.response !== 1) return;
    const selected = await dialog.showOpenDialog(window, {
      title: '选择备份存放位置',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selected.canceled) return;
    const destination = join(
      selected.filePaths[0],
      `LimitedLibrary-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    );
    const requestId = randomUUID();
    const result = await new Promise((resolveBackup, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('备份超时，请查看诊断日志。'));
      }, 120000);
      const cleanup = () => {
        clearTimeout(timer);
        backend.off('message', onMessage);
        backend.off('exit', onExit);
      };
      const onMessage = (message) => {
        if (message?.kind !== 'backup' || message.requestId !== requestId) return;
        cleanup();
        if (message.error) reject(new Error(message.error));
        else resolveBackup(message);
      };
      const onExit = () => {
        cleanup();
        reject(new Error('备份期间服务已退出。'));
      };
      backend.on('message', onMessage);
      backend.once('exit', onExit);
      backend.send({ kind: 'backup', requestId, destination });
    });
    window.webContents.reload();
    await dialog.showMessageBox(window, {
      type: 'info',
      title: '备份完成',
      message: `已备份 ${result.items} 条作品及 ${result.covers} 张封面。`,
      detail: destination,
    });
    await shell.openPath(destination);
  } catch (error) {
    window?.webContents.reload();
    await dialog.showMessageBox(window, {
      type: 'error',
      title: '备份未完成',
      message: error.message,
    });
  } finally {
    backupBusy = false;
  }
}
function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '文件',
        submenu: [
          { label: '备份资料库…', click: makeBackup },
          { label: '打开数据文件夹', click: () => shell.openPath(dataDir) },
          { type: 'separator' },
          { label: '退出', role: 'quit' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { label: '撤销', role: 'undo' },
          { label: '重做', role: 'redo' },
          { type: 'separator' },
          { label: '剪切', role: 'cut' },
          { label: '复制', role: 'copy' },
          { label: '粘贴', role: 'paste' },
          { label: '全选', role: 'selectAll' },
        ],
      },
      {
        label: '查看',
        submenu: [
          { label: '放大', role: 'zoomIn' },
          { label: '缩小', role: 'zoomOut' },
          { label: '实际大小', role: 'resetZoom' },
          { type: 'separator' },
          { label: '全屏', role: 'togglefullscreen' },
        ],
      },
      {
        label: '帮助',
        submenu: [
          { label: '打开诊断日志文件夹', click: () => shell.openPath(app.getPath('userData')) },
          {
            label: '关于 Limited Library',
            click: () =>
              dialog.showMessageBox(window, {
                type: 'info',
                title: 'Limited Library',
                message: '有限收藏，无限记忆。',
                detail: `版本 ${app.getVersion()} · Windows x64\n资料保存在 ${dataDir}\n退出程序后，完整复制数据文件夹也可保留一份备份。安装和卸载不会清空作品。`,
              }),
          },
        ],
      },
    ]),
  );
}
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void stopBackend().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    try {
      readyUrl = await startBackend();
      buildMenu();
      window = new BrowserWindow({
        title: 'Limited Library · 有限收藏，无限记忆',
        width: 1280,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#171a16',
        show: false,
        icon: join(here, 'icon.ico'),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
          devTools: !app.isPackaged,
        },
      });
      const session = window.webContents.session;
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.setPermissionCheckHandler(() => false);
      session.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: !allowed(details.url) }),
      );
      session.webRequest.onHeadersReceived((details, callback) =>
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'",
            ],
          },
        }),
      );
      session.on('will-download', (event) => event.preventDefault());
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        if (!allowed(url)) event.preventDefault();
      });
      window.webContents.on('will-redirect', (event, url) => {
        if (!allowed(url)) event.preventDefault();
      });
      await window.loadURL(readyUrl);
      window.show();
    } catch (error) {
      log(error.stack || error.message);
      dialog.showErrorBox(
        'Limited Library 启动失败',
        `${error.message}\n\n数据位置：${dataDir}\n请先关闭旧版浏览器服务或另一个正在使用该目录的程序。不会清空或重建已有资料库。`,
      );
      app.quit();
    }
  });
}
