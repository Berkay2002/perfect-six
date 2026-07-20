"use client";

import { Theme } from "@astryxdesign/core/theme";
import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { perfectSixTheme } from "@/theme/perfect-six";

export type ColorMode = "light" | "dark";

export const THEME_KEY = "perfect-six:theme";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ColorMode>("light");

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    const preferred =
      saved === "light" || saved === "dark"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    const timer = window.setTimeout(() => setMode(preferred), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    window.localStorage.setItem(THEME_KEY, mode);
  }, [mode]);

  return (
    <Theme theme={perfectSixTheme} mode={mode}>
      <ColorModeContext.Provider value={{ mode, setMode }}>
        {children}
      </ColorModeContext.Provider>
    </Theme>
  );
}

const ColorModeContext = createContext<{
  mode: ColorMode;
  setMode: (mode: ColorMode) => void;
} | null>(null);

export function useColorMode() {
  const context = useContext(ColorModeContext);
  if (!context) throw new Error("useColorMode must be used in AppProviders.");
  return context;
}
