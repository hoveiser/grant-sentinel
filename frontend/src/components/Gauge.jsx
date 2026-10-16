import { useEffect, useState } from "react";

// A crisp custom SVG radial gauge (240 degree sweep) for the core scoring math.
export default function Gauge({ value = 0, label = "Impact", size = 168, tone = "#60d2d6" }) {
  const clamped = Math.max(0, Math.min(100, value));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let raf;
    const from = shown;
    const start = performance.now();
    const dur = 650;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(from + (clamped - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clamped]);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 16;
  const sweep = 240;
  const startA = 150; // degrees, gauge opening at the bottom
  const toXY = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  };
  const valAngle = startA - (shown / 100) * sweep;
  const arcLen = (sweep / 360) * 2 * Math.PI * r;
  const dash = (shown / 100) * arcLen;

  const ticks = [];
  for (let i = 0; i <= 10; i++) {
    const a = startA - (i / 10) * sweep;
    const [x1, y1] = [cx + (r + 6) * Math.cos((a * Math.PI) / 180), cy - (r + 6) * Math.sin((a * Math.PI) / 180)];
    const [x2, y2] = [cx + (r - (i % 5 === 0 ? 12 : 7)) * Math.cos((a * Math.PI) / 180), cy - (r - (i % 5 === 0 ? 12 : 7)) * Math.sin((a * Math.PI) / 180)];
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i % 5 === 0 ? "#8ea3bd" : "#3a4a63"} strokeWidth={i % 5 === 0 ? 2 : 1} strokeLinecap="round" />);
  }

  const [nx, ny] = toXY(valAngle);
  const [ax, ay] = toXY(startA);
  const [bx, by] = toXY(startA - sweep);
  const trackPath = `M ${ax} ${ay} A ${r} ${r} 0 0 1 ${bx} ${by}`;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="gauge" role="img" aria-label={`${label} ${Math.round(shown)} of 100`}>
      <defs>
        <linearGradient id={`g-${label}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.5" />
          <stop offset="100%" stopColor={tone} />
        </linearGradient>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={trackPath} fill="none" stroke="#212c3e" strokeWidth="10" strokeLinecap="round" />
      <path
        d={trackPath}
        fill="none"
        stroke={`url(#g-${label})`}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${arcLen}`}
        filter="url(#glow)"
      />
      {ticks}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={tone} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill="#0b1220" stroke={tone} strokeWidth="2" />
      <text x={cx} y={cy + 30} textAnchor="middle" className="gauge-value" fill="#e6ecf5">{Math.round(shown)}</text>
      <text x={cx} y={cy + 46} textAnchor="middle" className="gauge-label">{label}</text>
    </svg>
  );
}
