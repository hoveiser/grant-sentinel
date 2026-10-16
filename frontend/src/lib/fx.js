import confetti from "canvas-confetti";

// A subtle, tasteful burst used when a write transaction reaches FINALIZED.
export function celebrateFinalized(originY = 0.4) {
  const colors = ["#22a0a8", "#60d2d6", "#d6b25c", "#2fbf7a", "#e6ecf5"];
  confetti({
    particleCount: 70,
    spread: 60,
    startVelocity: 32,
    scalar: 0.9,
    ticks: 160,
    origin: { x: 0.5, y: originY },
    colors,
    disableForReducedMotion: true,
  });
  // A soft second puff for depth.
  setTimeout(() => {
    confetti({
      particleCount: 40,
      angle: 60,
      spread: 55,
      origin: { x: 0.2, y: 0.6 },
      colors,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 40,
      angle: 120,
      spread: 55,
      origin: { x: 0.8, y: 0.6 },
      colors,
      disableForReducedMotion: true,
    });
  }, 120);
}
