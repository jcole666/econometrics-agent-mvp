/// <reference types="vite/client" />

interface Window {
  workbench?: {
    platform: string;
    onOpenModelSettings?: (callback: () => void) => void;
    saveTextFile?: (payload: { fileName: string; content: string }) => Promise<SaveFileResult>;
    saveReportPdf?: (payload: { fileName: string; title: string; markdown: string }) => Promise<SaveFileResult>;
  };
}

interface SaveFileResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}
