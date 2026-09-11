// ONDE O CONTRATO GERADO MORA — a leitura e a escrita, num lugar só.
//
// ⚠️ ELE MORA EM `hercules_documentos`, E NÃO NUMA TABELA NOVA DA TÊMIS. Foram consideradas as duas
// gavetas que já existem:
//
//   (a) o storage da Têmis (`upload-midia.ts`, prefixo `temis-minutas/<minutaId>/`) guarda MÍDIA DA
//       MINUTA — a logo do loteador, a planta, o anexo referenciado no texto. A chave dele é a
//       MINUTA. Um contrato assinado por João, arquivado debaixo do modelo que o gerou, fica na
//       gaveta do formulário e não na do comprador: para achar o contrato de João seria preciso
//       saber antes qual minuta estava publicada naquele dia.
//
//   (b) `hercules_documentos` guarda o que circula NAQUELA VENDA, agrupado por `protocolo_numero`
//       (o COD). É a gaveta certa por quatro fatos, não por gosto:
//         1. a 0136 foi escrita com este arquivo em mente — Lucas, 06/09/2026: *"a proposta, bem
//            como o contrato, boletos também podem ser guardados nessa aba de documentos"*;
//         2. `NOME_DO_TIPO_DE_DOCUMENTO` e `GERADO_PELO_SISTEMA` já carregam "contrato": a aba
//            desenha o selo verde de "vale como prova" sem uma linha de código nova;
//         3. ela já tem DOIS leitores ligados — a aba Documentos da venda e a ficha do cliente no
//            Apolo (`lerDocumentosDaVenda`) —, então "o contrato existe no Apolo" sai de graça.
//            Uma tabela nova nasceria com zero leitores e a mesma promessa por cumprir;
//         4. o elo com a Têmis JÁ EXISTE nas duas pontas: `temis_trabalhos.proposta_id` e
//            `hercules_documentos.proposta_id`. O card acha o arquivo sem coluna nova e sem
//            migration — que é o teste de "a gaveta certa" nesta casa.
//
// ⚠️ E NADA DE `apolo_documents`. A 0136 já mediu os três motivos (entity_id NOT NULL antes de a
// entidade existir; o DELETE daquela rota roda com autorização de LEITURA e apaga arquivo e linha;
// o visualizador da esteira monta uma aba por documento sem filtrar tipo, pondo o contrato no meio
// do RG na tela em que se aprova a CAD). Uma linha só, dois leitores.
//
// ⚠️ ESTE ARQUIVO NÃO IMPORTA O CHROMIUM, e isso é deliberado. Quem lê a lista para o board da
// Têmis (`trabalhos-db.ts`) importa daqui; se a geração do PDF morasse junto, o
// `@sparticuz/chromium` — 66 MB — entraria no bundle de TODA função que mostra o board. Os bytes
// chegam prontos de quem chamou.

import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { hashIdentifier } from "@/lib/apolo/server";
import {
  nomeSeguroDeArquivo,
  prefixoDaUnidade,
} from "@/lib/hercules/documentos-da-venda";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ContratoJaGuardado,
  type IdentidadeDoContrato,
  TIPO_CONTRATO,
  nomeDoContrato,
  proximaVersao,
  textoDaSubstituicao,
  versaoDoNome,
} from "./contrato-guardado";

const WORKSPACE = "careli";

/** Quanto tempo o link de leitura vale. Curto: é para abrir agora, não para colar num e-mail. */
export const VALIDADE_DO_LINK_SEGUNDOS = 60 * 10;

const CAMPOS = "id, nome, criado_em, observacao, proposta_id";

type LinhaDeContrato = {
  criado_em: string;
  id: string;
  nome: string;
  observacao: null | string;
  proposta_id: null | string;
};

export type ContratoNoCard = ContratoJaGuardado & {
  /** `null` quando o nome não carrega versão (linha anterior a esta regra). */
  versao: null | number;
};

function mapear(linha: LinhaDeContrato): ContratoNoCard {
  return {
    criadoEm: linha.criado_em,
    id: linha.id,
    nome: linha.nome,
    observacao: linha.observacao,
    versao: versaoDoNome(linha.nome),
  };
}

/**
 * Os contratos gerados de várias propostas, agrupados por proposta.
 *
 * ⚠️ É POR ISTO QUE O CARD DA TÊMIS SABE QUE O DOCUMENTO EXISTE. `temis_trabalhos.proposta_id` é a
 * única chave que liga o board ao que foi gerado — `venda_id` aponta para `hercules_vendas`, que
 * tem zero linhas (ver a nota de `NovoTrabalho`), e por isso não serve de elo.
 *
 * ⚠️ LISTA VAZIA NÃO CONSULTA. Um board sem nenhum card com proposta (é o caso dos quatro cards
 * antigos do Garden e da Lavra) faria um `.in()` com lista vazia — que no PostgREST devolve tudo em
 * algumas versões de filtro montado à mão. Aqui a saída é antes.
 *
 * ⚠️ LOTE DE 100 no `.in()`: a URL do PostgREST estoura com lista grande, e é a régua da casa.
 */
export async function contratosDasPropostas(
  sb: SupabaseClient,
  propostaIds: readonly string[],
): Promise<Map<string, ContratoNoCard[]>> {
  const porProposta = new Map<string, ContratoNoCard[]>();
  const ids = [...new Set(propostaIds.filter((id) => Boolean(id)))];
  if (ids.length === 0) return porProposta;

  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const { data, error } = await sb
      .from("hercules_documentos")
      .select(CAMPOS)
      .eq("workspace_id", WORKSPACE)
      .eq("tipo", TIPO_CONTRATO)
      .in("proposta_id", lote)
      .is("removido_em", null)
      .order("criado_em", { ascending: false })
      .limit(500);

    // ⚠️ FALHA AQUI NÃO DERRUBA O BOARD. O card continua servindo para tocar o trabalho mesmo sem
    // saber do arquivo; um board em branco por causa de uma consulta acessória seria uma troca
    // ruim. Mas vai para o log — a lição de `trabalhosDoBoard`, que passou uma tarde inteira
    // devolvendo vazio em silêncio.
    if (error) {
      console.error("[temis][contrato] falha ao ler os contratos gerados", error);
      continue;
    }

    for (const linha of (data ?? []) as LinhaDeContrato[]) {
      if (!linha.proposta_id) continue;
      const lista = porProposta.get(linha.proposta_id) ?? [];
      lista.push(mapear(linha));
      porProposta.set(linha.proposta_id, lista);
    }
  }

  return porProposta;
}

/** Os contratos já gerados de UMA proposta, do mais novo para o mais antigo. */
export async function contratosDaProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<ContratoNoCard[]> {
  return (await contratosDasPropostas(sb, [propostaId])).get(propostaId) ?? [];
}

// ── GUARDAR ─────────────────────────────────────────────────────────────────

export type PedidoDeGuarda = {
  /**
   * O nome de quem alterou o contrato à mão antes desta geração, quando houve alteração.
   *
   * ⚠️ ISTO VAI PARA A OBSERVAÇÃO, e não é detalhe: os dois leitores da gaveta (a aba Documentos
   * da venda e a ficha do cliente no Apolo) mostram o PDF com selo de "gerado pelo sistema". Um
   * contrato com cláusula reescrita à mão exibido com o mesmo selo, sem uma palavra, faz o selo
   * prometer mais do que ele sabe — e a pergunta "este texto é o da minuta?" fica sem resposta
   * justamente para quem não estava na sala.
   */
  alteradoAMaoPor?: null | string;
  /** Empreendimento, unidade e titular — o nome do arquivo sai daqui. Vem de `ContratoMontado`. */
  identidade: IdentidadeDoContrato;
  geradoPor?: null | string;
  geradoPorNome?: null | string;
  /** Os bytes do PDF, já prontos. */
  pdf: Uint8Array;
  propostaId: string;
};

export type ContratoGuardado = {
  documentoId: string;
  nome: string;
  ok: true;
  protocolo: null | number;
  tamanhoBytes: number;
  versao: number;
};

export type FalhaAoGuardar = { erro: string; ok: false; status: 409 | 503 };

/**
 * Grava o PDF no bucket e registra a linha.
 *
 * ⚠️ A PASTA É A DA UNIDADE (`prefixoDaUnidade`), a MESMA do upload manual — de propósito. A
 * conferência de posse que o portal faz ao abrir um documento (`caminhoDaUnidadeValido`) só aceita
 * caminho dentro dessa pasta; um contrato numa pasta própria seria invisível para aquela rota e
 * abriria em 404 na aba onde o coordenador o procura.
 *
 * ⚠️ E O PROTOCOLO É LIDO AGORA, não na montagem: entre uma coisa e outra a proposta pode ter
 * ganhado COD, e é o protocolo DESTE instante que agrupa o documento na aba.
 */
export async function guardarContrato(
  sb: SupabaseClient,
  pedido: PedidoDeGuarda,
): Promise<ContratoGuardado | FalhaAoGuardar> {
  const proposta = await lerProposta(sb, pedido.propostaId);
  if (!proposta) {
    return { erro: "Proposta não encontrada.", ok: false, status: 409 };
  }
  if (!proposta.unidade_id) {
    // ⚠️ SEM UNIDADE NÃO HÁ ONDE ARQUIVAR. `hercules_documentos.unidade_id` é NOT NULL, e a pasta
    // do bucket é a da unidade: sem ela o insert violaria a constraint e o operador leria um erro
    // de banco. A frase diz o que fazer.
    return {
      erro: "Esta proposta não aponta para nenhuma unidade, e o contrato é arquivado na pasta da unidade. Corrija a proposta e gere de novo.",
      ok: false,
      status: 409,
    };
  }

  // ⚠️ A VERSÃO É LIDA AQUI E NÃO HÁ TRAVA, e isso está declarado em vez de escondido. Dois cliques
  // simultâneos na MESMA proposta calculariam a mesma versão e gravariam dois arquivos "v1" —
  // nenhum dado se perde, mas o número deixa de ser único. Não vale um lock: a geração leva
  // segundos, o botão da tela fica desabilitado enquanto roda, e `contratoVigente` desempata pela
  // data (e pela versão) de qualquer forma. Se um dia duas pessoas emitirem o mesmo contrato ao
  // mesmo tempo de verdade, o lugar de resolver é uma unique em (proposta_id, nome) — migration,
  // não código.
  const anteriores = await contratosDaProposta(sb, pedido.propostaId);
  const versao = proximaVersao(anteriores);
  const agora = new Date();
  const nome = nomeDoContrato(pedido.identidade, versao, agora);

  const caminho = `${prefixoDaUnidade(proposta.unidade_id)}${crypto.randomUUID()}-${nomeSeguroDeArquivo(nome)}`;

  const enviado = await sb.storage
    .from(APOLO_DOCS_BUCKET)
    .upload(caminho, pedido.pdf, { contentType: "application/pdf", upsert: false });

  if (enviado.error) {
    console.error("[temis][contrato] falha ao gravar o PDF no bucket", enviado.error);
    return { erro: "Não foi possível guardar o arquivo do contrato.", ok: false, status: 503 };
  }

  const { data: criado, error } = await sb
    .from("hercules_documentos")
    .insert({
      caminho,
      cliente_documento_hash: hashDoCpf(proposta.cliente_documento),
      cliente_entity_id: proposta.cliente_entity_id,
      empreendimento_codigo: proposta.empreendimento_codigo,
      enviado_por: pedido.geradoPor ?? null,
      enviado_por_nome: pedido.geradoPorNome ?? null,
      mime: "application/pdf",
      nome,
      // ⚠️ A OBSERVAÇÃO DIZ DE ONDE O PAPEL VEIO. Ela é o único campo livre que os dois leitores já
      // mostram, e sem ela um PDF na aba não se distingue de um que alguém subiu à mão.
      observacao: pedido.alteradoAMaoPor
        ? `Gerado pelo Panteon (versão ${versao}) a partir da minuta publicada COM ALTERAÇÃO MANUAL de ${pedido.alteradoAMaoPor}.`
        : `Gerado pelo Panteon a partir da minuta publicada (versão ${versao}).`,
      proposta_id: pedido.propostaId,
      protocolo_numero: proposta.protocolo_numero,
      tamanho_bytes: pedido.pdf.byteLength,
      tipo: TIPO_CONTRATO,
      unidade_id: proposta.unidade_id,
      workspace_id: WORKSPACE,
    })
    .select("id")
    .maybeSingle();

  if (error || !criado) {
    // ⚠️ O ARQUIVO SAI JUNTO QUANDO A LINHA NÃO ENTRA. Objeto no bucket sem linha na tabela é um
    // contrato que ninguém encontra e ninguém apaga — e conta como armazenamento pago para sempre.
    await sb.storage.from(APOLO_DOCS_BUCKET).remove([caminho]);
    console.error("[temis][contrato] falha ao registrar o contrato", error);
    return { erro: "Não foi possível registrar o contrato gerado.", ok: false, status: 503 };
  }

  await marcarSubstituidos(sb, anteriores, versao, agora);

  return {
    documentoId: (criado as { id: string }).id,
    nome,
    ok: true,
    protocolo: proposta.protocolo_numero,
    tamanhoBytes: pedido.pdf.byteLength,
    versao,
  };
}

/**
 * Carimba nas versões anteriores quem as substituiu.
 *
 * ⚠️ FALHAR AQUI NÃO DESFAZ A GERAÇÃO. Quem manda sobre "qual vale" é `contratoVigente`, que olha a
 * data — a observação é o recado para quem lê a gaveta, não a regra. Desfazer um contrato válido
 * porque um texto informativo não gravou seria trocar o certo pelo cosmético.
 */
async function marcarSubstituidos(
  sb: SupabaseClient,
  anteriores: readonly ContratoNoCard[],
  versaoNova: number,
  agora: Date,
): Promise<void> {
  if (anteriores.length === 0) return;

  const texto = textoDaSubstituicao(versaoNova, agora);
  const { error } = await sb
    .from("hercules_documentos")
    .update({ observacao: texto })
    .in(
      "id",
      anteriores.map((a) => a.id),
    );

  if (error) {
    console.error("[temis][contrato] falha ao marcar as versões anteriores", error);
  }
}

// ── ABRIR ───────────────────────────────────────────────────────────────────

export type AberturaDoContrato =
  | { erro: string; ok: false; status: 404 | 503 }
  | { nome: string; ok: true; url: string };

/**
 * O link para abrir um contrato gerado.
 *
 * ⚠️ A CONSULTA EXIGE `tipo = contrato`, e não só o id. Sem isso, um id qualquer de
 * `hercules_documentos` — inclusive o RG que um comprador subiu — abriria por esta porta, que é a
 * porta da Têmis e não a da ficha do cliente. O escopo por PESSOA continua sendo trabalho das rotas
 * do portal (`abrirDocumento`); aqui quem entra já é a operação interna, e o recorte é o TIPO.
 */
export async function abrirContratoGuardado(
  sb: SupabaseClient,
  documentoId: string,
  /**
   * `ver` assina uma URL que o navegador DESENHA; `baixar` assina uma que ele SALVA.
   *
   * ⚠️ A DIFERENÇA É UM PARÂMETRO E MUDA TUDO PARA QUEM OLHA. Com `{ download }`, o Storage responde
   * `Content-Disposition: attachment` — e attachment dentro de um `<iframe>` não desenha nada: ele
   * dispara um download. Era por isso que mostrar o contrato na própria tela não funcionava.
   */
  modo: "baixar" | "ver" = "baixar",
): Promise<AberturaDoContrato> {
  const { data, error } = await sb
    .from("hercules_documentos")
    .select("id, nome, caminho")
    .eq("workspace_id", WORKSPACE)
    .eq("tipo", TIPO_CONTRATO)
    .eq("id", documentoId)
    .is("removido_em", null)
    .maybeSingle();

  if (error) {
    console.error("[temis][contrato] falha ao ler o contrato para abrir", error);
    return { erro: "Não foi possível abrir o contrato.", ok: false, status: 503 };
  }

  const linha = data as null | { caminho: string; nome: string };
  if (!linha?.caminho) return { erro: "Contrato não encontrado.", ok: false, status: 404 };

  const assinada = await sb.storage
    .from(APOLO_DOCS_BUCKET)
    .createSignedUrl(
      linha.caminho,
      VALIDADE_DO_LINK_SEGUNDOS,
      modo === "ver" ? {} : { download: linha.nome },
    );

  const url = assinada.data?.signedUrl;
  if (!url) return { erro: "Não foi possível abrir o contrato.", ok: false, status: 503 };

  return { nome: linha.nome, ok: true, url };
}

// ── LEITURAS AUXILIARES ─────────────────────────────────────────────────────

type LinhaDaProposta = {
  cliente_documento: null | string;
  cliente_entity_id: null | string;
  empreendimento_codigo: null | string;
  protocolo_numero: null | number;
  unidade_id: null | string;
};

async function lerProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<LinhaDaProposta | null> {
  const { data, error } = await sb
    .from("hercules_propostas")
    .select("unidade_id, protocolo_numero, empreendimento_codigo, cliente_entity_id, cliente_documento")
    .eq("id", propostaId)
    .maybeSingle();

  if (error) {
    console.error("[temis][contrato] falha ao ler a proposta do arquivamento", error);
    return null;
  }
  return (data as LinhaDaProposta | null) ?? null;
}

/**
 * O CPF do cliente como o Apolo o guarda: HASH, nunca texto.
 *
 * ⚠️ É A MESMA CHAVE DE `/api/incorporador/venda/documentos`, e ela não é decoração: é por ela que
 * a ficha do cliente no Apolo acha o contrato quando a proposta ainda não tem `cliente_entity_id`.
 * O Apolo não guarda CPF em texto em coluna nenhuma — guardar os dígitos aqui daria um campo que
 * nunca casaria com nada do outro lado.
 */
function hashDoCpf(bruto: null | string): null | string {
  const digitos = String(bruto ?? "").replace(/\D/g, "");
  return digitos.length >= 11 ? hashIdentifier("cpf", digitos) : null;
}
