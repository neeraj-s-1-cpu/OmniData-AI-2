import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, Send, X } from "lucide-react";
import { useLanguage } from "../utils/i18n";

interface VoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitVoice: (audioBlob: Blob | null, transcriptText: string) => void;
}

export const VoiceModal: React.FC<VoiceModalProps> = ({
  isOpen,
  onClose,
  onSubmitVoice,
}) => {
  const { t, speechLocale } = useLanguage();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState("");
  const [micError, setMicError] = useState<string | null>(null);

  const cleanup = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  };

  useEffect(() => {
    if (!isOpen) {
      cleanup();
      setSeconds(0);
      setAudioBlob(null);
      setTranscript("");
      setMicError(null);
    }
    return () => cleanup();
  }, [isOpen]);

  if (!isOpen) return null;

  const startRecording = async () => {
    setMicError(null);
    setAudioBlob(null);
    chunksRef.current = [];

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone recording is not supported in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        setAudioBlob(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      setSeconds(0);

      timerRef.current = window.setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);

      // Optional live speech preview via browser SpeechRecognition (audio is also sent to server-side Gemini multimodal transcription)
      const SpeechRec =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        try {
          const rec = new SpeechRec();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = speechLocale;
          rec.onresult = (event: any) => {
            let combined = "";
            for (let i = 0; i < event.results.length; i++) {
              combined += event.results[i][0].transcript + " ";
            }
            setTranscript(combined.trim());
          };
          rec.onerror = () => {};
          rec.start();
          recognitionRef.current = rec;
        } catch {
          // ignore speech preview errors
        }
      }
    } catch (err: any) {
      setMicError(
        err?.message ||
          "Microphone access was blocked. You can type or paste your spoken metrics below instead."
      );
    }
  };

  const stopRecording = () => {
    cleanup();
  };

  const handleAnalyze = () => {
    if (isRecording) {
      cleanup();
    }
    if (!audioBlob && !transcript.trim()) return;
    onSubmitVoice(audioBlob, transcript.trim());
    onClose();
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Speak to Analyze Data"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <Mic className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-semibold text-slate-900">
              {t("voiceTitle")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            {t("voiceHint")}
          </p>

          <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 py-6 px-4 gap-3">
            {!isRecording ? (
              <button
                type="button"
                onClick={startRecording}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md hover:bg-emerald-700 transition-transform active:scale-95"
                aria-label="Start recording"
              >
                <Mic className="w-7 h-7" />
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-600 text-white shadow-md hover:bg-rose-700 transition-transform active:scale-95"
                aria-label="Stop recording"
              >
                <Square className="w-6 h-6 fill-current" />
              </button>
            )}

            <div className="text-center">
              <div className="text-sm font-semibold text-slate-800 tabular-nums">
                {isRecording
                  ? `${t("voiceRecording")} ${formatDuration(seconds)}`
                  : audioBlob
                  ? `${t("voiceRecordedReady")} (${formatDuration(seconds)})`
                  : t("voiceTapMic")}
              </div>
            </div>

            {micError && (
              <p className="text-xs text-rose-600 text-center max-w-sm">{micError}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              {t("voiceNotesLabel")}
            </label>
            <textarea
              rows={3}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={t("voiceNotesPlaceholder")}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={isRecording || (!audioBlob && !transcript.trim())}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              <Send className="w-4 h-4" />
              {t("analyzeSpokenData")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
