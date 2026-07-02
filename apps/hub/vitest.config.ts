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
  },
});
