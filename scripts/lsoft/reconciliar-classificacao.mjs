// RELIGA as classificações do subsídio às parcelas depois de uma recarga do LSoft.
//
// ⚠️ POR QUE ISTO EXISTE: `importar-para-supabase.mjs` APAGA as 19.988 parcelas e regrava com ids
// novos (é o que impede uma parcela quitada de aparecer aberta e paga ao mesmo tempo). As marcas de
// "isto é da Caixa" moram em `lsoft_classificacao_de_parcela` e guardam `parcela_id` — que vira pó
// na recarga. A migration 0103 previu isso e gravou uma `impressao_digital`, mas o script que a usa
// nunca chegou a ser escrito. Sem ele, recarregar apaga em silêncio o trabalho de validação e a
// tela do Subsídio zera.
//
//   node scripts/lsoft/reconciliar-classificacao.mjs
//   node scripts/lsoft/reconciliar-classificacao.mjs --ensaio    (não grava, só relata)
//
// ⚠️ A DIGITAL NÃO É ESTÁVEL — POR ISSO SÃO TRÊS REDES. A fórmula da 0103 é
// md5(cliente|empreendimento|parcela|vencimento|valor|observacoes|origem). Dois desses campos são
// móveis: `origem` vira "recebido" quando a parcela é PAGA, e `observacoes` muda quando alguém
// corrige o histórico no LSoft — que é exatamente o que o time fez em 25/08. Ou seja, a digital
// quebra justo nas linhas que mudaram.
//
// ⚠️ NENHUMA REDE ADIVINHA. Da mais estrita à mais frouxa; o que não casar com segurança fica
// ÓRFÃO e é relatado. Abater no cliente errado é pior do que faltar.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { createClient } = req("@supabase/supabase-js");

const ensaio = process.argv.includes("--ensaio");

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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// A MESMA fórmula do md5 do Postgres: concat_ws PULA nulos, não os vira string vazia.
const digitar = (campos) =>
  crypto
    .createHash("md5")
    .update(campos.filter((c) => c !== null && c !== undefined).join("|"))
    .digest("hex");

const texto = (v) => (v === null || v === undefined ? null : String(v));
// numeric do Postgres sai como "70456.35": o valor tem que virar a MESMA string que o ::text gera.
const valor = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
};

const digitalDaParcela = (p) =>
  digitar([
    texto(p.cliente_codigo),
    texto(p.empreendimento),
    texto(p.parcela),
    texto(p.vencimento),
    valor(p.valor),
    texto(p.observacoes),
    texto(p.origem),
  ]);

async function lerTudo(tabela, colunas, filtro) {
  const linhas = [];
  const passo = 1000;
  for (let de = 0; ; de += passo) {
    let consulta = supabase.from(tabela).select(colunas).range(de, de + passo - 1);
    if (filtro) consulta = filtro(consulta);
    const { data, error } = await consulta;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data ?? []));
    if (!data || data.length < passo) break;
  }
  return linhas;
}

const marcas = await lerTudo(
  "lsoft_classificacao_de_parcela",
  "id, parcela_id, impressao_digital, ordinal, empreendimento, cliente_codigo, situacao, valor_no_momento, observacao_no_momento, vencimento_no_momento",
);

if (marcas.length === 0) {
  console.log("nenhuma classificação para reconciliar.");
  process.exit(0);
}

const empreendimentos = [...new Set(marcas.map((m) => m.empreendimento))];
const parcelas = await lerTudo(
  "lsoft_parcelas",
  "id, cliente_codigo, empreendimento, parcela, vencimento, valor, observacoes, origem, paga",
  (c) => c.in("empreendimento", empreendimentos),
);

console.log(
  `${marcas.length} classificações · ${parcelas.length} parcelas em ${empreendimentos.join(", ")}`,
);

// ── AS TRÊS REDES ───────────────────────────────────────────────────────────
// Cada índice guarda a LISTA de parcelas com aquela chave, em ordem estável. O `ordinal` da
// classificação escolhe qual delas — é como a 0103 desempata parcelas byte a byte idênticas (dois
// recebimentos de R$ 5.000,00 no mesmo dia) sem inventar diferença.
const indexar = (chave) => {
  const mapa = new Map();
  for (const p of parcelas) {
    const k = chave(p);
    if (k === null) continue;
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(p);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return mapa;
};

// Rede 1 — a digital gravada, byte a byte. Nada mudou na linha.
const porDigital = indexar(digitalDaParcela);

// Rede 2 — cliente + empreendimento + vencimento + valor + observação. Imune a `origem`, ou seja,
// sobrevive à parcela ter sido PAGA entre as duas cargas. É a rede que mais trabalha na prática.
const chaveComTexto = (cliente, empreend, venc, val, obs) =>
  [texto(cliente), texto(empreend), texto(venc), valor(val), texto(obs)].join("¦");
const porTexto = indexar((p) =>
  chaveComTexto(p.cliente_codigo, p.empreendimento, p.vencimento, p.valor, p.observacoes),
);

// Rede 3 — sem a observação. Sobrevive ao time ter corrigido o histórico no LSoft.
const chaveSemTexto = (cliente, empreend, venc, val) =>
  [texto(cliente), texto(empreend), texto(venc), valor(val)].join("¦");
const porValor = indexar((p) =>
  chaveSemTexto(p.cliente_codigo, p.empreendimento, p.vencimento, p.valor),
);

// Rede 4 — sem vencimento nem observação, só cliente + valor. SÓ vale quando o resultado é único.
// Existe para as classificações antigas, gravadas antes de `vencimento_no_momento` existir.
const porClienteValor = indexar((p) =>
  [texto(p.cliente_codigo), texto(p.empreendimento), valor(p.valor)].join("¦"),
);

const vivas = new Set(parcelas.map((p) => p.id));
const usadas = new Set();
const contagem = { digital: 0, jaOk: 0, semTexto: 0, soValor: 0, texto: 0 };
const orfas = [];
const atualizacoes = [];

// Quem já está ligado reserva a sua parcela ANTES de qualquer religação, senão uma marca órfã
// poderia roubar a parcela de uma marca sadia.
for (const m of marcas) {
  if (m.parcela_id && vivas.has(m.parcela_id)) {
    usadas.add(m.parcela_id);
    contagem.jaOk += 1;
  }
}

for (const marca of marcas) {
  if (marca.parcela_id && vivas.has(marca.parcela_id)) continue;

  const ordinal = Math.max(Number(marca.ordinal) || 1, 1);
  const escolher = (lista) => {
    const livres = (lista ?? []).filter((p) => !usadas.has(p.id));
    if (livres.length === 0) return null;
    return livres[Math.min(ordinal - 1, livres.length - 1)];
  };

  const venc = marca.vencimento_no_momento ?? null;
  let achada = escolher(porDigital.get(marca.impressao_digital));
  let via = "digital";

  if (!achada && venc) {
    achada = escolher(
      porTexto.get(
        chaveComTexto(
          marca.cliente_codigo,
          marca.empreendimento,
          venc,
          marca.valor_no_momento,
          marca.observacao_no_momento,
        ),
      ),
    );
    via = "texto";
  }

  if (!achada && venc) {
    achada = escolher(
      porValor.get(
        chaveSemTexto(marca.cliente_codigo, marca.empreendimento, venc, marca.valor_no_momento),
      ),
    );
    via = "semTexto";
  }

  if (!achada) {
    // ⚠️ A REDE MAIS FROUXA SÓ ACEITA RESULTADO ÚNICO. Havendo duas candidatas, escolher pelo
    // ordinal aqui seria chute: sem vencimento não há como saber qual é qual.
    const candidatas = (
      porClienteValor.get(
        [texto(marca.cliente_codigo), texto(marca.empreendimento), valor(marca.valor_no_momento)].join("¦"),
      ) ?? []
    ).filter((p) => !usadas.has(p.id));
    if (candidatas.length === 1) {
      [achada] = candidatas;
      via = "soValor";
    }
  }

  if (!achada) {
    orfas.push(marca);
    continue;
  }

  usadas.add(achada.id);
  contagem[via] += 1;
  atualizacoes.push({ id: marca.id, parcela_id: achada.id, via });
}

console.log(`
  já ligadas (parcela viva):        ${contagem.jaOk}
  religadas pela digital exata:     ${contagem.digital}
  religadas por venc+valor+texto:   ${contagem.texto}       (parcela foi paga)
  religadas por venc+valor:         ${contagem.semTexto}       (histórico mudou)
  religadas por cliente+valor:      ${contagem.soValor}       (só quando única)
  ÓRFÃS (sem par seguro):           ${orfas.length}`);

if (orfas.length > 0) {
  console.log("\n  órfãs — ficam como estão, para alguém olhar:");
  for (const o of orfas.slice(0, 25)) {
    const obs = (o.observacao_no_momento ?? "").slice(0, 38);
    console.log(`    ${o.cliente_codigo} · ${o.situacao} · R$ ${o.valor_no_momento} · ${obs}`);
  }
  if (orfas.length > 25) console.log(`    ... e mais ${orfas.length - 25}`);
}

if (ensaio) {
  console.log("\nENSAIO — nada gravado.");
  process.exit(0);
}

if (atualizacoes.length === 0) {
  console.log("\nnada a religar.");
  process.exit(0);
}

// Um update por linha: são poucas (dezenas) e um upsert em massa exigiria remontar a linha inteira
// — onde um NOT NULL faltando passaria calado. Ver [[reference_postgrest_upsert_not_null]].
let feitas = 0;
for (const u of atualizacoes) {
  const { error } = await supabase
    .from("lsoft_classificacao_de_parcela")
    .update({ parcela_id: u.parcela_id })
    .eq("id", u.id);
  if (error) throw new Error(`update ${u.id}: ${error.message}`);
  feitas += 1;
  process.stdout.write(`\r  religando: ${feitas}/${atualizacoes.length}`);
}
process.stdout.write("\n");
console.log(`${feitas} classificações religadas.`);
