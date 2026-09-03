import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn` do shadcn: todo item do registro do Plate UI importa `@/lib/utils`
 * (é o alias `utils` do components.json). Junta classes condicionais (clsx) e
 * resolve conflitos de utilitários Tailwind (twMerge: `px-2 px-4` vira `px-4`).
 *
 * ⚠️ Não trocar pelo `cx` do @repo/uix: ele só concatena e não faz o merge,
 * então `className` passado por fora de um componente do Plate não venceria
 * a classe padrão.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
