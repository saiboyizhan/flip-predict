import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { useTranslation } from "react-i18next";
import { Users, UserPlus } from "lucide-react";
import { FollowButton } from "./FollowButton";

function colorFromAddress(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

interface FollowListProps {
  addresses: { address: string; displayName?: string }[];
  type: "following" | "followers";
}

export function FollowList({ addresses, type }: FollowListProps) {
  const { t } = useTranslation();
  const { navigate } = useTransitionNavigate();

  if (addresses.length === 0) {
    return (
      <div className="text-center py-12">
        {type === "followers" ? (
          <>
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm font-medium">
              {t("social.noFollowers", { defaultValue: "No followers yet" })}
            </p>
          </>
        ) : (
          <>
            <UserPlus className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm font-medium">
              {t("social.notFollowingAnyone", { defaultValue: "Not following anyone yet" })}
            </p>
            <p className="text-muted-foreground/60 text-xs mt-1">
              {t("social.notFollowingHint", { defaultValue: "Explore the leaderboard to find traders." })}
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {addresses.map((item) => (
        <div
          key={item.address}
          className="flex items-center gap-3 p-3 bg-card/30 border border-border hover:bg-accent/50 transition-colors cursor-pointer"
          onClick={() => navigate(`/user/${item.address}`)}
        >
          {/* Avatar */}
          <div
            className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-foreground text-xs font-bold"
            style={{ backgroundColor: colorFromAddress(item.address) }}
          >
            {item.address.slice(2, 4).toUpperCase()}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">
              {item.displayName || `${item.address.slice(0, 6)}...${item.address.slice(-4)}`}
            </div>
            <div className="text-xs text-muted-foreground font-mono truncate">
              {item.address}
            </div>
          </div>

          {/* Follow Button */}
          <div onClick={(e) => e.stopPropagation()}>
            <FollowButton address={item.address} compact />
          </div>
        </div>
      ))}
    </div>
  );
}
