import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../hooks/useToast";
import { logger } from "../utils/logger";
import type { TranscriptionEntry } from "../types";

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

export default function TranscriptionHistory() {
  const [entries, setEntries] = useState<TranscriptionEntry[]>([]);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { toast, showToast } = useToast();
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE = 30;
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

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
      logger.error("Failed to load history:", e);
    }
  }, []);

  useEffect(() => {
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
      logger.error("Delete failed:", e);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("✓ Copied");
    } catch {
      // fallback: use tauri paste_transcription just to copy
      await invoke("paste_transcription", { text }).catch((e) => logger.debug("paste_transcription:", e));
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
      logger.error("Export failed:", e);
    }
  }

  async function handleClearAll() {
    try {
      await invoke("cmd_clear_history");
      setEntries([]);
      setShowConfirmClear(false);
      showToast("History cleared");
    } catch (e) {
      logger.error("Clear failed:", e);
    }
  }

  async function handleDeleteSelected() {
    const deletedCount = selected.size;
    for (const id of selected) {
      await invoke("cmd_delete_transcription", { id }).catch((e) => logger.error("Delete failed:", e));
    }
    setSelected(new Set());
    setSelecting(false);
    await loadHistory(0, "");
    showToast(`Deleted ${deletedCount}`);
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white/90">History</h2>

        {/* Export + Clear */}
        <div className="flex items-center gap-2">
          {!selecting && (
            <button
              onClick={() => setSelecting(true)}
              className="text-white/50 hover:text-white/70 transition-colors text-xs px-3 py-1.5 rounded-lg cursor-pointer font-sans"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
            >
              Select
            </button>
          )}
          <div className="relative group">
            <button
              className="text-white/50 hover:text-white/70 transition-colors text-xs px-3 py-1.5 rounded-lg cursor-pointer font-sans"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
            >
              Export ▾
            </button>
            <div
              className="absolute right-0 top-full mt-2 hidden group-hover:flex flex-col rounded-xl overflow-hidden z-10 min-w-[100px]"
              style={{ background: "var(--bg)", boxShadow: "var(--nm-raised)" }}
            >
              {["txt", "markdown", "json"].map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => handleExport(fmt)}
                  className="px-4 py-2 text-xs text-white/55 hover:text-white/80 text-left cursor-pointer font-sans transition-colors"
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setShowConfirmClear(true)}
            className="text-red-400/45 hover:text-red-400 transition-colors text-xs px-3 py-1.5 rounded-lg cursor-pointer font-sans"
            style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
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
          className="w-full rounded-xl px-4 py-2.5 text-white/75 text-sm placeholder:text-white/25 outline-none font-sans"
          style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white/60 cursor-pointer text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Entry list */}
      <div className="space-y-2 overflow-y-auto pr-1 max-h-[calc(100vh-200px)]">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-50 select-none">
            <span className="text-5xl text-white/10">🕐</span>
            <p className="text-white/40 text-sm">
              {query ? "No results found" : "No transcriptions yet"}
            </p>
            {!query && (
              <p className="text-white/50 text-xs text-center max-w-xs leading-relaxed">
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
                className="rounded-xl transition-all duration-200"
                style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
              >
                {/* Entry header */}
                <div
                  className="flex items-start gap-3 p-4 cursor-pointer"
                  onClick={() => {
                    if (selecting) {
                      toggleSelect(entry.id);
                    } else {
                      setExpandedId(isExpanded ? null : entry.id);
                    }
                  }}
                >
                  {selecting && (
                    <div
                      className="shrink-0 w-4 h-4 rounded border flex items-center justify-center mr-2"
                      style={{
                        borderColor: selected.has(entry.id) ? "var(--accent)" : "color-mix(in srgb, var(--t1) 25%, transparent)",
                        background: selected.has(entry.id) ? "var(--accent)" : "transparent",
                      }}
                    >
                      {selected.has(entry.id) && (
                        <span className="text-[9px] font-bold" style={{ color: "#0a0f0d" }}>✓</span>
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-white/75 text-sm leading-relaxed font-sans"
                    >
                      {isExpanded ? entry.text : preview}
                    </p>
                    <div
                      className="flex items-center gap-3 mt-2 text-white/40 text-xs font-mono"
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
                  <span className="text-white/35 text-xs mt-0.5 shrink-0">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>

                {/* Expanded actions */}
                {isExpanded && (
                  <div
                    className="px-4 pb-3 flex items-center gap-2 pt-3"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <button
                      onClick={() => handleCopy(entry.text)}
                      className="text-xs px-3 py-1.5 rounded-lg text-emerald-400 transition-all cursor-pointer font-sans"
                      style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="text-xs px-3 py-1.5 rounded-lg text-red-400/55 hover:text-red-400 transition-all cursor-pointer font-sans"
                      style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
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
            className="w-full text-center text-white/50 hover:text-white/60 text-xs py-3 transition-colors cursor-pointer font-sans"
          >
            Load more
          </button>
        )}
      </div>

      {selecting && (
        <div
          className="sticky bottom-0 left-0 right-0 flex items-center justify-between gap-3 px-4 py-3 mt-2 rounded-2xl"
          style={{
            background: "var(--bg)",
            boxShadow: "var(--nm-raised)",
            border: "1px solid color-mix(in srgb, var(--t1) 8%, transparent)",
          }}
        >
          <span className="text-xs font-mono" style={{ color: "var(--t3)" }}>
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSelecting(false); setSelected(new Set()); }}
              className="text-xs px-3 py-1.5 rounded-lg cursor-pointer font-sans"
              style={{ color: "var(--t3)", background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={selected.size === 0}
              className="text-xs px-3 py-1.5 rounded-lg cursor-pointer font-sans disabled:opacity-40"
              style={{ color: "rgb(248,113,113)", background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
            >
              Delete selected
            </button>
          </div>
        </div>
      )}

      {/* Clear confirmation dialog */}
      {showConfirmClear && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-black/50">
          <div className="rounded-2xl p-6 max-w-xs w-full mx-4" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised), 0 0 50px rgba(0,0,0,0.5)" }}>
            <h3 className="text-white/90 font-semibold mb-2 font-sans">
              Clear all history?
            </h3>
            <p className="text-white/40 text-sm mb-5 font-sans">
              This will permanently delete all transcription history. This can't be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmClear(false)}
                className="flex-1 py-2 rounded-xl text-white/55 hover:text-white/75 text-sm transition-colors cursor-pointer font-sans"
                style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                className="flex-1 py-2 rounded-xl text-red-400/70 hover:text-red-400 text-sm transition-colors cursor-pointer font-sans"
                style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
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
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-emerald-400 text-xs font-mono pointer-events-none z-50"
          style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm), 0 0 16px rgba(52,211,153,0.15)" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
