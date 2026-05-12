"use client";

import {
  defaultTheme,
  density,
  getDensityCssVariables,
  getThemeCssVariables,
  type DensityMode,
  type ThemeMode,
} from "@repo/uix";
import { useEffect } from "react";

const themeMode: ThemeMode = defaultTheme.mode;
const densityMode: DensityMode = defaultTheme.density;

export function ThemeProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  useEffect(() => {
    const root = document.documentElement;
    const variables = {
      ...getThemeCssVariables(defaultTheme),
      ...getDensityCssVariables(density[densityMode]),
    };

    root.dataset.uixTheme = themeMode;
    root.dataset.uixDensity = densityMode;

    Object.entries(variables).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });
  }, []);

  return <>{children}</>;
}
