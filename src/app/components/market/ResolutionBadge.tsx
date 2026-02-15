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
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }) + " USDT";
}

export function ResolutionBadge({
  resolutionType,
  oraclePair,
  targetPrice,
}: ResolutionBadgeProps) {
  const { t } = useTranslation();
  if (resolutionType === "manual") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground border border-border">
        <User className="w-3 h-3" />
        {t('resolved.manualSettlement')}
      </span>
    );
  }

  if (resolutionType === "price_above" || resolutionType === "price_below") {
    const operator = resolutionType === "price_above" ? ">" : "<";
    const label = oraclePair
      ? `${oraclePair} ${operator} ${targetPrice != null ? formatPrice(targetPrice) : "?"}`
      : resolutionType;

    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-gradient-to-r from-blue-500/20 to-yellow-500/20 text-blue-300 border border-blue-500/30">
        <Bot className="w-3 h-3" />
        {t('market.oracle', { label })}
      </span>
    );
  }

  // auto / default: show auto settlement
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-gradient-to-r from-blue-500/20 to-emerald-500/20 text-emerald-300 border border-emerald-500/30">
      <Bot className="w-3 h-3" />
      {t('resolved.autoSettlement')}
    </span>
  );
}
