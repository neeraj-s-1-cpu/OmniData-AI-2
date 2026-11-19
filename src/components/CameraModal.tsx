import React, { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, Upload, X, Check } from "lucide-react";
import { useLanguage } from "../utils/i18n";

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptureFile: (file: File) => void;
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onCaptureFile,
}) => {
  const { t } = useLanguage();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileFallbackRef = useRef<HTMLInputElement | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [starting, setStarting] = useState(false);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async () => {
    setStarting(true);
    setCameraError(null);
    setPreviewUrl(null);
    setCapturedBlob(null);
    stopStream();

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera streaming is not supported in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err: any) {
      setCameraError(
        err?.message ||
          "Could not access camera. You can still upload or scan a photo directly from your device."
      );
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopStream();
      setPreviewUrl(null);
      setCapturedBlob(null);
      setCameraError(null);
    }
    return () => {
      stopStream();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSnap = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          setCapturedBlob(blob);
          setPreviewUrl(URL.createObjectURL(blob));
          stopStream();
        }
      },
      "image/jpeg",
      0.92
    );
  };

  const handleUsePhoto = () => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `camera_scan_${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    onCaptureFile(file);
    onClose();
  };

  const handleFallbackPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onCaptureFile(file);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Take Photo or Scan Document"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <Camera className="w-5 h-5 text-orange-500" />
            <h3 className="text-base font-semibold text-slate-900">
              {t("cameraTitle")}
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
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-950 flex items-center justify-center">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Captured document preview"
                className="h-full w-full object-contain"
              />
            ) : cameraError ? (
              <div className="p-6 text-center text-sm text-slate-300 space-y-3">
                <p>{cameraError}</p>
                <button
                  type="button"
                  onClick={() => fileFallbackRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  Select Photo / Camera Image
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                {starting && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70 text-sm text-white">
                    Starting camera...
                  </div>
                )}
              </>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />
          <input
            ref={fileFallbackRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFallbackPhoto}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => fileFallbackRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Upload className="w-4 h-4" />
              {t("uploadPhotoInstead")}
            </button>

            <div className="flex items-center gap-2">
              {previewUrl ? (
                <>
                  <button
                    type="button"
                    onClick={startCamera}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t("retake")}
                  </button>
                  <button
                    type="button"
                    onClick={handleUsePhoto}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    {t("analyzePhoto")}
                  </button>
                </>
              ) : (
                !cameraError && (
                  <button
                    type="button"
                    onClick={handleSnap}
                    disabled={starting}
                    className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                  >
                    <Camera className="w-4 h-4" />
                    {t("capturePhoto")}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
