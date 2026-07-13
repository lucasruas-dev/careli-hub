"use client";

import {
  defaultTheme,
  density,
  getDensityCssVariables,
  themeCssVariables,
  type DensityMode,
  type ThemeMode,
} from "@repo/uix";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "careli:hub-theme";
const densityMode: DensityMode = defaultTheme.density;

// Paleta ESCURA no tom do WhatsApp (Lucas 12/jul): sobrescreve surfaces/textos/bordas do
// uix no modo escuro. Aplicada inline no :root, entao vale pra TODAS as telas de uma vez.
const DARK_TONES: Record<string, string> = {
  "--uix-surface-canvas": "#101211",
  "--uix-surface-base": "#181a19",
  "--uix-surface-raised": "#26292a",
  "--uix-surface-subtle": "#1c1e1d",
  "--uix-text-primary": "#e9edeb",
  "--uix-text-secondary": "#cfd3d0",
  "--uix-text-muted": "#98a09a",
  "--uix-border-subtle": "#2b2e2c",
  "--uix-border-strong": "#3a3e3c",
};

type HubThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const HubThemeContext = createContext<HubThemeContextValue | null>(null);

function readStoredMode(): ThemeMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Comeca no tema padrao (claro) pra bater com o SSR; a preferencia salva entra no mount.
  const [mode, setModeState] = useState<ThemeMode>(defaultTheme.mode);

  useEffect(() => {
    const stored = readStoredMode();
    if (stored) {
      setModeState(stored);
    }
  }, []);

  // Aplica os tokens do tema (e da densidade) no :root sempre que o modo muda.
  useEffect(() => {
    const root = document.documentElement;
    const variables: Record<string, string> = {
      ...themeCssVariables[mode],
      ...getDensityCssVariables(density[densityMode]),
      ...(mode === "dark" ? DARK_TONES : {}),
    };

    root.dataset.uixTheme = mode;
    root.dataset.uixDensity = densityMode;
    root.style.colorScheme = mode;

    Object.entries(variables).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // preferencia so em memoria se o storage falhar
    }
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  const value = useMemo<HubThemeContextValue>(
    () => ({ mode, setMode, toggle }),
    [mode, setMode, toggle],
  );

  return (
    <HubThemeContext.Provider value={value}>
      {children}
    </HubThemeContext.Provider>
  );
}

export function useHubTheme(): HubThemeContextValue {
  const context = useContext(HubThemeContext);

  if (!context) {
    throw new Error("useHubTheme deve ser usado dentro do ThemeProvider");
  }

  return context;
}
