import { useTranslation } from "react-i18next";

interface CopyTradePanelProps {
  agentId: string;
  isOwner: boolean;
  agentTokenId?: bigint;
}

export function CopyTradePanel({ agentId, isOwner }: CopyTradePanelProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-secondary border border-border p-6">
      <h3 className="text-lg font-bold mb-2">{t("copyTrade.title")}</h3>
      <p className="text-muted-foreground text-sm">
        {isOwner
          ? t("copyTrade.revenueShare")
          : t("copyTrade.comingSoon", { defaultValue: "Copy trading is being upgraded to on-chain mode. Stay tuned!" })}
      </p>
    </div>
  );
}
