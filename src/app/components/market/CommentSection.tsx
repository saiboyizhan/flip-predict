"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Heart, Send, MessageCircle, Reply, ChevronDown, ChevronUp } from "lucide-react";
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
  parentId: string | null;
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
    parentId: raw.parent_id ?? raw.parentId ?? null,
  };
}

function buildCommentTree(comments: Comment[]): Map<string | null, Comment[]> {
  const tree = new Map<string | null, Comment[]>();
  for (const c of comments) {
    const key = c.parentId;
    if (!tree.has(key)) tree.set(key, []);
    tree.get(key)!.push(c);
  }
  return tree;
}

interface CommentItemProps {
  comment: Comment;
  children: Comment[];
  tree: Map<string | null, Comment[]>;
  depth: number;
  onLike: (id: string) => void;
  onReply: (parentId: string, content: string) => Promise<void>;
  formatRelativeTime: (ts: number) => string;
  isAuthenticated: boolean;
}

function CommentItem({ comment, children, tree, depth, onLike, onReply, formatRelativeTime, isAuthenticated }: CommentItemProps) {
  const { t } = useTranslation();
  const [showReplies, setShowReplies] = useState(depth < 1);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyInput, setReplyInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleReplySubmit = async () => {
    const trimmed = replyInput.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onReply(comment.id, trimmed);
      setReplyInput("");
      setReplyOpen(false);
      setShowReplies(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`flex gap-3 group ${depth > 0 ? "ml-6 sm:ml-10 pl-3 border-l-2 border-border" : ""}`}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex-shrink-0 flex items-center justify-center text-foreground text-xs font-bold"
        style={{ backgroundColor: comment.avatar }}
      >
        {comment.author.slice(2, 4).toUpperCase()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs sm:text-sm font-mono text-muted-foreground truncate">
            {comment.author}
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {formatRelativeTime(comment.timestamp)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed break-words">
          {comment.content}
        </p>

        {/* Actions */}
        <div className="mt-2 flex items-center gap-4">
          {/* Like */}
          <button
            onClick={() => onLike(comment.id)}
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              comment.liked
                ? "text-red-400"
                : "text-muted-foreground hover:text-red-400"
            }`}
          >
            <Heart
              className="w-3.5 h-3.5"
              fill={comment.liked ? "currentColor" : "none"}
            />
            {comment.likes > 0 && <span>{comment.likes}</span>}
          </button>

          {/* Reply Button */}
          {isAuthenticated && depth < 3 && (
            <button
              onClick={() => setReplyOpen(!replyOpen)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-blue-400 transition-colors"
            >
              <Reply className="w-3.5 h-3.5" />
              <span>{t("comment.reply")}</span>
            </button>
          )}

          {/* Toggle Replies */}
          {children.length > 0 && (
            <button
              onClick={() => setShowReplies(!showReplies)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showReplies ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span>
                {showReplies
                  ? t("comment.hideReplies")
                  : t("comment.replies", { count: children.length })}
              </span>
            </button>
          )}
        </div>

        {/* Reply Input */}
        {replyOpen && (
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={replyInput}
              onChange={(e) => setReplyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleReplySubmit();
                }
              }}
              placeholder={t("comment.placeholder")}
              className="flex-1 bg-secondary border border-border text-foreground placeholder-muted-foreground px-3 py-2 text-xs focus:outline-none focus:border-blue-500/50 transition-colors"
            />
            <button
              onClick={handleReplySubmit}
              disabled={!replyInput.trim() || submitting}
              className="px-3 py-2 bg-blue-500 hover:bg-blue-400 disabled:bg-muted disabled:text-muted-foreground text-black font-semibold text-xs transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Child Comments */}
        {showReplies && children.length > 0 && (
          <div className="mt-3 space-y-3">
            {children.map((child) => (
              <CommentItem
                key={child.id}
                comment={child}
                children={tree.get(child.id) || []}
                tree={tree}
                depth={depth + 1}
                onLike={onLike}
                onReply={onReply}
                formatRelativeTime={formatRelativeTime}
                isAuthenticated={isAuthenticated}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
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
      setComments((prev) => [...prev, newComment]);
      setInput("");
    } catch {
      // silently fail
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (parentId: string, content: string) => {
    try {
      const data = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/comments/${marketId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("jwt_token")}`,
          },
          body: JSON.stringify({ content, parentId }),
        }
      );
      if (!data.ok) throw new Error("Request failed");
      const json = await data.json();
      if (json.comment) {
        const newComment = normalizeComment(json.comment, address);
        setComments((prev) => [...prev, newComment]);
      }
    } catch {
      // silently fail
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

  const tree = buildCommentTree(comments);
  const rootComments = tree.get(null) || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="bg-card border border-border p-4 sm:p-8"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 sm:mb-6">
        <MessageCircle className="w-5 h-5 text-blue-400" />
        <h2 className="text-lg sm:text-xl font-bold text-foreground">{t("market.discussion")}</h2>
        {comments.length > 0 && (
          <span className="text-sm text-muted-foreground ml-1">({comments.length})</span>
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
          className="flex-1 bg-secondary border border-border text-foreground placeholder-muted-foreground px-3 sm:px-4 py-2.5 sm:py-3 text-sm focus:outline-none focus:border-blue-500/50 transition-colors disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || !isAuthenticated || submitting}
          className="px-3 sm:px-4 py-2.5 sm:py-3 bg-blue-500 hover:bg-blue-400 disabled:bg-muted disabled:text-muted-foreground text-black font-semibold text-sm transition-colors flex items-center gap-2 shrink-0"
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
              <div className="w-9 h-9 rounded-full bg-muted flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded w-1/4" />
                <div className="h-4 bg-muted rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        /* Comments List - Empty */
        <div className="text-center py-8 sm:py-12">
          <MessageCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">{t("comment.noComments")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {rootComments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                children={tree.get(comment.id) || []}
                tree={tree}
                depth={0}
                onLike={handleLike}
                onReply={handleReply}
                formatRelativeTime={formatRelativeTime}
                isAuthenticated={isAuthenticated}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
