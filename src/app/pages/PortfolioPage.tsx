import { useTranslation } from "react-i18next";
import { PositionList } from "../components/portfolio/PositionList";

export default function PortfolioPage() {
  const { t } = useTranslation();
  return (
    <div className="pt-4 px-4 sm:px-6 pb-12">
      <h1 className="text-2xl font-bold mb-6">{t('portfolio.title')}</h1>
      <PositionList />
    </div>
  );
}
