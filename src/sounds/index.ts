/**
 * Sound Manager - Web Audio API synthesized UI sounds
 * No external files needed - all sounds generated programmatically
 */

export type SoundName = 
  | 'assign'       // Employee assigned to shift/grid
  | 'unassign'     // Employee removed from shift
  | 'success'      // Save, backup, general success
  | 'error'        // Error/failure
  | 'warning'      // Warning toast
  | 'click'        // UI click / button press
  | 'toggle'       // Toggle switch flipped
  | 'delete'       // Delete action
  | 'drop'         // Drag & drop landed
  | 'notification' // Alert / notification bell
  | 'complete'     // Auto-planner complete
  | 'tick'         // Cell value +1 (planner)
  | 'untick'       // Cell value -1 (planner)
  | 'swoosh';      // Panel slide open/close

let audioCtx: AudioContext | null = null;
let _enabled = false;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (browser autoplay policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/** Master volume (0-1) */
const VOLUME = 0.25;

function createGain(ctx: AudioContext, volume: number = VOLUME): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);
  return gain;
}

// ─── Individual sound generators ───────────────────────────────

function playAssign(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Rising two-tone chime: C5 → E5
  [523.25, 659.25].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.1);
    gain.gain.linearRampToValueAtTime(VOLUME * 0.6, now + i * 0.1 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.1);
    osc.stop(now + i * 0.1 + 0.3);
  });
}

function playUnassign(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Descending soft tone: E5 → C5
  [659.25, 523.25].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.09);
    gain.gain.linearRampToValueAtTime(VOLUME * 0.4, now + i * 0.09 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.09);
    osc.stop(now + i * 0.09 + 0.25);
  });
}

function playSuccess(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Happy ascending arpeggio: C5 → E5 → G5
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.08);
    gain.gain.linearRampToValueAtTime(VOLUME * 0.5, now + i * 0.08 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.08);
    osc.stop(now + i * 0.08 + 0.35);
  });
}

function playError(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Low buzzy double tone
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 200;
  gain.gain.setValueAtTime(VOLUME * 0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.18);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'square';
  osc2.frequency.value = 180;
  gain2.gain.setValueAtTime(0, now + 0.12);
  gain2.gain.linearRampToValueAtTime(VOLUME * 0.3, now + 0.14);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.12);
  osc2.stop(now + 0.35);
}

function playWarning(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Attention two-tone: high → low
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.linearRampToValueAtTime(440, now + 0.2);
  gain.gain.setValueAtTime(VOLUME * 0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.35);
}

function playClick(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Subtle short click
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 1000;
  gain.gain.setValueAtTime(VOLUME * 0.25, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

function playToggle(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Soft pop
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.04);
  gain.gain.setValueAtTime(VOLUME * 0.35, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

function playDelete(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Descending swoosh
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
  gain.gain.setValueAtTime(VOLUME * 0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}

function playDrop(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Soft thud + ring
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);
  gain.gain.setValueAtTime(VOLUME * 0.5, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);

  // Subtle ring after thud
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = 880;
  gain2.gain.setValueAtTime(0, now + 0.05);
  gain2.gain.linearRampToValueAtTime(VOLUME * 0.2, now + 0.07);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.05);
  osc2.stop(now + 0.3);
}

function playNotification(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Bell-like double ding
  [1046.5, 1318.5].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.15);
    gain.gain.linearRampToValueAtTime(VOLUME * 0.5, now + i * 0.15 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.15);
    osc.stop(now + i * 0.15 + 0.45);
  });
}

function playComplete(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Triumphant ascending arpeggio: C5 → E5 → G5 → C6
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + i * 0.1);
    gain.gain.linearRampToValueAtTime(VOLUME * 0.5, now + i * 0.1 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.1);
    osc.stop(now + i * 0.1 + 0.45);
  });
}

function playTick(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Ultra-short rising pip
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.linearRampToValueAtTime(1200, now + 0.04);
  gain.gain.setValueAtTime(VOLUME * 0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

function playUntick(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Ultra-short falling pip
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1000, now);
  osc.frequency.linearRampToValueAtTime(600, now + 0.04);
  gain.gain.setValueAtTime(VOLUME * 0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

function playSwoosh(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Soft filtered noise swoosh
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
  osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
  gain.gain.setValueAtTime(VOLUME * 0.12, now);
  gain.gain.linearRampToValueAtTime(VOLUME * 0.18, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

// ─── Sound map ─────────────────────────────────────────────────

const soundMap: Record<SoundName, () => void> = {
  assign: playAssign,
  unassign: playUnassign,
  success: playSuccess,
  error: playError,
  warning: playWarning,
  click: playClick,
  toggle: playToggle,
  delete: playDelete,
  drop: playDrop,
  notification: playNotification,
  complete: playComplete,
  tick: playTick,
  untick: playUntick,
  swoosh: playSwoosh,
};

// ─── Public API ────────────────────────────────────────────────

export const sounds = {
  /** Enable or disable all sounds */
  setEnabled(enabled: boolean): void {
    _enabled = enabled;
  },

  /** Check if sounds are enabled */
  get enabled(): boolean {
    return _enabled;
  },

  /** Play a named sound (only if enabled) */
  play(name: SoundName): void {
    if (!_enabled) return;
    try {
      soundMap[name]();
    } catch {
      // Silently fail if audio context can't start
    }
  },
};
