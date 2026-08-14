// Tipos de vínculo que o operador pode criar do cockpit.
//
// ⚠️ ARQUIVO SEM IMPORT NENHUM, DE PROPÓSITO. Esta lista é usada pelo modal (componente de
// browser) e pela camada de escrita (servidor). Enquanto ela morava em `escrita-contato.ts`, o
// modal arrastava para o bundle do navegador toda a cadeia `lib/apolo/server` → `lib/guardian/db`
// → `mysql2` → `node:buffer`, e a página da Iris parava de compilar com
// "UnhandledSchemeError: Reading from node:buffer". O typecheck passa nesse caso: só o bundler
// reclama, e só quando alguém abre a tela.
//
// Lista FECHADA: vínculo é estrutura do CRM. Texto livre aqui vira dez grafias para a mesma
// relação e ninguém mais consegue contar quantos cônjuges existem na base.
export const VINCULOS_DO_COCKPIT = [
  { rotulo: "Cônjuge", valor: "conjuge" },
  { rotulo: "Corretor", valor: "corretor" },
  { rotulo: "Representante legal", valor: "representante_legal" },
  { rotulo: "Sócio", valor: "socio" },
] as const;
