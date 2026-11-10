/// <reference types="vite/client" />

interface Window {
  workbench?: {
    platform: string;
    localToken?: string;
    onOpenModelSettings?: (callback: () => void) => () => void;
    onDataFileSelected?: (callback: (payload: SelectedDataFile) => void) => () => void;
    onSidecarStatus?: (callback: (payload: { ready: boolean; message: string }) => void) => () => void;
    saveTextFile?: (payload: { fileName: string; content: string }) => Promise<SaveFileResult>;
    saveReportPdf?: (payload: { fileName: string; title: string; markdown: string }) => Promise<SaveFileResult>;
    saveImageFile?: (payload: { fileName: string; dataUrl: string }) => Promise<SaveFileResult>;
  };
}

interface SelectedDataFile {
  name: string;
  data: ArrayBuffer;
}

interface SaveFileResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}
