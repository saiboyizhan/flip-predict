import { useEffect, useState, useCallback } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Bell, CheckCheck, Info, TrendingUp, Gavel, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/app/stores/useAuthStore";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from "@/app/services/api";

function getNotificationIcon(type: string) {
  switch (type) {
    case "trade":
      return <TrendingUp className="w-5 h-5 text-emerald-400" />;
    case "market":
      return <Gavel className="w-5 h-5 text-amber-400" />;
    case "system":
    default:
      return <Info className="w-5 h-5 text-blue-400" />;
  }
}

function getNotificationBorderColor(type: string) {
  switch (type) {
    case "trade":
      return "border-l-emerald-500/50";
    case "market":
      return "border-l-amber-500/50";
    case "system":
    default:
      return "border-l-blue-500/50";
  }
}

function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function NotificationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await fetchNotifications();
      setNotifications(data.notifications);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadNotifications();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, loadNotifications]);

  const handleMarkRead = useCallback(async (id: string) => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      // silently fail
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // silently fail
    } finally {
      setMarkingAll(false);
    }
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (!isAuthenticated) {
    return (
      <div className="relative min-h-[80vh]">
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <Bell className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold text-muted-foreground mb-2">
              {t("notifications.connectRequired", {
                defaultValue: "Connect wallet to view notifications",
              })}
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              {t("notifications.connectRequiredDesc", {
                defaultValue:
                  "Sign in with your wallet to see trade confirmations, market settlements, and other updates.",
              })}
            </p>
            <button
              onClick={() => navigate("/")}
              className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-black font-semibold text-sm transition-colors"
            >
              {t("portfolio.discoverMarkets", { defaultValue: "Discover Markets" })}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[80vh]">
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center justify-between mb-6"
        >
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              {t("notifications.title", { defaultValue: "Notifications" })}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {unreadCount > 0
                ? t("notifications.unreadCount", {
                    count: unreadCount,
                    defaultValue: `${unreadCount} unread`,
                  })
                : t("notifications.allRead", {
                    defaultValue: "All caught up",
                  })}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="flex items-center gap-2 px-4 py-2 text-sm text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-500/50 transition-colors disabled:opacity-50"
            >
              {markingAll ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCheck className="w-4 h-4" />
              )}
              {t("notifications.markAllRead", {
                defaultValue: "Mark all read",
              })}
            </button>
          )}
        </motion.div>

        {/* Notification list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <Bell className="w-16 h-16 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-sm">
              {t("notifications.empty", {
                defaultValue: "No notifications yet",
              })}
            </p>
            <p className="text-muted-foreground/60 text-xs mt-1">
              {t("notifications.emptyDesc", {
                defaultValue:
                  "Trade in markets to receive updates on your orders and settlements.",
              })}
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2">
            {notifications.map((notification, index) => (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03, duration: 0.3 }}
                onClick={() => {
                  if (!notification.read) {
                    handleMarkRead(notification.id);
                  }
                }}
                className={`relative border-l-4 ${getNotificationBorderColor(
                  notification.type
                )} bg-card/80 border border-white/[0.06] p-4 cursor-pointer hover:bg-card transition-colors ${
                  !notification.read
                    ? "bg-blue-500/[0.03]"
                    : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className="flex-shrink-0 mt-0.5">
                    {getNotificationIcon(notification.type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-sm font-semibold ${
                          notification.read
                            ? "text-muted-foreground"
                            : "text-foreground"
                        }`}
                      >
                        {notification.title}
                      </span>
                      {!notification.read && (
                        <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                      )}
                    </div>
                    <p
                      className={`text-sm leading-relaxed ${
                        notification.read
                          ? "text-muted-foreground/70"
                          : "text-muted-foreground"
                      }`}
                    >
                      {notification.message}
                    </p>
                  </div>

                  {/* Timestamp */}
                  <span className="text-xs text-muted-foreground/50 flex-shrink-0 whitespace-nowrap">
                    {formatTimestamp(notification.timestamp)}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
