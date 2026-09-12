import { chamar, FalhaDaClicksign, type PortaDaClicksign } from "./cliente";

import type { PapelNoContrato, Signatario } from "../tipos";

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
    const detalhe = falha ? [falha.message, ...falha.erro.detalhes].filter(Boolean).join(" · ") : String(e);
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
