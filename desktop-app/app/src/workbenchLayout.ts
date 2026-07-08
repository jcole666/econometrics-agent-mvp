const LAYOUT_WIDTHS_KEY = "econometrics-agent.layout-widths";
const PANEL_HEIGHTS_KEY = "econometrics-agent.panel-heights";

const DEFAULT_RAIL_WIDTHS = { left: 330, right: 360 };

export const MIN_LEFT_RAIL = 280;
export const MIN_MAIN_RAIL = 420;
export const MIN_RIGHT_RAIL = 320;
export const COLUMN_RESIZER_WIDTH = 12;

export const DEFAULT_PANEL_HEIGHTS = {
  left: { data: 540, variables: 420, report: 310 },
  main: { question: 220, profile: 300, path: 360, recommendation: 280, result: 280 },
  right: { chat: 660 }
};

const PANEL_MIN_HEIGHTS = {
  data: 360,
  question: 170,
  variables: 280,
  report: 220,
  profile: 220,
  path: 240,
  recommendation: 220,
  result: 220,
  chat: 360
};

export type RailId = keyof typeof DEFAULT_PANEL_HEIGHTS;
export type PanelId = keyof typeof PANEL_MIN_HEIGHTS;
export type PanelHeights = Record<RailId, Partial<Record<PanelId, number>>>;

export interface RailWidths {
  left: number;
  right: number;
}

export function clamp(value: number, min: number, max: number): number {
  const upper = Math.max(min, max);
  return Math.min(Math.max(value, min), upper);
}

function readableSize(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function fitRailWidths(widths: RailWidths, railSpace: number): RailWidths {
  let left = Math.max(MIN_LEFT_RAIL, readableSize(widths.left, DEFAULT_RAIL_WIDTHS.left));
  let right = Math.max(MIN_RIGHT_RAIL, readableSize(widths.right, DEFAULT_RAIL_WIDTHS.right));

  if (!Number.isFinite(railSpace) || railSpace <= 0) {
    return { left, right };
  }

  const sideSpace = railSpace - MIN_MAIN_RAIL;
  if (sideSpace < MIN_LEFT_RAIL + MIN_RIGHT_RAIL) {
    return { left: MIN_LEFT_RAIL, right: MIN_RIGHT_RAIL };
  }

  right = clamp(right, MIN_RIGHT_RAIL, sideSpace - MIN_LEFT_RAIL);
  left = clamp(left, MIN_LEFT_RAIL, sideSpace - right);
  return { left, right };
}

export function loadRailWidths(): RailWidths {
  try {
    const raw = localStorage.getItem(LAYOUT_WIDTHS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return fitRailWidths(
      {
        left: readableSize(parsed.left, DEFAULT_RAIL_WIDTHS.left),
        right: readableSize(parsed.right, DEFAULT_RAIL_WIDTHS.right)
      },
      0
    );
  } catch {
    return DEFAULT_RAIL_WIDTHS;
  }
}

export function saveRailWidths(widths: RailWidths): void {
  try {
    localStorage.setItem(LAYOUT_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
  }
}

export function panelMinHeight(panelId: PanelId): number {
  return PANEL_MIN_HEIGHTS[panelId] ?? 180;
}

export function defaultPanelHeight(rail: RailId, panelId: PanelId): number {
  const defaults = DEFAULT_PANEL_HEIGHTS[rail] as Partial<Record<PanelId, number>>;
  return defaults[panelId] ?? panelMinHeight(panelId);
}

export function loadPanelHeights(): PanelHeights {
  const heights: PanelHeights = { left: {}, main: {}, right: {} };

  try {
    const raw = localStorage.getItem(PANEL_HEIGHTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    (Object.keys(DEFAULT_PANEL_HEIGHTS) as RailId[]).forEach((rail) => {
      const defaults = DEFAULT_PANEL_HEIGHTS[rail] as Partial<Record<PanelId, number>>;
      Object.keys(defaults).forEach((key) => {
        const panelId = key as PanelId;
        const value = parsed?.[rail]?.[panelId];
        heights[rail][panelId] = Math.max(panelMinHeight(panelId), readableSize(value, defaultPanelHeight(rail, panelId)));
      });
    });
  } catch {
    (Object.keys(DEFAULT_PANEL_HEIGHTS) as RailId[]).forEach((rail) => {
      heights[rail] = { ...(DEFAULT_PANEL_HEIGHTS[rail] as Partial<Record<PanelId, number>>) };
    });
  }

  return heights;
}

export function savePanelHeights(heights: PanelHeights): void {
  try {
    localStorage.setItem(PANEL_HEIGHTS_KEY, JSON.stringify(heights));
  } catch {
  }
}
