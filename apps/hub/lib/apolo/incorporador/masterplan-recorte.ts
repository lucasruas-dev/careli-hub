// O MASTERPLAN MOSTRA O LOTEAMENTO INTEIRO, MAS SÓ ENTREGA OS LOTES DE QUEM ESTÁ OLHANDO.
//
// Regra do Lucas (17/08/2026), dada sobre a Lagoa Bonita e que vale para todo mapa dividido:
// *"quando for montar os mapas... colocar uma cor cinza para as unidades que não foram do
// empreendimento que estamos trabalhando"*.
//
// ⚠️ POR QUE ISTO EXISTE. O `vale-do-ouro.html` é UM arquivo e cobre o loteamento histórico inteiro:
// 298 lotes, e cada linha carrega quadra, lote, situação, área, PREÇO e NOME COMPLETO do comprador
// — a tela ainda exporta tudo para planilha. A divisão em VOL (família Lino) e VOC (Cecílio) foi
// feita lote a lote: 141 de um, 157 do outro. Servir o arquivo cru para quem tem só uma das
// divisões entrega a carteira do vizinho, com nome e valor, e um botão de baixar.
//
// O RECORTE É NO SERVIDOR, e essa é a decisão que importa: o que não é dele NÃO SAI DAQUI. Esconder
// no navegador (uma classe CSS, um filtro na tela) deixaria o dado no HTML, a um Ctrl+U de
// distância.
//
// E o recorte é por REMOÇÃO, não por marcação. Os lotes de fora saem do array `DADOS` e voltam
// como uma lista de POLÍGONOS PUROS — só o desenho, sem quadra, lote, área, preço ou nome. Assim:
//   • o mapa continua completo (o cliente reconhece o loteamento onde ele comprou);
//   • KPI, filtro, tabela, busca e exportação enxergam SÓ os lotes dele, sem uma linha de
//     mudança na tela aprovada — nenhuma delas sabe que os outros existem;
//   • não há campo neutralizado para alguém "desneutralizar" depois.
//
// A alternativa (uma situação nova, "fora do escopo", dentro do próprio `DADOS`) foi descartada: a
// tela crava quatro situações em oito lugares (`TOT`, `F.sit`, `porSit`, `buf`, os chips da
// legenda…), e mexer nisso é reescrever a tela que o Lucas aprovou com nove prints.

/** Uma linha do `DADOS`: `[quadra, lote, situação, área, valor, comprador, polígono]`. */
type LinhaDoMapa = {
  chave: string;
  /** A linha SEM o terminador (`],` ou `];`): quem remonta decide a pontuação. */
  miolo: string;
  poligono: string;
};

const ABERTURA = "const DADOS=[";

/**
 * `1` + `"07"` -> `1-07`, e `"C01"` + `"11"` -> `C01-11`.
 *
 * A quadra tem DOIS formatos vivos: no Vale do Ouro ela é número (o C2X guarda `1` e o mapa grava
 * `[1,"01",…]`), e na Lagoa Bonita o bloco leva letra (`"C01"`/`"L08"`, o mapa grava
 * `["C01","01",…]`). Número é normalizado como número (para `1`, `"01"` e `1.0` caírem na mesma
 * chave); texto sobe para caixa alta, porque a chave é comparada com o `block` do C2X e uma
 * diferença de caixa separaria o mesmo lote em duas chaves.
 */
export function chaveDoLote(quadra: number | string, lote: number | string): string {
  const q = Number(String(quadra).trim());
  const l = String(lote).trim().padStart(2, "0");
  return `${Number.isFinite(q) ? q : String(quadra).trim().toUpperCase()}-${l}`;
}

/**
 * Lê as linhas do `DADOS` do HTML.
 *
 * Não é um parser de JavaScript: é a leitura de um bloco gerado por nós, com uma linha por lote e
 * formato fixo. Linha que não casa com o formato é devolvida em `desconhecidas` — e quem chama
 * decide o que fazer, porque linha não entendida é linha que pode conter nome de comprador.
 */
export function lerLinhasDoMapa(html: string): {
  desconhecidas: number;
  fim: number;
  inicio: number;
  linhas: LinhaDoMapa[];
} | null {
  const inicio = html.indexOf(ABERTURA);
  if (inicio < 0) return null;

  const corpoDe = inicio + ABERTURA.length;

  // ⚠️ O ARRAY FECHA NO FIM DA ÚLTIMA LINHA DE LOTE, e não numa linha só dele. Procurar o
  // fechamento como quebra-de-linha seguida de colchete pula esse fim e vai parar no PRÓXIMO array
  // do arquivo (o `COLS`, 540 linhas adiante) — foi o que aconteceu na primeira versão, e o
  // sintoma foi "509 linhas em formato inesperado". A varredura é linha a linha e para na
  // primeira que fecha o array.
  const linhas: LinhaDoMapa[] = [];
  let desconhecidas = 0;
  let fim = -1;
  let cursor = corpoDe;

  while (cursor < html.length) {
    const quebra = html.indexOf("\n", cursor);
    const ate = quebra < 0 ? html.length : quebra;
    const bruta = html.slice(cursor, ate);
    const linha = bruta.trim();
    cursor = ate + 1;

    if (!linha) {
      if (quebra < 0) break;
      continue;
    }

    // ⚠️ O FECHAMENTO DO ARRAY GRUDA NA ÚLTIMA LINHA DE LOTE: ela termina em `]];` — o colchete do
    // lote e o do array, juntos. Tirar só um terminador deixa `]]` sobrando e a linha inteira
    // deixa de ser reconhecida: era o 298º lote sumindo em silêncio, que é o pior jeito de perder
    // dado (o mapa abre, com um lote a menos).
    //
    // Os dois formatos de fechamento existem: grudado (`…]];`) no Vale do Ouro, e em linha própria
    // (`];`) em arquivo gerado de outro jeito. Os dois são aceitos.
    const fecha = linha.endsWith("];");
    const miolo = (
      fecha ? linha.slice(0, -2) : linha.endsWith(",") ? linha.slice(0, -1) : linha
    ).trim();

    // A linha que era SÓ o fechamento não é lote nem erro: é pontuação.
    if (!miolo) {
      fim = ate;
      break;
    }

    // `[quadra,"lote",sit,area,valor,"comprador","x,y x,y …"]` — o polígono é o ÚLTIMO texto.
    // A quadra vem NUA quando é número (Vale do Ouro: `[1,"01",…]`) e ENTRE ASPAS quando é o
    // bloco com letra da Lagoa Bonita (`["C01","01",…]`). Os dois formatos são aceitos.
    const cabeca = miolo.match(/^\[(?:(\d+)|"([^"]+)"),"([^"]*)"/);
    const cauda = miolo.match(/"([-\d.,\s]+)"\]$/);

    if (cabeca && cauda) {
      linhas.push({
        chave: chaveDoLote(cabeca[1] ?? cabeca[2] ?? "", cabeca[3] ?? ""),
        miolo,
        poligono: (cauda[1] ?? "").trim(),
      });
    } else {
      desconhecidas += 1;
    }

    if (fecha) {
      fim = ate;
      break;
    }

    if (quebra < 0) break;
  }

  // Array sem fechamento = arquivo cortado ou formato mudou. Não se adivinha onde ele termina.
  if (fim < 0) return null;

  return { desconhecidas, fim, inicio: corpoDe, linhas };
}

export type Recorte =
  | { erro: string; ok: false }
  | { dentro: number; fora: number; html: string; ok: true };

/**
 * Devolve o HTML com o `DADOS` reduzido ao escopo e os demais lotes como fundo cinza.
 *
 * @param permitidos Chaves `quadra-lote` que este portal pode ver (de `chaveDoLote`).
 *
 * ⚠️ FAIL-CLOSED EM TUDO. Se o bloco não for encontrado, se alguma linha não for entendida, ou se
 * o recorte não sobrar nada, a função RECUSA em vez de servir o arquivo cru. Um mapa que não abre
 * é um chamado; um mapa que abre com a carteira do vizinho é um problema com o cliente.
 */
export function recortarMasterplan(html: string, permitidos: Set<string>): Recorte {
  const bloco = lerLinhasDoMapa(html);
  if (!bloco) return { erro: "bloco de dados nao encontrado", ok: false };

  if (bloco.desconhecidas > 0) {
    // Linha fora do formato pode carregar nome e preço, e não dá para saber de quem ela é.
    return { erro: `${bloco.desconhecidas} linha(s) em formato inesperado`, ok: false };
  }

  const dentro: string[] = [];
  const fora: string[] = [];

  for (const item of bloco.linhas) {
    if (permitidos.has(item.chave)) dentro.push(item.miolo);
    else if (item.poligono) fora.push(item.poligono);
  }

  if (dentro.length === 0) {
    return { erro: "nenhum lote deste empreendimento no mapa", ok: false };
  }

  // Nada a esconder: o pedido cobre o loteamento inteiro. Segue o arquivo sem recorte — mas a
  // moldura interna sai MESMO ASSIM: ela não depende de escopo, e foi justamente neste caminho
  // (o Bill, dono do mapa inteiro) que ela escapou para o cliente.
  if (fora.length === 0) {
    return { dentro: dentro.length, fora: 0, html: semMolduraInterna(html), ok: true };
  }

  // A vírgula separa e o `];` fecha: é a pontuação que a leitura tirou de cada linha.
  const recortado =
    html.slice(0, bloco.inicio) + "\n" + dentro.join(",\n") + "];" + html.slice(bloco.fim);

  return {
    dentro: dentro.length,
    fora: fora.length,
    html: semMolduraInterna(comFundoCinza(recortado, fora)),
    ok: true,
  };
}

/**
 * Arranca a "moldura do Panteon" antes de o mapa sair para o cliente.
 *
 * O masterplan interno nasce com um rail decorativo de módulos (Íris, Hades, Prometeu, Hermes),
 * que dentro do Apolo é ambientação e no portal do incorporador é ruído com vazamento: o tooltip
 * entrega "Hades · cobrança" para quem não deveria nem saber que o módulo existe. O Lucas viu e
 * disse: *"isso aqui não faz sentido"* (18/08/2026). Vale para TODO portal, Cecílio incluído:
 * moldura interna em tela externa é a mesma categoria de vazamento do recorte de lotes, não é
 * comportamento de produto.
 *
 * Duas costuras, e o `<nav>` sai do FONTE (esconder por CSS deixaria os nomes no view-source):
 *   1. remove o bloco `<nav class="rail">…</nav>`;
 *   2. zera a primeira coluna do grid (os 54px do rail), com um `<style>` no fim do head, que
 *      vence o original por ordem.
 */
function semMolduraInterna(html: string): string {
  const semNav = html.replace(/<nav class="rail"[\s\S]*?<\/nav>/, "");

  return semNav.replace(
    "</style>",
    `body{grid-template-columns:0 318px minmax(0,1fr) 340px}
</style>`,
  );
}

/**
 * Injeta a camada cinza dos lotes que não são deste portal.
 *
 * Três costuras, todas por baixo do que já existe:
 *   1. um `<path id="fFora">` como PRIMEIRO filho da camada de cor, para ficar atrás dos lotes dele;
 *   2. o CSS da camada;
 *   3. um script no fim do corpo, que roda depois da tela montada e só desenha.
 *
 * O script é o último elemento de propósito: ele não participa de nada: nem de clique, nem de
 * filtro, nem de contagem. É desenho.
 */
function comFundoCinza(html: string, poligonos: string[]): string {
  const d = poligonos.map((p) => `M${p.replace(/ /g, "L")}Z`).join("");

  const comPath = html.replace(
    '<path id="f3"/>',
    '<path id="fFora"/><path id="f3"/>',
  );

  const comCss = comPath.replace(
    "</style>",
    `#fFora{fill:#475569;fill-opacity:.6;stroke:#334155;stroke-opacity:.7;stroke-width:1.5;pointer-events:none}
</style>`,
  );

  // O `d` vai num atributo, não em JavaScript: nada dele é interpretado como código.
  const script =
    `<script>(function(){var e=document.getElementById("fFora");` +
    `if(e)e.setAttribute("d",${JSON.stringify(d)});})();</script>`;

  // ⚠️ O ÚLTIMO </body>, nunca o primeiro. O exportador de planilha do mapa monta um HTML
  // inteiro dentro de string JS ('…</body></html>'), e esse </body> FALSO vem antes do real.
  // Inserir no primeiro (replace) enfiava um </script> no meio do script principal: o navegador
  // encerrava o app ali, o resto virava TEXTO na tela ("blob=new"…) e os painéis ficavam vazios
  // — foi exatamente o que o Lucas viu no mapa da Lagoa Bonita em 18/08/2026. O caminho de
  // escopo total não passa por aqui, por isso o Vista Alegre nunca quebrou.
  const pos = comCss.lastIndexOf("</body>");
  return pos >= 0
    ? `${comCss.slice(0, pos)}${script}\n${comCss.slice(pos)}`
    : comCss + script;
}
