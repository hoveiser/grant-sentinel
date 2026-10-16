// Zero-dependency Web Audio UI sound synthesizer.
//
// All sounds are generated procedurally (no audio files). The AudioContext is
// created lazily on the first user gesture so browsers do not block autoplay.

type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const MUTE_KEY = "grantsentinel.muted";

function muted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC: Ctor | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function voice(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType,
  peak: number,
  cutoff?: number
): void {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  let node: AudioNode = gain;
  if (cutoff) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function guard(): boolean {
  if (muted()) return false;
  return ensure() !== null;
}

// Crisp futuristic UI click.
export function click(): void {
  if (!guard() || !ctx) return;
  const t = ctx.currentTime;
  voice(880, t, 0.06, "triangle", 0.18, 3200);
  voice(1320, t + 0.005, 0.05, "sine", 0.1, 4000);
}

// Soft transition hum for step / panel changes.
export function hum(): void {
  if (!guard() || !ctx) return;
  const t = ctx.currentTime;
  voice(196, t, 0.5, "sine", 0.14, 900);
  voice(294, t + 0.02, 0.45, "sine", 0.08, 1200);
}

// Harmonic chord chime on transaction finalization (A minor add9 lift).
export function chime(): void {
  if (!guard() || !ctx) return;
  const t = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => voice(f, t + i * 0.06, 0.9, "sine", 0.16, 6000));
  voice(1568, t + 0.24, 1.1, "triangle", 0.06, 8000);
}

// Low descending buzz for a reverted or failed action.
export function error(): void {
  if (!guard() || !ctx) return;
  const t = ctx.currentTime;
  voice(220, t, 0.28, "sawtooth", 0.12, 700);
  voice(146.83, t + 0.08, 0.32, "sawtooth", 0.1, 500);
}

export function isMuted(): boolean {
  return muted();
}

export function setMuted(value: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    /* ignore storage errors */
  }
  if (!value) {
    // Unlock audio on unmute (usually triggered by a click).
    ensure();
  }
}

export function toggleMuted(): boolean {
  const next = !muted();
  setMuted(next);
  if (!next) click();
  return next;
}
