// REPROCESSA OS EVENTOS DA CLICKSIGN JÁ GUARDADOS: as marcas de quem assinou entram no quadro.
//
// F1 do plano da fonte única (docs/assinatura/fonte-unica-do-contrato.md). Até a 0195 o Panteon não
// guardava QUEM assinou: o dado existia só no payload cru de `temis_assinatura_eventos`. Este script
// lê os payloads CONFERIDOS de cada envelope de CONTRATO, junta as marcas de todos eles e manda para a
// função da 0195 (`temis_envelope_registrar_assinaturas`), a mesma porta que o webhook usa.
//
//   node scripts/temis/reprocessar-eventos-clicksign.mjs            ENSAIO: lê e relata, não grava
//   node scripts/temis/reprocessar-eventos-clicksign.mjs --gravar   grava pela função da 0195
//
// ⚠️ RODE DA RAIZ DO MONOREPO. `--gravar` SÓ COM OK DO LUCAS, e só depois da 0195 aplicada.
//
// ⚠️ A REGRA NÃO MORA AQUI. Quem lê o payload é `apps/hub/lib/assinatura/marcas.ts` (carregado pelo
// `jiti`, o padrão de `scripts/lsoft/reconciliar-trilha.mjs`) e quem decide o que vale é a função
// SQL. O "depois" do ensaio é uma PREVISÃO só para o relatório: o número de verdade é o que a função
// devolve no `--gravar`.
//
// ⚠️ SÓ CONTRATO (`finalidade = 'contrato'`). Os 18 acordos do Hades não são tocados (prova antes e
// depois na seção F1 do plano). Esperado em 28/09/2026: 8 envelopes de contrato.
//
// ⚠️ SEM DADO PESSOAL NA SAÍDA: só ids, contagens e estados. Nem nome, nem e-mail.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { createClient } = req("@supabase/supabase-js");
const { createJiti } = req("jiti");

const jiti = createJiti(import.meta.url);
const { marcasDoPayloadDaClicksign } = await jiti.import(
  path.resolve(process.cwd(), "apps/hub/lib/assinatura/marcas.ts"),
);

const gravar = process.argv.includes("--gravar");

// O worktree não tem .env.local (não é versionado): cai no do checkout principal.
const ENV_LOCAL = [
  path.resolve(process.cwd(), "apps/hub/.env.local"),
  path.resolve(process.cwd(), "../../careli-hub/apps/hub/.env.local"),
].find((p) => fs.existsSync(p));
if (!ENV_LOCAL) throw new Error("não achei apps/hub/.env.local");

const env = Object.fromEntries(
  fs
    .readFileSync(ENV_LOCAL, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Só `code` e `message`: o erro inteiro do PostgREST pode trazer a linha com o jsonb do quadro. */
function semDado(erro) {
  return `${erro?.code ?? ""} ${erro?.message ?? ""}`.trim();
}

// ⚠️ PostgREST corta em 1.000 linhas SEM ERRO, e paginar SEM ORDEM perde linha com o total batendo.
async function lerPaginado(montar) {
  const linhas = [];
  const passo = 1000;
  for (let de = 0; ; de += passo) {
    const { data, error } = await montar().order("id").range(de, de + passo - 1);
    if (error) throw new Error(semDado(error));
    linhas.push(...(data ?? []));
    if (!data || data.length < passo) break;
  }
  const distintos = new Set(linhas.map((l) => l.id)).size;
  if (distintos !== linhas.length) throw new Error("leitura instável (ids repetidos), abortado");
  return linhas;
}

/** A marca no formato do jsonb que a função lê. */
function paraOBanco(marca) {
  const saida = {};
  if (marca.chave) saida.chave = marca.chave;
  if (marca.email) saida.email = marca.email;
  if (marca.assinadoEm) saida.assinado_em = marca.assinadoEm;
  if (marca.recusadoEm) saida.recusado_em = marca.recusadoEm;
  if (marca.conviteFalhouEm) saida.convite_falhou_em = marca.conviteFalhouEm;
  if (marca.conviteEntregueEm) saida.convite_entregue_em = marca.conviteEntregueEm;
  return saida;
}

/** A previsão do relatório: quantos itens do quadro teriam assinatura depois (chave; e-mail só se único). */
function assinariamDepois(quadro, marcas) {
  const itens = Array.isArray(quadro) ? quadro : [];
  let n = 0;
  for (const item of itens) {
    if (item && typeof item.assinado_em === "string" && item.assinado_em) {
      n += 1;
      continue;
    }
    const email = String(item?.email ?? "").toLowerCase();
    const unico = itens.filter((o) => String(o?.email ?? "").toLowerCase() === email).length === 1;
    const casa = marcas.some(
      (m) =>
        m.assinadoEm &&
        ((m.chave && m.chave === item?.chave) ||
          (!itens.some((o) => m.chave && o?.chave === m.chave) && unico && m.email === email)),
    );
    if (casa) n += 1;
  }
  return n;
}

const envelopes = await lerPaginado(() =>
  supabase
    .from("temis_envelopes")
    .select("id, estado, provedor_documento_id, signatarios")
    .eq("provedor", "clicksign")
    .eq("finalidade", "contrato"),
).catch((falha) => {
  throw new Error(
    `não consegui ler os envelopes de contrato (${falha.message}). A 0195 foi aplicada? Sem ela não há a coluna finalidade.`,
  );
});

console.log(`${gravar ? "GRAVANDO" : "ENSAIO"} · ${envelopes.length} envelope(s) de contrato da Clicksign`);

let totalDeMarcas = 0;
for (const envelope of envelopes) {
  const doc = envelope.provedor_documento_id;
  const quadro = Array.isArray(envelope.signatarios) ? envelope.signatarios : [];
  const antes = quadro.filter((i) => i && typeof i.assinado_em === "string" && i.assinado_em).length;
  if (!doc) {
    console.log(`${envelope.id} · sem documento: pulado`);
    continue;
  }

  // ⚠️ TODOS os payloads CONFERIDOS do documento, e a UNIÃO das marcas (medido: o último payload já
  // é a união em 10 de 10, mas um payload pobre no fim não pode apagar o que os outros contaram).
  const eventos = await lerPaginado(() =>
    supabase
      .from("temis_assinatura_eventos")
      .select("id, payload")
      .eq("provedor", "clicksign")
      .eq("provedor_documento_id", doc)
      .eq("assinatura_conferida", true),
  );
  const vistas = new Set();
  const marcas = [];
  for (const evento of eventos) {
    for (const marca of marcasDoPayloadDaClicksign(evento.payload)) {
      const chave = JSON.stringify(marca);
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      marcas.push(marca);
    }
  }
  totalDeMarcas += marcas.length;

  if (!gravar) {
    console.log(
      `${envelope.id} · ${envelope.estado} · ${eventos.length} evento(s) · ${marcas.length} marca(s) · assinaram ${antes} → ${assinariamDepois(quadro, marcas)} (previsto) · total ${quadro.length}`,
    );
    continue;
  }

  const { data, error } = await supabase.rpc("temis_envelope_registrar_assinaturas", {
    p_documento: doc,
    p_envelope: envelope.id,
    p_marcas: marcas.map(paraOBanco),
  });
  if (error) {
    console.log(`${envelope.id} · FALHOU: ${semDado(error)}`);
    continue;
  }
  const linha = Array.isArray(data) ? data[0] : data;
  console.log(
    `${envelope.id} · ${linha?.recusa ? `RECUSADO (${linha.recusa})` : `${linha?.estado_antes} → ${linha?.estado_depois}`} · assinaram ${antes} → ${linha?.assinaram ?? "?"} · total ${linha?.total ?? quadro.length}`,
  );
}

console.log(`${totalDeMarcas} marca(s) no total.${gravar ? "" : " Nada foi gravado (ensaio)."}`);
