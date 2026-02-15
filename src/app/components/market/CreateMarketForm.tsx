import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Plus, Clock, AlertTriangle, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAccount, useChainId } from "wagmi";
import { createUserMarket as createUserMarketRecord } from "@/app/services/api";
import { PREDICTION_MARKET_ADDRESS } from "@/app/config/contracts";
import { getBscScanUrl, useCreateUserMarket, useMarketCreationFee, useTxNotifier, useUsdtAllowance, useUsdtApprove } from "@/app/hooks/useContracts";

const OPTION_COLORS = [
  '#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

interface OptionInput {
  label: string;
  color: string;
}

const CATEGORY_IDS = [
  'four-meme', 'flap', 'nfa', 'hackathon',
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

interface PendingMarketPayload {
  title: string;
  description: string;
  category: string;
  endTime: number;
  marketType: 'binary' | 'multi';
  options?: { label: string; color?: string }[];
  resolutionType: 'manual' | 'price_above' | 'price_below';
  oraclePair?: string;
  targetPrice?: number;
  resolutionRule: string;
  resolutionSourceUrl?: string;
  resolutionTimeUtc: number;
}

export function CreateMarketForm({ onSuccess, creationStats }: CreateMarketFormProps) {
  const { t } = useTranslation();
  const chainId = useChainId();
  const { address } = useAccount();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('four-meme');
  const [endTime, setEndTime] = useState<number>(Date.now() + 24 * 3600000);
  const [syncing, setSyncing] = useState(false);
  const [marketType, setMarketType] = useState<'binary' | 'multi'>('binary');
  const [resolutionType, setResolutionType] = useState<'manual' | 'price_above' | 'price_below'>('manual');
  const [resolutionRule, setResolutionRule] = useState('');
  const [resolutionSourceUrl, setResolutionSourceUrl] = useState('');
  const [oraclePair, setOraclePair] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [resolutionDelayHours, setResolutionDelayHours] = useState(1);
  const [options, setOptions] = useState<OptionInput[]>([
    { label: '', color: OPTION_COLORS[0] },
    { label: '', color: OPTION_COLORS[1] },
  ]);
  const pendingPayloadRef = useRef<PendingMarketPayload | null>(null);
  const lastSyncedTxHashRef = useRef<string | null>(null);
  const feeAtSubmitRef = useRef<string>('0'); // P0-2 fix: capture fee at submission

  const {
    createUserMarket: createUserMarketOnChain,
    createdMarketId,
    txHash: createTxHash,
    isWriting: createWriting,
    isConfirming: createConfirming,
    isConfirmed: createConfirmed,
    error: createError,
    reset: resetCreateUserMarket,
  } = useCreateUserMarket();
  const {
    feeWei,
    feeUSDT,
    isLoading: feeLoading,
  } = useMarketCreationFee();

  // P1-2 fix: USDT allowance & approve hooks
  const {
    allowanceRaw,
    refetch: refetchAllowance,
  } = useUsdtAllowance(address, PREDICTION_MARKET_ADDRESS);
  const {
    approve: approveUsdt,
    txHash: approveTxHash,
    isWriting: approveWriting,
    isConfirming: approveConfirming,
    isConfirmed: approveConfirmed,
    error: approveError,
    reset: resetApprove,
  } = useUsdtApprove();

  useTxNotifier(
    approveTxHash,
    approveConfirming,
    approveConfirmed,
    approveError as Error | null,
    "USDT Approve",
  );

  const stats = creationStats || { dailyCount: 0, maxPerDay: 3, creationFee: 10, balance: 0 };
  const hasPredictionContract = PREDICTION_MARKET_ADDRESS !== '0x0000000000000000000000000000000000000000';
  const canCreate = stats.dailyCount < stats.maxPerDay;
  const contractFeeDisplay = useMemo(() => {
    if (feeLoading) return '...';
    if (!hasPredictionContract) return 'N/A';
    return Number(feeUSDT || '0').toFixed(4);
  }, [feeLoading, hasPredictionContract, feeUSDT]);
  const isProcessing = createWriting || createConfirming || syncing || approveWriting || approveConfirming;
  const titleLength = title.length;
  const titleValid = titleLength >= 10 && titleLength <= 200;

  useTxNotifier(
    createTxHash,
    createConfirming,
    createConfirmed,
    createError as Error | null,
    "Create market",
  );

  const setQuickTime = (hours: number) => {
    setEndTime(Date.now() + hours * 3600000);
  };

  const addOption = () => {
    if (options.length >= 10) return;
    setOptions([...options, { label: '', color: OPTION_COLORS[options.length % OPTION_COLORS.length] }]);
  };

  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const updateOption = (index: number, field: keyof OptionInput, value: string) => {
    const updated = [...options];
    updated[index] = { ...updated[index], [field]: value };
    setOptions(updated);
  };

  const multiOptionsValid = marketType === 'binary' || (
    options.length >= 2 &&
    options.length <= 10 &&
    options.every((o) => o.label.trim().length > 0)
  );
  const multiOnChainSupported = false;
  const resolutionRuleValid = resolutionType !== 'manual' || resolutionRule.trim().length >= 10;
  const autoResolutionValid = resolutionType === 'manual' || (
    oraclePair.trim().length > 0 &&
    Number.isFinite(Number(targetPrice)) &&
    Number(targetPrice) > 0
  );

  useEffect(() => {
    if (!createConfirmed || !createTxHash || createdMarketId == null) return;
    if (lastSyncedTxHashRef.current === createTxHash) return;

    const pendingPayload = pendingPayloadRef.current;
    if (!pendingPayload) {
      toast.error('链上创建成功，但本地同步参数丢失，请刷新后重试');
      return;
    }

    const capturedFee = feeAtSubmitRef.current; // P0-2 fix: use captured fee

    setSyncing(true);
    void createUserMarketRecord({
      ...pendingPayload,
      onChainMarketId: createdMarketId.toString(),
      createTxHash,
      onChainCreationFee: Number(capturedFee),
    })
      .then(() => {
        lastSyncedTxHashRef.current = createTxHash;
        toast.success(t('market.submitForReview'));
        setTitle('');
        setDescription('');
        setResolutionType('manual');
        setResolutionRule('');
        setResolutionSourceUrl('');
        setOraclePair('');
        setTargetPrice('');
        setResolutionDelayHours(1);
        setOptions([
          { label: '', color: OPTION_COLORS[0] },
          { label: '', color: OPTION_COLORS[1] },
        ]);
        pendingPayloadRef.current = null;
        resetCreateUserMarket();
        onSuccess?.();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : t('createMarket.createFailed');
        toast.error(`链上成功，但后端同步失败: ${message}`);
        const scanUrl = getBscScanUrl(chainId);
        window.open(`${scanUrl}/tx/${createTxHash}`, "_blank");
      })
      .finally(() => {
        setSyncing(false);
      });
  }, [
    createConfirmed,
    createTxHash,
    createdMarketId,
    t,
    chainId,
    onSuccess,
    resetCreateUserMarket,
  ]); // P0-2 fix: removed feeUSDT dependency

  // P1-2 fix: Handle approve confirmation and auto-trigger market creation
  useEffect(() => {
    if (approveConfirmed && approveTxHash && pendingPayloadRef.current) {
      resetApprove();
      void refetchAllowance();

      // Now trigger the actual market creation
      const payload = pendingPayloadRef.current;
      const endTimeUnix = BigInt(Math.floor(payload.endTime / 1000));
      createUserMarketOnChain(payload.title, endTimeUnix, 0n, feeWei);
    }
  }, [approveConfirmed, approveTxHash, refetchAllowance, resetApprove, createUserMarketOnChain, feeWei]);

  const handleCreate = () => {
    if (!titleValid) {
      toast.error(t('createMarket.titleLengthError'));
      return;
    }
    if (!category) {
      toast.error(t('createMarket.selectCategory'));
      return;
    }
    if (marketType === 'multi' && !multiOnChainSupported) {
      toast.error('当前链上主流程仅支持二元市场（YES/NO）');
      return;
    }
    if (marketType === 'multi' && !multiOptionsValid) {
      toast.error(t('createMarket.optionLabelRequired'));
      return;
    }
    if (!resolutionRuleValid) {
      toast.error('请填写至少10个字符的判定规则');
      return;
    }
    if (!autoResolutionValid) {
      toast.error('价格类自动结算需要 oracle pair 和 target price');
      return;
    }
    if (stats.dailyCount >= stats.maxPerDay) {
      toast.error(t('createMarket.dailyLimitReached'));
      return;
    }
    if (isProcessing) {
      return;
    }
    // Fee check only relevant when contract is configured
    if (hasPredictionContract && feeLoading) {
      toast.error('正在读取链上创建费用，请稍后再试');
      return;
    }
    if (!address) {
      toast.error('请先连接钱包');
      return;
    }

    const safeDelayHours = Math.min(72, Math.max(1, Math.floor(Number(resolutionDelayHours) || 1)));
    const payload: PendingMarketPayload = {
      title: title.trim(),
      description: description.trim(),
      category,
      endTime,
      marketType,
      options: marketType === 'multi' ? options.map((o) => ({ label: o.label.trim(), color: o.color })) : undefined,
      resolutionType,
      oraclePair: resolutionType === 'manual' ? undefined : oraclePair.trim(),
      targetPrice: resolutionType === 'manual' ? undefined : Number(targetPrice),
      resolutionRule: resolutionRule.trim(),
      resolutionSourceUrl: resolutionSourceUrl.trim() || undefined,
      resolutionTimeUtc: endTime + safeDelayHours * 3600000,
    };
    pendingPayloadRef.current = payload;
    feeAtSubmitRef.current = feeUSDT || '0'; // P0-2 fix: capture fee at submit time

    // P1-2 fix: Check allowance and approve if needed
    if (allowanceRaw < feeWei) {
      toast.info('需要先授权 USDT，正在发起授权交易...');
      approveUsdt(PREDICTION_MARKET_ADDRESS, feeWei);
      return;
    }

    // Allowance is sufficient, proceed with market creation
    const endTimeUnix = BigInt(Math.floor(endTime / 1000));
    createUserMarketOnChain(payload.title, endTimeUnix, 0n, feeWei);
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
      {/* Proposal Info Bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-secondary border border-border p-3">
          <div className="text-muted-foreground text-xs mb-1">{t('createMarket.submissionType')}</div>
          <div className="text-emerald-400 font-bold font-mono">{t('createMarket.freeProposal')}</div>
        </div>
        <div className="bg-secondary border border-border p-3">
          <div className="text-muted-foreground text-xs mb-1">{t('createMarket.reviewStatus')}</div>
          <div className="text-blue-400 font-bold font-mono">{t('createMarket.adminReview')}</div>
        </div>
        <div className="bg-secondary border border-border p-3">
          <div className="text-muted-foreground text-xs mb-1">{t('createMarket.createdToday')}</div>
          <div className={`font-bold font-mono ${stats.dailyCount >= stats.maxPerDay ? 'text-red-400' : 'text-foreground'}`}>
            {stats.dailyCount} / {stats.maxPerDay}
          </div>
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm text-muted-foreground mb-2">
          {t('createMarket.marketTitle')} <span className={`font-mono ${titleValid ? 'text-emerald-400' : 'text-muted-foreground'}`}>({titleLength}/200)</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('createMarket.titlePlaceholder')}
          maxLength={200}
          className="w-full bg-input-background border border-border text-foreground text-sm py-3 px-4 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground"
        />
        {titleLength > 0 && titleLength < 10 && (
          <p className="text-red-400 text-xs mt-1">{t('createMarket.titleTooShort')}</p>
        )}
      </div>

      {/* Market Type */}
      <div>
        <label className="block text-sm text-muted-foreground mb-3">{t('createMarket.marketTypeLabel')}</label>
        <div className="flex gap-2">
          <button
            onClick={() => setMarketType('binary')}
            className={`flex-1 py-2.5 text-sm font-medium border transition-colors ${
              marketType === 'binary'
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-border bg-secondary text-muted-foreground hover:border-border'
            }`}
          >
            {t('createMarket.binary')}
          </button>
          <button
            onClick={() => setMarketType('multi')}
            disabled={!multiOnChainSupported}
            className={`flex-1 py-2.5 text-sm font-medium border transition-colors ${
              marketType === 'multi'
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-border bg-secondary text-muted-foreground hover:border-border'
            }`}
          >
            {t('createMarket.multi')}{!multiOnChainSupported ? ' (Soon)' : ''}
          </button>
        </div>
        {!multiOnChainSupported && (
          <p className="mt-2 text-xs text-amber-400">
            当前链上演示版本仅开放二元市场，避免链上/结算语义不一致。
          </p>
        )}
      </div>

      {/* Multi-Option Inputs */}
      {marketType === 'multi' && (
        <div>
          <label className="block text-sm text-muted-foreground mb-3">
            {t('createMarket.optionsLabel')} <span className="text-muted-foreground font-mono">({options.length}/10)</span>
          </label>
          <div className="space-y-2">
            {options.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="color"
                  value={opt.color}
                  onChange={(e) => updateOption(idx, 'color', e.target.value)}
                  className="w-8 h-8 border border-border bg-transparent cursor-pointer shrink-0"
                  title={t('createMarket.optionColor')}
                />
                <input
                  type="text"
                  value={opt.label}
                  onChange={(e) => updateOption(idx, 'label', e.target.value)}
                  placeholder={t('createMarket.optionLabelPlaceholder', { n: idx + 1 })}
                  maxLength={50}
                  className="flex-1 bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground"
                />
                <button
                  onClick={() => removeOption(idx)}
                  disabled={options.length <= 2}
                  className="p-2 text-muted-foreground hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title={t('createMarket.removeOption')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          {options.length < 10 && (
            <button
              onClick={addOption}
              className="mt-2 flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('createMarket.addOption')}
            </button>
          )}
          {options.length < 2 && (
            <p className="text-red-400 text-xs mt-1">{t('createMarket.minOptions')}</p>
          )}
        </div>
      )}

      {/* Description */}
      <div>
        <label className="block text-sm text-muted-foreground mb-2">{t('createMarket.description')}</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('createMarket.descPlaceholder')}
          rows={3}
          className="w-full bg-input-background border border-border text-foreground text-sm py-3 px-4 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground resize-none"
        />
      </div>

      {/* Resolution Config */}
      <div className="space-y-3 border border-border p-4 bg-secondary/20">
        <div className="text-sm font-medium text-foreground">结算规则（黑客松可复核）</div>
        <div className="flex gap-2">
          <button
            onClick={() => setResolutionType('manual')}
            className={`flex-1 py-2 text-xs border transition-colors ${
              resolutionType === 'manual'
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-border bg-secondary text-muted-foreground'
            }`}
          >
            实体事件（提案/挑战/终裁）
          </button>
          <button
            onClick={() => setResolutionType('price_above')}
            className={`flex-1 py-2 text-xs border transition-colors ${
              resolutionType === 'price_above'
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-border bg-secondary text-muted-foreground'
            }`}
          >
            价格 ≥ 目标
          </button>
          <button
            onClick={() => setResolutionType('price_below')}
            className={`flex-1 py-2 text-xs border transition-colors ${
              resolutionType === 'price_below'
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-border bg-secondary text-muted-foreground'
            }`}
          >
            价格 &lt; 目标
          </button>
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">判定规则文本（必须可复核）</label>
          <textarea
            value={resolutionRule}
            onChange={(e) => setResolutionRule(e.target.value)}
            rows={2}
            placeholder="示例：以官方赛事页面最终成绩为准；若官方修正结果，以修正版为准。"
            className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground resize-none"
          />
          {!resolutionRuleValid && (
            <p className="text-red-400 text-xs mt-1">至少 10 个字符</p>
          )}
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">数据源 URL（可选但推荐）</label>
          <input
            type="url"
            value={resolutionSourceUrl}
            onChange={(e) => setResolutionSourceUrl(e.target.value)}
            placeholder="https://..."
            className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground"
          />
        </div>

        {resolutionType !== 'manual' && (
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Oracle Pair / Token</label>
              <input
                type="text"
                value={oraclePair}
                onChange={(e) => setOraclePair(e.target.value)}
                placeholder="BTC/USD 或 0x..."
                className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Target Price</label>
              <input
                type="number"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                min={0}
                step="any"
                placeholder="例如 700"
                className="w-full bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-muted-foreground"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-muted-foreground mb-1">预计结算延迟（结束后小时）</label>
          <input
            type="number"
            min={1}
            max={72}
            value={resolutionDelayHours}
            onChange={(e) => setResolutionDelayHours(Number(e.target.value))}
            className="w-28 bg-input-background border border-border text-foreground text-sm py-2 px-3 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Category */}
      <div>
        <label className="block text-sm text-muted-foreground mb-3">{t('createMarket.categoryLabel')}</label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {CATEGORY_IDS.map((id) => (
            <button
              key={id}
              onClick={() => setCategory(id)}
              className={`text-left p-3 border transition-colors ${
                category === id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-border bg-secondary hover:border-border'
              }`}
            >
              <div className="text-xs text-foreground">{t(`createMarket.categories.${id}`)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* End Time */}
      <div>
        <label className="block text-sm text-muted-foreground mb-3">
          <Clock className="w-4 h-4 inline mr-1" />
          {t('createMarket.endTime')}
        </label>
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_TIME_KEYS.map((qt) => (
            <button
              key={qt.key}
              onClick={() => setQuickTime(qt.hours)}
              className="px-3 py-1.5 text-xs border border-border bg-secondary hover:border-blue-500 hover:text-blue-400 text-muted-foreground transition-colors"
            >
              {t(`createMarket.${qt.key}`)}
            </button>
          ))}
        </div>
        <div className="text-sm text-muted-foreground">
          {formatEndTime(endTime)} <span className="text-muted-foreground">({t('createMarket.daysHoursLater', { days: daysLeft, hours: hoursLeft })})</span>
        </div>
      </div>

      {/* Preview Card */}
      {title && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="bg-card border border-border p-4"
        >
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <Eye className="w-3.5 h-3.5" />
            {t('createMarket.preview')}
          </div>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h4 className="text-foreground font-medium text-sm mb-1">{title}</h4>
              {description && <p className="text-muted-foreground text-xs mb-2">{description}</p>}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="px-1.5 py-0.5 border border-border bg-secondary">
                  {t(`createMarket.categories.${category}`)}
                </span>
                <span>{t('createMarket.daysHoursEnd', { days: daysLeft, hours: hoursLeft })}</span>
              </div>
            </div>
            <div className="text-center shrink-0">
              {marketType === 'multi' ? (
                <div className="flex flex-wrap gap-1">
                  {options.filter((o) => o.label.trim()).map((opt, i) => (
                    <span key={i} className="text-xs font-mono font-bold px-1.5 py-0.5 border rounded" style={{ color: opt.color, borderColor: `${opt.color}40` }}>
                      {Math.round(100 / Math.max(options.length, 1))}%
                    </span>
                  ))}
                </div>
              ) : (
                <>
                  <div className="text-lg font-bold text-foreground font-mono">50%</div>
                  <div className="text-muted-foreground text-xs">{t('market.yes')}</div>
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Warnings */}
      {!canCreate && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {t('createMarket.dailyLimitReached')}
        </div>
      )}

      {/* Create Button */}
      <button
        onClick={handleCreate}
        disabled={isProcessing || !canCreate || !titleValid || !multiOptionsValid || !resolutionRuleValid || !autoResolutionValid}
        className="w-full py-4 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-black font-bold text-lg transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="w-5 h-5" />
        {isProcessing ? t('createMarket.creating') : t('createMarket.createButton')}
      </button>

      <p className="text-muted-foreground text-xs text-center">
        {t('createMarket.footer', { max: stats.maxPerDay })}
      </p>
    </div>
  );
}
