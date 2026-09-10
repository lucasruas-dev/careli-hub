// O ESPELHO TEM DOIS ESTADOS, SÓ: disponível e não disponível.
//
// Lucas (08/09/2026): *"no espelho só tem disponível e não disponível"*. As cinco situações do
// cadastro (disponível, reservada, em negociação, vendida, bloqueada) continuam vivas onde a
// diferença serve para trabalhar — a tela de Vendas e o painel de Produtos. No MAPA elas viram uma
// pergunta só, que é a pergunta que o corretor faz olhando para o lote: *posso vender este?*
//
// ⚠️ A REGRA É FAIL-CLOSED. Disponível é o que o cadastro diz EXPLICITAMENTE `disponivel`; todo o
// resto é não disponível. Se amanhã nascer uma situação nova no cadastro, ela cai em "não
// disponível" sozinha: o erro possível passa a ser deixar de oferecer um lote livre — nunca
// oferecer um lote que já tem dono.
//
// ⚠️ O SLOT DE "NÃO DISPONÍVEL" MUDA DE ARQUIVO PARA ARQUIVO, E ISSO JÁ QUEBROU EM PRODUÇÃO. Os
// masterplans não têm todos o mesmo número de situações: `vale-do-ouro`, `lagoa-bonita`,
// `vista-alegre` e `recanto-do-para` têm QUATRO (`TOT=[0,0,0,0]`, `pf=[f0,f1,f2,f3]`), e o
// `garden` tem TRÊS (`TOT=[0,0,0]`, `pf=[f0,f1,f2]` — não existe `#f3` no arquivo). A leitura do
// C2X gravava `3` (Bloqueado) nos 317 lotes bloqueados do Garden, e o `pintar()` de lá só percorre
// `s<3`: os 317 iam para um `buf[3]` que ninguém lê e ficavam SEM CAMADA DE COR NENHUMA no mapa,
// com `NOME[3]` = `undefined` no selo e `TOT[3]` virando `NaN`. Medido hoje no arquivo em produção:
// `garden.html` grava 88 lotes em `0` e 317 em `2`, e o C2X responde 87 disponíveis e 317
// bloqueados — ou seja, a tela mostrava 87 verdes e 317 lotes invisíveis. Por isso o slot é LIDO
// DO ARQUIVO, e não cravado.

/** Onde o arquivo declara quantas situações ele conhece. `const TOT=[0,0,0,0];` */
const TOTAL = /const TOT=\[([0,\s]*)\]/;

/** O array de rótulos: `const NOME=['Disponível','Reservado','Vendido','Bloqueado'];` */
const ROTULOS = /const NOME=\[((?:'[^']*'\s*,?\s*)+)\]/;

/** O rótulo único do estado ocupado. Junta reservado + em negociação + vendido + bloqueado. */
export const ROTULO_INDISPONIVEL = "Indisponível";

/**
 * Quantas situações ESTE arquivo conhece (3 ou 4), ou `null` quando não dá para saber.
 *
 * `null` é resposta, não acidente: quem chama precisa recusar em vez de chutar. Chutar `3` num
 * arquivo de quatro perderia o slot cinza; chutar `4` num de três é exatamente o bug do Garden.
 */
export function situacoesDoArquivo(html: string): null | number {
  const bloco = html.match(TOTAL)?.[1];
  if (bloco === undefined) return null;

  const quantas = bloco.split(",").filter((parte) => parte.trim() === "0").length;

  // Fora de 3..4 é arquivo de outro formato: melhor recusar do que escrever num slot inventado.
  return quantas === 3 || quantas === 4 ? quantas : null;
}

/**
 * O índice que o arquivo usa para "não disponível": o ÚLTIMO slot que ele tem.
 *
 * ⚠️ POR QUE O ÚLTIMO, E NÃO UM FIXO. Nos arquivos de quatro estados o último é o `3`, que é o
 * cinza-ardósia (`--blq: #64748b`, `#f3` com `fill:#e2e8f0`) — o mesmo neutro que a casa já usa
 * para "Indisponível" no mapa do Garden dentro do Apolo (`masterplan-mapa.tsx`), e é ele que o
 * painel de unidade do arquivo já sabe tratar: `if(L.sit===0||L.sit===3) esconde o bloco do
 * comprador`, que é justamente o que um mapa de dois estados quer. No arquivo de três, o último é
 * o `2` (vermelho `--dang`), porque é o que existe — e um lote pintado de vermelho é infinitamente
 * melhor do que um lote sem pintura nenhuma, que foi o que aconteceu.
 *
 * ⚠️ E NENHUM TOM NOVO ENTRA. Os dois estados usam a paleta que o arquivo já carrega: o verde de
 * `--ok` (mesma família do `disponivel` de lib/hercules/cores-de-situacao.ts) e o neutro do último
 * slot. A proposta, se um dia a casa quiser o par no arquivo de cores, é reusar `bloqueado` — não
 * criar um `indisponivel` novo.
 */
export function slotIndisponivel(html: string): null | number {
  const quantas = situacoesDoArquivo(html);
  return quantas === null ? null : quantas - 1;
}

/**
 * A legenda do arquivo dizendo a verdade sobre os dois estados.
 *
 * ⚠️ SEM ISTO A LEGENDA MENTE, e mente com número. Com a situação vindo do Panteon em dois
 * estados, os slots do meio ficam permanentemente em zero e o último recebe TUDO: a Lagoa Bonita
 * abriria "Disponível 51 · Reservado 0 · Vendido 0 · Bloqueado 444" — e 4 daqueles 444 são
 * vendidos, 6 reservados e 434 bloqueados. Chamar os 444 de "Bloqueado" é dizer ao corretor que
 * eles voltam para a prateleira quando a empresa quiser. E no Garden seria "Vendido 317" para 317
 * lotes que estão bloqueados, não vendidos.
 *
 * Três costuras, todas por cima do arquivo aprovado e nenhuma no `DADOS`:
 *   1. `NOME` passa a ter "Indisponível" em todo slot que não é o 0 — é a fonte do selo, da
 *      tabela, da busca e do painel de filtros;
 *   2. as pastilhas da legenda que nunca mais acendem somem (as do meio), e a que sobrou é
 *      renomeada no HTML — o texto dela é estático, `NOME` não a alcança;
 *   3. as linhas mortas do painel de filtros somem por posição (`nth-child`), porque ele monta
 *      `[0,1,2,3]` sem filtrar vazio.
 *
 * Arquivo que não declara suas situações volta INTACTO: quem decide recusar é `aplicarEstadoAtual`,
 * que não consegue nem escrever a situação sem o slot — a legenda não é lugar de tomar essa
 * decisão duas vezes.
 */
export function comLegendaDeDoisEstados(html: string): string {
  const quantas = situacoesDoArquivo(html);
  if (quantas === null) return html;

  const nomes = ["'Disponível'", ...Array.from({ length: quantas - 1 }, () => `'${ROTULO_INDISPONIVEL}'`)];
  const comNome = html.replace(ROTULOS, `const NOME=[${nomes.join(",")}]`);

  // A pastilha que sobrou é a do último slot; o texto dela mora no HTML, não em `NOME`.
  const ultimo = quantas - 1;
  const comChip = comNome.replace(
    new RegExp(
      `(<button class="chip s${ultimo}" data-sit="${ultimo}" title=")[^"]*("><span class="pt"></span>)[^<]*(</button>)`,
    ),
    `$1mostrar só os disponíveis para venda no mapa$2${ROTULO_INDISPONIVEL}$3`,
  );

  // Os slots do meio: 1 no arquivo de três, 1 e 2 no de quatro.
  const mortos = Array.from({ length: quantas - 2 }, (_, i) => i + 1);
  const chips = mortos.map((s) => `.legenda .chip[data-sit="${s}"]`).join(",");
  // `nth-child` e não `[data-sit]`: o painel de filtros é montado por JS depois do load, mas a
  // ORDEM é a de `[0,1,2,3]`, então a posição é estável e o CSS pega igual.
  const linhas = mortos.map((s) => `#togSit label:nth-child(${s + 1})`).join(",");

  return comChip.replace(
    "</style>",
    `${chips}{display:none}
${linhas}{display:none}
</style>`,
  );
}
