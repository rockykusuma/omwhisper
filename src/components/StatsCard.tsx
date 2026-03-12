import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UsageStats } from "../types";

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(secs)}s`;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface StatItemProps {
  value: string;
  label: string;
}

function StatItem({ value, label }: StatItemProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3">
      <span className="text-white/70 text-sm font-semibold font-mono tabular-nums">{value}</span>
      <span className="text-white/40 text-[10px] font-mono">{label}</span>
    </div>
  );
}

interface Props {
  refreshTrigger?: number;
}

export default function StatsCard({ refreshTrigger }: Props) {
  const [stats, setStats] = useState<UsageStats | null>(null);

  const load = useCallback(async () => {
    const s = await invoke<UsageStats>("get_usage_stats").catch(() => null);
    setStats(s);
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  if (!stats || stats.total_recordings === 0) return null;

  return (
    <div className="flex items-center justify-center divide-x divide-white/[0.05] rounded-2xl border border-white/[0.05] bg-white/[0.02] py-2.5 mx-6">
      <StatItem value={formatCount(stats.total_recordings)} label="recordings" />
      <StatItem value={formatDuration(stats.total_duration_seconds)} label="total time" />
      <StatItem value={formatCount(stats.total_words)} label="words" />
      <StatItem value={stats.recordings_today.toString()} label="today" />
      {stats.streak_days > 1 && (
        <StatItem value={`${stats.streak_days}🔥`} label="day streak" />
      )}
    </div>
  );
}
