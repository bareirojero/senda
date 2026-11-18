import { describe, expect, it } from 'vitest';
import { downsample, encodeWav } from '../src/ui/voice';

describe('dictado: audio para Gemini', () => {
  it('WAV PCM 16 bits mono con cabecera válida', () => {
    const wav = Buffer.from(encodeWav(new Float32Array([0, 0.5, -0.5, 1]), 16000), 'base64');
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(40)).toBe(8); // 4 muestras × 2 bytes
    expect(wav.readInt16LE(46)).toBe(16383);
  });

  it('remuestrea 48 kHz → 16 kHz', () => {
    expect(downsample(new Float32Array(48000), 48000, 16000).length).toBe(16000);
  });
});
