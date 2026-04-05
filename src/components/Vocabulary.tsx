import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useToast } from "../hooks/useToast";
import { logger } from "../utils/logger";

interface VocabData {
  words: string[];
  replacements: Record<string, string>;
}

export default function Vocabulary() {
  const [data, setData] = useState<VocabData>({ words: [], replacements: {} });
  const [newWord, setNewWord] = useState("");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const { toast, showToast } = useToast(2000);
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [editingWordInput, setEditingWordInput] = useState("");
  const [editingReplacement, setEditingReplacement] = useState<string | null>(null);
  const [editingFromInput, setEditingFromInput] = useState("");
  const [editingToInput, setEditingToInput] = useState("");

  async function load() {
    const result = await invoke<VocabData>("get_vocabulary").catch(() => ({ words: [], replacements: {} }));
    setData(result);
  }

  useEffect(() => { load(); }, []);

  async function handleAddWord() {
    const word = newWord.trim();
    if (!word) return;
    await invoke("add_vocabulary_word", { word }).catch((e) => logger.debug("add_vocabulary_word:", e));
    setNewWord("");
    await load();
    showToast(`Added "${word}"`);
  }

  async function handleRemoveWord(word: string) {
    await invoke("remove_vocabulary_word", { word }).catch((e) => logger.debug("remove_vocabulary_word:", e));
    await load();
  }

  async function handleSaveWordEdit(oldWord: string, newWord: string) {
    const trimmed = newWord.trim();
    if (!trimmed || trimmed === oldWord) { setEditingWord(null); return; }
    await invoke("remove_vocabulary_word", { word: oldWord }).catch((e) => logger.debug("remove_vocabulary_word:", e));
    await invoke("add_vocabulary_word", { word: trimmed }).catch((e) => logger.debug("add_vocabulary_word:", e));
    setEditingWord(null);
    await load();
    showToast(`Updated "${trimmed}"`);
  }

  async function handleAddReplacement() {
    const from = newFrom.trim();
    const to = newTo.trim();
    if (!from || !to) return;
    await invoke("add_word_replacement", { from, to }).catch((e) => logger.debug("add_word_replacement:", e));
    setNewFrom("");
    setNewTo("");
    await load();
    showToast(`Added replacement`);
  }

  async function handleRemoveReplacement(from: string) {
    await invoke("remove_word_replacement", { from }).catch((e) => logger.debug("remove_word_replacement:", e));
    await load();
  }

  async function handleSaveReplacementEdit(oldFrom: string, newFrom: string, newTo: string) {
    const trimFrom = newFrom.trim();
    const trimTo = newTo.trim();
    if (!trimFrom || !trimTo) { setEditingReplacement(null); return; }
    if (trimFrom === oldFrom && trimTo === data.replacements[oldFrom]) {
      setEditingReplacement(null);
      return;
    }
    await invoke("remove_word_replacement", { from: oldFrom }).catch((e) => logger.debug("remove_word_replacement:", e));
    await invoke("add_word_replacement", { from: trimFrom, to: trimTo }).catch((e) => logger.debug("add_word_replacement:", e));
    setEditingReplacement(null);
    await load();
    showToast("Replacement updated");
  }

  const replacementEntries = Object.entries(data.replacements);

  return (
    <div className="w-full max-w-2xl mx-auto px-8 py-6 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold" style={{ color: "var(--t1)" }}>Vocabulary</h2>
        <p className="text-xs mt-1 font-mono" style={{ color: "var(--t2)" }}>
          Teach Whisper how to spell names, brands, and jargon
        </p>
      </div>

      {/* Custom Words */}
      <div>
        <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-3 font-mono">
          Custom Words
        </h3>
        <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--t3)" }}>
          Add proper names, acronyms, or technical terms. Whisper will prefer these exact spellings.
        </p>
        <div className="card p-4 space-y-3">
          {/* Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddWord()}
              placeholder="e.g. OmWhisper, Rakesh, CUDA…"
              className="flex-1 rounded-xl px-3 py-2 text-sm outline-none font-mono" style={{ color: "var(--t2)", background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
              aria-label="Add custom word"
            />
            <button
              onClick={handleAddWord}
              disabled={!newWord.trim()}
              className="btn-primary shrink-0 text-xs py-2 px-4"
            >
              Add
            </button>
          </div>

          {/* Word list */}
          {data.words.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {data.words.map((word) =>
                editingWord === word ? (
                  <span key={word} className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}>
                    <input
                      type="text"
                      autoFocus
                      value={editingWordInput}
                      onChange={(e) => setEditingWordInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveWordEdit(word, editingWordInput);
                        if (e.key === "Escape") setEditingWord(null);
                      }}
                      onBlur={() => setEditingWord(null)}
                      className="bg-transparent outline-none text-xs font-mono w-24" style={{ color: "var(--t2)" }}
                      aria-label={`Edit ${word}`}
                    />
                  </span>
                ) : (
                  <span
                    key={word}
                    onClick={() => { setEditingWord(word); setEditingWordInput(word); }}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono cursor-pointer transition-opacity" style={{ color: "var(--t2)" }}
                    style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm)" }}
                    title="Click to edit"
                  >
                    {word}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveWord(word); }}
                      className="hover:text-red-400 transition-colors cursor-pointer" style={{ color: "var(--t3)" }}
                      aria-label={`Remove ${word}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                )
              )}
            </div>
          ) : (
            <p className="text-xs font-mono" style={{ color: "var(--t3)" }}>No custom words yet</p>
          )}
        </div>
      </div>

      {/* Auto-Replacements */}
      <div>
        <h3 className="text-t3 text-[10px] uppercase tracking-widest mb-3 font-mono">
          Auto-Replacements
        </h3>
        <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--t3)" }}>
          Replace words automatically after transcription. Case-insensitive, whole-word matching.
        </p>
        <div className="card p-4 space-y-3">
          {/* Input row */}
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={newFrom}
              onChange={(e) => setNewFrom(e.target.value)}
              placeholder="Replace…"
              className="flex-1 rounded-xl px-3 py-2 text-sm outline-none font-mono" style={{ color: "var(--t2)", background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
              aria-label="Word to replace"
            />
            <span className="text-sm shrink-0" style={{ color: "var(--t4)" }}>→</span>
            <input
              type="text"
              value={newTo}
              onChange={(e) => setNewTo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddReplacement()}
              placeholder="With…"
              className="flex-1 rounded-xl px-3 py-2 text-sm outline-none font-mono" style={{ color: "var(--t2)", background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
              aria-label="Replacement word"
            />
            <button
              onClick={handleAddReplacement}
              disabled={!newFrom.trim() || !newTo.trim()}
              className="btn-primary shrink-0 text-xs py-2 px-4"
            >
              Add
            </button>
          </div>

          {/* Replacement list */}
          {replacementEntries.length > 0 ? (
            <div className="space-y-2 pt-1">
              {replacementEntries.map(([from, to]) =>
                editingReplacement === from ? (
                  <div key={from} className="flex items-center gap-2 py-1.5 px-3 rounded-xl" style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}>
                    <input
                      type="text"
                      autoFocus
                      value={editingFromInput}
                      onChange={(e) => setEditingFromInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveReplacementEdit(from, editingFromInput, editingToInput);
                        if (e.key === "Escape") setEditingReplacement(null);
                      }}
                      className="bg-transparent outline-none text-xs font-mono flex-1" style={{ color: "var(--t2)" }}
                      aria-label="Edit source word"
                    />
                    <span className="text-xs shrink-0" style={{ color: "var(--t4)" }}>→</span>
                    <input
                      type="text"
                      value={editingToInput}
                      onChange={(e) => setEditingToInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveReplacementEdit(from, editingFromInput, editingToInput);
                        if (e.key === "Escape") setEditingReplacement(null);
                      }}
                      onBlur={() => setEditingReplacement(null)}
                      className="bg-transparent outline-none text-emerald-400/70 text-xs font-mono flex-1"
                      aria-label="Edit replacement word"
                    />
                  </div>
                ) : (
                  <div
                    key={from}
                    className="flex items-center gap-3 py-1.5 px-3 rounded-xl cursor-pointer"
                    style={{ background: "var(--bg)", boxShadow: "var(--nm-pressed-sm)" }}
                    onClick={() => { setEditingReplacement(from); setEditingFromInput(from); setEditingToInput(to); }}
                    title="Click to edit"
                  >
                    <span className="text-xs font-mono flex-1" style={{ color: "var(--t3)" }}>{from}</span>
                    <span className="text-xs" style={{ color: "var(--t4)" }}>→</span>
                    <span className="text-emerald-400/70 text-xs font-mono flex-1">{to}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveReplacement(from); }}
                      className="hover:text-red-400 transition-colors cursor-pointer ml-1" style={{ color: "var(--t4)" }}
                      aria-label={`Remove replacement for ${from}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              )}
            </div>
          ) : (
            <p className="text-xs font-mono" style={{ color: "var(--t3)" }}>No replacements yet</p>
          )}
        </div>
      </div>

      {/* Examples hint */}
      <div className="text-xs leading-relaxed font-mono space-y-0.5" style={{ color: "var(--t3)" }}>
        <p>Examples: "okay" → "OK" · "gonna" → "going to" · "OmWhisper" as custom word</p>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-emerald-400 text-xs font-mono pointer-events-none z-50" style={{ background: "var(--bg)", boxShadow: "var(--nm-raised-sm), 0 0 16px rgba(52,211,153,0.15)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
