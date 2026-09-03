import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Testes unitários das libs puras do hub (sem Supabase/rede — regressões de
// lógica: datas da Cacá, telefone 9º dígito, formatação WhatsApp, etc.).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // ⚠️ `@platejs/math` importa `katex/dist/katex.min.css` dentro do próprio dist. Como
        // dependência externa o Node tenta carregar o .css e derruba qualquer teste que monte o
        // `BaseEditorKitTemis` (round-trip da Têmis). Inline: o Vite transforma o pacote e o CSS
        // vira no-op, como em qualquer outro import de estilo nos testes.
        inline: ["@platejs/math"],
      },
    },
  },
});
