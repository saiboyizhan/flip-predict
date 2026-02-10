"use client";

import { Bot, User } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ResolutionBadgeProps {
  resolutionType: string;
  oraclePair?: string;
  targetPrice?: number;
}

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function ResolutionBadge({
  resolutionType,
  oraclePair,
  targetPrice,
}: ResolutionBadgeProps) {
  const { t } = useTranslation();
  if (resolutionType === "manual") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-zinc-700 text-zinc-300 border border-zinc-600">
        <User className="w-3 h-3" />
        {t('resolved.manualSettlement')}
      </span>
    );
  }

  const operator = resolutionType === "price_above" ? ">" : "<";
  const label = oraclePair
    ? `${oraclePair} ${operator} ${targetPrice != null ? formatPrice(targetPrice) : "?"}`
    : resolutionType;

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-gradient-to-r from-amber-500/20 to-yellow-500/20 text-amber-300 border border-amber-500/30">
      <Bot className="w-3 h-3" />
      {t('market.oracle', { label })}
    </span>
  );
}
