/**
 * ThemeContext —— tokens + 完整 LoadedTheme（含 nav / hover）
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";
import type { ThemeTokens } from "./tokens.js";
import {
  getActiveTheme,
  setActiveTheme as setActiveThemeModule,
  type LoadedTheme,
  type ThemeNavConfig,
} from "./load-theme.js";
import { TAU_CETI } from "./tau-ceti.js";

const ThemeContext = createContext<ThemeTokens>(TAU_CETI);
const SetThemeContext = createContext<(t: ThemeTokens) => void>(() => {});
const LoadedThemeContext = createContext<LoadedTheme>(getActiveTheme());
const SetLoadedThemeContext = createContext<
  (t: LoadedTheme, persist?: boolean) => void
>(() => {});

interface ProviderProps {
  initial?: ThemeTokens;
  initialLoaded?: LoadedTheme;
  children: React.ReactNode;
}

export function ThemeProvider({
  initial,
  initialLoaded,
  children,
}: ProviderProps) {
  const boot = initialLoaded ?? getActiveTheme();
  const [loaded, setLoaded] = useState<LoadedTheme>(boot);
  const [theme, setTheme] = useState<ThemeTokens>(
    initial ?? boot.tokens ?? TAU_CETI,
  );

  const set = useCallback((t: ThemeTokens) => setTheme(t), []);
  const setLoadedTheme = useCallback((t: LoadedTheme, persist = false) => {
    setActiveThemeModule(t, persist);
    setLoaded(t);
    setTheme(t.tokens);
  }, []);

  return (
    <ThemeContext.Provider value={theme}>
      <SetThemeContext.Provider value={set}>
        <LoadedThemeContext.Provider value={loaded}>
          <SetLoadedThemeContext.Provider value={setLoadedTheme}>
            {children}
          </SetLoadedThemeContext.Provider>
        </LoadedThemeContext.Provider>
      </SetThemeContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}

export function useSetTheme(): (t: ThemeTokens) => void {
  return useContext(SetThemeContext);
}

/** 完整主题（nav / hover / id） */
export function useLoadedTheme(): LoadedTheme {
  return useContext(LoadedThemeContext);
}

export function useSetLoadedTheme(): (
  t: LoadedTheme,
  persist?: boolean,
) => void {
  return useContext(SetLoadedThemeContext);
}

export function useThemeNav(): ThemeNavConfig {
  return useContext(LoadedThemeContext).nav;
}

export { TAU_CETI };
