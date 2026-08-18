// MASTERPLAN INTERNO DA LAGOA BONITA — a MESMA tela do Garden, com os dados da Lagoa Bonita.
//
// Uso (da raiz do repo):
//   node scripts/apolo/masterplan-interno-lagoa-bonita.mjs
//
// Entradas:
//   apps/hub/masterplans-internos/garden.html            (o molde — a tela que o Lucas aprovou)
//   apps/hub/public/masterplan/lagoa-bonita-lotes.json   (geometria, gerada pelo script irmão)
//   C2X (enterprise_unities 27/31/32/33)                 (situação, área, preço, comprador)
// Saída:
//   apps/hub/masterplans-internos/lagoa-bonita.html
//
// ⚠️ O DESENHO NÃO SE DISCUTE AQUI. A tela é a A-INTERNO, aprovada em 10/08 com nove prints de
// validação, e este gerador aplica as MESMAS transformações do irmão do Vale do Ouro
// (masterplan-interno-vale-do-ouro.mjs): quarto estado, percentuais, tom do vendido — o resultado
// tem o visual IDÊNTICO ao vale-do-ouro.html. Toda substituição é ancorada em texto literal e
// FALHA ALTO se a âncora não for encontrada.
//
// O QUE SÓ A LAGOA TEM: O BLOCO É TEXTO. No Vale do Ouro a quadra é número (1..17); aqui o bloco
// leva letra ("C01".."C19", "L02".."L11" — não existe L01, e o C19 existe; o espelho do C2X tem
// exatamente esses 29). A tela do molde assume quadra numérica em meia dúzia de lugares (`+tr.
// dataset.q`, `a.n-b.n`, `'Q'+padStart`), e cada um deles é trocado aqui por uma versão que
// funciona com texto — as trocas estão juntas na seção "bloco com letra". O vocabulário também
// muda: na Lagoa Bonita fala-se "bloco", não "quadra".
//
// DE ONDE VEM CADA DADO (medido no C2X em 17/08/2026):
//   • O espelho (enterprise 31, code LAB, "LAGOA BONITA - MASTERPLAN") tem as 495 unidades do
//     desenho — é o mapa físico, e a área sai dele quando a unidade não está em gleba nenhuma.
//   • A VERDADE COMERCIAL está nas GLEBAS DE VENDA: LBR (27, 240 unidades, carteira própria),
//     LBP (32, 125) e LBF (33, 47, a gleba do Fernando). Situação, preço e comprador saem delas.
//   • 83 unidades existem SÓ no espelho (nenhuma gleba as vende; no espelho estão com
//     `sale_blocked`). No mapa elas são BLOQUEADO: não estão à venda, e é exatamente para isso
//     que o quarto estado existe.
//   • A chave de cruzamento é (block, lot) — "C01"+"11" — a mesma nos quatro cadastros.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

// O molde é a tela do Garden (a A-INTERNO aprovada). O arquivo do Vale do Ouro NÃO serve de molde
// por ser GERADO: ancorar texto num arquivo que muda a cada rodada é âncora em areia.
const MOLDE = path.resolve("apps/hub/masterplans-internos/garden.html");
const GEOMETRIA = path.resolve("apps/hub/public/masterplan/lagoa-bonita-lotes.json");
// ⚠️ FORA DE `public/`, de propósito: esta tela carrega preço e nome de comprador, e tudo que fica
// em public/ é servido como estático, sem passar por gate nenhum. Quem entrega é
// /api/incorporador/masterplan, depois de conferir a sessão — e é lá que o recorte por escopo
// tira do arquivo os lotes que não são do portal (o LBF, por exemplo, vê 47 lotes com dado e os
// outros 448 em cinza, sem nada).
const SAIDA = path.resolve("apps/hub/masterplans-internos/lagoa-bonita.html");

// As glebas de venda e o espelho do desenho.
const GLEBAS = [27, 32, 33];
const ESPELHO = 31;
const NOME_GLEBA = { 27: "LBR", 31: "LAB (espelho)", 32: "LBP", 33: "LBF" };

// SITUAÇÃO: do C2X para os QUATRO estados da tela.
//   0 Disponível · 1 Reservado · 2 Vendido · 3 Bloqueado
// A mesma régua do Vale do Ouro: "em negociação" (3) conta como VENDIDO (regra do Lucas para o
// BI, 10/08 — para o estoque, proposta em negociação já tirou o lote da prateleira).
const SITUACAO = { 1: 0, 2: 1, 3: 2, 4: 2, 5: 3 };

// O QUARTO ESTADO, com as mesmas duas cores calibradas no Vale do Ouro (`cor` para o papel branco,
// `veu` claro para o mapa — escurecer não separa sobre planta de tom médio; clarear separa).
const BLOQUEADO = { cor: "#64748b", rotulo: "Bloqueado", veu: "#e2e8f0", veuAlfa: 0.62 };

// VENDIDO com o tom mais alto (Lucas, 11/08: "pode subir um pouco o tom do vermelho"): o mesmo
// vermelho do sistema com mais luz e saturação, para sobreviver aos 44% de transparência do véu.
const VENDIDO_COR = "#e14b3a";

function env() {
  const valores = {};
  for (const linha of fs.readFileSync("apps/hub/.env.local", "utf8").split("\n")) {
    const i = linha.indexOf("=");
    if (i < 1 || linha.startsWith("#")) continue;
    valores[linha.slice(0, i).trim()] = linha.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return valores;
}

/** Troca ancorada em texto literal. Some a âncora, o gerador para. */
function trocar(html, de, para, rotulo) {
  const partes = html.split(de);
  if (partes.length === 1) {
    console.error(`Âncora não encontrada no molde (${rotulo}): ${de.slice(0, 80)}`);
    process.exit(1);
  }
  return partes.join(para);
}

async function lerC2x() {
  const cfg = env();
  const conexao = await mysql.createConnection({
    database: cfg.GUARDIAN_DB_NAME,
    host: cfg.GUARDIAN_DB_HOST,
    password: cfg.GUARDIAN_DB_PASSWORD,
    port: Number(cfg.GUARDIAN_DB_PORT || 3306),
    user: cfg.GUARDIAN_DB_USER,
  });

  // O COMPRADOR sai da proposta VIVA do lote — `open = 1` e as mesmas etapas que o BI usa para
  // "proposta que vale". Cancelada, distratada e reprovada não contam.
  const [linhas] = await conexao.query(
    `SELECT eu.enterprise_id, eu.block, eu.lot, eu.name, eu.area, eu.price,
            eu.sale_status_id, eu.sale_blocked,
            (SELECT cli.name
               FROM acquisition_requests ar
               JOIN users cli ON cli.id = ar.client_id
              WHERE ar.enterprise_unity_id = eu.id AND ar.open = 1
                AND ar.acquisition_request_stage_id IN (1,3,4,5,6,9)
              ORDER BY ar.id DESC LIMIT 1) AS cliente
       FROM enterprise_unities eu
      WHERE eu.enterprise_id IN (${[...GLEBAS, ESPELHO].join(",")})`,
  );

  // PLANOS COMERCIAIS, das glebas de venda. ⚠️ AQUI O AGRUPAMENTO É POR PRAZO, não por nome como
  // no Vale do Ouro — e a diferença é o cadastro, não o gosto: a Lagoa não tem planos nomeados
  // ("Normal", "Curto"). Cada linha de `commercial_plans` é a condição de UMA proposta, com o
  // nome descrevendo a própria condição ("12% ENTRADA +120 VEZES", com variações de grafia e até
  // tab no fim) — agrupar por nome devolvia 45 "planos" quase iguais, o que afoga a tabela e o
  // simulador. O que sobrevive como política é o PRAZO: para cada um, a menor entrada praticada
  // e — regra que o Vale do Ouro já pagou para aprender — o MAIOR juros cadastrado, porque
  // publicar 0% num prazo que tem juros faria o simulador mostrar uma parcela que não existe.
  // `parcels > 1` porque a linha "À vista" a tela já desenha sozinha no bloco oficial.
  const [planos] = await conexao.query(
    `SELECT p.parcels,
            MIN(p.initial_input_value) initial_input_value,
            MAX(p.contractual_interest) contractual_interest
       FROM commercial_plans p
      WHERE p.enterprise_id IN (${GLEBAS.join(",")})
        AND p.name <> '' AND p.parcels > 1
      GROUP BY p.parcels
      ORDER BY p.parcels`,
  );

  await conexao.end();
  return { linhas, planos };
}

function principal(geometria, dadosC2x) {
  const { linhas, planos } = dadosC2x;

  // O bloco vai com a letra ("C01"), e o lote com o zero à esquerda ("07").
  const chave = (b, l) => `${String(b).trim().toUpperCase()}-${String(l).trim().padStart(2, "0")}`;
  const porChave = new Map();
  for (const linha of linhas) {
    const k = chave(linha.block, linha.lot);
    // A GLEBA DE VENDA GANHA DO ESPELHO: a verdade comercial mora nela. Entre glebas não há
    // duplicata hoje (medido: zero (block,lot) repetido entre 27/32/33) — se um dia houver, a
    // última lida fica e o aviso abaixo denuncia.
    const atual = porChave.get(k);
    if (!atual) {
      porChave.set(k, linha);
    } else if (Number(atual.enterprise_id) === ESPELHO) {
      porChave.set(k, linha);
    } else if (Number(linha.enterprise_id) !== ESPELHO) {
      console.log(`⚠️ (block,lot) em DUAS glebas de venda: ${k} (fica a enterprise ${linha.enterprise_id})`);
      porChave.set(k, linha);
    }
  }

  const semC2x = [];
  const porGleba = new Map();
  const dados = geometria.lotes.map((lote) => {
    const unidade = porChave.get(chave(lote.quadra, lote.lote));
    if (!unidade) semC2x.push(lote.id);
    else porGleba.set(unidade.enterprise_id, (porGleba.get(unidade.enterprise_id) ?? 0) + 1);

    const soEspelho = unidade ? Number(unidade.enterprise_id) === ESPELHO : false;

    // UNIDADE SÓ NO ESPELHO = FORA DE VENDA = BLOQUEADO. E dentro das glebas, `sale_blocked`
    // também bloqueia o que estaria "disponível" (27 lotes hoje: 1 no LBR, 26 no LBP): mostrar
    // esses lotes em verde ofereceria lote que ninguém pode vender — o erro que o Lucas já
    // corrigiu no Vale do Ouro. Lote com venda em cima (reservado/vendido) mantém a venda.
    let situacao = unidade ? (SITUACAO[unidade.sale_status_id] ?? 1) : 1;
    if (soEspelho) situacao = 3;
    else if (unidade && Number(unidade.sale_blocked) === 1 && situacao === 0) situacao = 3;

    // O preço de venda é o da GLEBA. O espelho tem preço de referência, mas lote fora de venda
    // não tem preço a oferecer: vai 0, que o molde lê como "não informado" e esconde.
    const preco = soEspelho ? 0 : Number(unidade?.price ?? 0);

    return [
      // ⚠️ O BLOCO VAI COMO TEXTO ("C01"), não como número — é a diferença estrutural para o
      // Vale do Ouro, e o leitor do recorte (masterplan-recorte.ts) entende os dois formatos.
      lote.quadra,
      lote.lote,
      situacao,
      Number(Number(unidade?.area ?? 0).toFixed(2)),
      preco > 1 ? Math.round(preco) : 0,
      // Bloqueado e disponível não têm comprador na tela; aqui só não mandamos o que não deve ir.
      situacao === 0 || situacao === 3 ? "" : (unidade?.cliente ?? ""),
      lote.pontos.map(([x, y]) => `${x},${y}`).join(" "),
    ];
  });

  const contagem = [0, 0, 0, 0];
  for (const linha of dados) contagem[linha[2]] += 1;

  let html = fs.readFileSync(MOLDE, "utf8");

  // 1) OS LOTES. O bloco vai do "const DADOS=[" até o "]];" que o fecha.
  const inicio = html.indexOf("const DADOS=[");
  const fim = html.indexOf("]];", inicio);
  if (inicio < 0 || fim < 0) {
    console.error("Não achei o bloco DADOS no molde.");
    process.exit(1);
  }
  const corpo = dados.map((linha) => JSON.stringify(linha)).join(",\n");
  html = `${html.slice(0, inicio)}const DADOS=[\n${corpo}];${html.slice(fim + 3)}`;

  // 2) O TAMANHO DA PRANCHA. Sem recorte: a planta da Lagoa cobre o viewBox inteiro do SVG do
  //    projetista (0 0 3840 2160), então os números saem direto do JSON de geometria.
  const [vbX, vbY, largura, altura] = geometria.viewBox.split(/\s+/).map(Number);
  if (vbX !== 0 || vbY !== 0 || !largura || !altura) {
    console.error(`viewBox inesperado na geometria: ${geometria.viewBox}`);
    process.exit(1);
  }
  html = trocar(html, "const VW=2396, VH=2160;", `const VW=${largura}, VH=${altura};`, "VW/VH");
  html = trocar(html, "aspect-ratio:2396/2160", `aspect-ratio:${largura}/${altura}`, "aspect-ratio");
  html = trocar(html, 'viewBox="0 0 2396 2160"', `viewBox="0 0 ${largura} ${altura}"`, "viewBox");
  html = trocar(html, "const RAZAO_PLANTA = 2396/2160;", `const RAZAO_PLANTA = ${largura}/${altura};`, "RAZAO_PLANTA");

  // 3) A PLANTA DE FUNDO. Caminho absoluto: a saída é servida por /api/... e relativo quebraria.
  html = trocar(
    html,
    '<img class="planta" src="garden-planta.jpg" alt="Planta aérea do loteamento Garden"',
    '<img class="planta" src="/masterplans/planta-lagoa-bonita.webp" alt="Planta do loteamento Lagoa Bonita"',
    "planta",
  );

  // 4) O CÓDIGO DO LOTE. Os polígonos são nomeados LABbbll: LAB + bloco com letra + lote
  //    (LABC0101). O `padStart` do molde é inócuo num bloco de três caracteres e sai junto.
  html = trocar(
    html,
    "id:'GDN'+String(r[0]).padStart(2,'0')+r[1],",
    "id:'LAB'+r[0]+r[1],",
    "prefixo do id",
  );
  html = trocar(html, '<div class="gid" id="fId">GDN0000</div>', '<div class="gid" id="fId">LAB0000</div>', "gid");

  // 5) OS TEXTOS. Nome do empreendimento, contagem e a fonte do plano.
  const total = dados.length;
  html = trocar(html, "<title>Garden · Masterplan · Apolo</title>", "<title>Lagoa Bonita · Masterplan · Apolo</title>", "title");
  html = trocar(html, 'title="Apolo · Masterplan do Garden"', 'title="Apolo · Masterplan da Lagoa Bonita"', "title do link");
  html = trocar(html, '<div class="marca"><b>Garden</b>', '<div class="marca"><b>Lagoa Bonita</b>', "marca");
  html = trocar(html, "Todo o Garden <small>· 406 lotes</small>", `Toda a Lagoa Bonita <small>· ${total} lotes</small>`, "escopo");
  html = trocar(html, '<button id="escVoltar" title="voltar para o empreendimento inteiro">Todo o Garden</button>', '<button id="escVoltar" title="voltar para o empreendimento inteiro">Toda a Lagoa Bonita</button>', "botão voltar");
  html = trocar(html, "'Todo o Garden'", "'Toda a Lagoa Bonita'", "rótulo do escopo");
  html = trocar(html, "Planilha de vendas Garden · <b id=\"rTot\">406</b> lotes", `Planilha de vendas Lagoa Bonita · <b id="rTot">${total}</b> lotes`, "rodapé da tabela");
  html = trocar(html, '<div class="sb" id="plSub">Garden Resort Residence</div>', '<div class="sb" id="plSub">Lagoa Bonita</div>', "subtítulo do plano");
  html = trocar(html, "'Garden Resort Residence — simulação'", "'Lagoa Bonita — simulação'", "cabeçalho da simulação");
  html = trocar(html, "'<p>Garden · '", "'<p>Lagoa Bonita · '", "rodapé da exportação");
  html = trocar(html, "a.download='Garden - lotes.xls'", "a.download='Lagoa Bonita - lotes.xls'", "nome do arquivo exportado");
  html = trocar(html, 'fonte “Plano comercial - Garden.xlsx”', "fonte: planos comerciais cadastrados no C2X", "fonte do plano");
  html = trocar(html, "/* null = todo o Garden", "/* null = toda a Lagoa Bonita", "comentário do escopo");

  // 6) O BLOCO COM LETRA. O molde assume quadra NUMÉRICA e a Lagoa tem "C01".."L11": cada lugar
  //    que soma, ordena com `a-b` ou converte com `+` quebraria em silêncio (NaN não grita).
  //    Estas trocas — só desta seção — são o que o Vale do Ouro não precisou ter. E o vocabulário
  //    muda junto: aqui é "bloco", não "quadra".
  html = trocar(
    html,
    "rot:'Quadra '+String(r[0]).padStart(2,'0')+' · Lote '+r[1]",
    "rot:'Bloco '+r[0]+' · Lote '+r[1]",
    "rótulo do lote",
  );
  html = trocar(
    html,
    "const listaQ=[...quadras.values()].sort((a,b)=>a.n-b.n);",
    "const listaQ=[...quadras.values()].sort((a,b)=>String(a.n).localeCompare(String(b.n)));",
    "ordem dos blocos",
  );
  // Com zero à esquerda fixo ("C01" < "C02" < ... < "L11"), a ordem lexicográfica é a certa.
  html = trocar(
    html,
    ".map(L=>L.q))].sort((a,b)=>a-b);",
    ".map(L=>L.q))].sort();",
    "ordem dos blocos no aviso",
  );
  html = trocar(
    html,
    "' — em '+qs.map(n=>'Q'+String(n).padStart(2,'0')).join(', ')",
    "' — em '+qs.join(', ')",
    "blocos no aviso do filtro",
  );
  html = trocar(html, "espalhados por '+qs.length+' quadras'", "espalhados por '+qs.length+' blocos'", "aviso espalhados");
  html = trocar(
    html,
    "return x<y?-dirQ : x>y?dirQ : a.Q.n-b.Q.n;",
    "return x<y?-dirQ : x>y?dirQ : String(a.Q.n).localeCompare(String(b.Q.n));",
    "desempate da tabela de blocos",
  );
  html = trocar(
    html,
    "title=\"Quadra '+String(d.Q.n).padStart(2,'0')+",
    "title=\"Bloco '+d.Q.n+",
    "tooltip da linha do bloco",
  );
  html = trocar(html, "'<td>Q'+String(d.Q.n).padStart(2,'0')+'</td>'", "'<td>'+d.Q.n+'</td>'", "célula do bloco");
  // `+tr.dataset.q` é o que faria "C01" virar NaN: o escopo passa a ser o texto mesmo.
  html = trocar(html, "const n=+tr.dataset.q;", "const n=tr.dataset.q;", "clique na linha do bloco");
  html = trocar(html, "acendeQuadra(+tr.dataset.q);", "acendeQuadra(tr.dataset.q);", "hover na linha do bloco");
  // O escopo aparece em DOIS textos com âncoras diferentes: no cabeçalho a aspa encosta no
  // "Quadra" (`:'Quadra '...`); no rodapé da tabela há um `' · '` antes. Uma troca para cada.
  html = trocar(html, "'Quadra '+String(escopo).padStart(2,'0')", "'Bloco '+escopo", "rótulo do escopo por bloco");
  html = trocar(html, "' · Quadra '+String(escopo).padStart(2,'0')", "' · Bloco '+escopo", "rodapé da tabela por bloco");
  html = trocar(
    html,
    "$('placaT').textContent='Quadra '+String(n).padStart(2,'0');",
    "$('placaT').textContent='Bloco '+n;",
    "placa do bloco",
  );
  html = trocar(
    html,
    "{k:'q',    t:'Quadra',    dir:false, get:L=>'Q'+String(L.q).padStart(2,'0'), ord:L=>L.q},",
    "{k:'q',    t:'Bloco',     dir:false, get:L=>L.q,                             ord:L=>L.q},",
    "coluna do bloco",
  );
  html = trocar(
    html,
    "return a.q-b.q || (a.lote<b.lote?-1:1);",
    "return String(a.q).localeCompare(String(b.q)) || (a.lote<b.lote?-1:1);",
    "desempate da tabela de lotes",
  );
  html = trocar(html, '<div class="rot">Quadras</div>', '<div class="rot">Blocos</div>', "rótulo da tabela de blocos");
  html = trocar(html, '<th data-k="q">Quadra<span class="st"></span></th>', '<th data-k="q">Bloco<span class="st"></span></th>', "cabeçalho do bloco");
  html = trocar(html, 'title="lotes da quadra"', 'title="lotes do bloco"', "tooltip do cabeçalho");
  html = trocar(html, '<b id="placaT">Quadra</b>', '<b id="placaT">Bloco</b>', "placa inicial");
  html = trocar(html, "Quadra 00 · Lote 00", "Bloco 00 · Lote 00", "placeholders da ficha");
  html = trocar(html, 'placeholder="quadra, lote, comprador ou valor"', 'placeholder="bloco, lote, comprador ou valor"', "placeholder da busca");
  html = trocar(html, "só desta quadra", "só deste bloco", "tooltip da linha");

  // 7) O QUARTO ESTADO — as mesmas trocas do gerador do Vale do Ouro, uma a uma.
  html = trocar(
    html,
    "const NOME=['Disponível','Reservado','Vendido'];",
    `const NOME=['Disponível','Reservado','Vendido','${BLOQUEADO.rotulo}'];`,
    "NOME",
  );
  html = trocar(
    html,
    "const COR =['#14804a','#b7791f','#c24135'];",
    `const COR =['#14804a','#b7791f','#c24135','${BLOQUEADO.cor}'];`,
    "COR",
  );
  html = trocar(html, "const TOT=[0,0,0];", "const TOT=[0,0,0,0];", "TOT");
  html = trocar(html, "c:[0,0,0],x0:1e9", "c:[0,0,0,0],x0:1e9", "contagem por quadra");
  html = trocar(html, "const porSit=[[],[],[]];", "const porSit=[[],[],[],[]];", "porSit");
  html = trocar(html, "const c=[0,0,0]; let val=0;", "const c=[0,0,0,0]; let val=0;", "contagem da quadra");
  html = trocar(html, "const pf=[$('f0'),$('f1'),$('f2')];", "const pf=[$('f0'),$('f1'),$('f2'),$('f3')];", "camadas");
  html = trocar(html, "const buf=['','',''];", "const buf=['','','',''];", "buffer de pintura");
  html = trocar(html, "for(let s=0;s<3;s++) pf[s]", "for(let s=0;s<4;s++) pf[s]", "laço da pintura");
  // O molde de hoje FILTRA situação sem lote (decisão de 12/08 no Garden: linha zerada só ocupa
  // espaço). O quarto estado entra no mesmo filtro — na Lagoa isso esconde o "Reservado · 0".
  html = trocar(
    html,
    "$('vsit').innerHTML=[0,1,2].filter(s=>porSit[s].length).map",
    "$('vsit').innerHTML=[0,1,2,3].filter(s=>porSit[s].length).map",
    "valor por situação",
  );

  // PERCENTUAL POR SITUAÇÃO, com DUAS bases (regra do Lucas, 11/08): estoque sem os bloqueados;
  // bloqueado contra o loteamento inteiro.
  html = trocar(
    html,
    "const g=porSit[s], cp=g.filter(L=>L.valor), soma=cp.reduce((a,L)=>a+L.valor,0);",
    "const g=porSit[s], cp=g.filter(L=>L.valor), soma=cp.reduce((a,L)=>a+L.valor,0);\n" +
      "    const base = s===3 ? arr.length : arr.length - porSit[3].length;\n" +
      "    const pct = base>0 ? Math.round(g.length/base*100) : 0;",
    "base do percentual",
  );
  html = trocar(
    html,
    "'<span class=\"nm\">'+NOME[s]+'<em>'+fI.format(g.length)+(g.length===1?' lote':' lotes')+'</em></span>'+",
    "'<span class=\"nm\">'+NOME[s]+' <b class=\"pc-sit\">'+pct+'%</b><em>'+fI.format(g.length)+(g.length===1?' lote':' lotes')+'</em></span>'+",
    "percentual no rótulo",
  );
  html = trocar(
    html,
    ".vsit .nm{font-size:12.5px;color:var(--txt2)}",
    ".vsit .nm{font-size:12.5px;color:var(--txt2)}\n.vsit .nm .pc-sit{font-weight:700;color:var(--txt)}",
    "estilo do percentual",
  );
  html = trocar(html, "$('togSit').innerHTML=[0,1,2].map", "$('togSit').innerHTML=[0,1,2,3].map", "filtro de situação");
  html = trocar(html, "$('placaS').innerHTML=[0,1,2].map", "$('placaS').innerHTML=[0,1,2,3].map", "placa da quadra");
  html = trocar(html, "F.sit=[true,true,true]; F.p=", "F.sit=[true,true,true,true]; F.p=", "limpar filtros");
  html = trocar(html, "if(sozinho){ F.sit=[true,true,true]; }", "if(sozinho){ F.sit=[true,true,true,true]; }", "chip sozinho");
  html = trocar(html, "else { F.sit=[false,false,false]; F.sit[s]=true; }", "else { F.sit=[false,false,false,false]; F.sit[s]=true; }", "chip isolado");
  html = trocar(html, "sit:[true,true,true]", "sit:[true,true,true,true]", "estado inicial do filtro");

  // A camada nova entra POR BAIXO das outras: bloqueado é fundo, não destaque.
  html = trocar(html, '<path id="f2"/><path id="f1"/><path id="f0"/>', '<path id="f3"/><path id="f2"/><path id="f1"/><path id="f0"/>', "camada f3");

  // ⚠️ SEM REGRA DE CSS o <path> novo é PRETO SÓLIDO por especificação — o defeito que o Lucas
  // viu no Vale do Ouro. Mais transparente que os demais: bloqueado não disputa atenção.
  html = trocar(
    html,
    "#f2{fill:var(--dang);fill-opacity:var(--a-fill);stroke:none}",
    "#f2{fill:var(--dang);fill-opacity:var(--a-fill);stroke:none}\n" +
      `#f3{fill:${BLOQUEADO.veu}; fill-opacity:${BLOQUEADO.veuAlfa};stroke:none}`,
    "estilo do f3",
  );
  html = trocar(
    html,
    "#f0,#f1,#f2{transition:fill-opacity .22s}",
    "#f0,#f1,#f2,#f3{transition:fill-opacity .22s}",
    "transição do f3",
  );

  // Legenda: o quarto chip, no mesmo formato dos outros três.
  html = trocar(
    html,
    '<button class="chip s2" data-sit="2" title="mostrar só os vendidos no mapa"><span class="pt"></span>Vendido</button>',
    '<button class="chip s2" data-sit="2" title="mostrar só os vendidos no mapa"><span class="pt"></span>Vendido</button>\n' +
      `    <button class="chip s3" data-sit="3" title="mostrar só os bloqueados no mapa"><span class="pt"></span>${BLOQUEADO.rotulo}</button>`,
    "chip da legenda",
  );

  // CSS: a cor do quarto estado na legenda e no selo da ficha.
  html = trocar(
    html,
    ".legenda .s0 .pt{background:var(--ok)} .legenda .s1 .pt{background:var(--warn)} .legenda .s2 .pt{background:var(--dang)}",
    ".legenda .s0 .pt{background:var(--ok)} .legenda .s1 .pt{background:var(--warn)} .legenda .s2 .pt{background:var(--dang)} .legenda .s3 .pt{background:var(--blq)}",
    "cor do chip",
  );
  html = trocar(
    html,
    ".selo.s2{background:color-mix(in srgb,var(--dang) 20%,var(--base));color:var(--dang-t);border-color:color-mix(in srgb,var(--dang) 40%,transparent)}",
    ".selo.s2{background:color-mix(in srgb,var(--dang) 20%,var(--base));color:var(--dang-t);border-color:color-mix(in srgb,var(--dang) 40%,transparent)}\n" +
      ".selo.s3{background:color-mix(in srgb,var(--blq) 20%,var(--base));color:var(--blq-t);border-color:color-mix(in srgb,var(--blq) 40%,transparent)}",
    "selo do bloqueado",
  );
  html = trocar(
    html,
    "  --dang:#c24135;    /* vendido    */",
    `  --dang:#c24135;    /* vendido    */\n  --blq:${BLOQUEADO.cor};      /* bloqueado  */`,
    "token de cor",
  );
  html = trocar(
    html,
    "  --dang-t:color-mix(in srgb,var(--dang) 58%,#f7f8fa);",
    "  --dang-t:color-mix(in srgb,var(--dang) 58%,#f7f8fa);\n  --blq-t:color-mix(in srgb,var(--blq) 58%,#f7f8fa);",
    "token de texto",
  );

  // ⚠️ O TOM DO VENDIDO POR ÚLTIMO: a linha original é âncora das trocas acima.
  html = trocar(html, "--dang:#c24135;", `--dang:${VENDIDO_COR};`, "tom do vendido");
  html = trocar(html, "'#c24135'", `'${VENDIDO_COR}'`, "tom do vendido (JS)");

  // COMPRADOR: bloqueado não tem, igual ao disponível.
  html = trocar(html, "if(L.sit===0){ bc.style.display='none'; }", "if(L.sit===0||L.sit===3){ bc.style.display='none'; }", "bloco do comprador");
  html = trocar(html, "cli: r[2]===0 ? '' : r[5],", "cli: (r[2]===0||r[2]===3) ? '' : r[5],", "comprador no dado");
  html = trocar(html, "L.sit===0?'<span class=\"mut\">—</span>'", "(L.sit===0||L.sit===3)?'<span class=\"mut\">—</span>'", "coluna comprador");
  html = trocar(html, "if(loteSim&&loteSim.sit!==0)", "if(loteSim&&loteSim.sit!==0&&loteSim.sit!==3)", "resumo da simulação");

  // 8) A TABELA COMERCIAL: um plano por PRAZO (ver o comentário da query), no formato que o molde
  //    de hoje espera — cada plano tem `id` (o seletor do simulador acha por ele), e `correcao`
  //    aponta para a cláusula de correção monetária. Desconto e anuais não existem no C2X da
  //    Lagoa: entram zerados, e o simulador segue com entrada, prazo e juros.
  const planosJs = planos
    .map((p) => {
      const entrada = Number(p.initial_input_value ?? 0) / 100;
      return `  {id:'p${p.parcels}', nome:'${p.parcels} vezes', desc:0.00, ent:${entrada.toFixed(4)}, anQtd:0, anVal:0, prazo:${p.parcels}, correcao:'contrato'}`;
    })
    .join(",\n");

  const iPlanos = html.indexOf("const PLANOS=[");
  const fPlanos = html.indexOf("];", iPlanos);
  if (iPlanos < 0 || fPlanos < 0) {
    console.error("Não achei o bloco PLANOS no molde.");
    process.exit(1);
  }
  html = `${html.slice(0, iPlanos)}const PLANOS=[\n${planosJs}\n]${html.slice(fPlanos + 1)}`;

  // A TAXA É UMA SÓ PARA A TELA INTEIRA (`POLITICA.jurosAM`), e vale a regra que o Vale do Ouro
  // pagou para aprender: entra o MAIOR juros cadastrado. Na Lagoa os prazos até 48x estão com 0%
  // no C2X e os de 60/72/120x com 0,8% a.m. — com a taxa única, a parcela dos prazos curtos sai
  // um pouco acima da cadastrada, e é o erro tolerável: o contrário (0% no prazo de 120) faria o
  // simulador prometer uma parcela que não existe, e parcela é o que o cliente escuta primeiro.
  const maiorJuros = Math.max(0, ...planos.map((p) => Number(p.contractual_interest ?? 0) / 100));
  html = trocar(html, "  jurosAM:0,", `  jurosAM:${maiorJuros.toFixed(6)},`, "juros do simulador");

  // O plano default do simulador é o prazo mais longo (o molde crava o id do Garden).
  const maisLongo = planos[planos.length - 1];
  html = trocar(
    html,
    "/* modo escolher */ planoId:'normal', prazo:84, entrada:0, anQtd:0, anVal:20000,",
    `/* modo escolher */ planoId:'p${maisLongo.parcels}', prazo:${maisLongo.parcels}, entrada:0, anQtd:0, anVal:20000,`,
    "plano default do simulador",
  );

  // 9) O FLUXO DE PROPOSTA — entrou no molde DEPOIS da geração do Vale do Ouro (o arquivo de lá
  //    não o tem), com a identidade do Garden cravada: logos, "Garden Resort Residence" e a
  //    assinatura "Cecílio Rocha e M Mendes". Nada disso pode aparecer numa proposta da Lagoa —
  //    e o arquivo é compartilhado por TRÊS glebas de donos diferentes, então nenhum incorporador
  //    é cravado aqui: a identidade vai neutra, do loteamento.
  // ⚠️ O MOLDE É CRLF: âncora multilinha com \n não casa. Cada linha é trocada sozinha — a
  // primeira vira `''+` e a segunda `'';`, e a soma continua sendo a string vazia.
  html = trocar(
    html,
    "const PV_LOGOS='<img src=\"/garden/logo-cecilio-rocha.png\" alt=\"Cecílio Rocha\">'+",
    "const PV_LOGOS=''+",
    "logos da proposta (1/2)",
  );
  html = trocar(
    html,
    "'<img src=\"/garden/logo-mmendes.png\" alt=\"M Mendes\">';",
    "'';",
    "logos da proposta (2/2)",
  );
  html = trocar(
    html,
    "'<div class=\"pv-topo\"><img src=\"/garden/logo-garden.png\" alt=\"Garden Resort Residence\">'+",
    "'<div class=\"pv-topo\"><b style=\"font-size:17px;letter-spacing:.3px\">Lagoa Bonita</b>'+",
    "marca da proposta",
  );
  html = trocar(
    html,
    "'<dt>Empreendimento</dt><dd>Garden Resort Residence</dd>'+",
    "'<dt>Empreendimento</dt><dd>Lagoa Bonita</dd>'+",
    "empreendimento da proposta",
  );
  html = trocar(html, "'<dt>Quadra e lote</dt>", "'<dt>Bloco e lote</dt>", "bloco e lote na proposta");
  html = trocar(
    html,
    "'<b>Cecílio Rocha e M Mendes</b>'+",
    "'<b>Lagoa Bonita</b>'+",
    "assinatura da incorporadora (nome)",
  );
  html = trocar(
    html,
    "'<span>Garden Resort Residence</span>'+",
    "'<span>Loteamento Lagoa Bonita</span>'+",
    "assinatura da incorporadora (linha)",
  );
  html = trocar(
    html,
    "'<div class=\"pv-pe\"><span>Garden Resort Residence · Cecílio Rocha e M Mendes<br>'+",
    "'<div class=\"pv-pe\"><span>Loteamento Lagoa Bonita<br>'+",
    "rodapé da proposta",
  );

  // CORREÇÃO MONETÁRIA: o C2X da Lagoa não diz a cláusula, e as do molde (IPCA / IPCA + 6%) são
  // do Garden — afirmar qualquer uma delas aqui seria inventar contrato. Entra uma terceira
  // entrada no mapa, "conforme contrato", e ela vira o default (a regra da casa já é essa: a
  // correção mora no instrumento contratual, não no sistema).
  html = trocar(
    html,
    "acrescida de juros de 6% ao ano'}",
    "acrescida de juros de 6% ao ano'},\n  contrato: {curto:'conforme contrato', longo:'reajuste na forma prevista no instrumento contratual'}",
    "correção conforme contrato",
  );
  html = trocar(
    html,
    "const correcaoDe=p=>CORRECAO[p&&p.correcao]||CORRECAO.ipca6;",
    "const correcaoDe=p=>CORRECAO[p&&p.correcao]||CORRECAO.contrato;",
    "correção default",
  );

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, html, "utf8");

  console.log(`lotes:      ${total}`);
  console.log(
    `situação:   ${contagem[0]} disponíveis · ${contagem[1]} reservados · ${contagem[2]} vendidos · ${contagem[3]} bloqueados`,
  );
  console.log(
    `origem:     ${[...porGleba.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, n]) => `${NOME_GLEBA[id] ?? id}:${n}`)
      .join(" · ")}`,
  );
  console.log(`compradores: ${dados.filter((l) => l[5]).length}`);
  console.log(`planos:     ${planos.map((p) => `${p.parcels}x`).join(", ")} (juros máx. ${(maiorJuros * 100).toFixed(2)}% a.m.)`);
  if (semC2x.length) console.log(`⚠️ sem unidade no C2X: ${semC2x.join(", ")}`);
  console.log(`gravado:    ${SAIDA} (${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB)`);
}

const geometria = JSON.parse(fs.readFileSync(GEOMETRIA, "utf8"));
principal(geometria, await lerC2x());
