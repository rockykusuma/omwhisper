import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface TranscriptionEntry {
  id: number;
  text: string;
  duration_seconds: number;
  model_used: string;
  created_at: string;
  word_count: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Props {}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
}

export default function TranscriptionHistory(_props: Props) {
  const [entries, setEntries] = useState<TranscriptionEntry[]>([]);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [isLicensed, setIsLicensed] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE = 30;

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  const loadHistory = useCallback(async (newOffset = 0, searchQuery = "") => {
    try {
      let result: TranscriptionEntry[];
      if (searchQuery.trim()) {
        result = await invoke<TranscriptionEntry[]>("search_history", { query: searchQuery });
        setHasMore(false);
      } else {
        result = await invoke<TranscriptionEntry[]>("get_history", { limit: PAGE, offset: newOffset });
        if (newOffset === 0) {
          setEntries(result);
        } else {
          setEntries((prev) => [...prev, ...result]);
        }
        setHasMore(result.length === PAGE);
        setOffset(newOffset + result.length);
        return;
      }
      setEntries(result);
      setOffset(0);
    } catch (e) {
      console.error("Failed to load history:", e);
    }
  }, []);

  useEffect(() => {
    invoke<string>("get_license_status").then((s) => setIsLicensed(s === "Licensed" || s === "GracePeriod")).catch(() => {});
    loadHistory(0, "");
  }, [loadHistory]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadHistory(0, query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, loadHistory]);

  async function handleDelete(id: number) {
    try {
      await invoke("cmd_delete_transcription", { id });
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (expandedId === id) setExpandedId(null);
      showToast("Deleted");
    } catch (e) {
      console.error("Delete failed:", e);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("✓ Copied");
    } catch {
      // fallback: use tauri paste_transcription just to copy
      await invoke("paste_transcription", { text }).catch(() => {});
      showToast("✓ Copied");
    }
  }

  async function handleExport(format: string) {
    try {
      const content = await invoke<string>("cmd_export_history", { format });
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `omwhisper-history.${format === "json" ? "json" : format === "markdown" ? "md" : "txt"}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("✓ Exported");
    } catch (e) {
      console.error("Export failed:", e);
    }
  }

  async function handleClearAll() {
    try {
      await invoke("cmd_clear_history");
      setEntries([]);
      setShowConfirmClear(false);
      showToast("History cleared");
    } catch (e) {
      console.error("Clear failed:", e);
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white/90">History</h2>

        {/* Export + Clear */}
        <div className="flex items-center gap-2">
          {isLicensed ? (
            <div className="relative group">
              <button
                className="text-white/30 hover:text-white/70 transition-colors text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 cursor-pointer"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
              >
                Export ▾
              </button>
              <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-[#0d1a14] border border-white/10 rounded-xl overflow-hidden shadow-xl z-10 min-w-[100px]">
                {["txt", "markdown", "json"].map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => handleExport(fmt)}
                    className="px-4 py-2 text-xs text-white/60 hover:text-white hover:bg-white/5 text-left cursor-pointer"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <span
              className="text-white/20 text-xs px-3 py-1.5 rounded-lg border border-white/[0.05] cursor-default"
              title="Upgrade to export"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              🔒 Export
            </span>
          )}
          <button
            onClick={() => setShowConfirmClear(true)}
            className="text-red-400/50 hover:text-red-400 transition-colors text-xs px-3 py-1.5 rounded-lg border border-red-500/10 hover:border-red-500/30 cursor-pointer"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcriptions…"
          className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-2.5 text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-emerald-500/40 transition-colors"
          style={{ fontFamily: "'DM Sans', sans-serif" }}
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 cursor-pointer text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Entry list */}
      <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 200px)" }}>
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-50 select-none">
            <span className="text-5xl text-white/10">🕐</span>
            <p className="text-white/25 text-sm">
              {query ? "No results found" : "No transcriptions yet"}
            </p>
            {!query && (
              <p className="text-white/15 text-xs text-center max-w-xs leading-relaxed">
                Start a recording with ⌘⇧V and your transcriptions will appear here
              </p>
            )}
          </div>
        ) : (
          entries.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const preview = entry.text.length > 120 ? entry.text.slice(0, 120) + "…" : entry.text;

            return (
              <div
                key={entry.id}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                {/* Entry header */}
                <div
                  className="flex items-start gap-3 p-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-white/75 text-sm leading-relaxed"
                      style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                      {isExpanded ? entry.text : preview}
                    </p>
                    <div
                      className="flex items-center gap-3 mt-2 text-white/25 text-xs"
                      style={{ fontFamily: "'DM Mono', monospace" }}
                    >
                      <span>{formatDate(entry.created_at)}</span>
                      <span>·</span>
                      <span>{entry.word_count} words</span>
                      <span>·</span>
                      <span>{formatDuration(entry.duration_seconds)}</span>
                      <span>·</span>
                      <span className="text-emerald-500/40">{entry.model_used}</span>
                    </div>
                  </div>
                  <span className="text-white/20 text-xs mt-0.5 shrink-0">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>

                {/* Expanded actions */}
                {isExpanded && (
                  <div className="px-4 pb-3 flex items-center gap-2 border-t border-white/[0.04] pt-3">
                    <button
                      onClick={() => handleCopy(entry.text)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                      style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-500/5 text-red-400/60 hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer"
                      style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Load more */}
        {hasMore && !query && (
          <button
            onClick={() => loadHistory(offset, "")}
            className="w-full text-center text-white/30 hover:text-white/60 text-xs py-3 transition-colors cursor-pointer"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Load more
          </button>
        )}
      </div>

      {/* Clear confirmation dialog */}
      {showConfirmClear && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50">
          <div className="bg-[#0d1a14] border border-white/10 rounded-2xl p-6 max-w-xs w-full mx-4 shadow-2xl">
            <h3
              className="text-white/90 font-semibold mb-2"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Clear all history?
            </h3>
            <p
              className="text-white/40 text-sm mb-5"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              This will permanently delete all transcription history. This can't be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmClear(false)}
                className="flex-1 py-2 rounded-xl border border-white/10 text-white/50 hover:text-white/80 text-sm transition-colors cursor-pointer"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                className="flex-1 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 text-sm transition-colors cursor-pointer"
                style={{ fontFamily: "'DM Sans', sans-serif" }}
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
