"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fetchPriceHistory, type PricePoint } from "@/app/services/api";

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
}

export function PriceChart({ marketId }: PriceChartProps) {
  const { t } = useTranslation();
  const [timeInterval, setTimeInterval] = useState("1h");
  const [data, setData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = customMode ? toUTCString(fromDate) : undefined;
      const to = customMode ? toUTCString(toDate) : undefined;
      const res = await fetchPriceHistory(marketId, timeInterval, from, to);
      setData(res.history);
    } catch (e: any) {
      setError(e.message || "Failed to load price history");
    } finally {
      setLoading(false);
    }
  }, [marketId, timeInterval, customMode, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const timer = window.setInterval(() => { load(); }, 30000);
    return () => window.clearInterval(timer);
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
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                : "bg-zinc-800/50 text-zinc-500 border border-zinc-700/50 hover:text-zinc-300"
            }`}
          >
            {iv.label}
          </button>
        ))}
        <div className="w-px h-5 bg-zinc-700/50 mx-1" />
        <button
          onClick={toggleCustom}
          className={`px-3 py-1 text-xs font-medium transition-colors rounded-sm ${
            customMode
              ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
              : "bg-zinc-800/50 text-zinc-500 border border-zinc-700/50 hover:text-zinc-300"
          }`}
        >
          {t('priceChart.custom')}
        </button>
      </div>

      {/* Custom date range picker */}
      {customMode && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 text-xs">{t('priceChart.from')}</span>
            <input
              type="datetime-local"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 outline-none focus:border-amber-500/50 [color-scheme:dark]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500 text-xs">{t('priceChart.to')}</span>
            <input
              type="datetime-local"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 outline-none focus:border-amber-500/50 [color-scheme:dark]"
            />
          </div>
          <select
            value={timeInterval}
            onChange={(e) => setTimeInterval(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 outline-none focus:border-amber-500/50 [color-scheme:dark]"
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
        <div className="h-64 bg-zinc-950/50 border border-zinc-800/50 animate-pulse flex items-center justify-center rounded">
          <div className="text-zinc-600 text-sm">Loading...</div>
        </div>
      ) : error ? (
        <div className="h-64 bg-zinc-950/50 border border-zinc-800/50 flex items-center justify-center rounded">
          <div className="text-red-400 text-sm">{error}</div>
        </div>
      ) : data.length === 0 ? (
        <div className="h-64 bg-zinc-950/50 border border-zinc-800/50 flex items-center justify-center rounded">
          <div className="text-center">
            <p className="text-zinc-600 text-sm">No price history yet</p>
            <p className="text-zinc-700 text-xs mt-1">Trade to generate data</p>
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={256}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
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
                if (name === "yes_price") return [`${(value * 100).toFixed(1)}%`, "YES"];
                if (name === "no_price") return [`${(value * 100).toFixed(1)}%`, "NO"];
                if (name === "volume") return [`$${value.toFixed(0)}`, "Volume"];
                return [value, name];
              }}
            />
            <Area
              type="monotone"
              dataKey="yes_price"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#yesGrad)"
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="no_price"
              stroke="#ef4444"
              strokeWidth={2}
              fill="url(#noGrad)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
