"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  AreaChart,
  Area,
  ComposedChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { fetchPriceHistory, type PricePoint } from "@/app/services/api";
import type { MarketOption } from "@/app/types/market.types";

const INTERVALS = [
  { key: "1m", label: "1M" },
  { key: "5m", label: "5M" },
  { key: "15m", label: "15M" },
  { key: "30m", label: "30M" },
  { key: "1h", label: "1H" },
  { key: "4h", label: "4H" },
  { key: "12h", label: "12H" },
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
] as const;

function formatTime(bucket: string, interval: string): string {
  if (!bucket) return "";
  if (interval === "1w") return bucket;
  const d = new Date(bucket.replace(" ", "T") + (bucket.includes("Z") ? "" : "Z"));
  if (isNaN(d.getTime())) return bucket;
  if (interval === "1d") return `${d.getMonth() + 1}/${d.getDate()}`;
  if (["1m", "5m", "15m", "30m"].includes(interval)) {
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:00`;
}

// Convert local datetime-local value to UTC string for API
function toUTCString(localDatetime: string): string {
  if (!localDatetime) return "";
  const d = new Date(localDatetime);
  return d.toISOString().replace("T", " ").replace("Z", "");
}

// Get default "from" date (7 days ago) in local datetime-local format
function defaultFrom(): string {
  const d = new Date(Date.now() - 7 * 24 * 3600000);
  return d.toISOString().slice(0, 16);
}

// Get default "to" date (now) in local datetime-local format
function defaultTo(): string {
  return new Date().toISOString().slice(0, 16);
}

interface PriceChartProps {
  marketId: string;
  marketType?: "binary" | "multi";
  options?: MarketOption[];
}

export function PriceChart({ marketId, marketType, options }: PriceChartProps) {
  const { t } = useTranslation();
  const [timeInterval, setTimeInterval] = useState("1h");
  const [data, setData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  const load = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const from = customMode ? toUTCString(fromDate) : undefined;
      const to = customMode ? toUTCString(toDate) : undefined;
      const res = await fetchPriceHistory(marketId, timeInterval, from, to);
      if (!signal?.cancelled) setData(res.history);
    } catch {
      if (!signal?.cancelled) setError("LOAD_FAILED");
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [marketId, timeInterval, customMode, fromDate, toDate]);

  useEffect(() => {
    const signal = { cancelled: false };
    load(signal);
    const timer = window.setInterval(() => { load(signal); }, 30000);
    return () => {
      signal.cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  const handlePresetClick = (key: string) => {
    setCustomMode(false);
    setTimeInterval(key);
  };

  const toggleCustom = () => {
    setCustomMode((prev) => !prev);
  };

  return (
    <div>
      {/* Interval buttons row */}
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {INTERVALS.map((iv) => (
          <button
            key={iv.key}
            onClick={() => handlePresetClick(iv.key)}
            className={`px-3 py-1 text-xs font-medium transition-colors rounded-sm ${
              !customMode && timeInterval === iv.key
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                : "bg-muted/50 text-muted-foreground border border-border/50 hover:text-foreground"
            }`}
          >
            {iv.label}
          </button>
        ))}
        <div className="w-px h-5 bg-border/50 mx-1" />
        <button
          onClick={toggleCustom}
          className={`px-3 py-1 text-xs font-medium transition-colors rounded-sm ${
            customMode
              ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
              : "bg-muted/50 text-muted-foreground border border-border/50 hover:text-foreground"
          }`}
        >
          {t('priceChart.custom')}
        </button>
      </div>

      {/* Custom date range picker */}
      {customMode && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">{t('priceChart.from')}</span>
            <input
              type="datetime-local"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-input-background border border-border rounded px-2 py-1 text-xs text-muted-foreground outline-none focus:border-blue-500/50 [color-scheme:dark]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">{t('priceChart.to')}</span>
            <input
              type="datetime-local"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-input-background border border-border rounded px-2 py-1 text-xs text-muted-foreground outline-none focus:border-blue-500/50 [color-scheme:dark]"
            />
          </div>
          <select
            value={timeInterval}
            onChange={(e) => setTimeInterval(e.target.value)}
            className="bg-input-background border border-border rounded px-2 py-1 text-xs text-muted-foreground outline-none focus:border-blue-500/50 [color-scheme:dark]"
          >
            {INTERVALS.map((iv) => (
              <option key={iv.key} value={iv.key}>
                {t('priceChart.interval', { label: iv.label })}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Chart */}
      {loading ? (
        <div className="h-64 bg-secondary/50 border border-border/50 animate-pulse flex items-center justify-center rounded">
          <div className="text-muted-foreground text-sm">{t('priceChart.loading')}</div>
        </div>
      ) : error ? (
        <div className="h-64 bg-secondary/50 border border-border/50 flex items-center justify-center rounded">
          <div className="text-red-400 text-sm">{t('priceChart.loadFailed')}</div>
        </div>
      ) : data.length === 0 ? (
        <div className="h-64 bg-secondary/50 border border-border/50 flex items-center justify-center rounded">
          <div className="text-center">
            <p className="text-muted-foreground text-sm">{t('priceChart.noHistory')}</p>
            <p className="text-muted-foreground text-xs mt-1">{t('priceChart.tradeToGenerate')}</p>
          </div>
        </div>
      ) : marketType === "multi" && options && options.length > 0 ? (
        /* Multi-option line chart: one line per option */
        <ResponsiveContainer width="100%" height={256}>
          <LineChart
            data={(() => {
              // Group option_price_history data by timestamp into combined rows
              const timeMap = new Map<string, Record<string, number>>();
              if (!data || !Array.isArray(data)) return [];
              for (const point of data as any[]) {
                const ts = point.timestamp ? new Date(point.timestamp).toISOString() : point.time_bucket;
                if (!timeMap.has(ts)) timeMap.set(ts, { time_bucket: ts } as any);
                const row = timeMap.get(ts)!;
                (row as any).time_bucket = ts;
                const label = point.label || point.option_id;
                (row as any)[label] = Number(point.price) || 0;
              }
              return Array.from(timeMap.values());
            })()}
            margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="time_bucket"
              tickFormatter={(v) => formatTime(v, timeInterval)}
              tick={{ fill: "#71717a", fontSize: 10 }}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={{ fill: "#71717a", fontSize: 10 }}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: "4px",
                fontSize: "12px",
              }}
              labelFormatter={(v) => formatTime(v as string, timeInterval)}
              formatter={(value: number, name: string) => {
                return [`${(value * 100).toFixed(1)}%`, name];
              }}
            />
            <Legend />
            {options.map((opt) => (
              <Line
                key={opt.id}
                type="monotone"
                dataKey={opt.label}
                stroke={opt.color}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="yesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="noGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="time_bucket"
              tickFormatter={(v) => formatTime(v, timeInterval)}
              tick={{ fill: "#71717a", fontSize: 10 }}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            {/* Left Y-axis: price percentage */}
            <YAxis
              yAxisId="price"
              domain={[0, 1]}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={{ fill: "#71717a", fontSize: 10 }}
              axisLine={{ stroke: "#3f3f46" }}
              tickLine={false}
            />
            {/* Right Y-axis: volume (hidden axis, just for scaling) */}
            <YAxis
              yAxisId="volume"
              orientation="right"
              hide
              domain={[0, (dataMax: number) => Math.max(dataMax * 4, 1)]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: "4px",
                fontSize: "12px",
              }}
              labelFormatter={(v) => formatTime(v as string, timeInterval)}
              formatter={(value: number, name: string) => {
                if (name === "yes_price") return [`${(value * 100).toFixed(1)}%`, t('market.yes')];
                if (name === "no_price") return [`${(value * 100).toFixed(1)}%`, t('market.no')];
                if (name === "volume") return [`$${value.toFixed(0)}`, t('priceChart.volume', { defaultValue: 'Volume' })];
                return [value, name];
              }}
            />
            {/* Volume bars at the bottom */}
            <Bar
              yAxisId="volume"
              dataKey="volume"
              fill="#3b82f6"
              fillOpacity={0.2}
              stroke="#3b82f6"
              strokeOpacity={0.3}
              barSize={8}
              isAnimationActive={false}
            />
            {/* YES price area */}
            <Area
              yAxisId="price"
              type="monotone"
              dataKey="yes_price"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#yesGrad)"
              dot={false}
            />
            {/* NO price area */}
            <Area
              yAxisId="price"
              type="monotone"
              dataKey="no_price"
              stroke="#ef4444"
              strokeWidth={2}
              fill="url(#noGrad)"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
