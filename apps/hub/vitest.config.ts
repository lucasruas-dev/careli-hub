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
    // ⚠️ 15 s, E NÃO OS 5 s PADRÃO, por uma razão medida em 24/09/2026: a suíte passou de 8.300
    // testes e o vitest abre um worker por núcleo (36 processos node medidos nesta máquina de 32
    // núcleos). Não falta memória — 6,1 GB usados, 11,3 GB livres —, falta CPU por processo: um
    // arquivo que roda em 800 ms isolado leva 15 s quando os 36 disputam, e o teto de 5 s reprova
    // teste que está CERTO, só lento.
    //
    // O sintoma era um hook de pre-push barrando com arquivos vermelhos DIFERENTES a cada rodada,
    // todos passando isolados, enquanto a mesma suíte fechava verde rodada à mão. Custou seis
    // pushes barrados para eu parar de culpar a máquina e medir.
    //
    // ⚠️ ISTO NÃO AFROUXA NADA: o teste continua tendo de passar. O que muda é só o fôlego de um
    // ambiente disputado. Se um teste passar a DEPENDER desses 15 s, ele é lento demais e o lugar
    // de resolver é nele, não aqui.
    testTimeout: 15_000,
    // O mesmo vale para os ganchos: `beforeAll` que monta fixture pesada sofre a mesma disputa.
    hookTimeout: 15_000,
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
