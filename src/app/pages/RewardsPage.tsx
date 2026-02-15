import { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  Gift,
  Loader2,
  Copy,
  CheckCircle2,
  Clock,
  DollarSign,
  Users,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fetchRewards, claimReward, getReferralCode } from "../services/api";
import { useAuthStore } from "../stores/useAuthStore";

interface Reward {
  id: string;
  type: string;
  title: string;
  description: string;
  amount: number;
  status: "claimable" | "claimed" | "expired";
  expiresAt?: string;
  createdAt: string;
}

function RewardSkeleton() {
  return (
    <div className="bg-secondary border border-border p-6 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-3 bg-muted rounded w-2/3" />
        </div>
      </div>
      <div className="h-8 bg-muted rounded w-24" />
    </div>
  );
}

export default function RewardsPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [referral, setReferral] = useState<{ code: string; referrals: number; earnings: number } | null>(null);
  const [referralLoading, setReferralLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      setReferralLoading(false);
      return;
    }

    setLoading(true);
    fetchRewards()
      .then((data) => {
        const list = data.rewards ?? [];
        setRewards(list);
      })
      .catch(() => setRewards([]))
      .finally(() => setLoading(false));

    setReferralLoading(true);
    getReferralCode()
      .then((data) => setReferral(data))
      .catch(() => setReferral(null))
      .finally(() => setReferralLoading(false));
  }, [isAuthenticated]);

  const handleClaim = async (id: string) => {
    setClaiming(id);
    try {
      const result = await claimReward(id);
      if (result.success) {
        setRewards((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: "claimed" as const } : r))
        );
        toast.success(t('rewards.claimSuccess', { amount: result.amount }));
      }
    } catch (err: any) {
      toast.error(err.message || t('rewards.claimFailed'));
    } finally {
      setClaiming(null);
    }
  };

  const copyReferralCode = () => {
    if (!referral) return;
    navigator.clipboard.writeText(referral.code);
    toast.success(t('rewards.codeCopied'));
  };

  const claimable = rewards.filter((r) => r.status === "claimable");
  const claimed = rewards.filter((r) => r.status === "claimed");
  const totalEarned = rewards
    .filter((r) => r.status === "claimed")
    .reduce((sum, r) => sum + r.amount, 0);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen p-4 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/50 border border-border p-12 sm:p-16 text-center"
          >
            <Gift className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-foreground mb-3">{t('rewards.title')}</h2>
            <p className="text-muted-foreground text-lg">{t('rewards.connectFirst')}</p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen p-4 sm:p-8">
      {/* Decorative blur */}
      <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blue-500/5 rounded-full blur-3xl" />

      <div className="relative max-w-4xl mx-auto space-y-6 sm:space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <Gift className="w-6 h-6 sm:w-8 sm:h-8 text-blue-400" />
          <div>
            <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">{t('rewards.title')}</h1>
            <p className="text-muted-foreground text-sm mt-1">{t('rewards.subtitle')}</p>
          </div>
        </motion.div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-gradient-to-br from-blue-900/20 to-secondary border border-blue-500/30 p-6 hover:scale-[1.02] transition-transform"
          >
            <div className="flex items-center gap-2 text-blue-400 text-sm mb-2">
              <Sparkles className="w-4 h-4" />
              {t('rewards.claimable')}
            </div>
            <div className="text-3xl font-bold text-blue-400">
              {claimable.length}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-secondary border border-border p-6 hover:scale-[1.02] transition-transform"
          >
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <DollarSign className="w-4 h-4" />
              {t('rewards.totalClaimed')}
            </div>
            <div className="text-3xl font-bold text-foreground">
              ${totalEarned.toLocaleString()}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-secondary border border-border p-6 hover:scale-[1.02] transition-transform"
          >
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Users className="w-4 h-4" />
              {t('rewards.referralEarnings')}
            </div>
            <div className="text-3xl font-bold text-foreground">
              ${referral?.earnings?.toLocaleString() || "0"}
            </div>
          </motion.div>
        </div>

        {/* Referral Code Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-secondary border border-border p-6"
        >
          <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-blue-400" />
            {t('rewards.inviteFriends')}
          </h3>
          {referralLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('common.loading')}
            </div>
          ) : referral ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-card border border-border px-4 py-3 font-mono text-blue-400 text-lg">
                  {referral.code}
                </div>
                <button
                  onClick={copyReferralCode}
                  className="px-4 py-3 bg-blue-500 hover:bg-blue-400 text-black font-semibold transition-colors flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  {t('rewards.copy')}
                </button>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{t('rewards.invited', { count: referral.referrals })}</span>
                <span>{t('rewards.referralAmount', { amount: referral.earnings.toLocaleString() })}</span>
              </div>
              <p className="text-muted-foreground text-xs">
                {t('rewards.referralDesc')}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t('rewards.noReferralCode')}</p>
          )}
        </motion.div>

        {/* Rewards List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <h3 className="text-lg font-bold mb-4">{t('rewards.rewardsList')}</h3>

          {loading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <RewardSkeleton key={i} />
              ))}
            </div>
          ) : rewards.length === 0 ? (
            <div className="bg-card/50 border border-border border-dashed p-12 text-center">
              <Gift className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">{t('rewards.noRewards')}</p>
              <p className="text-muted-foreground text-xs mt-1">{t('rewards.noRewardsDesc')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {rewards.map((reward, i) => (
                <motion.div
                  key={reward.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  className={`bg-secondary border p-6 flex items-center justify-between gap-4 ${
                    reward.status === "claimable"
                      ? "border-blue-500/30"
                      : reward.status === "claimed"
                      ? "border-border"
                      : "border-border opacity-60"
                  }`}
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div
                      className={`w-10 h-10 flex items-center justify-center shrink-0 ${
                        reward.status === "claimable"
                          ? "bg-blue-500/20"
                          : reward.status === "claimed"
                          ? "bg-emerald-500/20"
                          : "bg-muted"
                      }`}
                    >
                      {reward.status === "claimed" ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : reward.status === "expired" ? (
                        <Clock className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <Gift className="w-5 h-5 text-blue-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-foreground font-semibold text-sm truncate">
                          {reward.title}
                        </span>
                        {reward.status === "claimed" && (
                          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs">
                            {t('rewards.claimed')}
                          </span>
                        )}
                        {reward.status === "expired" && (
                          <span className="px-2 py-0.5 bg-muted text-muted-foreground text-xs">
                            {t('rewards.expired')}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground text-xs truncate">{reward.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-xl font-bold font-mono text-blue-400">
                      ${reward.amount.toLocaleString()}
                    </span>
                    {reward.status === "claimable" && (
                      <button
                        onClick={() => handleClaim(reward.id)}
                        disabled={claiming === reward.id}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-semibold text-sm transition-colors flex items-center gap-2"
                      >
                        {claiming === reward.id ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('rewards.claiming')}
                          </>
                        ) : (
                          t('rewards.claim')
                        )}
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
