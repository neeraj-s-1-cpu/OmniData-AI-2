import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Home,
  Clock,
  List,
  Settings,
  User,
  FileText,
  Camera,
  Mic,
  Upload,
  Download,
  Database,
  X,
  Trash2,
  Search,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Plus,
  Send,
  PanelLeftOpen,
  PanelLeftClose,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  ArrowLeft,
  BarChart3,
  Eye,
  EyeOff,
  Globe,
} from "lucide-react";
import type {
  AppSettings,
  ChartConfig,
  ColumnNumberFormat,
  ComparisonPeriod,
  CrossFilterSelection,
  Dataset,
  Folder,
  FolderComparisonResult,
  NavSection,
  UserProfile,
} from "./types/analytics";
import { PlotlyChart } from "./components/PlotlyChart";
import { CameraModal } from "./components/CameraModal";
import { VoiceModal } from "./components/VoiceModal";
import { SqlExplorerModal } from "./components/SqlExplorerModal";
import { FolderCompareView } from "./components/FolderCompareView";
import { downloadDatasetPdfReport } from "./utils/pdfReport";
import {
  SUPPORTED_LANGUAGES,
  LanguageProvider,
  resolveLanguageCode,
  translateKey,
  TranslationKey,
} from "./utils/i18n";

const BrandLogo: React.FC<{ darkText?: boolean }> = ({ darkText = false }) => (
  <div className="flex items-center gap-2.5 shrink-0">
    <svg
      width="34"
      height="34"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="18"
        cy="18"
        r="13"
        stroke={darkText ? "#1E88E5" : "#38BDF8"}
        strokeWidth="4.5"
        strokeDasharray="52 16"
        strokeLinecap="round"
      />
      <circle cx="27" cy="9" r="2.2" fill="#F57C20" />
      <circle cx="30" cy="14" r="1.8" fill="#10B981" />
      <circle cx="29" cy="21" r="1.6" fill="#60A5FA" />
    </svg>
    <div className="leading-tight">
      <div
        className={`text-sm font-bold tracking-wide whitespace-nowrap ${
          darkText ? "text-slate-900" : "text-white"
        }`}
      >
        OMNI
      </div>
      <div
        className={`text-[11px] font-medium tracking-wider whitespace-nowrap ${
          darkText ? "text-slate-600" : "text-sky-200"
        }`}
      >
        DATA AI
      </div>
    </div>
  </div>
);

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeNav, setActiveNav] = useState<NavSection>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [currentDataset, setCurrentDataset] = useState<Dataset | null>(null);
  const [visibleChartCount, setVisibleChartCount] = useState<1 | 2>(2);
  const [hiddenChartIndices, setHiddenChartIndices] = useState<number[]>([]);
  const [crossFilter, setCrossFilter] = useState<CrossFilterSelection | null>(null);

  // Folders & Cross-Time Growth Comparison
  const [folders, setFolders] = useState<Folder[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [selectedUploadFolderId, setSelectedUploadFolderId] = useState<string>("");

  const [activeFolder, setActiveFolder] = useState<Folder | null>(null);
  const [folderComparison, setFolderComparison] =
    useState<FolderComparisonResult | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [comparePeriod, setComparePeriod] = useState<ComparisonPeriod>("all");
  const [compareMetric, setCompareMetric] = useState<string>("");
  const [compareFilterCol, setCompareFilterCol] = useState<string>("");
  const [compareFilterValues, setCompareFilterValues] = useState<string[] | undefined>(
    undefined
  );

  const [profile, setProfile] = useState<UserProfile>({
    name: "User",
    email: "analyst@omnidata.ai",
    role: "Data Analyst",
    organization: "Omni Workspace",
  });
  const [settings, setSettings] = useState<AppSettings>(() => {
    let savedLang = "auto";
    try {
      savedLang = localStorage.getItem("omni_language") || "auto";
    } catch {
      savedLang = "auto";
    }
    return {
      auto_clean: "true",
      auto_sort: "true",
      max_charts: "2",
      default_theme: "light",
      language: savedLang,
    };
  });

  const resolvedLang = useMemo(
    () => resolveLanguageCode(settings.language),
    [settings.language]
  );

  const t = useCallback(
    (key: TranslationKey) => translateKey(resolvedLang, key),
    [resolvedLang]
  );

  const handleLanguageChange = async (nextLang: string) => {
    const nextSettings = { ...settings, language: nextLang };
    setSettings(nextSettings);
    try {
      localStorage.setItem("omni_language", nextLang);
    } catch {
      // ignore localStorage error
    }
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: nextSettings }),
      });
    } catch {
      // ignore non-fatal persistence error
    }
  };

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeStage, setAnalyzeStage] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [sqlModalOpen, setSqlModalOpen] = useState(false);

  const [showTextBox, setShowTextBox] = useState(false);
  const [quickTextInput, setQuickTextInput] = useState("");

  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState("all");

  const [savingSettings, setSavingSettings] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const safeParseJson = async (res: Response): Promise<any> => {
    const raw = await res.text();
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error(`Empty server response (HTTP ${res.status}).`);
    }
    if (trimmed.startsWith("<")) {
      const err: any = new Error(
        `Server returned an HTML page instead of JSON (HTTP ${res.status}). Please refresh the page and try again.`
      );
      err.isHtmlResponse = true;
      throw err;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`Invalid response from server (HTTP ${res.status}).`);
    }
  };

  const fetchInitialData = useCallback(async () => {
    try {
      const [dsRes, profRes, setRes, fldRes] = await Promise.all([
        fetch("/api/datasets"),
        fetch("/api/profile"),
        fetch("/api/settings"),
        fetch("/api/folders"),
      ]);
      const [dsJson, profJson, setJson, fldJson] = await Promise.all([
        safeParseJson(dsRes),
        safeParseJson(profRes),
        safeParseJson(setRes),
        safeParseJson(fldRes),
      ]);

      if (profJson.ok && profJson.profile?.name) {
        setProfile(profJson.profile);
      }
      if (setJson.ok && setJson.settings) {
        let localLang: string | null = null;
        try {
          localLang = localStorage.getItem("omni_language");
        } catch {
          localLang = null;
        }
        setSettings((prev) => ({
          ...prev,
          ...setJson.settings,
          language: setJson.settings.language || localLang || prev.language || "auto",
        }));
        if (setJson.settings.max_charts === "1") {
          setVisibleChartCount(1);
        }
      }
      if (fldJson.ok && Array.isArray(fldJson.folders)) {
        setFolders(fldJson.folders);
      }
      if (dsJson.ok && Array.isArray(dsJson.datasets)) {
        setDatasets(dsJson.datasets);
        if (dsJson.datasets.length > 0) {
          const latestId = dsJson.datasets[0].id;
          const fullRes = await fetch(`/api/datasets/${latestId}`);
          const fullJson = await safeParseJson(fullRes);
          if (fullJson.ok && fullJson.dataset) {
            setCurrentDataset(fullJson.dataset);
          }
        }
      }
    } catch {
      // ignore initial load error silently
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const refreshDatasetList = async () => {
    const res = await fetch("/api/datasets");
    const json = await safeParseJson(res);
    if (json.ok && Array.isArray(json.datasets)) {
      setDatasets(json.datasets);
    }
  };

  const refreshFolders = async () => {
    try {
      const res = await fetch("/api/folders");
      const json = await safeParseJson(res);
      if (json.ok && Array.isArray(json.folders)) {
        setFolders(json.folders);
      }
    } catch {
      // ignore
    }
  };

  const openFolderView = async (
    folder: Folder,
    periodOverride?: ComparisonPeriod,
    metricOverride?: string,
    filterColOverride?: string,
    filterValuesOverride?: string[] | undefined
  ) => {
    const isDifferentFolder = activeFolder?.id !== folder.id;
    const nextPeriod = periodOverride ?? comparePeriod;
    const nextMetric =
      metricOverride !== undefined
        ? metricOverride
        : isDifferentFolder
        ? ""
        : compareMetric;
    const nextFilterCol =
      filterColOverride !== undefined
        ? filterColOverride
        : isDifferentFolder
        ? ""
        : compareFilterCol;
    const nextFilterValues =
      filterValuesOverride !== undefined || filterColOverride !== undefined
        ? filterValuesOverride
        : isDifferentFolder
        ? undefined
        : compareFilterValues;

    setActiveFolder(folder);
    setActiveNav("folder");
    setSidebarOpen(false);
    setFolderLoading(true);
    setErrorMsg(null);

    try {
      const params = new URLSearchParams({ period: nextPeriod });
      if (nextMetric) params.set("metric", nextMetric);
      if (nextFilterCol) params.set("filterCol", nextFilterCol);
      if (Array.isArray(nextFilterValues)) {
        params.set("filterValues", JSON.stringify(nextFilterValues));
      }

      const res = await fetch(`/api/folders/${folder.id}/compare?${params.toString()}`);
      const json = await safeParseJson(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Could not load folder comparison.");
      }
      setFolderComparison(json as FolderComparisonResult);
      setComparePeriod(nextPeriod);
      setCompareMetric(json.selectedMetric || "");
      setCompareFilterCol(json.selectedFilterCol || nextFilterCol || "");
      setCompareFilterValues(nextFilterValues);
      if (json.folder) {
        setActiveFolder(json.folder);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load folder comparison.");
    } finally {
      setFolderLoading(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    setCreatingFolder(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const json = await safeParseJson(res);
      if (!res.ok || !json.ok || !json.folder) {
        throw new Error(json.error || "Could not create folder.");
      }
      setNewFolderName("");
      await refreshFolders();
      setStatusMsg(`Folder "${json.folder.name}" created.`);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to create folder.");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDeleteFolder = async (folder: Folder) => {
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/folders/${folder.id}`, { method: "DELETE" });
      const json = await safeParseJson(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Could not delete folder.");
      }
      await Promise.all([refreshFolders(), refreshDatasetList()]);
      if (selectedUploadFolderId === folder.id) {
        setSelectedUploadFolderId("");
      }
      if (currentDataset?.folderId === folder.id) {
        setCurrentDataset({ ...currentDataset, folderId: null });
      }
      if (activeFolder?.id === folder.id) {
        setActiveFolder(null);
        setFolderComparison(null);
        setActiveNav("home");
      }
      setStatusMsg(`Deleted folder "${folder.name}". Saved reports remain in History.`);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to delete folder.");
    }
  };

  const handleAssignDatasetFolder = async (
    datasetId: string,
    folderId: string | null
  ) => {
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/datasets/${datasetId}/folder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: folderId || null }),
      });
      const json = await safeParseJson(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Could not update dataset folder.");
      }
      if (currentDataset?.id === datasetId) {
        setCurrentDataset({ ...currentDataset, folderId: folderId || null });
      }
      setDatasets((prev) =>
        prev.map((d) => (d.id === datasetId ? { ...d, folderId: folderId || null } : d))
      );
      await refreshFolders();

      if (activeNav === "folder" && activeFolder) {
        await openFolderView(activeFolder, comparePeriod, compareMetric);
      } else if (folderId) {
        const target = folders.find((f) => f.id === folderId);
        setStatusMsg(
          `Saved report to folder "${target?.name || "selected folder"}". Open it from Menu & Folders to compare growth.`
        );
      } else {
        setStatusMsg("Removed report from folder.");
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to assign folder.");
    }
  };

  const openDatasetById = async (id: string) => {
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/datasets/${id}`);
      const json = await safeParseJson(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Could not load dataset.");
      }
      setCurrentDataset(json.dataset);
      setHiddenChartIndices([]);
      const maxAllowed = settings.max_charts === "1" ? 1 : 2;
      setVisibleChartCount(
        json.dataset.charts.length >= 2 && maxAllowed === 2 ? 2 : 1
      );
      setActiveNav("analysis");
      setSidebarOpen(false);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load dataset.");
    }
  };

  const isImageFile = (file: File) =>
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(file.name);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read image file."));
      reader.readAsDataURL(file);
    });

  const optimizeImageIfLarge = async (file: File): Promise<File> => {
    if (!isImageFile(file) || file.size <= 400 * 1024) {
      return file;
    }
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxDim = 1600;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(
                new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
                  type: "image/jpeg",
                })
              );
            } else {
              resolve(file);
            }
          },
          "image/jpeg",
          0.86
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  };

  const analyzeUploadedFile = async (file: File, sourceTypeOverride?: string) => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setAnalyzeStage(
      `Reading "${file.name}", auto-cleaning & sorting in Python/SQL, selecting best charts...`
    );

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 55000);

    try {
      const preparedFile = await optimizeImageIfLarge(file);

      const sendRequest = async (): Promise<any> => {
        if (isImageFile(preparedFile) && !/\.heic$/i.test(preparedFile.name)) {
          const dataUrl = await fileToDataUrl(preparedFile);
          const res = await fetch("/api/analyze/image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: preparedFile.name,
              mimeType: preparedFile.type || "image/jpeg",
              base64Data: dataUrl,
              sourceType: sourceTypeOverride || "camera",
              folderId: selectedUploadFolderId || undefined,
              language: resolvedLang,
            }),
            signal: controller.signal,
          });
          return safeParseJson(res);
        }

        const formData = new FormData();
        formData.append("file", preparedFile);
        if (sourceTypeOverride) {
          formData.append("sourceType", sourceTypeOverride);
        }
        if (selectedUploadFolderId) {
          formData.append("folderId", selectedUploadFolderId);
        }
        formData.append("language", resolvedLang);
        const res = await fetch("/api/analyze/file", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
        return safeParseJson(res);
      };

      let json: any;
      try {
        json = await sendRequest();
      } catch (firstErr: any) {
        if (firstErr?.isHtmlResponse) {
          await fetch("/api/health").catch(() => {});
          json = await sendRequest();
        } else {
          throw firstErr;
        }
      }

      if (!json?.ok || !json.dataset) {
        throw new Error(json?.error || "Failed to analyze uploaded file.");
      }
      setCurrentDataset(json.dataset);
      setHiddenChartIndices([]);
      const maxAllowed = settings.max_charts === "1" ? 1 : 2;
      setVisibleChartCount(
        json.dataset.charts.length >= 2 && maxAllowed === 2 ? 2 : 1
      );
      await Promise.all([refreshDatasetList(), refreshFolders()]);
      setActiveNav("analysis");
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setErrorMsg("Analysis timed out. Please try again with a clearer image or file.");
      } else {
        setErrorMsg(err?.message || "Analysis failed.");
      }
    } finally {
      window.clearTimeout(timer);
      setIsAnalyzing(false);
      setAnalyzeStage("");
    }
  };

  const analyzeTextPayload = async (text: string, sourceType = "text") => {
    if (!text.trim()) return;
    setIsAnalyzing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setAnalyzeStage(
      "Understanding spoken/text metrics, cleaning rows in Python/SQL, and selecting charts..."
    );

    try {
      const res = await fetch("/api/analyze/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          sourceType,
          folderId: selectedUploadFolderId || undefined,
          language: resolvedLang,
        }),
      });
      const json = await safeParseJson(res);
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to analyze text.");
      }
      setCurrentDataset(json.dataset);
      setHiddenChartIndices([]);
      setVisibleChartCount(
        json.dataset.charts.length >= 2 && settings.max_charts !== "1" ? 2 : 1
      );
      setQuickTextInput("");
      setShowTextBox(false);
      await Promise.all([refreshDatasetList(), refreshFolders()]);
      setActiveNav("analysis");
    } catch (err: any) {
      setErrorMsg(err?.message || "Text analysis failed.");
    } finally {
      setIsAnalyzing(false);
      setAnalyzeStage("");
    }
  };

  const analyzeVoiceSubmission = async (
    audioBlob: Blob | null,
    transcriptText: string
  ) => {
    if (!audioBlob && !transcriptText) return;
    setIsAnalyzing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setAnalyzeStage(
      "Transcribing voice input, extracting structured data, cleaning & charting..."
    );

    try {
      let json: any;
      if (audioBlob && audioBlob.size > 0) {
        const formData = new FormData();
        formData.append("audio", audioBlob, "voice_input.webm");
        if (transcriptText) {
          formData.append("transcript", transcriptText);
        }
        if (selectedUploadFolderId) {
          formData.append("folderId", selectedUploadFolderId);
        }
        formData.append("language", resolvedLang);
        const res = await fetch("/api/analyze/voice", {
          method: "POST",
          body: formData,
        });
        json = await safeParseJson(res);
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Voice analysis failed.");
        }
      } else {
        const res = await fetch("/api/analyze/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: transcriptText,
            sourceType: "voice",
            folderId: selectedUploadFolderId || undefined,
            language: resolvedLang,
          }),
        });
        json = await safeParseJson(res);
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "Voice transcript analysis failed.");
        }
      }

      setCurrentDataset(json.dataset);
      setHiddenChartIndices([]);
      setVisibleChartCount(
        json.dataset.charts.length >= 2 && settings.max_charts !== "1" ? 2 : 1
      );
      if (json.transcript) {
        setStatusMsg(`Transcribed speech: "${json.transcript}"`);
      }
      await Promise.all([refreshDatasetList(), refreshFolders()]);
      setActiveNav("analysis");
    } catch (err: any) {
      setErrorMsg(err?.message || "Voice analysis failed.");
    } finally {
      setIsAnalyzing(false);
      setAnalyzeStage("");
    }
  };

  const handleAnalyzeSample = () => {
    const sampleCsv = [
      "Month,Region,Revenue ($),Units Sold,Customer Satisfaction (%)",
      "Mar 2025,North,$18400,142,92%",
      "Jan 2025,North,$12500,98,89%",
      "Jan 2025,North,$12500,98,89%",
      "Feb 2025,South,$15200,118,91%",
      "Apr 2025,West,$22900,176,94%",
      "May 2025,East,$26400,N/A,95%",
      "Jun 2025,North,$31200,240,96%",
      "Grand Total,,$126600,774,",
    ].join("\n");
    const file = new File([sampleCsv], "quarterly_sales_sample.csv", {
      type: "text/csv",
    });
    analyzeUploadedFile(file, "csv");
  };

  const handleChartConfigChange = async (idx: number, updated: ChartConfig) => {
    if (!currentDataset) return;
    const nextCharts = [...currentDataset.charts];
    nextCharts[idx] = updated;
    setCurrentDataset({ ...currentDataset, charts: nextCharts });
    try {
      await fetch(`/api/datasets/${currentDataset.id}/charts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charts: nextCharts }),
      });
    } catch {
      // ignore non-fatal persistence error
    }
  };

  const handleColumnFormatChange = async (
    columnName: string,
    format: ColumnNumberFormat
  ) => {
    if (!currentDataset) return;
    const nextColumns = currentDataset.columns.map((c) =>
      c.name === columnName ? { ...c, format } : c
    );
    setCurrentDataset({ ...currentDataset, columns: nextColumns });
    try {
      await fetch(`/api/datasets/${currentDataset.id}/formats`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formats: { [columnName]: format } }),
      });
    } catch {
      // ignore non-fatal persistence error
    }
  };

  const toggleChartHidden = (idx: number) => {
    setHiddenChartIndices((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const handleAddSecondChart = async () => {
    if (!currentDataset) return;
    setHiddenChartIndices((prev) => prev.filter((i) => i !== 1));
    if (currentDataset.charts.length >= 2) {
      setVisibleChartCount(2);
      return;
    }
    const numCol =
      currentDataset.columns.find((c) => c.type === "numeric" || c.type === "mixed") ||
      currentDataset.columns[0];
    const catCol =
      currentDataset.columns.find((c) => c.type === "categorical") ||
      currentDataset.columns[0];

    const secondChart: ChartConfig = {
      id: "chart_2",
      title: `${numCol?.label || "Values"} by ${catCol?.label || "Category"}`,
      chartType: currentDataset.charts[0]?.chartType === "bar" ? "pie" : "bar",
      xColumn: catCol?.name || "_row_index",
      yColumn:
        numCol?.type === "numeric" || numCol?.type === "mixed"
          ? numCol.name
          : "_count",
      aggregation:
        numCol?.type === "numeric" || numCol?.type === "mixed" ? "sum" : "count",
      reason: "User-added secondary perspective.",
    };
    const nextCharts = [currentDataset.charts[0], secondChart].filter(Boolean);
    setCurrentDataset({ ...currentDataset, charts: nextCharts });
    setVisibleChartCount(2);
    try {
      await fetch(`/api/datasets/${currentDataset.id}/charts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charts: nextCharts }),
      });
    } catch {
      // ignore
    }
  };

  const handleCompareAllValuesOneChart = async () => {
    if (!currentDataset || currentDataset.charts.length === 0) return;
    const numericCols = currentDataset.columns.filter(
      (c) => c.type === "numeric" || c.type === "mixed"
    );
    if (numericCols.length < 2) return;
    const baseChart = currentDataset.charts[0];
    const xColMeta = currentDataset.columns.find((c) => c.name === baseChart.xColumn);
    const updatedChart0: ChartConfig = {
      ...baseChart,
      chartType: baseChart.chartType === "pie" ? "bar" : baseChart.chartType,
      yColumn: numericCols[0].name,
      yColumns: numericCols.map((c) => c.name),
      separateItems: false,
      syncAxis: true,
      groupColumn: undefined,
      aggregation:
        baseChart.aggregation === "count" ? "sum" : baseChart.aggregation || "sum",
      title: `${t("allValuesBtn")} (${xColMeta?.label || baseChart.xColumn})`,
    };
    setVisibleChartCount(1);
    setHiddenChartIndices((prev) => prev.filter((i) => i !== 0));
    setCrossFilter(null);
    await handleChartConfigChange(0, updatedChart0);
  };

  const handleDeleteDataset = async (id: string) => {
    try {
      await fetch(`/api/datasets/${id}`, { method: "DELETE" });
      setDatasets((prev) => prev.filter((d) => d.id !== id));
      if (currentDataset?.id === id) {
        setCurrentDataset(null);
        if (activeNav === "analysis") {
          setActiveNav("home");
        }
      }
      await refreshFolders();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to delete dataset.");
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const json = await safeParseJson(res);
      if (!res.ok || !json.ok) throw new Error(json.error);
      try {
        localStorage.setItem("omni_language", settings.language || "auto");
      } catch {
        // ignore
      }
      setVisibleChartCount(settings.max_charts === "1" ? 1 : 2);
      setStatusMsg("Settings saved to SQLite database.");
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const json = await safeParseJson(res);
      if (!res.ok || !json.ok) throw new Error(json.error);
      setStatusMsg("Profile updated.");
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const displayedCharts = useMemo(() => {
    if (!currentDataset) return [];
    const maxShow = visibleChartCount === 1 ? 1 : 2;
    return currentDataset.charts.slice(0, maxShow);
  }, [currentDataset, visibleChartCount]);

  useEffect(() => {
    setCrossFilter(null);
  }, [currentDataset?.id]);

  useEffect(() => {
    const visible = displayedCharts.filter(
      (_, i) => !hiddenChartIndices.includes(i)
    ).length;
    if (visible < 2) {
      setCrossFilter(null);
    }
  }, [displayedCharts, hiddenChartIndices]);

  const filteredHistory = useMemo(() => {
    return datasets.filter((d) => {
      const matchesFilter =
        historyFilter === "all" ||
        (historyFilter === "file" &&
          !["camera", "voice", "text"].includes(d.sourceType)) ||
        d.sourceType === historyFilter;
      const q = historySearch.trim().toLowerCase();
      const matchesSearch =
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.sourceType.toLowerCase().includes(q) ||
        d.summaryText.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [datasets, historyFilter, historySearch]);

  const navItems: { id: NavSection; label: string; icon: React.ReactNode }[] = [
    { id: "home", label: t("navHome"), icon: <Home className="w-4 h-4" /> },
    ...(currentDataset
      ? [
          {
            id: "analysis" as NavSection,
            label: t("navAnalysis"),
            icon: <BarChart3 className="w-4 h-4" />,
          },
        ]
      : []),
    { id: "recent", label: t("navRecent"), icon: <Clock className="w-4 h-4" /> },
    { id: "history", label: t("navHistory"), icon: <List className="w-4 h-4" /> },
    { id: "settings", label: t("navSettings"), icon: <Settings className="w-4 h-4" /> },
    { id: "profile", label: t("navProfile"), icon: <User className="w-4 h-4" /> },
  ];

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      analyzeUploadedFile(file);
    }
  };

  return (
    <LanguageProvider languageSetting={settings.language || "auto"}>
      <div className="min-h-screen flex flex-col bg-[#EEF4FB] text-slate-900">
        {/* Compact Persistent Top Bar with Sidebar Toggle (Desktop & Mobile) */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200/80 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-4 h-4 text-[#1E88E5]" />
              ) : (
                <PanelLeftOpen className="w-4 h-4 text-[#1E88E5]" />
              )}
              <span className="hidden sm:inline">{t("menuAndFolders")}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveNav("home")}
              className="text-left focus:outline-none"
              aria-label="Go to Data Input"
            >
              <BrandLogo darkText />
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
              <Globe className="w-3.5 h-3.5 text-[#1E88E5] shrink-0" />
              <select
                aria-label="App Language"
                value={settings.language || "auto"}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none max-w-[130px]"
              >
                {SUPPORTED_LANGUAGES.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.nativeLabel}
                  </option>
                ))}
              </select>
            </div>

            {activeNav !== "home" && (
              <button
                type="button"
                onClick={() => setActiveNav("home")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5 text-[#1E88E5]" />
                {t("newData")}
              </button>
            )}
            {currentDataset && activeNav !== "analysis" && (
              <button
                type="button"
                onClick={() => setActiveNav("analysis")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E88E5] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1976D2] transition-colors whitespace-nowrap"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                {t("viewCharts")}
              </button>
            )}
          </div>
        </header>

      {/* Slide-Over Collapsible Sidebar Drawer (Hidden by default so full width stays free) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/45"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-[#0F213D] text-white flex flex-col h-full z-10 shadow-2xl select-none">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <BrandLogo />
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Hide sidebar"
              >
                <X className="w-4 h-4" />
                <span>{t("hide")}</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-5">
              {/* Primary Navigation */}
              <nav className="space-y-1" aria-label="Primary Navigation">
                {navItems.map((item) => {
                  const active = activeNav === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveNav(item.id);
                        setSidebarOpen(false);
                        setStatusMsg(null);
                        setErrorMsg(null);
                      }}
                      className={`w-full flex items-center gap-3.5 px-5 py-2.5 text-xs font-semibold tracking-wider transition-colors whitespace-nowrap ${
                        active
                          ? "bg-[#1D78D8] text-white"
                          : "text-slate-300 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Folders Section */}
              <div className="px-4 pt-3 border-t border-white/10 space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase text-sky-200">
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span>{t("foldersTitle")}</span>
                  </div>
                </div>

                {/* Create Folder Inline Form */}
                <form onSubmit={handleCreateFolder} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder={t("newFolderPlaceholder")}
                    className="flex-1 min-w-0 rounded-lg bg-white/10 border border-white/15 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-400"
                  />
                  <button
                    type="submit"
                    disabled={creatingFolder || !newFolderName.trim()}
                    className="inline-flex items-center justify-center rounded-lg bg-[#1E88E5] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1976D2] disabled:opacity-45 whitespace-nowrap"
                    aria-label="Create folder"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </form>

                {/* Folder List */}
                <div className="space-y-1">
                  {folders.length === 0 ? (
                    <p className="px-1 text-[11px] text-slate-400 leading-relaxed">
                      {t("foldersEmptyHint")}
                    </p>
                  ) : (
                    folders.map((fld) => {
                      const isSelected =
                        activeNav === "folder" && activeFolder?.id === fld.id;
                      return (
                        <div
                          key={fld.id}
                          className={`group flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
                            isSelected
                              ? "bg-[#1D78D8] text-white"
                              : "text-slate-200 hover:bg-white/10"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => openFolderView(fld, "all", "", "", undefined)}
                            className="flex items-center gap-2 min-w-0 flex-1 text-left"
                          >
                            {isSelected ? (
                              <FolderOpen className="w-4 h-4 shrink-0 text-sky-200" />
                            ) : (
                              <FolderIcon className="w-4 h-4 shrink-0 text-sky-300" />
                            )}
                            <span className="truncate font-medium">{fld.name}</span>
                          </button>

                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            <span className="text-[11px] font-mono tabular-nums text-slate-300">
                              {fld.datasetCount}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteFolder(fld);
                              }}
                              className="p-1 rounded text-slate-400 hover:text-rose-300 transition-colors"
                              aria-label={`Delete folder ${fld.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-white/10 text-[11px] text-slate-400">
              <div className="truncate font-medium text-slate-200">{profile.name}</div>
              <div className="truncate">{profile.role}</div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        <div className="max-w-[1320px] mx-auto space-y-5">
          {/* Hidden global file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.csv,.tsv,.xlsx,.xls,.ods,.json,.docx,.txt,.md,.xml,.html,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) analyzeUploadedFile(f);
              e.target.value = "";
            }}
          />

          {/* Status & Error Banners */}
          {errorMsg && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-rose-500 hover:text-rose-800"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {statusMsg && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <span>{statusMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setStatusMsg(null)}
                className="text-emerald-600 hover:text-emerald-900"
                aria-label="Dismiss notice"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* HOME WORKSPACE (DATA INPUT) */}
          {activeNav === "home" && (
            <div className="max-w-4xl mx-auto space-y-5">
              {/* Centered Welcome Header */}
              <div className="text-center pt-2 pb-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight text-balance">
                  {t("welcomeUser")}, {profile.name}!
                </h1>
                <p className="text-lg sm:text-xl font-semibold text-slate-800 mt-0.5">
                  {t("analyzeYourData")}
                </p>
              </div>

              {/* Data Input Card */}
              <section
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`rounded-2xl bg-white border p-5 sm:p-7 shadow-xs transition-colors ${
                  isDragging
                    ? "border-blue-500 bg-blue-50/40"
                    : "border-slate-200/80"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{t("dataInput")}</h2>
                    <p className="text-xs text-slate-500">
                      {t("dataInputSub")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowTextBox((s) => !s)}
                      className="font-medium text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap"
                    >
                      {showTextBox ? t("hideTextInput") : t("typePasteData")}
                    </button>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <button
                      type="button"
                      onClick={handleAnalyzeSample}
                      disabled={isAnalyzing}
                      className="font-medium text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap disabled:opacity-50"
                    >
                      {t("trySampleReport")}
                    </button>
                  </div>
                </div>

                {/* Optional Save to Folder Selector */}
                {folders.length > 0 && (
                  <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-2 text-xs">
                    <FolderIcon className="w-3.5 h-3.5 text-[#1E88E5] shrink-0" />
                    <label
                      htmlFor="upload-folder-select"
                      className="font-medium text-slate-600 whitespace-nowrap"
                    >
                      {t("saveToFolderOptional")}
                    </label>
                    <select
                      id="upload-folder-select"
                      value={selectedUploadFolderId}
                      onChange={(e) => setSelectedUploadFolderId(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:border-blue-500"
                    >
                      <option value="">{t("noFolderOption")}</option>
                      {folders.map((fld) => (
                        <option key={fld.id} value={fld.id}>
                          {fld.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Quick input bar */}
                {showTextBox && (
                  <div className="mb-4 flex items-center gap-2">
                    <input
                      type="text"
                      value={quickTextInput}
                      onChange={(e) => setQuickTextInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") analyzeTextPayload(quickTextInput);
                      }}
                      placeholder={t("textPlaceholder")}
                      className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <button
                      type="button"
                      onClick={() => analyzeTextPayload(quickTextInput)}
                      disabled={isAnalyzing || !quickTextInput.trim()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E88E5] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1976D2] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Send className="w-4 h-4" />
                      {t("analyzeBtn")}
                    </button>
                  </div>
                )}

                {/* Mobile quick input row */}
                <div className="md:hidden mb-4 flex items-center">
                  <input
                    type="text"
                    value={quickTextInput}
                    onChange={(e) => setQuickTextInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") analyzeTextPayload(quickTextInput);
                    }}
                    placeholder={t("textPlaceholder")}
                    className="flex-1 rounded-l-lg border border-r-0 border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      quickTextInput.trim()
                        ? analyzeTextPayload(quickTextInput)
                        : setVoiceOpen(true)
                    }
                    className="rounded-r-lg bg-[#1E88E5] px-3.5 py-2 text-white flex items-center justify-center"
                    aria-label="Voice or submit input"
                  >
                    {quickTextInput.trim() ? (
                      <Send className="w-5 h-5" />
                    ) : (
                      <Mic className="w-5 h-5" />
                    )}
                  </button>
                </div>

                {/* 3 Signature Action Buttons */}
                <div className="grid grid-cols-3 gap-3 sm:gap-4">
                  <button
                    type="button"
                    disabled={isAnalyzing}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl bg-[#1E88E5] hover:bg-[#1976D2] text-white py-5 sm:py-6 px-2 shadow-xs transition-all active:scale-[0.99] disabled:opacity-60"
                  >
                    <FileText className="w-7 h-7 sm:w-8 sm:h-8" />
                    <span className="text-[11px] sm:text-xs font-bold tracking-wider uppercase text-center whitespace-nowrap">
                      {t("uploadFiles")}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isAnalyzing}
                    onClick={() => setCameraOpen(true)}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl bg-[#F57C20] hover:bg-[#E06B14] text-white py-5 sm:py-6 px-2 shadow-xs transition-all active:scale-[0.99] disabled:opacity-60"
                  >
                    <Camera className="w-7 h-7 sm:w-8 sm:h-8" />
                    <span className="text-[11px] sm:text-xs font-bold tracking-wider uppercase text-center whitespace-nowrap">
                      {t("takePhotoScan")}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isAnalyzing}
                    onClick={() => setVoiceOpen(true)}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl bg-[#10B981] hover:bg-[#059669] text-white py-5 sm:py-6 px-2 shadow-xs transition-all active:scale-[0.99] disabled:opacity-60"
                  >
                    <Mic className="w-7 h-7 sm:w-8 sm:h-8" />
                    <span className="text-[11px] sm:text-xs font-bold tracking-wider uppercase text-center whitespace-nowrap">
                      {t("speakToAnalyze")}
                    </span>
                  </button>
                </div>

                <p className="mt-3 text-center text-xs text-slate-500">
                  {isAnalyzing ? (
                    <span className="font-medium text-blue-700">{analyzeStage}</span>
                  ) : (
                    t("dropHint")
                  )}
                </p>
              </section>

              {/* Quick Resume Card if user already has an analyzed dataset */}
              {currentDataset && !isAnalyzing && (
                <section className="rounded-2xl bg-white border border-slate-200/80 px-5 py-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {t("latestAnalyzedReport")}
                    </div>
                    <div className="text-sm font-bold text-slate-900 truncate mt-0.5">
                      {currentDataset.name}
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums">
                      {currentDataset.rowCount.toLocaleString()} records ·{" "}
                      {currentDataset.cleanlinessScore}% accuracy ·{" "}
                      {currentDataset.sourceType.toUpperCase()}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveNav("analysis")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
                  >
                    <BarChart3 className="w-4 h-4" />
                    {t("openChartsInsights")}
                  </button>
                </section>
              )}
            </div>
          )}

          {/* DEDICATED ANALYSIS PAGE (FULL-WIDTH CHARTS & INSIGHTS) */}
          {activeNav === "analysis" && (
            <div className="space-y-5">
              {/* Top Action & Context Header */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setActiveNav("home")}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 mb-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    {t("backToDataInput")}
                  </button>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">
                    {currentDataset ? currentDataset.name : "Charts & Insights"}
                  </h1>
                  {currentDataset && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5">
                      <span>{currentDataset.sourceType.toUpperCase()}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {currentDataset.rowCount.toLocaleString()} records
                      </span>
                      {currentDataset.cleaningSummary.sorted_by && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            Auto-sorted by {currentDataset.cleaningSummary.sorted_by}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {currentDataset && (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Save to Folder Selector */}
                    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                      <FolderIcon className="w-3.5 h-3.5 text-[#1E88E5] shrink-0" />
                      <select
                        aria-label="Save report to folder"
                        value={currentDataset.folderId || ""}
                        onChange={(e) =>
                          handleAssignDatasetFolder(
                            currentDataset.id,
                            e.target.value || null
                          )
                        }
                        className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none max-w-[160px]"
                      >
                        <option value="">{t("saveToFolderPlaceholder")}</option>
                        {folders.map((fld) => (
                          <option key={fld.id} value={fld.id}>
                            {fld.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {currentDataset.charts.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center rounded-lg bg-white border border-slate-200 p-0.5 text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              setVisibleChartCount(1);
                              setHiddenChartIndices((prev) => prev.filter((i) => i !== 0));
                            }}
                            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                              visibleChartCount === 1
                                ? "bg-[#1E88E5] text-white"
                                : "text-slate-600 hover:text-slate-900"
                            }`}
                          >
                            {t("oneChart")}
                          </button>
                          <button
                            type="button"
                            onClick={handleAddSecondChart}
                            className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                              visibleChartCount === 2
                                ? "bg-[#1E88E5] text-white"
                                : "text-slate-600 hover:text-slate-900"
                            }`}
                          >
                            {t("twoCharts")}
                          </button>
                        </div>

                        {currentDataset.columns.filter(
                          (c) => c.type === "numeric" || c.type === "mixed"
                        ).length >= 2 && (
                          <button
                            type="button"
                            onClick={handleCompareAllValuesOneChart}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                              visibleChartCount === 1 &&
                              (currentDataset.charts[0]?.yColumns?.length || 0) >= 2
                                ? "border-[#1E88E5] bg-blue-50 text-[#1E88E5]"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                            title="Compare all items and all numeric metrics together in 1 chart"
                          >
                            {t("allValuesTogether")}
                          </button>
                        )}

                        {hiddenChartIndices.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setHiddenChartIndices([])}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            {t("unhideAll")}
                          </button>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setSqlModalOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                    >
                      <Database className="w-3.5 h-3.5 text-blue-600" />
                      {t("excelSheetSql")}
                    </button>

                    <button
                      type="button"
                      onClick={() => downloadDatasetPdfReport(currentDataset)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E88E5] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1976D2] transition-colors whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t("downloadPdf")}
                    </button>
                  </div>
                )}
              </div>

              {isAnalyzing ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="h-[380px] rounded-2xl bg-white border border-slate-200 animate-pulse" />
                  <div className="h-[380px] rounded-2xl bg-white border border-slate-200 animate-pulse" />
                </div>
              ) : currentDataset ? (
                <>
                  {/* Full-Width Interactive Charts Section */}
                  <section className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-base font-bold text-slate-900">
                          {t("interactiveChartsTitle")}
                        </h2>
                        <p className="text-xs text-slate-500">
                          {t("interactiveChartsSub")}
                        </p>
                      </div>

                      {displayedCharts.filter((_, i) => !hiddenChartIndices.includes(i)).length >= 2 && (
                        crossFilter ? (
                          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-900">
                            <span>
                              Cross-Filter:{" "}
                              <strong className="font-semibold">
                                {crossFilter.columnLabel} = &quot;{crossFilter.value}&quot;
                              </strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => setCrossFilter(null)}
                              className="inline-flex items-center gap-1 rounded-md bg-white border border-blue-200 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                            >
                              <X className="w-3 h-3" />
                              {t("clearCrossFilter")}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded-lg px-2.5 py-1">
                            {t("crossFilterReady")}
                          </span>
                        )
                      )}
                    </div>

                    {displayedCharts.length > 0 ? (
                      (() => {
                        const visibleCount = displayedCharts.filter(
                          (_, i) => !hiddenChartIndices.includes(i)
                        ).length;
                        return (
                          <div
                            className={`grid gap-5 ${
                              displayedCharts.length >= 2 && visibleCount === 2
                                ? "grid-cols-1 lg:grid-cols-2"
                                : "grid-cols-1"
                            }`}
                          >
                            {displayedCharts.map((ch, idx) => {
                              const isHidden = hiddenChartIndices.includes(idx);
                              if (isHidden) {
                                return (
                                  <div
                                    key={ch.id || idx}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3"
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <EyeOff className="w-4 h-4 text-slate-400 shrink-0" />
                                      <div className="min-w-0">
                                        <div className="text-xs font-semibold text-slate-800 truncate">
                                          Chart {idx + 1} Hidden: {ch.title}
                                        </div>
                                        <div className="text-[11px] text-slate-500">
                                          Click Unhide to show this chart again.
                                        </div>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => toggleChartHidden(idx)}
                                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E88E5] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1976D2] transition-colors whitespace-nowrap shrink-0"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      Unhide Chart {idx + 1}
                                    </button>
                                  </div>
                                );
                              }
                              return (
                                <PlotlyChart
                                  key={ch.id || idx}
                                  chart={ch}
                                  rows={currentDataset.rows || []}
                                  columns={currentDataset.columns}
                                  onChangeConfig={(updated) =>
                                    handleChartConfigChange(idx, updated)
                                  }
                                  onChangeColumnFormat={handleColumnFormatChange}
                                  onToggleHide={() => toggleChartHidden(idx)}
                                  crossFilter={visibleCount >= 2 ? crossFilter : null}
                                  isCrossFilterSource={crossFilter?.sourceChartIndex === idx}
                                  onCrossFilterSelect={
                                    visibleCount >= 2
                                      ? (sel) => {
                                          if (!sel) {
                                            setCrossFilter(null);
                                            return;
                                          }
                                          setCrossFilter((prev) => {
                                            if (
                                              prev &&
                                              prev.sourceChartIndex === idx &&
                                              prev.column === sel.column &&
                                              prev.value === sel.value
                                            ) {
                                              return null;
                                            }
                                            return {
                                              ...sel,
                                              sourceChartIndex: idx,
                                              sourceChartTitle: ch.title,
                                            };
                                          });
                                        }
                                      : undefined
                                  }
                                  heightClass={
                                    visibleCount === 1
                                      ? "h-[390px] sm:h-[440px]"
                                      : "h-[350px] sm:h-[390px]"
                                  }
                                />
                              );
                            })}
                          </div>
                        );
                      })()
                    ) : (
                      <div className="rounded-xl border border-slate-200/90 bg-slate-50/50 overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-200/80">
                          <h4 className="text-sm font-semibold text-slate-900">
                            Item &amp; Verbatim Text Records
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            Words and sentences printed directly as recorded (not counted or
                            averaged).
                          </p>
                        </div>
                        <div className="overflow-x-auto max-h-[380px]">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-slate-100/80 text-slate-600 sticky top-0">
                              <tr>
                                {currentDataset.columns.map((c) => (
                                  <th
                                    key={c.name}
                                    className="px-3.5 py-2 font-semibold whitespace-nowrap"
                                  >
                                    {c.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/70 bg-white">
                              {(currentDataset.rows || []).slice(0, 100).map((row, rIdx) => (
                                <tr key={rIdx} className="hover:bg-slate-50">
                                  {currentDataset.columns.map((c) => (
                                    <td key={c.name} className="px-3.5 py-2 text-slate-800">
                                      {row[c.name] === null || row[c.name] === undefined
                                        ? "—"
                                        : String(row[c.name])}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Metrics + Insights Row Below Charts */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                    {/* KPIs & Cleaning Summary */}
                    <section className="lg:col-span-4 rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-xs flex flex-col justify-between gap-5">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                          <div className="text-xs font-medium text-slate-500">
                            {currentDataset.analysisMode === "inventory" ||
                            currentDataset.analysisMode === "text_notes"
                              ? t("totalItems")
                              : t("totalRecords")}
                          </div>
                          <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-1">
                            {currentDataset.rowCount.toLocaleString()}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                            {currentDataset.columnCount} cleaned fields
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                          <div className="text-xs font-medium text-slate-500">
                            {t("dataAccuracy")}
                          </div>
                          <div className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-1">
                            {currentDataset.cleanlinessScore}%
                          </div>
                          <div className="text-[11px] text-emerald-700 font-medium mt-0.5">
                            {currentDataset.analysisMode === "inventory"
                              ? "Item list · No calculations"
                              : currentDataset.analysisMode === "text_notes"
                              ? "Verbatim text preserved"
                              : "Auto-cleaned & sorted"}
                          </div>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-100">
                        <div className="text-[11px] font-semibold text-slate-500 mb-1">
                          {t("autoCleaningPrep")}
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {currentDataset.cleaningSummary.actions.join(" · ")}
                        </p>
                      </div>
                    </section>

                    {/* Important Insights & Summary */}
                    <section className="lg:col-span-8 rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-xs flex flex-col justify-between">
                      <div className="space-y-4">
                        <h2 className="text-lg font-bold text-slate-900">
                          {t("importantInsightsSummary")}
                        </h2>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {currentDataset.summaryText}
                        </p>
                        <ul className="space-y-2.5 text-sm text-slate-800">
                          {currentDataset.insights.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2 leading-snug">
                              <span
                                aria-hidden="true"
                                className="text-slate-400 font-bold mt-0.5"
                              >
                                -
                              </span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>

                        {currentDataset.textNotes && currentDataset.textNotes.length > 0 && (
                          <div className="pt-3 border-t border-slate-100">
                            <div className="text-[11px] font-semibold text-slate-700 mb-1.5">
                              Words &amp; Sentences in Data (Printed Verbatim)
                            </div>
                            <ul className="space-y-1.5 text-xs text-slate-700 max-h-[180px] overflow-y-auto pr-1">
                              {currentDataset.textNotes.map((note, nIdx) => (
                                <li key={nIdx} className="leading-snug">
                                  <span className="font-semibold text-slate-900">
                                    {note.item}
                                  </span>{" "}
                                  <span className="text-slate-400">({note.column}):</span>{" "}
                                  <span className="text-slate-800">&ldquo;{note.value}&rdquo;</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      <div className="pt-5 mt-4 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => downloadDatasetPdfReport(currentDataset)}
                          className="inline-flex items-center gap-2 text-sm font-semibold text-[#1E88E5] hover:text-[#1565C0] transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          {t("downloadFullReportPdf")}
                        </button>
                      </div>
                    </section>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 px-6 text-center space-y-3">
                  <Sparkles className="w-8 h-8 text-blue-500 mx-auto" />
                  <div className="text-sm font-semibold text-slate-800">
                    {t("noDatasetYet")}
                  </div>
                  <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                    {t("noDatasetSub")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveNav("home")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1976D2] transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {t("goToDataInput")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* FOLDER GROWTH COMPARISON VIEW */}
          {activeNav === "folder" && activeFolder && (
            <FolderCompareView
              folder={activeFolder}
              comparison={folderComparison}
              loading={folderLoading}
              period={comparePeriod}
              metric={compareMetric}
              filterCol={compareFilterCol}
              filterValues={compareFilterValues}
              onChangePeriod={(p) => openFolderView(activeFolder, p, compareMetric)}
              onChangeMetric={(m) => openFolderView(activeFolder, comparePeriod, m)}
              onChangeFilter={(col, vals) =>
                openFolderView(activeFolder, comparePeriod, compareMetric, col, vals)
              }
              onOpenDataset={openDatasetById}
              onRemoveFromFolder={(dsId) => handleAssignDatasetFolder(dsId, null)}
              onBackHome={() => setActiveNav("home")}
            />
          )}

          {/* RECENT VIEW */}
          {activeNav === "recent" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">{t("recentAnalyses")}</h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t("recentSub")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveNav("home")}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1976D2] transition-colors whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  {t("newAnalysis")}
                </button>
              </div>

              {datasets.length === 0 ? (
                <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center text-sm text-slate-500">
                  {t("noDatasetSub")}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {datasets.slice(0, 9).map((ds) => (
                    <div
                      key={ds.id}
                      className="rounded-2xl bg-white border border-slate-200 p-5 flex flex-col justify-between gap-4 hover:border-blue-300 transition-colors"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1.5">
                          <span className="font-semibold text-blue-600 uppercase">
                            {ds.sourceType}
                          </span>
                          <span>{new Date(ds.createdAt).toLocaleDateString()}</span>
                        </div>
                        <h3 className="text-base font-bold text-slate-900 truncate">
                          {ds.name}
                        </h3>
                        <p className="text-xs text-slate-600 mt-1.5 line-clamp-2">
                          {ds.summaryText}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                        <div className="text-xs text-slate-600 tabular-nums">
                          {ds.rowCount} rows · {ds.cleanlinessScore}% quality
                        </div>
                        <button
                          type="button"
                          onClick={() => openDatasetById(ds.id)}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
                        >
                          {t("open")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* HISTORY VIEW */}
          {activeNav === "history" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">{t("analysisHistory")}</h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {t("historySub")}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder={t("searchReports")}
                      className="rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1 rounded-xl bg-white border border-slate-200 p-1 text-xs">
                    {["all", "file", "camera", "voice", "text"].map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setHistoryFilter(f)}
                        className={`px-2.5 py-1 rounded-lg font-medium capitalize transition-colors ${
                          historyFilter === f
                            ? "bg-[#1D78D8] text-white"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
                {filteredHistory.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    No matching history records found.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                        <tr>
                          <th className="px-5 py-3 font-semibold">Report Name</th>
                          <th className="px-4 py-3 font-semibold">Source</th>
                          <th className="px-4 py-3 font-semibold">Folder</th>
                          <th className="px-4 py-3 font-semibold text-right">Records</th>
                          <th className="px-4 py-3 font-semibold text-right">Accuracy</th>
                          <th className="px-4 py-3 font-semibold">Date</th>
                          <th className="px-5 py-3 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredHistory.map((ds) => (
                          <tr key={ds.id} className="hover:bg-slate-50/70">
                            <td className="px-5 py-3.5 font-medium text-slate-900">
                              {ds.name}
                            </td>
                            <td className="px-4 py-3.5 text-xs uppercase text-slate-600">
                              {ds.sourceType}
                            </td>
                            <td className="px-4 py-3.5">
                              <select
                                aria-label={`Folder for ${ds.name}`}
                                value={ds.folderId || ""}
                                onChange={(e) =>
                                  handleAssignDatasetFolder(ds.id, e.target.value || null)
                                }
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-blue-500 focus:outline-none max-w-[150px]"
                              >
                                <option value="">None</option>
                                {folders.map((fld) => (
                                  <option key={fld.id} value={fld.id}>
                                    {fld.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-700">
                              {ds.rowCount.toLocaleString()}
                            </td>
                            <td className="px-4 py-3.5 text-right font-mono tabular-nums text-emerald-700">
                              {ds.cleanlinessScore}%
                            </td>
                            <td className="px-4 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                              {new Date(ds.createdAt).toLocaleString()}
                            </td>
                            <td className="px-5 py-3.5 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => openDatasetById(ds.id)}
                                className="text-xs font-semibold text-blue-600 hover:underline mr-3"
                              >
                                {t("viewCharts")}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteDataset(ds.id)}
                                className="text-slate-400 hover:text-rose-600 transition-colors align-middle"
                                aria-label={`Delete ${ds.name}`}
                              >
                                <Trash2 className="w-4 h-4 inline" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SETTINGS VIEW */}
          {activeNav === "settings" && (
            <div className="max-w-2xl space-y-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{t("settingsTitle")}</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t("settingsSub")}
                </p>
              </div>

              <form
                onSubmit={handleSaveSettings}
                className="rounded-2xl bg-white border border-slate-200 p-6 space-y-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <Globe className="w-4 h-4 text-[#1E88E5]" />
                      <span>{t("languageSettingTitle")}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t("languageSettingDesc")}
                    </p>
                  </div>
                  <select
                    aria-label={t("languageSettingTitle")}
                    value={settings.language || "auto"}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    {SUPPORTED_LANGUAGES.map((opt) => (
                      <option key={opt.code} value={opt.code}>
                        {opt.nativeLabel}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {t("autoCleaningTitle")}
                    </div>
                    <p className="text-xs text-slate-500">
                      {t("autoCleaningDesc")}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.auto_clean === "true"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        auto_clean: e.target.checked ? "true" : "false",
                      })
                    }
                    className="h-5 w-5 accent-[#1E88E5]"
                  />
                </div>

                <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-100">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {t("autoSortingTitle")}
                    </div>
                    <p className="text-xs text-slate-500">
                      {t("autoSortingDesc")}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.auto_sort === "true"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        auto_sort: e.target.checked ? "true" : "false",
                      })
                    }
                    className="h-5 w-5 accent-[#1E88E5]"
                  />
                </div>

                <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-100">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {t("defaultChartsTitle")}
                    </div>
                    <p className="text-xs text-slate-500">
                      {t("defaultChartsDesc")}
                    </p>
                  </div>
                  <select
                    value={settings.max_charts}
                    onChange={(e) =>
                      setSettings({ ...settings, max_charts: e.target.value })
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="1">{t("oneChart")}</option>
                    <option value="2">{t("twoCharts")}</option>
                  </select>
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="rounded-xl bg-[#1E88E5] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1976D2] disabled:opacity-50 transition-colors"
                  >
                    {savingSettings ? t("saving") : t("saveSettings")}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* PROFILE VIEW */}
          {activeNav === "profile" && (
            <div className="max-w-2xl space-y-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{t("profileTitle")}</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t("profileSub")}
                </p>
              </div>

              <form
                onSubmit={handleSaveProfile}
                className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {t("displayName")}
                  </label>
                  <input
                    type="text"
                    required
                    value={profile.name}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {t("email")}
                  </label>
                  <input
                    type="email"
                    value={profile.email}
                    onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      {t("role")}
                    </label>
                    <input
                      type="text"
                      value={profile.role}
                      onChange={(e) => setProfile({ ...profile, role: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      {t("organization")}
                    </label>
                    <input
                      type="text"
                      value={profile.organization}
                      onChange={(e) =>
                        setProfile({ ...profile, organization: e.target.value })
                      }
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="pt-3 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="rounded-xl bg-[#1E88E5] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1976D2] disabled:opacity-50 transition-colors"
                  >
                    {savingProfile ? t("saving") : t("saveProfile")}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <CameraModal
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCaptureFile={(file) => analyzeUploadedFile(file, "camera")}
      />

      <VoiceModal
        isOpen={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onSubmitVoice={analyzeVoiceSubmission}
      />

      <SqlExplorerModal
        dataset={currentDataset}
        isOpen={sqlModalOpen}
        onClose={() => setSqlModalOpen(false)}
        onChangeColumnFormat={handleColumnFormatChange}
      />
      </div>
    </LanguageProvider>
  );
}
