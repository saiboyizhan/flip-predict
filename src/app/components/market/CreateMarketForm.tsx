import { useState } from "react";
import { motion } from "motion/react";
import { Plus, Clock, AlertTriangle, Eye } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { createUserMarket } from "@/app/services/api";

const CATEGORY_IDS = [
  'four-meme', 'meme-arena', 'narrative', 'kol', 'on-chain',
  'rug-alert', 'btc-weather', 'fun', 'daily',
];

const QUICK_TIME_KEYS = [
  { key: 'hours24', hours: 24 },
  { key: 'days3', hours: 72 },
  { key: 'week1', hours: 168 },
  { key: 'weeks2', hours: 336 },
  { key: 'month1', hours: 720 },
];

interface CreateMarketFormProps {
  onSuccess?: () => void;
  creationStats?: {
    dailyCount: number;
    maxPerDay: number;
    creationFee: number;
    balance: number;
  };
}

export function CreateMarketForm({ onSuccess, creationStats }: CreateMarketFormProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('daily');
  const [endTime, setEndTime] = useState<number>(Date.now() + 24 * 3600000);
  const [loading, setLoading] = useState(false);

  const stats = creationStats || { dailyCount: 0, maxPerDay: 3, creationFee: 10, balance: 0 };
  const canCreate = stats.dailyCount < stats.maxPerDay && stats.balance >= stats.creationFee;
  const titleLength = title.length;
  const titleValid = titleLength >= 10 && titleLength <= 200;

  const setQuickTime = (hours: number) => {
    setEndTime(Date.now() + hours * 3600000);
  };

  const handleCreate = async () => {
    if (!titleValid) {
      toast.error(t('createMarket.titleLengthError'));
      return;
    }
    if (!category) {
      toast.error(t('createMarket.selectCategory'));
      return;
    }

    setLoading(true);
    try {
      await createUserMarket({
        title: title.trim(),
        description: description.trim(),
        category,
        endTime,
      });
      toast.success(t('createMarket.createSuccess'));
      setTitle('');
      setDescription('');
      onSuccess?.();
    } catch (err: any) {
      toast.error(err.message || t('createMarket.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  const formatEndTime = (ts: number) => {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const timeLeft = endTime - Date.now();
  const daysLeft = Math.floor(timeLeft / 86400000);
  const hoursLeft = Math.floor((timeLeft % 86400000) / 3600000);

  return (
    <div className="space-y-6">
      {/* Fee Info Bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-950 border border-zinc-800 p-3">
          <div className="text-zinc-500 text-xs mb-1">{t('createMarket.creationFee')}</div>
          <div className="text-amber-400 font-bold font-mono">${stats.creationFee} USDT</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-3">
          <div className="text-zinc-500 text-xs mb-1">{t('createMarket.currentBalance')}</div>
          <div className={`font-bold font-mono ${stats.balance >= stats.creationFee ? 'text-emerald-400' : 'text-red-400'}`}>
            ${stats.balance.toFixed(2)}
          </div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-3">
          <div className="text-zinc-500 text-xs mb-1">{t('createMarket.createdToday')}</div>
          <div className={`font-bold font-mono ${stats.dailyCount >= stats.maxPerDay ? 'text-red-400' : 'text-white'}`}>
            {stats.dailyCount} / {stats.maxPerDay}
          </div>
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm text-zinc-400 mb-2">
          {t('createMarket.marketTitle')} <span className={`font-mono ${titleValid ? 'text-emerald-400' : 'text-zinc-600'}`}>({titleLength}/200)</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('createMarket.titlePlaceholder')}
          maxLength={200}
          className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-3 px-4 focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-zinc-600"
        />
        {titleLength > 0 && titleLength < 10 && (
          <p className="text-red-400 text-xs mt-1">{t('createMarket.titleTooShort')}</p>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm text-zinc-400 mb-2">{t('createMarket.description')}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('createMarket.descPlaceholder')}
          rows={3}
          className="w-full bg-zinc-900 border border-zinc-800 text-white text-sm py-3 px-4 focus:outline-none focus:border-amber-500/50 transition-colors placeholder:text-zinc-600 resize-none"
        />
      </div>

      {/* Category */}
      <div>
        <label className="block text-sm text-zinc-400 mb-3">{t('createMarket.categoryLabel')}</label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {CATEGORY_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setCategory(id)}
              className={`text-left p-3 border transition-colors ${
                category === id
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
              }`}
            >
              <div className="text-xs text-white">{t(`createMarket.categories.${id}`)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* End Time */}
      <div>
        <label className="block text-sm text-zinc-400 mb-3">
          <Clock className="w-4 h-4 inline mr-1" />
          {t('createMarket.endTime')}
        </label>
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_TIME_KEYS.map((qt) => (
            <button
              key={qt.key}
              onClick={() => setQuickTime(qt.hours)}
              className="px-3 py-1.5 text-xs border border-zinc-800 bg-zinc-950 hover:border-amber-500 hover:text-amber-400 text-zinc-400 transition-colors"
            >
              {t(`createMarket.${qt.key}`)}
            </button>
          ))}
        </div>
        <div className="text-sm text-zinc-300">
          {formatEndTime(endTime)} <span className="text-zinc-500">({t('createMarket.daysHoursLater', { days: daysLeft, hours: hoursLeft })})</span>
        </div>
      </div>

      {/* Preview Card */}
      {title && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="bg-zinc-900 border border-zinc-800 p-4"
        >
          <div className="flex items-center gap-2 text-zinc-500 text-xs mb-2">
            <Eye className="w-3.5 h-3.5" />
            {t('createMarket.preview')}
          </div>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h4 className="text-white font-medium text-sm mb-1">{title}</h4>
              {description && <p className="text-zinc-500 text-xs mb-2">{description}</p>}
              <div className="flex items-center gap-3 text-xs text-zinc-600">
                <span className="px-1.5 py-0.5 border border-zinc-800 bg-zinc-950">
                  {t(`createMarket.categories.${category}`)}
                </span>
                <span>{t('createMarket.daysHoursEnd', { days: daysLeft, hours: hoursLeft })}</span>
              </div>
            </div>
            <div className="text-center shrink-0">
              <div className="text-lg font-bold text-white font-mono">50%</div>
              <div className="text-zinc-500 text-xs">YES</div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Warnings */}
      {!canCreate && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {stats.dailyCount >= stats.maxPerDay
            ? t('createMarket.dailyLimitReached')
            : t('createMarket.insufficientBalance', { fee: stats.creationFee })
          }
        </div>
      )}

      {/* Create Button */}
      <button
        onClick={handleCreate}
        disabled={loading || !canCreate || !titleValid}
        className="w-full py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-lg transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="w-5 h-5" />
        {loading ? t('createMarket.creating') : t('createMarket.createButton', { fee: stats.creationFee })}
      </button>

      <p className="text-zinc-600 text-xs text-center">
        {t('createMarket.footer', { fee: stats.creationFee, max: stats.maxPerDay })}
      </p>
    </div>
  );
}
