/** Themes for canvas-ui */

export type Color = string;

export interface UiTheme {
  bg: Color;
  panel: Color;
  border: Color;
  borderHi: Color;
  text: Color;
  muted: Color;
  accent: Color;
  danger: Color;
  shadow: Color;
}

/** Warm gallery / retro keep */
export const GALLERY_THEME: UiTheme = {
  bg: "#1a1410",
  panel: "#2a2218",
  border: "#5a4a32",
  borderHi: "#d4a574",
  text: "#e8dcc8",
  muted: "#9a8a70",
  accent: "#c4783a",
  danger: "#b84a3a",
  shadow: "#0c0a08",
};

/** Alias */
export const DUNGEON_THEME = GALLERY_THEME;

/** Paper / ink for filters */
export const FILTER_PALETTE = {
  paper: "#e8e2d6",
  ink: "#12110e",
  paperRgb: [232, 226, 214] as const,
  inkRgb: [18, 17, 14] as const,
};
