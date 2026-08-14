// BACKFILL: liga os vínculos de imobiliária às FICHAS, não a um texto.
//
// O problema: os 4.108 vínculos "Imobiliaria ou responsavel comercial" (escritos pelo sync em
// `lib/apolo/server.ts:4222`) guardam a imobiliária só no `label`, com `related_entity_id` NULO.
// Isso significa que o grafo do CRM não liga o comprador à ficha da imobiliária: quem clica no
// nome não chega a lugar nenhum, e contar imobiliária por vínculo não funciona.
//
// A correção NÃO casa por nome. O C2X tem o id: `users.vinculed_by_id` aponta a imobiliária do
// cliente, e a entidade do Apolo nasce com id determinístico `apolo:c2x:users:<id>`. Então o
// caminho é exato — cliente → vinculed_by_id → uuid determinístico → ficha da imobiliária.
// Casar por nome erraria em homônimo e em grafia divergente, que é justamente o que sobra aqui.
//
//   npx tsx --tsconfig apps/hub/tsconfig.json apps/hub/scripts/backfill-vinculo-imobiliaria.ts
//   npx tsx ... backfill-vinculo-imobiliaria.ts --gravar     <- só então escreve
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { createClient } from "@supabase/supabase-js";

const GRAVAR = process.argv.includes("--gravar");

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

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false } },
);

/** Mesma função do sync (`lib/apolo/server.ts:4931`) — se divergir, o id não casa com a ficha. */
function deterministicUuid(seed: string): string {
  const chars = createHash("sha1").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = (8 + (Number.parseInt(chars[16] ?? "0", 16) % 4)).toString(16);
  const hex = chars.join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

async function rodar() {
  const requireDoRepo = createRequire(path.resolve("apps/hub/package.json"));
  const mysql = requireDoRepo("mysql2/promise");
  const c2x = await mysql.createConnection({
    database: env.GUARDIAN_DB_NAME,
    host: env.GUARDIAN_DB_HOST,
    password: env.GUARDIAN_DB_PASSWORD,
    port: Number(env.GUARDIAN_DB_PORT || 3306),
    user: env.GUARDIAN_DB_USER,
  });

  // 1) Quem tem imobiliária no C2X.
  const [linhas] = (await c2x.query(
    "select id, vinculed_by_id from users where vinculed_by_id is not null",
  )) as [Array<{ id: number; vinculed_by_id: number }>, unknown];
  await c2x.end();

  console.log(`C2X: ${linhas.length} usuários com imobiliária vinculada.`);

  // cliente (uuid do Apolo) -> imobiliária (uuid do Apolo)
  const imobPorCliente = new Map<string, string>();
  for (const linha of linhas) {
    imobPorCliente.set(
      deterministicUuid(`apolo:c2x:users:${linha.id}`),
      deterministicUuid(`apolo:c2x:users:${linha.vinculed_by_id}`),
    );
  }

  // 2) Os vínculos órfãos (sem related_entity_id).
  const orfaos: Array<{ entity_id: string; id: string; label: null | string }> = [];
  for (let pagina = 0; ; pagina += 1) {
    const { data, error } = await supabase
      .from("apolo_relationships")
      .select("id, entity_id, label")
      .ilike("relationship_type", "%imobiliaria%")
      .is("related_entity_id", null)
      .range(pagina * 1000, pagina * 1000 + 999);

    if (error) throw new Error(error.message);
    if (!data?.length) break;
    orfaos.push(...(data as typeof orfaos));
    if (data.length < 1000) break;
  }

  console.log(`Apolo: ${orfaos.length} vínculos de imobiliária SEM ficha ligada.`);

  // 3) Quais fichas de imobiliária existem de fato.
  const alvos = [...new Set([...imobPorCliente.values()])];
  const existe = new Set<string>();
  for (let i = 0; i < alvos.length; i += 300) {
    const { data } = await supabase
      .from("apolo_entities")
      .select("id")
      .in("id", alvos.slice(i, i + 300));
    for (const linha of (data ?? []) as Array<{ id: string }>) existe.add(linha.id);
  }

  const paraGravar: Array<{ id: string; imobiliariaId: string }> = [];
  let semImobNoC2x = 0;
  let fichaInexistente = 0;

  for (const orfao of orfaos) {
    const alvo = imobPorCliente.get(orfao.entity_id);
    if (!alvo) {
      semImobNoC2x += 1;
      continue;
    }
    if (!existe.has(alvo)) {
      fichaInexistente += 1;
      continue;
    }
    paraGravar.push({ id: orfao.id, imobiliariaId: alvo });
  }

  console.log(`\nRESULTADO DO LEVANTAMENTO`);
  console.log(`  ligáveis (cliente tem imobiliária no C2X e a ficha existe): ${paraGravar.length}`);
  console.log(`  cliente sem vinculed_by_id no C2X: ${semImobNoC2x}`);
  console.log(`  imobiliária existe no C2X mas não tem ficha no Apolo: ${fichaInexistente}`);

  if (!GRAVAR) {
    console.log(`\nNADA FOI GRAVADO. Rode com --gravar para aplicar.`);
    return;
  }

  // UM UPDATE POR IMOBILIÁRIA, não por vínculo.
  //
  // A primeira versão fazia 4.106 chamadas em sequência e 1.258 morreram com "fetch failed" —
  // não é erro de dado, é volume de requisição. Agrupando, são ~400 chamadas (uma por
  // imobiliária, com a lista de vínculos dela), e cada uma leva várias linhas de uma vez.
  const porImobiliaria = new Map<string, string[]>();
  for (const item of paraGravar) {
    const lista = porImobiliaria.get(item.imobiliariaId) ?? [];
    lista.push(item.id);
    porImobiliaria.set(item.imobiliariaId, lista);
  }

  console.log(
    `\nGravando ${paraGravar.length} vínculos em ${porImobiliaria.size} grupos (1 por imobiliária)…`,
  );

  let ok = 0;
  let falhas = 0;

  for (const [imobiliariaId, ids] of porImobiliaria) {
    // Lotes de 200 ids por chamada: `.in()` com lista muito grande estoura o tamanho da URL do
    // PostgREST (a mesma armadilha do resto do módulo).
    for (let i = 0; i < ids.length; i += 200) {
      const fatia = ids.slice(i, i + 200);
      let tentativa = 0;

      // Retry com espera: "fetch failed" é transitório, e desistir na primeira deixaria o
      // backfill pela metade — que é pior que não ter começado.
      for (;;) {
        const { error } = await supabase
          .from("apolo_relationships")
          .update({ related_entity_id: imobiliariaId })
          .in("id", fatia)
          // Trava de concorrência: se alguém ligou o vínculo enquanto o script rodava, não
          // sobrescreve. É a mesma condição que o levantou.
          .is("related_entity_id", null);

        if (!error) {
          ok += fatia.length;
          break;
        }

        tentativa += 1;
        if (tentativa >= 3) {
          falhas += fatia.length;
          if (falhas <= 400) console.error(`  falhou grupo ${imobiliariaId}: ${error.message}`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * tentativa));
      }
    }
  }

  console.log(`\nGravados: ${ok} | falhas: ${falhas}`);
}

void rodar();
