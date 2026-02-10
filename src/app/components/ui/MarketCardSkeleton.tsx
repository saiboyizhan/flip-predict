"use client";

export function MarketCardSkeleton() {
  return (
    <div className="bg-zinc-900 border border-zinc-800 p-6 animate-pulse">
      {/* Top Row: Category + Status */}
      <div className="flex items-center justify-between mb-3">
        <div className="h-5 w-24 bg-zinc-800 rounded" />
        <div className="h-5 w-16 bg-zinc-800 rounded" />
      </div>

      {/* Title */}
      <div className="h-6 w-3/4 bg-zinc-800 rounded mb-4" />

      {/* YES/NO Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="h-4 w-20 bg-zinc-800 rounded" />
          <div className="h-4 w-20 bg-zinc-800 rounded" />
        </div>
        <div className="h-2 w-full bg-zinc-800 rounded" />
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-4">
        <div className="h-4 w-16 bg-zinc-800 rounded" />
        <div className="h-4 w-12 bg-zinc-800 rounded" />
        <div className="h-4 w-20 bg-zinc-800 rounded ml-auto" />
      </div>
    </div>
  );
}
