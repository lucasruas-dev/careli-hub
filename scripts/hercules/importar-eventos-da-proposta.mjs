// CARGA DOS EVENTOS: pagamento e assinatura, C2X -> Panteon.
//
// Lucas (03/09/2026), vendo o histórico da unidade: *"há trazer os pagamentos, as assinaturas"*.
// A linha do tempo por etapa conta o processo; sem o dinheiro que entrou e sem quem assinou, ela
// conta metade — e são as duas perguntas que aparecem numa auditoria.
//
// ⚠️ PARCELA NÃO ENTRA. Decisão do Lucas no mesmo minuto: *"parcela não precisa"*. São 15.715
// parcelas pagas no legado; jogá-las no histórico faria um lote de 156 parcelas ter 156 linhas de
// "Parcela 12 paga" cobrindo os cinco eventos que importam. Ato e Sinal são o que o coordenador
// acompanha — a mesma régua da tela de Parcelas do portal.
//
// ⚠️ SÓ O QUE JÁ ACONTECEU: pagamento com data e assinatura com `date_signed`. Vencimento futuro e
// signatário que ainda não assinou não são fato nenhum, e entrariam como se fossem.
//
// Uso (da raiz do repo):
//   node scripts/hercules/importar-eventos-da-proposta.mjs            # ENSAIO
//   node scripts/hercules/importar-eventos-da-proposta.mjs --gravar
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const GRAVAR = process.argv.includes("--gravar");

const texto = (v) => {
  const t = String(v ?? "").trim();
  return t || null;
};
const numero = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const data = (v) => (v ? new Date(v).toISOString() : null);

async function supa(caminho, opcoes = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(opcoes.headers ?? {}),
    },
  });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`${caminho}: ${r.status} ${corpo}`);
  return corpo ? JSON.parse(corpo) : null;
}

/** ⚠️ PostgREST corta em 1.000 linhas SEM ERRO. */
async function lerTudo(tabela, colunas) {
  const tudo = [];
  for (let de = 0; ; de += 1000) {
    const pagina = await supa(`${tabela}?select=${colunas}&limit=1000&offset=${de}`);
    tudo.push(...pagina);
    if (pagina.length < 1000) return tudo;
  }
}

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

console.log("Lendo as propostas já importadas…");
const propostas = await lerTudo("hercules_propostas", "id,origem_c2x_id");
const idPorC2x = new Map(
  propostas.filter((p) => p.origem_c2x_id).map((p) => [Number(p.origem_c2x_id), p.id]),
);
console.log(`  ${idPorC2x.size} propostas`);

// ── PAGAMENTOS: só Ato (1) e Sinal (2), e só o que já foi pago ──────────────
console.log("Lendo os pagamentos de ato e sinal…");
const [pagamentos] = await c.query(
  `select p.id, p.acquisition_request_id as ar, p.payment_date, p.paid_value, p.initial_value,
          p.current_signal_parcel, p.total_signal_parcels, pt.name as tipo
     from payments p
     join parcel_types pt on pt.id = p.parcel_type_id
    where p.parcel_type_id in (1, 2)
      and p.payment_date is not null
      and coalesce(p.payment_to_delete, 0) = 0
    order by p.payment_date`,
);
console.log(`  ${pagamentos.length} pagamentos de ato/sinal`);

// ── ASSINATURAS: quem assinou, e quando ─────────────────────────────────────
console.log("Lendo as assinaturas…");
const [assinaturas] = await c.query(
  `select s.id, arc.acquisition_request_id as ar, s.user_name, s.user_document, s.date_signed,
          cst.name as papel
     from contract_signature_signers s
     join contract_signatures cs on cs.id = s.contract_signature_id
     join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
     left join contract_signature_types cst on cst.id = s.contract_signature_type_id
    where s.date_signed is not null and coalesce(s.signed, 0) = 1
    order by s.date_signed`,
);
console.log(`  ${assinaturas.length} assinaturas concluídas`);
await c.end();

// ── MONTAGEM ────────────────────────────────────────────────────────────────
const eventos = [];
let semProposta = 0;

for (const p of pagamentos) {
  const proposta = idPorC2x.get(Number(p.ar));
  if (!proposta) {
    semProposta += 1;
    continue;
  }
  // "Sinal 2 de 5" quando o C2X sabe a contagem; só "Sinal" quando não.
  const parcela =
    p.current_signal_parcel && p.total_signal_parcels
      ? ` ${p.current_signal_parcel} de ${p.total_signal_parcels}`
      : "";
  eventos.push({
    descricao: `${p.tipo}${parcela}`,
    documento: null,
    origem_c2x_id: Number(p.id),
    proposta_id: proposta,
    quando: data(p.payment_date),
    quem: null,
    tipo: "pagamento",
    valor: numero(p.paid_value) ?? numero(p.initial_value),
    workspace_id: "careli",
  });
}

for (const a of assinaturas) {
  const proposta = idPorC2x.get(Number(a.ar));
  if (!proposta) {
    semProposta += 1;
    continue;
  }
  eventos.push({
    descricao: texto(a.papel) ? `Assinatura · ${texto(a.papel)}` : "Assinatura",
    documento: texto(a.user_document),
    origem_c2x_id: Number(a.id),
    proposta_id: proposta,
    quando: data(a.date_signed),
    quem: texto(a.user_name),
    tipo: "assinatura",
    valor: null,
    workspace_id: "careli",
  });
}

const porTipo = {};
for (const e of eventos) porTipo[e.tipo] = (porTipo[e.tipo] ?? 0) + 1;

console.log("\n── O QUE VAI ENTRAR ──");
console.table(porTipo);
console.log(`total: ${eventos.length}`);
console.log(`sem proposta no Panteon (ficam de fora): ${semProposta}`);
const comValor = eventos.filter((e) => e.tipo === "pagamento" && e.valor);
console.log(
  `soma dos pagamentos: R$ ${comValor
    .reduce((a, e) => a + e.valor, 0)
    .toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`,
);

if (!GRAVAR) {
  console.log("\nENSAIO — nada gravado. Rode com --gravar para valer.");
  process.exit(0);
}

console.log("\nGravando…");
for (let i = 0; i < eventos.length; i += 500) {
  const lote = eventos.slice(i, i + 500);
  await supa("hercules_proposta_eventos?on_conflict=tipo,origem_c2x_id", {
    body: JSON.stringify(lote),
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    method: "POST",
  });
  process.stdout.write(`  ${Math.min(i + 500, eventos.length)}/${eventos.length}\r`);
}
console.log(`\n  ${eventos.length} eventos gravados.`);
