"use client";

import { useState, useRef, useEffect } from "react";
import { Bell, Check, ShoppingCart, BarChart3, Info, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNotificationStore } from "@/app/stores/useNotificationStore";
import { useAuthStore } from "@/app/stores/useAuthStore";
import type { Notification } from "@/app/stores/useNotificationStore";

function useFormatTime() {
  const { t } = useTranslation();
  return (timestamp: number): string => {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('notification.justNow');
    if (mins < 60) return t('notification.minutesAgo', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('notification.hoursAgo', { count: hours });
    return t('notification.daysAgo', { count: Math.floor(hours / 24) });
  };
}

function TypeIcon({ type }: { type: Notification["type"] }) {
  switch (type) {
    case "trade":
      return <ShoppingCart className="w-4 h-4 text-emerald-400 shrink-0" />;
    case "market":
      return <BarChart3 className="w-4 h-4 text-blue-400 shrink-0" />;
    case "system":
      return <Info className="w-4 h-4 text-blue-400 shrink-0" />;
  }
}

export function NotificationBell() {
  const { t } = useTranslation();
  const formatTime = useFormatTime();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const notifications = useNotificationStore((s) => s.notifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const unreadCount = useNotificationStore((s) => s.unreadCount());
  const loading = useNotificationStore((s) => s.loading);
  const loadFromServer = useNotificationStore((s) => s.loadFromServer);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Load notifications from server when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadFromServer();
    }
  }, [isAuthenticated, loadFromServer]);

  // Periodically refresh unread count only when panel is open
  useEffect(() => {
    if (!isAuthenticated || !open) return;
    const interval = setInterval(() => {
      useNotificationStore.getState().refreshUnreadCount();
    }, 30000); // every 30 seconds
    return () => clearInterval(interval);
  }, [isAuthenticated, open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        className="relative flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed sm:absolute left-0 sm:left-auto right-0 top-[60px] sm:top-full sm:mt-2 w-full sm:w-80 bg-card border border-border shadow-xl z-50 max-h-96 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">{t('notification.title')}</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead()}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Check className="w-3 h-3" />
                {t('notification.markAllRead')}
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="py-10 text-center">
                <Loader2 className="w-6 h-6 text-muted-foreground mx-auto mb-2 animate-spin" />
                <p className="text-muted-foreground text-sm">{t('notification.loading')}</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">{t('notification.noNotifications')}</p>
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.read) markAsRead(n.id);
                  }}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent ${
                    !n.read ? "bg-muted/30" : ""
                  }`}
                >
                  <div className="mt-0.5">
                    <TypeIcon type={n.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {n.title}
                      </span>
                      {!n.read && (
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{formatTime(n.timestamp)}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
