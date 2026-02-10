"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Heart, Send, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchComments, postComment, toggleCommentLike } from "@/app/services/api";
import { useAuthStore } from "@/app/stores/useAuthStore";
import { useAccount } from "wagmi";

interface Comment {
  id: string;
  marketId: string;
  author: string;
  avatar: string;
  content: string;
  timestamp: number;
  likes: number;
  liked: boolean;
}

interface CommentSectionProps {
  marketId: string;
}

function colorFromAddress(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

function parseLikedBy(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeComment(raw: any, walletAddress?: string): Comment {
  const author = String(raw.author ?? raw.user_address ?? raw.userAddress ?? "0x");
  const likedBy = parseLikedBy(raw.liked_by ?? raw.likedBy);
  const lowerAddress = walletAddress?.toLowerCase();
  const liked =
    typeof raw.liked === "boolean"
      ? raw.liked
      : (lowerAddress ? likedBy.map((a) => a.toLowerCase()).includes(lowerAddress) : false);

  return {
    id: String(raw.id ?? ""),
    marketId: String(raw.marketId ?? raw.market_id ?? ""),
    author,
    avatar: String(raw.avatar ?? colorFromAddress(author)),
    content: String(raw.content ?? ""),
    timestamp: Number(raw.timestamp ?? raw.created_at ?? Date.now()) || Date.now(),
    likes: Number(raw.likes ?? likedBy.length) || 0,
    liked,
  };
}

export function CommentSection({ marketId }: CommentSectionProps) {
  const { t } = useTranslation();
  const { address } = useAccount();
  const [input, setInput] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  function formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return t("comment.justNow");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t("comment.minutesAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("comment.hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    return t("comment.daysAgo", { count: days });
  }

  const loadComments = useCallback(async () => {
    try {
      const list = await fetchComments(marketId);
      setComments(list.map((item) => normalizeComment(item, address)));
    } catch {
      // silently fail, keep existing comments
    } finally {
      setLoading(false);
    }
  }, [marketId, address]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || !isAuthenticated) return;

    setSubmitting(true);
    try {
      const res = await postComment(marketId, trimmed);
      const newComment = normalizeComment((res as any) ?? {}, address);
      setComments((prev) => [newComment, ...prev]);
      setInput("");
    } catch {
      // silently fail
    } finally {
      setSubmitting(false);
    }
  };

  const handleLike = async (commentId: string) => {
    try {
      const res = await toggleCommentLike(commentId);
      const updated = normalizeComment((res as any) ?? {}, address);
      setComments((prev) =>
        prev.map((c) => {
          if (c.id !== commentId) return c;
          if (!updated.id) {
            return {
              ...c,
              liked: !c.liked,
              likes: c.liked ? c.likes - 1 : c.likes + 1,
            };
          }
          return { ...c, ...updated };
        })
      );
    } catch {
      // silently fail
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="bg-zinc-900 border border-zinc-800 p-4 sm:p-8"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 sm:mb-6">
        <MessageCircle className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg sm:text-xl font-bold text-white">{t("market.discussion")}</h2>
        {comments.length > 0 && (
          <span className="text-sm text-zinc-500 ml-1">({comments.length})</span>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 sm:gap-3 mb-4 sm:mb-6">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isAuthenticated ? t("comment.placeholder") : t("comment.connectWalletFirst")}
          disabled={!isAuthenticated || submitting}
          className="flex-1 bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-600 px-3 sm:px-4 py-2.5 sm:py-3 text-sm focus:outline-none focus:border-amber-500/50 transition-colors disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || !isAuthenticated || submitting}
          className="px-3 sm:px-4 py-2.5 sm:py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-semibold text-sm transition-colors flex items-center gap-2 shrink-0"
        >
          <Send className="w-4 h-4" />
          <span className="hidden sm:inline">{submitting ? t("comment.sending") : t("comment.send")}</span>
        </button>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-9 h-9 rounded-full bg-zinc-800 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-zinc-800 rounded w-1/4" />
                <div className="h-4 bg-zinc-800 rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        /* Comments List - Empty */
        <div className="text-center py-8 sm:py-12">
          <MessageCircle className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">{t("comment.noComments")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {comments.map((comment) => (
              <motion.div
                key={comment.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex gap-3 group"
              >
                {/* Avatar */}
                <div
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: comment.avatar }}
                >
                  {comment.author.slice(2, 4).toUpperCase()}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs sm:text-sm font-mono text-zinc-400 truncate">
                      {comment.author}
                    </span>
                    <span className="text-xs text-zinc-600 shrink-0">
                      {formatRelativeTime(comment.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed break-words">
                    {comment.content}
                  </p>

                  {/* Like */}
                  <button
                    onClick={() => handleLike(comment.id)}
                    className={`mt-2 flex items-center gap-1.5 text-xs transition-colors ${
                      comment.liked
                        ? "text-red-400"
                        : "text-zinc-600 hover:text-red-400"
                    }`}
                  >
                    <Heart
                      className="w-3.5 h-3.5"
                      fill={comment.liked ? "currentColor" : "none"}
                    />
                    {comment.likes > 0 && <span>{comment.likes}</span>}
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
