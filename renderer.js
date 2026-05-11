const { ipcRenderer } = require('electron')

// ── Elements ──
const sourceList      = document.getElementById('source-list')
const btnRefresh      = document.getElementById('btn-refresh')
const btnRecord       = document.getElementById('btn-record')
const btnRecordLabel  = document.getElementById('btn-record-label')
const previewScreen   = document.getElementById('preview-screen')
const previewCam      = document.getElementById('preview-cam')
const previewPlaceholder = document.getElementById('preview-placeholder')
const recBadge        = document.getElementById('rec-badge')
const timerEl         = document.getElementById('timer')
const statusEl        = document.getElementById('status')
const toggleCam       = document.getElementById('toggle-cam')
const togglePreview   = document.getElementById('toggle-preview')
const toggleMic          = document.getElementById('toggle-mic')
const toggleDesktopAudio = document.getElementById('toggle-desktop-audio')
const selectFormat       = document.getElementById('select-format')
const btnMinimize     = document.getElementById('btn-minimize')
const btnClose        = document.getElementById('btn-close')

// ── State ──
let selectedSource  = null
let mediaRecorder   = null
let recordedChunks  = []
let camStream       = null
let micStream       = null
let screenStream    = null
let audioCtx        = null
let timerInterval   = null
let elapsedSeconds  = 0
let isRecording     = false

// ── Title bar ──
btnMinimize.addEventListener('click', () => ipcRenderer.send('minimize-window'))
btnClose.addEventListener('click',    () => ipcRenderer.send('close-window'))

// ── Load sources ──
async function loadSources() {
  sourceList.innerHTML = '<div class="source-placeholder">Loading…</div>'
  const sources = await ipcRenderer.invoke('get-sources')
  sourceList.innerHTML = ''

  sources.forEach(source => {
    const item = document.createElement('div')
    item.className = 'source-item'
    item.dataset.id = source.id

    const thumb = document.createElement('img')
    thumb.className = 'source-thumb'
    thumb.src = source.thumbnail

    const name = document.createElement('span')
    name.className = 'source-name'
    name.title = source.name
    name.textContent = source.name

    item.appendChild(thumb)
    item.appendChild(name)
    item.addEventListener('click', () => selectSource(source, item))
    sourceList.appendChild(item)
  })
}

async function selectSource(source, itemEl) {
  document.querySelectorAll('.source-item').forEach(el => el.classList.remove('selected'))
  itemEl.classList.add('selected')
  selectedSource = source

  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop())
  }

  try {
    if (screenStream) screenStream.getTracks().forEach(t => t.stop())

    ipcRenderer.send('set-source-id', source.id)

    screenStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          minWidth: 1280, maxWidth: 1920,
          minHeight: 720, maxHeight: 1080
        }
      }
    })

    previewScreen.srcObject = screenStream
    previewPlaceholder.classList.add('hidden')
    btnRecord.disabled = false
    toggleDesktopAudio.disabled = false
    setStatus(`Source: ${source.name}`)
  } catch (err) {
    setStatus('Failed to capture source')
    console.error(err)
  }
}

btnRefresh.addEventListener('click', loadSources)

// ── Camera ──
toggleCam.addEventListener('change', async () => {
  if (toggleCam.checked) {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      previewCam.srcObject = camStream
      if (togglePreview.checked) previewCam.classList.remove('hidden')
    } catch {
      toggleCam.checked = false
      setStatus('Camera not accessible')
    }
  } else {
    if (camStream) camStream.getTracks().forEach(t => t.stop())
    camStream = null
    previewCam.classList.add('hidden')
    previewCam.srcObject = null
  }
})

togglePreview.addEventListener('change', () => {
  if (togglePreview.checked && camStream) {
    previewCam.classList.remove('hidden')
  } else {
    previewCam.classList.add('hidden')
  }
})

// ── Drag PiP ──
let dragging = false, dragOffX = 0, dragOffY = 0

previewCam.addEventListener('mousedown', e => {
  dragging = true
  const rect = previewCam.getBoundingClientRect()
  dragOffX = e.clientX - rect.left
  dragOffY = e.clientY - rect.top
  previewCam.style.cursor = 'grabbing'
})

document.addEventListener('mousemove', e => {
  if (!dragging) return
  const wrap = document.querySelector('.preview-wrap').getBoundingClientRect()
  let x = e.clientX - wrap.left - dragOffX
  let y = e.clientY - wrap.top  - dragOffY
  x = Math.max(0, Math.min(wrap.width  - previewCam.offsetWidth,  x))
  y = Math.max(0, Math.min(wrap.height - previewCam.offsetHeight, y))
  previewCam.style.right  = 'auto'
  previewCam.style.bottom = 'auto'
  previewCam.style.left   = x + 'px'
  previewCam.style.top    = y + 'px'
})

document.addEventListener('mouseup', () => {
  dragging = false
  previewCam.style.cursor = 'move'
})

// ── Recording ──
btnRecord.addEventListener('click', () => {
  if (isRecording) stopRecording()
  else              startRecording()
})

async function startRecording() {
  if (!selectedSource) return

  recordedChunks = []

  // Get mic audio if enabled
  micStream = null
  if (toggleMic.checked) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      setStatus('Mic not accessible — recording without audio')
    }
  }

  // Combine screen + cam via canvas if cam is active
  let finalStream
  if (camStream && toggleCam.checked) {
    finalStream = await mixStreams()
  } else {
    finalStream = new MediaStream([...screenStream.getVideoTracks()])
  }

  // Get desktop loopback audio at record time if enabled
  let desktopAudioStream = null
  if (toggleDesktopAudio.checked) {
    try {
      desktopAudioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      desktopAudioStream.getVideoTracks().forEach(t => t.stop())
    } catch {
      desktopAudioStream = null
    }
  }

  // Mix desktop audio + mic into one track via AudioContext
  const hasDesktop = desktopAudioStream && desktopAudioStream.getAudioTracks().length > 0
  const hasMic     = micStream && micStream.getAudioTracks().length > 0

  if (hasDesktop || hasMic) {
    audioCtx = new AudioContext()
    const dest = audioCtx.createMediaStreamDestination()
    if (hasDesktop) audioCtx.createMediaStreamSource(new MediaStream(desktopAudioStream.getAudioTracks())).connect(dest)
    if (hasMic)     audioCtx.createMediaStreamSource(micStream).connect(dest)
    dest.stream.getAudioTracks().forEach(t => finalStream.addTrack(t))
  }

  const mimeType = selectFormat.value
  mediaRecorder = new MediaRecorder(finalStream, { mimeType })

  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) recordedChunks.push(e.data)
  }

  mediaRecorder.onstop = saveRecording

  mediaRecorder.start(200)
  isRecording = true

  btnRecord.classList.add('recording')
  btnRecordLabel.textContent = 'Stop Recording'
  recBadge.classList.remove('hidden')
  timerEl.classList.remove('hidden')
  startTimer()
  setStatus('Recording…')
}

function stopRecording() {
  mediaRecorder.stop()
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null }
  if (audioCtx)  { audioCtx.close(); audioCtx = null }
  isRecording = false

  btnRecord.classList.remove('recording')
  btnRecordLabel.textContent = 'Start Recording'
  recBadge.classList.add('hidden')
  timerEl.classList.add('hidden')
  stopTimer()
  setStatus('Saving…')
}

async function mixStreams() {
  const canvas = document.createElement('canvas')
  canvas.width  = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')

  const screenVid = document.createElement('video')
  screenVid.srcObject = new MediaStream(screenStream.getVideoTracks())
  screenVid.play()

  const camVid = document.createElement('video')
  camVid.srcObject = new MediaStream(camStream.getVideoTracks())
  camVid.play()

  const pipRect = previewCam.getBoundingClientRect()
  const wrapRect = document.querySelector('.preview-wrap').getBoundingClientRect()
  const scaleX = canvas.width  / wrapRect.width
  const scaleY = canvas.height / wrapRect.height
  const pip = {
    x: (pipRect.left - wrapRect.left) * scaleX,
    y: (pipRect.top  - wrapRect.top)  * scaleY,
    w: pipRect.width  * scaleX,
    h: pipRect.height * scaleY
  }

  function drawFrame() {
    ctx.drawImage(screenVid, 0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(pip.x, pip.y, pip.w, pip.h, 12)
    ctx.clip()
    ctx.drawImage(camVid, pip.x, pip.y, pip.w, pip.h)
    ctx.restore()
    requestAnimationFrame(drawFrame)
  }
  drawFrame()

  return canvas.captureStream(30)
}

async function saveRecording() {
  setStatus('Converting to MP4…')
  const blob = new Blob(recordedChunks, { type: 'video/webm' })
  const arrayBuffer = await blob.arrayBuffer()
  const result = await ipcRenderer.invoke('save-as-mp4', arrayBuffer)
  if (result.success) {
    setStatus('Saved!')
  } else {
    setStatus('Save cancelled.')
  }
  setTimeout(() => setStatus(`Source: ${selectedSource.name}`), 3000)
}

// ── Timer ──
function startTimer() {
  elapsedSeconds = 0
  timerInterval  = setInterval(() => {
    elapsedSeconds++
    const m = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')
    const s = String(elapsedSeconds % 60).padStart(2, '0')
    timerEl.textContent = `${m}:${s}`
  }, 1000)
}

function stopTimer() {
  clearInterval(timerInterval)
  elapsedSeconds = 0
}

function setStatus(msg) {
  statusEl.textContent = msg
}

// ── Init ──
loadSources()
