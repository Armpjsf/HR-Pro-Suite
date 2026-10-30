// audio.js — แปลงรูปแบบเสียงระหว่าง Twilio กับ Gemini Live
//
// Twilio Media Streams : G.711 μ-law (PCMU), 8000 Hz, 8-bit, mono, เฟรมละ 20ms (160 ไบต์)
// Gemini Live  input    : PCM 16-bit little-endian, 16000 Hz, mono
// Gemini Live  output   : PCM 16-bit little-endian, 24000 Hz, mono
//
// จึงต้อง:  Twilio(μ-law 8k) → PCM16 8k → upsample → PCM16 16k → Gemini
//           Gemini(PCM16 24k) → downsample → PCM16 8k → μ-law 8k → Twilio

const BIAS = 0x84;
const CLIP = 32635;

// ---- μ-law decode: 1 ไบต์ → Int16 ----
export function muLawDecodeSample(u) {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

// ---- μ-law encode: Int16 → 1 ไบต์ ----
export function muLawEncodeSample(sample) {
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

// Buffer(μ-law) → Int16Array(PCM)
export function muLawBufferToPcm(buf) {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = muLawDecodeSample(buf[i]);
  return out;
}

// Int16Array(PCM) → Buffer(μ-law)
export function pcmToMuLawBuffer(pcm) {
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = muLawEncodeSample(pcm[i]);
  return out;
}

// Buffer(PCM16 LE) → Int16Array
export function bufferToInt16(buf) {
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
}

// Int16Array → Buffer(PCM16 LE)
export function int16ToBuffer(pcm) {
  const buf = Buffer.allocUnsafe(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], i * 2);
  return buf;
}

// resample เชิงเส้น (linear interpolation) — เพียงพอสำหรับเสียงพูดโทรศัพท์
export function resamplePcm(pcm, inRate, outRate) {
  if (inRate === outRate) return pcm;
  const ratio = outRate / inRate;
  const outLen = Math.floor(pcm.length * ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = pcm[idx] || 0;
    const b = pcm[idx + 1] !== undefined ? pcm[idx + 1] : a;
    out[i] = (a + (b - a) * frac) | 0;
  }
  return out;
}

// Twilio media payload (base64 μ-law 8k) → base64 PCM16 16k สำหรับ Gemini
export function twilioToGemini(base64MuLaw) {
  const mulaw = Buffer.from(base64MuLaw, 'base64');
  const pcm8k = muLawBufferToPcm(mulaw);
  const pcm16k = resamplePcm(pcm8k, 8000, 16000);
  return int16ToBuffer(pcm16k).toString('base64');
}

// Gemini audio (base64 PCM16 24k) → base64 μ-law 8k สำหรับ Twilio
export function geminiToTwilio(base64Pcm24k) {
  const pcm24k = bufferToInt16(Buffer.from(base64Pcm24k, 'base64'));
  const pcm8k = resamplePcm(pcm24k, 24000, 8000);
  return pcmToMuLawBuffer(pcm8k).toString('base64');
}

// helper สำหรับ simulator: WAV(PCM16 mono) header
export function pcm16ToWav(pcmBuffer, sampleRate) {
  const header = Buffer.alloc(44);
  const dataLen = pcmBuffer.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// helper: อ่าน WAV(PCM16 mono) → { pcm:Int16Array, sampleRate }
export function wavToPcm16(buf) {
  const sampleRate = buf.readUInt32LE(24);
  // หา chunk 'data'
  let offset = 12;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      const data = buf.subarray(offset + 8, offset + 8 + size);
      return { pcm: bufferToInt16(data), sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('ไม่พบ data chunk ในไฟล์ WAV');
}
