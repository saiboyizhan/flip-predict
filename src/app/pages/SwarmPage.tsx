import SwarmPanel from "../components/swarm/SwarmPanel";

export default function SwarmPage() {
  return (
    <div className="relative min-h-[80vh]">
      {/* Subtle background grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <SwarmPanel />
      </div>
    </div>
  );
}
