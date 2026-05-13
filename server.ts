import express, { Request, Response } from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase body parser limits for general requests
app.use(express.json({ limit: "2gb" }));
app.use(express.urlencoded({ limit: "2gb", extended: true }));

// Configure multer
const upload = multer({
  dest: "/tmp/",
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB limit - as close to "no limit" as practical for a server
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

  // Use segments if available, otherwise group words
  const segments = transcription.segments || [];
  
  if (segments.length > 0) {
    segments.forEach((seg: any) => {
      const start = formatSRTTime(seg.start);
      const end = formatSRTTime(seg.end);
      srt += `${counter}\n${start} --> ${end}\n${seg.text.trim()}\n\n`;
      counter++;
    });
  } else if (transcription.words) {
    // Group words into 10-word segments if no segments provided
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

async function startServer() {
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
      
      // User specifically requested Scribe v2. API currently uses scribe_v1 as the model_id for the Scribe engine.
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
          timeout: 600000, // 10 minutes
        }
      );

      // Cleanup
      if (file.path) fs.unlinkSync(file.path);

      const srt = convertToSRT(response.data);

      res.json({
        transcription: response.data,
        srt: srt,
        filename: file.originalname.replace(/\.[^/.]+$/, "") + ".srt"
      });
    } catch (error: any) {
      if (file && file.path) fs.unlinkSync(file.path);
      console.error("Transcription Error:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json({
        error: "Transcription failed",
        details: error.response?.data || error.message,
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
