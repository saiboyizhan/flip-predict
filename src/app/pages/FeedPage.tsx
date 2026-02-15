import { Rss } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TradingFeed } from "@/app/components/social/TradingFeed";

export default function FeedPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Rss className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">{t("social.feed")}</h1>
        </div>
        <TradingFeed />
      </div>
    </div>
  );
}
