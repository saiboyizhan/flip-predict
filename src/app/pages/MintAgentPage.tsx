import { Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTransitionNavigate } from "@/app/hooks/useTransitionNavigate";
import { MintAgent } from "../components/agent/MintAgent";
import { useAuthStore } from "@/app/stores/useAuthStore";

export default function MintAgentPage() {
  const { t } = useTranslation();
  const { navigate } = useTransitionNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return (
      <div className="relative min-h-[80vh]">
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <Wallet className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold text-muted-foreground mb-2">{t('auth.connectRequired')}</h2>
            <p className="text-muted-foreground text-sm mb-6">{t('auth.connectDescription')}</p>
            <button
              onClick={() => navigate("/")}
              className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-black font-semibold text-sm transition-colors"
            >
              {t('portfolio.discoverMarkets')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-4">
      <MintAgent />
    </div>
  );
}
