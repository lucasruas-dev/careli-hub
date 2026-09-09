// O HTML DA MINUTA VIRA PDF — a folha que a pessoa assina.
//
// O caminho do contrato é: documento do editor (jsonb) → `documentoParaHtml` → HTML com estilo
// inline → ESTE ARQUIVO → PDF. Aqui não se decide NADA sobre o conteúdo: o que chega já é o
// contrato pronto. Este arquivo só imprime, e a única coisa que ele acrescenta é o mínimo que um
// HTML precisa para ser impresso igual sempre (charset, tamanho da página, margem).
//
// POR QUE CHROMIUM DE VERDADE, e não uma biblioteca de PDF. O `pdf-lib` (que já usamos no extrato
// do cliente) desenha caixa por caixa: serve para um relatório que NÓS montamos. Uma minuta não é
// nossa — ela vem do editor com tabela mesclada, nota de rodapé, imagem, lista aninhada, fonte por
// trecho. Reimplementar a diagramação disso é reimplementar um navegador. O Chromium já sabe, e é
// o MESMO motor que renderiza a pré-visualização na tela: o que o revisor vê é o que sai impresso.
//
// ⚠️ DOIS CAMINHOS PARA O BINÁRIO, E ISSO NÃO É PREGUIÇA. O `@sparticuz/chromium` empacota um
// Chromium compilado para o Amazon Linux (x64, ELF) — ele NÃO executa no Windows da máquina de
// quem desenvolve. Se este arquivo tivesse só o caminho de produção, ninguém conseguiria testar a
// geração antes de subir, e todo erro de layout só apareceria em produção. Então: na Vercel usa o
// binário empacotado; na máquina local usa o Chrome/Edge que a pessoa já tem instalado.
//
// ⚠️ O BINÁRIO NÃO ENTRA SOZINHO NO BUNDLE DA VERCEL. O `@sparticuz/chromium` acha o próprio
// `bin/chromium.br` por caminho calculado em tempo de execução (`import.meta.url`), e o rastreador
// do Next só enxerga import literal. Sem as duas linhas que estão no `next.config.ts`
// (`serverExternalPackages` + `outputFileTracingIncludes`) a função sobe sem os `.br` e quebra em
// produção com "The input directory ... does not exist" — funcionando perfeitamente em dev.
//
// TAMANHO, MEDIDO NO `next build` (07/09/2026). A função `/api/temis/pdf` fecha em 71,1 MB e 440
// arquivos: 66,4 MB são o `@sparticuz/chromium` (chromium.br 61,8 + swiftshader 3,4 + al2023 1,0 +
// fontes 0,2), 1,4 MB o `puppeteer-core` e o resto é o runtime do Next. O teto da Vercel é 250 MB
// descompactados, então sobra folga — e ela é a maior função do repo por pouco: `/api/zeus/copilot`
// já tem 68,5 MB. Quem for mexer aqui mede de novo antes de subir; a conta muda se alguém importar
// este arquivo de uma rota que já carrega meio app.
//
// ⚠️ AS FONTES DA MINUTA NÃO EXISTEM NO LAMBDA. O contrato sai do editor com `font-family` por
// trecho (Arial, Times New Roman) e o Chromium da Vercel só carrega as fontes que o
// `@sparticuz/chromium` embute (Open Sans). O texto continua legível e o conteúdo é o mesmo, mas a
// medida da linha muda — ou seja, a paginação pode não bater com a da tela. Quando isso importar
// (contrato com "página X de Y" ou assinatura em página fixa), a saída é embutir a fonte por
// `@font-face` em base64 via `estiloExtra`, e não confiar na fonte do sistema.

import type { Browser, PDFOptions } from "puppeteer-core";
import { regrasDoDocumento } from "./css-do-documento";

/** Margem do contrato, nos quatro lados. Aceita qualquer unidade que o Chromium entenda. */
export type MargensDoPdf = {
  baixo: string;
  direita: string;
  esquerda: string;
  topo: string;
};

export type OpcoesDePdf = {
  /**
   * CSS injetado ANTES do HTML da minuta. É a porta para `@font-face` em base64 — ver a nota das
   * fontes no topo. Também serve para `@page` com cabeçalho/rodapé quando a minuta pedir.
   */
  estiloExtra?: string;
  /** Tamanho do papel. O contrato brasileiro é A4; `Letter` está aqui só por completude. */
  formato?: "A4" | "Letter";
  /** Padrão: 2,5 cm nos quatro lados — a margem do contrato em papel timbrado da Careli. */
  margens?: Partial<MargensDoPdf>;
  /**
   * Quanto esperamos o HTML terminar de carregar (imagens do bucket, fontes) antes de imprimir.
   * Padrão 30s. ⚠️ Não é o tempo total: o `maxDuration` da rota é que manda.
   */
  timeoutMs?: number;
};

const MARGENS_PADRAO: MargensDoPdf = {
  baixo: "2.5cm",
  direita: "2.5cm",
  esquerda: "2.5cm",
  topo: "2.5cm",
};

const TIMEOUT_PADRAO_MS = 30_000;

/**
 * O CSS mínimo que todo contrato leva.
 *
 * ⚠️ `page-break-before: always` E `break-before: page` NA MESMA REGRA. `page-break-*` é a
 * propriedade antiga (CSS 2.1) e `break-*` é a atual; o Chromium entende as duas, mas o HTML que
 * chega aqui pode trazer qualquer uma das duas — o editor grava `page-break-before` e um `.docx`
 * importado pode trazer `break-before`. Reconhecer só uma faria a quebra sumir do contrato em
 * silêncio: o texto continua todo lá, só que emendado na página anterior. Por isso as duas são
 * declaradas nas duas direções, e o `pagina-nova` existe como classe para quem preferir marcar
 * pela semântica em vez do estilo inline.
 *
 * ⚠️ `orphans`/`widows` = 2: sem isso o Chromium deixa uma linha solta de parágrafo no pé ou no
 * topo da página. Num contrato isso vira "a cláusula começou na página 3" quando ela começou na 2.
 *
 * ⚠️ `print-color-adjust: exact` além do `printBackground: true`. O `printBackground` liga a
 * impressão de fundo no nível do documento; o `print-color-adjust` é o que impede o Chromium de
 * "economizar tinta" clareando fundos de célula — o box cinza de CIÊNCIA PRÉVIA do JDG sai branco
 * sem ele, e some visualmente do contrato.
 *
 * ⚠️ `table { break-inside: auto }` de propósito: uma tabela de quadro-resumo maior que a página
 * precisa poder partir, senão o Chromium a empurra inteira para a página seguinte e deixa meia
 * folha em branco. Já `tr` NÃO parte — linha cortada ao meio é ilegível.
 *
 * ⚠️ NÃO EXISTE `@page { margin: 0 }` AQUI, E ISSO FOI MEDIDO. Quando o CSS declara a margem da
 * página, ela VENCE a opção `margin` do `page.pdf()` — o contrato sai com o texto colado nas
 * quatro bordas e o PDF continua "válido" (mesmo número de páginas, mesmo texto), então nada no
 * teste automático acusa. A margem do contrato é decidida em um lugar só: `MARGENS_PADRAO`. Quem
 * precisar de margem diferente por página (primeira folha com timbre, por exemplo) declara o
 * `@page` pelo `estiloExtra`, sabendo que está tomando a decisão de lá.
 */
const CSS_BASE = `
  html, body { margin: 0; padding: 0; }
  ${regrasDoDocumento("body")}
  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    orphans: 2;
    widows: 2;
  }
  img, table, figure { max-width: 100%; }
  table { border-collapse: collapse; break-inside: auto; }
  tr, td, th { break-inside: avoid; page-break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
  .pagina-nova { break-before: page; page-break-before: always; }

  /* ⚠️ O MARCA-TEXTO É FERRAMENTA DE REVISÃO E NÃO VAI AO PAPEL. Decisão do Lucas, 08/09/2026.
     Ele chega por dois caminhos, e os dois precisam ser desligados: a tag mark, do botão de
     realce, e o background-color que o botão de cor de fundo grava no trecho de texto
     (estiloDoTexto, em documento-html.ts). Quem destaca um trecho para conferir está falando com
     um colega, não com o comprador — e um contrato assinado com parágrafo amarelo não tem
     desfazer.

     ⚠️ E ISSO SÓ EXISTE AQUI, no CSS do PDF, porque na TELA o realce precisa aparecer: é lá que
     ele serve. A prévia e o papel divergem neste ponto de propósito, e é a única divergência
     deliberada entre os dois.

     ⚠️ O SELETOR ATINGE SÓ TEXTO. Callout e célula de tabela pintam o fundo no elemento de
     BLOCO (div, td), e esses continuam imprimindo — foi para eles que o print-color-adjust acima
     foi ligado. Trocar por um "background: none" geral apagaria os dois. */
  mark { background-color: transparent; color: inherit; }
  span[style*="background-color"] { background-color: transparent !important; }
`;

/**
 * Embrulha o HTML da minuta num documento completo.
 *
 * ⚠️ O `<meta charset="utf-8">` NÃO É DETALHE. `documentoParaHtml` devolve um FRAGMENTO (uma
 * sequência de `<p>`, `<div>`, `<table>`), sem `<head>`. Entregue assim ao `setContent`, o
 * Chromium adivinha a codificação e todo "ç", "ã" e "º" do contrato sai como caractere trocado —
 * um contrato ilegível que passa em qualquer teste que só conte páginas.
 *
 * ⚠️ E SE O HTML JÁ FOR UM DOCUMENTO INTEIRO, não embrulhamos de novo: `<html>` dentro de `<body>`
 * é HTML inválido, o Chromium conserta jogando fora as tags externas e o `estiloExtra` iria junto.
 * Nesse caso o CSS base entra por `addStyleTag`, depois que a página carregou.
 */
function ehDocumentoCompleto(html: string): boolean {
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(html);
}

function montarPagina(html: string, estiloExtra: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>${CSS_BASE}</style>
${estiloExtra ? `<style>${estiloExtra}</style>` : ""}
</head>
<body>${html}</body>
</html>`;
}

/**
 * Onde o Chrome pode estar nesta máquina, em ordem de preferência.
 *
 * ⚠️ ESTA LISTA NÃO É CONFERIDA NO DISCO — E ISSO CUSTOU 63 MB DE MEDIÇÃO PARA DESCOBRIR. A versão
 * óbvia desta função era `candidatos.find((c) => existsSync(c))`. Só que o rastreador da Vercel
 * (`@vercel/nft`) analisa chamadas de `fs` estaticamente: quando o argumento é uma variável que
 * ele não consegue resolver, ele não sabe QUAL arquivo será lido e, por segurança, joga a árvore
 * inteira do app dentro do bundle da função. Medido no `next build` deste repo: com `existsSync` a
 * função `/api/temis/pdf` fechava em 133,8 MB (2.197 arquivos, incluindo `public/` inteiro, 31,8
 * MB de plantas de masterplan que a rota nunca abre); sem ele, 71,1 MB (440 arquivos). Mesmo
 * código, mesmo comportamento. É a mesma marca que já engorda `/api/zeus/copilot` e
 * `/api/incorporador/masterplan` hoje.
 *
 * Então quem "confere" se o navegador existe é o próprio `puppeteer.launch`: ele tenta abrir e
 * falha em milissegundos se o caminho não existir. Custo real: nenhum em produção (lá nem se
 * chega aqui) e alguns milissegundos em dev, uma vez por geração.
 *
 * ⚠️ A VARIÁVEL DE AMBIENTE VEM PRIMEIRO. É o único jeito de quem tem o navegador em lugar
 * não-padrão (ou usa Brave/Chromium) gerar contrato sem mexer no código. Depois o Chrome e só
 * então o Edge: os dois são Chromium e imprimem igual, mas o Chrome é o que o time usa para
 * conferir a tela — se o PDF sair diferente do que o revisor viu, que a diferença não seja o
 * navegador.
 *
 * ⚠️ CAMINHO FIXO, e não `process.env.ProgramFiles`. Ler o ambiente aqui obrigaria a declarar
 * `ProgramFiles`, `LOCALAPPDATA` e `USERPROFILE` no `globalEnv` do turbo — variáveis que mudam de
 * máquina para máquina e passariam a invalidar o cache de build de todo mundo, em troca de nada:
 * essas pastas são fixas no Windows e o caso fora do padrão já tem o `PUPPETEER_EXECUTABLE_PATH`.
 */
function candidatosDeChromeLocal(): string[] {
  const doAmbiente =
    process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROME_PATH ?? "";

  return [
    ...(doAmbiente ? [doAmbiente] : []),
    // Windows — a máquina do time.
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    // macOS.
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // Linux de desenvolvimento (não é o caminho da Vercel — lá o binário vem do sparticuz).
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
  ];
}

/**
 * Estamos rodando dentro de uma função da Vercel/Lambda?
 *
 * ⚠️ NÃO OLHAMOS `NODE_ENV`. `npm run build` local também roda com `NODE_ENV=production`, e um
 * `next build` que tentasse abrir o Chromium do Amazon Linux no Windows falharia sem motivo. O que
 * separa os dois mundos é o ambiente de execução, não o modo de compilação: `AWS_LAMBDA_*` é
 * posto pelo runtime da função (a Vercel roda sobre Lambda) e `VERCEL=1` cobre o resto.
 */
function ehAmbienteServerless(): boolean {
  return Boolean(
    process.env.AWS_LAMBDA_FUNCTION_NAME ??
      process.env.AWS_EXECUTION_ENV ??
      process.env.VERCEL,
  );
}

/**
 * Abre o Chromium do jeito certo para o ambiente.
 *
 * ⚠️ `setGraphicsMode = false` TROCA AS FLAGS, NÃO O QUE SE DESCOMPACTA. A documentação do pacote
 * diz que com ele o `swiftshader.tar.br` "também não é extraído"; no código da v149 a extração dos
 * três `.br` é incondicional (`build/index.js`, o array `promises`) — o que muda é o `args`, que
 * passa a mandar `--disable-webgl` no lugar de subir o rasterizador por software. Vale a pena
 * assim mesmo (menos memória no processo do Chromium, e contrato não usa WebGL), MAS tem uma
 * consequência prática: o `swiftshader.tar.br` continua sendo obrigatório no bundle da função. Se
 * alguém "otimizar" o `outputFileTracingIncludes` tirando esse arquivo, a geração quebra.
 *
 * ⚠️ O `import()` do sparticuz É DINÂMICO. Import estático faria o pacote ser carregado também na
 * máquina de quem desenvolve — e ele tem efeito colateral no topo do módulo (mexe em
 * `LD_LIBRARY_PATH` quando detecta Amazon Linux). Fora da Lambda isso não quebra, mas é sujeira; e
 * mantém o pacote fora do caminho quente do dev, que é onde o feedback precisa ser rápido.
 */
async function abrirNavegador(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;

  if (ehAmbienteServerless()) {
    const chromium = (await import("@sparticuz/chromium")).default;
    chromium.setGraphicsMode = false;

    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: { deviceScaleFactor: 1, height: 1123, width: 794 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  // Tenta abrir cada candidato até um subir. Ver a nota de `candidatosDeChromeLocal` sobre por que
  // a existência do arquivo não é checada antes.
  let ultimoErro: unknown = null;

  for (const executablePath of candidatosDeChromeLocal()) {
    try {
      return await puppeteer.launch({
        // ⚠️ `--no-sandbox` NÃO entra aqui. Na Lambda ele é obrigatório (o processo roda como
        // root); na máquina de quem desenvolve, desligar o sandbox de um Chrome que também é o
        // navegador pessoal é baixar a proteção do processo à toa.
        args: ["--disable-dev-shm-usage", "--font-render-hinting=none"],
        // Viewport de uma folha A4 a 96 dpi (21 x 29,7 cm). Não muda o PDF — a impressão usa o
        // `format` —, mas faz o layout responsivo da minuta enxergar largura de papel em vez da
        // janela padrão de 800x600, que é o que espreme tabela.
        defaultViewport: { deviceScaleFactor: 1, height: 1123, width: 794 },
        executablePath,
        headless: true,
      });
    } catch (e) {
      ultimoErro = e;
    }
  }

  throw new Error(
    "Nenhum Chrome ou Edge abriu nesta máquina. Instale o Google Chrome ou aponte " +
      `PUPPETEER_EXECUTABLE_PATH para o executável. Último erro: ${
        ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro)
      }`,
  );
}

/**
 * Transforma o HTML do contrato em PDF.
 *
 * @param html HTML da minuta — fragmento (a saída de `documentoParaHtml`) ou documento inteiro.
 * @returns os bytes do PDF. Quem chama decide se responde, guarda no bucket ou manda ao D4Sign.
 */
export async function gerarPdfDoHtml(
  html: string,
  opcoes: OpcoesDePdf = {},
): Promise<Uint8Array> {
  if (!html.trim()) {
    throw new Error("Sem HTML para imprimir.");
  }

  const margens = { ...MARGENS_PADRAO, ...opcoes.margens };
  const timeout = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
  const estiloExtra = opcoes.estiloExtra ?? "";
  const jaEraDocumento = ehDocumentoCompleto(html);

  let navegador: Browser | null = null;

  try {
    navegador = await abrirNavegador();
    const pagina = await navegador.newPage();

    // ⚠️ `setContent` COM `domcontentloaded`, NÃO `networkidle0`. A minuta carrega imagens por URL
    // assinada do bucket; `networkidle0` espera 500 ms de silêncio de rede e, se UMA imagem
    // demorar ou der 403 (URL vencida), a espera vai até o timeout e o contrato inteiro deixa de
    // sair por causa de uma logo. Aqui carregamos o DOM e, logo abaixo, esperamos as imagens de
    // forma tolerante: quem não carregar em tempo simplesmente não aparece, e o texto — que é o
    // que tem valor jurídico — sai.
    await pagina.setContent(
      jaEraDocumento ? html : montarPagina(html, estiloExtra),
      { timeout, waitUntil: "domcontentloaded" },
    );

    if (jaEraDocumento) {
      await pagina.addStyleTag({ content: CSS_BASE });
      if (estiloExtra) await pagina.addStyleTag({ content: estiloExtra });
    }

    await esperarRecursos(pagina, timeout);

    // ⚠️ MÍDIA `screen`, NÃO `print`. O HTML da minuta sai do editor com estilo INLINE pensado para
    // a tela; se emulássemos `print`, qualquer `@media print` herdado de um `.docx` importado
    // entraria em cena e o contrato sairia diferente do que o revisor aprovou. A quebra de página
    // continua valendo: `page-break-before` não é regra de `@media print`, é propriedade de
    // fragmentação — o Chromium a respeita sempre que está paginando, que é o caso do `pdf()`.
    await pagina.emulateMediaType("screen");

    const configuracao: PDFOptions = {
      displayHeaderFooter: false,
      format: opcoes.formato ?? "A4",
      margin: {
        bottom: margens.baixo,
        left: margens.esquerda,
        right: margens.direita,
        top: margens.topo,
      },
      // ⚠️ `preferCSSPageSize: false` DE PROPÓSITO. Um `.docx` importado pode trazer um `@page`
      // com tamanho Letter ou margem de 1 polegada; se o CSS vencesse, o contrato mudaria de
      // formato conforme a origem do arquivo. Quem manda no papel é esta função.
      preferCSSPageSize: false,
      printBackground: true,
      timeout,
    };

    return await pagina.pdf(configuracao);
  } finally {
    // ⚠️ FECHAR SEMPRE, inclusive quando deu erro. Um Chromium órfão numa instância quente da
    // Lambda continua ocupando memória até a instância morrer, e a invocação SEGUINTE — que já
    // sobe outro Chromium — é a que estoura e falha, apontando para o contrato errado.
    await navegador?.close().catch(() => undefined);
  }
}

/**
 * Espera o que muda o layout: fontes e imagens.
 *
 * ⚠️ `document.fonts.ready` É O PONTO CRÍTICO. Sem ele o Chromium imprime enquanto a fonte ainda
 * está trocando: o texto sai medido pela fonte de fallback e a paginação do PDF não bate com a da
 * tela — cláusula que começava na página 4 aparece na 3. É o tipo de erro que ninguém vê no teste
 * (o PDF "existe", o texto está todo lá) e que só aparece quando alguém confere o contrato
 * assinado contra a minuta.
 *
 * ⚠️ TUDO DENTRO DE UM TIMEOUT E COM `.catch`. Esperar recurso é conveniência de layout, não
 * requisito do contrato: se uma imagem do bucket travar, imprimimos assim mesmo. Deixar a espera
 * derrubar a geração trocaria "contrato com uma logo faltando" por "nenhum contrato".
 */
async function esperarRecursos(
  pagina: Awaited<ReturnType<Browser["newPage"]>>,
  timeout: number,
): Promise<void> {
  const espera = pagina
    .evaluate(async () => {
      await document.fonts.ready;

      const pendentes = [...document.images]
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
        );

      await Promise.all(pendentes);

      // Um respiro depois do `fonts.ready`: o Chromium resolve a fonte, mas o reflow que ela
      // provoca acontece no frame seguinte. Imprimir no mesmo tick pega o layout de antes.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    })
    .catch(() => undefined);

  // O teto vale para a espera INTEIRA, não por recurso. Uma página com trinta imagens de bucket
  // não pode multiplicar o timeout por trinta.
  let relogio: NodeJS.Timeout | undefined;
  const teto = new Promise<void>((resolve) => {
    relogio = setTimeout(resolve, timeout);
  });

  try {
    await Promise.race([espera, teto]);
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}
