// AS REGRAS DE TELA DO CADASTRO DE PRODUTO E DE UNIDADE: puras, sem React, sem rede.
//
// Decisão do Lucas (16/09/2026) para o portal da Cecílio Rocha: o time do cliente cadastra os
// próprios produtos (prédios e loteamentos) e as unidades deles, e tudo grava no Panteon. As
// regras de NEGÓCIO moram em lib/hercules/produto-novo.ts e lib/hercules/unidade-nova.ts, e a tela
// e a rota leem as mesmas. Este arquivo guarda só o que é da TELA: como ler a resposta das rotas,
// como montar a linha conferida a partir do que a rota julgou, o que vai na planilha modelo.
//
// ⚠️ NADA AQUI DECIDE SE UMA UNIDADE OU UM PRODUTO É VÁLIDO. Uma segunda régua na tela discordaria
// da do servidor no primeiro ajuste. Quando a tela precisa conferir, chama `validarProdutoNovo`,
// `validarUnidade` ou `conferirPlanilhaDeUnidades`, as mesmas funções que a rota chama.
//
// ⚠️ SEPARADO DOS COMPONENTES para ter teste: os .tsx arrastam o tema e o lucide, e a leitura das
// respostas (qual linha entra, qual não entra, o que o banco confirmou) não pode depender de montar
// tela para ser conferida.
import { codigoDoProduto, type ErrosDoProdutoNovo, type TipoProduto } from "@/lib/hercules/produto-novo";
import {
  apartamentoCanonico,
  type CampoDaUnidade,
  codigoDaUnidade,
  type ColunaDaPlanilhaDeUnidades,
  colunasDaPlanilha,
  type ErrosDaUnidade,
  type LinhaDaPlanilhaDeUnidades,
  type ProblemaDaLinhaDeUnidade,
  quadraOuLote,
  rotuloDaUnidade,
  torreCanonica,
} from "@/lib/hercules/unidade-nova";

// ─────────────────────────────────────────────────────────────────────────────
// PRODUTO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * As duas escolhas de tipo, como a pessoa as reconhece.
 *
 * ⚠️ "PRÉDIO" E NÃO "VERTICAL": é a palavra do time da Cecílio (Ed. Jade, On Sky, Giant Towers). O
 * valor gravado continua `vertical`, que é o que a CHECK da 0170 aceita.
 */
export const OPCOES_DE_TIPO_DE_PRODUTO: readonly { chave: TipoProduto; detalhe: string; titulo: string }[] = [
  { chave: "loteamento", detalhe: "Quadras e lotes", titulo: "Loteamento" },
  { chave: "vertical", detalhe: "Torres e apartamentos", titulo: "Prédio" },
];

/**
 * O código como a pessoa digita: maiúsculas, sem acento, só letras e números, até 6.
 *
 * ⚠️ LIMPA ENQUANTO DIGITA EM VEZ DE RECUSAR DEPOIS. Espaço, acento e hífen nunca são aceitos
 * (`validarProdutoNovo`), então mostrar o erro só depois do clique ensina a regra pelo castigo. O
 * que sobra para a validação explicar é o que a limpeza não resolve: começar por número, ter uma
 * letra só, repetir um código que já existe.
 */
export function codigoEnquantoDigita(valor: string): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

/** Palavras que não identificam o produto: "Ed. Jade" é o Jade, "Residencial Vale do Sol" é o Vale do Sol. */
const PALAVRAS_SEM_PESO = new Set([
  "COND",
  "CONDOMINIO",
  "D",
  "DA",
  "DAS",
  "DE",
  "DO",
  "DOS",
  "E",
  "ED",
  "EDIF",
  "EDIFICIO",
  "LOTEAMENTO",
  "RES",
  "RESIDENCIAL",
]);

/**
 * Um código sugerido a partir do nome: "Ed. Jade" → "JAD", "Giant Towers" → "GT".
 *
 * É SÓ SUGESTÃO, e a tela oferece como um botão, nunca preenche sozinha: o código vira o começo do
 * código de cada unidade e aparece em relatório para sempre, então quem decide é a pessoa. Com uma
 * palavra, as três primeiras letras; com mais, as iniciais (até três). Se já existir, troca a
 * última posição por um número (JAD → JAD2). Devolve vazio quando não há o que sugerir.
 */
export function sugerirCodigoDoProduto(nome: string, existentes: Iterable<string> = []): string {
  const palavras = String(nome ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((p) => p !== "" && !PALAVRAS_SEM_PESO.has(p));

  const letras = palavras.join("").replace(/^\d+/, "");
  if (letras.length < 2) return "";

  let base: string;
  if (palavras.length === 1) {
    base = letras.slice(0, 3);
  } else {
    base = palavras
      .slice(0, 3)
      .map((p) => p[0] ?? "")
      .join("")
      .replace(/^\d+/, "");
    // "4 Estações": a inicial numérica sai e pode sobrar uma letra só; completa com a palavra.
    if (base.length < 2) base = letras.slice(0, 3);
  }

  const usados = new Set([...existentes].map(codigoDoProduto));
  if (!usados.has(base)) return base;

  for (let n = 2; n <= 9; n += 1) {
    const candidato = base.length < 6 ? `${base}${n}` : `${base.slice(0, 5)}${n}`;
    if (!usados.has(candidato)) return candidato;
  }
  return "";
}

/**
 * Os erros por campo que a tela do produto pinta: os da régua, mais o operador, que só existe na
 * porta do hub (`operadoPorIncorporadorSlug`, o portal que vai operar o produto).
 */
export type ErrosDaTelaDoProduto = ErrosDoProdutoNovo & { operadoPorIncorporadorSlug?: string };

export type RespostaDoProdutoNovo =
  | {
      codigo: string;
      enterpriseId: string;
      ok: true;
      /**
       * A rota do portal manda recarregar a sessão: o escopo mora no cookie, e só o GET de
       * /api/incorporador/sessao o reemite com o produto novo. Sem isso, toda rota do portal responde
       * 404 para o produto que a pessoa acabou de criar.
       */
      recarregarSessao: boolean;
    }
  | { erros: ErrosDaTelaDoProduto; mensagem: null | string; ok: false };

const CAMPOS_DO_PRODUTO: readonly (keyof ErrosDaTelaDoProduto)[] = [
  "cidade",
  "codigo",
  "nome",
  "operadoPorIncorporadorSlug",
  "paiCodigo",
  "tipoProduto",
  "uf",
];

function objeto(valor: unknown): null | Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

function textoOuNulo(valor: unknown): null | string {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

function mensagemPadrao(status: number, geral: string, semPermissao: string, pendente: string): string {
  if (status === 401 || status === 403) return semPermissao;
  if (status === 503) return pendente;
  return geral;
}

/**
 * A resposta de `POST /api/incorporador/produtos/novo`, lida sem confiar no formato.
 *
 * Contrato: sucesso `{ data: { enterpriseId, codigo } }`; recusa por campo `422 { erros }` (ou
 * `{ data: { erros } }`), com as MESMAS mensagens de `validarProdutoNovo`; `409` sem `erros` é
 * código repetido; qualquer outra falha `{ error }`.
 *
 * ⚠️ 2XX SEM `enterpriseId` NÃO É SUCESSO, E TAMBÉM NÃO É "PODE TENTAR DE NOVO". O produto pode ter
 * nascido e a resposta ter vindo cortada; a mensagem manda conferir a lista antes, porque um segundo
 * clique criaria o segundo produto (o código repetido só trava se o primeiro de fato gravou).
 */
export function lerRespostaDoProdutoNovo(status: number, corpo: unknown): RespostaDoProdutoNovo {
  const raiz = objeto(corpo);
  const dados = objeto(raiz?.data);

  if (status >= 200 && status < 300) {
    const id = dados?.enterpriseId;
    const enterpriseId = typeof id === "number" && Number.isFinite(id) ? String(id) : textoOuNulo(id);
    if (enterpriseId) {
      return {
        codigo: codigoDoProduto(dados?.codigo),
        enterpriseId,
        ok: true,
        recarregarSessao: dados?.recarregarSessao === true,
      };
    }
    return {
      erros: {},
      mensagem:
        "O servidor respondeu sem o número do produto. Confira a lista de produtos antes de tentar de novo: ele pode ter sido criado.",
      ok: false,
    };
  }

  const errosCrus = objeto(raiz?.erros) ?? objeto(dados?.erros);
  const erros: ErrosDaTelaDoProduto = {};
  for (const campo of CAMPOS_DO_PRODUTO) {
    const motivo = textoOuNulo(errosCrus?.[campo]);
    if (motivo) erros[campo] = motivo;
  }

  const doServidor = textoOuNulo(raiz?.error);

  if (status === 409 && !erros.codigo) {
    erros.codigo = doServidor ?? "Este código já está em uso por outro empreendimento. Escolha outro.";
    return { erros, mensagem: null, ok: false };
  }

  const temErroDeCampo = Object.keys(erros).length > 0;
  return {
    erros,
    mensagem:
      doServidor ??
      (temErroDeCampo
        ? null
        : mensagemPadrao(
            status,
            "Não foi possível criar o produto agora. Tente de novo em instantes.",
            "Seu acesso não permite cadastrar produto. Entre de novo ou fale com quem administra o portal.",
            "O cadastro de produto ainda não está liberado. Tente de novo mais tarde.",
          )),
    ok: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIDADE: O FORMULÁRIO DE UMA
// ─────────────────────────────────────────────────────────────────────────────

/** Um exemplo do código que as unidades do produto recebem: "JDG0107" ou "JAD-A-304". */
export function exemploDeCodigoDaUnidade(prefixo: string, tipo: TipoProduto): string {
  return tipo === "vertical"
    ? codigoDaUnidade(prefixo, tipo, { apartamento: "304", torre: "A" })
    : codigoDaUnidade(prefixo, tipo, { lote: "07", quadra: "01" });
}

export const SITUACOES_DO_FORMULARIO = ["Disponível", "Bloqueada"] as const;

export type CamposDaUnidade = Record<CampoDaUnidade, string>;

export function camposVaziosDaUnidade(): CamposDaUnidade {
  return {
    andar: "",
    apartamento: "",
    area: "",
    areaPrivativa: "",
    lote: "",
    matricula: "",
    motivoDoBloqueio: "",
    preco: "",
    quadra: "",
    situacao: "Disponível",
    tipologia: "",
    torre: "",
    vagas: "",
  };
}

/**
 * O que cada coluna pede, em uma frase. Vai na aba "Como preencher" da planilha modelo e embaixo
 * do campo no formulário: quem abre a planilha dias depois, longe da tela, lê a mesma orientação.
 */
export const DESCRICAO_DO_CAMPO: Record<CampoDaUnidade, string> = {
  andar: "Número do andar. 0 para térreo, negativo para subsolo.",
  apartamento: "Número do apartamento (304). 0304 e 304 são o mesmo apartamento.",
  area: "Área do lote em m², com vírgula decimal (300,00).",
  areaPrivativa: "Área privativa em m², com vírgula decimal (68,45). É a área do preço por m².",
  lote: "Número do lote. 7 e 07 são o mesmo lote.",
  matricula: "Número da matrícula no cartório. Em branco a unidade entra com aviso: o contrato vai precisar dela.",
  motivoDoBloqueio: "Só para unidade bloqueada: por que ela está fora da venda (Permuta, Reserva técnica).",
  preco: "Valor de tabela em reais (140.401,00). Em branco a unidade entra BLOQUEADA, fora da venda e do VGV, até alguém preencher o preço e liberar.",
  quadra: "Número ou letra da quadra (01, C01). 1 e 01 são a mesma quadra.",
  situacao: "Disponível ou Bloqueada. Em branco vira Disponível. Reserva e venda acontecem pela tela Venda.",
  tipologia: "Como a planta é vendida (2 quartos, 1 suíte).",
  torre: "Letra ou nome da torre (A, B, Norte). Em branco para prédio de torre única.",
  vagas: "Quantidade de vagas de garagem. 0 para sem vaga.",
};

export type CampoDoFormularioDeUnidade = ColunaDaPlanilhaDeUnidades & {
  /** A dica curta embaixo do campo; nula quando o rótulo e o exemplo já bastam. */
  dica: null | string;
  /** O teclado do celular: número com vírgula, número inteiro, ou texto. */
  teclado: "decimal" | "numeric" | "text";
};

const DICA_NO_FORMULARIO: Partial<Record<CampoDaUnidade, string>> = {
  andar: "0 para térreo, negativo para subsolo.",
  preco: "Em branco: entra bloqueada, fora da venda, até ter preço.",
  torre: "Em branco para prédio de torre única.",
};

const TECLADO: Partial<Record<CampoDaUnidade, "decimal" | "numeric">> = {
  area: "decimal",
  areaPrivativa: "decimal",
  preco: "decimal",
  vagas: "numeric",
};

/**
 * Os campos do formulário de UMA unidade, na ordem da planilha do tipo.
 *
 * ⚠️ SAEM DAS MESMAS COLUNAS DA PLANILHA (`colunasDaPlanilha`), para o formulário e o modelo não
 * pedirem coisas diferentes. Situação e motivo ficam de fora porque a tela os desenha à parte: um
 * seletor, e o motivo só quando a unidade nasce bloqueada.
 */
export function camposDoFormulario(tipo: TipoProduto): CampoDoFormularioDeUnidade[] {
  return colunasDaPlanilha(tipo)
    .filter((c) => c.chave !== "situacao" && c.chave !== "motivoDoBloqueio")
    .map((c) => ({ ...c, dica: DICA_NO_FORMULARIO[c.chave] ?? null, teclado: TECLADO[c.chave] ?? "text" }));
}

/**
 * O formulário vira UMA linha de planilha, só com as chaves do tipo.
 *
 * ⚠️ O MOTIVO SÓ VAI QUANDO A UNIDADE É BLOQUEADA. A pessoa pode ter escrito um motivo, voltado para
 * Disponível e esquecido o texto lá: o motivo não pode ir junto de uma unidade livre.
 */
export function linhaDoFormulario(tipo: TipoProduto, campos: CamposDaUnidade): LinhaDaPlanilhaDeUnidades {
  const linha: LinhaDaPlanilhaDeUnidades = {};
  const bloqueada = normalizarSituacao(campos.situacao) === "bloqueada";

  for (const coluna of colunasDaPlanilha(tipo)) {
    if (coluna.chave === "motivoDoBloqueio" && !bloqueada) continue;
    const valor = String(campos[coluna.chave] ?? "").trim();
    if (valor !== "") linha[coluna.chave] = valor;
  }
  return linha;
}

function normalizarSituacao(valor: string): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

export type RetornoNoFormulario = {
  avisos: ErrosDaUnidade;
  erros: ErrosDaUnidade;
  /** O que não é de um campo só: "já está cadastrada", "repetida", o código que não montou. */
  gerais: string[];
};

const CAMPOS_DA_UNIDADE = new Set<string>(Object.keys(camposVaziosDaUnidade()));

/** Os problemas da linha única devolvidos pela rota, cada um embaixo do seu campo. */
export function problemasNoFormulario(problemas: readonly ProblemaDaLinhaDeUnidade[]): RetornoNoFormulario {
  const retorno: RetornoNoFormulario = { avisos: {}, erros: {}, gerais: [] };
  for (const p of problemas) {
    if (CAMPOS_DA_UNIDADE.has(p.campo)) {
      const alvo = p.soAviso ? retorno.avisos : retorno.erros;
      alvo[p.campo as CampoDaUnidade] ??= p.motivo;
    } else if (!p.soAviso) {
      retorno.gerais.push(p.motivo);
    }
  }
  return retorno;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANILHA: LEITURA E MODELO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O valor de uma célula do Excel, pronto para a validação.
 *
 * ⚠️ NÚMERO FICA NÚMERO, E O RESTO VIRA O TEXTO QUE A PESSOA VÊ. O `exceljs` entrega fórmula, texto
 * rico, link e data como OBJETO; `String(objeto)` seria "[object Object]" na coluna quadra, e a
 * linha ia recusar um valor que a pessoa nunca escreveu. Número cru é o melhor caso: `numeroBR` lê
 * 300.5 sem adivinhar separador.
 */
export function valorDaCelula(valor: unknown, textoVisivel: string): unknown {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number" || typeof valor === "string") return valor;
  return String(textoVisivel ?? "");
}

/** A linha tem alguma célula preenchida? Linha toda em branco no meio da planilha some, não é erro. */
export function linhaTemConteudo(linha: LinhaDaPlanilhaDeUnidades): boolean {
  return Object.values(linha).some((v) => String(v ?? "").trim() !== "");
}

/** O cabeçalho no modelo: o rótulo, com " *" nas obrigatórias (e `chaveDaColunaDeUnidades` lê de volta). */
export function cabecalhoDaColuna(coluna: ColunaDaPlanilhaDeUnidades): string {
  return coluna.obrigatoria ? `${coluna.rotulo} *` : coluna.rotulo;
}

/** As colunas que o Excel precisa guardar como TEXTO: "01" digitado numa célula de número vira 1. */
export const COLUNAS_DE_TEXTO: ReadonlySet<CampoDaUnidade> = new Set<CampoDaUnidade>([
  "apartamento",
  "lote",
  "matricula",
  "quadra",
  "torre",
]);

export function nomeDoArquivoDoModelo(prefixo: string, tipo: TipoProduto): string {
  const sigla = String(prefixo ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return `modelo-unidades-${sigla || "produto"}-${tipo === "vertical" ? "predio" : "loteamento"}.xlsx`;
}

/**
 * As linhas da aba "Como preencher" do modelo: [coluna, orientação].
 *
 * ⚠️ O EXEMPLO MORA AQUI, E NÃO NA ABA DAS UNIDADES. No modelo do C2X a linha de exemplo ia na aba
 * de dados; aqui ela viraria uma unidade de verdade (quadra 01, lote 07) na primeira importação de
 * quem esqueceu de apagar. Cadastro no Panteon não tem desfazer pela tela.
 */
export function instrucoesDoModelo(
  tipo: TipoProduto,
  produto: { codigo: string; nome?: null | string },
): [string, string][] {
  const colunas = colunasDaPlanilha(tipo);
  const codigo = codigoDoProduto(produto.codigo);
  const nome = String(produto.nome ?? "").trim();
  const exemplo = exemploDeCodigoDaUnidade(codigo, tipo);

  return [
    ["Produto", nome ? `${nome} (${codigo})` : codigo],
    ["Tipo", tipo === "vertical" ? "Prédio (torres e apartamentos)" : "Loteamento (quadras e lotes)"],
    ["", ""],
    ["Coluna", "O que preencher"],
    ...colunas.map((c): [string, string] => [cabecalhoDaColuna(c), DESCRICAO_DO_CAMPO[c.chave]]),
    ["", ""],
    ["Colunas com *", "Obrigatórias. Linha sem elas não entra, e a conferência diz o motivo."],
    ["Uma linha, uma unidade", exemplo ? `Cada linha vira uma unidade, com código no formato ${exemplo}.` : "Cada linha vira uma unidade."],
    ["Repetidas", "Unidade que já existe no produto, ou que aparece duas vezes na planilha, não entra de novo."],
    ["", ""],
    ["Exemplo de linha", "(não copie para a aba Unidades)"],
    ...colunas.map((c): [string, string] => [c.rotulo, c.exemplo]),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFERÊNCIA NA TELA
// ─────────────────────────────────────────────────────────────────────────────

export type UnidadeNaConferencia = { codigo: string; linha: number; rotulo: string };

/** A parte da `ConferenciaDeUnidades` que a tela usa (a rota pode mandar a unidade inteira junto). */
export type ConferenciaNaTela = {
  problemas: ProblemaDaLinhaDeUnidade[];
  unidades: UnidadeNaConferencia[];
};

export type EstadoDaLinha = "aviso" | "erro" | "ok";

export type LinhaConferida = {
  codigo: string;
  estado: EstadoDaLinha;
  linha: number;
  mensagens: { campo: string; motivo: string; soAviso: boolean }[];
  /** Vazio quando a linha não tem nem a quadra nem o lote (ou nem torre nem apartamento). */
  rotulo: string;
};

function parte(valor: unknown): null | string {
  const t = String(valor ?? "").trim();
  return t === "" ? null : t;
}

/**
 * Como chamar uma linha que ainda não é unidade: "Quadra 01 · Lote 07", ou só "Quadra 01" quando o
 * lote faltou. A pessoa acha a linha na planilha pelo que escreveu, não pelo número dela.
 */
export function rotuloDaLinha(tipo: TipoProduto, bruta: LinhaDaPlanilhaDeUnidades): string {
  const partes = {
    apartamento: parte(bruta.apartamento),
    lote: parte(bruta.lote),
    quadra: parte(bruta.quadra),
    torre: parte(bruta.torre),
  };
  const inteiro = rotuloDaUnidade(tipo, partes);
  if (inteiro) return inteiro;

  if (tipo === "vertical") {
    const torre = torreCanonica(partes.torre);
    const apto = apartamentoCanonico(partes.apartamento);
    return [torre ? `Torre ${torre}` : "", apto ? `Apto ${apto}` : ""].filter(Boolean).join(" · ");
  }
  const quadra = quadraOuLote(partes.quadra, "QUADRA");
  const lote = quadraOuLote(partes.lote, "LOTE");
  return [quadra ? `Quadra ${quadra}` : "", lote ? `Lote ${lote}` : ""].filter(Boolean).join(" · ");
}

/**
 * Uma linha por linha da planilha, com o estado: entra (ok), entra com aviso, ou não entra (erro).
 *
 * ⚠️ A LINHA QUE A CONFERÊNCIA NÃO MENCIONOU É ERRO, NÃO OK. Toda linha enviada volta como unidade
 * pronta ou como problema; se alguma não voltou, a resposta veio incompleta, e gravar no escuro é
 * o que esta etapa existe para evitar.
 */
export function linhasConferidas(
  tipo: TipoProduto,
  prefixo: string,
  brutas: readonly LinhaDaPlanilhaDeUnidades[],
  conferencia: ConferenciaNaTela,
): LinhaConferida[] {
  const prontas = new Map(conferencia.unidades.map((u) => [u.linha, u]));
  const porLinha = new Map<number, ProblemaDaLinhaDeUnidade[]>();
  for (const p of conferencia.problemas) {
    const lista = porLinha.get(p.linha) ?? [];
    lista.push(p);
    porLinha.set(p.linha, lista);
  }

  return brutas.map((bruta, indice) => {
    const linha = indice + 2;
    const pronta = prontas.get(linha);
    const problemas = porLinha.get(linha) ?? [];
    const mensagens = problemas.map((p) => ({ campo: p.campo, motivo: p.motivo, soAviso: Boolean(p.soAviso) }));
    const temErro = problemas.some((p) => !p.soAviso);

    if (pronta && !temErro) {
      return {
        codigo: pronta.codigo,
        estado: mensagens.length > 0 ? "aviso" : "ok",
        linha,
        mensagens,
        rotulo: pronta.rotulo,
      };
    }

    return {
      codigo: codigoDaUnidade(prefixo, tipo, {
        apartamento: parte(bruta.apartamento),
        lote: parte(bruta.lote),
        quadra: parte(bruta.quadra),
        torre: parte(bruta.torre),
      }),
      estado: "erro",
      linha,
      mensagens: temErro
        ? mensagens
        : [...mensagens, { campo: "linha", motivo: "A conferência não trouxe esta linha de volta. Confira de novo.", soAviso: false }],
      rotulo: rotuloDaLinha(tipo, bruta),
    };
  });
}

export type ContagemDaConferencia = { aviso: number; erro: number; ok: number; prontas: number; total: number };

export function contagemDaConferencia(linhas: readonly LinhaConferida[]): ContagemDaConferencia {
  const ok = linhas.filter((l) => l.estado === "ok").length;
  const aviso = linhas.filter((l) => l.estado === "aviso").length;
  const erro = linhas.filter((l) => l.estado === "erro").length;
  return { aviso, erro, ok, prontas: ok + aviso, total: linhas.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPOSTAS DA ROTA DE UNIDADES
// ─────────────────────────────────────────────────────────────────────────────
//
// CONTRATO (lib/hercules/cadastrar-unidades-panteon-server.ts, `executarCadastroDeUnidades`):
//   { acao: "conferir", linhas } → { data: { bloqueioDaGravacao, linhas: LinhaDaRota[], unidadesHoje, ... } }
//   { acao: "importar", linhas } → { data: { avisos, criadas, unidades: UnidadeGravadaNaTela[] } }
//                                  422 { error, data: <a mesma forma do conferir> }: nada entrou
//   { acao: "criar", unidade }   → { data: { avisos, unidade: UnidadeGravadaNaTela } }
//                                  409/422 { error, data?: <a forma do conferir, com uma linha> }
// A linha é a da planilha como a pessoa vê no Excel (a 1 é o cabeçalho): a rota trata o envio
// inteiro como uma planilha, e a tela manda a planilha inteira num envio só.

/** Uma linha como a ROTA a julgou (`data.linhas[]`). */
export type LinhaDaRota = {
  codigo: null | string;
  linha: number;
  problemas: ProblemaDaLinhaDeUnidade[];
  resultado: EstadoDaLinha;
  rotulo: null | string;
};

/** Uma unidade que o banco confirmou depois de gravar (a rota relê pelo código). */
export type UnidadeGravadaNaTela = { codigo: string; id: string; rotulo: string; situacao: string };

function numeroOuNulo(valor: unknown): null | number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function problemasDe(valor: unknown): ProblemaDaLinhaDeUnidade[] {
  if (!Array.isArray(valor)) return [];
  const saida: ProblemaDaLinhaDeUnidade[] = [];
  for (const item of valor) {
    const p = objeto(item);
    const linha = numeroOuNulo(p?.linha);
    const motivo = textoOuNulo(p?.motivo);
    if (!p || linha === null || !motivo) continue;
    saida.push({
      campo: typeof p.campo === "string" ? p.campo : "",
      linha,
      motivo,
      ...(p.soAviso === true ? { soAviso: true } : {}),
      valor: String(p.valor ?? ""),
    });
  }
  return saida;
}

const RESULTADOS = new Set<string>(["aviso", "erro", "ok"]);

function linhasDaRotaDe(valor: unknown): LinhaDaRota[] {
  if (!Array.isArray(valor)) return [];
  const saida: LinhaDaRota[] = [];
  for (const item of valor) {
    const l = objeto(item);
    const linha = numeroOuNulo(l?.linha);
    if (!l || linha === null) continue;
    saida.push({
      codigo: textoOuNulo(l.codigo),
      linha,
      problemas: problemasDe(l.problemas),
      // Resultado que a tela não conhece é erro: gravar no escuro é o que a conferência evita.
      resultado: typeof l.resultado === "string" && RESULTADOS.has(l.resultado) ? (l.resultado as EstadoDaLinha) : "erro",
      rotulo: textoOuNulo(l.rotulo),
    });
  }
  return saida;
}

function unidadeGravadaDe(valor: unknown): null | UnidadeGravadaNaTela {
  const u = objeto(valor);
  const codigo = textoOuNulo(u?.codigo);
  const id = textoOuNulo(u?.id);
  if (!u || !codigo || !id) return null;
  return { codigo, id, rotulo: String(u.rotulo ?? ""), situacao: String(u.situacao ?? "") };
}

/**
 * A conferência da ROTA, uma linha por linha da planilha, no formato da tabela da tela.
 *
 * ⚠️ A LINHA QUE A ROTA NÃO DEVOLVEU É ERRO, NÃO OK. E a linha que veio "ok" com um problema que não
 * é aviso também é erro: a tela nunca confia mais no rótulo do que no motivo.
 */
export function linhasDaConferenciaDaRota(
  tipo: TipoProduto,
  prefixo: string,
  brutas: readonly LinhaDaPlanilhaDeUnidades[],
  daRota: readonly LinhaDaRota[],
): LinhaConferida[] {
  const porLinha = new Map(daRota.map((l) => [l.linha, l]));

  return brutas.map((bruta, indice) => {
    const linha = indice + 2;
    const julgada = porLinha.get(linha);
    const codigoDaTela = codigoDaUnidade(prefixo, tipo, {
      apartamento: parte(bruta.apartamento),
      lote: parte(bruta.lote),
      quadra: parte(bruta.quadra),
      torre: parte(bruta.torre),
    });

    if (!julgada) {
      return {
        codigo: codigoDaTela,
        estado: "erro",
        linha,
        mensagens: [{ campo: "linha", motivo: "A conferência não trouxe esta linha de volta. Confira de novo.", soAviso: false }],
        rotulo: rotuloDaLinha(tipo, bruta),
      };
    }

    const mensagens = julgada.problemas.map((p) => ({ campo: p.campo, motivo: p.motivo, soAviso: Boolean(p.soAviso) }));
    const temErro = julgada.resultado === "erro" || mensagens.some((m) => !m.soAviso);
    return {
      codigo: julgada.codigo ?? codigoDaTela,
      estado: temErro ? "erro" : mensagens.length > 0 ? "aviso" : "ok",
      linha,
      mensagens,
      rotulo: julgada.rotulo ?? rotuloDaLinha(tipo, bruta),
    };
  });
}

const SEM_PERMISSAO_NAS_UNIDADES = "Seu acesso não permite cadastrar unidades neste produto.";
const UNIDADES_PENDENTES = "O cadastro de unidades deste produto ainda não está liberado. Tente de novo mais tarde.";

export type RespostaDaConferencia =
  | { bloqueioDaGravacao: null | string; linhas: LinhaDaRota[]; ok: true; unidadesHoje: null | number }
  | { mensagem: string; ok: false };

/** `POST {acao:"conferir"}`. Nada é gravado; a rota lê o que já existe no produto e na família. */
export function lerRespostaDaConferencia(status: number, corpo: unknown): RespostaDaConferencia {
  const raiz = objeto(corpo);
  const dados = objeto(raiz?.data);

  if (status >= 200 && status < 300 && dados && Array.isArray(dados.linhas)) {
    return {
      bloqueioDaGravacao: textoOuNulo(dados.bloqueioDaGravacao),
      linhas: linhasDaRotaDe(dados.linhas),
      ok: true,
      unidadesHoje: numeroOuNulo(dados.unidadesHoje),
    };
  }

  return {
    mensagem:
      textoOuNulo(raiz?.error) ??
      mensagemPadrao(status, "Não foi possível conferir a planilha agora.", SEM_PERMISSAO_NAS_UNIDADES, UNIDADES_PENDENTES),
    ok: false,
  };
}

export type RespostaDaImportacao =
  | { avisos: ProblemaDaLinhaDeUnidade[]; ok: true; unidades: UnidadeGravadaNaTela[] }
  | {
      /** Códigos que a gravação mandou e a releitura não achou (500): alguém precisa conferir. */
      faltando: string[];
      /** A conferência que a rota refez (422): a tabela volta a mostrar por que nada entrou. */
      linhas: LinhaDaRota[] | null;
      mensagem: string;
      ok: false;
    };

/**
 * `POST {acao:"importar"}`: a planilha inteira, tudo ou nada.
 *
 * ⚠️ 2XX SEM AS UNIDADES RELIDAS NÃO É SUCESSO. A prova do cadastro é o que o banco devolveu depois
 * do insert, e não o 200: sem ela, a tela manda conferir a lista antes de enviar de novo.
 */
export function lerRespostaDaImportacao(status: number, corpo: unknown): RespostaDaImportacao {
  const raiz = objeto(corpo);
  const dados = objeto(raiz?.data);

  if (status >= 200 && status < 300) {
    if (dados && Array.isArray(dados.unidades)) {
      const unidades = dados.unidades.map(unidadeGravadaDe).filter((u): u is UnidadeGravadaNaTela => u !== null);
      return { avisos: problemasDe(dados.avisos), ok: true, unidades };
    }
    return {
      faltando: [],
      linhas: null,
      mensagem: "O servidor respondeu sem confirmar as unidades. Confira a lista do produto antes de enviar de novo.",
      ok: false,
    };
  }

  const faltando = Array.isArray(dados?.faltando)
    ? dados.faltando.map((c) => textoOuNulo(c)).filter((c): c is string => c !== null)
    : [];

  return {
    faltando,
    linhas: dados && Array.isArray(dados.linhas) ? linhasDaRotaDe(dados.linhas) : null,
    mensagem:
      textoOuNulo(raiz?.error) ??
      mensagemPadrao(status, "Não foi possível gravar as unidades agora.", SEM_PERMISSAO_NAS_UNIDADES, UNIDADES_PENDENTES),
    ok: false,
  };
}

export type RespostaDaCriacao =
  | { avisos: ProblemaDaLinhaDeUnidade[]; ok: true; unidade: UnidadeGravadaNaTela }
  | { mensagem: null | string; ok: false; problemas: ProblemaDaLinhaDeUnidade[] };

/**
 * `POST {acao:"criar", unidade}`: uma unidade.
 *
 * O 409 (já existe) e o 422 (dado inválido) trazem a conferência da linha: os problemas vão para os
 * campos, e a mensagem geral fica nula para não repetir o mesmo motivo duas vezes. Sem conferência
 * (o 409 da corrida, 503), vale a mensagem.
 */
export function lerRespostaDaCriacao(status: number, corpo: unknown): RespostaDaCriacao {
  const raiz = objeto(corpo);
  const dados = objeto(raiz?.data);

  if (status >= 200 && status < 300) {
    const unidade = unidadeGravadaDe(dados?.unidade);
    if (unidade) return { avisos: problemasDe(dados?.avisos), ok: true, unidade };
    return {
      mensagem: "O servidor respondeu sem confirmar a unidade. Confira a lista do produto antes de cadastrar de novo.",
      ok: false,
      problemas: [],
    };
  }

  const problemas = dados && Array.isArray(dados.linhas) ? linhasDaRotaDe(dados.linhas).flatMap((l) => l.problemas) : [];
  const temErro = problemas.some((p) => !p.soAviso);

  return {
    mensagem: temErro
      ? null
      : (textoOuNulo(raiz?.error) ??
        mensagemPadrao(status, "Não foi possível cadastrar a unidade agora.", SEM_PERMISSAO_NAS_UNIDADES, UNIDADES_PENDENTES)),
    ok: false,
    problemas,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A CORREÇÃO DE UMA UNIDADE (preço, área e matrícula)
// ─────────────────────────────────────────────────────────────────────────────
//
// Decisão D2 do Lucas (16/09/2026): as unidades do produto que o portal opera (o Garden da Cecílio,
// inclusive as que vieram do C2X) têm preço, área e matrícula corrigidos pelo próprio time do
// incorporador. A ROTA é a mesma do cadastro (`{ acao: "atualizar", unidadeId, campos }`), e a regra
// (trava da venda viva, situação intocável) mora lá; aqui só o que a janela precisa.

/** Os três campos que a correção edita, como a pessoa os vê na janela. */
export type CamposDaEdicao = { area: string; matricula: string; preco: string };

const DUAS_CASAS = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** O número no formato que a pessoa digita ("182.000,00"), ou vazio quando não há número. */
function numeroParaCampo(valor: null | number): string {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? DUAS_CASAS.format(valor) : "";
}

/** Os campos da janela a partir da linha da tabela (`ApoloEnterpriseUnit`). */
export function camposDaEdicao(unidade: {
  area: null | number;
  price: null | number;
  registration: null | string;
}): CamposDaEdicao {
  return {
    area: numeroParaCampo(unidade.area),
    matricula: String(unidade.registration ?? "").trim(),
    preco: numeroParaCampo(unidade.price),
  };
}

/**
 * Só o que MUDOU vai no corpo.
 *
 * ⚠️ MANDAR O PREÇO QUE NÃO MUDOU TRAVARIA A MATRÍCULA. Preço e área travam com venda andando (a
 * rota responde 409); a matrícula não, porque ela costuma chegar justamente quando a venda já anda.
 * Com os três campos sempre no corpo, corrigir só a matrícula de um lote reservado daria "preço e
 * área ficam travados".
 */
export function mudancasDaEdicao(inicial: CamposDaEdicao, atual: CamposDaEdicao): Partial<CamposDaEdicao> {
  const mudancas: Partial<CamposDaEdicao> = {};
  for (const campo of ["area", "matricula", "preco"] as const) {
    if (atual[campo].trim() !== inicial[campo].trim()) mudancas[campo] = atual[campo].trim();
  }
  return mudancas;
}

export type RespostaDaAtualizacao =
  | { alterados: string[]; ok: true }
  | { erros: Partial<Record<keyof CamposDaEdicao, string>>; mensagem: string; ok: false };

const SEM_PERMISSAO_NA_EDICAO = "Seu acesso não permite corrigir unidades neste produto.";

/**
 * `POST {acao:"atualizar"}`, lida sem confiar no formato.
 *
 * O texto da rota vale como está (409 da venda andando, 422 do valor inválido ou da situação): foi
 * escrito para quem opera. O 422 de campo traz `data.erros`, que vai para baixo do campo.
 */
export function lerRespostaDaAtualizacao(status: number, corpo: unknown): RespostaDaAtualizacao {
  const raiz = objeto(corpo);
  const dados = objeto(raiz?.data);

  if (status >= 200 && status < 300 && dados) {
    const alterados = Array.isArray(dados.alterados)
      ? dados.alterados.filter((item): item is string => typeof item === "string")
      : [];
    return { alterados, ok: true };
  }

  const errosCrus = objeto(dados?.erros);
  const erros: Partial<Record<keyof CamposDaEdicao, string>> = {};
  for (const [campo, destino] of [
    ["area", "area"],
    ["areaPrivativa", "area"],
    ["matricula", "matricula"],
    ["preco", "preco"],
  ] as const) {
    const motivo = textoOuNulo(errosCrus?.[campo]);
    if (motivo && !erros[destino]) erros[destino] = motivo;
  }

  return {
    erros,
    mensagem:
      textoOuNulo(raiz?.error) ??
      mensagemPadrao(
        status,
        "Não foi possível corrigir a unidade agora.",
        SEM_PERMISSAO_NA_EDICAO,
        "Não foi possível corrigir a unidade agora. Tente de novo em instantes.",
      ),
    ok: false,
  };
}
