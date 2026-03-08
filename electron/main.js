const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow, globalShortcut, screen: electronScreen } = require("electron");

const ROOT_DIR = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const PORT = 3000;
const BASE_URL = `http://${HOST}:${PORT}`;

let mainWindow = null;
let overlayWindow = null;
let serverProcess = null;
let serverStartedByDesktop = false;

app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

app.whenReady().then(async () => {
  await ensureServer();
  createMainWindow();
  createOverlayWindow();
  registerShortcuts();
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createOverlayWindow();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopServerIfNeeded();
});

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#f5f1e8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(BASE_URL);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  const display = electronScreen.getPrimaryDisplay();
  const width = 420;
  const height = 170;
  const x = Math.round(display.workArea.x + display.workArea.width - width - 24);
  const y = Math.round(display.workArea.y + 24);

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    movable: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadURL(`${BASE_URL}/overlay.html`);
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function registerShortcuts() {
  globalShortcut.register("CommandOrControl+Shift+T", () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      createOverlayWindow();
      return;
    }
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.showInactive();
    }
  });

  globalShortcut.register("CommandOrControl+Shift+H", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });
}

async function ensureServer() {
  if (await isServerReady()) {
    return;
  }
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST,
      PORT: String(PORT)
    },
    stdio: "ignore",
    windowsHide: true
  });
  serverStartedByDesktop = true;
  await waitForServer();
}

async function isServerReady() {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await isServerReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Desktop mode could not reach local server.");
}

function stopServerIfNeeded() {
  if (serverStartedByDesktop && serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
}
