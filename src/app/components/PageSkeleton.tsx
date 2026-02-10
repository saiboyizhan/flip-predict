import { Skeleton } from './ui/skeleton';

export default function PageSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-950 pt-20 px-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header skeleton */}
        <Skeleton className="h-8 w-64 bg-zinc-800" />
        <Skeleton className="h-4 w-96 bg-zinc-800" />

        {/* Content grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-zinc-800 p-4 space-y-3">
              <Skeleton className="h-4 w-3/4 bg-zinc-800" />
              <Skeleton className="h-3 w-full bg-zinc-800" />
              <Skeleton className="h-3 w-1/2 bg-zinc-800" />
              <div className="flex gap-2 mt-4">
                <Skeleton className="h-8 w-20 bg-zinc-800 rounded-lg" />
                <Skeleton className="h-8 w-20 bg-zinc-800 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
