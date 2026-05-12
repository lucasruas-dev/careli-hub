export const zIndex = {
  base: 0,
  raised: 10,
  sticky: 100,
  overlay: 400,
  modal: 500,
  toast: 600,
} as const;

export type ZIndex = typeof zIndex;
