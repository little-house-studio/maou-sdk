/**
 * ThemeContext —— 主题 Provider（修复旧 let currentTheme 导出快照 bug）。
 *
 * 旧实现 `export let currentTheme` 被 `import { currentTheme as t }` 拿到导入
 * 时的快照，setTheme 后已挂载组件不刷新。改用 React Context + useState，
 * setTheme 触发订阅组件重渲染。组件用 `useTheme()` 取 tokens，而非顶层导入。
 */

import React, { createContext, useContext, useState, useCallback } from "react";
import type { ThemeTokens } from "./tokens.js";
import { TAU_CETI } from "./tau-ceti.js";

const ThemeContext = createContext<ThemeTokens>(TAU_CETI);
const SetThemeContext = createContext<(t: ThemeTokens) => void>(() => {});

interface ProviderProps {
  initial?: ThemeTokens;
  children: React.ReactNode;
}

export function ThemeProvider({ initial = TAU_CETI, children }: ProviderProps) {
  const [theme, setTheme] = useState<ThemeTokens>(initial);
  const set = useCallback((t: ThemeTokens) => setTheme(t), []);
  return (
    <ThemeContext.Provider value={theme}>
      <SetThemeContext.Provider value={set}>{children}</SetThemeContext.Provider>
    </ThemeContext.Provider>
  );
}

/** 组件内取主题 tokens。 */
export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}

/** 组件内切换主题（阶段 6 热重载用）。 */
export function useSetTheme(): (t: ThemeTokens) => void {
  return useContext(SetThemeContext);
}

export { TAU_CETI };
