// MASTERPLAN INTERNO DO VALE DO OURO — a MESMA tela do Garden, com os dados do Vale do Ouro.
//
// Uso (da raiz do repo):
//   node scripts/apolo/masterplan-interno-vale-do-ouro.mjs
//
// Entradas:
//   apps/hub/public/garden/interno-3634d57f.html      (o molde — a tela que o Lucas aprovou)
//   apps/hub/public/masterplan/vale-do-ouro-lotes.json (geometria, gerada pelo script irmão)
//   C2X (enterprise_unities 36 + 37)                   (situação, área, preço, comprador)
// Saída:
//   apps/hub/public/masterplans/vale-do-ouro-interno.html
//
// ⚠️ O DESENHO NÃO SE DISCUTE AQUI. A tela é a A-INTERNO, aprovada em 10/08 com nove prints de
// validação. Este script NÃO redesenha, NÃO reorganiza e NÃO melhora nada: ele troca o conteúdo
// (os lotes, a planta de fundo, o nome do empreendimento e a tabela comercial) e deixa CSS, markup
// e comportamento exatamente como estão. Toda substituição abaixo é ancorada em texto literal e
// FALHA ALTO se a âncora não for encontrada — molde que mudou de forma tem que parar o gerador,
// não gerar uma tela meio trocada.
//
// POR QUE UM GERADOR E NÃO UM ARQUIVO EDITADO NA MÃO: o Garden foi montado uma vez e envelheceu
// (o HTML publicado diz 207 vendidos; o C2X diz zero). Com o gerador, atualizar é rodar de novo.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

// O molde é a tela do Garden, que o Lucas aprovou com nove prints de validação.
//
// 🚫 O GARDEN É SÓ MOLDE. ESTE SCRIPT NUNCA REGERA A TELA DELE, e não é descuido: regra do Lucas
// (10/08) — "o garden, vc não busca no c2x, somente o que eu te passei". Os lotes, os preços, as
// situações e os compradores do Garden vêm da planilha que ele entregou, e é ela que vale ali. O
// cadastro do Garden no C2X é de pré-lançamento (87 disponíveis, 317 bloqueados, zero vendido) e
// não descreve a realidade comercial daquele empreendimento: "atualizar do C2X" apagaria os 207
// vendidos e os 111 reservados que o dono conhece, trocando dado bom por dado incompleto.
//
// O Vale do Ouro é o contrário: está vendendo, e o C2X é a fonte viva dele. Por isso só ele é
// gerado aqui.
const MOLDE = path.resolve("apps/hub/masterplans-internos/garden.html");
const GEOMETRIA = path.resolve("apps/hub/public/masterplan/vale-do-ouro-lotes.json");
// ⚠️ FORA DE `public/`, de propósito: esta tela carrega preço e nome de comprador, e tudo que fica
// em public/ é servido como estático, sem passar por gate nenhum. Quem entrega é
// /api/incorporador/masterplan, depois de conferir a sessão.
const SAIDA = path.resolve("apps/hub/masterplans-internos/vale-do-ouro.html");

// Enterprises do Vale do Ouro DEPOIS da divisão: VOL (carteira do Lino) e VOC (carteira do
// Cecílio). No chão é um loteamento só, e o Lucas pediu o mapa inteiro: "pode trazer ele todo
// VOL + VOC". O 35 (VLO) é o registro histórico e fica de fora, senão cada lote apareceria duas
// vezes.
const ENTERPRISES = [36, 37];

// SITUAÇÃO: do C2X para os QUATRO estados da tela.
//   0 Disponível · 1 Reservado · 2 Vendido · 3 Bloqueado
//
// "Em negociação" (3) conta como VENDIDO pela regra que o Lucas fixou para o BI em 10/08: para o
// estoque, proposta em negociação já tirou o lote da prateleira.
//
// ⚠️ BLOQUEADO TEM COR PRÓPRIA, e isso foi decisão do Lucas depois de eu errar. Na primeira versão
// eu joguei os bloqueados dentro de "Reservado", e o resultado era um mapa dizendo que 110 lotes
// estavam reservados quando só DOIS estavam: os outros 108 são lotes que não estão à venda
// (permuta, institucional, em avaliação), todos com preço R$ 1,00 e `sale_blocked` no C2X, nenhum
// deles com proposta. Reservado, para o corretor, é "alguém segurou e pode virar venda"; bloqueado
// é o contrário. Misturar os dois oferecia 108 lotes que ninguém pode vender.
const SITUACAO = { 1: 0, 2: 1, 3: 2, 4: 2, 5: 3 };

// O QUARTO ESTADO. Ele tem DUAS cores, e a separação não é capricho: elas vivem sobre fundos
// opostos e uma cor só não serve para as duas.
//
//   • `cor`    — o marcador: chip da legenda, selo da ficha, pílula da tabela, placa da quadra.
//                Fica sobre PAPEL BRANCO, então precisa ser escura para existir.
//   • `veu`    — o preenchimento do lote no mapa. Fica sobre a planta, que dentro do lote é um
//                verde-oliva médio (#a1aa25, medido). Aqui escurecer não separa: o fundo já é
//                médio e os outros três estados também são tons médios. Clarear separa.
//
// Os números vêm de medição, não de gosto: compondo cada candidato sobre o fundo real e medindo a
// distância até o fundo e até os outros três estados, o véu claro a 62% fica a 160 de distância do
// fundo, contra 96 do cinza escuro que estava antes — que foi o "não dá para ver" do Lucas.
const BLOQUEADO = { cor: "#64748b", rotulo: "Bloqueado", veu: "#e2e8f0", veuAlfa: 0.62 };

// VENDIDO com o tom mais alto (Lucas, 11/08: "pode subir um pouco o tom do vermelho"). O molde usa
// #c24135, que é o vermelho do sistema e foi calibrado sobre a foto ESCURA do Garden; sobre a
// planta clara e dourada do Vale do Ouro ele apaga e puxa para o marrom. Este é o mesmo vermelho
// com mais luz e saturação, para continuar sendo vermelho depois de 44% de transparência.
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

  // O COMPRADOR sai da proposta VIVA do lote. `open = 1` e as etapas de 1 a 9 são as mesmas que o
  // BI do Vale do Ouro usa para "proposta que vale": reservado, contrato gerado, faturado, em
  // assinatura, finalizado e proposta realizada. Cancelada, distratada e reprovada não contam —
  // senão o mapa mostraria como dono alguém que desistiu.
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
      WHERE eu.enterprise_id IN (${ENTERPRISES.join(",")})`,
  );

  // PLANOS COMERCIAIS, do próprio C2X. Os do Garden estão cravados no molde e são OUTROS
  // (entrada de 8/20/40% e 84/48/36 parcelas). Deixar aquela tabela num mapa do Vale do Ouro
  // faria o simulador gerar uma proposta que a diretoria não reconhece.
  // UM plano por NOME. O C2X guarda uma linha de `commercial_plans` por proposta, então o mesmo
  // "PLANO NORMAL" aparece dezenas de vezes, e com juros que variam na terceira casa entre uma
  // proposta e outra. O que a tela precisa é da política, não do histórico: agrupamos por nome e
  // ficamos com a condição mais recente de cada um.
  // ⚠️ O JUROS SAI DO MAIOR CADASTRADO, não da linha mais recente — e essa distinção já custou um
  // erro. O C2X guarda uma linha de `commercial_plans` por PROPOSTA, e a mais recente do PLANO
  // NORMAL veio do VOL com juros ZERO, enquanto o mesmo plano no VOC está com 0,7207% ao mês.
  // Publicar 0% num plano de 156 parcelas faria o simulador mostrar uma parcela que não existe, e
  // parcela é o número que o cliente escuta primeiro.
  const [planos] = await conexao.query(
    `SELECT p.name,
            MAX(p.initial_input_value) initial_input_value,
            MAX(p.parcels) parcels,
            MAX(p.contractual_interest) contractual_interest
       FROM commercial_plans p
      WHERE p.enterprise_id IN (${ENTERPRISES.join(",")})
        AND p.name <> '' AND p.parcels > 0
      GROUP BY p.name
      ORDER BY MAX(p.parcels)`,
  );

  await conexao.end();
  return { linhas, planos };
}

function principal(geometria, recorte, dadosC2x) {
  const { linhas, planos } = dadosC2x;

  const chave = (q, l) => `${String(q).padStart(2, "0")}-${String(l).padStart(2, "0")}`;
  const porChave = new Map();
  for (const linha of linhas) {
    const k = chave(linha.block, linha.lot);
    // ⚠️ Q07 L20 existe nos DOIS empreendimentos (a migração do Lino para o Cecílio ficou pela
    // metade). O mapa tem um polígono só, então fica a linha do VOC — a carteira para onde o
    // lote estava indo. Aparece no relatório do fim para ninguém ser pego de surpresa.
    const atual = porChave.get(k);
    if (!atual || Number(linha.enterprise_id) === 37) porChave.set(k, linha);
  }

  const semC2x = [];
  const dados = geometria.lotes.map((lote) => {
    const unidade = porChave.get(chave(lote.quadra, lote.lote));
    if (!unidade) semC2x.push(lote.id);

    const situacao = unidade ? (SITUACAO[unidade.sale_status_id] ?? 1) : 1;
    // Preço R$ 1,00 é marcador de lote fora de venda no C2X, não preço. Vai como 0, que é o que
    // o molde já entende por "não informado" e faz a tela esconder o valor.
    const preco = Number(unidade?.price ?? 0);

    return [
      Number(lote.quadra),
      lote.lote,
      situacao,
      Number(Number(unidade?.area ?? 0).toFixed(2)),
      preco > 1 ? Math.round(preco) : 0,
      // O molde já esconde o comprador do lote disponível; aqui só não mandamos o que não existe.
      situacao === 0 ? "" : (unidade?.cliente ?? ""),
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

  // 2) O TAMANHO DA PRANCHA.
  //
  // ⚠️ A PLANTA É A RECORTADA (sem as logos impressas e sem a moldura azul, pedido do Lucas), e é
  // por isso que o viewBox tem DESLOCAMENTO. Os 298 polígonos estão em coordenadas da arte
  // original, de 3840x2400; a imagem publicada é um pedaço dela. Em vez de recalcular 1.880
  // vértices, o SVG faz o trabalho: `viewBox="x y largura altura"` aponta para a mesma janela do
  // recorte e cada lote continua exatamente sobre o seu desenho. Os números vêm do JSON que o
  // script da planta grava, nunca digitados aqui.
  const { altura, largura, viewBox } = recorte;
  html = trocar(html, "const VW=2396, VH=2160;", `const VW=${largura}, VH=${altura};`, "VW/VH");
  html = trocar(html, "aspect-ratio:2396/2160", `aspect-ratio:${largura}/${altura}`, "aspect-ratio");
  html = trocar(html, 'viewBox="0 0 2396 2160"', `viewBox="${viewBox}"`, "viewBox");
  html = trocar(html, "const RAZAO_PLANTA = 2396/2160;", `const RAZAO_PLANTA = ${largura}/${altura};`, "RAZAO_PLANTA");

  // 3) A PLANTA DE FUNDO. Caminho absoluto: a saída vive em /masterplans/ e a planta também.
  html = trocar(
    html,
    '<img class="planta" src="garden-planta.jpg" alt="Planta aérea do loteamento Garden"',
    '<img class="planta" src="/masterplans/planta-vale-do-ouro-limpa.webp" alt="Planta do loteamento Vale do Ouro"',
    "planta",
  );

  // 4) O CÓDIGO DO LOTE. Os polígonos são nomeados VLOqqll (o código histórico, que sobreviveu à
  //    divisão em VOL/VOC e é o que casa com o desenho).
  html = trocar(html, "id:'GDN'+String(r[0])", "id:'VLO'+String(r[0])", "prefixo do id");
  html = trocar(html, '<div class="gid" id="fId">GDN0000</div>', '<div class="gid" id="fId">VLO0000</div>', "gid");

  // 5) OS TEXTOS. Nome do empreendimento, contagem e a fonte do plano.
  const total = dados.length;
  html = trocar(html, "<title>Garden · Masterplan · Apolo</title>", "<title>Vale do Ouro · Masterplan · Apolo</title>", "title");
  html = trocar(html, 'title="Apolo · Masterplan do Garden"', 'title="Apolo · Masterplan do Vale do Ouro"', "title do link");
  html = trocar(html, '<div class="marca"><b>Garden</b>', '<div class="marca"><b>Vale do Ouro</b>', "marca");
  html = trocar(html, "Todo o Garden <small>· 406 lotes</small>", `Todo o Vale do Ouro <small>· ${total} lotes</small>`, "escopo");
  html = trocar(html, '<button id="escVoltar" title="voltar para o empreendimento inteiro">Todo o Garden</button>', '<button id="escVoltar" title="voltar para o empreendimento inteiro">Todo o Vale do Ouro</button>', "botão voltar");
  html = trocar(html, "'Todo o Garden'", "'Todo o Vale do Ouro'", "rótulo do escopo");
  html = trocar(html, "Planilha de vendas Garden · <b id=\"rTot\">406</b> lotes", `Planilha de vendas Vale do Ouro · <b id="rTot">${total}</b> lotes`, "rodapé da tabela");
  html = trocar(html, '<div class="sb" id="plSub">Garden Resort Residence</div>', '<div class="sb" id="plSub">Vale do Ouro</div>', "subtítulo do plano");
  html = trocar(html, "'Garden Resort Residence — simulação'", "'Vale do Ouro — simulação'", "cabeçalho da simulação");
  html = trocar(html, "'<p>Garden · '", "'<p>Vale do Ouro · '", "rodapé da exportação");
  html = trocar(html, "a.download='Garden - lotes.xls'", "a.download='Vale do Ouro - lotes.xls'", "nome do arquivo exportado");
  html = trocar(html, 'fonte “Plano comercial - Garden.xlsx”', "fonte: planos comerciais cadastrados no C2X", "fonte do plano");
  html = trocar(html, "/* null = todo o Garden", "/* null = todo o Vale do Ouro", "comentário do escopo");

  // 6) O QUARTO ESTADO. O molde nasceu com três (Disponível, Reservado, Vendido) e o número três
  //    está espalhado: arrays de contagem, camadas de pintura, filtros, legenda e CSS. Cada troca
  //    abaixo é um desses lugares, e todas são ancoradas — some uma, o gerador para.
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
  html = trocar(html, "$('vsit').innerHTML=[0,1,2].map", "$('vsit').innerHTML=[0,1,2,3].map", "valor por situação");
  html = trocar(html, "$('togSit').innerHTML=[0,1,2].map", "$('togSit').innerHTML=[0,1,2,3].map", "filtro de situação");
  html = trocar(html, "$('placaS').innerHTML=[0,1,2].map", "$('placaS').innerHTML=[0,1,2,3].map", "placa da quadra");
  html = trocar(html, "F.sit=[true,true,true]; F.p=", "F.sit=[true,true,true,true]; F.p=", "limpar filtros");
  html = trocar(html, "if(sozinho){ F.sit=[true,true,true]; }", "if(sozinho){ F.sit=[true,true,true,true]; }", "chip sozinho");
  html = trocar(html, "else { F.sit=[false,false,false]; F.sit[s]=true; }", "else { F.sit=[false,false,false,false]; F.sit[s]=true; }", "chip isolado");
  html = trocar(html, "sit:[true,true,true]", "sit:[true,true,true,true]", "estado inicial do filtro");

  // A camada nova entra POR BAIXO das outras: bloqueado é fundo, não destaque.
  html = trocar(html, '<path id="f2"/><path id="f1"/><path id="f0"/>', '<path id="f3"/><path id="f2"/><path id="f1"/><path id="f0"/>', "camada f3");

  // ⚠️ A CAMADA PRECISA DE REGRA DE CSS, e a falta disso foi o defeito que o Lucas viu: sem
  // `fill`, um <path> do SVG é PRETO SÓLIDO por especificação. Os 108 lotes bloqueados apareceram
  // como manchas pretas chapadas em cima da planta ("tem esse preto ae que ficou horrivel").
  //
  // Mais transparente que os outros três, de propósito ("ou coloca mais transparencia nesse
  // preto"): bloqueado não está à venda, então não disputa atenção com disponível, reservado e
  // vendido. 70% da alfa dos demais, e acompanha o modo filtrado junto com eles.
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

  // ⚠️ O TOM DO VENDIDO POR ÚLTIMO. A linha `--dang:#c24135;    /* vendido */` é âncora das trocas
  // acima (é ao lado dela que o token do bloqueado entra); trocar a cor antes apagaria a âncora e
  // o gerador pararia sozinho — foi o que aconteceu na primeira tentativa.
  html = trocar(html, "--dang:#c24135;", `--dang:${VENDIDO_COR};`, "tom do vendido");
  html = trocar(html, "'#c24135'", `'${VENDIDO_COR}'`, "tom do vendido (JS)");

  // COMPRADOR: bloqueado não tem, igual ao disponível. Sem isto a ficha pediria "Reservado para"
  // num lote que nunca esteve à venda.
  html = trocar(html, "if(L.sit===0){ bc.style.display='none'; }", "if(L.sit===0||L.sit===3){ bc.style.display='none'; }", "bloco do comprador");
  html = trocar(html, "cli: r[2]===0 ? '' : r[5],", "cli: (r[2]===0||r[2]===3) ? '' : r[5],", "comprador no dado");
  html = trocar(html, "L.sit===0?'<span class=\"mut\">—</span>'", "(L.sit===0||L.sit===3)?'<span class=\"mut\">—</span>'", "coluna comprador");
  html = trocar(html, "if(loteSim&&loteSim.sit!==0)", "if(loteSim&&loteSim.sit!==0&&loteSim.sit!==3)", "resumo da simulação");

  // 7) A TABELA COMERCIAL. Vem do C2X, não da planilha do Garden. O molde espera desconto e
  //    anuais; o C2X do Vale do Ouro não tem nenhum dos dois (annual_value nulo em todos), então
  //    entram zerados — o simulador segue funcionando com entrada, prazo e juros, que é o que
  //    está cadastrado de verdade.
  const planosJs = planos
    .map((p) => {
      const nome = String(p.name).replace(/^PLANO\s+/i, "");
      const entrada = Number(p.initial_input_value ?? 0) / 100;
      const juros = Number(p.contractual_interest ?? 0) / 100;
      return `  {nome:'${nome.charAt(0) + nome.slice(1).toLowerCase()}', desc:0.00, ent:${entrada.toFixed(2)}, anQtd:0, anVal:0, prazo:${p.parcels}, juros:${juros.toFixed(6)}}`;
    })
    .join(",\n");

  // Recorte por índice, e não por texto literal: o bloco tem três linhas e comparar string
  // multilinha esbarra em CRLF vs LF (este arquivo é editado no Windows, o molde não).
  const iPlanos = html.indexOf("const PLANOS=[");
  const fPlanos = html.indexOf("];", iPlanos);
  if (iPlanos < 0 || fPlanos < 0) {
    console.error("Não achei o bloco PLANOS no molde.");
    process.exit(1);
  }
  html = `${html.slice(0, iPlanos)}const PLANOS=[\n${planosJs}\n]${html.slice(fPlanos + 1)}`;

  // A taxa do simulador passa a ser a do plano escolhido (o Vale do Ouro tem plano com juros,
  // o Garden não tinha nenhum). `jurosAM` vira o maior cadastrado, que é o default da tela.
  const maiorJuros = Math.max(0, ...planos.map((p) => Number(p.contractual_interest ?? 0) / 100));
  html = trocar(html, "  jurosAM:0,", `  jurosAM:${maiorJuros.toFixed(6)},`, "juros do simulador");

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, html, "utf8");

  console.log(`lotes:      ${total}`);
  console.log(
    `situação:   ${contagem[0]} disponíveis · ${contagem[1]} reservados · ${contagem[2]} vendidos · ${contagem[3]} bloqueados`,
  );
  console.log(`compradores: ${dados.filter((l) => l[5]).length}`);
  console.log(`planos:     ${planos.map((p) => `${p.name} (${p.parcels}x)`).join(", ")}`);
  if (semC2x.length) console.log(`⚠️ sem unidade no C2X: ${semC2x.join(", ")}`);
  console.log(`gravado:    ${SAIDA} (${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB)`);
}

const geometria = JSON.parse(fs.readFileSync(GEOMETRIA, "utf8"));

// O recorte da planta limpa. Sem ele o mapa cairia de volta na arte com logo e moldura, então é
// falha dura: melhor não gerar do que gerar apontando para a imagem errada.
const RECORTE = path.resolve("apps/hub/public/masterplan/vale-do-ouro-recorte.json");
if (!fs.existsSync(RECORTE)) {
  console.error("Recorte da planta não encontrado. Rode antes: node scripts/apolo/masterplan-planta-limpa.mjs");
  process.exit(1);
}
const recorte = JSON.parse(fs.readFileSync(RECORTE, "utf8"));

principal(geometria, recorte, await lerC2x());
