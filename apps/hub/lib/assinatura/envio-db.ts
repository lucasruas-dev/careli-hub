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

import { enviarParaAssinatura, type FalhaNoEnvio, type PedidoDeEnvio } from "./clicksign/envelope";
import { type PortaDaClicksign } from "./clicksign/cliente";
import { moverCardDaTemis } from "./estado-db";
import { ordenarSignatarios, type RegraDeOrdem } from "./ordem";
import { descreverOrigem, type OrigemDaRegra, regraDeOrdemDaVenda } from "./ordem-db";
import { conferirSignatarios, type Pessoa, signatariosDoContrato } from "./signatarios";
import { chaveDoSignatario, type EstadoDaAssinatura, type Signatario } from "./tipos";
import { rotuloDoEstado } from "./traduzir";

// O ENVIO, DO LADO DO BANCO — juntar o papel, quem assina e a ordem, e registrar o que saiu.
//
// ⚠️ O PDF NÃO É GERADO DE NOVO AQUI, E ISSO É O PONTO. O contrato já foi gerado, conferido e
// guardado em `hercules_documentos` com número de versão (`contrato-guardado-db.ts`); é ESSE arquivo
// que vai para a assinatura. Gerar de novo na hora de enviar produziria um PDF que ninguém viu — e
// o que o comprador assinaria não seria o que foi aprovado na prévia. Quando há mais de uma versão,
// vale `contratoVigente`, a mesma regra que as três telas já usam.
//
// ⚠️ A LINHA DE REGISTRO NASCE ANTES DA CHAMADA. Ver a ATENÇÃO 1 da migration 0149: a conta é de
// PRODUÇÃO e o envelope ativado não se apaga. Se a linha só existisse depois de a Clicksign
// responder, uma queda no meio deixaria um envelope pago e permanente na conta do qual o Panteon não
// teria notícia nenhuma. A ordem é: grava a intenção → chama → carimba o resultado.
//
// ⚠️ E O ENVIO PARA ANTES DE COMEÇAR quando a tabela não existe. A alternativa — mandar e não
// conseguir gravar — é exatamente o estrago que a ordem acima evita.
//
// ⚠️ ANTES DE ABRIR REGISTRO, PERGUNTA-SE SE JÁ EXISTE ENVELOPE DESTA PROPOSTA
// (`impedimentoDeEnvelopeVivo`). A tabela era escrita e nunca lida, e por isso qualquer falha
// deixava o caminho livre para um segundo clique criar o SEGUNDO envelope do mesmo contrato — dois
// `running`, dois custos, nenhum dos dois apagável.

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

export type FalhaAoEnviar = {
  /**
   * Sobrou envelope na conta da Clicksign por causa DESTA tentativa?
   *
   * ⚠️ É O QUE DIZ À TELA QUE O BOTÃO NÃO PODE VOLTAR. Ausente quer dizer "nada ficou lá" (ou "nem
   * chegou a existir envio"), e só a recusa do passo 502 tem como responder isso. A tela lia a
   * PALAVRA da mensagem — `/ficou ativo/i` — e aquela frase só existe no passo `notificar`: o
   * desfecho em que o DELETE do rascunho também falhou escreve "pode ter ficado", não casa com o
   * teste, e devolvia o dourado vivo com um envelope pago na conta. Frase é redação; campo é
   * contrato.
   */
  envelopeAtivo?: boolean;
  erro: string;
  ok: false;
  status: 400 | 404 | 409 | 502 | 503;
};

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

  // ⚠️ E AQUI SE PERGUNTA SE JÁ EXISTE UM — a pergunta que ninguém fazia. Ver
  // `impedimentoDeEnvelopeVivo`: é a única guarda contra o SEGUNDO envelope do mesmo contrato, e ela
  // vem antes de baixar o PDF porque nada do que a leitura do bucket traz muda a resposta.
  const jaTemEnvelope = await impedimentoDeEnvelopeVivo(sb, pedido.propostaId);
  if (jaTemEnvelope) return jaTemEnvelope;

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
    //
    // ⚠️ E ELA DIZ O ID, quando sobrou. "Confira a lista" manda alguém procurar à mão numa conta que
    // tem contrato de verdade dentro; com o id, a conferência é uma busca. No caso de `notificar` o
    // envelope está ATIVO e os convites NÃO saíram — é o único desfecho em que existe contrato na
    // conta e ninguém foi avisado, e quem lê precisa saber disso para decidir entre notificar por lá
    // ou cancelar.
    const sobrou = resultado.rascunhoApagado
      ? "Nada ficou pendente na Clicksign."
      : resultado.passo === "notificar"
        ? `⚠️ O envelope ${resultado.envelopeId ?? "(sem id)"} ficou ATIVO na Clicksign e os convites NÃO saíram. Ele não se apaga: confira lá antes de mandar de novo, senão o mesmo contrato vira dois envelopes.`
        : `⚠️ Um envelope pode ter ficado na Clicksign${resultado.envelopeId ? ` (${resultado.envelopeId})` : ""}: confira antes de tentar de novo.`;
    // ⚠️ E O AVISO VIAJA COMO CAMPO, NÃO SÓ COMO FRASE. `rascunhoApagado === false` só acontece
    // quando o envelope existe na conta (o `notificar`, que já está ativo, e o DELETE do rascunho
    // que falhou) — é exatamente a pergunta "posso clicar de novo?", e a tela precisa dela para
    // NÃO devolver o botão. Ver a nota de `envelopeAtivo` em `FalhaAoEnviar`.
    return {
      envelopeAtivo: !resultado.rascunhoApagado,
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
  //
  // ⚠️ E VAI ASSINADA. É a MESMA identidade que acabou de ser gravada em `abrirRegistro`: deixar a
  // passagem anônima faria o histórico dizer que o envelope de produção saiu sozinho.
  await moverCardDaTemis(sb, pedido.propostaId, "assinatura", {
    id: pedido.usuarioId ?? null,
    nome: pedido.usuarioNome ?? null,
  });

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

// ── A GUARDA CONTRA O SEGUNDO ENVELOPE ──────────────────────────────────────
//
// ⚠️ ELA MORA NO SERVIDOR PORQUE É O ÚNICO LUGAR POR ONDE TODO ENVIO PASSA. A tela pode esconder o
// botão depois de enviar, e isso vale para a tela — mas não vale para o outro cliente, para o F5, para
// o duplo clique nem para quem chama o POST direto. Uma guarda de tela protege a tela; esta protege a
// CONTA.
//
// ⚠️ E O QUE ELA IMPEDE CUSTA DINHEIRO E NÃO SE DESFAZ. Até aqui, qualquer falha depois de
// `abrirRegistro` deixava o caminho livre para um segundo clique criar OUTRO envelope do mesmo
// contrato — e o caso mais provável é justamente o pior: quando o passo `notificar` falha, o
// Panteon JÁ GRAVOU `envelope_id`, `estado = aguardando` e `estado_cru = clicksign:running`. Os dois
// envelopes ficariam `running`, os dois cobrariam, e nenhum dos dois se apaga (ver a ATENÇÃO 1 da
// 0149).

/** O que a guarda precisa ler de cada linha de `temis_envelopes` da proposta. */
export type EnvelopeDaProposta = {
  criado_em: string;
  envelope_id: null | string;
  estado: string;
  falha: null | string;
  id: string;
  provedor: string;
};

/**
 * Os estados que LIBERAM um novo envio.
 *
 * ⚠️ O REENVIO LEGÍTIMO É O CASO DE USO, e não uma exceção rara: envelope cancelado na Clicksign
 * (o webhook grava `cancelado`), recusado por quem ia assinar, ou vencido no prazo são exatamente as
 * três situações em que alguém precisa mandar o contrato DE NOVO. Uma guarda que travasse esses três
 * trocaria um problema caro por uma venda parada.
 *
 * ⚠️ `assinado` NÃO ESTÁ AQUI, e é o que mais importa: um segundo envelope de um contrato já assinado
 * produziria dois contratos assinados da mesma venda.
 */
const ESTADOS_QUE_LIBERAM_REENVIO = new Set<string>([
  "cancelado",
  "expirado",
  "recusado",
] satisfies EstadoDaAssinatura[]);

/**
 * A RÉGUA, SEPARADA DO BANCO: qual destas linhas segura o envio? `null` = nenhuma, pode mandar.
 *
 * ⚠️ ELA É PURA PORQUE PRECISA DE TESTE, e é a regra mais cara da casa: quem erra aqui cria o
 * segundo envelope de um contrato, pago e permanente, ou trava uma venda que tinha todo o direito de
 * ser reenviada. Dentro da função que faz o `select` ela só poderia ser conferida com um duplo de
 * Supabase inteiro; aqui se conferem as linhas, que é do que a regra fala.
 *
 * ⚠️ A ORDEM VEM DE QUEM CHAMA. A consulta pede `criado_em desc`, então a linha devolvida é a mais
 * recente que segura — é o id que a frase da recusa manda conferir na Clicksign, e mandar alguém
 * procurar o envelope mais VELHO seria mandar procurar o errado.
 */
export function envelopeQueSegura(linhas: EnvelopeDaProposta[]): EnvelopeDaProposta | null {
  return (
    linhas.find(
      (l) =>
        !ESTADOS_QUE_LIBERAM_REENVIO.has(l.estado) && (l.envelope_id !== null || l.falha === null),
    ) ?? null
  );
}

/**
 * Os oito estados, escritos como `Record` DE PROPÓSITO: estado novo em `EstadoDaAssinatura` sem
 * linha aqui não compila, e a frase da recusa nunca fica sem a palavra da casa.
 */
const ESTADOS_DO_ENVELOPE: Record<EstadoDaAssinatura, true> = {
  aguardando: true,
  assinado: true,
  cancelado: true,
  desconhecido: true,
  expirado: true,
  parcial: true,
  rascunho: true,
  recusado: true,
};

function ehEstadoDoEnvelope(gravado: string): gravado is EstadoDaAssinatura {
  return Object.prototype.hasOwnProperty.call(ESTADOS_DO_ENVELOPE, gravado);
}

/** O rótulo da casa para o estado gravado; valor que o código não conhece sai como ele mesmo. */
function comoSeEscreveOEstado(gravado: string): string {
  return ehEstadoDoEnvelope(gravado) ? rotuloDoEstado(gravado) : gravado;
}

/** A hora em português, para a frase. O valor cru quando a data não se lê. */
function quando(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? iso
    : data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const NOME_DO_PROVEDOR: Record<string, string> = { clicksign: "Clicksign", d4sign: "D4Sign" };

/**
 * Já existe envelope vivo desta proposta? A recusa pronta, ou `null` quando dá para enviar.
 *
 * ⚠️ A LINHA SEM `envelope_id` E SEM `falha` TAMBÉM SEGURA O ENVIO, e este é o caso desconfortável.
 * Ela quer dizer "um envio começou e o Panteon nunca soube como terminou" (a função morreu no meio,
 * o timeout da Vercel, o `carimbarFalha` que não gravou) — e o que estiver na conta da Clicksign é
 * exatamente o que não dá para saber daqui. Como não dá para distinguir com segurança, a escolha é
 * RECUSAR e dizer como destravar: um envelope pago e permanente que ninguém sabe que existe é pior
 * do que um envio que espera alguém conferir. É também esta linha que segura o duplo clique, porque
 * durante o envio normal a linha vive nesse estado.
 *
 * ⚠️ E `falha` SEM `envelope_id` LIBERA. `enviarParaAssinatura` só devolve `envelopeId` quando SOBROU
 * algo na conta — no passo 1 nada chegou a existir, e nos passos 2 a 5 o rascunho é apagado e o id
 * volta nulo de propósito. Linha com falha e sem id é, com todas as letras, "nada ficou pendente lá".
 */
async function impedimentoDeEnvelopeVivo(
  sb: SupabaseClient,
  propostaId: string,
): Promise<FalhaAoEnviar | null> {
  const { data, error } = await sb
    .from("temis_envelopes")
    // ⚠️ SEM FILTRO DE `provedor` NEM DE `workspace_id`. A pergunta é "existe envelope deste
    // contrato em algum lugar?", e um filtro a mais só teria como fazer a guarda deixar passar.
    .select("criado_em, envelope_id, estado, falha, id, provedor")
    .eq("proposta_id", propostaId)
    .order("criado_em", { ascending: false })
    .limit(50);

  if (error) {
    // ⚠️ NÃO SABER É MOTIVO PARA NÃO ENVIAR. Sem esta leitura não há guarda nenhuma, e o preço do
    // engano é um envelope pago a mais. `abrirRegistro` cairia logo adiante pelo mesmo motivo — a
    // diferença é que aqui nada foi mandado ainda.
    console.error("[assinatura][envio] falha ao procurar envelope anterior da proposta", error);
    return {
      erro:
        "Não foi possível conferir se este contrato já tem envelope aberto, e por isso nada foi mandado para a Clicksign. " +
        "Confira se a migration 0149 (temis_envelopes) foi aplicada.",
      ok: false,
      status: 503,
    };
  }

  const vivo = envelopeQueSegura((data ?? []) as EnvelopeDaProposta[]);

  if (!vivo) return null;

  const provedor = NOME_DO_PROVEDOR[vivo.provedor] ?? vivo.provedor;

  // ⚠️ A FRASE NUNCA DIZ "TENTE DE NOVO", e é a diferença entre uma recusa e uma armadilha: "de
  // novo" é exatamente o clique que cria o segundo envelope. Ela diz O QUE EXISTE (o id, o estado, a
  // hora) e as DUAS saídas reais — acompanhar o que está lá, ou cancelar por lá.
  if (!vivo.envelope_id) {
    return {
      erro:
        `Existe um envio deste contrato que começou em ${quando(vivo.criado_em)} e não terminou: o Panteon não chegou a saber se o envelope foi criado na ${provedor} (registro ${vivo.id}). ` +
        `Confira na ${provedor} se o envelope desta venda existe. Se existir, ele não se apaga: cancele por lá, que o webhook libera o reenvio aqui. Se não existir, o registro ${vivo.id} precisa ser encerrado em temis_envelopes antes de mandar de novo.`,
      ok: false,
      status: 409,
    };
  }

  if (vivo.estado === "assinado") {
    return {
      erro:
        `Este contrato JÁ FOI ASSINADO na ${provedor} (envelope ${vivo.envelope_id}). Mandar de novo criaria um segundo contrato assinado da mesma venda. ` +
        "Se o que precisa mudar é o documento, o caminho é cancelar a venda ou gerar um aditivo, e não um segundo envelope.",
      ok: false,
      status: 409,
    };
  }

  return {
    erro:
      `Este contrato já tem envelope na ${provedor}: ${vivo.envelope_id}, em "${comoSeEscreveOEstado(vivo.estado)}", aberto em ${quando(vivo.criado_em)}. ` +
      `Envelope não se apaga, só se cancela, e o cancelado fica na lista para sempre: mandar de novo deixaria DOIS envelopes do mesmo contrato cobrando. ` +
      `Confira o ${vivo.envelope_id} na ${provedor} — se ele não serve mais, cancele por lá e o webhook libera o reenvio aqui.`,
    ok: false,
    status: 409,
  };
}

// ── O REGISTRO ──────────────────────────────────────────────────────────────

/**
 * A linha que diz "este contrato está indo para assinatura".
 *
 * ⚠️ FALHA AQUI PARA O ENVIO, e é a única falha deste arquivo que para tudo. Sem a linha, o
 * envelope existiria na Clicksign sem NADA no Panteon apontando para ele — pago, permanente e
 * invisível. O erro inclui o nome da tabela porque a causa mais provável, hoje, é a migration 0149
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
        // ⚠️ 0149, E NÃO 0147. A 0147 é o gate de papel em `app_metadata`: quem seguisse esta frase
        // iria conferir a migration errada, achá-la aplicada e concluir que o defeito é outro.
        "Confira se a migration 0149 (temis_envelopes) foi aplicada.",
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

/**
 * O carimbo do que deu errado — e, quando sobrou envelope na conta, O ID DELE.
 *
 * ⚠️ ENVELOPE ATIVADO NÃO PODE SUMIR DO PANTEON, e era exatamente isso que acontecia. Se o passo 6
 * (notificar) falha, o envelope já está `running`: pago, permanente, com ninguém convidado. Antes
 * disto, a linha guardava só um texto de falha e `envelope_id` continuava nulo — ou seja, o Panteon
 * registrava que algo deu errado e não sabia dizer QUAL envelope, enquanto a fila de acompanhamento
 * ignorava a linha (estado `rascunho`) e o webhook, que casa por `envelope_id`
 * (`estado-db.ts`), não tinha por onde ligar os eventos que chegassem depois.
 *
 * ⚠️ E O ESTADO SÓ VIRA `aguardando` NO PASSO `notificar`. É o único desfecho em que se SABE que o
 * envelope está ativo. No `ativar`, a chamada pode ter estourado por timeout depois de o servidor
 * dela já ter virado o status — e afirmar "aguardando" ali seria trocar uma dúvida por uma certeza
 * falsa; o id vai gravado do mesmo jeito, que é o que permite conferir. Ver a ATENÇÃO 1 da migration
 * 0149.
 */
async function carimbarFalha(
  sb: SupabaseClient,
  registroId: string,
  resultado: { envelopeId: null | string; erro: string; passo: FalhaNoEnvio["passo"]; rascunhoApagado: boolean },
): Promise<void> {
  const ativado = resultado.passo === "notificar";
  const sobrou = ativado
    ? " (⚠️ SOBROU ENVELOPE ATIVO na conta: ele não se apaga, só se cancela, e os convites não saíram)"
    : resultado.rascunhoApagado
      ? ""
      : " (⚠️ pode ter sobrado envelope na conta)";

  const { error } = await sb
    .from("temis_envelopes")
    .update({
      atualizado_em: new Date().toISOString(),
      falha: `passo "${resultado.passo}": ${resultado.erro}${sobrou}`,
      ...(resultado.envelopeId ? { envelope_id: resultado.envelopeId } : {}),
      ...(ativado ? { estado: "aguardando", estado_cru: "clicksign:running" } : {}),
    })
    .eq("id", registroId);

  if (error) console.error("[assinatura][envio] falha ao carimbar o erro do envio", error);
}

/** Reexportado para quem monta a tela: a lista de pessoas sem o número da ordem. */
export type { Pessoa };
