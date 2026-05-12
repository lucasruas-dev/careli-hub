import { spacing } from "../tokens/spacing";

export const density = {
  comfortable: {
    controlHeight: "2.5rem",
    gap: spacing[3],
    paddingX: spacing[4],
    paddingY: spacing[3],
  },
  compact: {
    controlHeight: "2rem",
    gap: spacing[2],
    paddingX: spacing[3],
    paddingY: spacing[2],
  },
} as const;

export type Density = typeof density;
