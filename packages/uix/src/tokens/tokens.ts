import { colors } from "./colors";
import { radius } from "./radius";
import { shadows } from "./shadows";
import { spacing } from "./spacing";
import { typography } from "./typography";
import { zIndex } from "./z-index";

export const tokens = {
  colors,
  radius,
  shadows,
  spacing,
  typography,
  zIndex,
} as const;

export type Tokens = typeof tokens;
