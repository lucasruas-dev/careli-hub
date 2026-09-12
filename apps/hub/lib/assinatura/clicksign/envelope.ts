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
      const id = await cadastrarSignatario(envelopeId, pessoa, pedido.semCpf === true, porta);
      idPorEmail[pessoa.email.trim().toLowerCase()] = id;
    }
  } catch (e) {
    return falhar("signatarios", e);
  }

  // ── 4. OS REQUISITOS ──────────────────────────────────────────────────────
  try {
    for (const pessoa of pedido.signatarios) {
      const signerId = idPorEmail[pessoa.email.trim().toLowerCase()];
      if (!signerId) continue;
      await cadastrarRequisitos(envelopeId, { documentoId, papel: pessoa.papel, signerId }, porta);
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

// ── OS PASSOS 3 E 4, EM UM LUGAR SÓ ─────────────────────────────────────────
//
// ⚠️ ELES SAÍRAM DE DENTRO DO ENVIO PARA PODEREM SER REUSADOS PELA TROCA DE E-MAIL, e não por
// gosto de função pequena. Acrescentar um signatário a um envelope vivo é EXATAMENTE o passo 3
// seguido do passo 4 — e uma segunda cópia deste código é o defeito calado descrito abaixo: quem
// copiasse só o `POST /signers` deixaria a pessoa pendurada no envelope sem nada para assinar.
//
// ⚠️ OS DOIS LANÇAM, de propósito. É o contrato interno do envio, cujo `falhar(passo, e)` depende
// da exceção para saber em que passo parou e se precisa apagar o rascunho. Quem chama de fora usa
// `acrescentarSignatario`, que embrulha os dois e devolve resultado tipado.

/** Cadastra UMA pessoa no envelope e devolve o id dela. ⚠️ LANÇA — é o corpo do passo 3. */
async function cadastrarSignatario(
  envelopeId: string,
  pessoa: Signatario,
  semCpf: boolean,
  porta: PortaDaClicksign,
): Promise<string> {
  const criado = await porta<RespostaComId>(`/envelopes/${envelopeId}/signers`, {
    corpo: {
      data: {
        attributes: atributosDoSignatario(pessoa, semCpf),
        type: "signers",
      },
    },
    metodo: "POST",
  });
  const id = String(criado?.data?.id ?? "");
  if (!id) throw new Error(`A Clicksign cadastrou ${pessoa.nome} e não devolveu o id.`);
  return id;
}

/**
 * Os DOIS requisitos de uma pessoa. ⚠️ LANÇA — é o corpo do passo 4.
 *
 * ⚠️ SÃO DOIS POR PESSOA, E OS DOIS SÃO OBRIGATÓRIOS. `agree` diz o QUE a pessoa faz com o
 * documento (assinar, como parte); `provide_evidence` diz COMO ela prova que é ela. Sem o segundo,
 * o signatário não tem método de autenticação e o envelope não roda.
 *
 * ⚠️ E ESTA É A FALHA QUE NÃO APARECE. Um signatário criado SEM os requisitos recebe o convite,
 * abre o documento e não tem o que assinar — o envelope nunca fecha, e não há erro em lugar nenhum
 * para explicar por quê.
 */
async function cadastrarRequisitos(
  envelopeId: string,
  alvo: { documentoId: string; papel: PapelNoContrato; signerId: string },
  porta: PortaDaClicksign,
): Promise<void> {
  for (const attributes of [
    { action: "agree", role: papelDaClicksign(alvo.papel) },
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
            document: { data: { id: alvo.documentoId, type: "documents" } },
            signer: { data: { id: alvo.signerId, type: "signers" } },
          },
          type: "requirements",
        },
      },
      metodo: "POST",
    });
  }
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

// ── A TROCA DE SIGNATÁRIO E O REENVIO DO CONVITE ────────────────────────────
//
// ⚠️ ELAS EXISTEM POR UM CASO MEDIDO EM PRODUÇÃO (12/09/2026). O contrato foi para dois
// signatários; o convite do segundo voltou — HardBounce, `550 5.1.1 The email account that you
// tried to reach does not exist` —, porque o endereço tinha uma letra a menos. A compradora assinou,
// o cônjuge nunca recebeu nada, e o envelope não tinha como fechar. Lucas, no mesmo dia: *"teria que
// ter um forma de editarmos o e-mail e enviar o contrato dele somente"* e *"ocorre muito do e-mail
// esta correto mais o cliente nao recebeu, ae teria que ter um botao para reenviar o contrato"*.
//
// ⚠️ AS DUAS MEXEM EM ENVELOPE VIVO, DA CONTA DE PRODUÇÃO. Nada aqui é rascunho: o envelope está
// `running`, com gente assinando do outro lado. Por isso as duas NUNCA LANÇAM e devolvem o status —
// quem orquestra (`lib/temis/trocar-signatario.ts`) precisa distinguir os desfechos para saber se
// pode continuar, e a diferença entre eles é o que decide se um contrato fecha ou fica pendurado.

/** O que sai de uma remoção que deu certo. */
export type SignatarioRemovido = { ok: true };

export type FalhaAoRemoverSignatario = {
  erro: string;
  /**
   * ⚠️ 403 = A CLICKSIGN RECUSOU PORQUE A PESSOA JÁ ASSINOU, e esta é a trava principal da troca —
   * do lado DELES, não do nosso: *"Já assinou um documento. Não pode ser excluído"*. O endpoint só
   * remove quem NÃO iniciou o processo de assinatura.
   *
   * ⚠️ POR ISSO ELE VIAJA SEPARADO DO RESTO. Virar "falhou ao remover" genérico faria a tela mandar
   * tentar de novo uma operação que a API vai recusar para sempre — e o caminho de quem já assinou
   * não é trocar o e-mail, é outro contrato.
   */
  jaAssinou: boolean;
  /** 404 = este signatário não está neste envelope (ou já foi removido). */
  naoEncontrado: boolean;
  ok: false;
  /** `X-Request-Id` da Clicksign — é o que o suporte deles pede. */
  requestId: null | string;
  /** O status HTTP. `0` quando não houve resposta nenhuma (timeout, rede, env faltando). */
  status: number;
};

export type ResultadoDaRemocao = FalhaAoRemoverSignatario | SignatarioRemovido;

/**
 * TIRA UM SIGNATÁRIO DO ENVELOPE — `DELETE /envelopes/{id}/signers/{signer_id}`.
 *
 * A doc (conferida em 12/09/2026) dá quatro desfechos: 204 removido, 403 *"Já assinou um documento.
 * Não pode ser excluído"*, 404 e 503. Funciona com o envelope em `running`, que é o único estado em
 * que isto é usado.
 *
 * ⚠️ É O PONTO SEM VOLTA DA TROCA DE E-MAIL. Removido, o signatário não volta: quem chama tem de
 * recriá-lo em seguida, e uma falha depois daqui deixa a pessoa FORA de um envelope que não fecha
 * mais sozinho. Ver a sequência inteira em `lib/temis/trocar-signatario.ts`.
 *
 * ⚠️ NUNCA LANÇA — como o cancelamento. Quem chama decide, e aqui a decisão depende do 403.
 */
export async function removerSignatario(
  envelopeId: string,
  signerId: string,
  porta: PortaDaClicksign = chamar,
): Promise<ResultadoDaRemocao> {
  const envelope = envelopeId.trim();
  const signer = signerId.trim();

  // ⚠️ SEM OS DOIS IDS NÃO SE CHAMA NADA, pelo mesmo motivo do cancelamento: `DELETE
  // /envelopes/{id}/signers/` (com o signer vazio) bate na COLEÇÃO de signatários, e não na pessoa.
  // Uma resposta boa dali seria lida aqui como "removido" — e o passo seguinte recriaria alguém que
  // nunca saiu, deixando DOIS signatários com o mesmo nome no envelope.
  if (!envelope || !signer) {
    return {
      erro: "Sem o id do envelope e o do signatário não dá para remover ninguém na Clicksign.",
      jaAssinou: false,
      naoEncontrado: false,
      ok: false,
      requestId: null,
      status: 0,
    };
  }

  try {
    await porta(`/envelopes/${envelope}/signers/${signer}`, { metodo: "DELETE" });
    return { ok: true };
  } catch (e) {
    const falha = e instanceof FalhaDaClicksign ? e : null;
    const status = falha?.erro.status ?? 0;
    return {
      erro: detalheDaFalha(e),
      jaAssinou: status === 403,
      naoEncontrado: status === 404,
      ok: false,
      requestId: falha?.erro.requestId ?? null,
      status,
    };
  }
}

/** O que sai de uma notificação que deu certo. */
export type ConviteNotificado = { ok: true };

export type FalhaAoNotificar = {
  erro: string;
  /**
   * ⚠️ 429 = O TETO DE ENVIO, E "ESPERE UM MINUTO" NÃO É "DEU ERRO". A doc indica cerca de UMA
   * notificação por minuto por endpoint, e o botão de reenviar convite é exatamente o que alguém
   * clica duas vezes quando o cliente diz que não recebeu. Misturar o teto com falha de verdade
   * faria a tela mandar conferir a Clicksign quando o que resolve é esperar.
   */
  limiteDeEnvio: boolean;
  ok: false;
  /** `X-Request-Id` da Clicksign — é o que o suporte deles pede. */
  requestId: null | string;
  /** O status HTTP. `0` quando não houve resposta nenhuma (timeout, rede, env faltando). */
  status: number;
};

export type ResultadoDaNotificacao = ConviteNotificado | FalhaAoNotificar;

/**
 * MANDA O CONVITE DE NOVO, SÓ PARA ESTA PESSOA —
 * `POST /envelopes/{id}/signers/{signer_id}/notifications`.
 *
 * ⚠️ É DIFERENTE DO `POST /envelopes/{id}/notifications` DO PASSO 6 DO ENVIO, e a diferença é o
 * ponto: aquele avisa TODO MUNDO. Num envelope em que a compradora já assinou, reenviar para todos
 * põe na caixa de entrada dela um convite de um contrato que ela já assinou — e é o tipo de e-mail
 * que gera ligação para o atendimento. Lucas, 12/09/2026: *"enviar o contrato dele somente"*.
 *
 * ⚠️ `mensagem` É OPCIONAL NA DOC, e vazia a Clicksign usa a mensagem padrão dela — que é a mesma
 * que o convite original levou. Mandar o campo vazio seria trocar o texto conhecido por um branco.
 *
 * ⚠️ NUNCA LANÇA. Ver a nota da remoção.
 */
export async function notificarSignatario(
  envelopeId: string,
  signerId: string,
  mensagem?: string,
  porta: PortaDaClicksign = chamar,
): Promise<ResultadoDaNotificacao> {
  const envelope = envelopeId.trim();
  const signer = signerId.trim();

  // Sem os dois ids a chamada bateria em outra rota — ver a nota da remoção.
  if (!envelope || !signer) {
    return {
      erro: "Sem o id do envelope e o do signatário não dá para reenviar o convite na Clicksign.",
      limiteDeEnvio: false,
      ok: false,
      requestId: null,
      status: 0,
    };
  }

  const texto = mensagem?.trim() ?? "";

  try {
    await porta(`/envelopes/${envelope}/signers/${signer}/notifications`, {
      corpo: {
        data: {
          attributes: texto ? { message: texto } : {},
          type: "notifications",
        },
      },
      metodo: "POST",
    });
    return { ok: true };
  } catch (e) {
    const falha = e instanceof FalhaDaClicksign ? e : null;
    const status = falha?.erro.status ?? 0;
    return {
      erro: detalheDaFalha(e),
      // ⚠️ O 429 DELES VOLTA EM TEXTO PURO, não em JSON:API — medido no estudo e tratado em
      // `chamar`, que preserva o status mesmo quando o corpo não é JSON. É por isso que a régua aqui
      // é o STATUS, e não o texto da mensagem.
      limiteDeEnvio: status === 429,
      ok: false,
      requestId: falha?.erro.requestId ?? null,
      status,
    };
  }
}

export type SignatarioAcrescentado = { ok: true; signerId: string };

export type FalhaAoAcrescentar = {
  erro: string;
  ok: false;
  /**
   * Em que passo parou — e os dois desfechos são MUITO diferentes.
   *
   * ⚠️ `signatario`: ninguém entrou, o envelope ficou como estava. `requisitos`: a pessoa ENTROU no
   * envelope sem ter o que assinar — o convite chega, ela abre, não há nada para fazer, e o
   * envelope nunca fecha. Quem chama precisa dizer isso em português, porque é o desfecho que
   * exige alguém agir.
   */
  passo: "requisitos" | "signatario";
  /** `X-Request-Id` da Clicksign — é o que o suporte deles pede. */
  requestId: null | string;
  /** O signatário criado, quando a falha foi nos requisitos. `null` = nada foi criado. */
  signerId: null | string;
  /** O status HTTP. `0` quando não houve resposta nenhuma (timeout, rede, env faltando). */
  status: number;
};

export type ResultadoDoAcrescimo = FalhaAoAcrescentar | SignatarioAcrescentado;

/**
 * PÕE UMA PESSOA NUM ENVELOPE QUE JÁ ESTÁ RODANDO — o passo 3 e o passo 4 do envio, nesta ordem.
 *
 * ⚠️ É A MESMA PEÇA DO ENVIO, E ISSO É O PONTO. Ela chama `cadastrarSignatario` e
 * `cadastrarRequisitos`, os mesmos que os passos 3 e 4 usam: o dia em que o requisito mudar, muda
 * nos dois. Uma segunda implementação aqui produziria o defeito calado de sempre — signatário no
 * envelope, sem nada para assinar.
 *
 * ⚠️ NUNCA LANÇA, e devolve em que passo parou. Ver a nota de `passo`.
 */
export async function acrescentarSignatario(
  envelopeId: string,
  alvo: { documentoId: string; pessoa: Signatario; semCpf?: boolean },
  porta: PortaDaClicksign = chamar,
): Promise<ResultadoDoAcrescimo> {
  const envelope = envelopeId.trim();
  const documentoId = alvo.documentoId.trim();

  // ⚠️ SEM O ID DO DOCUMENTO NÃO SE CRIA NINGUÉM. O requisito aponta para o documento, e criar o
  // signatário primeiro para descobrir depois que o documento não é conhecido deixaria exatamente a
  // pessoa pendurada que esta função existe para evitar. Quem chama confere ANTES — ver
  // `lib/temis/trocar-signatario.ts`, que barra a troca quando `provedor_documento_id` está nulo.
  if (!envelope || !documentoId) {
    return {
      erro: "Sem o id do envelope e o do documento não dá para acrescentar signatário na Clicksign.",
      ok: false,
      passo: "signatario",
      requestId: null,
      signerId: null,
      status: 0,
    };
  }

  let signerId = "";
  try {
    signerId = await cadastrarSignatario(envelope, alvo.pessoa, alvo.semCpf === true, porta);
  } catch (e) {
    const falha = e instanceof FalhaDaClicksign ? e : null;
    return {
      erro: detalheDaFalha(e),
      ok: false,
      passo: "signatario",
      requestId: falha?.erro.requestId ?? null,
      signerId: null,
      status: falha?.erro.status ?? 0,
    };
  }

  try {
    await cadastrarRequisitos(envelope, { documentoId, papel: alvo.pessoa.papel, signerId }, porta);
  } catch (e) {
    const falha = e instanceof FalhaDaClicksign ? e : null;
    return {
      erro: detalheDaFalha(e),
      ok: false,
      passo: "requisitos",
      requestId: falha?.erro.requestId ?? null,
      // O id vai junto: é por ele que se conserta à mão o que ficou pela metade.
      signerId,
      status: falha?.erro.status ?? 0,
    };
  }

  return { ok: true, signerId };
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
