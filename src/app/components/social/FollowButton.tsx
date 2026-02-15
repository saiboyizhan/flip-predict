import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { UserPlus, UserCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSocialStore } from "@/app/stores/useSocialStore";
import { useAuthStore } from "@/app/stores/useAuthStore";

interface FollowButtonProps {
  address: string;
  compact?: boolean;
}

export function FollowButton({ address, compact }: FollowButtonProps) {
  const { t } = useTranslation();
  const following = useSocialStore((s) => s.following);
  const follow = useSocialStore((s) => s.follow);
  const unfollow = useSocialStore((s) => s.unfollow);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const myAddress = useAuthStore((s) => s.address);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

  const normalized = address.toLowerCase();
  const isFollowing = following.has(normalized);
  const isSelf = myAddress?.toLowerCase() === normalized;

  if (isSelf || !isAuthenticated) return null;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (isFollowing) {
        await unfollow(normalized);
      } else {
        await follow(normalized);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      <motion.button
        key={isFollowing ? "following" : "follow"}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        disabled={loading}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
          compact ? "px-2 py-1" : "px-3 py-1.5"
        } ${
          isFollowing
            ? hovered
              ? "bg-red-500/10 text-red-400 border border-red-500/50"
              : "bg-blue-500/10 text-blue-400 border border-blue-500/50"
            : "bg-blue-500 text-black border border-blue-500 hover:bg-blue-400"
        }`}
      >
        {isFollowing ? (
          <>
            {hovered ? null : <UserCheck className="w-3.5 h-3.5" />}
            <span>
              {hovered ? t("social.unfollow") : t("social.following")}
            </span>
          </>
        ) : (
          <>
            <UserPlus className="w-3.5 h-3.5" />
            {!compact && <span>{t("social.follow")}</span>}
          </>
        )}
      </motion.button>
    </AnimatePresence>
  );
}
