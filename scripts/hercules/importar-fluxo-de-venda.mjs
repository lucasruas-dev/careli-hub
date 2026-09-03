// CARGA DO FLUXO DE VENDA: C2X -> Panteon.
//
// Lucas (03/09/2026): *"quero importar todos os dados do c2x, eles tem que existir dentro do
// panteon, então pode trazer a proposta (fluxo de venda), pode importar tudo e quero que hoje isso
// seja visto dentro do panteon"*.
//
// ⚠️ É UMA CARGA, NÃO UMA SINCRONIZAÇÃO — a mesma regra da carga de unidades. Roda, o Panteon passa
// a ser dono do fluxo, e ninguém volta ao legado para lê-lo. O `origem_c2x_id` permite rodar de
// novo sem duplicar enquanto a carga é conferida; não existe job de volta.
//
// ⚠️ NO C2X A PROPOSTA É O FLUXO INTEIRO. `acquisition_requests` nasce reserva (estágio 1) e anda
// até faturado, cancelado ou distratado — a mesma linha mudando de estágio. Por isso a carga traz
// TODAS as 4.852, e não só as vivas: sem as canceladas não há taxa de cancelamento, e sem as
// faturadas antigas não há histórico de venda.
//
// ⚠️ O VALOR VEM DA UNIDADE. `annual_value` está nulo nas 4.852 linhas; quem tem preço é
// `enterprise_unities.price`, que é o que a tela de Vendas sempre mostrou.
//
// ⚠️ A IMOBILIÁRIA VEM DO VÍNCULO DO CLIENTE (`users.vinculed_by_id`), como em lib/apolo/vendas.ts:
// a tabela `acquisition_requests_imobiliarias` cobre 15 das 4.852. E CORRETOR NÃO EXISTE: a coluna
// está nula em todas e a tabela de vínculo está vazia — entra nulo, e o fluxo novo é que vai
// preencher.
//
// Uso (da raiz do repo):
//   node scripts/hercules/importar-fluxo-de-venda.mjs            # ENSAIO: não grava
//   node scripts/hercules/importar-fluxo-de-venda.mjs --gravar   # grava
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

/**
 * A dobra dos 11 estágios do C2X nos 7 do Panteon.
 *
 * ⚠️ É A MESMA de `lib/apolo/vendas.ts` (STAGE_MAP), fechada pelo Lucas: Análise de crédito conta
 * como Proposta, Finalizado como Faturado, Reprovado como Cancelado. Repetir a régua aqui é
 * duplicação consciente — o script roda fora do Next e não importa TypeScript —, e por isso
 * `etapa_c2x` guarda o número cru: se a dobra mudar, dá para refazer sem voltar ao legado.
 */
const ETAPA = {
  1: "reservado",
  2: "proposta",
  3: "contrato",
  4: "faturado",
  5: "assinatura",
  6: "faturado",
  7: "cancelado",
  8: "cancelado",
  9: "proposta",
  10: "distrato",
  11: "distrato",
};

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
/** `date` do Postgres: só o dia, sem fuso — passar ISO completo desloca o dia. */
const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// ── 1. O QUE JÁ EXISTE NO PANTEON: unidades e empreendimentos, para casar as chaves ──
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
  // ⚠️ `Prefer: return=minimal` responde 201 com CORPO VAZIO: `r.json()` direto estoura com
  // "Unexpected end of JSON input" DEPOIS de a gravação ter acontecido — o pior tipo de erro,
  // porque parece que falhou e não falhou.
  return corpo ? JSON.parse(corpo) : null;
}

/** ⚠️ PostgREST corta em 1.000 linhas SEM ERRO. Paginar é obrigatório. */
async function lerTudo(tabela, colunas) {
  const tudo = [];
  for (let de = 0; ; de += 1000) {
    const pagina = await supa(`${tabela}?select=${colunas}&limit=1000&offset=${de}`);
    tudo.push(...pagina);
    if (pagina.length < 1000) return tudo;
  }
}

console.log("Lendo o que o Panteon já tem…");
const unidades = await lerTudo("hercules_unidades", "id,origem_c2x_id,codigo,enterprise_id");
const empreendimentos = await lerTudo("hercules_empreendimentos", "id,codigo,c2x_enterprise_id,pai_id");

const unidadePorC2x = new Map(
  unidades.filter((u) => u.origem_c2x_id).map((u) => [Number(u.origem_c2x_id), u]),
);
// O empreendimento do Panteon por CÓDIGO do C2X. O pai é quem guarda as unidades (0123), então a
// proposta aponta para o pai quando o código é de um filho.
const empPorCodigo = new Map(empreendimentos.map((e) => [String(e.codigo).toUpperCase(), e]));
console.log(`  ${unidades.length} unidades · ${empreendimentos.length} empreendimentos`);

// ── 2. O FLUXO NO LEGADO ────────────────────────────────────────────────────
console.log("Lendo o fluxo de venda no C2X…");
const [linhas] = await c.query(
  `select ar.id, ar.code, ar.enterprise_unity_id, ar.client_id, ar.commercial_plan_id,
          ar.acquisition_request_stage_id as etapa, ar.open, ar.billing_date,
          ar.quantity_signal_parcels, ar.first_signal_payment, ar.act_date, ar.sign_date,
          ar.client_2_id, ar.client_3_id, ar.client_4_id, ar.client_5_id,
          ar.percentage_client_1, ar.percentage_client_2, ar.percentage_client_3,
          ar.percentage_client_4, ar.percentage_client_5,
          ar.rejection_reason, ar.observation, ar.created_at, ar.updated_at,
          u.price as valor, u.block, u.lot, u.id as unidade_c2x,
          e.code as emp_code,
          cli.name as cli_nome, cli.social_name as cli_social, cli.cpf as cli_cpf,
          cli.cnpj as cli_cnpj,
          imo.id as imo_id, imo.name as imo_nome, imo.social_name as imo_social,
          cp.name as plano_nome, dd.day as dia_vencimento
     from acquisition_requests ar
     left join enterprise_unities u on u.id = ar.enterprise_unity_id
     left join enterprises e on e.id = u.enterprise_id
     left join users cli on cli.id = ar.client_id
     left join users imo on imo.id = cli.vinculed_by_id
     left join commercial_plans cp on cp.id = ar.commercial_plan_id
     left join due_days dd on dd.id = ar.due_day_id
    order by ar.id`,
);
console.log(`  ${linhas.length} propostas`);

// Os nomes dos compradores 2..5, numa consulta só.
const idsExtras = new Set();
for (const l of linhas) {
  for (const k of ["client_2_id", "client_3_id", "client_4_id", "client_5_id"]) {
    if (l[k]) idsExtras.add(Number(l[k]));
  }
}
const nomePorUsuario = new Map();
if (idsExtras.size > 0) {
  const [extras] = await c.query(
    `select id, name, social_name, cpf, cnpj from users where id in (${[...idsExtras].join(",")})`,
  );
  for (const u of extras) nomePorUsuario.set(Number(u.id), u);
}

const [historicos] = await c.query(
  `select h.id, h.acquisition_request_id, h.old_acquisition_request_stage_id as de,
          h.new_acquisition_request_stage_id as para, h.user_id, h.created_at,
          h.rejection_reason, h.observation, us.name as autor_nome, us.social_name as autor_social
     from acquisition_request_historics h
     left join users us on us.id = h.user_id
    order by h.acquisition_request_id, h.created_at, h.id`,
);
console.log(`  ${historicos.length} movimentações de etapa`);
await c.end();

// ── 3. MONTAGEM ─────────────────────────────────────────────────────────────
const nomeDe = (u) => texto(u?.social_name) ?? texto(u?.name);
const docDe = (u) => texto(u?.cpf) ?? texto(u?.cnpj);

/** A entrada da etapa atual: a última movimentação que chegou nela. */
const ultimaEntrada = new Map();
for (const h of historicos) {
  const chave = `${h.acquisition_request_id}|${h.para}`;
  ultimaEntrada.set(chave, h.created_at);
}

const semUnidade = [];
const semEmpreendimento = new Set();
const propostas = linhas.map((l) => {
  const unidade = l.unidade_c2x ? unidadePorC2x.get(Number(l.unidade_c2x)) : null;
  if (!unidade && l.unidade_c2x) semUnidade.push(l.id);

  const codigoEmp = String(l.emp_code ?? "").toUpperCase();
  let emp = empPorCodigo.get(codigoEmp) ?? null;
  // O código do filho aponta para o pai, que é onde as unidades e as vendas moram.
  if (emp?.pai_id) emp = empreendimentos.find((e) => e.id === emp.pai_id) ?? emp;
  if (!emp && codigoEmp) semEmpreendimento.add(codigoEmp);

  const etapaC2x = Number(l.etapa ?? 0);
  const compradores = [];
  const titular = {
    c2x_user_id: numero(l.client_id),
    documento: docDe({ cpf: l.cli_cpf, cnpj: l.cli_cnpj }),
    nome: nomeDe({ name: l.cli_nome, social_name: l.cli_social }),
    percentual: numero(l.percentage_client_1),
    titular: true,
  };
  if (titular.nome || titular.c2x_user_id) compradores.push(titular);
  for (const [i, k] of [
    [2, "client_2_id"],
    [3, "client_3_id"],
    [4, "client_4_id"],
    [5, "client_5_id"],
  ]) {
    const id = l[k] ? Number(l[k]) : null;
    if (!id) continue;
    const u = nomePorUsuario.get(id);
    compradores.push({
      c2x_user_id: id,
      documento: docDe(u),
      nome: nomeDe(u),
      percentual: numero(l[`percentage_client_${i}`]),
      titular: false,
    });
  }

  return {
    aberta: l.open === null || l.open === undefined ? null : Number(l.open) === 1,
    atualizado_em_c2x: data(l.updated_at),
    cliente_c2x_id: numero(l.client_id),
    cliente_documento: titular.documento,
    cliente_nome: titular.nome,
    codigo: texto(l.code),
    compradores,
    corretor_nome: null,
    criado_em_c2x: data(l.created_at),
    data_assinatura: dia(l.sign_date),
    data_ato: dia(l.act_date),
    data_faturamento: dia(l.billing_date),
    dia_vencimento: numero(l.dia_vencimento),
    empreendimento_codigo: codigoEmp || null,
    empreendimento_id: emp?.id ?? null,
    etapa: ETAPA[etapaC2x] ?? "proposta",
    etapa_c2x: etapaC2x || null,
    etapa_desde: data(ultimaEntrada.get(`${l.id}|${etapaC2x}`) ?? l.updated_at),
    imobiliaria_c2x_id: numero(l.imo_id),
    imobiliaria_nome: nomeDe({ name: l.imo_nome, social_name: l.imo_social }),
    motivo: texto(l.rejection_reason),
    observacao: texto(l.observation),
    origem_c2x_id: Number(l.id),
    parcelas_sinal: numero(l.quantity_signal_parcels),
    plano_c2x_id: numero(l.commercial_plan_id),
    plano_nome: texto(l.plano_nome),
    primeiro_sinal: dia(l.first_signal_payment),
    unidade_id: unidade?.id ?? null,
    unidade_nome:
      texto([l.block, l.lot].filter(Boolean).join(" ")) ?? texto(unidade?.codigo) ?? null,
    valor: numero(l.valor),
    workspace_id: "careli",
  };
});

// ── 4. RELATÓRIO ────────────────────────────────────────────────────────────
const porEtapa = {};
for (const p of propostas) porEtapa[p.etapa] = (porEtapa[p.etapa] ?? 0) + 1;

console.log("\n── O QUE VAI ENTRAR ──");
console.log(`propostas: ${propostas.length}`);
console.table(porEtapa);
console.log(`com unidade casada: ${propostas.filter((p) => p.unidade_id).length}`);
console.log(`com empreendimento casado: ${propostas.filter((p) => p.empreendimento_id).length}`);
console.log(`com valor: ${propostas.filter((p) => p.valor).length}`);
console.log(`com imobiliária: ${propostas.filter((p) => p.imobiliaria_nome).length}`);
console.log(`com mais de um comprador: ${propostas.filter((p) => p.compradores.length > 1).length}`);
if (semUnidade.length > 0) {
  console.log(`\n⚠️ ${semUnidade.length} propostas cuja unidade não existe no Panteon (ficam sem unidade_id):`);
  console.log(`   ids do C2X: ${semUnidade.slice(0, 20).join(", ")}${semUnidade.length > 20 ? "…" : ""}`);
}
if (semEmpreendimento.size > 0) {
  console.log(`\n⚠️ empreendimentos do legado sem cadastro no Panteon: ${[...semEmpreendimento].join(", ")}`);
}

if (!GRAVAR) {
  console.log("\nENSAIO — nada gravado. Rode com --gravar para valer.");
  process.exit(0);
}

// ── 5. GRAVAÇÃO ─────────────────────────────────────────────────────────────
console.log("\nGravando as propostas…");
for (let i = 0; i < propostas.length; i += 200) {
  const lote = propostas.slice(i, i + 200);
  await supa("hercules_propostas?on_conflict=origem_c2x_id", {
    body: JSON.stringify(lote),
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    method: "POST",
  });
  process.stdout.write(`  ${Math.min(i + 200, propostas.length)}/${propostas.length}\r`);
}
console.log(`\n  ${propostas.length} propostas gravadas.`);

// O id do Panteon por proposta do C2X, para ligar o histórico.
const gravadas = await lerTudo("hercules_propostas", "id,origem_c2x_id");
const idPorC2x = new Map(gravadas.filter((p) => p.origem_c2x_id).map((p) => [Number(p.origem_c2x_id), p.id]));

const etapas = historicos
  .map((h) => {
    const proposta = idPorC2x.get(Number(h.acquisition_request_id));
    if (!proposta) return null;
    const de = h.de ? Number(h.de) : null;
    const para = h.para ? Number(h.para) : null;
    return {
      autor_c2x_id: numero(h.user_id),
      autor_nome: texto(h.autor_social) ?? texto(h.autor_nome),
      de: de ? (ETAPA[de] ?? null) : null,
      de_c2x: de,
      motivo: texto(h.rejection_reason),
      observacao: texto(h.observation),
      origem_c2x_id: Number(h.id),
      para: para ? (ETAPA[para] ?? null) : null,
      para_c2x: para,
      proposta_id: proposta,
      quando: data(h.created_at),
      workspace_id: "careli",
    };
  })
  .filter((h) => h && h.quando);

console.log("Gravando a linha do tempo…");
for (let i = 0; i < etapas.length; i += 500) {
  const lote = etapas.slice(i, i + 500);
  await supa("hercules_proposta_etapas?on_conflict=origem_c2x_id", {
    body: JSON.stringify(lote),
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    method: "POST",
  });
  process.stdout.write(`  ${Math.min(i + 500, etapas.length)}/${etapas.length}\r`);
}
console.log(`\n  ${etapas.length} movimentações gravadas.`);
console.log("\nPronto. O fluxo de venda agora vive no Panteon.");
