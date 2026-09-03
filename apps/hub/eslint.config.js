import { nextJsConfig } from "@repo/eslint-config/next-js";

export default [
  ...nextJsConfig,
  {
    ignores: [
      ".next/**",
      // Código GERADO pelo registro do Plate UI (npx shadcn add @plate/...), 02/09/2026.
      // O `lint` roda com --max-warnings 0 e o only-warn transforma tudo em warning, então
      // qualquer regra da casa que o código do registro não siga derrubaria o build.
      // Se o Lucas preferir lint neles, reverter aqui e corrigir arquivo a arquivo.
      "components/ui/**",
      "components/editor/**",
    ],
  },
];
