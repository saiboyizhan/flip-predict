import { useEffect, useState } from "react";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, ArrowLeft, Clock, Loader2 } from "lucide-react";
import { useAuthStore } from "@/app/stores/useAuthStore";
import { fetchPendingMarkets, approveMarket, rejectMarket } from "@/app/services/api";
import { formatBJDateTime } from "@/app/utils/date";

interface PendingMarket {
  id: string;
  title: string;
  description: string;
  category: string;
  endTime: string;
  createdAt: string;
}

export default function AdminPendingPage() {
  const { t } = useTranslation();
  const { navigate } = useTransitionNavigate();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [markets, setMarkets] = useState<PendingMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return;
    loadMarkets();
  }, [isAuthenticated, isAdmin]);

  async function loadMarkets() {
    setLoading(true);
    try {
      const data = await fetchPendingMarkets();
      setMarkets(
        data.map((m: any) => ({
          id: m.id,
          title: m.title,
          description: m.description,
          category: m.category,
          endTime: m.endTime,
          createdAt: m.createdAt,
        }))
      );
    } catch {
      toast.error(t("admin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(id: string) {
    setActionLoading(id);
    try {
      await approveMarket(id);
      toast.success(t("market.approved"));
      setMarkets((prev) => prev.filter((m) => m.id !== id));
    } catch {
      toast.error(t("admin.approveFailed"));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: string) {
    if (!rejectReason.trim()) {
      toast.error(t("admin.rejectReason"));
      return;
    }
    setActionLoading(id);
    try {
      await rejectMarket(id, rejectReason.trim());
      toast.success(t("market.rejected"));
      setMarkets((prev) => prev.filter((m) => m.id !== id));
      setRejectingId(null);
      setRejectReason("");
    } catch {
      toast.error(t("admin.rejectFailed"));
    } finally {
      setActionLoading(null);
    }
  }

  if (!isAuthenticated || !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <h1 className="text-2xl font-bold text-muted-foreground mb-4">403</h1>
        <p className="text-muted-foreground mb-6">{t("admin.accessRequired", { defaultValue: "Admin access required" })}</p>
        <button
          onClick={() => navigate("/")}
          className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-black font-semibold text-sm transition-colors"
        >
          {t("error.backToHome")}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => navigate("/")}
          className="p-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t("admin.pendingMarkets")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {markets.length} {t("market.pendingApproval").toLowerCase()}
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && markets.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          {t("common.noData")}
        </div>
      )}

      {/* Market list */}
      <div className="space-y-4">
        {markets.map((market) => (
          <div
            key={market.id}
            className="bg-card border border-white/[0.12] rounded-xl p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 bg-muted text-muted-foreground text-xs font-medium rounded-lg">
                    {t(`category.${market.category}`, market.category)}
                  </span>
                  <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    <Clock className="w-3 h-3" />
                    {t("market.pendingApproval")}
                  </span>
                </div>
                <h3 className="text-base font-bold text-foreground mb-1">
                  {market.title}
                </h3>
                {market.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                    {market.description}
                  </p>
                )}
                <div className="text-xs text-muted-foreground">
                  {t("market.endsAt", { defaultValue: "Ends" })}: {formatBJDateTime(market.endTime)}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {rejectingId === market.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder={t("admin.rejectReason")}
                      className="w-48 bg-input-background border border-border text-foreground text-sm py-1.5 px-3 focus:outline-none focus:border-red-500/50 transition-colors placeholder:text-muted-foreground"
                    />
                    <button
                      onClick={() => handleReject(market.id)}
                      disabled={actionLoading === market.id}
                      className="px-3 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                    >
                      {actionLoading === market.id ? "..." : t("admin.reject")}
                    </button>
                    <button
                      onClick={() => {
                        setRejectingId(null);
                        setRejectReason("");
                      }}
                      className="px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground text-sm transition-colors"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => handleApprove(market.id)}
                      disabled={actionLoading === market.id}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {t("admin.approve")}
                    </button>
                    <button
                      onClick={() => setRejectingId(market.id)}
                      disabled={actionLoading === market.id}
                      className="flex items-center gap-1.5 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-semibold transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                      {t("admin.reject")}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
