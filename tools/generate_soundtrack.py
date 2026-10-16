#!/usr/bin/env python3
"""Generate a clean, pleasant, royalty-free ambient electronic soundtrack for
the GrantSentinel demo video, using only the Python standard library
(``wave``, ``math``, ``struct``, ``json``).

Design:
  * A warm, low-pass filtered chord pad following an A minor / C major
    progression (Am - F - C - G), with a gentle stereo chorus width.
  * Soft harmonic bell chime accents placed at each subtitle transition
    timestamp (read from tools/_demo/marks.json when present, otherwise five
    evenly spaced transitions), tuned to an A minor pentatonic.

Output: 16-bit PCM stereo WAV at 44.1 kHz.
"""

import json
import math
import os
import struct
import wave

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
MARKS = os.path.join(HERE, "_demo", "marks.json")
OUT = os.path.join(HERE, "_demo", "soundtrack.wav")

# Equal-tempered note frequencies (Hz).
NOTE = {
    "A1": 55.00, "C2": 65.41, "E2": 82.41, "G2": 98.00, "A2": 110.00,
    "B2": 123.47, "C3": 130.81, "D3": 146.83, "E3": 164.81, "F3": 174.61,
    "G3": 196.00, "A3": 220.00, "C4": 261.63, "D4": 293.66, "E4": 329.63,
    "G4": 392.00, "A4": 440.00, "C5": 523.25, "E5": 659.26, "A5": 880.00,
}

# Am - F - C - G: a warm minor-to-major loop. Each chord is a bass note plus a triad.
PROGRESSION = [
    ("A1", ["A2", "C3", "E3"]),
    ("F3", ["F2" if "F2" in NOTE else "C2", "A2", "C3"]),
    ("C2", ["C3", "E3", "G3"]),
    ("G2", ["B2", "D3", "G3"]),
]
# Fix the F chord voicing to a clean set of existing notes.
PROGRESSION[1] = ("C2", ["F3", "A2", "C3"])

# A minor pentatonic top notes for the chime accents.
CHIME_NOTES = ["A4", "C5", "E5", "G4", "A5"]


def read_marks():
    """Return (transition_times, total_duration) from marks.json or defaults."""
    if os.path.exists(MARKS):
        try:
            with open(MARKS, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            times = [float(t) for t in data.get("times", [])]
            duration = float(data.get("duration", 55.0))
            if times and duration > 0:
                return times, min(duration, 70.0)
        except Exception:
            pass
    duration = 55.0
    times = [i * duration / 5.0 for i in range(5)]
    return times, duration


def envelope(n, attack, release):
    """Precompute a smooth attack/release envelope of length n."""
    env = [0.0] * n
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    for i in range(n):
        if i < a:
            env[i] = 0.5 - 0.5 * math.cos(math.pi * i / a)
        elif i > n - r:
            env[i] = 0.5 - 0.5 * math.cos(math.pi * (n - i) / r)
        else:
            env[i] = 1.0
    # Gentle amplitude breathing.
    for i in range(n):
        env[i] *= 0.85 + 0.15 * math.sin(2 * math.pi * 0.08 * i / SR)
    return env


def generate():
    times, duration = read_marks()
    n = int(duration * SR)
    left = [0.0] * n
    right = [0.0] * n

    # --- Warm chord pad ---
    seg = n / len(PROGRESSION)
    bass_gain = 0.16
    triad_gain = 0.06
    for ci, (bass, triad) in enumerate(PROGRESSION):
        start = int(ci * seg)
        count = int(seg) + SR // 5  # slight overlap for legato
        count = min(count, n - start)
        attack = 0.9
        release = 1.1
        env = envelope(count, attack, release)
        phases = [0.0] * (len(triad) + 1)
        freqs = [NOTE[bass]] + [NOTE[x] for x in triad]
        for i in range(count):
            g = env[i]
            sL = 0.0
            sR = 0.0
            for k, f in enumerate(freqs):
                gain = bass_gain if k == 0 else triad_gain
                detune = 1.0008 if k % 2 else 0.9992  # chorus width
                phases[k] += 2 * math.pi * f / SR
                base = math.sin(phases[k])
                # one soft harmonic for warmth
                harm = 0.35 * math.sin(2 * phases[k] + 0.3)
                tone = (base + harm) * gain * g
                sL += tone * (1.0 if k % 2 else 0.9)
                sR += tone * (0.9 if k % 2 else 1.0)
            idx = start + i
            left[idx] += sL
            right[idx] += sR

    # --- Bell chime accents at subtitle transitions ---
    for ti, tsec in enumerate(times):
        start = int(tsec * SR)
        if start >= n:
            continue
        note = CHIME_NOTES[ti % len(CHIME_NOTES)]
        f = NOTE[note]
        dur = min(2.4, (n - start) / SR)
        cnt = int(dur * SR)
        pan = 0.5 + 0.35 * math.sin(ti * 1.7)  # vary stereo placement
        for i in range(cnt):
            tt = i / SR
            decay = math.exp(-tt * 2.2)
            attack = 1.0 - math.exp(-tt * 60.0)
            bell = (
                math.sin(2 * math.pi * f * tt)
                + 0.5 * math.sin(2 * math.pi * f * 2.0 * tt)
                + 0.28 * math.sin(2 * math.pi * f * 3.01 * tt)
            )
            a = bell * decay * attack * 0.22
            left[start + i] += a * (1.0 - pan)
            right[start + i] += a * pan

    # --- One-pole low-pass to warm everything up ---
    cutoff = 1300.0
    alpha = 1.0 - math.exp(-2 * math.pi * cutoff / SR)
    yl = yr = 0.0
    for i in range(n):
        yl += alpha * (left[i] - yl)
        yr += alpha * (right[i] - yr)
        left[i] = yl
        right[i] = yr

    # --- Normalize to a healthy peak ---
    peak = 0.0
    for i in range(n):
        m = abs(left[i])
        if abs(right[i]) > m:
            m = abs(right[i])
        if m > peak:
            peak = m
    scale = 0.72 / peak if peak > 0 else 1.0

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with wave.open(OUT, "w") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for i in range(n):
            sl = int(max(-1.0, min(1.0, left[i] * scale)) * 32767)
            sr = int(max(-1.0, min(1.0, right[i] * scale)) * 32767)
            frames += struct.pack("<hh", sl, sr)
        w.writeframes(bytes(frames))
    print(f"wrote {OUT}  duration={duration:.1f}s  chimes_at={[round(t,1) for t in times]}")


if __name__ == "__main__":
    generate()
