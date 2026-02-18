import { useEffect, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { TrendingUp, TrendingDown, Rss, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { useSocialStore } from "@/app/stores/useSocialStore";
import { useAuthStore } from "@/app/stores/useAuthStore";
import { addGlobalListener, removeGlobalListener } from "@/app/services/ws";

function colorFromAddress(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

function formatTimeAgo(ts: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t('notification.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('notification.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('notification.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('notification.daysAgo', { count: days });
}

export function TradingFeed() {
  const { t } = useTranslation();
  const { navigate } = useTransitionNavigate();
  const feedItems = useSocialStore((s) => s.feedItems);
  const feedLoading = useSocialStore((s) => s.feedLoading);
  const feedError = useSocialStore((s) => s.feedError);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated) {
      useSocialStore.getState().loadFeed();
    }
  }, [isAuthenticated]);

  // WebSocket listener for real-time feed trades
  const handleWsMessage = useCallback(
    (data: any) => {
      if (data.type !== 'feed_trade') return;
      const { following, addFeedItem } = useSocialStore.getState();
      if (following.has(data.userAddress?.toLowerCase())) {
        addFeedItem(data);
      }
    },
    []
  );

  useEffect(() => {
    addGlobalListener(handleWsMessage);
    return () => {
      removeGlobalListener(handleWsMessage);
    };
  }, [handleWsMessage]);

  // Infinite scroll
  const loadMore = useCallback(() => {
    const { feedItems, feedLoading, loadFeed } = useSocialStore.getState();
    if (feedLoading || feedItems.length === 0) return;
    const lastItem = feedItems[feedItems.length - 1];
    const before = lastItem?.created_at || lastItem?.timestamp;
    if (before) {
      loadFeed(Number(before));
    }
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (!isAuthenticated) {
    return (
      <div className="text-center py-20">
        <Rss className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">{t("social.feedEmpty")}</p>
      </div>
    );
  }

  if (feedItems.length === 0 && !feedLoading) {
    return (
      <div className="text-center py-20">
        <Rss className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">{t("social.feedEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {feedItems.map((item, idx) => {
        const addr = item.user_address || item.userAddress || "";
        const displayName = item.display_name || `${addr.slice(0, 6)}...${addr.slice(-4)}`;
        const isBuy = (item.side || "").toLowerCase() === "yes";
        const ts = Number(item.created_at || item.timestamp || Date.now());

        return (
          <motion.div
            key={item.id || idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx < 10 ? idx * 0.02 : 0 }}
            className="flex items-start gap-3 p-3 bg-card/30 border border-border hover:bg-accent/30 transition-colors rounded-lg cursor-pointer"
            onClick={() => navigate(`/market/${item.market_id}`)}
          >
            {/* Avatar */}
            <div
              className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-foreground text-xs font-bold"
              style={{ backgroundColor: item.avatar_url || colorFromAddress(addr) }}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/user/${addr}`);
              }}
            >
              {addr.slice(2, 4).toUpperCase()}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-sm font-semibold text-foreground truncate cursor-pointer hover:text-blue-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/user/${addr}`);
                  }}
                >
                  {displayName}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{formatTimeAgo(ts, t)}</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                {isBuy ? (
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                )}
                <span className={isBuy ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
                  {isBuy ? t("social.bought") : t("social.sold")}
                </span>
                <span className="text-muted-foreground">{t("social.tradedOn")}</span>
                <span className="text-foreground font-medium truncate">
                  {item.market_title || item.marketTitle || item.market_id}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                ${Number(item.amount).toFixed(2)}
                {item.shares ? ` / ${Number(item.shares).toFixed(2)} shares` : ""}
              </div>
            </div>
          </motion.div>
        );
      })}

      {/* Loading / Error / Sentinel */}
      <div ref={sentinelRef} className="py-4 text-center">
        {feedLoading && (
          <div className="text-muted-foreground text-sm">{t("common.loading")}</div>
        )}
        {feedError && !feedLoading && (
          <button
            onClick={() => loadMore()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 rounded-lg transition-colors"
          >
            <AlertCircle className="w-4 h-4" />
            {t("social.feedLoadFailed", { defaultValue: "Failed to load more. Tap to retry." })}
          </button>
        )}
      </div>
    </div>
  );
}
