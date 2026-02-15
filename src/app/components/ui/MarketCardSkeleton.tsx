"use client";

export function MarketCardSkeleton() {
  return (
    <div className="bg-card border border-border p-6 animate-pulse">
      {/* Top Row: Category + Status */}
      <div className="flex items-center justify-between mb-3">
        <div className="h-5 w-24 bg-muted rounded" />
        <div className="h-5 w-16 bg-muted rounded" />
      </div>

      {/* Title */}
      <div className="h-6 w-3/4 bg-muted rounded mb-4" />

      {/* YES/NO Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="h-4 w-20 bg-muted rounded" />
          <div className="h-4 w-20 bg-muted rounded" />
        </div>
        <div className="h-2 w-full bg-muted rounded" />
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-4">
        <div className="h-4 w-16 bg-muted rounded" />
        <div className="h-4 w-12 bg-muted rounded" />
        <div className="h-4 w-20 bg-muted rounded ml-auto" />
      </div>
    </div>
  );
}
