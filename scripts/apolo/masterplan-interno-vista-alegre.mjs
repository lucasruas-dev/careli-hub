// MASTERPLAN INTERNO DO VISTA ALEGRE — a MESMA tela do Garden, com os dados do Vista Alegre.
//
// Uso (da raiz do repo):
//   node scripts/apolo/masterplan-interno-vista-alegre.mjs
//
// Entradas:
//   apps/hub/masterplans-internos/garden.html            (o molde — a tela que o Lucas aprovou)
//   apps/hub/public/masterplan/vista-alegre-lotes.json   (geometria, gerada pelo script irmão)
//   C2X (enterprise_unities 29)                          (situação, área, preço, comprador)
// Saída:
//   apps/hub/masterplans-internos/vista-alegre.html
//
// ⚠️ O DESENHO NÃO SE DISCUTE AQUI. A tela é a A-INTERNO, aprovada em 10/08 com nove prints de
// validação, e este gerador aplica as MESMAS transformações do irmão da Lagoa Bonita
// (masterplan-interno-lagoa-bonita.mjs, o molde mais novo): quarto estado, percentuais, tom do
// vendido, identidade neutra e correção "conforme contrato". Toda substituição é ancorada em
// texto literal e FALHA ALTO se a âncora não for encontrada.
//
// O QUE O VISTA ALEGRE TEM DE PRÓPRIO:
//   • EMPREENDIMENTO ÚNICO. Nada de glebas nem espelho: o enterprise 29 (code VAL) é a fonte
//     inteira — situação, área, preço e comprador saem dele. O recorte do portal deixa TUDO
//     dentro, e `recortarMasterplan` devolve o arquivo intacto quando o escopo cobre tudo.
//   • A QUADRA É UMA LETRA ("A".."I"). Continua sendo "quadra" no vocabulário (diferente da
//     Lagoa, onde o cadastro fala "bloco"), mas é TEXTO: cada lugar do molde que soma, ordena
//     com `a-b` ou converte com `+` quebraria em silêncio (NaN não grita). As trocas técnicas
//     são as da Lagoa; as de vocabulário, não.
//   • O LOTE ORDENA COMO NÚMERO. Aqui é inócuo (sempre 2 dígitos), mas é a régua da família:
//     no irmão Recanto do Pará o lote passa de 99 e a ordem de texto poria "100" antes de "67".
//
// DE ONDE VEM CADA DADO (medido no C2X em 17/08/2026):
//   • enterprise 29, code VAL, "VISTA ALEGRE": 126 unidades, `block` "A".."I", `lot` "01".."24".
//   • Situação: 87 com sale_status_id 1 (disponível) e 39 com 4 (vendido); 28 das disponíveis
//     têm `sale_blocked` = 1 e viram BLOQUEADO — o print do dono: 39 vendidas, 59 disponíveis,
//     28 bloqueadas.
//   • A chave de cruzamento é (block, lot) — "A"+"01" — o mesmo par do SVG (VALA01).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

// O molde é a tela do Garden (a A-INTERNO aprovada). Os arquivos gerados (vale-do-ouro, lagoa,
// este) NÃO servem de molde: ancorar texto num arquivo que muda a cada rodada é âncora em areia.
const MOLDE = path.resolve("apps/hub/masterplans-internos/garden.html");
const GEOMETRIA = path.resolve("apps/hub/public/masterplan/vista-alegre-lotes.json");
// ⚠️ FORA DE `public/`, de propósito: esta tela carrega preço e nome de comprador, e tudo que fica
// em public/ é servido como estático, sem passar por gate nenhum. Quem entrega é
// /api/incorporador/masterplan, depois de conferir a sessão.
const SAIDA = path.resolve("apps/hub/masterplans-internos/vista-alegre.html");

// O empreendimento inteiro mora num cadastro só.
const EMPRESA = 29;

// SITUAÇÃO: do C2X para os QUATRO estados da tela.
//   0 Disponível · 1 Reservado · 2 Vendido · 3 Bloqueado
// A mesma régua do Vale do Ouro e da Lagoa: "em negociação" (3) conta como VENDIDO (regra do
// Lucas para o BI, 10/08 — proposta em negociação já tirou o lote da prateleira).
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
    `SELECT eu.block, eu.lot, eu.name, eu.area, eu.price,
            eu.sale_status_id, eu.sale_blocked,
            (SELECT cli.name
               FROM acquisition_requests ar
               JOIN users cli ON cli.id = ar.client_id
              WHERE ar.enterprise_unity_id = eu.id AND ar.open = 1
                AND ar.acquisition_request_stage_id IN (1,3,4,5,6,9)
              ORDER BY ar.id DESC LIMIT 1) AS cliente
       FROM enterprise_unities eu
      WHERE eu.enterprise_id = ?`,
    [EMPRESA],
  );

  // PLANOS COMERCIAIS, agrupados por PRAZO — a decisão tomada na Lagoa, que vale para a família:
  // cada linha de `commercial_plans` é a condição de UMA proposta, e o que sobrevive como
  // política é o prazo, com a menor entrada praticada e o MAIOR juros cadastrado (publicar 0%
  // num prazo que tem juros faria o simulador mostrar uma parcela que não existe).
  // `parcels > 1` porque a linha "À vista" a tela já desenha sozinha no bloco oficial.
  const [planos] = await conexao.query(
    `SELECT p.parcels,
            MIN(p.initial_input_value) initial_input_value,
            MAX(p.contractual_interest) contractual_interest
       FROM commercial_plans p
      WHERE p.enterprise_id = ?
        AND p.name <> '' AND p.parcels > 1
      GROUP BY p.parcels
      ORDER BY p.parcels`,
    [EMPRESA],
  );

  await conexao.end();
  return { linhas, planos };
}

function principal(geometria, dadosC2x) {
  const { linhas, planos } = dadosC2x;

  // A quadra vai com a letra ("A"), e o lote com o zero à esquerda ("07").
  const chave = (b, l) => `${String(b).trim().toUpperCase()}-${String(l).trim().padStart(2, "0")}`;
  const porChave = new Map();
  for (const linha of linhas) {
    const k = chave(linha.block, linha.lot);
    if (porChave.has(k)) {
      console.error(`(block,lot) duplicado no C2X: ${k}. Um lote, um cadastro.`);
      process.exit(1);
    }
    porChave.set(k, linha);
  }

  const semC2x = [];
  const dados = geometria.lotes.map((lote) => {
    const unidade = porChave.get(chave(lote.quadra, lote.lote));
    if (!unidade) semC2x.push(lote.id);

    // `sale_blocked` bloqueia o que estaria "disponível": mostrar esses lotes em verde
    // ofereceria lote que ninguém pode vender — o erro que o Lucas já corrigiu no Vale do Ouro.
    // Lote com venda em cima (reservado/vendido) mantém a venda.
    let situacao = unidade ? (SITUACAO[unidade.sale_status_id] ?? 1) : 1;
    if (unidade && Number(unidade.sale_blocked) === 1 && situacao === 0) situacao = 3;

    return [
      // ⚠️ A QUADRA VAI COMO TEXTO ("A"), não como número — o leitor do recorte
      // (masterplan-recorte.ts) entende os dois formatos.
      lote.quadra,
      lote.lote,
      situacao,
      Number(Number(unidade?.area ?? 0).toFixed(2)),
      Number(unidade?.price ?? 0) > 1 ? Math.round(Number(unidade.price)) : 0,
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

  // 2) O TAMANHO DA PRANCHA. Sem recorte: a planta cobre o viewBox inteiro do SVG do projetista
  //    (0 0 3840 2160), então os números saem direto do JSON de geometria.
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
    '<img class="planta" src="/masterplans/planta-vista-alegre.webp" alt="Planta do loteamento Vista Alegre"',
    "planta",
  );

  // 4) O CÓDIGO DO LOTE. Os polígonos são nomeados VALqll: VAL + quadra com letra + lote
  //    (VALA01). O `padStart` do molde é inócuo numa quadra de um caractere e sai junto.
  html = trocar(
    html,
    "id:'GDN'+String(r[0]).padStart(2,'0')+r[1],",
    "id:'VAL'+r[0]+r[1],",
    "prefixo do id",
  );
  html = trocar(html, '<div class="gid" id="fId">GDN0000</div>', '<div class="gid" id="fId">VAL0000</div>', "gid");

  // 5) OS TEXTOS. Nome do empreendimento, contagem e a fonte do plano.
  const total = dados.length;
  html = trocar(html, "<title>Garden · Masterplan · Apolo</title>", "<title>Vista Alegre · Masterplan · Apolo</title>", "title");
  html = trocar(html, 'title="Apolo · Masterplan do Garden"', 'title="Apolo · Masterplan do Vista Alegre"', "title do link");
  html = trocar(html, '<div class="marca"><b>Garden</b>', '<div class="marca"><b>Vista Alegre</b>', "marca");
  html = trocar(html, "Todo o Garden <small>· 406 lotes</small>", `Todo o Vista Alegre <small>· ${total} lotes</small>`, "escopo");
  html = trocar(html, '<button id="escVoltar" title="voltar para o empreendimento inteiro">Todo o Garden</button>', '<button id="escVoltar" title="voltar para o empreendimento inteiro">Todo o Vista Alegre</button>', "botão voltar");
  html = trocar(html, "'Todo o Garden'", "'Todo o Vista Alegre'", "rótulo do escopo");
  html = trocar(html, "Planilha de vendas Garden · <b id=\"rTot\">406</b> lotes", `Planilha de vendas Vista Alegre · <b id="rTot">${total}</b> lotes`, "rodapé da tabela");
  html = trocar(html, '<div class="sb" id="plSub">Garden Resort Residence</div>', '<div class="sb" id="plSub">Vista Alegre</div>', "subtítulo do plano");
  html = trocar(html, "'Garden Resort Residence — simulação'", "'Vista Alegre — simulação'", "cabeçalho da simulação");
  html = trocar(html, "'<p>Garden · '", "'<p>Vista Alegre · '", "rodapé da exportação");
  html = trocar(html, "a.download='Garden - lotes.xls'", "a.download='Vista Alegre - lotes.xls'", "nome do arquivo exportado");
  html = trocar(html, 'fonte “Plano comercial - Garden.xlsx”', "fonte: planos comerciais cadastrados no C2X", "fonte do plano");
  html = trocar(html, "/* null = todo o Garden", "/* null = todo o Vista Alegre", "comentário do escopo");

  // 6) A QUADRA COM LETRA. O molde assume quadra NUMÉRICA e aqui ela é "A".."I": cada lugar que
  //    soma, ordena com `a-b` ou converte com `+` quebraria em silêncio (NaN não grita). São as
  //    trocas TÉCNICAS da Lagoa Bonita — as de vocabulário não entram, porque aqui continua
  //    sendo "quadra".
  html = trocar(
    html,
    "rot:'Quadra '+String(r[0]).padStart(2,'0')+' · Lote '+r[1]",
    "rot:'Quadra '+r[0]+' · Lote '+r[1]",
    "rótulo do lote",
  );
  html = trocar(
    html,
    "const listaQ=[...quadras.values()].sort((a,b)=>a.n-b.n);",
    "const listaQ=[...quadras.values()].sort((a,b)=>String(a.n).localeCompare(String(b.n)));",
    "ordem das quadras",
  );
  // Com uma letra por quadra ("A" < "B" < ... < "I"), a ordem lexicográfica é a certa.
  html = trocar(
    html,
    ".map(L=>L.q))].sort((a,b)=>a-b);",
    ".map(L=>L.q))].sort();",
    "ordem das quadras no aviso",
  );
  html = trocar(
    html,
    "' — em '+qs.map(n=>'Q'+String(n).padStart(2,'0')).join(', ')",
    "' — em '+qs.join(', ')",
    "quadras no aviso do filtro",
  );
  html = trocar(
    html,
    "return x<y?-dirQ : x>y?dirQ : a.Q.n-b.Q.n;",
    "return x<y?-dirQ : x>y?dirQ : String(a.Q.n).localeCompare(String(b.Q.n));",
    "desempate da tabela de quadras",
  );
  html = trocar(
    html,
    "title=\"Quadra '+String(d.Q.n).padStart(2,'0')+",
    "title=\"Quadra '+d.Q.n+",
    "tooltip da linha da quadra",
  );
  html = trocar(html, "'<td>Q'+String(d.Q.n).padStart(2,'0')+'</td>'", "'<td>'+d.Q.n+'</td>'", "célula da quadra");
  // `+tr.dataset.q` é o que faria "A" virar NaN: o escopo passa a ser o texto mesmo.
  html = trocar(html, "const n=+tr.dataset.q;", "const n=tr.dataset.q;", "clique na linha da quadra");
  html = trocar(html, "acendeQuadra(+tr.dataset.q);", "acendeQuadra(tr.dataset.q);", "hover na linha da quadra");
  // O escopo aparece em DOIS textos com âncoras diferentes: no cabeçalho a aspa encosta no
  // "Quadra" (`:'Quadra '...`); no rodapé da tabela há um `' · '` antes. Uma troca para cada.
  html = trocar(html, "'Quadra '+String(escopo).padStart(2,'0')", "'Quadra '+escopo", "rótulo do escopo por quadra");
  html = trocar(html, "' · Quadra '+String(escopo).padStart(2,'0')", "' · Quadra '+escopo", "rodapé da tabela por quadra");
  html = trocar(
    html,
    "$('placaT').textContent='Quadra '+String(n).padStart(2,'0');",
    "$('placaT').textContent='Quadra '+n;",
    "placa da quadra",
  );
  html = trocar(
    html,
    "{k:'q',    t:'Quadra',    dir:false, get:L=>'Q'+String(L.q).padStart(2,'0'), ord:L=>L.q},",
    "{k:'q',    t:'Quadra',    dir:false, get:L=>L.q,                             ord:L=>L.q},",
    "coluna da quadra",
  );
  // ⚠️ O LOTE ORDENA COMO NÚMERO — na coluna e no desempate. Aqui é inócuo (2 dígitos sempre);
  // no Recanto do Pará o lote passa de 99 e a ordem de texto poria "100" antes de "67".
  html = trocar(html, "ord:L=>L.lote},", "ord:L=>+L.lote},", "ordem da coluna de lote");
  html = trocar(
    html,
    "return a.q-b.q || (a.lote<b.lote?-1:1);",
    "return String(a.q).localeCompare(String(b.q)) || ((+a.lote)-(+b.lote));",
    "desempate da tabela de lotes",
  );

  // 7) O QUARTO ESTADO — as mesmas trocas do gerador da Lagoa, uma a uma.
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
  // O molde FILTRA situação sem lote (decisão de 12/08 no Garden: linha zerada só ocupa espaço).
  // O quarto estado entra no mesmo filtro — aqui isso esconde o "Reservado · 0".
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
  //    espera — cada plano tem `id` (o seletor do simulador acha por ele), e `correcao` aponta
  //    para a cláusula de correção monetária. Desconto e anuais não existem no C2X daqui: entram
  //    zerados, e o simulador segue com entrada, prazo e juros.
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
  // pagou para aprender: entra o MAIOR juros cadastrado. Aqui os prazos curtos estão com 0% no
  // C2X e o de 120x com juros — com a taxa única, a parcela dos prazos curtos sai um pouco acima
  // da cadastrada, e é o erro tolerável: o contrário (0% no prazo de 120) faria o simulador
  // prometer uma parcela que não existe, e parcela é o que o cliente escuta primeiro.
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

  // 9) O FLUXO DE PROPOSTA — o molde crava a identidade do Garden: logos, "Garden Resort
  //    Residence" e a assinatura "Cecílio Rocha e M Mendes". Nada disso pode aparecer numa
  //    proposta do Vista Alegre: a identidade vai neutra, do loteamento — a mesma decisão da
  //    Lagoa Bonita.
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
    "'<div class=\"pv-topo\"><b style=\"font-size:17px;letter-spacing:.3px\">Vista Alegre</b>'+",
    "marca da proposta",
  );
  html = trocar(
    html,
    "'<dt>Empreendimento</dt><dd>Garden Resort Residence</dd>'+",
    "'<dt>Empreendimento</dt><dd>Vista Alegre</dd>'+",
    "empreendimento da proposta",
  );
  html = trocar(
    html,
    "'<b>Cecílio Rocha e M Mendes</b>'+",
    "'<b>Vista Alegre</b>'+",
    "assinatura da incorporadora (nome)",
  );
  html = trocar(
    html,
    "'<span>Garden Resort Residence</span>'+",
    "'<span>Loteamento Vista Alegre</span>'+",
    "assinatura da incorporadora (linha)",
  );
  html = trocar(
    html,
    "'<div class=\"pv-pe\"><span>Garden Resort Residence · Cecílio Rocha e M Mendes<br>'+",
    "'<div class=\"pv-pe\"><span>Loteamento Vista Alegre<br>'+",
    "rodapé da proposta",
  );

  // CORREÇÃO MONETÁRIA: o C2X daqui não diz a cláusula, e as do molde (IPCA / IPCA + 6%) são do
  // Garden — afirmar qualquer uma delas seria inventar contrato. Entra a terceira entrada no
  // mapa, "conforme contrato", e ela vira o default (a regra da casa: a correção mora no
  // instrumento contratual, não no sistema).
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
  console.log(`compradores: ${dados.filter((l) => l[5]).length}`);
  console.log(`planos:     ${planos.map((p) => `${p.parcels}x`).join(", ")} (juros máx. ${(maiorJuros * 100).toFixed(2)}% a.m.)`);
  if (semC2x.length) console.log(`⚠️ sem unidade no C2X: ${semC2x.join(", ")}`);
  const sobraC2x = [...porChave.keys()].filter(
    (k) => !geometria.lotes.some((l) => chave(l.quadra, l.lote) === k),
  );
  if (sobraC2x.length) console.log(`⚠️ no C2X sem desenho no SVG: ${sobraC2x.join(", ")}`);
  console.log(`gravado:    ${SAIDA} (${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB)`);
}

const geometria = JSON.parse(fs.readFileSync(GEOMETRIA, "utf8"));
principal(geometria, await lerC2x());
