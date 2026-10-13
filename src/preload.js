'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lattePet', Object.freeze({
  endAutomaticMove: () => ipcRenderer.send('pet:auto-move-end'),
  endDrag: () => ipcRenderer.send('pet:drag-end'),
  getState: () => ipcRenderer.invoke('pet:get-state'),
  moveDrag: (delta) => ipcRenderer.send('pet:drag-move', delta),
  onAutomaticDirectionChanged: (callback) => {
    const handler = (_event, direction) => callback(direction);
    ipcRenderer.on('pet:auto-move-direction', handler);
    return () => ipcRenderer.removeListener('pet:auto-move-direction', handler);
  },
  onCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on('pet:command', handler);
    return () => ipcRenderer.removeListener('pet:command', handler);
  },
  onVisibilityChanged: (callback) => {
    const handler = (_event, visible) => callback(visible === true);
    ipcRenderer.on('pet:visibility-changed', handler);
    return () => ipcRenderer.removeListener('pet:visibility-changed', handler);
  },
  onStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('pet:state-changed', handler);
    return () => ipcRenderer.removeListener('pet:state-changed', handler);
  },
  showMenu: () => ipcRenderer.send('pet:show-menu'),
  startTravel: (request) => ipcRenderer.send('pet:travel-start', request),
  startAutomaticMove: (request) => ipcRenderer.send('pet:auto-move-start', request),
  startDrag: () => ipcRenderer.send('pet:drag-start'),
  finishFetch: (request) => ipcRenderer.send('pet:fetch-finish', request),
  returnFetch: () => ipcRenderer.send('pet:fetch-return'),
  requestHome: () => ipcRenderer.send('pet:request-home'),
  onTravelArrived: (callback) => {
    const handler = (_event, arrival) => callback(arrival);
    ipcRenderer.on('pet:travel-arrived', handler);
    return () => ipcRenderer.removeListener('pet:travel-arrived', handler);
  },
}));

contextBridge.exposeInMainWorld('latteToy', Object.freeze({
  endDrag: (details) => ipcRenderer.send('toy:drag-end', details),
  moveDrag: (delta) => ipcRenderer.send('toy:drag-move', delta),
  startDrag: () => ipcRenderer.send('toy:drag-start'),
}));

contextBridge.exposeInMainWorld('latteNest', Object.freeze({
  activate: () => ipcRenderer.send('nest:activate'),
  endDrag: () => ipcRenderer.send('nest:drag-end'),
  moveDrag: (delta) => ipcRenderer.send('nest:drag-move', delta),
  startDrag: () => ipcRenderer.send('nest:drag-start'),
}));
