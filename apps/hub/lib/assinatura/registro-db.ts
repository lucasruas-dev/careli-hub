import type { SupabaseClient } from "@supabase/supabase-js";

import { chaveProvisoria } from "./congelar-signatarios";
import type { MarcaDeAssinatura } from "./marcas";
import { type EstadoDaAssinatura, ESTADOS_TERMINAIS } from "./tipos";

// A ÚNICA PORTA DE ESCRITA POR PESSOA — quem assinou, quando, de que documento, e o estado.
//
// Lucas, 28/09/2026: *"pode seguir, faz tudo morar no Panteon"*. O quadro do envelope
// (`temis_envelopes.signatarios`) passa a ter uma `chave` única por pessoa e as marcas
// `assinado_em`/`recusado_em`/`convite_falhou_em`/`convite_entregue_em`, e quem escreve as marcas,
// o quadro e o estado proposto por um provedor é UMA função SQL: `temis_envelope_registrar_
// assinaturas`, da migration 0195. Este arquivo é só a chamada dela.
//
// ⚠️ A REGRA NÃO TEM CÓPIA EM TS, E ISSO É DECISÃO (plano, seção 10, "Regressão I8"). A v1 previa
// cair num update em TypeScript se a 0195 faltasse: seriam três cópias da regra monotônica (SQL,
// TS e o dublê do teste), e só a do banco trava a linha (FOR UPDATE) de verdade. Sem a função
// (PGRST202, ou 42883 que cite a própria função) a resposta é `funcao_ausente` e NADA é gravado
// por fora: nem o webhook, nem os carimbos do envio, nem a troca de signatário.
//
// ⚠️ ORDEM DO DEPLOY: A 0195 É APLICADA ANTES DA F1 SUBIR (plano, F1, "sem caminho antigo de
// reserva"; revisão da F1 confirmou a escolha). Publicada antes, a F1 não quebra o envio (a linha
// de registro nem nasce, e nada vai para a Clicksign), mas o webhook fica inerte: nenhum evento
// aplica estado, e um contrato que fechasse nessa janela não viraria "assinado" sozinho. Vai no
// changelog e no pedido de OK do deploy.

/**
 * Uma pessoa do quadro, como a 0195 a guarda.
 *
 * ⚠️ `chave` É OBRIGATÓRIA E ÚNICA NO QUADRO: `signer.key`/id da Clicksign, `c2x:<ss.id>` (D4Sign) ou
 * `tmp:<posição>` antes do carimbo. É por ela que a função casa as marcas; o e-mail só casa quando
 * a chave não existe no quadro E o e-mail é único nele (casar por e-mail sem consumir o par pintava
 * N linhas com uma marca: `lib/guardian/d4sign-consulta.ts:150-155`).
 */
export type ItemDoQuadro = {
  chave: string;
  email: string;
  nome: string;
  ordem: number;
  /** Vocabulário da casa (`PapelNoContrato`) quando se sabe. */
  papel: null | string;
  /** Rótulo de tela, só D4Sign. */
  perfil?: string;
  assinado_em?: string;
  recusado_em?: string;
  convite_falhou_em?: string;
  convite_entregue_em?: string;
};

/**
 * O item como quem GRAVA o quadro o manda — `chave` opcional.
 *
 * ⚠️ A FORMA DO BANCO É ESTA, E NÃO A DE `ItemDoQuadro`. Medido em produção em 01/10/2026 (só
 * SELECT): das 159 linhas de signatário dos 29 envelopes da Clicksign, 104 NÃO TÊM o campo `chave`
 * (zero `tmp:`, zero `c2x:`). A função da 0195 aceita o item sem chave — ela só testa
 * `nullif(item->>'chave','') is not null` e casa a linha antiga pelo e-mail ÚNICO. Exigir a chave na
 * ESCRITA obrigava quem grava a INVENTAR uma (`tmp:<posição>`), e chave inventada em cima de chave
 * ausente é o que (a) apaga `assinado_em` de quem tem e-mail repetido, porque tira da 0195 o único
 * casamento que sobrava, e (b) vira o id que a tela manda ao `DELETE /envelopes/{id}/signers/{id}`,
 * onde `tmp:` volta 404 e o 404 segue em frente. `ItemDoQuadro` segue com `chave` obrigatória porque
 * é o tipo da LEITURA, onde `lerQuadro` completa a posição faltante de propósito.
 */
export type ItemParaGravar = Omit<ItemDoQuadro, "chave"> & { chave?: string };

export type EntradaDoRegistro = {
  conferidoEm?: null | string;
  /** O `provedor_documento_id` do evento: adota se a linha não tem; recusa se é outro. */
  documento?: null | string;
  /** O PROPOSTO; a função decide se vale (só para a frente). */
  estado?: EstadoDaAssinatura | null;
  estadoCru?: null | string;
  /** Só data REAL do provedor; nunca "agora" (ATENCAO 5 da 0195). */
  fechadoEm?: null | string;
  marcas?: readonly MarcaDeAssinatura[];
  quadro?: readonly ItemParaGravar[] | null;
  /** O `atualizado_em` lido antes da troca (a versão do quadro). */
  quadroDe?: null | string;
};

export type RegistroDasAssinaturas = {
  assinaram: number;
  estadoAntes: EstadoDaAssinatura;
  estadoDepois: EstadoDaAssinatura;
  fechadoEm: null | string;
  mudouEstado: boolean;
  recusa: null | "documento_diferente" | "quadro_mudou";
  /** O quadro JÁ MESCLADO: é dele que sai a data do comprador (nunca de uma segunda leitura). */
  signatarios: ItemDoQuadro[];
  total: number;
};

/** O que aconteceu com a chamada, para quem precisa distinguir "função ausente" de "falhou". */
export type ChamadaDoRegistro =
  | { registro: RegistroDasAssinaturas; tipo: "feito" }
  | { tipo: "falhou" }
  | { tipo: "funcao_ausente" }
  | { tipo: "sem_linha" };

export const FUNCAO_DO_REGISTRO = "temis_envelope_registrar_assinaturas";

/**
 * A função da 0195 não existe (ainda)? PGRST202 é o PostgREST dizendo que não achou a função no
 * cache do esquema; 42883 é o Postgres.
 *
 * ⚠️ 42883 SÓ QUANDO A MENSAGEM CITA A PRÓPRIA FUNÇÃO. O mesmo código sai de DENTRO do corpo dela
 * ("operator does not exist", uma função auxiliar que falta): isso é defeito da função, e tratá-lo
 * como "ausente" esconderia a falha num aviso manso.
 */
export function ehFuncaoAusente(erro: null | { code?: string; message?: string } | undefined): boolean {
  if (!erro) return false;
  const codigo = String(erro.code ?? "");
  const mensagem = String(erro.message ?? "");
  if (codigo === "PGRST202") return true;
  return codigo === "42883" && mensagem.includes(FUNCAO_DO_REGISTRO);
}

/** A marca no formato do jsonb que a função lê (`snake_case`, sem nulos). */
function marcaParaOBanco(marca: MarcaDeAssinatura): Record<string, string> {
  const saida: Record<string, string> = {};
  if (marca.chave) saida.chave = marca.chave;
  if (marca.email) saida.email = marca.email.toLowerCase();
  if (marca.assinadoEm) saida.assinado_em = marca.assinadoEm;
  if (marca.recusadoEm) saida.recusado_em = marca.recusadoEm;
  if (marca.conviteFalhouEm) saida.convite_falhou_em = marca.conviteFalhouEm;
  if (marca.conviteEntregueEm) saida.convite_entregue_em = marca.conviteEntregueEm;
  return saida;
}

const ESTADOS_CONHECIDOS = new Set<string>([
  "aguardando",
  "assinado",
  "cancelado",
  "desconhecido",
  "expirado",
  "parcial",
  "rascunho",
  "recusado",
]);

function comoEstado(bruto: unknown): EstadoDaAssinatura {
  const valor = String(bruto ?? "");
  return (ESTADOS_CONHECIDOS.has(valor) ? valor : "desconhecido") as EstadoDaAssinatura;
}

/**
 * Lê o quadro que a função devolveu. Só o que não é objeto fica de fora.
 *
 * ⚠️ ITEM SEM `chave` ENTRA NA LEITURA, COM `tmp:<posição>` (revisão da F1). Os quadros gravados
 * antes da 0195 não têm chave (medido em 28/09/2026: 4 dos 7 contratos em `parcial` sem NENHUM item
 * com chave, e 12 dos 14 acordos em `aguardando`), e a função casa as marcas deles pelo e-mail
 * único. Descartar o item aqui fazia o quadro chegar VAZIO a `concluirAssinaturaDoCard`, e o prazo
 * de arrependimento começava no fechamento, e não na última assinatura do comprador: o bug 8.3
 * continuava vivo em todo contrato já enviado. Quem lê a data precisa de `papel` e `assinado_em`,
 * não da chave; a chave de leitura não volta ao banco (quem grava quadro manda o seu).
 */
export function lerQuadro(bruto: unknown): ItemDoQuadro[] {
  if (!Array.isArray(bruto)) return [];
  const saida: ItemDoQuadro[] = [];
  for (const [posicao, item] of bruto.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const p = item as Record<string, unknown>;
    const chave = (typeof p.chave === "string" ? p.chave.trim() : "") || chaveProvisoria(posicao + 1);
    const lido: ItemDoQuadro = {
      chave,
      email: typeof p.email === "string" ? p.email : "",
      nome: typeof p.nome === "string" ? p.nome : "",
      ordem: typeof p.ordem === "number" && Number.isFinite(p.ordem) ? p.ordem : 0,
      papel: typeof p.papel === "string" ? p.papel : null,
    };
    if (typeof p.perfil === "string") lido.perfil = p.perfil;
    for (const marca of ["assinado_em", "recusado_em", "convite_falhou_em", "convite_entregue_em"] as const) {
      const valor = p[marca];
      if (typeof valor === "string" && valor.trim()) lido[marca] = valor;
    }
    saida.push(lido);
  }
  return saida;
}

/**
 * Chama a função da 0195 e diz o que aconteceu.
 *
 * ⚠️ NUNCA LANÇA, NEM QUANDO O CLIENTE NÃO TEM `rpc`. Ela roda dentro do `after()` do webhook e dos
 * carimbos do envio, depois de a resposta ter saído: uma exceção aqui seria um unhandled rejection
 * sem ninguém para pegá-la.
 *
 * ⚠️ O LOG SÓ LEVA `code` E `message` (plano, seção 6, guardas). O objeto de erro inteiro do
 * PostgREST pode trazer "Failing row contains (...)" com o jsonb do quadro, e-mail incluído.
 */
export async function chamarRegistroDasAssinaturas(
  sb: SupabaseClient,
  envelopeRegistroId: string,
  entrada: EntradaDoRegistro,
): Promise<ChamadaDoRegistro> {
  try {
    const { data, error } = await sb.rpc(FUNCAO_DO_REGISTRO, {
      p_conferido_em: entrada.conferidoEm ?? null,
      p_documento: entrada.documento ?? null,
      p_envelope: envelopeRegistroId,
      p_estado: entrada.estado ?? null,
      p_estado_cru: entrada.estadoCru ?? null,
      p_fechado_em: entrada.fechadoEm ?? null,
      p_marcas: (entrada.marcas ?? []).map(marcaParaOBanco),
      p_quadro: entrada.quadro ? entrada.quadro.map((item) => ({ ...item })) : null,
      p_quadro_de: entrada.quadroDe ?? null,
    });

    if (error) {
      if (ehFuncaoAusente(error)) return { tipo: "funcao_ausente" };
      console.error("[assinatura][registro] a função da 0195 falhou", {
        code: error.code ?? null,
        message: error.message ?? null,
      });
      return { tipo: "falhou" };
    }

    const linhas = Array.isArray(data) ? data : data ? [data] : [];
    const linha = linhas[0] as null | Record<string, unknown> | undefined;
    // ⚠️ ZERO LINHAS É "NÃO ACHEI O ENVELOPE" (a função sai com `return` sem linha).
    if (!linha) return { tipo: "sem_linha" };

    const recusa = linha.recusa === "documento_diferente" || linha.recusa === "quadro_mudou"
      ? linha.recusa
      : null;

    return {
      registro: {
        assinaram: typeof linha.assinaram === "number" ? linha.assinaram : 0,
        estadoAntes: comoEstado(linha.estado_antes),
        estadoDepois: comoEstado(linha.estado_depois),
        fechadoEm: typeof linha.fechado === "string" ? linha.fechado : null,
        mudouEstado: linha.mudou_estado === true,
        recusa,
        signatarios: lerQuadro(linha.quadro),
        total: typeof linha.total === "number" ? linha.total : 0,
      },
      tipo: "feito",
    };
  } catch (falha) {
    console.error("[assinatura][registro] a chamada da função da 0195 lançou", {
      message: falha instanceof Error ? falha.message : String(falha),
    });
    return { tipo: "falhou" };
  }
}

/**
 * A porta de escrita por pessoa. `null` = linha inexistente, função ausente ou falha (o log diz qual).
 *
 * ⚠️ NUNCA LANÇA. Ver `chamarRegistroDasAssinaturas`.
 */
export async function registrarAssinaturas(
  sb: SupabaseClient,
  envelopeRegistroId: string,
  entrada: EntradaDoRegistro,
): Promise<RegistroDasAssinaturas | null> {
  const chamada = await chamarRegistroDasAssinaturas(sb, envelopeRegistroId, entrada);
  if (chamada.tipo === "funcao_ausente") {
    console.warn(
      "[assinatura][registro] a função da 0195 não existe ainda: nada foi aplicado (o histórico chega de novo no próximo payload).",
    );
  }
  return chamada.tipo === "feito" ? chamada.registro : null;
}

/**
 * A guarda dos updates DIRETOS de estado que continuam existindo (os cancelamentos feitos pelo
 * próprio Panteon): `.not("estado", "in", GUARDA_DE_TERMINAL)`.
 *
 * ⚠️ TERMINAL NÃO MUDA MAIS (ATENCAO 4 da 0195). Um contrato ASSINADO que o botão de cancelar
 * alcançasse por uma corrida viraria "cancelado" no Panteon com a assinatura valendo lá fora.
 */
export const GUARDA_DE_TERMINAL = `(${ESTADOS_TERMINAIS.join(",")})`;

// ── O CARIMBO DO ENVIO (Têmis e Hades) ──────────────────────────────────────

/**
 * O envelope FOI ATIVADO na Clicksign: estado `aguardando` e, quando se sabe, o quadro com a chave
 * de cada pessoa. Pela função da 0195.
 *
 * ⚠️ PELA FUNÇÃO, E NÃO POR UPDATE (0.25 do plano). O carimbo antigo gravava `aguardando` e o jsonb
 * inteiro sem condição, e o webhook chega ANTES do carimbo (26 de 26 uploads, medido): um `sign`
 * que já tivesse virado `parcial` voltava a `aguardando`, e as marcas de quem assinou sumiam. A
 * função só anda para a frente e leva as marcas de quem continua no quadro.
 *
 * ⚠️ SEM A 0195 NÃO HÁ GESTO DE RESERVA (plano, F1). Um update em TS seria a segunda cópia da regra
 * monotônica, sem a trava da linha; a ordem do deploy (a 0195 antes) está no topo deste arquivo.
 *
 * Devolve `true` quando a função gravou.
 */
export async function registrarEnvioAtivo(
  sb: SupabaseClient,
  registroId: string,
  dados: { estadoCru: string; quadro?: readonly ItemDoQuadro[] | null },
): Promise<boolean> {
  const chamada = await chamarRegistroDasAssinaturas(sb, registroId, {
    estado: "aguardando",
    estadoCru: dados.estadoCru,
    quadro: dados.quadro ?? null,
  });
  if (chamada.tipo === "funcao_ausente") {
    console.error("[assinatura][registro] a função da 0195 não existe: o envio ativado não foi carimbado.");
  }
  return chamada.tipo === "feito";
}

/**
 * Os eventos do webhook que chegaram ANTES do carimbo ganham o `envelope_id` da linha (plano, F1,
 * Integridade M2). Só os do documento, só os que estão sem, e SÓ OS CONFERIDOS.
 *
 * ⚠️ O NÃO CONFERIDO NÃO É LIGADO (revisão da F1): o `provedor_documento_id` dele veio de um corpo que
 * qualquer um escreve, e ligá-lo ao envelope o poria na conta de quem lê os eventos pelo envelope.
 *
 * ⚠️ É ENFEITE DE CONSULTA, E FALHA CALADA NO LOG. O evento continua achável pelo documento.
 */
export async function ligarEventosAoEnvelope(
  sb: SupabaseClient,
  documentoId: null | string,
  envelopeId: null | string,
): Promise<void> {
  if (!documentoId || !envelopeId) return;
  // ⚠️ NUNCA LANÇA: roda no fim do envio que JÁ deu certo, e uma exceção aqui viraria "falhou" na
  // tela de um envelope pago e ativo (o operador clicaria de novo no segundo envelope).
  try {
    const { error } = await sb
      .from("temis_assinatura_eventos")
      .update({ envelope_id: envelopeId })
      .eq("provedor", "clicksign")
      .eq("provedor_documento_id", documentoId)
      .eq("assinatura_conferida", true)
      .is("envelope_id", null);
    if (error) {
      console.error("[assinatura][registro] falha ao ligar os eventos ao envelope", {
        code: error.code ?? null,
        message: error.message ?? null,
      });
    }
  } catch (falha) {
    console.error("[assinatura][registro] falha ao ligar os eventos ao envelope", {
      message: falha instanceof Error ? falha.message : String(falha),
    });
  }
}
