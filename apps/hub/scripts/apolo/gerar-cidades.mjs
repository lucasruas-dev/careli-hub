/*
 * REGENERA `lib/apolo/c2x-cidades.ts` a partir da tabela `cities` do C2X — READ-ONLY.
 *
 *   node apps/hub/scripts/apolo/gerar-cidades.mjs
 *
 * A lista alimenta a sugestão do campo de cidade (naturalidade e endereço). A fonte é o C2X
 * porque é ele que recebe o dado no contrato: usar uma lista de fora (IBGE, pacote npm) traria
 * grafias que o legado não conhece.
 *
 * ⚠️ NÃO escreve nada: o único acesso ao legado é um SELECT.
 *
 * Rodar quando o C2X ganhar municípios novos — o que é raro. A última geração trouxe 5.601
 * cidades em 27 UFs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizDoApp = path.join(aqui, "..", "..");

for (const linha of readFileSync(path.join(raizDoApp, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(linha.trim());
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const pool = mysql.createPool({
  connectionLimit: 2,
  database: process.env.GUARDIAN_DB_NAME,
  host: process.env.GUARDIAN_DB_HOST,
  password: process.env.GUARDIAN_DB_PASSWORD,
  port: Number(process.env.GUARDIAN_DB_PORT ?? 3306),
  user: process.env.GUARDIAN_DB_USER,
});

const [rows] = await pool.query(
  `select ci.name, st.acronym as uf
     from cities ci
     join states st on st.id = ci.state_id
    where nullif(trim(ci.name), '') is not null
      and nullif(trim(st.acronym), '') is not null
    order by st.acronym, ci.name`,
);
await pool.end();

const linhas = rows.map((r) => `${String(r.name).trim()}|${String(r.uf).trim().toUpperCase()}`);

const cabecalho = `// CIDADES DO BRASIL, geradas da tabela \`cities\` do C2X (${linhas.length} municípios, 27 UFs).
//
// Pedido do Lucas (21/08/2026): *"esse campo de cidades tem que ser padrão, igual profissão:
// começo a digitar, ele puxa a cidade correta; se quiser colocar um UF antes para mitigar a busca,
// pode colocar"*.
//
// ⚠️ FORMATO COMPACTO "Nome|UF", e não objetos. São ${linhas.length} itens: como array de
// { nome, uf } o arquivo passaria de 300KB. Assim fica perto de um terço disso, e o parse é uma
// linha — ver \`buscarCidades\`.
//
// ⚠️ 247 NOMES SE REPETEM EM UFs DIFERENTES (medido no C2X). É por isso que a UF aparece em toda
// sugestão e que dá para digitá-la junto: sem ela, "Bom Jesus" é ambíguo entre vários estados.
//
// A fonte é o C2X porque é ele que vai receber o dado no contrato. Regenerar:
//   node apps/hub/scripts/apolo/gerar-cidades.mjs
export const C2X_CIDADES: readonly string[] = [
`;

writeFileSync(
  path.join(raizDoApp, "lib", "apolo", "c2x-cidades.ts"),
  cabecalho + linhas.map((l) => `  ${JSON.stringify(l)},`).join("\n") + "\n];\n",
  "utf8",
);

console.log(`c2x-cidades.ts regenerado com ${linhas.length} cidades.`);
