export function convertToSrt(transcription: any): string {
  if (!transcription || (!transcription.words && !transcription.segments)) return '';
  
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
