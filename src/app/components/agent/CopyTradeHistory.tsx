import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCopyTrades } from "@/app/services/api";

export function CopyTradeHistory() {
  const { t } = useTranslation();
  const [trades, setTrades] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const pageSize = 10;

  useEffect(() => {
    setLoading(true);
    getCopyTrades(pageSize, offset)
      .then((data) => {
        setTrades(data.trades);
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [offset]);

  if (loading) {
    return (
      <div className="bg-secondary border border-border p-6">
        <div className="text-muted-foreground text-center">{t("common.loading")}</div>
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="bg-secondary border border-border p-12 text-center text-muted-foreground">
        {t("copyTrade.noCopyTrades")}
      </div>
    );
  }

  const totalPages = Math.ceil(total / pageSize);
  const currentPage = Math.floor(offset / pageSize) + 1;

  return (
    <div className="bg-secondary border border-border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left p-3 text-muted-foreground text-xs uppercase tracking-wider">
                {t("agentDetail.thTime")}
              </th>
              <th className="text-left p-3 text-muted-foreground text-xs uppercase tracking-wider">
                {t("agentDetail.thMarket")}
              </th>
              <th className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider">
                {t("agentDetail.thDirection")}
              </th>
              <th className="text-right p-3 text-muted-foreground text-xs uppercase tracking-wider">
                {t("agentDetail.thAmount")}
              </th>
              <th className="text-center p-3 text-muted-foreground text-xs uppercase tracking-wider">
                {t("agentDetail.thResult")}
              </th>
              <th className="text-right p-3 text-muted-foreground text-xs uppercase tracking-wider">
                {t("agentDetail.thPnl")}
              </th>
              <th className="text-right p-3 text-muted-foreground text-xs uppercase tracking-wider">
                {t("copyTrade.revenueShare")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {trades.map((trade: any) => {
              const profit = Number(trade.profit) || 0;
              const outcome = trade.status === "win" ? "win" : trade.status === "loss" ? "loss" : trade.status;
              return (
                <tr key={trade.id} className="hover:bg-accent transition-colors">
                  <td className="p-3 text-muted-foreground text-sm">
                    {new Date(Number(trade.created_at)).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="p-3 text-foreground text-sm font-mono">
                    #{(trade.market_id || "").slice(0, 8)}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`px-2 py-0.5 text-xs font-bold ${
                        trade.side === "yes"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {(trade.side || "").toUpperCase()}
                    </span>
                  </td>
                  <td className="p-3 text-right text-foreground text-sm font-mono">
                    ${Number(trade.amount || 0).toFixed(2)}
                  </td>
                  <td className="p-3 text-center">
                    {outcome === "win" ? (
                      <span className="text-emerald-400 font-bold text-sm">
                        {t("agentDetail.resultWin")}
                      </span>
                    ) : outcome === "loss" ? (
                      <span className="text-red-400 font-bold text-sm">
                        {t("agentDetail.resultLoss")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">{outcome || "-"}</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {profit !== 0 ? (
                      <span
                        className={`font-mono text-sm font-bold ${
                          profit >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-muted-foreground text-sm font-mono">
                    {trade.revenue_share ? `$${Number(trade.revenue_share).toFixed(2)}` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 p-4 border-t border-border">
          <button
            onClick={() => setOffset(Math.max(0, offset - pageSize))}
            disabled={offset === 0}
            className="px-3 py-1 text-sm border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            Prev
          </button>
          <span className="text-sm text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setOffset(offset + pageSize)}
            disabled={currentPage >= totalPages}
            className="px-3 py-1 text-sm border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
