// Atmospheric animated background: drifting glow orbs over a mesh grid.
export default function BackgroundMesh() {
  return (
    <div className="bg-mesh" aria-hidden="true">
      <div className="bg-grid" />
      <div className="bg-orb bg-orb-a" />
      <div className="bg-orb bg-orb-b" />
      <div className="bg-orb bg-orb-c" />
      <svg className="bg-scan" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="0" y1="0" x2="100" y2="100" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
