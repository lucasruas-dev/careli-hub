import {
  Building2,
  ContactRound,
  FileSignature,
  Grid2x2,
  Images,
  Layers,
  // Alias pelo mesmo motivo da view do Apolo: `Link` sombrearia o do next/link.
  Link2 as LinkIcon,
  type LucideIcon,
  Network,
  Percent,
  SquareKanban,
} from "lucide-react";

// AS ABAS DA FICHA DO PRODUTO, POR MODO — a régua que a FichaDoProduto desenha.
//
// ⚠️ MORA FORA DA FICHA PARA TER TESTE. A FichaDoProduto importa o BoardDoProduto, que arrasta o
// BoardView do Apolo inteiro (cliente do Supabase, realtime); o teste da régua não precisa de nada
// disso. Aqui fica só o que é regra: quais abas, em que ordem, com que nome, e para onde o atalho
// do Resumo leva em cada modo.

/** As abas da ficha. O Resumo salta para as outras pelo `onIr` (ver `destinoDoResumo`). */
export type AbaDaFicha =
  // "arquivos", "board", "minutas", "politica" e "relacionamentos" só existem no modo
  // "incorporador" (ver `ABAS_DO_INCORPORADOR`).
  | "arquivos"
  | "board"
  | "cadastro"
  | "imobiliarias"
  // Os tres links publicos do produto. Lucas (10/09/2026): *"no perfil da gurgel vai ficar
  // dentro de produtos, dentro do empreendimento"* — a ficha, e nao o menu do portal.
  | "links"
  | "minutas"
  | "politica"
  | "relacionamentos"
  | "resumo"
  | "unidades";

/**
 * Quem está olhando a ficha. O comercial é o Hércules da Gurgel (o time da Careli operando); o
 * incorporador é o portal que opera a PRÓPRIA venda (`portalOperaVenda`, hoje só o da Cecílio).
 */
export type ModoDaFicha = "comercial" | "incorporador";

export type AbaDaRegua = { icone: LucideIcon; id: AbaDaFicha; rotulo: string };

// Ícones na régua do Apolo: Resumo e Cadastro são os MESMOS da ficha interna (Layers e
// ContactRound); Imobiliárias usa o de Relacionamentos (Network), que é o que elas são para o
// produto; Vendas é o TrendingUp de lá; Contratos é o FileSignature da Têmis.
const ABAS_DO_COMERCIAL: ReadonlyArray<AbaDaRegua> = [
  { icone: Layers, id: "resumo", rotulo: "Resumo" },
  { icone: ContactRound, id: "cadastro", rotulo: "Cadastro" },
  { icone: Network, id: "imobiliarias", rotulo: "Imobiliárias" },
  { icone: Grid2x2, id: "unidades", rotulo: "Unidades" },
  // Links fecha a fila, como no Apolo: e o produto visto POR FORA.
  { icone: LinkIcon, id: "links", rotulo: "Links" },
];

// AS ABAS DO PORTAL QUE OPERA A PRÓPRIA VENDA (modo "incorporador").
//
// Lucas (16/09/2026), sobre o portal da Cecílio Rocha: *"literalmente ter dois sistemas, mas ele
// seria uma replica que temos hoje"* · *"a Cecilio quem vai fazer e o proprio time deles (...) eles
// meio que vao andar sozinhos sem o time administrativo da Careli"*. A ficha replica a tela
// Empreendimento do Apolo SEM Mapa, Vendas e Carteira, mais as abas do processo do Hércules e a
// aba nova de Arquivos. Na ordem do pedido:
//   • Resumo, Imobiliárias, Unidades e Links — as MESMAS peças do comercial;
//   • Cadastro — agora é o do APOLO (os dados gerais do empreendimento, `CadastroDoProduto`);
//   • Board — o `BoardDoProduto`, que no comercial se chama "Cadastro". ⚠️ O NOME MUDOU E A PEÇA
//     NÃO: quem opera sozinho precisa dos dois, e dois "Cadastro" na mesma régua seria a mesma
//     palavra para duas coisas. O Resumo continua pedindo "cadastro" para o board
//     (`destinoDoResumo` traduz);
//   • Relacionamentos — o do Apolo, sem abrir o CRM do hub e sem contato de terceiro;
//   • Políticas comerciais — `PoliticasDoProduto`, a porta do portal para as regras do produto;
//   • Minutas — os modelos de contrato do produto, pela Têmis do portal (`MinutasDoProduto`);
//   • Arquivos — fotos e vídeos do empreendimento, com edição (é o time do cliente que alimenta).
//
// ⚠️ MINUTAS ENTROU EM 16/09/2026, E SÓ NO PRODUTO QUE O PORTAL OPERA. Decisões do Lucas: a equipe da
// Cecílio gera o contrato e *"também edita os modelos"*, mas a escrita só vale no produto com
// `operado_por` = o portal (o Garden e o que nasce no portal). No VOC e no VOR, que seguem da
// Careli, a aba nem aparece (`abasDaFicha(modo, { minutas })`): a minuta deles é o jurídico da Careli
// quem mantém. No comercial ela nunca existe (a Gurgel não edita minuta).
//
// ⚠️ SETUP CONTINUA DE FORA DE PROPÓSITO: depende de decisão do Lucas sobre o que o time do cliente
// pode mexer na configuração do produto.
//
// ⚠️ ETAPAS (a aba "filhos" do Apolo, só no produto agrupado) TAMBÉM FICOU DE FORA, e isto é
// registro de uma ausência que a primeira versão não anotou (revisão de 16/09/2026). No Apolo ela
// abre os filhos de um pai (VOC, VOL e VOR do Vale do Ouro) com as unidades de cada um. No portal o
// produto já chega RECORTADO: o Cecílio tem só o VOC e o Garden, e mostrar a divisão interna vai
// contra a regra "o corretor não vê divisão interna". Se o Lucas quiser a aba para um portal que
// cubra um pai inteiro, ela entra aqui junto da decisão de Setup. O teste desta régua
// lista as exclusões explicitamente, para uma aba nova do Apolo não sumir do portal calada.
//
// Ícones: os do Apolo onde a aba é a do Apolo (Layers, ContactRound, Network, Percent, Link2);
// Imobiliárias sai do Network (que aqui é de Relacionamentos, como lá) para o Building2, que é o
// ícone de imobiliária da casa; Board é o quadro de colunas; Minutas é o FileSignature da Têmis (o
// mesmo do Apolo); Arquivos, a pilha de imagens. Minutas fica depois de Políticas, a mesma vizinhança
// da ficha do Apolo (o plano decide qual minuta a venda usa).
const ABAS_DO_INCORPORADOR: ReadonlyArray<AbaDaRegua> = [
  { icone: Layers, id: "resumo", rotulo: "Resumo" },
  { icone: ContactRound, id: "cadastro", rotulo: "Cadastro" },
  { icone: SquareKanban, id: "board", rotulo: "Board" },
  { icone: Building2, id: "imobiliarias", rotulo: "Imobiliárias" },
  { icone: Grid2x2, id: "unidades", rotulo: "Unidades" },
  { icone: Network, id: "relacionamentos", rotulo: "Relacionamentos" },
  { icone: Percent, id: "politica", rotulo: "Políticas comerciais" },
  { icone: FileSignature, id: "minutas", rotulo: "Minutas" },
  { icone: LinkIcon, id: "links", rotulo: "Links" },
  { icone: Images, id: "arquivos", rotulo: "Arquivos" },
];

/** O que depende da linha aberta, e não só do modo. */
export type OpcoesDaRegua = {
  /**
   * A aba Minutas aparece? Só quando o portal OPERA este produto (`linha.podeEscrever`) e a linha
   * aponta para UM enterprise (`linha.enterpriseId`). Ausente = não: a aba é escrita, e escrita
   * nasce fechada.
   */
  minutas?: boolean;
};

/** A régua de abas de cada modo. */
export function abasDaFicha(modo: ModoDaFicha, opcoes: OpcoesDaRegua = {}): ReadonlyArray<AbaDaRegua> {
  if (modo !== "incorporador") return ABAS_DO_COMERCIAL;
  if (opcoes.minutas === true) return ABAS_DO_INCORPORADOR;
  return ABAS_DO_INCORPORADOR.filter((aba) => aba.id !== "minutas");
}

/**
 * Para onde vai o atalho do Resumo. O Resumo fala a língua do comercial ("cadastro" = as CADs); no
 * modo incorporador as CADs moram na aba Board, e "cadastro" é a ficha do empreendimento.
 */
export function destinoDoResumo(
  modo: ModoDaFicha,
  destino: "cadastro" | "imobiliarias" | "unidades",
): AbaDaFicha {
  return modo === "incorporador" && destino === "cadastro" ? "board" : destino;
}
