import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { motion } from "motion/react";
import { User, BarChart3, Users, Copy, Check, Edit3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getPublicProfile, getFollowing, getFollowers, updateProfile } from "@/app/services/api";
import { useAuthStore } from "@/app/stores/useAuthStore";
import { useSocialStore } from "@/app/stores/useSocialStore";
import { FollowButton } from "@/app/components/social/FollowButton";
import { FollowList } from "@/app/components/social/FollowList";

interface UserProfile {
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  totalTrades?: number;
  totalVolume?: number;
  followersCount?: number;
  followingCount?: number;
  [key: string]: unknown;
}

function colorFromAddress(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

export default function UserProfilePage() {
  const { t } = useTranslation();
  const { address } = useParams<{ address: string }>();
  const myAddress = useAuthStore((s) => s.address);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"following" | "followers">("following");
  const [followingList, setFollowingList] = useState<{ address: string; displayName?: string }[]>([]);
  const [followersList, setFollowersList] = useState<{ address: string; displayName?: string }[]>([]);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [saving, setSaving] = useState(false);
  const loadFollowing = useSocialStore((s) => s.loadFollowing);

  const isSelf = myAddress?.toLowerCase() === address?.toLowerCase();

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      getPublicProfile(address).then((d) => d.profile),
      getFollowing(address).then((d) =>
        (d.following ?? []).map((f) => ({ address: f.address, displayName: f.display_name || undefined }))
      ),
      getFollowers(address).then((d) =>
        (d.followers ?? []).map((f) => ({ address: f.address, displayName: f.display_name || undefined }))
      ),
    ])
      .then(([p, fl, fr]) => {
        if (cancelled) return;
        setProfile(p);
        setFollowingList(fl);
        setFollowersList(fr);
        setEditName(p?.display_name || "");
        setEditBio(p?.bio || "");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to load user profile:", err);
        toast.error(t("social.profileLoadFailed", { defaultValue: "Failed to load user profile" }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Load following for FollowButton state
    if (myAddress) {
      useSocialStore.getState().loadFollowing(myAddress);
    }

    return () => { cancelled = true; };
  }, [address, myAddress, t]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently fail
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const result = await updateProfile({
        displayName: editName || undefined,
        bio: editBio || undefined,
      });
      setProfile((prev) => ({ ...prev, ...result.profile }));
      setEditing(false);
      toast.success(t("social.profileSaved"));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen p-4 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-muted" />
              <div className="space-y-3 flex-1">
                <div className="h-6 bg-muted rounded w-1/3" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 bg-muted rounded" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile || !address) {
    return (
      <div className="min-h-screen p-4 sm:p-8">
        <div className="max-w-4xl mx-auto text-center py-20">
          <User className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{t("social.noProfile")}</p>
        </div>
      </div>
    );
  }

  const displayName = profile.display_name || `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Profile Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border p-6"
        >
          <div className="flex items-start gap-4 sm:gap-6">
            {/* Avatar */}
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex-shrink-0 flex items-center justify-center text-foreground text-xl sm:text-2xl font-bold"
              style={{ backgroundColor: profile.avatar_url || colorFromAddress(address) }}
            >
              {address.slice(2, 4).toUpperCase()}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl sm:text-2xl font-bold text-foreground truncate">{displayName}</h1>
                {!isSelf && <FollowButton address={address} />}
                {isSelf && !editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="p-1.5 text-muted-foreground hover:text-blue-400 transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Address */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-muted-foreground truncate">
                  {address}
                </span>
                <button onClick={handleCopy} className="text-muted-foreground hover:text-blue-400 transition-colors">
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {profile.bio && !editing && (
                <p className="text-sm text-muted-foreground">{profile.bio}</p>
              )}

              {/* Follower/Following counts */}
              <div className="flex items-center gap-4 mt-3 text-sm">
                <button
                  onClick={() => setActiveTab("following")}
                  className={activeTab === "following" ? "text-blue-400 font-semibold" : "text-muted-foreground hover:text-foreground"}
                >
                  {t("social.followingCount", { count: profile.followingCount || followingList.length })}
                </button>
                <button
                  onClick={() => setActiveTab("followers")}
                  className={activeTab === "followers" ? "text-blue-400 font-semibold" : "text-muted-foreground hover:text-foreground"}
                >
                  {t("social.followersCount", { count: profile.followersCount || followersList.length })}
                </button>
              </div>
            </div>
          </div>

          {/* Edit Profile Form */}
          {editing && isSelf && (
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{t("social.displayName")}</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={50}
                  className="w-full bg-secondary border border-border text-foreground px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">{t("social.bio")}</label>
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  maxLength={200}
                  rows={3}
                  className="w-full bg-secondary border border-border text-foreground px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:bg-muted text-black font-semibold text-sm transition-colors"
                >
                  {saving ? t("common.loading") : t("social.saveProfile")}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 bg-secondary border border-border text-foreground hover:bg-accent text-sm transition-colors"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </motion.div>

        {/* Trade Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          <div className="bg-card border border-border p-4 text-center">
            <BarChart3 className="w-5 h-5 text-blue-400 mx-auto mb-2" />
            <div className="text-lg font-bold text-foreground">{profile.totalTrades || 0}</div>
            <div className="text-xs text-muted-foreground">{t("profile.totalTrades")}</div>
          </div>
          <div className="bg-card border border-border p-4 text-center">
            <div className="text-lg font-bold text-foreground">${(profile.totalVolume || 0).toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">{t("profile.totalVolume")}</div>
          </div>
          <div className="bg-card border border-border p-4 text-center">
            <Users className="w-5 h-5 text-blue-400 mx-auto mb-2" />
            <div className="text-lg font-bold text-foreground">{profile.followersCount || followersList.length}</div>
            <div className="text-xs text-muted-foreground">{t("social.followers")}</div>
          </div>
          <div className="bg-card border border-border p-4 text-center">
            <div className="text-lg font-bold text-foreground">{profile.followingCount || followingList.length}</div>
            <div className="text-xs text-muted-foreground">{t("social.following")}</div>
          </div>
        </motion.div>

        {/* Following / Followers Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card border border-border"
        >
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab("following")}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "following"
                  ? "text-blue-400 border-b-2 border-blue-400"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("social.following")} ({followingList.length})
            </button>
            <button
              onClick={() => setActiveTab("followers")}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === "followers"
                  ? "text-blue-400 border-b-2 border-blue-400"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("social.followers")} ({followersList.length})
            </button>
          </div>
          <div className="p-4">
            {activeTab === "following" ? (
              <FollowList addresses={followingList} type="following" />
            ) : (
              <FollowList addresses={followersList} type="followers" />
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
