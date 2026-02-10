"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, CheckCircle2, Frown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { claimWinnings } from "@/app/services/api";

interface ClaimWinningsProps {
  marketId: string;
  outcome: string;
  userPosition?: {
    side: string;
    shares: number;
    avgCost: number;
  };
}

export function ClaimWinnings({
  marketId,
  outcome,
  userPosition,
}: ClaimWinningsProps) {
  const { t } = useTranslation();
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimedAmount, setClaimedAmount] = useState<number | null>(null);

  if (!userPosition) return null;

  const winningSide = outcome.toLowerCase();
  const userWon = userPosition.side.toLowerCase() === winningSide;

  // User lost
  if (!userWon) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900 border border-zinc-800 p-6"
      >
        <div className="flex items-center gap-3 mb-3">
          <Frown className="w-6 h-6 text-zinc-500" />
          <h3 className="text-lg font-bold text-zinc-400">{t('claim.missedTitle')}</h3>
        </div>
        <p className="text-zinc-500 text-sm">
          {t('claim.missedDesc')}
        </p>
        <div className="mt-3 text-xs text-zinc-600">
          {t('claim.yourPosition')}: {userPosition.shares} shares @ $
          {userPosition.avgCost.toFixed(2)}
        </div>
      </motion.div>
    );
  }

  const estimatedWinnings = userPosition.shares * 1.0;
  const profit = estimatedWinnings - userPosition.shares * userPosition.avgCost;

  async function handleClaim() {
    setClaiming(true);
    try {
      const result = await claimWinnings(marketId);
      if (result.success) {
        setClaimed(true);
        setClaimedAmount(result.amount ?? estimatedWinnings);
        toast.success(t('claim.claimSuccess'));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('claim.claimFailed');
      toast.error(message);
    } finally {
      setClaiming(false);
    }
  }

  // Already claimed
  if (claimed) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-zinc-900 border border-zinc-700 p-6"
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-zinc-500" />
          <span className="text-zinc-400 font-bold">
            {t('claim.claimed', { amount: (claimedAmount ?? estimatedWinnings).toFixed(2) })}
          </span>
        </div>
      </motion.div>
    );
  }

  // Can claim
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative bg-zinc-900 border-2 border-emerald-500/50 p-6 overflow-hidden"
      >
        {/* Glow effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <Trophy className="w-6 h-6 text-emerald-400" />
            <h3 className="text-lg font-bold text-emerald-400">
              {t('claim.congratulations')}
            </h3>
          </div>

          <div className="space-y-2 mb-6 text-sm">
            <div className="flex justify-between text-zinc-400">
              <span>{t('claim.yourPosition')}</span>
              <span className="font-mono text-white">
                {userPosition.shares} shares @ ${userPosition.avgCost.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>{t('claim.estWinnings')}</span>
              <span className="font-mono text-emerald-400 font-bold">
                ${estimatedWinnings.toFixed(2)}
              </span>
            </div>
            {profit > 0 && (
              <div className="flex justify-between text-zinc-500 text-xs">
                <span>{t('claim.profit')}</span>
                <span className="font-mono text-emerald-400">
                  +${profit.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <button
            onClick={handleClaim}
            disabled={claiming}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-black font-bold text-sm tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {claiming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('claim.claiming')}
              </>
            ) : (
              t('claim.claimWinnings')
            )}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
