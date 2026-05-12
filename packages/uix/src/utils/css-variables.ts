export type CssVariableMap = Record<`--${string}`, string>;

export function createCssVariableMap(
  prefix: string,
  values: Record<string, string | number>,
): CssVariableMap {
  return Object.entries(values).reduce<CssVariableMap>(
    (variables, [key, value]) => ({
      ...variables,
      [`--${prefix}-${key}`]: String(value),
    }),
    {},
  );
}
