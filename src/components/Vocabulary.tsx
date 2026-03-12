import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";

interface VocabData {
  words: string[];
  replacements: Record<string, string>;
}

export default function Vocabulary() {
  const [data, setData] = useState<VocabData>({ words: [], replacements: {} });
  const [newWord, setNewWord] = useState("");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  async function load() {
    const result = await invoke<VocabData>("get_vocabulary").catch(() => ({ words: [], replacements: {} }));
    setData(result);
  }

  useEffect(() => { load(); }, []);

  async function handleAddWord() {
    const word = newWord.trim();
    if (!word) return;
    await invoke("add_vocabulary_word", { word }).catch(() => {});
    setNewWord("");
    await load();
    showToast(`Added "${word}"`);
  }

  async function handleRemoveWord(word: string) {
    await invoke("remove_vocabulary_word", { word }).catch(() => {});
    await load();
  }

  async function handleAddReplacement() {
    const from = newFrom.trim();
    const to = newTo.trim();
    if (!from || !to) return;
    await invoke("add_word_replacement", { from, to }).catch(() => {});
    setNewFrom("");
    setNewTo("");
    await load();
    showToast(`Added replacement`);
  }

  async function handleRemoveReplacement(from: string) {
    await invoke("remove_word_replacement", { from }).catch(() => {});
    await load();
  }

  const replacementEntries = Object.entries(data.replacements);

  return (
    <div className="w-full max-w-2xl mx-auto px-8 py-6 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white/90">Vocabulary</h2>
        <p className="text-white/30 text-xs mt-1 font-mono">
          Teach Whisper how to spell names, brands, and jargon
        </p>
      </div>

      {/* Custom Words */}
      <div>
        <h3 className="text-white/30 text-[10px] uppercase tracking-widest mb-3 font-mono">
          Custom Words
        </h3>
        <p className="text-white/25 text-xs mb-3 leading-relaxed">
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
              className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-emerald-500/40 transition-colors font-mono"
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
              {data.words.map((word) => (
                <span
                  key={word}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-white/70 text-xs font-mono"
                >
                  {word}
                  <button
                    onClick={() => handleRemoveWord(word)}
                    className="text-white/30 hover:text-red-400 transition-colors cursor-pointer"
                    aria-label={`Remove ${word}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-white/15 text-xs font-mono">No custom words yet</p>
          )}
        </div>
      </div>

      {/* Auto-Replacements */}
      <div>
        <h3 className="text-white/30 text-[10px] uppercase tracking-widest mb-3 font-mono">
          Auto-Replacements
        </h3>
        <p className="text-white/25 text-xs mb-3 leading-relaxed">
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
              className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-emerald-500/40 transition-colors font-mono"
              aria-label="Word to replace"
            />
            <span className="text-white/20 text-sm shrink-0">→</span>
            <input
              type="text"
              value={newTo}
              onChange={(e) => setNewTo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddReplacement()}
              placeholder="With…"
              className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-white/80 text-sm placeholder:text-white/20 outline-none focus:border-emerald-500/40 transition-colors font-mono"
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
              {replacementEntries.map(([from, to]) => (
                <div
                  key={from}
                  className="flex items-center gap-3 py-1.5 px-3 rounded-xl bg-white/[0.03] border border-white/[0.05]"
                >
                  <span className="text-white/50 text-xs font-mono flex-1">{from}</span>
                  <span className="text-white/20 text-xs">→</span>
                  <span className="text-emerald-400/70 text-xs font-mono flex-1">{to}</span>
                  <button
                    onClick={() => handleRemoveReplacement(from)}
                    className="text-white/20 hover:text-red-400 transition-colors cursor-pointer ml-1"
                    aria-label={`Remove replacement for ${from}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/15 text-xs font-mono">No replacements yet</p>
          )}
        </div>
      </div>

      {/* Examples hint */}
      <div className="text-white/15 text-xs leading-relaxed font-mono space-y-0.5">
        <p>Examples: "okay" → "OK" · "gonna" → "going to" · "OmWhisper" as custom word</p>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono pointer-events-none z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
