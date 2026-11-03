import { useSyncExternalStore } from "react";

/**
 * The optional alert sound — roadmap 4.28.
 *
 * Stored in this browser, not on the instance: a speaker belongs to the machine
 * that has the tab open on its second monitor, and the laptop in the next room
 * must not start beeping because the office screen asked for it.
 *
 * Off by default, and never an audio file: a short tone synthesised by the
 * Web Audio API, so there is nothing to ship, cache or license. The tone falls
 * for a worse status and is higher for a worse one — pitch is the severity, so
 * an operator can tell "degraded" from "down" without looking up.
 */

export type MinSeverity = "degraded" | "partial_outage" | "major_outage";
export const MIN_SEVERITIES: readonly MinSeverity[] = ["degraded", "partial_outage", "major_outage"];
export const VOLUMES = [25, 50, 100] as const;

export interface SoundPrefs {
  enabled: boolean;
  /** 0–100. */
  volume: number;
  /** The mildest worsening that still makes a sound. */
  minSeverity: MinSeverity;
}

export const DEFAULT_SOUND: SoundPrefs = { enabled: false, volume: 50, minSeverity: "partial_outage" };

const KEY = "isitdown.sound";

/** Whatever was stored, mended field by field: a half-written value must not switch the sound on. */
export function parseSound(raw: string | null): SoundPrefs {
  if (raw === null) return DEFAULT_SOUND;
  try {
    const value = JSON.parse(raw) as Partial<SoundPrefs> | null;
    if (value === null || typeof value !== "object") return DEFAULT_SOUND;
    return {
      enabled: value.enabled === true,
      volume:
        typeof value.volume === "number" && Number.isFinite(value.volume)
          ? Math.min(100, Math.max(0, Math.round(value.volume)))
          : DEFAULT_SOUND.volume,
      minSeverity: MIN_SEVERITIES.includes(value.minSeverity as MinSeverity)
        ? (value.minSeverity as MinSeverity)
        : DEFAULT_SOUND.minSeverity,
    };
  } catch {
    return DEFAULT_SOUND;
  }
}

let cached: SoundPrefs | null = null;
const listeners = new Set<() => void>();

export function readSound(): SoundPrefs {
  if (cached !== null) return cached;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    /* blocked storage: the sound stays off, which is the safe answer */
  }
  cached = parseSound(raw);
  return cached;
}

export function writeSound(next: SoundPrefs): void {
  cached = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* the choice holds for this tab even where it cannot be remembered */
  }
  for (const listener of listeners) listener();
}

/** Test seam: forget the in-memory copy so the next read goes to storage. */
export function resetSoundCache(): void {
  cached = null;
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSoundPrefs = (): SoundPrefs => useSyncExternalStore(subscribe, readSound, () => DEFAULT_SOUND);

const SEVERITY_ORDER: Record<MinSeverity, number> = { degraded: 1, partial_outage: 2, major_outage: 3 };

/** Whether a worsening to `rank` (1 degraded … 3 major) is loud enough for these preferences. */
export const isLoudEnough = (prefs: SoundPrefs, rank: number): boolean =>
  prefs.enabled && prefs.volume > 0 && rank >= SEVERITY_ORDER[prefs.minSeverity];

/** Frequencies per severity rank: a worse status is a lower, longer note. */
const TONES: Record<number, { hz: number[]; ms: number }> = {
  1: { hz: [660], ms: 160 },
  2: { hz: [660, 523], ms: 180 },
  3: { hz: [660, 523, 392], ms: 220 },
};

let context: AudioContext | null = null;

/**
 * Plays the tone for a worsening of `rank`. Resolves to whether it sounded: a
 * browser keeps an `AudioContext` suspended until the page has had a click, so
 * a tab nobody has touched stays silent and says so rather than throwing.
 */
export async function playAlert(prefs: SoundPrefs, rank: number): Promise<boolean> {
  const tone = TONES[Math.min(3, Math.max(1, rank))];
  if (tone === undefined || typeof AudioContext === "undefined") return false;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return false;
    const gain = context.createGain();
    // Perceptual, not linear, so "25%" is audibly quieter than "50%" rather than barely different.
    const level = (prefs.volume / 100) ** 2 * 0.3;
    gain.connect(context.destination);
    const step = tone.ms / 1000;
    tone.hz.forEach((hz, index) => {
      const oscillator = context?.createOscillator();
      if (oscillator === undefined || context === null) return;
      const start = context.currentTime + index * step;
      oscillator.type = "sine";
      oscillator.frequency.value = hz;
      oscillator.connect(gain);
      // A short ramp in and out: a tone that starts and stops at full level clicks.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.02);
      gain.gain.linearRampToValueAtTime(0.0001, start + step - 0.01);
      oscillator.start(start);
      oscillator.stop(start + step);
    });
    return true;
  } catch {
    return false;
  }
}
