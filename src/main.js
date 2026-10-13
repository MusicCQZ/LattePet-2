'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} = require('electron');
const {
  clampPosition,
  getDefaultPosition,
  getWindowSize,
} = require('./window-position');
const {
  advanceAutomaticMotion,
  createAutomaticMotion,
  reverseAutomaticMotion,
} = require('./automatic-motion');
const ASSET_MANIFEST = require('../assets/latte/animations/manifest.json');

const FIXED_SCALE = 0.8;
const BALL_WINDOW_SIZE = 48;
const NEST_WINDOW_SIZE = Object.freeze({ width: 156, height: 62 });
const TRAVEL_SPEED_PIXELS_PER_SECOND = 330;

const DEFAULT_PREFERENCES = Object.freeze({
  alwaysOnTop: true,
  autonomousBehaviors: true,
  launchAtLogin: false,
  position: null,
  nestPosition: null,
  scale: FIXED_SCALE,
});

let isQuitting = false;
let petWindow = null;
let preferences = { ...DEFAULT_PREFERENCES };
let tray = null;
let activeDrag = null;
let automaticMove = null;
let automaticMoveTimer = null;
let lastSizeDiagnostic = null;
let ballWindow = null;
let nestWindow = null;
let accessoryDrag = null;
let petTravel = null;
let petTravelTimer = null;

function logSizeDiagnostic(reason, details = {}) {
  if (process.env.LATTE_SIZE_DEBUG !== '1' || !petWindow || petWindow.isDestroyed()) {
    return;
  }

  const bounds = petWindow.getBounds();
  const contentBounds = petWindow.getContentBounds();
  const display = screen.getDisplayMatching(bounds);
  const requestedBaseSize = getWindowSize(FIXED_SCALE);
  if (['automatic-move-tick', 'automatic-move-set-position', 'native-resize-event'].includes(reason)
    && contentBounds.width === requestedBaseSize.width
    && contentBounds.height === requestedBaseSize.height) {
    return;
  }
  const signature = [bounds.width, bounds.height, contentBounds.width, contentBounds.height].join('x');
  if (lastSizeDiagnostic === signature && [
    'automatic-move-tick',
    'automatic-move-set-position',
  ].includes(reason)) {
    return;
  }
  lastSizeDiagnostic = signature;
  console.info(JSON.stringify({
    type: 'latte-size-debug',
    reason,
    details,
    bounds,
    contentBounds,
    displayScaleFactor: display.scaleFactor,
    fixedScale: FIXED_SCALE,
    requestedBaseSize,
  }));
}

function getPreferencesPath() {
  return path.join(app.getPath('userData'), 'preferences.json');
}

function loadPreferences() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getPreferencesPath(), 'utf8'));
    return {
      alwaysOnTop: parsed.alwaysOnTop !== false,
      autonomousBehaviors: parsed.autonomousBehaviors !== false,
      launchAtLogin: parsed.launchAtLogin === true,
      scale: FIXED_SCALE,
      position: parsed.position
        && Number.isFinite(parsed.position.x)
        && Number.isFinite(parsed.position.y)
        ? { x: parsed.position.x, y: parsed.position.y }
        : null,
      nestPosition: parsed.nestPosition
        && Number.isFinite(parsed.nestPosition.x)
        && Number.isFinite(parsed.nestPosition.y)
        ? { x: parsed.nestPosition.x, y: parsed.nestPosition.y }
        : null,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function savePreferences() {
  const destination = getPreferencesPath();
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, destination);
}

function getDisplayForPosition(position, size) {
  return screen.getDisplayNearestPoint({
    x: Math.round(position.x + size.width / 2),
    y: Math.round(position.y + size.height / 2),
  });
}

function getInitialBounds() {
  const size = getWindowSize(preferences.scale);

  if (!preferences.position) {
    const position = getDefaultPosition(size, screen.getPrimaryDisplay().workArea);
    return { ...position, ...size };
  }

  const display = getDisplayForPosition(preferences.position, size);
  const position = clampPosition(preferences.position, size, display.workArea);
  return { ...position, ...size };
}

function movePetWindow(position) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  // Windows can round a location-only move against a fractional display scale
  // into a resize.  Submit the complete immutable window geometry instead of
  // allowing the native API to reuse a rounded width from the prior move.
  const size = getWindowSize(FIXED_SCALE);
  petWindow.setBounds({
    x: Math.round(position.x),
    y: Math.round(position.y),
    ...size,
  });
}

function persistCurrentPosition() {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  const [x, y] = petWindow.getPosition();
  preferences.position = { x, y };
  savePreferences();
}

function stopAutomaticMove({ persist = true } = {}) {
  if (automaticMoveTimer) {
    clearInterval(automaticMoveTimer);
    automaticMoveTimer = null;
  }
  const wasMoving = Boolean(automaticMove);
  automaticMove = null;
  if (persist && wasMoving) {
    persistCurrentPosition();
  }
}

function stopPetTravel({ persist = true } = {}) {
  if (petTravelTimer) {
    clearInterval(petTravelTimer);
    petTravelTimer = null;
  }
  const wasTravelling = Boolean(petTravel);
  petTravel = null;
  if (persist && wasTravelling) {
    persistCurrentPosition();
  }
}

function sendTravelArrival(arrival) {
  if (!petWindow || petWindow.isDestroyed() || petWindow.webContents.isDestroyed()) {
    return;
  }
  petWindow.webContents.send('pet:travel-arrived', arrival);
}

function advancePetTravel() {
  if (!petTravel || !petWindow || petWindow.isDestroyed()) {
    stopPetTravel({ persist: false });
    return;
  }

  const elapsed = Math.max(0, performance.now() - petTravel.startedAt);
  const progress = Math.min(1, elapsed / petTravel.duration);
  const position = {
    x: petTravel.start.x + (petTravel.target.x - petTravel.start.x) * progress,
    y: petTravel.start.y + (petTravel.target.y - petTravel.start.y) * progress,
  };
  movePetWindow(position);

  if (progress < 1) {
    return;
  }

  const arrival = petTravel.arrival;
  stopPetTravel({ persist: true });
  sendTravelArrival(arrival);
}

function getTravelPosition(point) {
  const size = getWindowSize(FIXED_SCALE);
  const desired = {
    x: Math.round(point.x - size.width / 2),
    y: Math.round(point.y - size.height / 2),
  };
  const display = getDisplayForPosition(desired, size);
  return clampPosition(desired, size, display.workArea);
}

function startPetTravel(request) {
  if (!petWindow || petWindow.isDestroyed() || !request || !request.point) {
    return;
  }
  const point = request.point;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return;
  }

  stopAutomaticMove({ persist: false });
  stopPetTravel({ persist: false });
  const start = petWindow.getBounds();
  const target = getTravelPosition(point);
  const distance = Math.hypot(target.x - start.x, target.y - start.y);
  petTravel = {
    arrival: {
      kind: ['fetch', 'return-fetch', 'home'].includes(request.kind) ? request.kind : 'fetch',
      point: { x: Math.round(point.x), y: Math.round(point.y) },
    },
    duration: Math.max(500, (distance / TRAVEL_SPEED_PIXELS_PER_SECOND) * 1000),
    start: { x: start.x, y: start.y },
    startedAt: performance.now(),
    target,
  };
  petTravelTimer = setInterval(advancePetTravel, 16);
}

function advanceAutomaticWindowPosition() {
  if (!automaticMove || !petWindow || petWindow.isDestroyed()) {
    stopAutomaticMove({ persist: false });
    return;
  }

  const deltaX = advanceAutomaticMotion(automaticMove, performance.now());
  if (deltaX === 0) {
    return;
  }

  const bounds = petWindow.getBounds();
  const size = getWindowSize(FIXED_SCALE);
  const desiredPosition = { x: bounds.x + deltaX, y: bounds.y };
  const display = getDisplayForPosition(desiredPosition, size);
  const position = clampPosition(desiredPosition, size, display.workArea);
  const reachedBoundary = position.x !== desiredPosition.x;
  logSizeDiagnostic('automatic-move-tick', {
    deltaX,
    desiredPosition,
    position,
    reachedBoundary,
  });
  movePetWindow(position);
  logSizeDiagnostic('automatic-move-set-position', {
    deltaX,
    position,
  });

  if (reachedBoundary) {
    const direction = reverseAutomaticMotion(automaticMove, performance.now());
    petWindow.webContents.send('pet:auto-move-direction', direction);
  }
}

function startAutomaticMove(request) {
  stopPetTravel({ persist: false });
  stopAutomaticMove({ persist: false });
  try {
    automaticMove = createAutomaticMotion({
      direction: Number(request?.direction),
      now: performance.now(),
      speed: Number(request?.speed),
    });
  } catch {
    automaticMove = null;
    return;
  }
  automaticMoveTimer = setInterval(advanceAutomaticWindowPosition, 16);
  logSizeDiagnostic('automatic-move-start', { request });
}

function sendVisibilityToRenderer(visible) {
  if (!petWindow || petWindow.isDestroyed() || petWindow.webContents.isDestroyed()) {
    return;
  }

  petWindow.webContents.send('pet:visibility-changed', visible === true);
}

function showPet() {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  petWindow.show();
  petWindow.moveTop();
  sendVisibilityToRenderer(true);
}

function togglePetVisibility() {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  if (petWindow.isVisible()) {
    stopAutomaticMove();
    sendVisibilityToRenderer(false);
    petWindow.hide();
  } else {
    showPet();
  }
  refreshTrayMenu();
}

function setAlwaysOnTop(enabled) {
  preferences.alwaysOnTop = enabled;
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setAlwaysOnTop(enabled, 'floating');
  }
  for (const window of [ballWindow, nestWindow]) {
    if (window && !window.isDestroyed()) {
      window.setAlwaysOnTop(enabled, 'floating');
    }
  }
  savePreferences();
  refreshTrayMenu();
}

function setLaunchAtLogin(enabled) {
  preferences.launchAtLogin = enabled;
  const loginSettings = { openAtLogin: enabled };
  if (process.platform === 'darwin') {
    loginSettings.openAsHidden = true;
  }
  app.setLoginItemSettings(loginSettings);
  savePreferences();
  refreshTrayMenu();
}

function sendStateToRenderer() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:state-changed', getPublicState());
  }
}

function setAutonomousBehaviors(enabled) {
  preferences.autonomousBehaviors = enabled;
  savePreferences();
  sendStateToRenderer();
  refreshTrayMenu();
}

function sendPetCommand(command) {
  if (petWindow && !petWindow.isDestroyed()) {
    showPet();
    petWindow.webContents.send('pet:command', command);
  }
}

function getBallDefaultPosition() {
  if (!petWindow || petWindow.isDestroyed()) {
    return screen.getCursorScreenPoint();
  }
  const bounds = petWindow.getBounds();
  return {
    x: bounds.x + bounds.width + 16,
    y: bounds.y + Math.round(bounds.height * 0.63),
  };
}

function createBallWindow() {
  if (ballWindow && !ballWindow.isDestroyed()) {
    return ballWindow;
  }
  const point = getBallDefaultPosition();
  ballWindow = new BrowserWindow({
    x: Math.round(point.x),
    y: Math.round(point.y),
    width: BALL_WINDOW_SIZE,
    height: BALL_WINDOW_SIZE,
    alwaysOnTop: preferences.alwaysOnTop,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
    },
  });
  ballWindow.setMenuBarVisibility(false);
  ballWindow.loadFile(path.join(__dirname, 'toy.html'));
  ballWindow.on('closed', () => {
    ballWindow = null;
    accessoryDrag = null;
  });
  return ballWindow;
}

function showBallAt(point = getBallDefaultPosition()) {
  const ball = createBallWindow();
  if (!ball || ball.isDestroyed()) {
    return;
  }
  ball.setBounds({
    x: Math.round(point.x - BALL_WINDOW_SIZE / 2),
    y: Math.round(point.y - BALL_WINDOW_SIZE / 2),
    width: BALL_WINDOW_SIZE,
    height: BALL_WINDOW_SIZE,
  });
  ball.show();
  ball.moveTop();
}

function moveAccessoryWindow(window, position, size) {
  if (!window || window.isDestroyed()) {
    return;
  }

  // As with Latte's main window, Windows can turn a location-only move on a
  // fractional-DPI display into a rounded resize.  The ball receives many
  // pointer-move messages during a long press, so reuse of a rounded prior
  // width became a visible, cumulative enlargement.  Make every accessory
  // move an immutable complete rectangle.
  window.setBounds({
    x: Math.round(position.x),
    y: Math.round(position.y),
    width: size.width,
    height: size.height,
  });
}

function getNestDefaultPosition() {
  if (preferences.nestPosition) {
    return preferences.nestPosition;
  }
  if (!petWindow || petWindow.isDestroyed()) {
    return screen.getCursorScreenPoint();
  }
  const bounds = petWindow.getBounds();
  return {
    x: bounds.x + Math.round((bounds.width - NEST_WINDOW_SIZE.width) / 2),
    y: bounds.y + bounds.height - NEST_WINDOW_SIZE.height + 8,
  };
}

function createNestWindow() {
  if (nestWindow && !nestWindow.isDestroyed()) {
    return nestWindow;
  }
  const position = getNestDefaultPosition();
  nestWindow = new BrowserWindow({
    x: Math.round(position.x),
    y: Math.round(position.y),
    ...NEST_WINDOW_SIZE,
    alwaysOnTop: preferences.alwaysOnTop,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
    },
  });
  nestWindow.setMenuBarVisibility(false);
  nestWindow.loadFile(path.join(__dirname, 'nest.html'));
  nestWindow.on('hide', sendStateToRenderer);
  nestWindow.on('show', sendStateToRenderer);
  nestWindow.on('closed', () => {
    nestWindow = null;
    accessoryDrag = null;
    sendStateToRenderer();
  });
  return nestWindow;
}

function showNest() {
  const nest = createNestWindow();
  if (!nest || nest.isDestroyed()) {
    return;
  }
  nest.show();
  nest.moveTop();
  sendStateToRenderer();
  refreshTrayMenu();
}

function toggleNest() {
  if (nestWindow && !nestWindow.isDestroyed() && nestWindow.isVisible()) {
    nestWindow.hide();
  } else {
    showNest();
  }
  refreshTrayMenu();
}

function getNestCenter() {
  if (!nestWindow || nestWindow.isDestroyed() || !nestWindow.isVisible()) {
    return null;
  }
  const bounds = nestWindow.getBounds();
  const petSize = getWindowSize(FIXED_SCALE);
  return {
    x: bounds.x + Math.round(bounds.width / 2),
    // startPetTravel receives a point for the *centre* of Latte's immutable
    // window.  Offset it so the fixed bottom baseline sits on the mat instead
    // of putting the whole transparent window centre on top of the mat.
    y: bounds.y + bounds.height - Math.round(petSize.height / 2) + 6,
  };
}

function sendPetHome() {
  showNest();
  const point = getNestCenter();
  if (point) {
    sendPetCommand({ type: 'home', point });
  }
}

function resetPosition() {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  const size = getWindowSize(preferences.scale);
  const position = getDefaultPosition(size, screen.getPrimaryDisplay().workArea);
  petWindow.setBounds({ ...position, ...size }, true);
  logSizeDiagnostic('reset-position', { position, size });
  preferences.position = position;
  savePreferences();
}

function getPublicState() {
  return {
    assets: ASSET_MANIFEST,
    autonomousBehaviors: preferences.autonomousBehaviors,
    name: '拿铁',
    nest: {
      visible: Boolean(nestWindow && !nestWindow.isDestroyed() && nestWindow.isVisible()),
    },
    platform: process.platform,
    scale: preferences.scale,
  };
}

function buildTrayMenu() {
  const visible = Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible());

  return Menu.buildFromTemplate([
    {
      label: visible ? '隐藏拿铁' : '显示拿铁',
      click: togglePetVisibility,
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: preferences.alwaysOnTop,
      click: (item) => setAlwaysOnTop(item.checked),
    },
    {
      label: '和拿铁互动',
      submenu: [
        {
          label: '出去走走',
          click: () => sendPetCommand('walk'),
        },
        {
          label: '睡一会儿',
          click: () => sendPetCommand('sleep'),
        },
        {
          label: '伸个懒腰',
          click: () => sendPetCommand('stretch'),
        },
        { type: 'separator' },
        {
          label: '拿一块小饼干',
          click: () => sendPetCommand('feed'),
        },
        {
          label: '拿出小球',
          click: () => {
            showBallAt();
            sendPetCommand('ball');
          },
        },
        {
          label: nestWindow && !nestWindow.isDestroyed() && nestWindow.isVisible()
            ? '收起小窝'
            : '摆放小窝',
          click: toggleNest,
        },
        {
          label: '回小窝休息',
          click: sendPetHome,
        },
      ],
    },
    {
      label: '允许拿铁自己活动',
      type: 'checkbox',
      checked: preferences.autonomousBehaviors,
      click: (item) => setAutonomousBehaviors(item.checked),
    },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: preferences.launchAtLogin,
      click: (item) => setLaunchAtLogin(item.checked),
    },
    {
      label: '回到主屏幕右下角',
      click: resetPosition,
    },
    { type: 'separator' },
    {
      label: '退出拿铁桌宠',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildTrayMenu());
  }
}

function createTray() {
  const iconPath = path.join(
    __dirname,
    '..',
    'assets',
    'latte',
    'previews',
    'latte-base-preview-v1.png',
  );
  const traySize = process.platform === 'darwin' ? 20 : 32;
  const icon = nativeImage.createFromPath(iconPath).resize({
    height: traySize,
    width: traySize,
  });

  tray = new Tray(icon);
  tray.setToolTip('拿铁桌宠');
  tray.setContextMenu(buildTrayMenu());
  if (process.platform !== 'darwin') {
    tray.on('click', togglePetVisibility);
  }
}

function createPetWindow() {
  const bounds = getInitialBounds();
  petWindow = new BrowserWindow({
    ...bounds,
    alwaysOnTop: preferences.alwaysOnTop,
    backgroundColor: '#00000000',
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title: '拿铁桌宠',
    transparent: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
    },
  });

  petWindow.setMenuBarVisibility(false);
  petWindow.on('resize', () => logSizeDiagnostic('native-resize-event'));
  petWindow.on('resized', () => logSizeDiagnostic('native-resized-event'));

  if (process.platform === 'darwin') {
    petWindow.setVisibleOnAllWorkspaces(true, {
      skipTransformProcessType: true,
      visibleOnFullScreen: true,
    });
    petWindow.setHiddenInMissionControl(true);
  }

  petWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  logSizeDiagnostic('window-created', { bounds });
  petWindow.once('ready-to-show', showPet);
  petWindow.on('show', () => {
    sendVisibilityToRenderer(true);
    refreshTrayMenu();
  });
  petWindow.on('hide', () => {
    stopAutomaticMove();
    stopPetTravel({ persist: false });
    activeDrag = null;
    sendVisibilityToRenderer(false);
    refreshTrayMenu();
  });
  petWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      petWindow.hide();
    }
  });
  petWindow.on('closed', () => {
    stopAutomaticMove({ persist: false });
    stopPetTravel({ persist: false });
    petWindow = null;
  });
}

function isTrustedSender(event) {
  return petWindow
    && !petWindow.isDestroyed()
    && event.sender === petWindow.webContents;
}

function registerIpc() {
  ipcMain.handle('pet:get-state', (event) => {
    if (!isTrustedSender(event)) {
      return null;
    }
    return getPublicState();
  });

  ipcMain.on('pet:drag-start', (event) => {
    if (!isTrustedSender(event)) {
      return;
    }
    stopAutomaticMove({ persist: false });
    stopPetTravel({ persist: false });
    const [x, y] = petWindow.getPosition();
    activeDrag = { x, y };
  });

  ipcMain.on('pet:drag-move', (event, delta) => {
    if (!isTrustedSender(event) || !activeDrag || !delta) {
      return;
    }

    const dx = Number(delta.x);
    const dy = Number(delta.y);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 10000 || Math.abs(dy) > 10000) {
      return;
    }

    const size = getWindowSize(FIXED_SCALE);
    const desiredPosition = {
      x: activeDrag.x + dx,
      y: activeDrag.y + dy,
    };
    const display = getDisplayForPosition(desiredPosition, size);
    const position = clampPosition(desiredPosition, size, display.workArea);
    movePetWindow(position);
  });

  ipcMain.on('pet:drag-end', (event) => {
    if (!isTrustedSender(event)) {
      return;
    }
    activeDrag = null;
    persistCurrentPosition();
  });

  ipcMain.on('pet:auto-move-start', (event, request) => {
    if (isTrustedSender(event)) {
      startAutomaticMove(request);
    }
  });

  ipcMain.on('pet:travel-start', (event, request) => {
    if (isTrustedSender(event)) {
      startPetTravel(request);
    }
  });

  ipcMain.on('pet:fetch-finish', (event, request) => {
    if (!isTrustedSender(event)) {
      return;
    }
    const point = request?.point;
    if (request?.keepBall === true) {
      return;
    }
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
      showBallAt(point);
    }
  });

  ipcMain.on('pet:fetch-return', (event) => {
    if (isTrustedSender(event)) {
      startPetTravel({
        kind: 'return-fetch',
        point: screen.getCursorScreenPoint(),
      });
    }
  });

  ipcMain.on('pet:request-home', (event) => {
    if (isTrustedSender(event)) {
      sendPetHome();
    }
  });

  ipcMain.on('pet:auto-move-end', (event) => {
    if (isTrustedSender(event)) {
      stopAutomaticMove();
    }
  });

  ipcMain.on('pet:show-menu', (event) => {
    if (isTrustedSender(event) && tray && !tray.isDestroyed()) {
      tray.popUpContextMenu();
    }
  });

  ipcMain.on('toy:drag-start', (event) => {
    if (!ballWindow || ballWindow.isDestroyed() || event.sender !== ballWindow.webContents) {
      return;
    }
    const bounds = ballWindow.getBounds();
    accessoryDrag = { kind: 'ball', x: bounds.x, y: bounds.y };
  });

  ipcMain.on('toy:drag-move', (event, delta) => {
    if (!ballWindow || ballWindow.isDestroyed() || event.sender !== ballWindow.webContents
      || accessoryDrag?.kind !== 'ball') {
      return;
    }
    const dx = Number(delta?.x);
    const dy = Number(delta?.y);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 10000 || Math.abs(dy) > 10000) {
      return;
    }
    moveAccessoryWindow(ballWindow, {
      x: accessoryDrag.x + dx,
      y: accessoryDrag.y + dy,
    }, {
      width: BALL_WINDOW_SIZE,
      height: BALL_WINDOW_SIZE,
    });
  });

  ipcMain.on('toy:drag-end', (event, details) => {
    if (!ballWindow || ballWindow.isDestroyed() || event.sender !== ballWindow.webContents
      || accessoryDrag?.kind !== 'ball') {
      return;
    }
    accessoryDrag = null;
    const bounds = ballWindow.getBounds();
    const point = { x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) };
    ballWindow.hide();
    if (details?.moved === true) {
      sendPetCommand({ type: 'fetch', point });
    }
  });

  ipcMain.on('nest:drag-start', (event) => {
    if (!nestWindow || nestWindow.isDestroyed() || event.sender !== nestWindow.webContents) {
      return;
    }
    const bounds = nestWindow.getBounds();
    accessoryDrag = { kind: 'nest', x: bounds.x, y: bounds.y };
  });

  ipcMain.on('nest:drag-move', (event, delta) => {
    if (!nestWindow || nestWindow.isDestroyed() || event.sender !== nestWindow.webContents
      || accessoryDrag?.kind !== 'nest') {
      return;
    }
    const dx = Number(delta?.x);
    const dy = Number(delta?.y);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 10000 || Math.abs(dy) > 10000) {
      return;
    }
    moveAccessoryWindow(nestWindow, {
      x: accessoryDrag.x + dx,
      y: accessoryDrag.y + dy,
    }, NEST_WINDOW_SIZE);
  });

  ipcMain.on('nest:drag-end', (event) => {
    if (!nestWindow || nestWindow.isDestroyed() || event.sender !== nestWindow.webContents
      || accessoryDrag?.kind !== 'nest') {
      return;
    }
    accessoryDrag = null;
    const [x, y] = nestWindow.getPosition();
    preferences.nestPosition = { x, y };
    savePreferences();
  });

  ipcMain.on('nest:activate', (event) => {
    if (nestWindow && !nestWindow.isDestroyed() && event.sender === nestWindow.webContents) {
      sendPetHome();
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showPet);

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }

    preferences = loadPreferences();
    registerIpc();
    createPetWindow();
    createTray();

    app.on('activate', showPet);
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopAutomaticMove({ persist: false });
    stopPetTravel({ persist: false });
  });

  app.on('window-all-closed', () => {
    // The tray owns the app lifecycle on both Windows and macOS.
  });
}
