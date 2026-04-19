/**
 * server/index.js
 *
 * Accepts POST /export with multipart fields:
 *   fps, width, height   — numbers
 *   audio                — audio blob (audio/mp4 or audio/webm)
 *   frame_000000.jpg … frame_NNNNNN.jpg — JPEG frames in order
 *
 * Stitches frames + audio into H.264/AAC MP4 via FFmpeg and streams it back.
 * Deploy to Google Cloud Run — see Dockerfile and cloudbuild.yaml.
 */

'use strict';

const express      = require('express');
const multer       = require('multer');
const ffmpeg       = require('fluent-ffmpeg');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const os           = require('os');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(cors());

// Store uploads in memory — frames are JPEGs typically 20–80 KB each.
// For very long videos consider switching to disk storage.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/export', upload.any(), async (req, res) => {
  const fps    = parseInt(req.body.fps,    10) || 30;
  const width  = parseInt(req.body.width,  10);
  const height = parseInt(req.body.height, 10);

  if (!width || !height) {
    return res.status(400).json({ error: 'width and height are required' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imessage-'));

  try {
    // Separate frames from the audio file
    const frameFiles = (req.files || [])
      .filter(f => /^frame_\d+\.jpg$/.test(f.originalname))
      .sort((a, b) => a.originalname.localeCompare(b.originalname));

    if (frameFiles.length === 0) {
      return res.status(400).json({ error: 'No frame files received' });
    }

    // Write frames to temp directory
    for (const frame of frameFiles) {
      fs.writeFileSync(path.join(tmpDir, frame.originalname), frame.buffer);
    }

    // Write audio (optional)
    const audioFile = (req.files || []).find(f => f.fieldname === 'audio');
    const audioPath = audioFile ? path.join(tmpDir, audioFile.originalname) : null;
    if (audioFile) {
      fs.writeFileSync(audioPath, audioFile.buffer);
    }

    const outputPath = path.join(tmpDir, 'output.mp4');
    const framePattern = path.join(tmpDir, 'frame_%06d.jpg');

    await new Promise((resolve, reject) => {
      const cmd = ffmpeg()
        .input(framePattern)
        .inputOptions([`-framerate ${fps}`])
        .videoCodec('libx264')
        .outputOptions(['-pix_fmt yuv420p', '-movflags faststart', '-crf 23']);

      if (audioPath) {
        cmd.input(audioPath).audioCodec('aac').audioBitrate('128k');
      }

      cmd
        .output(outputPath)
        .on('error', reject)
        .on('end', resolve)
        .run();
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="imessage-overlay.mp4"');

    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);
    readStream.on('end', () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

  } catch (err) {
    console.error('[export error]', err);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
