import { create } from "zustand";

interface Segment {
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
}

interface AppState {
  isRecording: boolean;
  segments: Segment[];
  interimText: string;
  activeModel: string;
  setRecording: (v: boolean) => void;
  setInterimText: (t: string) => void;
  addSegment: (s: Segment) => void;
  setActiveModel: (m: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isRecording: false,
  segments: [],
  interimText: "",
  activeModel: "tiny.en",
  setRecording: (v) => set({ isRecording: v }),
  setInterimText: (t) => set({ interimText: t }),
  addSegment: (s) => set((state) => ({ segments: [...state.segments, s] })),
  setActiveModel: (m) => set({ activeModel: m }),
}));
