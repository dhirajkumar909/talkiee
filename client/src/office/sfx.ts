import { volumeForDistance } from './layout';

let audioCtx: AudioContext | null = null;

export function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}

export function resumeAudioContext() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

/** Plays a soft, synthesized footstep sound scaled by distance. */
export function playFootstep(dist: number, fullRange: number, hearingRange: number) {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== 'running') return;

  const vol = volumeForDistance(dist, fullRange, hearingRange);
  if (vol <= 0) return;

  const t = ctx.currentTime;

  // 1. The Low Thud (heel striking floor)
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, t);
  osc.frequency.exponentialRampToValueAtTime(20, t + 0.08);
  
  // Make the base volume subtle
  oscGain.gain.setValueAtTime(vol * 0.02, t);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  
  osc.connect(oscGain);
  oscGain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);

  // 2. The Shoe Scrape (noise)
  const bufferSize = ctx.sampleRate * 0.05; // 50ms
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 400; // mid-low noise (lowered for more bassy feel)
  noiseFilter.Q.value = 1;
  
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(vol * 0.005, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(t);
  noise.stop(t + 0.06);
}
