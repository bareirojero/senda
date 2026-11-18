/**
 * Dictado por voz para la caja de escritura.
 *  1) Si el navegador trae reconocimiento de voz (Chrome, Edge), se usa: es instantáneo y gratis.
 *  2) Si no (WebView del APK), se graba el audio (WAV 16 kHz mono, máx. 60 s) y se transcribe con Gemini.
 */

type Transcriber = (wavBase64: string) => Promise<{ text?: string; error?: string }>;

const MAX_SECONDS = 60;
const RATE = 16000;

export class VoiceInput {
  private recognition: any = null;
  private recording: { stop: () => Promise<string> } | null = null;
  private busy = false;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly input: HTMLTextAreaElement,
    private readonly transcribe: Transcriber,
    private readonly notify: (msg: string) => void,
    private readonly afterInsert: () => void
  ) {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      void this.toggle();
    });
  }

  private setState(state: 'idle' | 'listening' | 'transcribing'): void {
    this.button.dataset.state = state;
    this.button.title = state === 'listening' ? 'Detener' : state === 'transcribing' ? 'Transcribiendo…' : 'Dictar';
  }

  private insert(text: string): void {
    const t = text.trim();
    if (!t) return;
    const cur = this.input.value;
    this.input.value = cur && !/\s$/.test(cur) ? `${cur} ${t}` : cur + t;
    this.input.focus();
    this.afterInsert();
  }

  private async toggle(): Promise<void> {
    if (this.busy) return;
    if (this.recognition) return this.recognition.stop();
    if (this.recording) return this.finishRecording();

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      try {
        return this.startRecognition(SR);
      } catch {
        /* sigue con la grabación */
      }
    }
    await this.startRecording();
  }

  private startRecognition(SR: any): void {
    const rec = new SR();
    rec.lang = navigator.language?.startsWith('es') ? navigator.language : 'es-419';
    rec.interimResults = false;
    rec.continuous = true;
    let fallback = false;
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) this.insert(e.results[i][0].transcript);
    };
    rec.onerror = (e: any) => {
      // Sin servicio de reconocimiento (p. ej. WebView): se pasa a grabar y transcribir con Gemini
      if (e.error === 'network' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') fallback = true;
      else if (e.error === 'not-allowed') this.notify('Permite el micrófono para dictar.');
    };
    rec.onend = () => {
      this.recognition = null;
      this.setState('idle');
      if (fallback) void this.startRecording();
    };
    rec.start();
    this.recognition = rec;
    this.setState('listening');
  }

  private async startRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.notify('Este dispositivo no permite dictar aquí. Usa el micrófono del teclado.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      this.notify('Sin acceso al micrófono. Revisa el permiso de Senda en Ajustes del teléfono.');
      return;
    }

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(processor);
    processor.connect(ctx.destination);

    const timer = setTimeout(() => void this.finishRecording(), MAX_SECONDS * 1000);
    this.recording = {
      stop: async () => {
        clearTimeout(timer);
        processor.disconnect();
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        const rate = ctx.sampleRate;
        await ctx.close();
        return encodeWav(downsample(concat(chunks), rate, RATE), RATE);
      }
    };
    this.setState('listening');
  }

  private async finishRecording(): Promise<void> {
    const rec = this.recording;
    if (!rec) return;
    this.recording = null;
    this.busy = true;
    this.setState('transcribing');
    try {
      const wav = await rec.stop();
      const result = await this.transcribe(wav);
      if (result.text) this.insert(result.text);
      else this.notify(result.error ? `No se pudo transcribir: ${result.error}` : 'No se entendió el audio.');
    } finally {
      this.busy = false;
      this.setState('idle');
    }
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Remuestreo simple (promedio) a 16 kHz: suficiente para voz y achica el envío ~3x. */
export function downsample(data: Float32Array, from: number, to: number): Float32Array {
  if (from <= to) return data;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(data.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), data.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += data[j]!;
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** PCM 16 bits mono en WAV, en base64 (lo que acepta Gemini como audio/wav). */
export function encodeWav(samples: Float32Array, rate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let bin = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
