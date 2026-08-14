// Teste da resolução de identidade do contato, contra a base real (leitura).
//   npx tsx --tsconfig apps/hub/tsconfig.json <este arquivo>
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { identidadeDoContato } from "@/lib/iris/apolo/identidade-contato";

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve("apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((linha) => linha.includes("=") && !linha.trim().startsWith("#"))
    .map((linha) => {
      const i = linha.indexOf("=");
      return [linha.slice(0, i).trim(), linha.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const client = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? "",
  env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false } },
);

const casos: { esperado: string; telefone: string; titulo: string }[] = [
  { esperado: "entidade", telefone: "553199244799", titulo: "Ingrity (corretora L&I) - como veio no ticket" },
  { esperado: "entidade", telefone: "5531999244799", titulo: "Ingrity - com nono digito" },
  { esperado: "vinculo", telefone: "5537999642521", titulo: "Conjuge de EDI CARLOS (so existe como vinculo)" },
  { esperado: "vinculo", telefone: "3799112897", titulo: "Conjuge de JOSE OSMANDO (10 digitos)" },
  { esperado: "nenhum", telefone: "5511987654321", titulo: "Numero inexistente" },
];

async function rodar() {
  for (const caso of casos) {
    // eslint-disable-next-line no-await-in-loop
    const resultado = await identidadeDoContato(client as never, caso.telefone);
    const bateu = resultado.estado === caso.esperado ? "OK    " : "FALHOU";
    console.log(`\n[${bateu}] ${caso.titulo}`);
    console.log(`   esperado: ${caso.esperado} | veio: ${resultado.estado}`);

    if (resultado.estado === "entidade") {
      console.log(
        `   nome: ${resultado.nome} | doc: ${resultado.documentoMascarado ?? "-"} | via: ${resultado.via}`,
      );
      console.log(`   papeis: ${resultado.papeis.map((p) => p.profile).join(", ") || "-"}`);
      console.log(
        `   vinculos: ${
          resultado.vinculos
            .map((v) => `${v.tipo}${v.entidade ? ` -> ${v.entidade}` : ""}`)
            .join(" | ") || "-"
        }`,
      );
    }
    if (resultado.estado === "vinculo") {
      console.log(`   nome no vinculo: ${resultado.nome ?? "-"}`);
      console.log(
        `   e: ${resultado.vinculos.map((v) => `${v.tipo} de ${v.entidade ?? "?"}`).join(" | ")}`,
      );
    }
    if (resultado.estado === "indisponivel") {
      console.log(`   motivo: ${resultado.motivo}`);
    }
  }
}

void rodar();
