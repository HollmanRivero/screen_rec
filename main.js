const { app, BrowserWindow, ipcMain, desktopCapturer, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile } = require('child_process')
const ffmpegPath = require('ffmpeg-static')

let mainWindow
let selectedSourceId = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 620,
    frame: false,
    transparent: false,
    resizable: false,
    backgroundColor: '#0f0f1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'icon.png')
  })

  mainWindow.loadFile('index.html')

  // Intercept getDisplayMedia to inject loopback (system) audio on Windows
  mainWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      const source = sources.find(s => s.id === selectedSourceId) || sources[0]
      callback({ video: source, audio: 'loopback' })
    })
  }, { useSystemPicker: false })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 }
  })
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL()
  }))
})

ipcMain.handle('save-as-mp4', async (event, buffer) => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const tmpWebm = path.join(os.tmpdir(), `screenrec-${ts}.webm`)
  const defaultName = `screenrec-${ts}.mp4`

  fs.writeFileSync(tmpWebm, Buffer.from(buffer))

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Recording',
    defaultPath: path.join(app.getPath('videos'), defaultName),
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  })

  if (canceled || !filePath) {
    fs.unlinkSync(tmpWebm)
    return { success: false }
  }

  return new Promise((resolve) => {
    execFile(ffmpegPath, [
      '-i', tmpWebm,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-c:a', 'aac',
      '-y', filePath
    ], (err) => {
      fs.unlinkSync(tmpWebm)
      if (err) resolve({ success: false, error: err.message })
      else resolve({ success: true, filePath })
    })
  })
})

ipcMain.on('set-source-id', (_, id) => { selectedSourceId = id })
ipcMain.on('minimize-window', () => mainWindow.minimize())
ipcMain.on('close-window', () => mainWindow.close())
