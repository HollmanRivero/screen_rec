# screen_rec

A lightweight screen recorder built with Electron. Record any screen or window, mix in your webcam as a draggable picture-in-picture overlay, and capture microphone and desktop audio — all saved as MP4.

## Features

- **Screen & window selection** — pick any monitor or open window with live thumbnails
- **Webcam overlay** — enable your camera as a draggable PiP that gets burned into the recording
- **Audio mixing** — record microphone, desktop/system audio, or both simultaneously
- **MP4 output** — recordings are automatically converted from WebM to MP4 via FFmpeg
- **Live timer** — on-screen recording duration counter
- **Frameless UI** — clean custom title bar with minimize and close controls

## Requirements

- [Node.js](https://nodejs.org) (v18 or later recommended)
- Windows (desktop audio loopback is Windows-specific)

## Getting Started

```bash
# Clone the repo
git clone https://github.com/HollmanRivero/screen_rec.git
cd screen_rec

# Install dependencies
npm install

# Run the app
npm start
```

Or launch directly via `ScreenRec.bat` if you have the shortcut set up.

## Usage

1. Click **Refresh** to load available screens and windows
2. Click a source thumbnail to select it — a live preview will appear
3. Toggle **Camera**, **Mic**, and **Desktop Audio** as needed
4. Click **Start Recording**
5. Click **Stop Recording** when done — a save dialog will open to choose where to save the MP4

### Webcam PiP

When the camera is enabled, the webcam overlay can be dragged anywhere inside the preview area. Its position at the time you start recording is what gets composited into the final video.

## Tech Stack

| Layer | Library |
|---|---|
| App shell | [Electron](https://www.electronjs.org/) |
| Video conversion | [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) |
| Screen capture | Electron `desktopCapturer` + `getDisplayMedia` |
| Cam/mic mixing | Web `AudioContext` + Canvas 2D |

## License

ISC
