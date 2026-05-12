type ClassNameValue = false | null | string | undefined;

export function cx(...values: ClassNameValue[]): string | undefined {
  const className = values.filter(Boolean).join(" ");

  return className.length > 0 ? className : undefined;
}
