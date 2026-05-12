export const shadows = {
  none: "none",
  xs: "0 1px 2px rgb(18 23 34 / 0.06)",
  sm: "0 2px 6px rgb(18 23 34 / 0.08)",
  md: "0 8px 24px rgb(18 23 34 / 0.10)",
} as const;

export type Shadows = typeof shadows;
