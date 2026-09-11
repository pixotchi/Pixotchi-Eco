"use client";

import { useSyncExternalStore } from "react";

type Preferences = { haptics: boolean; sounds: boolean };
const defaults: Preferences = { haptics: false, sounds: false };
let preferences = defaults;
let initialized = false;
const listeners = new Set<() => void>();
const key = "pixotchi:sensory-feedback";
function readPreferences() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || "{}");
    if (saved && typeof saved === "object") {
      preferences = {
        haptics: "haptics" in saved && saved.haptics === true,
        sounds: "sounds" in saved && saved.sounds === true,
      };
    }
  } catch {
    /* Restricted storage keeps the session preference. */
  }
}
function onStorage(event: StorageEvent) {
  if (event.key !== key) return;
  preferences = defaults;
  readPreferences();
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  if (!initialized) {
    initialized = true;
    readPreferences();
  }
  listeners.add(fn);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}
export function useSensoryPreferences() {
  return useSyncExternalStore(
    subscribe,
    () => preferences,
    () => defaults,
  );
}
export function setSensoryPreference(
  name: keyof Preferences,
  enabled: boolean,
) {
  preferences = { ...preferences, [name]: enabled };
  try {
    localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    /* Session only. */
  }
  listeners.forEach((fn) => fn());
  if (enabled && name === "sounds") unlockMicroAudio();
}

let audio: AudioContext | undefined;
let lastHaptic = 0;
let lastSound = 0;
const patterns = { light: 10, medium: 25, success: [15, 40, 25] };
export function haptic(kind: keyof typeof patterns) {
  if (
    typeof document === "undefined" ||
    document.hidden ||
    !preferences.haptics ||
    !navigator.vibrate
  )
    return;
  const now = performance.now();
  if (now - lastHaptic < 60) return;
  lastHaptic = now;
  try {
    navigator.vibrate(patterns[kind]);
  } catch {
    /* Unsupported webviews are silent. */
  }
}
export function unlockMicroAudio() {
  if (!preferences.sounds || typeof AudioContext === "undefined") return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  } catch {
    /* Audio is optional. */
  }
}
export type MicroSound = "water" | "gear" | "card" | "success";
/** Short synthesized textures, with no media download or competing music loop. */
export function microSound(kind: MicroSound) {
  if (!preferences.sounds || typeof document === "undefined" || document.hidden)
    return;
  unlockMicroAudio();
  if (!audio || audio.state !== "running" || performance.now() - lastSound < 75)
    return;
  lastSound = performance.now();
  const context = audio;
  const now = context.currentTime;
  const duration = kind === "card" ? 0.12 : kind === "success" ? 0.28 : 0.1;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(
    kind === "gear" ? 0.018 : 0.025,
    now + 0.006,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  gain.connect(context.destination);
  if (kind === "card") {
    const buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * duration),
      context.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1700;
    filter.Q.value = 0.8;
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    source.start(now);
    source.stop(now + duration);
  } else {
    const oscillator = context.createOscillator();
    oscillator.type = kind === "gear" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(
      kind === "water" ? 480 : kind === "gear" ? 1600 : 660,
      now,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === "water" ? 1050 : kind === "gear" ? 220 : 990,
      now + duration,
    );
    oscillator.connect(gain);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}
