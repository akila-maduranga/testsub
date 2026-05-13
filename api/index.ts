import express, { Request, Response } from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Increase body parser limits
app.use(express.json({ limit: "2gb" }));
app.use(express.urlencoded({ limit: "2gb", extended: true }));

// Configure multer
// Note: Vercel functions have a read-only filesystem except for /tmp
const upload = multer({
  dest: "/tmp/",
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // Internal engine limit
});

// Helper to convert transcription to SRT
function convertToSRT(transcription: any): string {
  if (!transcription || !transcription.words) return '';
  
  let srt = '';
  let counter = 1;

  function formatSRTTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  }

  const segments = transcription.segments || [];
  
  if (segments.length > 0) {
    segments.forEach((seg: any) => {
      const start = formatSRTTime(seg.start);
      const end = formatSRTTime(seg.end);
      srt += `${counter}\n${start} --> ${end}\n${seg.text.trim()}\n\n`;
      counter++;
    });
  } else if (transcription.words) {
    const words = transcription.words;
    for (let i = 0; i < words.length; i += 10) {
      const chunk = words.slice(i, i + 10);
      const start = formatSRTTime(chunk[0].start);
      const end = formatSRTTime(chunk[chunk.length - 1].end);
      const text = chunk.map((w: any) => w.text).join(' ');
      srt += `${counter}\n${start} --> ${end}\n${text.trim()}\n\n`;
      counter++;
    }
  }

  return srt;
}

// API Routes
app.post("/api/transcribe", upload.single("file"), async (req: Request, res: Response) => {
  const file = (req as any).file;
  try {
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const apiKey = process.env.ELEVEN_LABS_API_KEY;
    if (!apiKey) {
      if (file.path) fs.unlinkSync(file.path);
      return res.status(500).json({ error: "ELEVEN_LABS_API_KEY is not configured" });
    }

    const formData = new FormData();
    formData.append("file", fs.createReadStream(file.path), {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    
    formData.append("model_id", "scribe_v1");

    const response = await axios.post(
      "https://api.elevenlabs.io/v1/speech-to-text",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          "xi-api-key": apiKey,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 600000,
      }
    );

    if (file.path) fs.unlinkSync(file.path);

    const srt = convertToSRT(response.data);

    res.json({
      transcription: response.data,
      srt: srt,
      filename: file.originalname.replace(/\.[^/.]+$/, "") + ".srt"
    });
  } catch (error: any) {
    if (file && file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    console.error("Transcription Error:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: "Transcription failed",
      details: error.response?.data || error.message,
    });
  }
});

// Export for Vercel
export default app;

// Local runner for dev/Cloud Run
if (process.env.NODE_ENV !== "production") {
    // We'll handle this in server.ts or package.json scripts
}
