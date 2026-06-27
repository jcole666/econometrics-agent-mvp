/// <reference types="vite/client" />

interface Window {
  workbench?: {
    platform: string;
    onOpenModelSettings?: (callback: () => void) => () => void;
  };
}
