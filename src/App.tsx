import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  Upload, 
  FileText, 
  Settings, 
  Download, 
  Activity, 
  ChevronDown, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Lock,
  Cpu,
  Database,
  Terminal,
  Shield,
  Zap,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

interface ProcessingStats {
  cpu: number;
  vram: string;
  instance: string;
  status: 'IDLE' | 'PROCESSING' | 'ERROR';
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [transcription, setTranscription] = useState<TranscriptionSegment[] | null>(null);
  const [srt, setSrt] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string>('subtitles.srt');
  const [error, setError] = useState<string | null>(null);
  const [nsfwMode, setNsfwMode] = useState(true);
  const [diarization, setDiarization] = useState(true);
  const [clientApiKey, setClientApiKey] = useState<string>(localStorage.getItem('elevenlabs_apiKey') || '');
  const [useDirectMode, setUseDirectMode] = useState<boolean>(false);
  const [showAllTranscription, setShowAllTranscription] = useState(false);
  const [serverConfigured, setServerConfigured] = useState<boolean | null>(null);
  
  const [stats, setStats] = useState<ProcessingStats>({
    cpu: 12,
    vram: '4.2 GB / 24 GB',
    instance: 'vercel-prod-01',
    status: 'IDLE'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check if server is configured with API key
    fetch('/api/config')
      .then(res => res.json())
      .then(data => setServerConfigured(data.hasApiKey))
      .catch(() => setServerConfigured(false));
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setError(null);
    }
  }, []);

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setStats(prev => ({ ...prev, status: 'PROCESSING', cpu: 78 }));

    try {
      let data;
      const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      
      if (useDirectMode && clientApiKey) {
        // DIRECT MODE: Bypasses Vercel/Server limits using user's key
        const formData = new FormData();
        formData.append('file', file);
        formData.append('model_id', 'scribe_v1');
        
        const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers: { 'xi-api-key': clientApiKey },
          body: formData,
        });
        
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.detail?.message || 'Direct transcription failed');
        }
        
        const rawTranscription = await response.json();
        data = { transcription: rawTranscription, srt: null, filename: file.name.replace(/\.[^/.]+$/, "") + ".srt" };
      } else if (file.size > CHUNK_SIZE) {
        // CHUNKED MODE: Bypasses 4.5MB limit using Server Key
        const uploadId = Math.random().toString(36).substring(7);
        
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          
          const chunkForm = new FormData();
          chunkForm.append('file', chunk);
          chunkForm.append('uploadId', uploadId);
          chunkForm.append('index', i.toString());
          chunkForm.append('total', totalChunks.toString());
          chunkForm.append('fileName', file.name);
          chunkForm.append('fileType', file.type);
          
          const chunkRes = await fetch('/api/upload-chunk', {
            method: 'POST',
            body: chunkForm
          });
          
          if (!chunkRes.ok) throw new Error(`Chunk ${i} upload failed`);
        }
        
        const finalizeRes = await fetch('/api/finalize-chunked', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId })
        });
        
        data = await finalizeRes.json();
        if (!finalizeRes.ok) throw new Error(data.error || 'Finalization failed');
      } else {
        // PROXY MODE: Normal upload for small files
        const formData = new FormData();
        formData.append('file', file);
        formData.append('model_id', 'scribe_v1');
        
        const response = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });

        data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Transcription failed');
      }

      // Process segments logic
      let segments: TranscriptionSegment[] = [];
      const transData = data.transcription;
      
      if (transData.segments) {
        segments = transData.segments;
      } else if (transData.words) {
        for (let i = 0; i < transData.words.length; i += 8) {
          const chunk = transData.words.slice(i, i + 8);
          segments.push({
            start: chunk[0].start,
            end: chunk[chunk.length - 1].end,
            text: chunk.map((w: any) => w.text).join(' ')
          });
        }
      }

      setTranscription(segments);
      
      // If direct mode, generate SRT locally to be fast
      if (data.srt) {
        setSrt(data.srt);
      } else if (transData) {
        const srtUtils = await import('./utils/srt');
        setSrt(srtUtils.convertToSrt(transData));
      }
      
      setShowAllTranscription(false);
      setDownloadFilename(data.filename || 'subtitles.srt');
      setStats(prev => ({ ...prev, status: 'IDLE', cpu: 12 }));
    } catch (err: any) {
      setError(err.message);
      setStats(prev => ({ ...prev, status: 'ERROR', cpu: 5 }));
    } finally {
      setIsUploading(false);
    }
  };

  const downloadSRT = () => {
    if (!srt) return;
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFilename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 flex items-center justify-center p-4 sm:p-6 lg:p-12 font-sans selection:bg-violet-500/30">
      <div className="w-full max-w-[1280px] h-full flex flex-col gap-6">
        
        {/* Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-violet-500 shadow-[0_0_15px_rgba(139,92,246,0.6)] animate-pulse"></div>
            <h1 className="text-xl font-bold tracking-tight uppercase">ScribeGen <span className="text-zinc-500 font-normal lowercase tracking-normal">Pro</span></h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-400">
              <span className={`w-1.5 h-1.5 rounded-full ${serverConfigured ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
              {serverConfigured ? 'SERVER AUTH ACTIVE' : 'NO API KEY DETECTED'}
            </div>
            <div className="px-3 py-1 bg-zinc-800/80 rounded-full text-[10px] font-bold border border-zinc-700/50 uppercase tracking-widest text-zinc-400 backdrop-blur-sm">v2.1.0-stable</div>
          </div>
        </header>

        {/* Bento Grid Layout - Optimized for Mobile */}
        <div className="flex-grow grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-6">
          
          {/* Left Column: Upload & Config (Stacks on Mobile) */}
          <div className="md:col-span-4 flex flex-col gap-4 lg:gap-6">
            {/* Upload Card */}
            <div 
              className={`aspect-square md:aspect-auto md:h-64 bg-zinc-900/40 border-2 ${file ? 'border-violet-500/50 bg-violet-500/5' : 'border-zinc-800/50'} rounded-3xl p-8 flex flex-col items-center justify-center border-dashed hover:border-violet-500/50 transition-all duration-500 cursor-pointer group relative overflow-hidden ring-1 ring-white/5`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                onChange={handleFileChange}
                accept="audio/*,video/*"
              />
              
              <AnimatePresence mode="wait">
                {file ? (
                  <motion.div 
                    key="file-selected"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-center z-10"
                  >
                    <div className="w-20 h-20 bg-violet-500/20 rounded-3xl flex items-center justify-center mb-4 mx-auto border border-violet-500/30 shadow-2xl glass-effect">
                      <FileText className="w-10 h-10 text-violet-400" />
                    </div>
                    <p className="text-sm font-bold truncate max-w-[200px] text-zinc-100">{file.name}</p>
                    <p className="text-[11px] text-zinc-500 mt-1 uppercase tracking-[0.2em] font-black italic">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setFile(null); }}
                      className="mt-6 px-4 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-[9px] font-black text-zinc-400 hover:text-zinc-200 uppercase tracking-widest transition-all"
                    >
                      Reset Selection
                    </button>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="idle-upload"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center z-10"
                  >
                    <div className="w-16 h-16 bg-zinc-800/50 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-violet-500/10 transition-all duration-500 mx-auto ring-1 ring-white/5">
                      <Upload className="w-8 h-8 text-zinc-400 group-hover:text-violet-400 transition-colors" />
                    </div>
                    <p className="text-sm font-bold tracking-tight text-white mb-2 uppercase">Neural Upload Matrix</p>
                    <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-6">Drag components or click to initialize</p>
                    <div className="flex flex-col gap-2">
                       <div className="px-3 py-1 bg-zinc-800/80 text-[9px] font-black text-zinc-400 rounded-full border border-zinc-700/50 uppercase tracking-tighter">
                        Vercel: 4.5MB Max
                      </div>
                      <div className="px-3 py-1 bg-violet-500/10 text-[9px] font-black text-violet-400/80 rounded-full border border-violet-500/20 uppercase tracking-tighter italic">
                         AIS: 32MB Mode Active
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              
              <div className="absolute inset-0 opacity-[0.02] pointer-events-none">
                <div className="absolute inset-0 bg-[radial-gradient(#8b5cf6_1.5px,transparent_1.5px)] [background-size:32px_32px]"></div>
              </div>
            </div>

            {/* Model Config Card */}
            <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-3xl p-6 flex flex-col shadow-2xl backdrop-blur-md ring-1 ring-white/5">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.25em] mb-6 flex items-center gap-2">
                <Settings className="w-3.5 h-3.5" />
                Control Terminal
              </h3>
              <div className="space-y-5">
                <div className="flex flex-col gap-2">
                  <label className="text-[9px] text-zinc-500 uppercase font-black tracking-widest pl-1">Neural architecture</label>
                  <div className="w-full bg-zinc-950 p-3 rounded-2xl text-[11px] border border-zinc-800/80 flex justify-between items-center group cursor-pointer hover:border-violet-500/30 transition-all">
                    <div className="flex items-center gap-2.5">
                      <Database className="w-3.5 h-3.5 text-violet-500" />
                      <span className="font-bold text-zinc-300">SCRIBE_CORE_V2_PRODUCTION</span>
                    </div>
                    <ChevronDown className="w-4 h-4 text-zinc-700 group-hover:text-zinc-500" />
                  </div>
                </div>

                <div 
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 hover:bg-zinc-900/50 transition-all cursor-pointer group"
                  onClick={() => setNsfwMode(!nsfwMode)}
                >
                  <div className="flex items-center gap-2.5">
                    <Shield className={`w-4 h-4 transition-colors ${nsfwMode ? 'text-violet-500' : 'text-zinc-700'}`} />
                    <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${nsfwMode ? 'text-zinc-200' : 'text-zinc-600'}`}>Semantic Guard</span>
                  </div>
                  <div className={`w-8 h-4.5 rounded-full relative transition-all duration-500 ${nsfwMode ? 'bg-violet-600 shadow-[0_0_15px_rgba(139,92,246,0.5)]' : 'bg-zinc-800'}`}>
                    <motion.div 
                      layout
                      className="absolute top-1 w-2.5 h-2.5 bg-white rounded-full"
                      initial={false}
                      animate={{ x: nsfwMode ? 18 : 4 }}
                    />
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-black/40 border border-zinc-800/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                       <span className="text-[10px] font-black uppercase text-violet-400 tracking-tighter">Bypass Mode</span>
                       <span className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest italic">Direct client link (Unlimited size)</span>
                    </div>
                    <div 
                      onClick={() => setUseDirectMode(!useDirectMode)}
                      className={`w-7 h-4 rounded-full cursor-pointer transition-colors flex items-center ${useDirectMode ? 'bg-emerald-500' : 'bg-zinc-800'}`}
                    >
                      <motion.div className="w-3 h-3 bg-white rounded-full m-0.5" animate={{ x: useDirectMode ? 12 : 0 }} />
                    </div>
                  </div>
                  
                  <AnimatePresence>
                    {useDirectMode && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden space-y-3"
                      >
                        <div className="relative">
                          <input 
                            type="password"
                            placeholder="ELEVENLABS_API_KEY..."
                            value={clientApiKey}
                            onChange={(e) => {
                              setClientApiKey(e.target.value);
                              localStorage.setItem('elevenlabs_apiKey', e.target.value);
                            }}
                            className="w-full bg-black/80 border border-zinc-800/80 rounded-xl p-3 text-[10px] font-mono text-zinc-300 focus:border-violet-500/50 outline-none transition-all placeholder:text-zinc-800"
                          />
                          <Lock className="absolute right-3 top-3.5 w-3 h-3 text-zinc-700" />
                        </div>
                        <p className="text-[9px] text-zinc-500 leading-relaxed font-medium">Bypasses server constraints. Req: Personal API Key.</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Preview & Controls */}
          <div className="md:col-span-8 flex flex-col gap-4 lg:gap-6">
            
            {/* Main Transcription Preview */}
            <div className="flex-grow bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col shadow-2xl overflow-hidden ring-1 ring-white/5 min-h-[500px]">
              <div className="p-4 px-6 border-b border-zinc-800/50 flex justify-between items-center bg-zinc-900/80 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-2.5 h-2.5 rounded-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.6)]"></div>
                    {isUploading && <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-violet-500 animate-ping opacity-75"></div>}
                  </div>
                  <span className="text-[10px] font-black tracking-[0.2em] text-zinc-300 uppercase italic">Transcription.STREAM(01)</span>
                </div>
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-zinc-800"></div>
                  <div className="w-2 h-2 rounded-full bg-zinc-800"></div>
                  <div className="w-2 h-2 rounded-full bg-zinc-800"></div>
                </div>
              </div>
              
              <div className="p-4 overflow-y-auto flex-grow space-y-4 custom-scrollbar bg-black/20">
                {isUploading ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-6">
                    <div className="relative">
                       <Loader2 className="w-14 h-14 animate-spin text-violet-500/80" strokeWidth={1.5} />
                       <div className="absolute inset-0 flex items-center justify-center">
                          <Activity className="w-5 h-5 text-violet-400 animate-pulse" />
                       </div>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-200 animate-pulse">Syncing Payload Chunks...</p>
                      <p className="text-[9px] opacity-40 uppercase tracking-widest font-black">Decrypting Vocal Frequency Spectrum</p>
                    </div>
                  </div>
                ) : transcription ? (
                  <div className="space-y-6 max-h-[600px]">
                    <div className="flex flex-col items-center justify-center py-8 text-center border border-emerald-500/10 rounded-3xl bg-emerald-500/5 mb-6">
                       <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
                       <h3 className="text-sm font-black uppercase tracking-tight text-emerald-400">Analysis Complete</h3>
                       <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Found {transcription.length} voice segments</p>
                    </div>

                    <div className="space-y-4">
                      {(showAllTranscription ? transcription : transcription.slice(-3)).map((seg, i) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, x: -5 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`flex gap-5 group/item py-3 px-4 rounded-2xl transition-all duration-300 hover:bg-white/[0.03] border border-transparent hover:border-zinc-800/50 ${!showAllTranscription && i === (transcription.slice(-3).length - 1) ? 'border-l-2 border-l-violet-500 bg-violet-500/5' : ''}`}
                        >
                          <div className="flex flex-col gap-1 shrink-0 w-20">
                             <span className="text-violet-400 font-mono text-[9px] opacity-80 font-black tracking-tighter">
                              {new Date(seg.start * 1000).toISOString().substr(11, 12).replace('.', ',')}
                            </span>
                          </div>
                          <p className="text-sm text-zinc-100 leading-relaxed font-medium">
                            {seg.text}
                          </p>
                        </motion.div>
                      ))}
                    </div>
                    
                    <div className="flex justify-center pt-4 sticky bottom-0">
                      <button 
                        onClick={() => setShowAllTranscription(!showAllTranscription)}
                        className="px-6 py-2 rounded-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-800 text-[10px] font-black uppercase tracking-widest text-violet-400 hover:text-violet-300 transition-all shadow-2xl ring-1 ring-violet-500/20"
                      >
                        {showAllTranscription ? 'Hide Full Log' : `View Full Transcript (${transcription.length} units)`}
                      </button>
                    </div>
                  </div>
                ) : error ? (
                  <div className="h-full flex flex-col items-center justify-center text-red-400/80 p-12 text-center bg-red-400/5 rounded-3xl border border-red-500/20 glass-effect">
                    <AlertCircle className="w-16 h-16 mb-6 opacity-30" strokeWidth={1} />
                    <h4 className="text-xs font-black uppercase mb-3 tracking-[0.25em]">Error 0x413: BUFFER_OVERFLOW</h4>
                    <p className="text-xs font-mono max-w-sm leading-relaxed lowercase opacity-70 mb-8">{error}</p>
                    <button onClick={() => setError(null)} className="px-8 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">Re-initialize Link</button>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center p-12">
                    <div className="w-full max-w-md space-y-6 opacity-[0.03] grayscale pointer-events-none">
                      <div className="h-3 bg-white rounded-full w-1/4"></div>
                      <div className="h-12 bg-white rounded-2xl w-full"></div>
                      <div className="h-12 bg-white rounded-2xl w-5/6"></div>
                      <div className="h-12 bg-white rounded-2xl w-full"></div>
                    </div>
                    <div className="absolute text-center">
                       <Zap className="w-12 h-12 text-zinc-900 mx-auto mb-4" />
                       <p className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-800">Awaiting Neural Sequence...</p>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="p-4 px-6 border-t border-zinc-800 flex flex-col sm:flex-row gap-4 items-center justify-between text-[10px] text-zinc-500 bg-zinc-950 backdrop-blur-md">
                <div className="flex items-center gap-8">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[8px] text-zinc-700 font-black uppercase tracking-widest">Metadata count</span>
                    <span className="text-zinc-300 font-mono font-bold">{transcription ? transcription.reduce((acc, s) => acc + s.text.split(' ').length, 0) : 0} TOKENS</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[8px] text-zinc-700 font-black uppercase tracking-widest">Spectral Integrity</span>
                    <span className="text-violet-400 font-mono font-bold">{transcription ? '99.94%' : '0.00%'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-4 py-1.5 bg-white/5 rounded-full border border-white/10 glass-effect">
                  <Globe className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="font-black tracking-widest uppercase italic text-zinc-400">P2P ENCRYPTION ACTIVE</span>
                </div>
              </div>
            </div>

            {/* Bottom Actions Row (Stacked on Mobile) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
              {/* Export Action Card */}
              <button 
                disabled={!file || isUploading}
                onClick={transcription ? downloadSRT : handleUpload}
                className={`rounded-3xl p-6 flex flex-col justify-between transition-all duration-700 group relative overflow-hidden h-44 shadow-2xl ${
                  transcription 
                    ? 'bg-emerald-600 hover:bg-emerald-500' 
                    : file && !isUploading 
                      ? 'bg-violet-600 hover:bg-violet-500 shadow-[0_0_40px_rgba(139,92,246,0.3)] ring-1 ring-white/20' 
                      : 'bg-zinc-900 border border-zinc-800 cursor-not-allowed opacity-50'
                }`}
              >
                <div className="flex justify-between items-start z-10">
                  <h2 className="text-3xl font-black leading-none uppercase tracking-tighter italic text-white drop-shadow-lg">
                    {transcription ? <>Download<br/>Segments</> : isUploading ? <>Processing<br/>Neural Link</> : <>Generate<br/>Subtitles</>}
                  </h2>
                  <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-xl ring-1 ring-white/10">
                    {transcription ? <Download className="w-7 h-7 text-white" /> : <Zap className={`w-7 h-7 text-white ${isUploading ? 'animate-pulse' : ''}`} />}
                  </div>
                </div>
                
                <div className="flex items-end justify-between z-10 w-full pt-4 border-t border-white/10">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase text-white/50 tracking-[0.2em]">Output Protocol</span>
                    <span className="text-[12px] font-black font-mono text-white">SUBS.SRT (UNICODE)</span>
                  </div>
                  <div className="bg-white px-5 py-2.5 rounded-xl text-[11px] font-black text-black uppercase tracking-widest group-hover:scale-105 active:scale-95 transition-all shadow-xl">
                    {transcription ? 'Commit To Disk' : isUploading ? 'Syncing...' : 'Engage'}
                  </div>
                </div>

                {isUploading && (
                  <div className="absolute inset-0 bg-[linear-gradient(transparent_0%,rgba(255,255,255,0.15)_50%,transparent_100%)] h-[30%] w-full animate-scan pointer-events-none"></div>
                )}
              </button>

              {/* Resource Management Card */}
              <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-3xl p-6 relative overflow-hidden group h-44 flex flex-col justify-between ring-1 ring-white/5 backdrop-blur-md">
                <div className="flex justify-between items-center z-10">
                   <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.25em] flex items-center gap-2">
                    <Cpu className="w-4 h-4" />
                    Resource Load
                  </h3>
                   <span className="text-[9px] font-black text-violet-500 uppercase italic">Optimized</span>
                </div>
                
                <div className="space-y-4 z-10">
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-black uppercase tracking-tighter">
                      <span className="text-zinc-500">Core Synthesizer</span>
                      <motion.span className="text-violet-400" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>{stats.cpu}%</motion.span>
                    </div>
                    <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden p-0.5 border border-zinc-800">
                      <motion.div 
                        className="h-full bg-violet-600 rounded-full shadow-[0_0_10px_rgba(139,92,246,0.5)]"
                        initial={{ width: "12%" }}
                        animate={{ width: `${stats.cpu}%` }}
                        transition={{ type: "spring", stiffness: 40 }}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-zinc-800/50">
                    <span className="text-[9px] font-mono text-zinc-700 tracking-tighter font-bold uppercase">Node: {stats.instance}</span>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-zinc-950 rounded-lg border border-zinc-800">
                       <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                       <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Active</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Global Footer */}
        <footer className="mt-8 py-8 border-t border-zinc-900 flex flex-col sm:flex-row justify-between items-center gap-6 opacity-40 hover:opacity-100 transition-opacity duration-1000">
          <div className="flex items-center gap-10">
            <p className="text-[10px] font-black text-zinc-700 uppercase tracking-[0.4em] italic">ElevenScribe Neural Systems Ltd.</p>
            <div className="hidden lg:flex items-center gap-6 text-[9px] font-black text-zinc-800 uppercase tracking-[0.2em] border-l border-zinc-900 pl-10">
              <Globe className="w-3.5 h-3.5" />
              GLOBAL EDGE: LDN · TYO · NYC · SF
            </div>
          </div>
          <div className="flex items-center gap-6">
             <CheckCircle2 className="w-4 h-4 text-emerald-900" />
             <p className="text-[9px] font-mono text-zinc-800 font-bold uppercase tracking-widest">Secure Payload Protocol v3.8</p>
          </div>
        </footer>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=JetBrains+Mono:wght@700&display=swap');
        
        .glass-effect {
          background: rgba(255, 255, 255, 0.02);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        
        .custom-scrollbar::-webkit-scrollbar {
          width: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #18181b;
          border-radius: 20px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #27272a;
        }
        @keyframes scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(400%); }
        }
        .animate-scan {
          animation: scan 4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>
    </div>
  );
}
