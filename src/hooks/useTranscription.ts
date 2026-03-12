// Stub: transcription hook — to be implemented
export function useTranscription() {
  return {
    isRecording: false,
    segments: [] as { text: string; isFinal: boolean }[],
    interimText: "",
  };
}
