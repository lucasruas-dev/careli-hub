import { createHash } from "node:crypto";

import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  type DecisaoDaBaixa,
  lerBaixaDoHub,
  MOTIVO_FORA_DO_FINANCEIRO,
  SLUG_DO_GARDEN_NO_BOLETO,
} from "@/lib/lsoft/baixa-do-hub";
import { rotuloDoLoteNovo } from "@/lib/lsoft/lotes-do-garden";

// PAGAMENTOS A CONFERIR — o que a baixa do hub não resolveu sozinha, na tela do time.
//
// Lucas (30/09/2026): *"pode fazer a lista de pagamentos a conferir"*. De setembro em diante o
// boleto pago no Asaas dá baixa na parcela do Garden sozinho (`baixa-do-hub.ts`). O que ele não casa
// com segurança ia só para o log do servidor, que ninguém lê de rotina.
//
// ⚠️ A LISTA É CALCULADA NA HORA, PELA MESMA RÉGUA DA BAIXA (`lerBaixaDoHub`, que só lê). Não há
// cópia: uma tabela de pendências envelheceria no dia em que alguém baixasse a parcela na ficha, e
// duas réguas (a do cron e a da tela) acabariam dizendo coisas diferentes do mesmo boleto.
//
// ⚠️ A RÉGUA VALE PARA TODO CLIENTE DO LSOFT, MARCADO OU NÃO (revisão de 30/09/2026). A primeira
// versão jogava num grupo de "rotina" todo boleto de cliente que ainda está na integração, com a
// frase "a baixa é manual". Medido: 10 dos 22 já estavam pagos na ficha (não havia o que baixar), 4
// não tinham parcela daquele lote no mês e 1 era candidato a pagamento em dobro, escondido na rotina.
// Agora a lista pede à baixa a leitura de "todos" e classifica cada um pelo que a ficha diz.
//
// ⚠️ DOIS GRUPOS, E NÃO UM. "A conferir" é o que pede decisão (lote que não bate, parcela já baixada
// com outro valor, estorno, documento que não é de ninguém). "Na integração" é só o boleto pago com
// a parcela EM ABERTO na ficha de quem ainda não subiu para o Financeiro: falta alguém dar a baixa.
//
// ⚠️ O QUE SAI DA LISTA É O QUE ALGUÉM MARCOU COMO CONFERIDO (tabela `boletos_pagamentos_conferidos`,
// migration 0200), e só para AQUELE motivo: a cobrança conferida como "lote não bate" que depois é
// estornada volta a aparecer, já dizendo quem conferiu antes.
//
// ⚠️ NEM CPF NEM TEXTO DO LOG NA RESPOSTA. A tela recebe o nome e o código do cliente, a frase na
// língua do time e uma IMPRESSÃO do motivo (um hash curto). O CPF e a frase crua da baixa ("lote
// antigo 382", "série n/084") ficam no servidor.

/** Uma conferência já feita para uma cobrança (uma linha de `boletos_pagamentos_conferidos`). */
export type ConferenciaFeita = { chave: string; em: string; observacao: string; por: string };

/** Um pagamento na lista, como a TELA recebe. */
export type PagamentoAConferir = {
  clienteCodigo: null | string;
  clienteNome: null | string;
  cobrancaId: string;
  /** `AAAA-MM`. */
  competencia: string;
  /** A última vez em que esta cobrança foi conferida por OUTRO motivo (ela voltou à lista). */
  conferidoAntes: null | { em: string; observacao: string; por: string };
  /** Os números que explicam o motivo (valor da ficha contra o do boleto), quando há. */
  detalhe: null | string;
  /**
   * A impressão do motivo que a pessoa VIU. O botão "Conferido" a devolve, e o servidor recusa se o
   * motivo tiver mudado desde que a lista foi aberta.
   */
  impressao: string;
  /** O motivo na língua do time, sem jargão do banco. */
  motivo: string;
  /** `AAAA-MM-DD`. */
  pagoEm: null | string;
  /** "007/084", quando a baixa achou a parcela. */
  parcela: null | string;
  /** O lote novo do boleto: "Q12 L26". */
  unidade: string;
  valorPago: null | number;
};

/** O mesmo item, com a chave crua do motivo: só o servidor vê. */
type ItemDoServidor = PagamentoAConferir & { chave: string };

export type PagamentosAConferir = {
  /** O que pede decisão de alguém. */
  conferir: PagamentoAConferir[];
  /** Boleto pago com a parcela em aberto na ficha de quem ainda está na LSoft Integração. */
  integracao: PagamentoAConferir[];
};

type GruposDoServidor = { conferir: ItemDoServidor[]; integracao: ItemDoServidor[] };

const reais = (valor: number): string =>
  valor.toLocaleString("pt-BR", { currency: "BRL", minimumFractionDigits: 2, style: "currency" });

/** `2026-09-16...` -> `16/09/2026`. Recorte de texto: dia não tem fuso. */
function dia(iso: null | string | undefined): string {
  const d = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/**
 * A chave do motivo: a classe e o texto cru da decisão.
 *
 * ⚠️ É O TEXTO CRU, E NÃO O DA TELA, de propósito. O texto da tela junta vários casos numa frase
 * amigável; a chave precisa mudar quando o PROBLEMA muda (o valor da ficha foi corrigido, o estorno
 * chegou), para o item conferido reaparecer. Por isso as frases de `baixa-do-hub.ts` não podem ser
 * reescritas sem cuidado (há um aviso lá).
 */
export function chaveDoMotivo(decisao: Pick<DecisaoDaBaixa, "classe" | "motivo" | "observacao">): string {
  return `${decisao.classe}|${decisao.motivo ?? decisao.observacao ?? ""}`;
}

/** A impressão da chave: o que vai para a tela no lugar do texto cru. */
export function impressaoDaChave(chave: string): string {
  return createHash("sha256").update(chave).digest("hex").slice(0, 16);
}

/**
 * O motivo na língua do time, para a decisão que pede olho humano.
 *
 * ⚠️ AS FRASES DE `baixa-do-hub.ts` FALAM COM QUEM LÊ O LOG ("lote antigo 382", "série n/084", "CPF do
 * boleto"). Na tela do loteador isso é jargão, e "lote antigo" expõe a numeração interna do LSoft.
 * Cada frase de lá tem uma daqui; a que não for reconhecida cai numa frase genérica, e nunca no
 * texto cru.
 */
export function motivoParaOTime(
  decisao: Pick<DecisaoDaBaixa, "classe" | "motivo" | "observacao" | "pagoEm" | "parcela" | "valorPago">,
): { detalhe: null | string; motivo: string } {
  if (decisao.classe === "ja_paga") {
    const partes: string[] = [];
    if (decisao.parcela) {
      const quando = dia(decisao.parcela.dataRecebido);
      partes.push(`Na ficha: ${reais(decisao.parcela.valorRecebido)}${quando ? ` em ${quando}` : ""}.`);
    }
    if (decisao.valorPago !== null) {
      const quando = dia(decisao.pagoEm);
      partes.push(`Neste boleto: ${reais(decisao.valorPago)}${quando ? ` em ${quando}` : ""}.`);
    }
    // ⚠️ A PARCELA DE DOIS LOTES TEM UM BOLETO POR LOTE. A régua compara a ficha com a SOMA dos
    // boletos; mostrar a ficha inteira contra um boleto só faria parecer que entrou o dobro.
    if (/Parcela de \d+ lotes/.test(decisao.observacao ?? "")) {
      partes.push("A parcela cobre mais de um lote, com um boleto por lote: compare com a soma deles.");
    }
    return {
      detalhe: partes.length > 0 ? partes.join(" ") : null,
      motivo:
        "A parcela já estava baixada na ficha com outro valor. Confira se é o mesmo pagamento ou um pagamento em dobro.",
    };
  }

  const cru = decisao.motivo ?? "";
  const frase = (motivo: string) => ({ detalhe: null, motivo });

  if (cru === MOTIVO_FORA_DO_FINANCEIRO) {
    return frase("O documento deste boleto não é de nenhum cliente do LSoft. Confira de quem é o boleto.");
  }
  if (cru.startsWith("O Asaas desfez este pagamento")) {
    return frase("O pagamento foi desfeito no Asaas. Veja se a parcela está baixada na ficha e precisa ser reaberta.");
  }
  if (cru.startsWith("Pagamento sem valor ou sem data")) {
    return frase("O boleto consta como pago, mas sem valor ou sem data. Confira no Asaas.");
  }
  if (cru.startsWith("Unidade do boleto ilegível")) {
    return frase("Não deu para ler o lote deste boleto.");
  }
  // ⚠️ ANTES DO "fora do mapa" do lote do boleto: aqui o lote do boleto casou, e quem não tem
  // correspondência é o OUTRO lote que a mesma parcela cobre.
  if (cru.startsWith("A parcela cobre o lote")) {
    return frase("A parcela cobre outro lote, que não tem correspondência com os lotes dos boletos.");
  }
  if (cru.startsWith("Lote ") && cru.includes("fora do mapa")) {
    return frase("O lote deste boleto não tem correspondência com os lotes do LSoft.");
  }
  if (cru.startsWith("Sem CPF para")) {
    return frase("O lote deste boleto está sem documento no cadastro de boletos.");
  }
  if (cru.includes("tem mais de um CPF")) {
    return frase("O lote deste boleto tem mais de um documento no cadastro de boletos.");
  }
  if (cru.startsWith("Nenhuma parcela do lote")) {
    return frase(
      "Não há parcela deste lote vencendo neste mês na ficha do cliente. O lote do boleto pode não ser o mesmo das parcelas.",
    );
  }
  if (cru.startsWith("Nenhuma parcela da série") || cru.startsWith("O boleto não diz a série")) {
    return frase("Não há na ficha a parcela que este boleto cobra neste mês.");
  }
  if (cru.includes("parcelas da mesma série")) {
    return frase("Há mais de uma parcela deste lote vencendo no mês. Não dá para saber qual o boleto pagou.");
  }
  if (cru.includes("cobranças pagas para o mesmo lote")) {
    return frase("Há mais de um boleto pago para este lote no mesmo mês. Pode ser pagamento em dobro.");
  }
  if (cru.startsWith("Boletos de CPFs diferentes")) {
    return frase("Boletos de pessoas diferentes apontam para a mesma parcela.");
  }
  if (cru.includes("está em outro CPF")) {
    return frase("A parcela cobre mais de um lote, e um deles é cobrado de outra pessoa.");
  }
  if (cru.includes("ainda não está pago")) {
    return frase(
      "A parcela cobre dois lotes, e o boleto do outro lote ainda não foi pago. A baixa entra quando os dois estiverem pagos.",
    );
  }
  if (cru.startsWith("Esta cobrança já deu baixa em outra parcela")) {
    return frase("Este boleto já deu baixa em outra parcela.");
  }
  if (cru.startsWith("Outra cobrança já deu baixa nesta parcela")) {
    return frase("Outro boleto já deu baixa nesta parcela. Pode ser pagamento em dobro ou lote trocado.");
  }
  if (cru.startsWith("O hub já tinha dado baixa nesta parcela")) {
    return frase("A parcela foi baixada pelo hub e depois reaberta. O hub não baixa de novo sozinho.");
  }
  return frase("O hub não conseguiu dar baixa neste boleto sozinho. Confira a ficha do cliente.");
}

/** Um cliente do LSoft, só com o que a tela mostra. */
export type ClienteDaLista = { codigo: string; nome: string };

const soDigitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/**
 * O dono de cada lote do boleto, pelo documento do cadastro de boletos.
 *
 * ⚠️ SÓ QUANDO É UM SÓ: lote com dois documentos, ou documento de dois clientes, fica sem dono. Um
 * nome errado aqui levaria alguém a abrir a ficha de outra pessoa e baixar a parcela dela. Cliente
 * sem documento no LSoft nunca é dono por aqui.
 */
export function donosDosLotes(entrada: {
  clientes: readonly { codigo: string; cpf: null | string; nome: string }[];
  documentos: readonly { documento: string; unidade: string }[];
}): Map<string, ClienteDaLista> {
  const clientePorCodigo = new Map<string, ClienteDaLista>();
  const codigosPorCpf = new Map<string, Set<string>>();
  for (const cliente of entrada.clientes) {
    if (!cliente.codigo) continue;
    clientePorCodigo.set(cliente.codigo, { codigo: cliente.codigo, nome: cliente.nome });
    const cpf = soDigitos(cliente.cpf);
    if (!cpf) continue;
    const lista = codigosPorCpf.get(cpf) ?? new Set<string>();
    lista.add(cliente.codigo);
    codigosPorCpf.set(cpf, lista);
  }

  const documentosPorUnidade = new Map<string, Set<string>>();
  for (const doc of entrada.documentos) {
    const unidade = rotuloDoLoteNovo(doc.unidade);
    const documento = soDigitos(doc.documento);
    if (!unidade || !documento) continue;
    const lista = documentosPorUnidade.get(unidade) ?? new Set<string>();
    lista.add(documento);
    documentosPorUnidade.set(unidade, lista);
  }

  const donos = new Map<string, ClienteDaLista>();
  for (const [unidade, docs] of documentosPorUnidade) {
    if (docs.size !== 1) continue;
    const codigos = codigosPorCpf.get([...docs][0] ?? "");
    if (!codigos || codigos.size !== 1) continue;
    const cliente = clientePorCodigo.get([...codigos][0] ?? "");
    if (cliente) donos.set(unidade, cliente);
  }
  return donos;
}

/**
 * Monta os dois grupos a partir das decisões da baixa lidas para TODOS os clientes do LSoft.
 *
 * O que cada decisão vira:
 *   • `baixa_nova` de cliente no Financeiro: nada (o hub baixa na próxima rodada);
 *   • `baixa_nova` de cliente ainda na integração: o grupo "na integração" (boleto pago, parcela em
 *     aberto na ficha, falta a baixa manual);
 *   • `ja_paga` com o mesmo valor: nada; com outro valor: "a conferir";
 *   • `conferir`: "a conferir", com a frase do time.
 *
 * @param conferidos cobrança -> as conferências já feitas para ela (por qualquer motivo).
 * @param fichasDoLote lote antigo -> códigos dos clientes que têm parcela naquele lote.
 */
export function montarPagamentosAConferir(entrada: {
  clientePorCodigo: ReadonlyMap<string, ClienteDaLista>;
  clientePorUnidade: ReadonlyMap<string, ClienteDaLista>;
  conferidos: ReadonlyMap<string, readonly ConferenciaFeita[]>;
  decisoes: readonly DecisaoDaBaixa[];
  fichasDoLote?: Readonly<Record<string, readonly string[]>>;
  noFinanceiro: ReadonlySet<string>;
}): GruposDoServidor {
  const conferir: ItemDoServidor[] = [];
  const integracao: ItemDoServidor[] = [];

  for (const decisao of entrada.decisoes) {
    const marcado = decisao.clienteCodigo !== null && entrada.noFinanceiro.has(decisao.clienteCodigo);
    if (decisao.classe === "baixa_nova" && marcado) continue;
    if (decisao.classe === "ja_paga" && !decisao.aviso) continue;

    const chave = chaveDoMotivo(decisao);
    const feitas = entrada.conferidos.get(decisao.cobrancaId) ?? [];
    // Conferido COM O MESMO MOTIVO sai. Motivo novo para a mesma cobrança reaparece.
    if (feitas.some((feita) => feita.chave === chave)) continue;
    const anterior = [...feitas].sort((a, b) => b.em.localeCompare(a.em))[0] ?? null;

    const unidade = rotuloDoLoteNovo(decisao.unidade) ?? decisao.unidade;
    let cliente =
      (decisao.clienteCodigo ? entrada.clientePorCodigo.get(decisao.clienteCodigo) : undefined) ??
      entrada.clientePorUnidade.get(unidade) ??
      null;

    let detalhe: null | string;
    let motivo: string;
    const naIntegracao = decisao.classe === "baixa_nova";
    if (naIntegracao) {
      motivo = "Boleto pago, e a parcela está em aberto na ficha. Falta dar a baixa.";
      detalhe = "Lance a baixa com o valor e a data deste boleto.";
    } else {
      ({ detalhe, motivo } = motivoParaOTime(decisao));
      // ⚠️ O DOCUMENTO NÃO É DE NINGUÉM, MAS O LOTE PODE TER FICHA (medido em 30/09/2026: em 3 de 4
      // casos). A lista aponta a ficha que tem as parcelas do lote SEM dizer que ela é a pagadora:
      // quem decide isso é quem confere. Só quando o lote é de UM cliente.
      if (decisao.motivo === MOTIVO_FORA_DO_FINANCEIRO && !cliente && decisao.loteAntigo) {
        const fichas = entrada.fichasDoLote?.[decisao.loteAntigo] ?? [];
        const daFicha = fichas.length === 1 ? entrada.clientePorCodigo.get(fichas[0] ?? "") : undefined;
        if (daFicha) {
          cliente = daFicha;
          detalhe = "No LSoft, as parcelas deste lote estão na ficha ao lado. Confira se o boleto é dela.";
        }
      }
    }

    const item: ItemDoServidor = {
      chave,
      clienteCodigo: cliente?.codigo ?? decisao.clienteCodigo ?? null,
      clienteNome: cliente?.nome ?? null,
      cobrancaId: decisao.cobrancaId,
      competencia: decisao.competencia,
      conferidoAntes: anterior ? { em: anterior.em, observacao: anterior.observacao, por: anterior.por } : null,
      detalhe,
      impressao: impressaoDaChave(chave),
      motivo,
      pagoEm: decisao.pagoEm ? String(decisao.pagoEm).slice(0, 10) : null,
      parcela: decisao.parcela?.rotulo ?? null,
      unidade,
      valorPago: decisao.valorPago,
    };
    (naIntegracao ? integracao : conferir).push(item);
  }

  // Mais recente primeiro; dentro do mês, por lote. Quem abre a lista quer ver o que chegou agora.
  const ordem = (a: ItemDoServidor, b: ItemDoServidor) =>
    b.competencia.localeCompare(a.competencia) ||
    a.unidade.localeCompare(b.unidade) ||
    a.cobrancaId.localeCompare(b.cobrancaId);
  conferir.sort(ordem);
  integracao.sort(ordem);
  return { conferir, integracao };
}

/** Tira a chave crua antes de o item sair do servidor. */
export function paraATela(item: PagamentoAConferir & { chave?: string }): PagamentoAConferir {
  const { chave: _chave, ...publico } = item;
  void _chave;
  return publico;
}

// ── A LEITURA ───────────────────────────────────────────────────────────────

type ErroDoBanco = { code?: null | string; message?: null | string };

/** O nome da tabela da migration 0200. */
export const TABELA_DE_CONFERIDOS = "boletos_pagamentos_conferidos";

/**
 * A tabela 0200 ainda não existe? Antes da migration, a lista funciona (ninguém conferido) e só o
 * botão "Conferido" responde que ainda não está disponível.
 */
export function tabelaDeConferidosAusente(erro: ErroDoBanco | null | undefined): boolean {
  if (!erro) return false;
  const mensagem = String(erro.message ?? "");
  if (erro.code === "42P01" || erro.code === "PGRST205") return true;
  return mensagem.includes(TABELA_DE_CONFERIDOS) && /does not exist|não existe|schema cache/i.test(mensagem);
}

const PAGINA = 1000;

type Linha = Record<string, unknown>;
type Resposta = { data: null | unknown[]; error: ErroDoBanco | null };

/**
 * Lê uma tabela inteira em páginas, com ordem fixa.
 *
 * ⚠️ O PostgREST corta em 1.000 linhas SEM ERRO, e paginar sem `order` repete uma linha e pula outra
 * com o total batendo (medido em 24/09/2026). A `consulta` recebida já vem ordenada pela chave.
 */
async function lerEmPaginas(
  consulta: (de: number, ate: number) => PromiseLike<Resposta>,
  chave: (linha: Linha) => string,
): Promise<{ erro: ErroDoBanco | null; linhas: Linha[] }> {
  const linhas: Linha[] = [];
  const vistas = new Set<string>();
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) return { erro: error, linhas: [] };
    const bloco = (data ?? []) as Linha[];
    for (const linha of bloco) {
      const id = chave(linha);
      if (vistas.has(id)) continue;
      vistas.add(id);
      linhas.push(linha);
    }
    if (bloco.length < PAGINA) break;
  }
  return { erro: null, linhas };
}

type LeituraDoServidor =
  | { erro: string; ok: false }
  | { conferidoIndisponivel: boolean; grupos: GruposDoServidor; ok: true };

export type LeituraDosPagamentosAConferir =
  | { erro: string; ok: false }
  | {
      /** `true` = a migration 0200 ainda não rodou: a lista vem inteira e o "Conferido" não grava. */
      conferidoIndisponivel: boolean;
      grupos: PagamentosAConferir;
      ok: true;
    };

/**
 * A lista de hoje, com a chave crua de cada item. SÓ LÊ, e só o servidor usa.
 *
 * ⚠️ TUDO OU NADA nas leituras que decidem a lista: com metade dos clientes ou das parcelas, um
 * pagamento bom apareceria como problema. A exceção é a tabela de conferidos ainda não existir.
 */
async function lerNoServidor(): Promise<LeituraDoServidor> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  let leitura: Awaited<ReturnType<typeof lerBaixaDoHub>>;
  try {
    // "todos": a mesma régua para quem está no Financeiro e para quem ainda está na integração.
    leitura = await lerBaixaDoHub({ admin, clientes: "todos", todosOsDesfeitos: true });
  } catch (falha) {
    return { erro: falha instanceof Error ? falha.message : "Falha ao ler os pagamentos.", ok: false };
  }
  const decisoes = leitura.resultado.decisoes;
  if (decisoes.length === 0) {
    return { conferidoIndisponivel: false, grupos: { conferir: [], integracao: [] }, ok: true };
  }

  const [clientes, documentos, conferidos] = await Promise.all([
    lerEmPaginas(
      (de, ate) => admin.from("lsoft_clientes").select("codigo, nome, cpf").order("codigo").range(de, ate),
      (linha) => String(linha.codigo ?? ""),
    ),
    lerEmPaginas(
      (de, ate) =>
        admin
          .from("boletos_documentos")
          .select("id, documento, unidade")
          .eq("workspace_id", "careli")
          .eq("empreendimento", SLUG_DO_GARDEN_NO_BOLETO)
          .order("id")
          .range(de, ate),
      (linha) => String(linha.id ?? ""),
    ),
    lerEmPaginas(
      (de, ate) =>
        admin
          .from(TABELA_DE_CONFERIDOS)
          .select("cobranca_id, motivo, observacao, conferido_por, conferido_em")
          .eq("workspace_id", "careli")
          .eq("empreendimento", SLUG_DO_GARDEN_NO_BOLETO)
          .order("cobranca_id")
          .order("motivo")
          .range(de, ate),
      (linha) => `${String(linha.cobranca_id ?? "")}|${String(linha.motivo ?? "")}`,
    ),
  ]);

  if (clientes.erro) return { erro: clientes.erro.message ?? "Falha ao ler os clientes.", ok: false };
  if (documentos.erro) return { erro: documentos.erro.message ?? "Falha ao ler o cadastro de boletos.", ok: false };
  const conferidoIndisponivel = tabelaDeConferidosAusente(conferidos.erro);
  if (conferidos.erro && !conferidoIndisponivel) {
    return { erro: conferidos.erro.message ?? "Falha ao ler os pagamentos conferidos.", ok: false };
  }

  const doLsoft = clientes.linhas.map((linha) => ({
    codigo: String(linha.codigo ?? ""),
    cpf: linha.cpf === null || linha.cpf === undefined ? null : String(linha.cpf),
    nome: String(linha.nome ?? ""),
  }));
  const clientePorCodigo = new Map<string, ClienteDaLista>(
    doLsoft.filter((c) => c.codigo).map((c) => [c.codigo, { codigo: c.codigo, nome: c.nome }]),
  );

  const conferidosPorCobranca = new Map<string, ConferenciaFeita[]>();
  for (const linha of conferidos.linhas) {
    const cobranca = String(linha.cobranca_id ?? "");
    const lista = conferidosPorCobranca.get(cobranca) ?? [];
    lista.push({
      chave: String(linha.motivo ?? ""),
      em: String(linha.conferido_em ?? ""),
      observacao: String(linha.observacao ?? ""),
      por: String(linha.conferido_por ?? ""),
    });
    conferidosPorCobranca.set(cobranca, lista);
  }

  return {
    conferidoIndisponivel,
    grupos: montarPagamentosAConferir({
      clientePorCodigo,
      clientePorUnidade: donosDosLotes({
        clientes: doLsoft,
        documentos: documentos.linhas.map((linha) => ({
          documento: String(linha.documento ?? ""),
          unidade: String(linha.unidade ?? ""),
        })),
      }),
      conferidos: conferidosPorCobranca,
      decisoes,
      fichasDoLote: leitura.fichasDoLote,
      noFinanceiro: new Set(leitura.noFinanceiro),
    }),
    ok: true,
  };
}

/** A lista de hoje, como a tela recebe (sem a chave crua). SÓ LÊ. */
export async function lerPagamentosAConferir(): Promise<LeituraDosPagamentosAConferir> {
  const leitura = await lerNoServidor();
  if (!leitura.ok) return leitura;
  return {
    conferidoIndisponivel: leitura.conferidoIndisponivel,
    grupos: {
      conferir: leitura.grupos.conferir.map(paraATela),
      integracao: leitura.grupos.integracao.map(paraATela),
    },
    ok: true,
  };
}

// ── A CONFERÊNCIA ───────────────────────────────────────────────────────────

/** Entre 3 e 500 caracteres: o bastante para dizer o que foi feito, sem virar ata. */
export const OBSERVACAO_MINIMA = 3;
export const OBSERVACAO_MAXIMA = 500;

/** A observação limpa, ou nulo quando não serve. Caractere de controle vira espaço. */
export function observacaoValida(valor: unknown): null | string {
  if (typeof valor !== "string") return null;
  const limpa = [...valor]
    .map((caractere) => ((caractere.codePointAt(0) ?? 0) < 32 ? " " : caractere))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (limpa.length < OBSERVACAO_MINIMA || limpa.length > OBSERVACAO_MAXIMA) return null;
  return limpa;
}

export type ResultadoDaConferencia =
  | { erro: string; ok: false; status: 400 | 404 | 409 | 503 }
  | { ok: true };

/**
 * Marca um pagamento da lista como conferido.
 *
 * ⚠️ SÓ O QUE ESTÁ NA LISTA AGORA PODE SER CONFERIDO. A cobrança vem do navegador; sem conferir
 * contra a lista viva, alguém marcaria uma cobrança de outro empreendimento, ou uma que nem é
 * problema, e ela nunca mais apareceria. O motivo gravado também sai da lista, e não do pedido.
 *
 * ⚠️ E SÓ O MOTIVO QUE A PESSOA VIU (revisão de 30/09/2026). A aba pode ficar aberta por horas; se o
 * problema mudou nesse meio tempo (chegou um estorno, o cliente subiu para o Financeiro), a impressão
 * que a tela manda não bate mais com a da lista viva, e a resposta é 409: a tela relê e mostra o
 * problema novo, em vez de ele ser conferido sem nunca ter aparecido para ninguém.
 *
 * ⚠️ QUEM CONFERIU VEM DE QUEM CHAMA A FUNÇÃO (a rota, pela sessão), nunca do corpo do pedido.
 */
export async function marcarPagamentoConferido(entrada: {
  autor: string;
  cobrancaId: string;
  impressao: string;
  observacao: string;
  origem: "careli" | "incorporador";
}): Promise<ResultadoDaConferencia> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false, status: 503 };

  const lista = await lerNoServidor();
  if (!lista.ok) return { erro: "Não foi possível ler a lista agora.", ok: false, status: 503 };
  if (lista.conferidoIndisponivel) {
    return { erro: "A conferência ainda não está disponível.", ok: false, status: 503 };
  }

  const item = [...lista.grupos.conferir, ...lista.grupos.integracao].find(
    (pagamento) => pagamento.cobrancaId === entrada.cobrancaId,
  );
  if (!item) return { erro: "Este pagamento não está mais na lista.", ok: false, status: 404 };
  if (item.impressao !== entrada.impressao) {
    return { erro: "Este pagamento mudou desde que a lista foi aberta. Confira de novo.", ok: false, status: 409 };
  }

  // ⚠️ `insert`, E NÃO `upsert`: cada conferência é uma linha própria (chave = cobrança + motivo), e
  // a segunda conferência da mesma cobrança, por outro motivo, não apaga quem fez a primeira. Todas
  // as colunas NOT NULL vão preenchidas.
  const { error } = await admin.from(TABELA_DE_CONFERIDOS).insert({
    cobranca_id: item.cobrancaId,
    conferido_origem: entrada.origem,
    conferido_por: entrada.autor,
    empreendimento: SLUG_DO_GARDEN_NO_BOLETO,
    motivo: item.chave,
    observacao: entrada.observacao,
    workspace_id: "careli",
  });
  if (error) {
    // 23505 = duas pessoas conferiram a mesma linha ao mesmo tempo: a primeira gravou, e para a
    // segunda o resultado é o mesmo (o item saiu da lista).
    if (error.code === "23505") return { ok: true };
    console.error("[lsoft][pagamentos-a-conferir] falha ao gravar a conferência", item.cobrancaId, error.message);
    return { erro: "Não foi possível gravar a conferência agora.", ok: false, status: 503 };
  }
  return { ok: true };
}
