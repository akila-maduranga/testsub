/**
 * ElevenLabs Scribe JSON to SRT Converter
 */

export interface Word {
  text: string;
  start: number;
  end: number;
  speaker_id?: string;
}

export interface TranscriptionResponse {
  words: Word[];
}

function formatTime(seconds: number): string {
  const date = new Date(0);
  date.setSeconds(seconds);
  const ms = Math.floor((seconds % 1) * 1000);
  const timeStr = date.toISOString().substr(11, 8);
  return `${timeStr},${ms.toString().padStart(3, "0")}`;
}

export function convertToSrt(data: TranscriptionResponse): string {
  const words = data.words;
  if (!words || words.length === 0) return "";

  const segments: { text: string; start: number; end: number }[] = [];
  let currentSegment: { text: string; start: number; end: number } | null = null;

  const MAX_CHARS = 42;
  const MAX_GAP = 0.5; // seconds
  const MAX_DURATION = 5.0; // seconds

  words.forEach((word) => {
    if (!currentSegment) {
      currentSegment = {
        text: word.text.trim(),
        start: word.start,
        end: word.end,
      };
    } else {
      const duration = word.end - currentSegment.start;
      const gap = word.start - currentSegment.end;
      const combinedText = currentSegment.text + " " + word.text.trim();

      if (combinedText.length > MAX_CHARS || gap > MAX_GAP || duration > MAX_DURATION) {
        segments.push(currentSegment);
        currentSegment = {
          text: word.text.trim(),
          start: word.start,
          end: word.end,
        };
      } else {
        currentSegment.text = combinedText;
        currentSegment.end = word.end;
      }
    }
  });

  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments
    .map((seg, i) => {
      const index = i + 1;
      const start = formatTime(seg.start);
      const end = formatTime(seg.end);
      return `${index}\n${start} --> ${end}\n${seg.text}\n`;
    })
    .join("\n");
}
