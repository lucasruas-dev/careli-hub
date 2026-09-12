import { chamar, FalhaDaClicksign, type PortaDaClicksign } from "./cliente";

import { estadoDaClicksign } from "../traduzir";

import type { EstadoDaAssinatura, PapelNoContrato, Signatario } from "../tipos";

// O ENVIO — o contrato guardado vira um envelope na Clicksign.
//
// ⚠️ A API v3 TRABALHA COM ENVELOPES, E SÃO CINCO CHAMADAS, NÃO UMA. Isto não é detalhe de
// implementação: é o que decide o desenho da falha. O fluxo da doc é
//
//     1. POST /envelopes                      cria o envelope em `draft`
//     2. POST /envelopes/{id}/documents       sobe o PDF (base64 CRU, sem "data:")
//     3. POST /envelopes/{id}/signers         um POST POR PESSOA
//     4. POST /envelopes/{id}/requirements    DOIS por pessoa: "assina" e "autentica por e-mail"
//     5. PATCH /envelopes/{id}                status: "running"  ← daqui não volta
//     6. POST /envelopes/{id}/notifications   os convites saem
//
// Com quatro signatários isso são 1 + 1 + 4 + 8 + 1 + 1 = 16 chamadas. Qualquer uma pode falhar no
// meio, e o que sobra é um envelope MEIO MONTADO na conta.
//
// ⚠️ POR ISSO A CONFERÊNCIA DOS SIGNATÁRIOS ACONTECE ANTES DA PRIMEIRA CHAMADA (ver
// `conferirSignatarios` em `../signatarios.ts`), e por isso a falha antes do passo 5 APAGA o
// rascunho. As duas coisas existem pelo mesmo motivo: a conta é de PRODUÇÃO (Lucas, 08/09/2026 — o
// sandbox deles está com problema), cada envelope tem custo, e depois de `running` ele NÃO SE
// APAGA. Rascunho apaga; ativado, não. A janela de desfazer é exatamente até o passo 5.
//
// ⚠️ E O ENVELOPE PRECISA SE IDENTIFICAR DE LONGE. O primeiro uso será no ZZ TESTE, EM PRODUÇÃO,
// convivendo na mesma lista com contrato de verdade. Nome do envelope, nome do arquivo, assunto do
// e-mail e o `metadata` do documento carregam empreendimento, unidade e comprador — e o marcador
// `[TESTE]` quando o empreendimento é o de teste. Ver `nomeDoEnvelope`.
//
// ⚠️ O `metadata` VOLTA NO WEBHOOK, e é a única peça da API que faz isso (medido na doc: só o
// DOCUMENTO tem `metadata`; o envelope não tem campo nenhum de dado nosso). É por ele que o evento
// que chega do lado de fora sabe dizer de qual proposta está falando sem depender de a nossa tabela
// já ter gravado o id do envelope.

/** O que a Clicksign devolve nos POSTs: JSON:API, com o id no `data`. */
type RespostaComId = { data?: { id?: string } };

/**
 * O que a Clicksign devolve no GET do envelope: JSON:API, com o status nos `attributes`.
 *
 * ⚠️ OS DOIS NÍVEIS SÃO O MESMO CAMPO, e não dois palpites diferentes. O JSON:API põe os dados do
 * recurso em `data.attributes`, e é lá que o PATCH do passo 5 escreve o status; `data.status` entra
 * como segunda leitura do MESMO campo, um nível acima, porque o webhook real (09/09/2026) chegou
 * com o status ao lado do id (`document: { key, path, status }`) e não dentro de `attributes`.
 */
type RespostaComStatus = { data?: { attributes?: { status?: string }; status?: string } };

export type PedidoDeEnvio = {
  /** O PDF já montado e guardado. */
  arquivo: { bytes: Uint8Array; nome: string };
  /** Empreendimento, unidade e comprador — o que dá nome e metadados ao envelope. */
  identidade: IdentidadeDoEnvelope;
  /** Mensagem do corpo do e-mail. Vazio = a Clicksign usa a dela. */
  mensagem?: string;
  /**
   * Prazo em dias.
   *
   * ⚠️ TETO RÍGIDO DE 90 DIAS na Clicksign, contados do upload. Um número maior é APARADO aqui em
   * vez de virar 422 no meio do fluxo — com o envelope já criado.
   */
  prazoEmDias?: number;
  /**
   * Mandar SEM o CPF, para este envio.
   *
   * ⚠️ EXISTE PORQUE A CLICKSIGN VALIDA O CPF CONTRA A RECEITA. O do ZZ TESTE é fictício
   * (`999.999.004-53`): passa no dígito verificador e mesmo assim volta 422
   * `documentation - inválido`, porque o número não existe no cadastro oficial. Lucas,
   * 09/09/2026: *"vamos sem cpf"*.
   *
   * ⚠️ E SERVE ALÉM DO TESTE: CPF suspenso na Receita, ou com nome desatualizado, recusa igual —
   * e aí o contrato de um cliente real ficaria travado sem caminho. Sem CPF, a Clicksign não pede
   * documento na hora de assinar e a autenticação fica só no e-mail.
   */
  semCpf?: boolean;
  /** Já com `ordem` resolvida por `ordenarSignatarios`. */
  signatarios: readonly Signatario[];
};

export type IdentidadeDoEnvelope = {
  /** "Henrique Sales do Vale". */
  comprador: string;
  /** "TST" ou o nome do empreendimento. */
  empreendimento: string;
  /** O id da proposta — viaja no `metadata` e volta no webhook. */
  propostaId?: string;
  /** O id da linha em `hercules_documentos` — idem. */
  documentoId?: string;
  /** "Q01 L05" ou o código da unidade. */
  unidade: string;
};

export type EnvelopeCriado = {
  /** O id do envelope LÁ. É por ele que se consulta, cancela e baixa. */
  envelopeId: string;
  documentoId: string;
  /** O nome que aparece na lista da Clicksign. */
  nome: string;
  /** `{ e-mail → id do signatário }`. Poupa uma consulta no reenvio. */
  signatarios: Record<string, string>;
};

export type FalhaNoEnvio = {
  /**
   * O id do envelope QUE FICOU NA CONTA. `null` quando nada sobrou — ou porque a falha foi no passo
   * 1 e envelope nenhum chegou a existir, ou porque o rascunho foi apagado.
   *
   * ⚠️ ELE FALTAVA AQUI, E FALTAVA JUSTAMENTE NO CASO PIOR. Quando o passo 6 (notificar) falha, o
   * envelope já está `running`: pago, permanente, com os convites NÃO enviados — e o id dele ficava
   * só dentro desta função, que devolvia texto. O Panteon gravava "falhou" e não sabia dizer QUAL
   * envelope conferir; alguém teria de caçar na lista da Clicksign, no meio de contratos de verdade.
   */
  envelopeId: null | string;
  erro: string;
  /** Em que passo parou — é o que diz se sobrou envelope na conta. */
  passo: "ativar" | "criar" | "documento" | "notificar" | "requisitos" | "signatarios";
  /** O rascunho foi apagado? `false` significa que ficou algo lá. */
  rascunhoApagado: boolean;
  /** `X-Request-Id` da Clicksign — é o que o suporte deles pede. */
  requestId: null | string;
};

export type ResultadoDoEnvio = ({ ok: true } & EnvelopeCriado) | ({ ok: false } & FalhaNoEnvio);

/**
 * Manda o contrato para assinatura.
 *
 * `porta` é a chamada HTTP; o padrão é a real e o teste passa um duplo — ver `PortaDaClicksign`.
 */
export async function enviarParaAssinatura(
  pedido: PedidoDeEnvio,
  porta: PortaDaClicksign = chamar,
): Promise<ResultadoDoEnvio> {
  const nome = nomeDoEnvelope(pedido.identidade);
  let envelopeId = "";

  /** Apaga o rascunho e diz se conseguiu. Só vale ANTES do `running` — ver o topo. */
  const desfazer = async (): Promise<boolean> => {
    if (!envelopeId) return true;
    try {
      await porta(`/envelopes/${envelopeId}`, { metodo: "DELETE" });
      return true;
    } catch {
      // ⚠️ NÃO ESCONDE A FALHA ORIGINAL. Se o DELETE também falhar, quem lê precisa saber que
      // sobrou um rascunho na conta — senão vai procurar por um envelope que "não deveria existir".
      return false;
    }
  };

  const falhar = async (passo: FalhaNoEnvio["passo"], e: unknown): Promise<ResultadoDoEnvio> => {
    const falha = e instanceof FalhaDaClicksign ? e : null;
    const detalhe = detalheDaFalha(e);
    // Depois de ativado não se desfaz nada: o envelope existe, e mentir sobre isso é pior do que a
    // falha.
    const rascunhoApagado = passo === "notificar" ? false : await desfazer();
    return {
      // ⚠️ O ID SÓ VIAJA QUANDO SOBROU ALGO NA CONTA. Devolver o id de um rascunho que acabou de ser
      // apagado faria quem lê procurar — e não achar — um envelope que não existe mais, e gravá-lo na
      // nossa tabela deixaria uma linha apontando para o nada. `null` aqui significa, com todas as
      // letras, "nada ficou pendente lá".
      envelopeId: rascunhoApagado ? null : envelopeId || null,
      erro: detalhe,
      ok: false,
      passo,
      rascunhoApagado,
      requestId: falha?.erro.requestId ?? null,
    };
  };

  // ── 1. O ENVELOPE ─────────────────────────────────────────────────────────
  try {
    const criado = await porta<RespostaComId>("/envelopes", {
      corpo: {
        data: {
          attributes: atributosDoEnvelope(nome, pedido),
          type: "envelopes",
        },
      },
      metodo: "POST",
    });
    envelopeId = String(criado?.data?.id ?? "");
    if (!envelopeId) throw new Error("A Clicksign criou o envelope e não devolveu o id.");
  } catch (e) {
    return falhar("criar", e);
  }

  // ── 2. O PDF ──────────────────────────────────────────────────────────────
  let documentoId = "";
  try {
    const subido = await porta<RespostaComId>(`/envelopes/${envelopeId}/documents`, {
      corpo: {
        data: {
          attributes: {
            // ⚠️ COM O PREFIXO `data:application/pdf;base64,` — e este comentário já esteve
            // ESCRITO AO CONTRÁRIO aqui, afirmando que a v3 não queria o data-URI. A doc oficial
            // diz o oposto, em dois lugares (conferido em 09/09/2026): o tutorial "Veja como
            // funciona na prática" mostra `"content_base64": "data:application/pdf;base64,..."`,
            // e a página "Documentos" descreve o campo como quatro partes — `data:`, o MIME, o
            // token `base64` e os dados.
            //
            // ⚠️ E ERRAR AQUI CUSTA DINHEIRO: este é o passo 2. O envelope do passo 1 JÁ EXISTE
            // na conta quando esta chamada falha, e envelope de produção não se apaga depois de
            // ativado — só se cancela, e o cancelado fica na lista para sempre.
            content_base64: `data:application/pdf;base64,${Buffer.from(pedido.arquivo.bytes).toString("base64")}`,
            filename: comExtensaoPdf(pedido.arquivo.nome),
            // ⚠️ ESTE É O ÚNICO CAMPO NOSSO QUE VOLTA NO WEBHOOK. Ver o topo.
            metadata: metadadosDoDocumento(pedido.identidade),
          },
          type: "documents",
        },
      },
      metodo: "POST",
      // O corpo leva o PDF inteiro em base64: timeout longo.
      pesada: true,
    });
    documentoId = String(subido?.data?.id ?? "");
    if (!documentoId) throw new Error("A Clicksign aceitou o arquivo e não devolveu o id do documento.");
  } catch (e) {
    return falhar("documento", e);
  }

  // ── 3. OS SIGNATÁRIOS ─────────────────────────────────────────────────────
  const idPorEmail: Record<string, string> = {};
  try {
    for (const pessoa of pedido.signatarios) {
      const criado = await porta<RespostaComId>(`/envelopes/${envelopeId}/signers`, {
        corpo: {
          data: {
            attributes: atributosDoSignatario(pessoa, pedido.semCpf === true),
            type: "signers",
          },
        },
        metodo: "POST",
      });
      const id = String(criado?.data?.id ?? "");
      if (!id) throw new Error(`A Clicksign cadastrou ${pessoa.nome} e não devolveu o id.`);
      idPorEmail[pessoa.email.trim().toLowerCase()] = id;
    }
  } catch (e) {
    return falhar("signatarios", e);
  }

  // ── 4. OS REQUISITOS ──────────────────────────────────────────────────────
  //
  // ⚠️ SÃO DOIS POR PESSOA, E OS DOIS SÃO OBRIGATÓRIOS. `agree` diz o QUE a pessoa faz com o
  // documento (assinar, como parte); `provide_evidence` diz COMO ela prova que é ela. Sem o
  // segundo, o signatário não tem método de autenticação e o envelope não roda.
  try {
    for (const pessoa of pedido.signatarios) {
      const signerId = idPorEmail[pessoa.email.trim().toLowerCase()];
      if (!signerId) continue;

      for (const attributes of [
        { action: "agree", role: papelDaClicksign(pessoa.papel) },
        // ⚠️ `email` É A AUTENTICAÇÃO, e é a escolha certa para contrato imobiliário nesta casa:
        // é a que o D4Sign já usa hoje e a única que não exige nada do comprador além da caixa de
        // entrada. As outras 16 (`icp_brasil`, `selfie`, `pix`, `documentscopy`…) custam mais e
        // travam quem não tem o app na mão — e trava de assinatura vira ligação para o atendimento.
        { action: "provide_evidence", auth: "email" },
      ]) {
        await porta(`/envelopes/${envelopeId}/requirements`, {
          corpo: {
            data: {
              attributes,
              relationships: {
                document: { data: { id: documentoId, type: "documents" } },
                signer: { data: { id: signerId, type: "signers" } },
              },
              type: "requirements",
            },
          },
          metodo: "POST",
        });
      }
    }
  } catch (e) {
    return falhar("requisitos", e);
  }

  // ── 5. ATIVAR ─────────────────────────────────────────────────────────────
  //
  // ⚠️ ESTE É O PONTO SEM VOLTA. Daqui em diante o envelope não se apaga — só se CANCELA, e o
  // cancelado continua na lista. Tudo que podia dar errado já deu antes.
  try {
    await porta(`/envelopes/${envelopeId}`, {
      corpo: { data: { attributes: { status: "running" }, id: envelopeId, type: "envelopes" } },
      metodo: "PATCH",
    });
  } catch (e) {
    return falhar("ativar", e);
  }

  // ── 6. NOTIFICAR ──────────────────────────────────────────────────────────
  //
  // ⚠️ ATIVAR NÃO CONVIDA NINGUÉM. No fluxo da doc a notificação é um passo SEPARADO, e sem ele o
  // envelope fica `running` com todo mundo esperando um e-mail que nunca saiu — o defeito perfeito:
  // a tela diz "enviado", a Clicksign diz "aguardando", e o comprador não recebeu nada.
  try {
    await porta(`/envelopes/${envelopeId}/notifications`, {
      corpo: { data: { attributes: {}, type: "notifications" } },
      metodo: "POST",
    });
  } catch (e) {
    return falhar("notificar", e);
  }

  return { documentoId, envelopeId, nome, ok: true, signatarios: idPorEmail };
}

// ── A LEITURA DO ESTADO REAL ────────────────────────────────────────────────

export type EnvelopeLido = {
  envelopeId: string;
  /**
   * O estado na língua da casa, traduzido por `estadoDaClicksign`.
   *
   * ⚠️ TRADUZIDO SEM SABER QUEM ASSINOU, e isso muda o que ele pode responder. Esta leitura pega o
   * status do ENVELOPE, não a lista de signatários: `running` volta como `aguardando` mesmo com
   * três dos quatro já assinados, e `closed` volta como `desconhecido` — porque `closed` é tanto
   * "todos assinaram" quanto "venceu o prazo e fechou com o que tinha" (ver `estadoDaClicksign`).
   * Ela responde "este envelope ainda está vivo?", nunca "quantos assinaram?".
   */
  estado: EstadoDaAssinatura;
  ok: true;
  /** O status CRU da Clicksign: `draft`, `running`, `closed` ou `canceled`. */
  status: string;
};

export type FalhaNaLeitura = {
  envelopeId: string;
  erro: string;
  ok: false;
  /** `X-Request-Id` da Clicksign — é o que o suporte deles pede. */
  requestId: null | string;
};

export type ResultadoDaLeitura = EnvelopeLido | FalhaNaLeitura;

/**
 * LÊ O ESTADO DO ENVELOPE NA CLICKSIGN — a fonte que não atrasa.
 *
 * ⚠️ ELA EXISTE PORQUE O NOSSO BANCO É QUEM ESTÁ ATRASADO. `temis_envelopes.estado` só é escrito
 * pelo webhook, e a janela entre a última assinatura e o evento chegar é justamente o momento em
 * que alguém clica em "voltar para a análise": a tela carregada às 13:58 mostra `parcial`, o quarto
 * signatário assina às 14:00, e às 14:00:01 o Panteon cancelaria um contrato ASSINADO POR TODOS. E
 * o estrago não pararia aí — `cancelado` é terminal, então o `auto_close` que chegasse depois seria
 * DESCARTADO e não sobraria registro nenhum de que aquele contrato foi assinado.
 *
 * ⚠️ QUEM CHAMA ISTO CANCELA DEPOIS, NUNCA ANTES. A ordem é ler → recusar se estiver fechado →
 * cancelar. Ver `lib/temis/retorno-para-correcao.ts`.
 *
 * ⚠️ E A FALHA AQUI É PARA FECHAR O CAMINHO, não para seguir no escuro: quem chama recusa a volta
 * quando esta leitura não responde. Por isso ela NUNCA LANÇA — devolve a falha, como o cancelamento.
 *
 * ⚠️ A FORMA DO GET É INFERÊNCIA, exatamente como a do PATCH que cancela — e o aviso é deliberado.
 * O que esta casa já viu de verdade é a LISTAGEM (`/envelopes?page[number]=1`, em `sondarCabecalho`);
 * o GET de um envelope só é o caminho padrão do JSON:API, e o lugar do status na resposta
 * (`data.attributes.status`) é deduzido de onde o PATCH do passo 5 ESCREVE o status. Este arquivo já
 * teve três campos com comentário confiante afirmando o contrário da doc (o `Bearer` no token, o PDF
 * em base64 cru, o CPF sem máscara), e os três só apareceram na primeira chamada real. Quem
 * confirmar na doc (ou na primeira leitura de verdade), troque este parágrafo pela citação.
 */
export async function consultarEnvelope(
  envelopeId: string,
  porta: PortaDaClicksign = chamar,
): Promise<ResultadoDaLeitura> {
  const id = envelopeId.trim();
  // ⚠️ SEM ID NÃO SE CHAMA NADA, pelo mesmo motivo do cancelamento: `GET /envelopes/` (com o id
  // vazio) é a LISTAGEM, que responde 200 com a página inteira da conta — e ler dali um status
  // qualquer seria afirmar sobre um envelope que não é este.
  if (!id) {
    return {
      envelopeId: "",
      erro: "Sem o id do envelope não dá para consultar na Clicksign.",
      ok: false,
      requestId: null,
    };
  }

  try {
    const lido = await porta<RespostaComStatus>(`/envelopes/${id}`, { metodo: "GET" });
    const status = String(lido?.data?.attributes?.status ?? lido?.data?.status ?? "").trim();
    // ⚠️ RESPOSTA SEM STATUS É FALHA, E NÃO "ESTADO DESCONHECIDO". Se a forma da resposta mudar (ou
    // a inferência acima estiver errada), cair no caminho da falha é o que RECUSA a volta; devolver
    // `desconhecido` como se fosse uma leitura boa misturaria "a Clicksign disse algo que não sei
    // traduzir" com "não consegui perguntar", e as duas pedem a mesma coisa por motivos diferentes.
    if (!status) throw new Error("A Clicksign respondeu sobre o envelope e não disse o status.");
    return { envelopeId: id, estado: estadoDaClicksign(status).estado, ok: true, status };
  } catch (e) {
    return {
      envelopeId: id,
      erro: detalheDaFalha(e),
      ok: false,
      requestId: e instanceof FalhaDaClicksign ? e.erro.requestId : null,
    };
  }
}

// ── O CANCELAMENTO ──────────────────────────────────────────────────────────

export type CancelamentoFeito = { envelopeId: string; ok: true };

export type FalhaNoCancelamento = {
  /**
   * O PEDIDO PODE TER CHEGADO? `true` = não dá para saber.
   *
   * ⚠️ TIMEOUT NÃO É RECUSA, e tratar os dois como a mesma coisa faz a tela AFIRMAR o que o código
   * não sabe. Quando a API responde 4xx/5xx, ela recusou: o envelope continua vivo, e dizer "as
   * pessoas continuam com o contrato atual para assinar" é verdade. Quando a chamada ABORTA (os 15s
   * de `chamar`, ou a rede caindo), o PATCH pode ter chegado e o envelope já estar morto do outro
   * lado — e aí a mesma frase vira certeza falsa.
   *
   * ⚠️ É A MESMA DECISÃO QUE `carimbarFalha` JÁ TOMA no envio (`lib/assinatura/envio-db.ts`): ela
   * não grava `aguardando` no passo `ativar` porque "a chamada pode ter estourado por timeout com o
   * status já virado do outro lado, e afirmar ali seria trocar uma dúvida por uma certeza falsa".
   *
   * ⚠️ O CRITÉRIO É `status === 0`, que é o que `chamar` põe quando NÃO HOUVE RESPOSTA HTTP — vale
   * para o timeout e para a falha de rede. Os dois entram como duvidosos de propósito: uma conexão
   * derrubada depois de o servidor ter processado é indistinguível daqui de uma que nunca saiu.
   *
   * ⚠️ E ELE PECA PARA O LADO SEGURO em um caso conhecido: a falta de env (`Clicksign não
   * configurada`) também chega com status 0 e vira "não dá para saber", quando na verdade nada foi
   * mandado. Preferimos essa dúvida a mais do que uma certeza a menos — reconhecê-la pela mensagem
   * seria amarrar esta régua ao texto do `cliente.ts`.
   */
  duvidoso: boolean;
  envelopeId: string;
  erro: string;
  ok: false;
  /** `X-Request-Id` da Clicksign — é o que o suporte deles pede. */
  requestId: null | string;
};

export type ResultadoDoCancelamento = CancelamentoFeito | FalhaNoCancelamento;

/**
 * CANCELA O ENVELOPE NA CLICKSIGN.
 *
 * ⚠️ CANCELAR NÃO É APAGAR, e a diferença é o que decide quando se usa isto. O `DELETE` de
 * `desfazer`, ali em cima, só existe ANTES do passo 5: rascunho apaga e some. Depois de `running` o
 * envelope é permanente — cancelar apenas o fecha, e ele continua na lista da conta PARA SEMPRE,
 * visível ao lado dos contratos de verdade. Não é operação de faxina; é o preço de ter mandado.
 *
 * ⚠️ E É ISTO QUE TIRA O CONTRATO VELHO DA MÃO DE QUEM IA ASSINAR. Lucas (11/09/2026), sobre voltar
 * o card para a análise já com o contrato na rua: *"pode cancelar o envelope"*. Sem o cancelamento,
 * alguém assinaria a versão VELHA enquanto a nova está sendo corrigida — e essa assinatura vale
 * juridicamente.
 *
 * ⚠️ QUEM CHAMA ISTO É O RETORNO PARA CORREÇÃO, E EM QUALQUER ETAPA EM QUE O ENVELOPE AINDA ESTEJA
 * VIVO — inclusive no Pré-faturamento (Lucas, 12/09/2026: *"prefaturamento pode desde que nao esteja
 * todo assinado"*). Envelope ASSINADO nunca chega aqui: a volta é recusada antes, porque assinatura
 * não se desfaz e o caminho passa a ser o distrato. Ver `lib/temis/retorno-para-correcao.ts`.
 *
 * ⚠️ E O "NUNCA CHEGA AQUI" DEPENDE DE `consultarEnvelope`, NÃO DO NOSSO BANCO. `temis_envelopes`
 * só é escrito pelo webhook, e entre a última assinatura e o evento chegar existe uma janela real —
 * quem chama LÊ o estado na Clicksign imediatamente antes de cancelar. Cancelar confiando no estado
 * gravado mataria contrato assinado por todos, e `cancelado` é terminal: o `auto_close` que chegasse
 * depois seria descartado.
 *
 * ⚠️ A FORMA DO PATCH NÃO ESTÁ CONFERIDA NA DOC — E ESTE AVISO É DELIBERADO. Ela é a mesma do passo
 * 5 (o PATCH que ativa) com `status: "canceled"` no lugar de `"running"`, porque `canceled` é um dos
 * quatro estados do envelope na v3 (`draft`, `running`, `closed`, `canceled`) e o passo 5 é o único
 * lugar onde esta casa já viu a v3 trocar status de envelope. É INFERÊNCIA, não leitura da página de
 * cancelamento. Este arquivo já teve TRÊS campos com comentário confiante afirmando o contrário da
 * doc (o `Bearer` no token, o PDF em base64 cru, o CPF sem máscara) — e os três só apareceram na
 * primeira chamada real. Quem confirmar na doc (ou no primeiro cancelamento de verdade), troque
 * este parágrafo pela citação.
 *
 * ⚠️ NUNCA LANÇA. Quem chama decide o que fazer com a falha, e no retorno para correção a decisão é
 * FECHAR: o card não volta se o envelope não morreu.
 */
export async function cancelarEnvelope(
  envelopeId: string,
  porta: PortaDaClicksign = chamar,
): Promise<ResultadoDoCancelamento> {
  const id = envelopeId.trim();
  // ⚠️ SEM ID NÃO SE CHAMA NADA. `PATCH /envelopes/` (com o id vazio) bateria em outra rota da API,
  // e uma resposta 200 dali seria lida aqui como "cancelado" — a pior mentira possível neste lugar.
  if (!id) {
    return {
      // Nada foi chamado: não há dúvida nenhuma sobre ter chegado.
      duvidoso: false,
      envelopeId: "",
      erro: "Sem o id do envelope não dá para cancelar na Clicksign.",
      ok: false,
      requestId: null,
    };
  }

  try {
    await porta(`/envelopes/${id}`, {
      corpo: { data: { attributes: { status: "canceled" }, id, type: "envelopes" } },
      metodo: "PATCH",
    });
    return { envelopeId: id, ok: true };
  } catch (e) {
    return {
      // Ver a nota de `duvidoso`: sem resposta HTTP (status 0), ou erro que nem veio da Clicksign,
      // não dá para afirmar que o PATCH não chegou.
      duvidoso: !(e instanceof FalhaDaClicksign) || e.erro.status === 0,
      envelopeId: id,
      erro: detalheDaFalha(e),
      ok: false,
      requestId: e instanceof FalhaDaClicksign ? e.erro.requestId : null,
    };
  }
}

/**
 * A mensagem da falha, legível.
 *
 * ⚠️ OS `detalhes` DO JSON:API SÃO A METADE ÚTIL. "Clicksign devolveu 422" não diz nada; o que
 * resolve é o `/data/attributes/...` que vem junto. É a mesma frase que o envio monta desde o
 * primeiro dia — está aqui para o cancelamento não inventar uma segunda.
 */
function detalheDaFalha(e: unknown): string {
  if (!(e instanceof FalhaDaClicksign)) return String(e);
  return [e.message, ...e.erro.detalhes].filter(Boolean).join(" · ");
}

// ── O QUE VAI EM CADA CAMPO ─────────────────────────────────────────────────

/** O teto de 90 dias da Clicksign, contados do upload. */
const PRAZO_MAXIMO_DIAS = 90;

function atributosDoEnvelope(nome: string, pedido: PedidoDeEnvio): Record<string, unknown> {
  const atributos: Record<string, unknown> = {
    // ⚠️ `auto_close` LIGADO: o envelope fecha sozinho na última assinatura. É o default deles e é o
    // que queremos — fechar à mão exigiria alguém lembrando de fechar, e o PDF assinado só fica
    // disponível depois do fechamento.
    auto_close: true,
    // ⚠️ `block_after_refusal` LIGADO, e o default deles é DESLIGADO. Num contrato, se o comprador
    // recusa, a vendedora NÃO deve assinar em seguida — o documento morreu ali. Sem isto, uma
    // recusa deixaria o fluxo correndo e colheria a formalidade do nosso lado num negócio desfeito.
    block_after_refusal: true,
    // ⚠️ `canceled` E NÃO `closed`. A Clicksign pode FECHAR o envelope no vencimento com as
    // assinaturas que tiver: um contrato com o comprador assinado e a vendedora não viraria
    // `closed`, com cara de concluído e sem valor nenhum. Ver a nota de `estadoDaClicksign`.
    deadline_partial_signature_action: "canceled",
    locale: "pt-BR",
    name: nome,
  };

  // ⚠️ O ASSUNTO TEM TETO DE 100 CARACTERES na doc deles, e estourar é 422 no passo 1.
  atributos.default_subject = cortar(`Assinatura do contrato — ${nome}`, 100);

  if (pedido.mensagem?.trim()) atributos.default_message = pedido.mensagem.trim();

  if (typeof pedido.prazoEmDias === "number" && pedido.prazoEmDias > 0) {
    const dias = Math.min(Math.floor(pedido.prazoEmDias), PRAZO_MAXIMO_DIAS);
    const quando = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
    atributos.deadline_at = quando.toISOString();
  }

  return atributos;
}

function atributosDoSignatario(
  pessoa: Signatario,
  semCpf = false,
): Record<string, unknown> {
  const digitos = semCpf ? "" : String(pessoa.cpf ?? "").replace(/\D/g, "");
  // ⚠️ SÓ CPF, NUNCA CNPJ. O campo `documentation` da Clicksign é o CPF de uma PESSOA; um comprador
  // PJ tem 14 dígitos e mandá-los ali faz o cadastro do signatário ser recusado. Quem assina por uma
  // empresa é o representante — e o CPF dele é que entraria, quando o Panteon o tiver.
  const temCpf = digitos.length === 11;

  // ⚠️ COM MÁSCARA, `000.000.000-00` — e o código mandava só os 11 dígitos, o que derrubou o
  // PRIMEIRO ENVIO REAL (09/09/2026): a Clicksign devolveu 400 com
  // `/data/attributes/documentation não está em um formato válido`. A doc do endpoint é explícita:
  // *"Informe o CPF do signatário formatado (ex: 000.000.000-00)"*.
  //
  // ⚠️ E OS DÍGITOS CONTINUAM SENDO A FONTE, com a máscara montada aqui: o CPF chega do cadastro
  // ora `999.999.004-53`, ora `99999900453`, e reaproveitar o que veio faria o formato depender de
  // como alguém digitou na ficha.
  const cpfFormatado = temCpf
    ? `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`
    : "";

  return {
    // ⚠️ `group` COMEÇA EM 1, e é aqui que a ordem de assinatura vira comportamento. Nossa
    // `ordenarSignatarios` devolve 0 quando NINGUÉM espera ninguém (o padrão de hoje) e 1..N quando
    // a ordem está ligada; o default da Clicksign é 1. Mandar 0 seria um valor que a doc não prevê,
    // então o paralelo vira "todo mundo no grupo 1", que é exatamente o mesmo comportamento.
    group: Math.max(1, pessoa.ordem),
    // ⚠️ SEM CPF, `has_documentation: false` — e não "manda vazio". Com a bandeira ligada (o default
    // deles) a Clicksign PEDE CPF e data de nascimento na hora de assinar; um comprador cujo
    // cadastro não tem CPF ficaria travado na tela do provedor, sem ter o que digitar.
    has_documentation: temCpf,
    ...(temCpf ? { documentation: cpfFormatado } : {}),
    email: pessoa.email.trim(),
    name: pessoa.nome.trim(),
    // ⚠️ PODE RECUSAR, e isso é deliberado. Sem `refusable` o comprador que não concorda simplesmente
    // não assina, e o contrato fica "aguardando" para sempre — indistinguível de quem ainda não
    // abriu o e-mail. Com a recusa, a Têmis sabe que acabou (e `block_after_refusal` para o resto).
    refusable: true,
  };
}

/**
 * O `role` do requisito de qualificação.
 *
 * ⚠️ A CLICKSIGN SÓ TEM TRÊS: `sign`, `party` e `contractor`. Nenhum deles é "cônjuge" ou
 * "vendedora" — os sete papéis do contrato não cabem lá, e é por isso que o papel de verdade mora
 * no NOSSO registro (ver `PapelNoContrato` em `../tipos.ts`) e só a qualificação jurídica atravessa.
 *
 * ⚠️ TODO MUNDO ASSINA COMO `sign`, inclusive a testemunha. `party` e `contractor` descrevem a
 * posição no negócio, não o ato; escolher errado imprime uma qualificação errada no rodapé do PDF
 * assinado — e o rodapé é o que o cartório lê.
 */
function papelDaClicksign(_papel: PapelNoContrato): string {
  return "sign";
}

/**
 * O nome do envelope na lista da Clicksign.
 *
 * ⚠️ ELE PRECISA SER LIDO NUMA LISTA COM CONTRATO DE VERDADE. O primeiro uso é o ZZ TESTE EM
 * PRODUÇÃO: o envelope vai conviver na mesma conta com contratos que valem, e depois de ativado não
 * se apaga. `[TESTE]` na frente é o que impede alguém de abrir a lista daqui a um mês e tratar o
 * ensaio como negócio.
 *
 * ⚠️ E O MARCADOR SAI DO PRÓPRIO DADO, não de um parâmetro que alguém marca na tela. Marcar à mão
 * significaria esquecer de marcar exatamente na pressa do primeiro teste, que é quando importa.
 */
export function nomeDoEnvelope(identidade: IdentidadeDoEnvelope): string {
  const pedacos = [
    "Contrato",
    identidade.empreendimento.trim(),
    identidade.unidade.trim(),
    identidade.comprador.trim(),
  ].filter((p) => p.length > 0);

  const prefixo = ehDeTeste(identidade.empreendimento) ? "[TESTE] " : "";
  return cortar(`${prefixo}${pedacos.join(" - ")}`, 180);
}

/**
 * O empreendimento é o de teste?
 *
 * ⚠️ O CÓDIGO É `TST` E O NOME É "ZZ TESTE - nao e empreendimento real" — medido no banco em
 * 08/09/2026. As duas formas entram porque a identidade pode carregar o código (o caso normal) ou o
 * nome, quando o empreendimento não tem código.
 */
function ehDeTeste(empreendimento: string): boolean {
  const t = empreendimento.trim().toUpperCase();
  return t === "TST" || t.includes("TESTE") || t.startsWith("ZZ ");
}

/**
 * Os metadados que voltam no webhook.
 *
 * ⚠️ SÓ O DOCUMENTO TEM ESTE CAMPO — medido na doc da v3: a tabela de campos do ENVELOPE não tem
 * nenhum lugar para dado nosso, e a do DOCUMENTO tem `metadata`, "encaminhado via webhooks". É por
 * isso que a identidade viaja no documento e não no envelope.
 *
 * ⚠️ E NÃO VAI CPF AQUI. O metadata volta no corpo de todo evento do webhook, e o log de webhook é
 * legível por quem tem acesso ao projeto — a mesma régua que já vale para o payload em
 * `app/api/publico/clicksign/webhook/route.ts`. Empreendimento, unidade e ids bastam para achar a
 * venda; o nome do comprador entra porque ele já está no nome do envelope, visível na lista.
 */
function metadadosDoDocumento(identidade: IdentidadeDoEnvelope): Record<string, string> {
  const meta: Record<string, string> = {
    comprador: identidade.comprador.trim(),
    empreendimento: identidade.empreendimento.trim(),
    origem: "panteon",
    unidade: identidade.unidade.trim(),
  };
  if (identidade.propostaId) meta.proposta_id = identidade.propostaId;
  if (identidade.documentoId) meta.documento_id = identidade.documentoId;
  if (ehDeTeste(identidade.empreendimento)) meta.teste = "true";
  return meta;
}

/**
 * ⚠️ A CLICKSIGN EXIGE A EXTENSÃO NO `filename` — está na regra de negócio do campo. O nome que sai
 * de `nomeDoContrato` já termina em `.pdf`, mas quem chamar daqui a um ano pode não saber disso, e
 * o erro só apareceria no passo 2, com o envelope já criado.
 */
function comExtensaoPdf(nome: string): string {
  const limpo = nome.trim() || "contrato.pdf";
  return /\.pdf$/i.test(limpo) ? limpo : `${limpo}.pdf`;
}

function cortar(texto: string, teto: number): string {
  return texto.length <= teto ? texto : texto.slice(0, teto).trimEnd();
}
