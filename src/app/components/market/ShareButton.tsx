"use client";

import { useState, useRef, useEffect } from "react";
import { Share2, Copy, X as XIcon, Send } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface ShareButtonProps {
  marketTitle: string;
  marketId: string;
  yesPrice?: number;
  compact?: boolean;
}

export function ShareButton({ marketTitle, marketId, yesPrice, compact }: ShareButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const shareUrl = typeof window !== "undefined"
    ? window.location.origin + "/market/" + marketId
    : "/market/" + marketId;

  const yesPct = yesPrice != null ? Math.round(yesPrice * 100) : undefined;

  const twitterText = yesPct != null
    ? t('share.twitterTextWithPct', { title: marketTitle, pct: yesPct })
    : t('share.twitterText', { title: marketTitle });

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(t('share.linkCopied'));
    } catch {
      toast.error(t('share.copyFailed'));
    }
    setOpen(false);
  };

  const handleTwitterShare = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  const handleTelegramShare = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(twitterText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className={`flex items-center justify-center transition-colors ${
          compact
            ? "w-7 h-7 text-muted-foreground hover:text-blue-400"
            : "gap-1.5 px-3 py-1.5 bg-muted border border-border hover:border-blue-500/50 text-muted-foreground hover:text-blue-400 text-sm"
        }`}
        title={t('share.share')}
      >
        <Share2 className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
        {!compact && <span>{t('share.share')}</span>}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-52 bg-card border border-border shadow-xl z-50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-border text-xs text-muted-foreground">
            {t('share.shareTo')}
          </div>
          <button
            onClick={handleCopyLink}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Copy className="w-4 h-4 text-blue-400" />
            {t('share.copyLink')}
          </button>
          <button
            onClick={handleTwitterShare}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <XIcon className="w-4 h-4 text-blue-400" />
            {t('share.shareTwitter')}
          </button>
          <button
            onClick={handleTelegramShare}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Send className="w-4 h-4 text-blue-400" />
            {t('share.shareTelegram')}
          </button>
        </div>
      )}
    </div>
  );
}
