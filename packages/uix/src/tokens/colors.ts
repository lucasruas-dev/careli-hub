export const brandColors = {
  primary: "#A07C3B",
} as const;

export const colors = {
  brand: brandColors,
  neutral: {
    0: "#FFFFFF",
    50: "#F7F8FA",
    100: "#EEF1F4",
    200: "#DCE2EA",
    300: "#C5CEDA",
    400: "#98A4B4",
    500: "#667085",
    600: "#485466",
    700: "#30394A",
    800: "#1F2633",
    900: "#121722",
    950: "#090D14",
  },
  intent: {
    info: "#2563EB",
    success: "#14804A",
    warning: "#B7791F",
    danger: "#C24135",
  },
} as const;

export type BrandColors = typeof brandColors;
export type Colors = typeof colors;
