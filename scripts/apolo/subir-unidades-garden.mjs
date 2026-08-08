// Sobe as unidades do loteamento GARDEN (enterprise 39, code GDN) para o C2X.
//
// Clone do scripts/apolo/subir-unidades-c2x.mjs (Vale do Ouro, 01/08), com as adaptações do
// Garden. Todas as proteções do original ficam de pé: ensaio é o padrão, host de produção escrito
// por extenso, banner do destino antes de enviar, conferência no banco depois do envio.
//
// Uso (da raiz do repo):
//   node scripts/apolo/subir-unidades-garden.mjs                 -> ENSAIO: mostra o que subiria
//   node scripts/apolo/subir-unidades-garden.mjs --enviar --n=5  -> envia as 5 primeiras de verdade
//   node scripts/apolo/subir-unidades-garden.mjs --enviar        -> envia todas
//   node scripts/apolo/subir-unidades-garden.mjs --conferir      -> só lê o C2X e mostra o que já está lá
//
// Flags extras:
//   --planilha=<caminho>                 outra planilha (padrão: ~/Documents/Tabela Garden.xlsx)
//   --host=<url>                         outro destino (o padrão é produção, por extenso, abaixo)
//   --aceito-disponivel-sem-preco        inclui na carga os lotes DISPONÍVEIS que ficariam a R$ 1,00
//   --aceito-contradicao-entre-abas      inclui na carga os lotes em que aba1 e aba2 se contradizem
//   --confirmo-destino-nao-producao      exigida para enviar a qualquer host que não seja produção
//
// O ensaio é o padrão de propósito: criar unidade não tem desfazer, e preço errado em lote
// disponível é corretor vendendo pelo valor errado no salão.
//
// ⚠️ UMA EXECUÇÃO POR VEZ. A tabela `enterprise_unities` NÃO tem índice único em
// (enterprise_id, block, lot) nem em name: a única defesa contra duplicar é a lista do "já no C2X",
// lida uma vez antes do laço. Dois `--enviar` ao mesmo tempo leem a mesma lista e criam tudo em
// duplicidade sem o banco reclamar. Por isso o envio pega um arquivo de trava (ver TRAVA, abaixo).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const ExcelJS = requireDoRepo("exceljs");
const mysql = requireDoRepo("mysql2/promise");

const args = process.argv.slice(2);

// ── argumentos: o que não for reconhecido ABORTA ──────────────────────────
// Antes o limite era `Number(...) || Infinity`, e aí `--n=0`, `--n=abc`, `--n 5`, `-n=5` e `--N=5`
// TODOS viravam Infinity — ou seja, a flag que promete "só as 5 primeiras" mandava a carga inteira,
// justamente no comando que o próprio script recomenda para testar o envio. Agora: digitação
// estranha para o script antes de qualquer requisição, e nada de silêncio.
const FLAGS_SIMPLES = new Set([
  "--enviar",
  "--conferir",
  "--aceito-disponivel-sem-preco",
  "--aceito-contradicao-entre-abas",
  "--confirmo-destino-nao-producao",
]);
const FLAGS_COM_VALOR = ["--n=", "--host=", "--planilha="];

const desconhecidos = args.filter(
  (a) => !FLAGS_SIMPLES.has(a) && !FLAGS_COM_VALOR.some((f) => a.startsWith(f)),
);
if (desconhecidos.length > 0) {
  console.error(`⛔ Argumento não reconhecido: ${desconhecidos.map((a) => `"${a}"`).join(", ")}`);
  console.error(`   Aceitos: ${[...FLAGS_SIMPLES].join(" ")} ${FLAGS_COM_VALOR.map((f) => `${f}<valor>`).join(" ")}`);
  console.error(`   Erro de digitação em flag NÃO é ignorado aqui: "--n 5" e "-n=5" não limitam nada`);
  console.error(`   e a carga inteira sairia. Corrija o comando e rode de novo. Nada foi enviado.`);
  process.exit(1);
}

const enviarDeVerdade = args.includes("--enviar");
const soConferir = args.includes("--conferir");
const aceitaDisponivelSemPreco = args.includes("--aceito-disponivel-sem-preco");
const aceitaContradicaoEntreAbas = args.includes("--aceito-contradicao-entre-abas");
const confirmouDestinoNaoProducao = args.includes("--confirmo-destino-nao-producao");

const flagsDeLimite = args.filter((a) => a.startsWith("--n="));
if (flagsDeLimite.length > 1) {
  console.error(`⛔ --n= repetida: ${flagsDeLimite.join(" ")}. Passe uma só. Nada foi enviado.`);
  process.exit(1);
}
let limite = Infinity;
if (flagsDeLimite.length === 1) {
  const cru = flagsDeLimite[0].slice(4);
  if (!/^[0-9]+$/.test(cru) || Number(cru) < 1) {
    console.error(`⛔ --n=${cru} não é um limite válido. Use um inteiro >= 1 (ex.: --n=5).`);
    console.error(`   Um limite inválido NÃO vira "todas": isso já seria a carga completa por engano.`);
    process.exit(1);
  }
  limite = Number(cru);
}

const casa = process.env.USERPROFILE || process.env.HOME || ".";
const PLANILHA =
  args.find((a) => a.startsWith("--planilha="))?.slice(11) ||
  path.join(casa, "Documents", "Tabela Garden.xlsx");

// Garden na tabela `enterprises` do C2X (code GDN).
// ⚠️ O prefixo do nome é o CODE do empreendimento, não um apelido escolhido aqui. Medido no banco:
// 4654 de 4654 unidades, em 30 de 30 empreendimentos com unidade, têm name começando pelo code
// (VLO0101, VOC0104, LOU0101, CDJ0101...). Este arquivo já dizia "GDN" e mesmo assim o prefixo
// estava "GND" — transposição de letra. Fica GDN, e o script CONFERE contra a tabela `enterprises`
// antes de enviar, porque depois de criado não há PUT de unidade no contrato de integração (só
// /panteon/users tem PUT) e o MySQL é read-only: correção viraria edição manual, tela a tela.
const EMPREENDIMENTO_ID = 39;
const PREFIXO_DO_NOME = "GDN";
const TIPO_UNIDADE_ID = 1; // 1 = Unidade interna (é o que o Vale do Ouro usou)
const CAMINHO = "/api/v1/integrations/panteon/enterprise_units";

// ⚠️ O HOST NÃO VEM DA ENV DE PROPÓSITO. O `.env.local` aponta para `teste.careli.adm.br`, que é o
// certo para o app rodando na máquina do dev — e foi o que fez a primeira tentativa do Vale do Ouro
// cair no ambiente errado (lá o endpoint nem existe, devolve 404). Aqui o destino é escrito por
// extenso, à vista, e aparece em letras grandes antes de qualquer envio.
const HOST_PRODUCAO = "https://sistema.careli.adm.br";
const host = (args.find((a) => a.startsWith("--host="))?.slice(7) || HOST_PRODUCAO).replace(/\/+$/, "");

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

const conectarC2x = () =>
  mysql.createConnection({
    database: env.GUARDIAN_DB_NAME,
    dateStrings: true,
    host: env.GUARDIAN_DB_HOST,
    password: env.GUARDIAN_DB_PASSWORD,
    port: Number(env.GUARDIAN_DB_PORT || 3306),
    user: env.GUARDIAN_DB_USER,
  });

// O que já existe lá — é assim que sabemos o que criar e o que conferir depois. Só leitura.
async function unidadesNoC2x() {
  const c = await conectarC2x();
  const [rows] = await c.query(
    `SELECT id, name, block, lot, area, price, registration_number, sale_status_id,
            sale_blocked, enterprise_unity_type_id
       FROM enterprise_unities WHERE enterprise_id = ?`,
    [EMPREENDIMENTO_ID],
  );
  await c.end();
  return rows;
}

// O code do empreendimento no C2X — é dele que o prefixo do nome tem de sair. Só leitura.
async function codeDoEmpreendimento() {
  const c = await conectarC2x();
  const [rows] = await c.query(`SELECT id, code, name FROM enterprises WHERE id = ?`, [EMPREENDIMENTO_ID]);
  await c.end();
  return rows[0] || null;
}

if (soConferir) {
  const jaLa = await unidadesNoC2x();
  console.log(`Garden (enterprise ${EMPREENDIMENTO_ID}) tem ${jaLa.length} unidades no C2X.`);
  const semMatricula = jaLa.filter((u) => !u.registration_number);
  if (semMatricula.length) console.log(`⚠️  ${semMatricula.length} sem matrícula.`);
  const aUm = jaLa.filter((u) => Number(u.price) <= 1);
  if (aUm.length) console.log(`⚠️  ${aUm.length} com preço R$ 1,00 (valor ainda não definido pelo dono).`);
  for (const u of jaLa.slice(0, 10)) {
    console.log(
      `  ${u.id} ${u.name} · Q${u.block} L${u.lot} · ${u.area}m² · R$ ${u.price} · matrícula ${u.registration_number || "—"} · status ${u.sale_status_id} · bloqueado ${u.sale_blocked} · tipo ${u.enterprise_unity_type_id}`,
    );
  }
  process.exit(0);
}

// ── leitores de célula ────────────────────────────────────────────────────
// Três armadilhas desta planilha, todas já custaram leitura errada:
//   1. o cabeçalho é richText: vem {richText:[{text}]}, não string;
//   2. muita célula é FÓRMULA: vem {formula, result} ou {result, sharedFormula} — vale o `.result`;
//   3. 161 células de valor da aba 1 são FÓRMULA QUEBRADA: {formula:"#REF!", result:{error:"#REF!"}}.
//      O `.result` aí é um OBJETO de erro. Um String() ingênuo devolve "[object Object]" e sobe
//      lixo como preço. Por isso: result objeto = SEM VALOR, ponto.
const texto = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((p) => p.text ?? "").join("");
    if ("result" in v) {
      const r = v.result;
      if (r === null || r === undefined || typeof r === "object") return ""; // #REF! e cia
      return String(r);
    }
    if ("error" in v) return "";
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v);
};

const numero = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return numero(v.richText.map((p) => p.text ?? "").join(""));
    if ("result" in v) {
      const r = v.result;
      if (typeof r === "number") return Number.isFinite(r) ? r : null;
      if (typeof r === "string") return numero(r);
      return null; // objeto de erro
    }
    return null;
  }
  const s = String(v).replace(/[R$\s ]/g, "").trim();
  if (!s) return null;
  // "1.234,56" -> 1234.56 (vírgula é o decimal, ponto é milhar).
  // Sem vírgula o ponto é AMBÍGUO: "150.000" em planilha brasileira é cento e cinquenta mil, não
  // 150. Hoje nenhuma célula das colunas numéricas vem como string, mas basta alguém digitar um
  // valor numa célula formatada como Texto (ou colar de PDF) para R$ 150.000 virar R$ 150,00 no
  // C2X — e 150 é > 1, então passaria como preço legítimo, sem trava nenhuma. Por isso: ponto
  // separando grupos de 3 dígitos = MILHAR.
  let limpo;
  if (s.includes(",")) limpo = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) limpo = s.replace(/\./g, "");
  else limpo = s;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
};

// Célula com erro do Excel (#REF! e amigos) — só para contabilizar a procedência do preço.
// Duas formas: fórmula que resulta em erro ({formula, result:{error}}) e erro ESTÁTICO ({error}),
// que é o que sobra quando alguém cola valores por cima das fórmulas. As duas contam, senão o
// placar diria "0 fórmulas quebradas + 161 vazias" e o dono acharia que a planilha foi consertada
// quando só foi colada. Para o payload dá no mesmo: numero() devolve null nos dois casos.
const ehFormulaQuebrada = (v) => {
  if (!v || typeof v !== "object") return false;
  if ("result" in v && typeof v.result === "object" && v.result !== null) return true;
  return "error" in v && !Array.isArray(v.richText);
};

// ── situação -> status, tolerante a acento, caixa e espaço ────────────────
// Regra do dono: "Para as situações de Reservado - Vendido flagar no c2x o bloqueado para venda,
// o disponível, disponível mesmo." O padrão da casa medido no Vale do Ouro é status 5 SEMPRE junto
// com sale_blocked 1 — nunca um sem o outro.
//   sale_statuses: 1=Disponível · 2=Reservado · 3=Em negociação · 4=Vendido · 5=Bloqueado p/ venda
const chaveSituacao = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira os acentos separados pelo NFD
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const STATUS_POR_SITUACAO = {
  disponivel: { bloqueado: 0, rotulo: "Disponível", statusId: 1 },
  reservado: { bloqueado: 1, rotulo: "Reservado", statusId: 5 },
  vendido: { bloqueado: 1, rotulo: "Vendido", statusId: 5 },
};

// ── lê a planilha ─────────────────────────────────────────────────────────
if (!fs.existsSync(PLANILHA)) {
  console.error(`⛔ Planilha não encontrada: ${PLANILHA}`);
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(PLANILHA);

const ws1 = wb.getWorksheet("Planilha1") || wb.worksheets[0];
const ws2 = wb.getWorksheet("Planilha2") || wb.worksheets[1];
if (!ws1) {
  console.error("⛔ Não achei a aba do cadastro dos lotes (Planilha1).");
  process.exit(1);
}
if (!ws2) {
  console.error("⛔ Não achei a aba dos vendidos com preço (Planilha2). O preço vem dela.");
  process.exit(1);
}

// ABA 2 primeiro — é ela que manda no preço. Chave = [6] quadra e [7] lote, que já vêm com dois
// dígitos via TEXT(...,"00"). Ler via `.values` (array 1-INDEXADO; values[0] é null).
const precoDaAba2 = new Map();
let linhasAba2 = 0;
let aba2ComZero = 0;
for (let i = 2; i <= ws2.rowCount; i++) {
  const v = ws2.getRow(i).values;
  const q = texto(v[6]).trim();
  const l = texto(v[7]).trim();
  if (!q || !l) continue;
  linhasAba2 += 1;
  const valor = numero(v[8]);
  if (!valor || valor <= 0) aba2ComZero += 1;
  precoDaAba2.set(`${q.padStart(2, "0")}|${l.padStart(2, "0")}`, {
    cliente: texto(v[5]).trim(),
    linha: i,
    valor,
  });
}

// ABA 1 — o cadastro. [1]=Quadra [2]=Lote [3]=Situação [4]=Metragem [5]=Valor [6]=Cliente
const unidades = [];
const vistas = new Map();
const duplicadas = [];
const situacoesDesconhecidas = new Map();
let linhasAba1 = 0;
let aba1RefQuebrado = 0;
let aba1ValorUm = 0;
let aba1SemValor = 0;

for (let i = 2; i <= ws1.rowCount; i++) {
  const v = ws1.getRow(i).values;
  const quadraCru = texto(v[1]).trim();
  const loteCru = texto(v[2]).trim();
  if (!quadraCru || !loteCru) continue;
  linhasAba1 += 1;

  const situacao = texto(v[3]).trim();
  const area = numero(v[4]);
  const bruto = v[5];
  const valorAba1 = numero(bruto);
  // Contagem POR LINHA (as 406, incluindo a duplicata que será descartada). A contagem por lote
  // único sai depois, a partir de `unidades` — misturar os dois denominadores no relatório fazia
  // quem confere ver 206 onde mediu 207 e achar que sumiu lote.
  const erroNaCelula = ehFormulaQuebrada(bruto);
  if (erroNaCelula) aba1RefQuebrado += 1;
  else if (valorAba1 === 1) aba1ValorUm += 1;
  else if (valorAba1 === null || valorAba1 <= 0) aba1SemValor += 1;

  const quadra = quadraCru.padStart(2, "0");
  const lote = loteCru.padStart(2, "0");
  const chave = `${quadra}|${lote}`;

  // DEDUP: a Q10 L01 aparece duas vezes na planilha (linhas 226 e 227), as duas Vendido, área 420.
  // É a MESMA unidade — a quadra 10 tem 13 lotes reais, não 14. Não pode subir duas vezes.
  // Fica a PRIMEIRA linha. A comparação inclui o VALOR: sem isso, o dono conserta o #REF! na linha
  // de baixo (a que ele enxerga por último), o script fica com a de cima, sobe o lote a R$ 1,00 e
  // ainda imprime "idênticas, é a mesma unidade" — preço descartado em silêncio.
  if (vistas.has(chave)) {
    const antes = vistas.get(chave);
    const precoUtil = (x) => x !== null && x > 1;
    duplicadas.push({
      chave,
      divergeValor: (antes.precoAba1 ?? null) !== (valorAba1 ?? null),
      divergente:
        antes.area !== area ||
        chaveSituacao(antes.situacao) !== chaveSituacao(situacao) ||
        (antes.precoAba1 ?? null) !== (valorAba1 ?? null),
      linha: i,
      linhaOriginal: antes.linha,
      // A linha descartada tinha preço e a mantida não: isso NÃO pode passar como "idênticas".
      precoSoNaDescartada: precoUtil(valorAba1) && !precoUtil(antes.precoAba1),
      valorDescartado: valorAba1,
      valorMantido: antes.precoAba1 ?? null,
    });
    continue;
  }

  const mapeado = STATUS_POR_SITUACAO[chaveSituacao(situacao)];
  if (!mapeado) {
    const k = situacao || "(vazio)";
    if (!situacoesDesconhecidas.has(k)) situacoesDesconhecidas.set(k, []);
    situacoesDesconhecidas.get(k).push(`linha ${i} · Q${quadra} L${lote}`);
  }

  // 📌 REGRA DE PREÇO — ordem do dono, textual: "pega da segunda aba".
  //   1. valor da ABA 2, se existir e for > 0;
  //   2. senão o valor da ABA 1, se for número real (não #REF!, não vazio, não 1);
  //   3. senão 1 — o dono: "o que ficou com 1 eu não tenho o valor ainda".
  const daAba2 = precoDaAba2.get(chave);

  // 📌 EXCEÇÃO À REGRA, decidida pelo dono em 07/08: "deixa como disponível mesmo com preço da
  // aba 1". Vale para o lote que a aba 1 diz DISPONÍVEL mas que aparece com comprador na aba 2 —
  // hoje Q06 L11, Q10 L06 e Q12 L23. São vendas que caíram: a aba 1 é a atual, a aba 2 é o
  // histórico. Sem esta exceção o lote subiria com o preço da venda desfeita (no Q10 L06,
  // R$ 268.000 no lugar dos R$ 421.500 de tabela) e o corretor venderia barato no salão.
  // A exceção é só de PREÇO e só neste caso; o status já vinha da aba 1 de qualquer forma.
  const vendaDesfeita =
    Boolean(daAba2) && chaveSituacao(situacao) === chaveSituacao("Disponível");

  let preco;
  let origemDoPreco;
  if (vendaDesfeita && valorAba1 !== null && valorAba1 > 1) {
    preco = valorAba1;
    origemDoPreco = "aba1-venda-desfeita";
  } else if (daAba2 && daAba2.valor !== null && daAba2.valor > 0) {
    preco = daAba2.valor;
    origemDoPreco = "aba2";
  } else if (valorAba1 !== null && valorAba1 > 1) {
    preco = valorAba1;
    origemDoPreco = "aba1";
  } else {
    preco = 1;
    origemDoPreco = "sem-valor";
  }

  const u = {
    aba1ComErro: erroNaCelula,
    area,
    chave,
    cliente: texto(v[6]).trim() || daAba2?.cliente || "",
    linha: i,
    lote,
    origemDoPreco,
    preco,
    precoAba1: valorAba1,
    precoAba2: daAba2?.valor ?? null,
    quadra,
    situacao,
    status: mapeado || null,
  };
  vistas.set(chave, u);
  unidades.push(u);
}

// Situação desconhecida ABORTA — não se chuta status de lote.
if (situacoesDesconhecidas.size > 0) {
  console.error(`\n⛔ Situação desconhecida na planilha. Nada foi lido adiante, nada foi enviado.`);
  for (const [sit, ondes] of situacoesDesconhecidas) {
    console.error(`   "${sit}" · ${ondes.length}x · ex.: ${ondes.slice(0, 3).join(" | ")}`);
  }
  console.error(`   Conhecidas: ${Object.values(STATUS_POR_SITUACAO).map((s) => s.rotulo).join(", ")}.`);
  process.exit(1);
}

// Obrigatórios da API: enterprise_id, block, lot, area, price. Área faltando aborta.
const semArea = unidades.filter((u) => u.area === null || !(u.area > 0));
if (semArea.length > 0) {
  console.error(`\n⛔ ${semArea.length} lote(s) sem metragem válida. Nada foi enviado:`);
  for (const u of semArea.slice(0, 10)) console.error(`   linha ${u.linha} · Q${u.quadra} L${u.lote}`);
  process.exit(1);
}

// PADRÃO DA CASA: quadra e lote sempre com DOIS DÍGITOS — "1" vira "01". Vale para `block` e `lot`,
// não só para o nome. É o que mantém a ordenação certa nas telas: sem isso o lote 10 aparece antes
// do 2. Números com 3+ dígitos passam inteiros, sem truncar.
const doisDigitos = (v) => String(v).trim().padStart(2, "0");
const nomeDaUnidade = (u) => `${PREFIXO_DO_NOME}${doisDigitos(u.quadra)}${doisDigitos(u.lote)}`;

// A planilha do Garden NÃO TEM COLUNA DE MATRÍCULA (a do Vale do Ouro tinha). Na API a matrícula
// não é obrigatória, então aqui não abortamos — os campos simplesmente não vão no corpo, e o ensaio
// grita o aviso. Preencher depois é edição; subir string vazia seria sujeira no legado.
const montarPayload = (u) => ({
  area: u.area,
  block: doisDigitos(u.quadra),
  enterprise_id: EMPREENDIMENTO_ID,
  enterprise_unity_type_id: TIPO_UNIDADE_ID,
  lot: doisDigitos(u.lote),
  name: nomeDaUnidade(u),
  price: u.preco,
  sale_blocked: u.status.bloqueado,
  sale_status_id: u.status.statusId,
});

// ── procedência do preço — o número que o dono confere ────────────────────
const daAba2 = unidades.filter((u) => u.origemDoPreco === "aba2");
// "aba1-venda-desfeita" também é preço vindo da aba 1 — só que por exceção do dono, não pela ordem
// normal. Tem que entrar nesta conta, senão a soma das procedências não fecha com o total de lotes.
const daAba1 = unidades.filter(
  (u) => u.origemDoPreco === "aba1" || u.origemDoPreco === "aba1-venda-desfeita",
);
const porVendaDesfeita = unidades.filter((u) => u.origemDoPreco === "aba1-venda-desfeita");
const semValor = unidades.filter((u) => u.origemDoPreco === "sem-valor");
// "Resgate" = lote que a aba 1 não tinha e a aba 2 supriu (aba 1 sem preço utilizável).
const resgatados = daAba2.filter((u) => !(u.precoAba1 !== null && u.precoAba1 > 1));
// Preço nas duas abas, com a aba 2 vencendo — é onde a ordem do dono muda um valor que já existia.
const sobrepostos = unidades.filter(
  (u) => u.origemDoPreco === "aba2" && u.precoAba1 !== null && u.precoAba1 > 1 && u.precoAba1 !== u.precoAba2,
);

// Contradição entre as abas: a aba 2 é a lista dos VENDIDOS, com comprador. Se um lote está lá e
// a aba 1 diz "Disponível", uma das duas está errada — e o status sai da aba 1, então o lote subiria
// à venda mesmo já tendo dono. Não dá para adivinhar qual aba vale: quem decide é o dono.
const disponivelMasNaAba2 = unidades.filter(
  (u) => u.status.statusId === 1 && precoDaAba2.has(u.chave) && (precoDaAba2.get(u.chave).cliente || "") !== "",
);
// Disponível cujo preço veio da aba2 e CONTRADIZ a tabela da aba1 (Q10 L06 cai 36%, Q12 L23 cai 38%).
const disponivelComPrecoDivergente = sobrepostos.filter((u) => u.status.statusId === 1);

// ── CONTRADIÇÃO ENTRE AS ABAS = fica FORA da carga ────────────────────────
// Era a assimetria mais perigosa do script: ele BARRAVA 1 lote disponível a R$ 1,00 (erro óbvio,
// que qualquer humano pega) e DEIXAVA PASSAR 3 lotes disponíveis, desbloqueados, com comprador
// nomeado na aba2 e preço de outra planilha — R$ 268.000 num lote que a tabela do dono diz
// R$ 435.000 parece legítimo e ninguém pega. Resultado seria lote já vendido exposto de novo no
// salão, 36-38% mais barato, e criar unidade não tem desfazer. Enquanto o dono não disser qual aba
// vale, esses lotes não sobem.
const contraditorios = [
  ...new Map(
    [...disponivelMasNaAba2, ...disponivelComPrecoDivergente].map((u) => [u.chave, u]),
  ).values(),
].sort((a, b) => a.chave.localeCompare(b.chave));
const motivoDaContradicao = (u) => {
  const partes = [];
  if (disponivelMasNaAba2.includes(u)) partes.push(`comprador na aba2: ${precoDaAba2.get(u.chave).cliente}`);
  if (disponivelComPrecoDivergente.includes(u)) {
    partes.push(
      `preço aba1 R$ ${u.precoAba1.toLocaleString("pt-BR")} → aba2 R$ ${u.precoAba2.toLocaleString("pt-BR")}`,
    );
  }
  return partes.join(" · ");
};

const porSituacao = new Map();
for (const u of unidades) porSituacao.set(u.status.rotulo, (porSituacao.get(u.status.rotulo) || 0) + 1);
const porQuadra = new Map();
for (const u of unidades) porQuadra.set(u.quadra, (porQuadra.get(u.quadra) || 0) + 1);
const semValorPorSituacao = new Map();
for (const u of semValor) semValorPorSituacao.set(u.status.rotulo, (semValorPorSituacao.get(u.status.rotulo) || 0) + 1);

// ── o único caso que merece parada: DISPONÍVEL sem preço ──────────────────
// Vendido e reservado a R$ 1,00 é decisão do dono e passa liso. Disponível sem preço é corretor
// vendendo pelo valor errado no salão — por isso fica de fora até alguém assumir por escrito.
const disponivelSemPreco = semValor.filter((u) => u.status.statusId === 1);
const bloqueadosPorFalta = aceitaDisponivelSemPreco ? [] : disponivelSemPreco;
// ✅ CONTRADIÇÃO ENTRE ABAS: RESOLVIDA pelo dono em 07/08 — "deixa como disponível mesmo com preço
// da aba 1". A aba 1 é o cadastro atual; a aba 2 é o histórico de vendas, e essas três caíram.
// Reforça a decisão: R$ 268.000 aparece 113 vezes na aba 2, é o valor mais repetido de lá — cara de
// preenchimento genérico, não de preço negociado. Por isso não bloqueiam mais: sobem disponíveis,
// com o preço de tabela da aba 1 (ver `vendaDesfeita` na leitura). O ensaio continua listando os
// três, porque decisão registrada não é decisão esquecida — se a lista crescer, alguém tem que olhar.
const bloqueadosPorContradicao = [];
// Duplicata em que a linha DESCARTADA tinha preço e a mantida não: ninguém sobe lote a R$ 1,00
// tendo preço na planilha. Some quando o dono desfizer a duplicidade.
const bloqueadosPorDuplicata = duplicadas
  .filter((d) => d.precoSoNaDescartada)
  .map((d) => vistas.get(d.chave))
  .filter(Boolean);
const chavesBloqueadas = new Set(
  [...bloqueadosPorFalta, ...bloqueadosPorContradicao, ...bloqueadosPorDuplicata].map((u) => u.chave),
);

// ── contagens POR LOTE ÚNICO (as que batem com "A subir") ─────────────────
// O relatório antes misturava denominadores em linhas vizinhas: "405 lotes únicos" ao lado de
// "161 + 150 + 1 = 312", que são contagens por LINHA (as 406, com a duplicata). Quem conferisse via
// 206 onde mediu 207 e podia concluir que sumiu lote. Agora os dois números aparecem, nomeados.
const unicoComErro = unidades.filter((u) => u.aba1ComErro).length;
const unicoValorUm = unidades.filter((u) => !u.aba1ComErro && u.precoAba1 === 1).length;
const unicoSemValor = unidades.filter(
  (u) => !u.aba1ComErro && u.precoAba1 !== 1 && (u.precoAba1 === null || u.precoAba1 <= 0),
).length;

// ── o que falta subir ─────────────────────────────────────────────────────
let jaLa = [];
let leuOBanco = true;
let empreendimento = null;
try {
  jaLa = await unidadesNoC2x();
  empreendimento = await codeDoEmpreendimento();
} catch (erro) {
  leuOBanco = false;
  if (enviarDeVerdade) {
    console.error(`\n⛔ Não consegui ler o C2X para saber o que já existe: ${erro}`);
    console.error(`   Sem essa leitura o envio pode duplicar unidade. Nada foi enviado.`);
    process.exit(1);
  }
  console.log(`⚠️  Não consegui ler o banco do C2X (${erro}). O ensaio segue supondo ZERO unidades lá.`);
}

// O nome da unidade tem de começar pelo CODE do empreendimento — é assim em 4654 de 4654 unidades
// do C2X. Se o prefixo daqui não bater com o code da tabela `enterprises`, PARA: nome errado só se
// conserta na mão, unidade por unidade, porque não existe PUT de unidade na integração.
if (empreendimento && String(empreendimento.code || "").trim().toUpperCase() !== PREFIXO_DO_NOME) {
  console.error(`\n⛔ Prefixo do nome não bate com o code do empreendimento no C2X.`);
  console.error(`   script: "${PREFIXO_DO_NOME}" · banco: "${empreendimento.code}" (${empreendimento.name})`);
  console.error(`   Corrija PREFIXO_DO_NOME. Nada foi enviado.`);
  process.exit(1);
}

// Compara nos DOIS lados já com dois dígitos: o C2X guarda "01" e a planilha traz "1". Sem essa
// normalização o script acharia que nada existe e criaria tudo de novo, em duplicidade.
const jaExiste = new Set(jaLa.map((u) => `${doisDigitos(u.block)}|${doisDigitos(u.lot)}`));
const aSubir = unidades.filter((u) => !jaExiste.has(u.chave) && !chavesBloqueadas.has(u.chave));

// ── relatório ─────────────────────────────────────────────────────────────
console.log(`Planilha: ${PLANILHA}`);
console.log(
  `Empreendimento ${EMPREENDIMENTO_ID} (Garden / prefixo ${PREFIXO_DO_NOME}` +
    (empreendimento ? ` · code no C2X: ${empreendimento.code} ✅` : ` · code do C2X não conferido`) +
    `)`,
);
console.log(
  `\nLeitura · aba1: ${linhasAba1} linhas · ${unidades.length} lotes únicos · ${porQuadra.size} quadras` +
    (duplicadas.length ? ` · ${duplicadas.length} linha(s) duplicada(s) descartada(s)` : ""),
);
const reais = (n) => (n === null || n === undefined ? "—" : `R$ ${Number(n).toLocaleString("pt-BR")}`);
for (const d of duplicadas) {
  console.log(
    `   ↳ Q${d.chave.split("|")[0]} L${d.chave.split("|")[1]} repetida na linha ${d.linha} (já lida na ${d.linhaOriginal})` +
      (d.divergente ? " ⚠️  as duas linhas NÃO são idênticas — conferir na planilha" : " · idênticas, é a mesma unidade"),
  );
  // A comparação de duplicata inclui o VALOR: fica a linha de cima, e se a de baixo tinha preço
  // que a de cima não tem, isso aparece — descartar preço em silêncio é como o lote iria a R$ 1,00
  // logo depois de o dono ter corrigido o #REF! na outra linha.
  if (d.divergeValor) {
    console.log(`      valor: mantido ${reais(d.valorMantido)} · descartado ${reais(d.valorDescartado)}`);
  }
  if (d.precoSoNaDescartada) {
    console.log(`      ⛔ a linha DESCARTADA tinha preço e a mantida não. Resolver a duplicata na planilha.`);
  }
}
console.log(`Leitura · aba2: ${linhasAba2} linhas · ${precoDaAba2.size} chaves únicas · ${aba2ComZero} com valor zerado`);
const orfas = [...precoDaAba2.keys()].filter((k) => !vistas.has(k));
if (orfas.length) console.log(`   ⚠️  ${orfas.length} chave(s) da aba2 sem par na aba1: ${orfas.slice(0, 10).join(" ")}`);
console.log(
  `Situação (por lote único, ${unidades.length}): ${[...porSituacao].map(([k, n]) => `${k} ${n}`).join(" · ")}` +
    (duplicadas.length ? ` — por linha (${linhasAba1}) daria +${duplicadas.length} na situação da duplicata` : ""),
);
console.log(`Lotes por quadra: ${[...porQuadra].sort().map(([q, n]) => `${q}:${n}`).join(" ")}`);

console.log(`\n╔══════════════════════════════════════════════════════════════`);
console.log(`║  PROCEDÊNCIA DO PREÇO  (regra do dono: aba2 > aba1 > R$ 1,00)`);
console.log(`╠══════════════════════════════════════════════════════════════`);
console.log(`║  da ABA 2 (preço de venda) ... ${String(daAba2.length).padStart(3)}   (${resgatados.length} que a aba1 não tinha)`);
console.log(
  `║  da ABA 1 (tabela) .......... ${String(daAba1.length).padStart(3)}` +
    (porVendaDesfeita.length ? `   (${porVendaDesfeita.length} por venda desfeita, exceção do dono)` : ""),
);
console.log(`║  em R$ 1,00 (sem valor) ..... ${String(semValor.length).padStart(3)}   ${[...semValorPorSituacao].map(([k, n]) => `${k} ${n}`).join(" · ")}`);
console.log(`╠══════════════════════════════════════════════════════════════`);
// A soma tem que fechar com o total de lotes únicos. Se não fechar, alguma origem de preço ficou
// fora da conta e o número que o dono confere está mentindo — melhor gritar do que exibir errado.
const somaOrigens = daAba2.length + daAba1.length + semValor.length;
console.log(
  `║  soma ........................ ${String(somaOrigens).padStart(3)}` +
    (somaOrigens === unidades.length ? `   = ${unidades.length} lotes ✅` : `   ⛔ DIFERE de ${unidades.length} lotes`),
);
console.log(`╚══════════════════════════════════════════════════════════════`);
if (somaOrigens !== unidades.length) {
  console.error(`\n⛔ A soma das procedências não fecha com o total de lotes. Nada foi enviado.`);
  process.exit(1);
}
// Dois denominadores, nomeados — o de cima é o que fecha com "lotes únicos" e com "A subir".
console.log(
  `   Na aba1 sozinha, POR LOTE ÚNICO (${unidades.length}): ${unicoComErro} com erro de fórmula (#REF!) + ${unicoValorUm} com valor 1 + ${unicoSemValor} vazias = ${unicoComErro + unicoValorUm + unicoSemValor} sem preço utilizável.`,
);
console.log(
  `   Na aba1 sozinha, POR LINHA (${linhasAba1}, inclui a duplicata descartada): ${aba1RefQuebrado} + ${aba1ValorUm} + ${aba1SemValor} = ${aba1RefQuebrado + aba1ValorUm + aba1SemValor}.`,
);

if (sobrepostos.length) {
  console.log(`\n⚠️  ${sobrepostos.length} lote(s) têm preço nas DUAS abas com valores DIFERENTES.`);
  console.log(`   A ordem do dono é "pega da segunda aba", então vai o valor da aba2:`);
  for (const u of sobrepostos) {
    const barrado = chavesBloqueadas.has(u.chave) ? " ⛔ fora da carga (contradição)" : "";
    console.log(
      `   Q${u.quadra} L${u.lote} · ${u.status.rotulo} · aba1 R$ ${u.precoAba1.toLocaleString("pt-BR")} → aba2 R$ ${u.precoAba2.toLocaleString("pt-BR")}${barrado}`,
    );
  }
  console.log(`   Em lote VENDIDO/RESERVADO isso é o esperado: a aba2 é o preço da venda fechada.`);
  console.log(`   Em lote DISPONÍVEL é contradição, e aí ele não sobe (bloco abaixo).`);
}

if (contraditorios.length) {
  console.log(`\n╔══════════════════════════════════════════════════════════════`);
  console.log(`║  ✅ ${contraditorios.length} lote(s) em que a aba1 e a aba2 divergem — RESOLVIDO`);
  console.log(`╠══════════════════════════════════════════════════════════════`);
  for (const u of contraditorios) {
    const preco = `R$ ${u.preco.toLocaleString("pt-BR")}`;
    console.log(`║  Q${u.quadra} L${u.lote} · sobe DISPONÍVEL a ${preco} (aba1) · ${motivoDaContradicao(u)}`);
  }
  console.log(`╚══════════════════════════════════════════════════════════════`);
  console.log(`   Decisão do dono, 07/08: "deixa como disponível mesmo com preço da aba 1".`);
  console.log(`   A aba1 é o cadastro atual; a aba2 é o histórico, e essas vendas caíram.`);
  console.log(`   Reforça: R$ 268.000 aparece 113x na aba2, o valor mais repetido de lá — tem cara de`);
  console.log(`   preenchimento genérico, não de preço negociado.`);
  console.log(`   Continuam listados aqui de propósito: se essa lista CRESCER numa próxima carga, são`);
  console.log(`   lotes novos em contradição, e aí alguém precisa olhar de novo.`);
}

// Aviso de matrícula: claro, uma vez, e não aborta.
console.log(`\n⚠️  MATRÍCULA: a planilha do Garden não traz matrícula (a do Vale do Ouro trazia).`);
console.log(`   As ${aSubir.length} unidades desta carga sobem SEM registration / registration_number.`);
console.log(`   Na API esses campos são opcionais, então isso não impede a carga — mas fica pendente`);
console.log(`   preencher depois, porque matrícula errada (ou ausente) vira contrato errado.`);

if (disponivelSemPreco.length > 0) {
  console.log(`\n╔══════════════════════════════════════════════════════════════`);
  console.log(`║  ⛔ ${disponivelSemPreco.length} lote(s) DISPONÍVEIS ficariam a R$ 1,00`);
  console.log(`╠══════════════════════════════════════════════════════════════`);
  for (const u of disponivelSemPreco) {
    console.log(`║  Q${u.quadra} L${u.lote} · ${u.area}m² · ${u.status.rotulo}`);
  }
  console.log(`╚══════════════════════════════════════════════════════════════`);
  console.log(`   Vendido e reservado a R$ 1,00 é decisão do dono e passa liso. Disponível sem preço,`);
  console.log(`   não: é o corretor vendendo pelo valor errado no salão.`);
  if (aceitaDisponivelSemPreco) {
    console.log(`   --aceito-disponivel-sem-preco foi passada: ESSES LOTES ENTRAM na carga, a R$ 1,00.`);
  } else {
    console.log(`   Ficam de FORA desta carga. Sobem os outros ${aSubir.length}.`);
    console.log(`   Para incluir mesmo assim, repita o comando com --aceito-disponivel-sem-preco.`);
  }
}

if (bloqueadosPorDuplicata.length > 0) {
  console.log(`\n⛔ ${bloqueadosPorDuplicata.length} lote(s) fora da carga por DUPLICATA com preço só na linha descartada:`);
  for (const u of bloqueadosPorDuplicata) console.log(`   Q${u.quadra} L${u.lote}`);
}

console.log(`\n╔══════════════════════════════════════════════════════════════`);
console.log(`║  FORA DESTA CARGA: ${chavesBloqueadas.size} lote(s)`);
console.log(`╠══════════════════════════════════════════════════════════════`);
console.log(`║  disponível sem preço ..... ${String(bloqueadosPorFalta.length).padStart(3)}`);
console.log(`║  contradição entre abas ... ${String(bloqueadosPorContradicao.length).padStart(3)}`);
console.log(`║  duplicata com preço ...... ${String(bloqueadosPorDuplicata.length).padStart(3)}`);
console.log(`╚══════════════════════════════════════════════════════════════`);

console.log(`\nJá no C2X: ${jaLa.length}${leuOBanco ? "" : " (não lido — banco indisponível)"}`);
console.log(`A subir: ${aSubir.length} de ${unidades.length} lotes únicos`);

// O que sai no payload, contado no payload — é o número que o dono confere contra o C2X depois.
const contar = (fn) => aSubir.filter(fn).length;
console.log(
  `   status 1 + sale_blocked 0 (Disponível): ${contar((u) => u.status.statusId === 1)} · ` +
    `status 5 + sale_blocked 1 (Reservado/Vendido): ${contar((u) => u.status.statusId === 5)}`,
);
console.log(
  `   preço da aba2: ${contar((u) => u.origemDoPreco === "aba2")} · da aba1: ${contar((u) => u.origemDoPreco === "aba1")} · ` +
    `a R$ 1,00: ${contar((u) => u.origemDoPreco === "sem-valor")}`,
);

const lote = aSubir.slice(0, limite);

// Veredito do destino: PROTOCOLO + HOST, calculado antes do ensaio para que o operador veja no
// ensaio o mesmo que o envio veria. Só host não basta: `--host=http://sistema.careli.adm.br` era
// anunciado como "É o C2X de PRODUÇÃO" e mandaria o token de escrita em texto claro, 401 vezes.
const urlDestino = new URL(host);
const ehProducao = urlDestino.protocol === "https:" && urlDestino.host === "sistema.careli.adm.br";

if (!enviarDeVerdade) {
  console.log(`\n── ENSAIO (nada foi enviado) ──`);
  console.log(`Iriam agora: ${lote.length}`);
  if (lote.length > 0) {
    console.log(`\nExemplo do corpo que sai (Q${lote[0].quadra} L${lote[0].lote}):`);
    console.log(JSON.stringify(montarPayload(lote[0]), null, 2));
    const exemploUm = lote.find((u) => u.preco === 1);
    if (exemploUm) {
      console.log(`\nExemplo de lote sem valor (vai a R$ 1,00) — Q${exemploUm.quadra} L${exemploUm.lote}:`);
      console.log(JSON.stringify(montarPayload(exemploUm), null, 2));
    }
  }
  console.log(
    `\nDestino que seria usado: ${urlDestino.protocol}//${urlDestino.host} — ` +
      (ehProducao ? "é o C2X de PRODUÇÃO." : "⚠️  NÃO é o C2X de produção, o envio abortaria."),
  );
  if (!ehProducao && urlDestino.protocol !== "https:") {
    console.log(`   Sem TLS o token de escrita viajaria em texto claro: o envio recusa http://.`);
  }
  console.log(`\nPara enviar de verdade (comece pequeno, UMA execução por vez):`);
  console.log(`  node scripts/apolo/subir-unidades-garden.mjs --enviar --n=5`);
  process.exit(0);
}

// ── envio ─────────────────────────────────────────────────────────────────
const base = host;
const token = env.C2X_WRITE_API_TOKEN;
if (!token) {
  console.error("Falta C2X_WRITE_API_TOKEN em apps/hub/.env.local");
  process.exit(1);
}

console.log(`\n╔═══════════════════════════════════════════════════════`);
console.log(`║  DESTINO: ${urlDestino.protocol}//${urlDestino.host}`);
console.log(`║  ${ehProducao ? "É o C2X de PRODUÇÃO." : "⚠️  NÃO é o C2X de produção!"}`);
console.log(`╚═══════════════════════════════════════════════════════`);

if (urlDestino.protocol !== "https:") {
  console.error(`\n⛔ Destino sem TLS (${urlDestino.protocol}). O token de escrita do C2X iria em texto`);
  console.error(`   claro em cada uma das ${lote.length} requisições. Use https://. Nada foi enviado.`);
  process.exit(1);
}

// Destino diferente de produção não é só um aviso: é o incidente do Vale do Ouro se repetindo, agora
// por flag em vez de env. Aviso que não interrompe é aviso lido depois do estrago.
if (!ehProducao && !confirmouDestinoNaoProducao) {
  console.error(`\n⛔ ${urlDestino.host} não é o C2X de produção e a carga NÃO foi enviada.`);
  console.error(`   Se é isso mesmo que você quer, repita com --confirmo-destino-nao-producao.`);
  console.error(`   Lembre: a conferência do fim lê o MySQL de PRODUÇÃO, então uma carga que foi para`);
  console.error(`   outro ambiente aparece lá como "o banco ganhou 0".`);
  process.exit(1);
}

// TRAVA: uma execução por vez. Sem índice único em (enterprise_id, block, lot) no legado, dois
// processos leem o mesmo "já no C2X" e criam tudo em duplicidade sem o banco reclamar.
const arquivoDeTrava = path.join(os.tmpdir(), `garden-c2x-${EMPREENDIMENTO_ID}.lock`);
let trava;
try {
  trava = fs.openSync(arquivoDeTrava, "wx");
  fs.writeFileSync(trava, `pid ${process.pid} · ${new Date().toISOString()}\n`);
} catch (erro) {
  if (erro.code === "EEXIST") {
    console.error(`\n⛔ Já existe um envio em andamento (trava: ${arquivoDeTrava}).`);
    console.error(`   Duas execuções ao mesmo tempo DUPLICAM unidades: o legado não tem índice único`);
    console.error(`   em (enterprise_id, block, lot). Espere a outra terminar. Nada foi enviado.`);
    console.error(`   Se a execução anterior morreu no meio, apague o arquivo de trava e rode de novo.`);
    process.exit(1);
  }
  throw erro;
}
const soltarATrava = () => {
  try {
    fs.closeSync(trava);
    fs.rmSync(arquivoDeTrava, { force: true });
  } catch {
    /* trava é conveniência: se não deu para soltar, o próximo operador apaga na mão */
  }
};
process.on("exit", soltarATrava);
process.on("SIGINT", () => process.exit(130));

console.log(`\nEnviando ${lote.length}...\n`);

// Token errado ou API fora do ar não viram 404 requisições recusadas contra produção: para na 3ª
// falha seguida. O que já subiu fica (criar não tem desfazer), e a retomada é segura porque a
// próxima execução relê o "já no C2X" e pula o que existe.
const LIMITE_DE_FALHAS_SEGUIDAS = 3;
let falhasSeguidas = 0;
let interrompido = null;

let ok = 0;
const falhas = [];
for (const u of lote) {
  const inicio = Date.now();
  try {
    const resp = await fetch(`${base}${CAMINHO}`, {
      body: JSON.stringify(montarPayload(u)),
      headers: {
        Accept: "application/json",
        access_token: token,
        // Sem "Bearer": o C2X quer o token CRU. Com "Bearer " ele devolve 401 enganoso.
        Authorization: token,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const corpo = await resp.text();
    const ms = Date.now() - inicio;
    if (resp.status === 200 || resp.status === 201) {
      ok += 1;
      falhasSeguidas = 0;
      console.log(`  ✅ ${nomeDaUnidade(u)} · Q${u.quadra} L${u.lote} · R$ ${u.preco} (${u.origemDoPreco}) · ${ms}ms`);
    } else {
      falhasSeguidas += 1;
      falhas.push({ resposta: corpo.slice(0, 200), status: resp.status, u });
      console.log(`  ❌ Q${u.quadra} L${u.lote} · HTTP ${resp.status} · ${corpo.slice(0, 120)}`);
    }
  } catch (erro) {
    falhasSeguidas += 1;
    falhas.push({ resposta: String(erro), status: null, u });
    console.log(`  ❌ Q${u.quadra} L${u.lote} · ${erro}`);
  }

  if (falhasSeguidas >= LIMITE_DE_FALHAS_SEGUIDAS) {
    interrompido = `${falhasSeguidas} falhas seguidas`;
    console.log(`\n⛔ PARANDO: ${interrompido}. Token errado ou API fora do ar não se resolve martelando`);
    console.log(`   o endpoint mais ${lote.length - ok - falhas.length} vezes. Resolva e rode de novo:`);
    console.log(`   o que já subiu é pulado na próxima execução.`);
    break;
  }
}

console.log(`\nEnviadas: ${ok} · Falhas: ${falhas.length}${interrompido ? ` · INTERROMPIDO (${interrompido})` : ""}`);

// Confere no banco: a API dizer "criei" não é prova de que criou — lição do incidente com os
// cadastros de cliente, em que 8 responderam sucesso e foram parar no ambiente de teste.
const depois = await unidadesNoC2x();
console.log(`\nConferência no banco do C2X: ${depois.length} unidades no Garden (antes: ${jaLa.length}).`);
if (depois.length - jaLa.length !== ok) {
  console.log(`⚠️  A API confirmou ${ok}, mas o banco ganhou ${depois.length - jaLa.length}. Conferir.`);
}
