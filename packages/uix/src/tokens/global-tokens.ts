import { cssVariables } from "./css-variables";
import { tokens } from "./tokens";

export const globalTokens = {
  tokens,
  cssVariables,
} as const;

export type GlobalTokens = typeof globalTokens;
