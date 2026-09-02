// PREENCHE `boletos_documentos` DO VALE DO SOL a partir do LSoft.
//
// Uso:
//   node scripts/boletos/preencher-documentos-do-lsoft.mjs <planilha.xlsx>            (ensaio)
//   node scripts/boletos/preencher-documentos-do-lsoft.mjs <planilha.xlsx> --gravar
//
// O PROBLEMA QUE ELE RESOLVE: a planilha traz NOME + UNIDADE e nao traz CPF; o LSoft traz NOME +
// CPF e, para o Vale do Sol, nao traz a unidade (`quadra` e `lote` vem nulos em 96 dos 99
// clientes). A unica ponte entre os dois lados e o NOME.
//
// ⚠️ CASAR POR NOME JA COLOCOU O CPF DE UMA PESSOA NO BOLETO DE OUTRA. Por isso aqui o casamento e
// IDENTIDADE EXATA depois de normalizar (sem acento, maiusculas, pontuacao virando espaco), e nunca
// semelhanca. "THALLES DE FARIA VASCONSELOS" e "TALLES DE FARIA VASCONCELOS" sao a mesma pessoa e
// NAO casam de proposito: quem decide isso e o administrativo, olhando o cadastro.
//
// ⚠️ HOMONIMO DERRUBA O PAR. Se o mesmo nome aparece duas vezes em qualquer um dos lados, ninguem e
// gravado para aquele nome: nao ha como saber qual CPF pertence a qual apartamento.
//
// ⚠️ SO ENTRA QUEM TEM PARCELA NO MESMO EMPREENDIMENTO no LSoft. Um homonimo de outro loteamento
// nunca chega a ser considerado.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const raiz = process.cwd();
const req = createRequire(path.resolve(raiz, "apps/hub/package.json"));
const ExcelJS = req("exceljs");
const { createClient } = req("@supabase/supabase-js");

// aba da planilha -> slug do empreendimento + chave em `lsoft_parcelas.empreendimento`
// !! CADA EMPREENDIMENTO CASA PELO QUE O LSOFT TEM DELE, e nao pelo mesmo criterio para todos:
//   * Vale do Sol -> por NOME. `quadra` e `lote` vem nulos em 96 dos 99 clientes, entao o nome e a
//     unica ponte -- e por isso o casamento e por identidade exata, nunca semelhanca.
//   * Garden      -> por QUADRA + LOTE. O LSoft traz os dois em 143 das 153 combinacoes, e a
//     planilha traz `N° LOTE` e `QUADRA` em colunas proprias. E uma chave de verdade: o nome
//     entra so como CONFERENCIA, e divergencia dele vira aviso, nao par descartado.
const ALVOS = [
  { aba: "BOLETOS VALE SOL", lsoft: "Vale do Sol", por: "nome", slug: "vale-do-sol" },
  { aba: "BOLETOS GARDEN", lsoft: "Garden", por: "quadra-lote", slug: "garden" },
];

const arquivo = process.argv[2];
const gravar = process.argv.includes("--gravar");

// A MESMA exclusao declarada da carga de parcelas: unidade com dois clientes nao pode ser
// adivinhada nem ignorada em silencio. Ver `carregar-parcelas.mjs`.
const pular = (process.argv.find((a) => a.startsWith("--pular-unidade=")) ?? "")
  .replace("--pular-unidade=", "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
if (!arquivo) {
  console.error("Informe a planilha: node scripts/boletos/preencher-documentos-do-lsoft.mjs <arquivo.xlsx> [--gravar]");
  process.exit(1);
}

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(raiz, "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Sem acento, maiusculas, pontuacao virando espaco. Dois nomes so casam se ficarem IDENTICOS. */
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Texto de uma celula sem tocar em `.text` — ver [[reference_exceljs_duas_armadilhas]]. */
function texto(c) {
  const v = c.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    return String(v.result ?? v.text ?? v.richText?.map((x) => x.text).join("") ?? "");
  }
  return String(v);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(arquivo);

const paraGravar = [];
const pendentes = [];

for (const alvo of ALVOS) {
  const ws = wb.getWorksheet(alvo.aba);
  if (!ws) {
    console.log(`aba "${alvo.aba}" nao existe no arquivo`);
    continue;
  }

  // 1) a planilha. !! AS COLUNAS MUDAM POR ABA: as de loteamento tipo Vale do Sol trazem
  // `No | Nome | FORMA ENVIO | Aptos`, e o Garden traz `N° LOTE | QUADRA | NOME | FORMA ENVIO`.
  const daPlanilha = [];
  const primeira = alvo.por === "quadra-lote" ? 4 : 3;
  for (let r = primeira; r <= ws.rowCount; r++) {
    const l = ws.getRow(r);
    if (alvo.por === "quadra-lote") {
      const lote = texto(l.getCell(1)).trim();
      const quadra = texto(l.getCell(2)).trim();
      const nome = texto(l.getCell(3)).trim();
      const contato = texto(l.getCell(4)).trim();
      // A unidade tem de sair IGUAL a que `ler-planilha.ts` monta, senao o documento nao casa
      // com a parcela: `Q{quadra} L{lote}`.
      if (nome && quadra && lote) {
        daPlanilha.push({
          chave: norm(nome), contato, linha: r, lote, nome, quadra,
          unidade: `Q${quadra} L${lote}`,
        });
      }
      continue;
    }
    const nome = texto(l.getCell(2)).trim();
    const unidade = texto(l.getCell(4)).trim();
    const contato = texto(l.getCell(3)).trim();
    if (nome && unidade) daPlanilha.push({ chave: norm(nome), contato, linha: r, nome, unidade });
  }

  // 2) o LSoft: so quem tem parcela NESTE empreendimento
  const codigos = new Set();
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb
      .from("lsoft_parcelas")
      .select("cliente_codigo")
      .eq("empreendimento", alvo.lsoft)
      .range(de, de + 999);
    if (error) throw error;
    for (const d of data) if (d.cliente_codigo) codigos.add(d.cliente_codigo);
    if (data.length < 1000) break;
  }
  const lista = [...codigos];
  const clientes = [];
  // ⚠️ `.in()` estoura a URL com muitos itens — lotes de 100. Ver [[reference_postgrest_in_url_limite]].
  for (let i = 0; i < lista.length; i += 100) {
    const { data, error } = await sb
      .from("lsoft_clientes")
      .select("codigo,nome,cpf,celular,telefone")
      .in("codigo", lista.slice(i, i + 100));
    if (error) throw error;
    clientes.push(...data);
  }

  // 3) indices dos DOIS lados, para descartar homonimo de qualquer um deles
  const noLsoft = new Map();
  for (const c of clientes) {
    const k = norm(c.nome);
    if (!noLsoft.has(k)) noLsoft.set(k, []);
    noLsoft.get(k).push(c);
  }
  const naPlanilha = new Map();
  for (const p of daPlanilha) {
    if (!naPlanilha.has(p.chave)) naPlanilha.set(p.chave, []);
    naPlanilha.get(p.chave).push(p);
  }

  console.log(`\n=== ${alvo.slug}: ${daPlanilha.length} linhas na planilha, ${clientes.length} clientes no LSoft`);

  for (const p of daPlanilha) {
    if (pular.includes(`${alvo.slug}|${p.unidade}`)) {
      pendentes.push({ ...p, motivo: "unidade com mais de um cliente na planilha", slug: alvo.slug });
      continue;
    }
    const cs = noLsoft.get(p.chave);
    if (!cs) {
      pendentes.push({ ...p, motivo: "sem nome identico no LSoft", slug: alvo.slug });
      continue;
    }
    if (cs.length > 1) {
      pendentes.push({ ...p, motivo: `${cs.length} clientes com esse nome no LSoft`, slug: alvo.slug });
      continue;
    }
    if (naPlanilha.get(p.chave).length > 1) {
      pendentes.push({ ...p, motivo: "nome repetido na propria planilha", slug: alvo.slug });
      continue;
    }
    const dig = String(cs[0].cpf ?? "").replace(/\D/g, "");
    if (dig.length !== 11 && dig.length !== 14) {
      pendentes.push({ ...p, motivo: "cliente achado, mas sem CPF/CNPJ no LSoft", slug: alvo.slug });
      continue;
    }
    paraGravar.push({
      contato: p.contato || cs[0].celular || cs[0].telefone || null,
      documento: dig,
      empreendimento: alvo.slug,
      nome: p.nome,
      unidade: p.unidade,
      workspace_id: "careli",
    });
  }
}

// ⚠️ DUAS LINHAS PARA A MESMA UNIDADE derrubariam o upsert inteiro.
const vistos = new Map();
const colididos = [];
for (const a of paraGravar) {
  const k = `${a.empreendimento}|${a.unidade}`;
  if (vistos.has(k)) colididos.push({ k, nomes: [vistos.get(k).nome, a.nome] });
  else vistos.set(k, a);
}

console.log(`\n${paraGravar.length} documento(s) prontos para gravar`);
console.log(`${pendentes.length} pendente(s) — precisam do CPF a mao:`);
const porMotivo = {};
for (const p of pendentes) porMotivo[p.motivo] = (porMotivo[p.motivo] ?? 0) + 1;
for (const [m, n] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(3)} ${m}`);
}

if (colididos.length) {
  console.log(`\n⚠️ ${colididos.length} unidade(s) repetida(s) — nao grava assim:`);
  for (const c of colididos) console.log(`   ${c.k}: ${c.nomes.join(" / ")}`);
  process.exit(1);
}

// A lista dos pendentes, para o administrativo buscar o que falta.
const destino = "C:/Users/lucas/Downloads/CPF-pendentes-Vale-do-Sol.xlsx";
const saida = new ExcelJS.Workbook();
const aba = saida.addWorksheet("CPF pendentes");
aba.addRow(["Empreendimento", "Unidade", "Cliente", "Telefone", "CPF / CNPJ", "Por que ficou de fora"]);
aba.getRow(1).font = { bold: true };
for (const p of pendentes.sort((a, b) => a.unidade.localeCompare(b.unidade))) {
  aba.addRow(["Vale do Sol", p.unidade, p.nome, p.contato, "", p.motivo]);
}
aba.columns = [{ width: 16 }, { width: 14 }, { width: 42 }, { width: 20 }, { width: 20 }, { width: 40 }];
// A coluna do CPF em amarelo, que e a que o administrativo preenche.
for (let r = 2; r <= aba.rowCount; r++) {
  aba.getCell(r, 5).fill = { fgColor: { argb: "FFFFF2CC" }, pattern: "solid", type: "pattern" };
}
await saida.xlsx.writeFile(destino);
console.log(`\n-> ${destino}`);

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode com --gravar para valer.");
  process.exit(0);
}

const { data, error } = await sb
  .from("boletos_documentos")
  .upsert(paraGravar, { onConflict: "workspace_id,empreendimento,unidade" })
  .select("id");
if (error) {
  console.error(`\n⚠️ ${error.message}`);
  process.exit(1);
}
console.log(`\n✓ ${data.length} documentos gravados.`);
