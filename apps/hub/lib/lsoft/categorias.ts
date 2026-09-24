// DE QUAL EMPREENDIMENTO É ESTE TÍTULO DO LSOFT, e ele é patrimônio?
//
// No LSoft o "centro de custo" é a tripla CATEGORIA.CLASSE.SUBCLASSE, e até 24/09/2026 a régua da
// casa era simples: CATEGORIA = empreendimento (124 Garden, 102 Vale do Sol, 69 Vale do Ouro - 2).
//
// ⚠️ A RÉGUA NÃO VALE PARA A BASE INTEIRA, e foi o que a conciliação de setembro mostrou. A
// categoria 17, cadastrada com o nome "Vitor", NÃO é um empreendimento: são 1.456 títulos em aberto
// (R$ 20,9 mi) com venda de sete produtos misturados, e o produto real só existe no texto livre de
// OBSERVACOES:
//
//     "APTO 1503 LUA/1508 SOL GIANT TOWERS 720.000"
//     "APTO 307 GUAIMBE"        ·  "APTO 404 BL 03 VALE DO SOL"
//     "APTO 202 ED CRISTAL"     ·  "APTO ON SKY 310/104/509 450.000 30 PARC"
//
// Medido em 24/09/2026, o efeito disso: dos 25 clientes do Guaimbê com boleto em setembro, só 7
// tinham parcela na categoria 70; os outros 18 estavam na 17. No Vale do Sol, 18 de 102. Filtrar a
// carga por categoria, como o plano previa, traz carteira incompleta e a conferência com o boleto
// nunca fecha.
//
// ⚠️ A TAG DE PATRIMÔNIO É DA CATEGORIA, NÃO DO TEXTO. Decisão do Lucas (24/09/2026): *"ele deve
// estar vinculado ao empreendimento, mas ter uma tag de patrimonio e que eu pudesse ver esse valor,
// ter filtros"* e, perguntado sobre o recorte, "toda a categoria 17". Então o título da 17 vai para
// o empreendimento que o texto indica E leva a tag. A tag mora em `lsoft_classificacao_de_parcela`
// (a mesma mecânica do subsídio da Caixa), que casa por `impressao_digital` e por isso sobrevive à
// recarga.
//
// ⚠️ ISTO É UMA CONVENIÊNCIA, NÃO A VERDADE. O texto original é gravado junto em
// `lsoft_parcelas.observacoes`, como já acontece com lote e quadra (ver `unidade.ts`). Quando o
// número não bater, é no texto que se olha, e a tela deixa o time corrigir.

/** O nome do empreendimento como o Panteon grava. Tem de bater COM O CATÁLOGO DE BOLETOS. */
export type NomeDeEmpreendimento = string;

export type ClassificacaoDoTitulo = {
  /** Nulo quando nem a categoria nem o texto disseram: vai para o time decidir na tela. */
  empreendimento: NomeDeEmpreendimento | null;
  /** De onde saiu o nome, para a tela mostrar o que foi deduzido e o que é cadastro. */
  origem: "categoria" | "indefinido" | "texto";
  /** Veio da carteira de patrimônio (categoria 17). */
  patrimonio: boolean;
};

// ⚠️ O NOME TEM DE SER IDÊNTICO ao `chaveLsoft`/`nome` de `lib/apolo/boletos/empreendimentos.ts`.
// A tela de boletos casa por igualdade de texto: um acento ou um espaço de diferença não dá erro,
// devolve carteira vazia, e quem olha conclui que não há nada a emitir.
export const GARDEN = "Garden";
export const VALE_DO_SOL = "Vale do Sol";
export const VALE_DO_OURO = "Vale do Ouro - 2";
export const ON_SKY = "On Sky";
export const GUAIMBE = "Guaimbé";
export const GIANT_TOWERS = "Giant Towers";
export const ED_CRISTAL = "Ed. Cristal";
export const ED_RUBI = "Ed. Rubi";
export const ED_JADE = "Ed. Jade";
export const ED_ESMERALDA = "Ed. Esmeralda";
// Os dois abaixo NÃO estão na tela de boletos; aparecem na 17 e precisam de nome para não cair em
// "indefinido" junto com o que é de verdade desconhecido.
export const MIRAGE = "Mirage Residence";
export const MANHATTAN = "Manhattan";
/**
 * O balde dos títulos cujo produto nem a categoria nem o texto dizem (medido em 24/09/2026: 199 em
 * aberto na categoria 17, R$ 6,3 mi; galpões, salas em BH, veículos, apartamentos sem o prédio).
 * Existem no espelho para o time classificar na tela, em vez de sumirem na carga.
 */
export const A_CLASSIFICAR = "A classificar";

/**
 * Os empreendimentos que o espelho aceita, na ordem em que a tela os oferece.
 *
 * ⚠️ É O MESMO CONJUNTO DO CHECK `lsoft_parcelas_empreendimento_check` (migration 0189), e um teste
 * lê o SQL da migration e compara. Acrescentar um nome aqui sem migration faz a carga falhar no
 * banco; acrescentar na migration sem aqui faz o empreendimento sumir do seletor.
 */
export const EMPREENDIMENTOS_DO_ESPELHO = [
  GARDEN,
  VALE_DO_SOL,
  VALE_DO_OURO,
  GIANT_TOWERS,
  ON_SKY,
  GUAIMBE,
  ED_CRISTAL,
  ED_ESMERALDA,
  ED_JADE,
  ED_RUBI,
  MIRAGE,
  MANHATTAN,
  A_CLASSIFICAR,
] as const;

/**
 * A categoria que responde sozinha pelo empreendimento.
 *
 * ⚠️ 69 É O VALE DO OURO, e o cadastro do LSoft a chama de "Loteamento José Lino", o nome antigo do
 * loteamento. A extração de agosto procurou na 129 ("Portico Loteamento Vale do Ouro"), que tem
 * ZERO título a receber, e concluiu que a carteira não existia. Ver `extrair-vale-do-ouro.ps1`.
 */
export const CATEGORIA_E_O_EMPREENDIMENTO: Record<number, NomeDeEmpreendimento> = {
  66: ON_SKY,
  69: VALE_DO_OURO,
  70: GUAIMBE,
  102: VALE_DO_SOL,
  118: GIANT_TOWERS,
  124: GARDEN,
  // "Enxoval On Sky": é o mesmo prédio, cobrado à parte. 31 títulos.
  126: ON_SKY,
};

/** A categoria que carrega vendas de vários produtos, e cujo título leva a tag de patrimônio. */
export const CATEGORIA_PATRIMONIO = 17;

/**
 * A categoria que NÃO responde sozinha: o Rubi e o Jade dividem a 115 ("Edifício Rubi e Jade"), e
 * na tela de boletos são dois empreendimentos. Só o texto separa; sem pista, fica indefinido.
 */
export const CATEGORIA_AMBIGUA = new Set([115, CATEGORIA_PATRIMONIO]);

// ── A LEITURA DO TEXTO LIVRE ────────────────────────────────────────────────
//
// ⚠️ ORDEM IMPORTA, e é por isso que é uma LISTA e não um objeto. "ED CRISTAL" contém "CRISTAL";
// "SOL GIANT TOWERS" contém "SOL", que também é sinal de Vale do Sol. O mais específico vem antes,
// e a primeira regra que casar vence.
//
// ⚠️ "LUA" e "SOL" são as TORRES do Giant Towers ("APTO 1503 LUA/1508 SOL"), não o Vale do Sol. Por
// isso Giant Towers é testado primeiro e "SOL" sozinho nunca decide nada.
const REGRAS: Array<{ nome: NomeDeEmpreendimento; padrao: RegExp }> = [
  { nome: GIANT_TOWERS, padrao: /\bGIANT\b|\bTOWERS\b/ },
  // ⚠️ A TORRE SEM O NOME DO PRÉDIO. O Giant Towers tem duas torres, LUA e SOL, e metade dos
  // lançamentos escreve só o apartamento e a torre: "APTO 1211 SOL 613.089", "APTO 1512 SOL 1510
  // SOL 1303 LUA". São 89 títulos que ficariam indefinidos. O número antes é o que torna isto
  // seguro: no Vale do Sol o texto é sempre "VALE DO SOL" ou "BL 03 VALE DO SOL", nunca "1211 SOL".
  { nome: GIANT_TOWERS, padrao: /\b\d{3,4}\s*(LUA|SOL)\b/ },
  { nome: ED_ESMERALDA, padrao: /\bESMERALDA\b/ },
  { nome: ED_CRISTAL, padrao: /\bCRISTAL\b/ },
  { nome: ED_RUBI, padrao: /\bRUBI\b/ },
  { nome: ED_JADE, padrao: /\bJADE\b/ },
  // GUAIMB, GUIAMB e GUAIB: as três grafias que existem na base, todas do mesmo prédio.
  { nome: GUAIMBE, padrao: /GUAIMB|GUIAMB|GUAIB/ },
  { nome: ON_SKY, padrao: /\bON\s*SKY\b|\bONSKY\b/ },
  { nome: MIRAGE, padrao: /\bMIRAGE\b/ },
  { nome: MANHATTAN, padrao: /MANHAT/ },
  { nome: VALE_DO_OURO, padrao: /VALE\s+DO\s+OURO|JOS[EÉ]\s+LINO/ },
  { nome: VALE_DO_SOL, padrao: /VALE\s+(DO\s+)?SOL/ },
  { nome: GARDEN, padrao: /\bGARDEN\b/ },
];

/**
 * O empreendimento que o texto livre do LSoft denuncia, ou nulo.
 *
 * ⚠️ "GUIAMBE" com as letras trocadas existe na base ("APTO 808- GUIAMBE") e é a grafia de quem
 * digitou correndo. Uma regra que só aceite "GUAIMBE" perde o título e o cliente some da carteira.
 */
export function empreendimentoDoTexto(observacoes: null | string | undefined): NomeDeEmpreendimento | null {
  const t = String(observacoes ?? "").toUpperCase();
  if (!t.trim()) return null;
  for (const regra of REGRAS) {
    if (regra.padrao.test(t)) return regra.nome;
  }
  return null;
}

/**
 * A classificação de um título do LSoft: de qual empreendimento é, e se é patrimônio.
 *
 * A categoria decide primeiro quando ela responde sozinha; nas ambíguas (17 e 115) quem decide é o
 * texto. Sem pista, devolve `indefinido`: melhor uma carteira que o time completa do que um número
 * colado no empreendimento errado.
 */
export function classificarTitulo(entrada: {
  categoria: null | number | string;
  observacoes: null | string | undefined;
}): ClassificacaoDoTitulo {
  const categoria = Number(entrada.categoria);
  const patrimonio = categoria === CATEGORIA_PATRIMONIO;

  if (!CATEGORIA_AMBIGUA.has(categoria)) {
    const direto = CATEGORIA_E_O_EMPREENDIMENTO[categoria];
    if (direto) return { empreendimento: direto, origem: "categoria", patrimonio };
  }

  const doTexto = empreendimentoDoTexto(entrada.observacoes);
  if (doTexto) return { empreendimento: doTexto, origem: "texto", patrimonio };

  return { empreendimento: null, origem: "indefinido", patrimonio };
}
