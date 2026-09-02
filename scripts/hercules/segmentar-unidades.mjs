// SEGMENTA AS UNIDADES DO PAI POR VISÃO — preenche `hercules_unidades.segmento_id` (migration 0123).
//
// Lucas (02/09/2026): *"o espelho sempre será o pai, porque lá que vai morar todos os registros,
// vendas"* · *"os filhos podem ter visões segmentadas"*.
//
// O QUE FAZ: para cada PAI com id do C2X e com filhos (Vale do Ouro = VLO com VOC/VOL/VOR; Lagoa
// Bonita = LAB com LBF/LBR/LBP), pega as unidades do pai e descobre a que filho cada uma pertence
// cruzando (quadra, lote) com as unidades que o C2X guarda na divisão do filho. É a mesma chave de
// cruzamento que a memória da Lagoa Bonita registra ("chave de cruzamento é (block, lot)").
//
// ⚠️ NÃO USA O CÓDIGO: o código do espelho é LABC0101 e o da gleba é LBRC0101 — o prefixo muda, a
//    quadra e o lote não.
// ⚠️ UNIDADE DO PAI SEM PAR EM NENHUM FILHO fica com segmento nulo, e a tela mostra ZERO na visão
//    (nunca o conjunto inteiro — ver lib/hercules/empreendimentos.ts). Aparece na saída para o
//    Lucas decidir.
// ⚠️ UNIDADE COM PAR EM DOIS FILHOS é erro de cadastro do C2X: fica nula e aparece na saída.
// ⚠️ SÓ GRAVA COM `--gravar`.
//
// Uso (da RAIZ do monorepo):
//   node scripts/hercules/segmentar-unidades.mjs            # ensaio
//   node scripts/hercules/segmentar-unidades.mjs --gravar   # grava

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { createClient } = requireDoRepo("@supabase/supabase-js");

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const GRAVAR = process.argv.includes("--gravar");
const WORKSPACE = "careli";

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const chave = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!url || !chave) {
  console.error("Sem NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no apps/hub/.env.local.");
  process.exit(1);
}
const supabase = createClient(url, chave, { auth: { persistSession: false } });

// ⚠️ PostgREST corta em 1.000 linhas sem erro: pagina sempre.
async function todas(tabela, montar) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar(supabase.from(tabela)).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) return linhas;
  }
}

function chaveQL(u) {
  const quadra = String(u.quadra ?? "").trim().toUpperCase().replace(/^0+(?=\d)/, "");
  const lote = String(u.lote ?? "").trim().toUpperCase().replace(/^0+(?=\d)/, "");
  return quadra && lote ? `${quadra}|${lote}` : null;
}

const cadastro = await todas("hercules_empreendimentos", (q) =>
  q.select("id,codigo,nome,pai_id,c2x_enterprise_id").eq("workspace_id", WORKSPACE),
);
const pais = cadastro.filter((e) => e.pai_id === null && e.c2x_enterprise_id);

let totalGravar = 0;
for (const pai of pais) {
  const filhos = cadastro.filter((e) => e.pai_id === pai.id && e.c2x_enterprise_id);
  if (filhos.length === 0) continue;

  const doPai = await todas("hercules_unidades", (q) =>
    q.select("id,codigo,quadra,lote,segmento_id").eq("workspace_id", WORKSPACE).eq("enterprise_id", pai.c2x_enterprise_id),
  );

  // (quadra|lote) → lista de filhos que têm essa unidade na divisão deles.
  const donos = new Map();
  for (const f of filhos) {
    const daDivisao = await todas("hercules_unidades", (q) =>
      q.select("quadra,lote").eq("workspace_id", WORKSPACE).eq("enterprise_id", f.c2x_enterprise_id),
    );
    for (const u of daDivisao) {
      const k = chaveQL(u);
      if (!k) continue;
      const lista = donos.get(k) ?? [];
      if (!lista.includes(f.id)) lista.push(f.id);
      donos.set(k, lista);
    }
  }

  const porFilho = new Map(filhos.map((f) => [f.id, 0]));
  const semPar = [];
  const ambiguas = [];
  const atualizacoes = [];
  for (const u of doPai) {
    const k = chaveQL(u);
    const lista = k ? donos.get(k) ?? [] : [];
    if (lista.length === 1) {
      porFilho.set(lista[0], porFilho.get(lista[0]) + 1);
      if (u.segmento_id !== lista[0]) atualizacoes.push({ id: u.id, segmento_id: lista[0] });
    } else if (lista.length > 1) {
      ambiguas.push(u.codigo);
      if (u.segmento_id !== null) atualizacoes.push({ id: u.id, segmento_id: null });
    } else {
      semPar.push(u.codigo);
      if (u.segmento_id !== null) atualizacoes.push({ id: u.id, segmento_id: null });
    }
  }

  console.log(`\n${pai.codigo} ${pai.nome}: ${doPai.length} unidades do pai`);
  for (const f of filhos) console.log(`  visão ${f.codigo.padEnd(4)} ← ${porFilho.get(f.id)} unidades`);
  console.log(`  sem par em filho: ${semPar.length}${semPar.length ? " → " + semPar.slice(0, 12).join(", ") + (semPar.length > 12 ? "…" : "") : ""}`);
  if (ambiguas.length) console.log(`  ⚠️ em DOIS filhos (ficam sem segmento): ${ambiguas.slice(0, 12).join(", ")}`);
  console.log(`  ${GRAVAR ? "gravando" : "gravaria"} ${atualizacoes.length} atualização(ões)`);
  totalGravar += atualizacoes.length;

  if (!GRAVAR) continue;
  for (const a of atualizacoes) {
    const { error } = await supabase.from("hercules_unidades").update({ segmento_id: a.segmento_id }).eq("id", a.id);
    if (error) {
      console.error(`  falha em ${a.id}: ${error.message}`);
      process.exit(1);
    }
  }
}

console.log(GRAVAR ? `\n${totalGravar} unidade(s) segmentada(s).` : `\nEnsaio: ${totalGravar} atualização(ões). Rode com --gravar para valer.`);
