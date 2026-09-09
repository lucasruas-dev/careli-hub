import type { SupabaseClient } from "@supabase/supabase-js";

import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import {
  contratoVigente,
  type IdentidadeDoContrato,
  identidadeDoContrato,
  TIPO_CONTRATO,
  versaoDoNome,
} from "@/lib/temis/contrato-guardado";
import { dadosDaProposta } from "@/lib/temis/dados-do-contrato";

import { enviarParaAssinatura, type PedidoDeEnvio } from "./clicksign/envelope";
import { type PortaDaClicksign } from "./clicksign/cliente";
import { moverCardDaTemis } from "./estado-db";
import { ordenarSignatarios, type RegraDeOrdem } from "./ordem";
import { descreverOrigem, type OrigemDaRegra, regraDeOrdemDaVenda } from "./ordem-db";
import { conferirSignatarios, type Pessoa, signatariosDoContrato } from "./signatarios";
import { chaveDoSignatario, type Signatario } from "./tipos";

// O ENVIO, DO LADO DO BANCO — juntar o papel, quem assina e a ordem, e registrar o que saiu.
//
// ⚠️ O PDF NÃO É GERADO DE NOVO AQUI, E ISSO É O PONTO. O contrato já foi gerado, conferido e
// guardado em `hercules_documentos` com número de versão (`contrato-guardado-db.ts`); é ESSE arquivo
// que vai para a assinatura. Gerar de novo na hora de enviar produziria um PDF que ninguém viu — e
// o que o comprador assinaria não seria o que foi aprovado na prévia. Quando há mais de uma versão,
// vale `contratoVigente`, a mesma regra que as três telas já usam.
//
// ⚠️ A LINHA DE REGISTRO NASCE ANTES DA CHAMADA. Ver a ATENÇÃO 1 da migration 0147: a conta é de
// PRODUÇÃO e o envelope ativado não se apaga. Se a linha só existisse depois de a Clicksign
// responder, uma queda no meio deixaria um envelope pago e permanente na conta do qual o Panteon não
// teria notícia nenhuma. A ordem é: grava a intenção → chama → carimba o resultado.
//
// ⚠️ E O ENVIO PARA ANTES DE COMEÇAR quando a tabela não existe. A alternativa — mandar e não
// conseguir gravar — é exatamente o estrago que a ordem acima evita.

export type ContratoParaAssinar = {
  criadoEm: string;
  documentoId: string;
  nome: string;
  unidadeId: null | string;
  versao: null | number;
};

export type PreparoDoEnvio = {
  /** O que falta e não impede o envio (a vendedora sem cadastro é o caso de hoje). */
  avisos: string[];
  contrato: ContratoParaAssinar;
  identidade: IdentidadeDoContrato;
  ok: true;
  /** De onde a ordem veio: categoria, empreendimento, ou o padrão da casa. */
  origemDaRegra: OrigemDaRegra;
  /** A frase pronta, para a tela. */
  origemDescrita: string;
  regra: RegraDeOrdem;
  /** Já com o número da ordem resolvido — é o que a tela mostra e o que vai para a Clicksign. */
  signatarios: Signatario[];
  /** Vazio quando dá para enviar; a frase do impedimento quando não dá. */
  impedimento: null | string;
};

export type FalhaNoPreparo = { erro: string; ok: false; status: 404 | 409 | 503 };

/**
 * Tudo que a tela de envio precisa mostrar ANTES de alguém confirmar.
 *
 * ⚠️ ELA NÃO RECUSA POR IMPEDIMENTO, DEVOLVE O IMPEDIMENTO. A tela precisa mostrar a lista de quem
 * assina MESMO quando falta e-mail de alguém — é olhando a lista que o operador entende o que
 * corrigir. Recusar aqui devolveria uma frase solta, sem os nomes ao lado. Quem recusa de verdade é
 * o POST, com a mesma função (`conferirSignatarios`), antes de tocar a API.
 */
export async function prepararEnvio(
  sb: SupabaseClient,
  propostaId: string,
  ordemEscolhida?: null | RegraDeOrdem,
  emailsEscolhidos?: null | Record<string, string>,
): Promise<FalhaNoPreparo | PreparoDoEnvio> {
  const contrato = await contratoVigenteDaProposta(sb, propostaId);
  if (!contrato.ok) return contrato;

  const resolvido = await dadosDaProposta(propostaId, sb);
  if (!resolvido) return { erro: "Proposta não encontrada.", ok: false, status: 404 };

  const titular = resolvido.dados.compradores[0]?.valores.nome_cliente ?? "";
  const identidade = identidadeDoContrato(resolvido.dados.gerais, titular);
  const montagem = signatariosDoContrato(resolvido.dados);

  // ⚠️ A ORDEM ESCOLHIDA GANHA DO CADASTRO, E NÃO VOLTA PARA ELE. Lucas, 08/09/2026: *"claro que
  // temos que ter a opção de alterar antes de enviar o contrato, mas vem preenchido por padrão"*. O
  // que o operador mudar vale só para este envio; gravar de volta faria uma exceção de um contrato
  // virar a política do empreendimento inteiro, silenciosamente.
  const doCadastro = await regraDeOrdemDaVenda(sb, {
    enterpriseId:
      resolvido.dados.gerais.__empreendimento_id ?? resolvido.dados.gerais.__unidade_enterprise_id ?? null,
    unidadeId: contrato.contrato.unidadeId,
  });

  const regra = ordemEscolhida ?? doCadastro.regra;
  const origemDaRegra: OrigemDaRegra = doCadastro.origem;
  // ⚠️ O E-MAIL TROCADO NA TELA VALE SO PARA ESTE ENVIO, e nao volta para o cadastro — a mesma
  // disciplina da ordem. Lucas, 09/09/2026: *"coloca o meu e-mail e da nivea"*. No ZZ TESTE os
  // e-mails da ficha sao ficticios (`@zzteste.careli.dev`) e nenhum convite chegaria; num contrato
  // de verdade, e o caso do comprador que deu o e-mail errado no cadastro.
  //
  // ⚠️ E A TROCA ENTRA ANTES DE `conferirSignatarios`, nao depois: e essa conferencia que recusa
  // e-mail repetido entre titular e conjuge, e trocar por fora dela deixaria passar justamente a
  // armadilha que ela existe para pegar ([[reference_d4sign_escrita_armadilhas]]).
  const pessoas = emailsEscolhidos
    ? montagem.pessoas.map((p) => {
        const escolhido = emailsEscolhidos[chaveDoSignatario(p.papel, p.nome)];
        return escolhido && escolhido.trim() ? { ...p, email: escolhido.trim() } : p;
      })
    : montagem.pessoas;

  const veredito = conferirSignatarios(pessoas);

  return {
    avisos: montagem.avisos,
    contrato: contrato.contrato,
    identidade,
    impedimento: veredito.ok ? null : veredito.erro,
    ok: true,
    origemDaRegra,
    origemDescrita: ordemEscolhida
      ? "escolhida agora, só para este envio"
      : descreverOrigem(origemDaRegra),
    regra,
    signatarios: ordenarSignatarios(pessoas, regra),
  };
}

export type EnvioFeito = {
  envelopeId: string;
  nome: string;
  ok: true;
  registroId: string;
  signatarios: Signatario[];
};

export type FalhaAoEnviar = { erro: string; ok: false; status: 400 | 404 | 409 | 502 | 503 };

/**
 * Manda o contrato vigente da proposta para a Clicksign.
 *
 * `porta` é a chamada HTTP (o duplo do teste entra por aqui).
 */
export async function enviarContratoParaAssinatura(
  sb: SupabaseClient,
  pedido: {
    /** Mandar sem CPF neste envio — a Clicksign valida o documento contra a Receita. */
    semCpf?: boolean;
    /** E-mails trocados na tela, por `chaveDoSignatario`. Valem so para este envio. */
    emailsEscolhidos?: null | Record<string, string>;
    mensagem?: string;
    ordemEscolhida?: null | RegraDeOrdem;
    prazoEmDias?: number;
    propostaId: string;
    usuarioId?: null | string;
    usuarioNome?: null | string;
  },
  porta?: PortaDaClicksign,
): Promise<EnvioFeito | FalhaAoEnviar> {
  const preparo = await prepararEnvio(
    sb,
    pedido.propostaId,
    pedido.ordemEscolhida,
    pedido.emailsEscolhidos,
  );
  if (!preparo.ok) return preparo;

  // ⚠️ A RECUSA ACONTECE AQUI, ANTES DE EXISTIR ENVELOPE. E-mail repetido entre o titular e o
  // cônjuge é a armadilha conhecida ([[reference_d4sign_escrita_armadilhas]]): deixá-la falhar na
  // API deixaria um envelope criado com metade dos signatários dentro, numa conta de produção onde
  // o rascunho só se apaga enquanto ninguém ativou.
  if (preparo.impedimento) {
    return { erro: preparo.impedimento, ok: false, status: 409 };
  }

  const bytes = await baixarContrato(sb, preparo.contrato.documentoId);
  if (!bytes) {
    return { erro: "Não foi possível ler o arquivo do contrato guardado.", ok: false, status: 503 };
  }

  // ── A INTENÇÃO, GRAVADA ANTES ────────────────────────────────────────────
  const registro = await abrirRegistro(sb, {
    documentoId: preparo.contrato.documentoId,
    enterpriseId: preparo.identidade.empreendimento,
    nome: preparo.contrato.nome,
    ordenada: preparo.regra.ordenada,
    propostaId: pedido.propostaId,
    signatarios: preparo.signatarios,
    unidadeId: preparo.contrato.unidadeId,
    usuarioId: pedido.usuarioId ?? null,
    usuarioNome: pedido.usuarioNome ?? null,
  });

  if (!registro.ok) return registro;

  const paraEnviar: PedidoDeEnvio = {
    arquivo: { bytes, nome: preparo.contrato.nome },
    identidade: {
      comprador: preparo.identidade.comprador,
      documentoId: preparo.contrato.documentoId,
      empreendimento: preparo.identidade.empreendimento,
      propostaId: pedido.propostaId,
      unidade: preparo.identidade.unidade,
    },
    signatarios: preparo.signatarios,
    ...(pedido.mensagem ? { mensagem: pedido.mensagem } : {}),
    ...(pedido.prazoEmDias ? { prazoEmDias: pedido.prazoEmDias } : {}),
    ...(pedido.semCpf ? { semCpf: true } : {}),
  };

  const resultado = await enviarParaAssinatura(paraEnviar, porta);

  if (!resultado.ok) {
    await carimbarFalha(sb, registro.id, resultado);
    // ⚠️ A MENSAGEM DIZ SE SOBROU ALGO NA CONTA. "Não foi possível enviar" esconde a única coisa que
    // o operador precisa saber para não tentar de novo às cegas: se o rascunho ficou lá, uma segunda
    // tentativa cria o SEGUNDO envelope do mesmo contrato — e os dois cobram.
    const sobrou = resultado.rascunhoApagado
      ? "Nada ficou pendente na Clicksign."
      : "⚠️ Um envelope pode ter ficado na Clicksign: confira a lista antes de tentar de novo.";
    return {
      erro: `A Clicksign recusou o envio no passo "${resultado.passo}": ${resultado.erro} ${sobrou}`,
      ok: false,
      status: 502,
    };
  }

  await carimbarSucesso(sb, registro.id, resultado, preparo.signatarios);

  // ⚠️ O CARD ANDA PORQUE UM FATO ACONTECEU, e não porque alguém arrastou. O board da Têmis diz
  // "não se arrasta card: ele anda quando as atividades do estágio acabam" — mandar o contrato para
  // assinatura É o fim da confecção, medido do lado de fora (o envelope existe na Clicksign). Falha
  // aqui não desfaz nada: o contrato já saiu, e um board desatualizado se conserta na leitura
  // seguinte.
  await moverCardDaTemis(sb, pedido.propostaId, "assinatura");

  return {
    envelopeId: resultado.envelopeId,
    nome: resultado.nome,
    ok: true,
    registroId: registro.id,
    signatarios: preparo.signatarios,
  };
}

// ── AS LEITURAS ─────────────────────────────────────────────────────────────

type LinhaDoContrato = {
  caminho: string;
  criado_em: string;
  id: string;
  nome: string;
  unidade_id: null | string;
};

/** O contrato guardado que vale hoje, com o caminho do arquivo. */
async function contratoVigenteDaProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<FalhaNoPreparo | { contrato: ContratoParaAssinar; ok: true }> {
  const { data, error } = await sb
    .from("hercules_documentos")
    .select("id, nome, caminho, criado_em, unidade_id")
    .eq("workspace_id", "careli")
    .eq("tipo", TIPO_CONTRATO)
    .eq("proposta_id", propostaId)
    .is("removido_em", null)
    .order("criado_em", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[assinatura][envio] falha ao ler os contratos da proposta", error);
    return { erro: "Não foi possível ler o contrato desta proposta.", ok: false, status: 503 };
  }

  const linhas = (data ?? []) as LinhaDoContrato[];
  const vigente = contratoVigente(
    linhas.map((l) => ({ criadoEm: l.criado_em, id: l.id, nome: l.nome })),
  );

  if (!vigente) {
    return {
      erro:
        "Esta proposta ainda não tem contrato gerado. Gere o contrato na Têmis antes de mandar para assinatura.",
      ok: false,
      status: 409,
    };
  }

  const linha = linhas.find((l) => l.id === vigente.id);
  if (!linha?.caminho) {
    return { erro: "O contrato guardado está sem arquivo.", ok: false, status: 409 };
  }

  return {
    contrato: {
      criadoEm: linha.criado_em,
      documentoId: linha.id,
      nome: linha.nome,
      unidadeId: linha.unidade_id,
      versao: versaoDoNome(linha.nome),
    },
    ok: true,
  };
}

/** Os bytes do PDF guardado. `null` quando não deu para ler — e o envio não começa. */
async function baixarContrato(sb: SupabaseClient, documentoId: string): Promise<null | Uint8Array> {
  const { data, error } = await sb
    .from("hercules_documentos")
    .select("caminho")
    .eq("id", documentoId)
    .maybeSingle();

  const caminho = (data as null | { caminho: null | string })?.caminho ?? "";
  if (error || !caminho) {
    console.error("[assinatura][envio] falha ao achar o caminho do contrato", error);
    return null;
  }

  const baixado = await sb.storage.from(APOLO_DOCS_BUCKET).download(caminho);
  if (baixado.error || !baixado.data) {
    console.error("[assinatura][envio] falha ao baixar o contrato do bucket", baixado.error);
    return null;
  }

  return new Uint8Array(await baixado.data.arrayBuffer());
}

// ── O REGISTRO ──────────────────────────────────────────────────────────────

/**
 * A linha que diz "este contrato está indo para assinatura".
 *
 * ⚠️ FALHA AQUI PARA O ENVIO, e é a única falha deste arquivo que para tudo. Sem a linha, o
 * envelope existiria na Clicksign sem NADA no Panteon apontando para ele — pago, permanente e
 * invisível. O erro inclui o nome da tabela porque a causa mais provável, hoje, é a migration 0147
 * ainda não aplicada.
 */
async function abrirRegistro(
  sb: SupabaseClient,
  dados: {
    documentoId: string;
    enterpriseId: string;
    nome: string;
    ordenada: boolean;
    propostaId: string;
    signatarios: readonly Signatario[];
    unidadeId: null | string;
    usuarioId: null | string;
    usuarioNome: null | string;
  },
): Promise<FalhaAoEnviar | { id: string; ok: true }> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .insert({
      documento_id: dados.documentoId,
      enterprise_id: dados.enterpriseId || null,
      estado: "rascunho",
      nome: dados.nome,
      ordenada: dados.ordenada,
      proposta_id: dados.propostaId,
      provedor: "clicksign",
      signatarios: dados.signatarios.map((s) => ({
        email: s.email,
        nome: s.nome,
        ordem: s.ordem,
        papel: s.papel,
      })),
      unidade_id: dados.unidadeId,
      enviado_por: dados.usuarioId,
      enviado_por_nome: dados.usuarioNome,
      workspace_id: "careli",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("[assinatura][envio] falha ao abrir o registro do envelope", error);
    return {
      erro:
        "Não foi possível registrar o envio no Panteon, e por isso nada foi mandado para a Clicksign. " +
        "Confira se a migration 0147 (temis_envelopes) foi aplicada.",
      ok: false,
      status: 503,
    };
  }

  return { id: (data as { id: string }).id, ok: true };
}

async function carimbarSucesso(
  sb: SupabaseClient,
  registroId: string,
  resultado: { documentoId: string; envelopeId: string },
  signatarios: readonly Signatario[],
): Promise<void> {
  const { error } = await sb
    .from("temis_envelopes")
    .update({
      atualizado_em: new Date().toISOString(),
      // ⚠️ `aguardando`, E NÃO `rascunho`: a esta altura o envelope foi ATIVADO e notificado. Manter
      // "rascunho" faria a fila de acompanhamento ignorar um contrato que já está na mão do cliente.
      estado: "aguardando",
      estado_cru: "clicksign:running",
      envelope_id: resultado.envelopeId,
      enviado_em: new Date().toISOString(),
      provedor_documento_id: resultado.documentoId,
      signatarios: signatarios.map((s) => ({
        email: s.email,
        nome: s.nome,
        ordem: s.ordem,
        papel: s.papel,
      })),
    })
    .eq("id", registroId);

  // ⚠️ NÃO DESFAZ NADA. O envelope já está ativado e não se apaga; falhar aqui é perder o id no
  // nosso lado, não o contrato. O log é o que permite achá-lo depois.
  if (error) {
    console.error(
      "[assinatura][envio] O ENVELOPE FOI CRIADO E O REGISTRO NÃO ATUALIZOU. envelope:",
      resultado.envelopeId,
      error,
    );
  }
}

async function carimbarFalha(
  sb: SupabaseClient,
  registroId: string,
  resultado: { erro: string; passo: string; rascunhoApagado: boolean },
): Promise<void> {
  const { error } = await sb
    .from("temis_envelopes")
    .update({
      atualizado_em: new Date().toISOString(),
      falha: `passo "${resultado.passo}": ${resultado.erro}${resultado.rascunhoApagado ? "" : " (⚠️ pode ter sobrado envelope na conta)"}`,
    })
    .eq("id", registroId);

  if (error) console.error("[assinatura][envio] falha ao carimbar o erro do envio", error);
}

/** Reexportado para quem monta a tela: a lista de pessoas sem o número da ordem. */
export type { Pessoa };
