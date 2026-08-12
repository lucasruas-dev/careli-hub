// ATUALIZA OS LOTES DO GARDEN a partir da planilha oficial do cliente.
//
// Uso:
//   node scripts/apolo/garden-atualizar-lotes.mjs "C:/caminho/planilha.xlsx"
//   node scripts/apolo/garden-atualizar-lotes.mjs "C:/caminho/planilha.xlsx" --aplicar
//
// Sem `--aplicar` ele só mostra o que mudaria. Com, reescreve o bloco DADOS do
// apps/hub/masterplans-internos/garden.html e nada mais do arquivo.
//
// POR QUE ESTE SCRIPT EXISTE. O Garden nasceu com os 406 lotes colados à mão dentro do HTML,
// diferente do Vale do Ouro, que tem gerador. Toda vez que o cliente manda planilha nova, alguém
// teria que reconciliar 406 linhas na unha, e foi assim que preços erradios (um lote de R$ 1,34
// milhão que na verdade custa R$ 268 mil) sobreviveram por semanas.
//
// ⚠️ O POLÍGONO NÃO VEM DA PLANILHA. O desenho de cada lote (a última coluna de DADOS) foi
// traçado sobre a planta e não existe no Excel. Este script PRESERVA o polígono do lote que já
// está no arquivo, casando por quadra e lote. Lote da planilha que não tenha polígono conhecido
// é RECUSADO em vez de entrar sem desenho: um lote sem polígono some do mapa em silêncio.
//
// ⚠️ LER XLSX ENQUANTO O EXCEL SALVA devolve coluna deslocada SEM ERRO. Por isso o script confere
// o cabeçalho antes de ler qualquer linha e aborta se ele não for o esperado.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import ExcelJS from "exceljs";

const HTML = path.join(process.cwd(), "apps/hub/masterplans-internos/garden.html");

// A ordem importa: é a ordem das colunas na planilha do cliente.
const CABECALHO = ["Quadra", "Lote", "Situação", "Área (m²)", "Preço", "Preço/m²", "Comprador", "Observação"];

// ⚠️ RESERVADO ENTRA COMO VENDIDO (Lucas, 12/08/2026): "o reservado passa vendido também, então
// vendido e reservado fica como vendido e recebe a mesma coloração".
//
// Na planilha do Garden, "Reservado" nunca significou reserva de alguém: são 111 lotes e NENHUM
// tem nome de comprador. É lote que não está à venda. Tratá-los como vendidos deixa o mapa
// honesto (o corretor vê o que pode vender e o que não pode) e, de quebra, libera o status
// Reservado para o significado NOVO: unidade com proposta emitida, reservada por 48 horas.
//
// A informação original não se perde: ela continua na planilha do cliente, e este script
// reprocessa a partir dela sempre que a regra mudar.
const SITUACAO = { Disponível: 0, Reservado: 2, Vendido: 2 };

const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");
const texto = (v) => {
  const t = String(v ?? "").replace(/\u00a0/g, " ").trim();
  return ["-", "—", "–"].includes(t) ? "" : t;
};

/** "R$ 410.000" -> 410000 · "1.105,12" -> 1105.12 · vazio -> 0 */
function numero(valor) {
  if (valor == null || valor === "") return 0;
  if (typeof valor === "number") return valor;
  let t = String(valor).replace(/\u00a0/g, " ").replace(/[R$\s]/g, "").trim();
  if (!t || ["-", "—", "–"].includes(t)) return 0;
  // "não informado", "a definir": texto sem dígito nenhum é ausência de valor, não erro.
  if (!/\d/.test(t)) return 0;

  // ⚠️ O PONTO É AMBÍGUO: em "410.000" é milhar, em "1105.12" é decimal. Havendo vírgula, ela é
  // o decimal e todo ponto é milhar. Não havendo, o ponto só é decimal quando o último grupo NÃO
  // tem três dígitos.
  //
  // A primeira versão só tratava UM ponto, e "R$ 1.102.000" virou 1,102: um lote de um milhão e
  // cento e dois mil foi para o mapa valendo mil cento e dois. Daí os testes abaixo.
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = t.split(".");
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) t = partes.join("");
  }

  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

/** Roda antes de gravar: conversor errado grava preço errado sem dar erro nenhum. */
function testarConversor() {
  const casos = [
    ["R$ 410.000", 410000],
    ["R$ 1.102.000", 1102000],
    ["R$ 1.340.000", 1340000],
    ["R$ 963,10", 963.1],
    ["R$ 1.105,12", 1105.12],
    ["não informado", 0],
    ["", 0],
    ["-", 0],
    [268000, 268000],
    ["420", 420],
    ["1105.12", 1105.12],
    ["425.71", 425.71],
  ];
  const falhas = casos.filter(([entrada, esperado]) => numero(entrada) !== esperado);
  for (const [entrada, esperado] of falhas) {
    console.error(`  conversor errou: ${JSON.stringify(entrada)} devolveu ${numero(entrada)}, esperado ${esperado}`);
  }
  if (falhas.length) throw new Error("Conversor de valores incorreto. NADA foi gravado.");
}

async function lerPlanilha(caminho) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.getWorksheet("Planilha1") ?? wb.worksheets[0];

  const cabecalho = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c) => cabecalho.push(texto(c.value)));
  const esperado = CABECALHO.join("|").toLowerCase();
  const veio = cabecalho.slice(0, CABECALHO.length).join("|").toLowerCase();
  if (veio !== esperado) {
    throw new Error(
      `Cabeçalho inesperado na planilha.\n  esperado: ${esperado}\n  veio    : ${veio}\n` +
        "Se a planilha mudou de formato, ajuste CABECALHO neste script. Não siga em frente: " +
        "coluna trocada grava preço no campo errado sem dar erro.",
    );
  }

  const linhas = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i) => row.getCell(i).value;
    const quadra = soDigitos(v(1));
    if (!quadra) return;
    linhas.push({
      area: numero(v(4)),
      comprador: texto(v(7)),
      lote: soDigitos(v(2)).padStart(2, "0"),
      preco: numero(v(5)),
      quadra: quadra.padStart(2, "0"),
      situacao: texto(v(3)),
    });
  });
  return linhas;
}

function lerDadosDoHtml(html) {
  const marca = "const DADOS=[";
  const i = html.indexOf(marca);
  if (i < 0) throw new Error("Não achei `const DADOS=[` no garden.html.");
  const inicio = i + marca.length - 1;
  const fim = html.indexOf("];", inicio);
  if (fim < 0) throw new Error("Não achei o fim do bloco DADOS.");
  return { dados: JSON.parse(html.slice(inicio, fim + 1)), fim: fim + 1, inicio };
}

const chave = (q, l) => `${String(q).padStart(2, "0")}-${String(l).padStart(2, "0")}`;

async function main() {
  const arquivo = process.argv[2];
  const aplicar = process.argv.includes("--aplicar");
  if (!arquivo) {
    console.error("Informe o caminho da planilha.");
    process.exit(1);
  }

  testarConversor();

  const html = fs.readFileSync(HTML, "utf8");
  const { dados: atuais, fim, inicio } = lerDadosDoHtml(html);
  const planilha = await lerPlanilha(arquivo);

  // O polígono é a única coisa que a planilha não tem, e sem ele o lote some do mapa.
  const poligonoDe = new Map(atuais.map((r) => [chave(r[0], r[1]), r[6]]));

  const semPoligono = [];
  const vistos = new Set();
  const novos = [];
  let duplicadas = 0;

  for (const l of planilha) {
    const k = chave(l.quadra, l.lote);
    if (vistos.has(k)) {
      // A planilha do cliente repete Q10 L01 em duas linhas idênticas. Entrar duas vezes cria
      // polígono sobreposto e infla o percentual por situação.
      duplicadas += 1;
      continue;
    }
    vistos.add(k);

    const poligono = poligonoDe.get(k);
    if (!poligono) {
      semPoligono.push(k);
      continue;
    }
    const sit = SITUACAO[l.situacao];
    if (sit === undefined) throw new Error(`Situação desconhecida em Q${l.quadra} L${l.lote}: "${l.situacao}"`);

    novos.push([Number(l.quadra), l.lote, sit, l.area, l.preco, l.comprador, poligono]);
  }

  // Ordena como estava: por quadra e por lote, para o diff do git ficar legível.
  novos.sort((a, b) => a[0] - b[0] || String(a[1]).localeCompare(String(b[1])));

  const antes = new Map(atuais.map((r) => [chave(r[0], r[1]), r]));
  const conta = { area: 0, comprador: 0, preco: 0, situacao: 0 };
  for (const n of novos) {
    const a = antes.get(chave(n[0], n[1]));
    if (!a) continue;
    if (a[2] !== n[2]) conta.situacao += 1;
    if (Math.round(a[4] || 0) !== Math.round(n[4] || 0)) conta.preco += 1;
    if (Math.abs((a[3] || 0) - (n[3] || 0)) > 0.01) conta.area += 1;
    if ((a[5] || "") !== (n[5] || "")) conta.comprador += 1;
  }

  const porSituacao = novos.reduce((acc, r) => ((acc[r[2]] = (acc[r[2]] ?? 0) + 1), acc), {});
  console.log(`planilha: ${planilha.length} linhas · ${duplicadas} duplicada(s) descartada(s)`);
  console.log(`lotes gravados: ${novos.length} (antes ${atuais.length})`);
  console.log(`  disponível ${porSituacao[0] ?? 0} · reservado ${porSituacao[1] ?? 0} · vendido ${porSituacao[2] ?? 0}`);
  console.log(`mudanças: situação ${conta.situacao} · preço ${conta.preco} · área ${conta.area} · comprador ${conta.comprador}`);
  if (semPoligono.length) {
    console.log(`\n⚠️ ${semPoligono.length} lote(s) da planilha SEM polígono conhecido, não entraram:`);
    console.log("   " + semPoligono.join(", "));
    console.log("   (o desenho precisa ser traçado sobre a planta antes de o lote existir no mapa)");
  }

  if (!aplicar) {
    console.log("\nSimulação. Rode de novo com --aplicar para gravar.");
    return;
  }

  const linhas = novos.map((r) => JSON.stringify(r)).join(",\n");
  fs.writeFileSync(HTML, html.slice(0, inicio) + "[\n" + linhas + "]" + html.slice(fim), "utf8");
  console.log(`\n✅ ${HTML} atualizado.`);
}

await main();
