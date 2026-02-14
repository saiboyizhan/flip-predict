import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { useSwarmStore } from '@/app/stores/useSwarmStore';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { TrendingUp, Clock } from 'lucide-react';

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: {
    direction_correct: boolean | null;
    final_consensus: number;
  };
}

function CustomDot({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined || !payload) return null;

  let fill = '#6b7280'; // gray for pending
  if (payload.direction_correct === true) fill = '#10b981'; // green
  else if (payload.direction_correct === false) fill = '#ef4444'; // red

  return (
    <circle cx={cx} cy={cy} r={5} fill={fill} stroke="none" />
  );
}

export default function SwarmHistory() {
  const { t } = useTranslation();
  const historyData = useSwarmStore((s) => s.historyData);
  const historyLoading = useSwarmStore((s) => s.historyLoading);

  const chartData = useMemo(() => {
    return [...historyData]
      .reverse()
      .map((item, idx) => ({
        index: idx + 1,
        final_consensus: item.final_consensus,
        direction_correct: item.direction_correct,
        token_name: item.token_name,
        created_at: item.created_at,
      }));
  }, [historyData]);

  if (historyLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Loading history...</span>
        </div>
      </div>
    );
  }

  if (chartData.length === 0) return null;

  const correctCount = chartData.filter(d => d.direction_correct === true).length;
  const verifiedCount = chartData.filter(d => d.direction_correct !== null).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-card border border-border rounded-xl p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-500" />
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t('swarm.history', 'Analysis History')}
          </h3>
        </div>
        {verifiedCount > 0 && (
          <span className="text-xs font-mono text-muted-foreground">
            {correctCount}/{verifiedCount} correct
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-[10px] text-muted-foreground">Correct</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-[10px] text-muted-foreground">Wrong</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-gray-500" />
          <span className="text-[10px] text-muted-foreground">Pending</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
          <XAxis
            dataKey="index"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: '#6b7280' }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
          />
          <ReferenceLine y={50} stroke="#374151" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              fontSize: '11px',
              color: '#e5e7eb',
            }}
            formatter={(value: number) => [`Score: ${value}`, '']}
            labelFormatter={(label: number) => {
              const item = chartData[label - 1];
              return item ? `${item.token_name}` : '';
            }}
          />
          <Line
            type="monotone"
            dataKey="final_consensus"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={<CustomDot />}
            activeDot={{ r: 7, stroke: '#3b82f6', strokeWidth: 2, fill: '#1f2937' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
