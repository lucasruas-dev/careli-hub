import type { SupabaseClient } from "@supabase/supabase-js";

import type { PortaDaClicksign } from "@/lib/assinatura/clicksign/cliente";
import {
  acrescentarSignatario,
  notificarSignatario,
  removerSignatario,
} from "@/lib/assinatura/clicksign/envelope";
import { diarioDaProposta } from "@/lib/assinatura/diario-do-envelope-db";
import { conferirSignatarios, type Pessoa } from "@/lib/assinatura/signatarios";
import { PAPEIS, type PapelNoContrato } from "@/lib/assinatura/tipos";

// CONSERTAR O E-MAIL DE UM SIGNATÁRIO — e reenviar o convite só para ele.
//
// ⚠️ O CASO É REAL E FOI MEDIDO EM PRODUÇÃO (12/09/2026). O contrato saiu para dois signatários; o
// convite do segundo voltou na hora — HardBounce, `550 5.1.1 The email account that you tried to
// reach does not exist` —, porque o endereço tinha uma letra a menos. A compradora assinou, o
// cônjuge nunca recebeu nada, e o envelope ficaria aberto para sempre esperando a assinatura de
// alguém que não sabe que existe um contrato.
//
// Lucas, no mesmo dia, desenhando o conserto em três frases:
//   *"teria que ter um forma de editarmos o e-mail e enviar o contrato dele somente"*
//   *"normalmente sera o mesmo signatario, a unica coisa que vamos fazer e alterar o e-mail, entao
//    podemos fazer isso na tela, editar o e-mail quando enviamos para assinatura somente aquele
//    signatario o sistema exclui o que esta errado e coloca o correto"*
//   *"ocorre muito do e-mail esta correto mais o cliente nao recebeu, ae teria que ter um botao para
//    reenviar o contrato"*
//
// SÃO DUAS OPERAÇÕES, E A MAIS COMUM É A MAIS BARATA. `reenviarConvite` só manda o e-mail de novo —
// é o caso do endereço certo que não chegou, e não mexe no envelope. `trocarEmailDoSignatario` é o
// caso do endereço ERRADO, e aí a Clicksign não tem "editar": tem remover e criar.
//
// ⚠️ O PONTO SEM VOLTA É A REMOÇÃO. `DELETE /signers/{id}` não se desfaz: removido, aquele
// signatário não volta. Se o cadastro do novo (ou o dos requisitos) falhar em seguida, a pessoa
// FICOU DE FORA do envelope e o contrato não fecha mais sozinho — e ninguém recebe erro nenhum
// depois disso. Por isso TUDO o que dá para conferir é conferido ANTES da remoção: o formato do
// e-mail, o e-mail igual ao atual, o e-mail já usado por outro signatário e até o id do documento
// (sem ele não dá para recriar os requisitos). Remover alguém para descobrir depois que o endereço
// novo é inválido seria o pior desfecho possível.
//
// ⚠️ E A TRAVA DE QUEM JÁ ASSINOU É DELES, NÃO NOSSA. A Clicksign devolve 403 — *"Já assinou um
// documento. Não pode ser excluído"* — e é ela que garante que nenhuma assinatura se perde aqui. O
// que este arquivo faz é TRADUZIR esse 403 em português; conferência própria sobre quem assinou
// seria uma segunda verdade, lida do nosso banco, que atrasa.
//
// ⚠️ OS DOIS REQUISITOS SÃO O QUE FALHA CALADO. Um signatário criado sem eles recebe o convite,
// abre o documento e NÃO TEM O QUE ASSINAR. Por isso o cadastro passa por
// `acrescentarSignatario`, que é a mesma peça dos passos 3 e 4 do envio — e não uma segunda cópia.

/** A frase do 403 da Clicksign, em português. */
export const RECUSA_DE_QUEM_JA_ASSINOU =
  "Esta pessoa JÁ ASSINOU o contrato, e a Clicksign não deixa remover quem assinou — a assinatura dela vale e não se desfaz. " +
  "Trocar o e-mail aqui não é o caminho: se o documento precisa mudar, o card volta para a análise (o envelope é cancelado) e o contrato é gerado de novo.";

// ── AS PARTES PURAS: O QUE SE CONFERE ANTES DE MEXER NO ENVELOPE ────────────

/**
 * Uma pessoa como o envio a congelou em `temis_envelopes.signatarios`.
 *
 * ⚠️ É DESTA LISTA QUE SAEM O NOME E A ORDEM DO SIGNATÁRIO RECRIADO, e não da tela. O nome é o que
 * foi impresso na qualificação do contrato (Lucas: *"normalmente sera o mesmo signatario, a unica
 * coisa que vamos fazer e alterar o e-mail"*), e a `ordem` é o `group` da Clicksign: recriar alguém
 * no grupo errado mudaria QUEM espera QUEM para assinar, silenciosamente.
 */
export type SignatarioCongelado = {
  /** O id na Clicksign, quando já sabemos — só existe depois de uma troca. */
  chave: null | string;
  email: string;
  nome: string;
  ordem: number;
  papel: PapelNoContrato;
};

/**
 * Lê a lista congelada do jsonb.
 *
 * ⚠️ PAPEL DESCONHECIDO VIRA `comprador` EM VEZ DE DESCARTAR A PESSOA. O papel, aqui, só serve ao
 * rótulo dentro da frase de recusa; sumir com a linha tiraria da conferência justamente um endereço
 * que pode ser o duplicado que ela existe para pegar.
 */
export function lerSignatariosCongelados(bruto: unknown): SignatarioCongelado[] {
  if (!Array.isArray(bruto)) return [];
  const saida: SignatarioCongelado[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const pessoa = item as Record<string, unknown>;
    const email = typeof pessoa.email === "string" ? pessoa.email.trim() : "";
    const nome = typeof pessoa.nome === "string" ? pessoa.nome.trim() : "";
    if (!email && !nome) continue;
    const papel = typeof pessoa.papel === "string" ? pessoa.papel : "";
    saida.push({
      chave: typeof pessoa.chave === "string" && pessoa.chave.trim() ? pessoa.chave.trim() : null,
      email,
      nome,
      ordem: typeof pessoa.ordem === "number" && Number.isFinite(pessoa.ordem) ? pessoa.ordem : 1,
      papel: ehPapelConhecido(papel) ? papel : "comprador",
    });
  }
  return saida;
}

function ehPapelConhecido(bruto: string): bruto is PapelNoContrato {
  return PAPEIS.some((papel) => papel === bruto);
}

export type ConferenciaDaTroca = { email: string; ok: true } | { erro: string; ok: false; status: 400 | 409 };

/**
 * DÁ PARA TROCAR ESTE E-MAIL? — tudo o que se pergunta ANTES do ponto sem volta.
 *
 * ⚠️ A ORDEM DAS TRÊS CONFERÊNCIAS É A ORDEM EM QUE ELAS AJUDAM QUEM LÊ: primeiro "isso não é um
 * e-mail", depois "é o mesmo que já está lá" e por último "esse endereço já é de outra pessoa".
 *
 * ⚠️ O E-MAIL IGUAL AO ATUAL É RECUSADO, E NÃO TRATADO COMO "NADA A FAZER". Não há o que trocar, e
 * o clique custaria a remoção de um signatário vivo de um envelope de produção por nada — quem já
 * tinha aberto o convite perderia o link.
 *
 * ⚠️ E O DUPLICADO REUSA `conferirSignatarios`, A MESMA CONFERÊNCIA DO ENVIO. Dois signatários com
 * o mesmo endereço quebram a Clicksign (é a armadilha catalogada do D4Sign, e a razão de a CAD
 * travar e-mail repetido); escrever aqui uma segunda régua faria a troca aceitar o que o envio
 * recusa. A lista conferida é a PROJETADA: a congelada com o e-mail desta pessoa já trocado.
 */
export function conferirEmailDaTroca(pedido: {
  atual: SignatarioCongelado;
  emailNovo: string;
  todos: readonly SignatarioCongelado[];
}): ConferenciaDaTroca {
  const email = pedido.emailNovo.trim();

  // Simples de propósito, e é a MESMA régua que a rota do envio usa (`lerEmailsEscolhidos`): quem
  // valida e-mail de verdade é a Clicksign, e uma regex ambiciosa aqui recusaria endereço legítimo
  // (`+`, subdomínio, TLD longo).
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      erro: `"${pedido.emailNovo.trim()}" não parece um e-mail. Confira o endereço e tente de novo — nada foi mexido no envelope.`,
      ok: false,
      status: 400,
    };
  }

  if (email.toLowerCase() === pedido.atual.email.trim().toLowerCase()) {
    return {
      erro:
        `Este já é o e-mail de ${pedido.atual.nome || "quem assina"} (${pedido.atual.email}), então não há o que trocar. ` +
        "Se o endereço está certo e o contrato não chegou, use o botão de reenviar o convite.",
      ok: false,
      status: 400,
    };
  }

  // ⚠️ O CASAMENTO É PELO E-MAIL ANTIGO, e não por identidade de objeto: quem chama monta a lista
  // de duas leituras diferentes, e comparar referência faria a projeção trocar o e-mail de NINGUÉM —
  // a conferência passaria sempre, inclusive no duplicado que ela existe para pegar.
  const antigo = pedido.atual.email.trim().toLowerCase();
  const projetada: Pessoa[] = pedido.todos.map((p) => ({
    cpf: null,
    email: p.email.trim().toLowerCase() === antigo ? email : p.email,
    nome: p.nome,
    papel: p.papel,
    telefone: null,
  }));

  const veredito = conferirSignatarios(projetada);
  if (!veredito.ok) {
    return { erro: `${veredito.erro} Nada foi mexido no envelope.`, ok: false, status: 409 };
  }

  return { email, ok: true };
}

/**
 * A FRASE DO DESFECHO PIOR — quando a remoção passou e o resto não.
 *
 * ⚠️ ELA NÃO PODE SER UM ERRO GENÉRICO, E É POR ISSO QUE MORA NUMA FUNÇÃO PRÓPRIA, COBERTA POR
 * TESTE. Deste ponto em diante o signatário antigo NÃO VOLTA: quem lê a tela precisa saber
 * exatamente em que passo parou, que a pessoa antiga já saiu do envelope, e o que fazer agora.
 * "Falha ao trocar o e-mail" deixaria o operador achar que nada aconteceu — e o contrato ficaria
 * parado sem ninguém entender por quê.
 */
export function fraseDaFalhaDepoisDeRemover(pedido: {
  /** Só vale para o passo `requisitos`: o cadastro meio-feito foi desfeito? Ver a nota abaixo. */
  desfeito: boolean;
  detalhe: string;
  envelopeId: string;
  nome: string;
  passo: "requisitos" | "signatario";
}): string {
  const quem = pedido.nome || "O signatário";

  if (pedido.passo === "signatario") {
    return (
      `O signatário antigo JÁ FOI REMOVIDO do envelope, e a Clicksign recusou o cadastro do novo: ${pedido.detalhe}. ` +
      `Agora ${quem} está FORA do envelope ${pedido.envelopeId}, e o contrato não fecha sozinho enquanto ele não voltar. ` +
      "Tente a troca de novo: a nova tentativa refaz o cadastro (não há mais nada a remover). " +
      "Se falhar outra vez, é a Clicksign que está recusando — vale conferir o envelope por lá antes de insistir."
    );
  }

  // ⚠️ DESFEITO, A TELA PODE MANDAR TENTAR DE NOVO — E ANTES ELA NÃO PODIA. Ver a nota do desfazer,
  // em `trocarEmailDoSignatario`: sem o rollback, a retentativa esbarrava na lista congelada (que
  // ainda tem o e-mail ANTIGO) e o conserto morria numa frase de "não achei este signatário".
  if (pedido.desfeito) {
    return (
      `${quem} voltou ao envelope ${pedido.envelopeId} com o e-mail novo, MAS os requisitos de assinatura não foram criados: ${pedido.detalhe}. ` +
      "Nesse estado o convite chega, a pessoa abre o contrato e NÃO TEM O QUE ASSINAR — então o cadastro pela metade foi DESFEITO. " +
      `O envelope ficou sem ${quem}, do mesmo jeito que ficaria se a troca tivesse parado no cadastro. ` +
      "Tente a troca de novo: a nova tentativa refaz tudo do zero."
    );
  }

  return (
    `${quem} voltou ao envelope ${pedido.envelopeId} com o e-mail novo, MAS os requisitos de assinatura não foram criados: ${pedido.detalhe}. ` +
    "Nesse estado o convite chega, a pessoa abre o contrato e NÃO TEM O QUE ASSINAR — o envelope nunca fecha. " +
    "A tentativa de desfazer o cadastro pela metade também falhou, então essa linha CONTINUA no envelope e precisa de mão: " +
    `remova ${quem} pelo painel da Clicksign (o envelope é o ${pedido.envelopeId}) e refaça a troca por aqui. ` +
    "O signatário antigo já tinha sido removido."
  );
}

// ── O CAMINHO INTEIRO, COM O BANCO E A CLICKSIGN ────────────────────────────

export type ConviteReenviado = { ok: true };

export type FalhaNoReenvio = { erro: string; ok: false; status: 404 | 429 | 502 | 503 };

/**
 * MANDA O CONVITE DE NOVO, SÓ PARA ESTA PESSOA — o caso mais comum dos dois.
 *
 * Lucas, 12/09/2026: *"ocorre muito do e-mail esta correto mais o cliente nao recebeu, ae teria que
 * ter um botao para reenviar o contrato"*.
 *
 * ⚠️ NÃO MEXE NO ENVELOPE. Nada é removido, nada é criado: é o mesmo convite, de novo, para o mesmo
 * endereço. É por isso que ele é o primeiro botão a tentar — e o que a frase do "e-mail igual ao
 * atual" manda usar.
 *
 * ⚠️ O ENVELOPE É CONFERIDO NO NOSSO BANCO ANTES DA CHAMADA, e não é burocracia: o id vem do
 * navegador, e a conta da Clicksign é de PRODUÇÃO, com contratos de outras vendas dentro. Sem esta
 * leitura, um id trocado dispararia e-mail de um envelope que não é este.
 */
export async function reenviarConvite(
  sb: SupabaseClient,
  pedido: { envelopeId: string; signerId: string },
  porta?: PortaDaClicksign,
): Promise<ConviteReenviado | FalhaNoReenvio> {
  const envelopeId = pedido.envelopeId.trim();
  const signerId = pedido.signerId.trim();

  if (!envelopeId || !signerId) {
    return { erro: "Sem o envelope e o signatário não dá para reenviar o convite.", ok: false, status: 404 };
  }

  const linha = await lerEnvelope(sb, envelopeId);
  if (!linha.ok) return { erro: linha.erro, ok: false, status: linha.status };

  const enviado = await notificarSignatario(envelopeId, signerId, undefined, porta);
  if (enviado.ok) return { ok: true };

  // ⚠️ "ESPERE UM MINUTO" NÃO É "DEU ERRO". A Clicksign limita a cerca de uma notificação por minuto,
  // e este é o botão que alguém clica duas vezes seguidas quando o cliente diz que não recebeu.
  if (enviado.limiteDeEnvio) {
    return {
      erro:
        "A Clicksign recebeu pedidos de convite demais em pouco tempo e pediu para esperar. " +
        "Aguarde um minuto e clique de novo — o convite anterior pode já estar a caminho.",
      ok: false,
      status: 429,
    };
  }

  return {
    erro: `Não foi possível reenviar o convite: ${enviado.erro}. O envelope continua como estava.`,
    ok: false,
    status: 502,
  };
}

export type TrocaFeita = {
  /**
   * O que deu certo com ressalva — hoje, o convite que não saiu ou o nosso registro que não
   * atualizou. `null` = correu tudo.
   *
   * ⚠️ ELE NÃO É ERRO, E POR ISSO NÃO DERRUBA A TROCA. Depois do cadastro e dos requisitos, o
   * signatário novo ESTÁ no envelope e pode assinar: responder "falhou" faria o operador clicar de
   * novo e remover a pessoa que acabou de entrar.
   */
  aviso: null | string;
  /** O e-mail que passou a valer. */
  email: string;
  nome: string;
  /** O id NOVO na Clicksign. O antigo não existe mais. */
  signerId: string;
  ok: true;
};

export type FalhaNaTroca = {
  erro: string;
  ok: false;
  /**
   * O signatário antigo já saiu do envelope? `true` = o ponto sem volta foi cruzado.
   *
   * ⚠️ A TELA PRECISA DISTO PARA NÃO DIZER "NADA ACONTECEU". Numa falha antes da remoção o envelope
   * está intacto e o operador pode corrigir e tentar; depois dela, alguém está FORA do contrato — e
   * as duas coisas não podem ser contadas do mesmo jeito.
   */
  removido: boolean;
  status: 400 | 404 | 409 | 502 | 503;
};

/**
 * TROCA O E-MAIL DE UM SIGNATÁRIO — remove o errado, põe o certo e convida só ele.
 *
 * A sequência, e o porquê de cada passo estar onde está:
 *
 *   0. confere TUDO (e-mail, duplicidade, id do documento) — antes de existir estrago;
 *   1. remove o signatário  ⚠️ PONTO SEM VOLTA. 403 = já assinou, e aí para tudo;
 *   2. cria de novo, com o MESMO nome, a MESMA ordem e o e-mail novo;
 *   3. cria os DOIS requisitos (sem eles a pessoa não tem o que assinar) — e se ELES falharem, o
 *      cadastro do passo 2 é DESFEITO, para a retentativa ter por onde entrar;
 *   4. notifica só ela;
 *   5. atualiza `temis_envelopes.signatarios`, MESCLANDO.
 *
 * `porta` é a chamada HTTP da Clicksign (o duplo do teste entra por aqui).
 */
export async function trocarEmailDoSignatario(
  sb: SupabaseClient,
  pedido: { email: string; envelopeId: string; signerId: string },
  porta?: PortaDaClicksign,
): Promise<FalhaNaTroca | TrocaFeita> {
  const envelopeId = pedido.envelopeId.trim();
  const signerId = pedido.signerId.trim();

  if (!envelopeId || !signerId) {
    return {
      erro: "Sem o envelope e o signatário não dá para trocar o e-mail.",
      ok: false,
      removido: false,
      status: 404,
    };
  }

  // ── 0. O QUE SE CONFERE ANTES DE MEXER EM QUALQUER COISA ──────────────────
  const linha = await lerEnvelope(sb, envelopeId);
  if (!linha.ok) return { erro: linha.erro, ok: false, removido: false, status: linha.status };

  const alvo = await acharOSignatario(sb, {
    envelopeId,
    propostaId: linha.propostaId,
    signatarios: linha.signatarios,
    signerId,
  });
  if (!alvo.ok) return { erro: alvo.erro, ok: false, removido: false, status: alvo.status };

  const conferido = conferirEmailDaTroca({
    atual: alvo.congelado,
    emailNovo: pedido.email,
    todos: linha.signatarios,
  });
  if (!conferido.ok) {
    return { erro: conferido.erro, ok: false, removido: false, status: conferido.status };
  }

  // ⚠️ SEM O ID DO DOCUMENTO NÃO SE COMEÇA. Os requisitos apontam para o documento: descobrir a
  // falta dele DEPOIS da remoção deixaria a pessoa fora do envelope sem conserto automático. A
  // coluna fica nula quando o envio falhou antes de carimbar o sucesso (`carimbarFalha`, em
  // `lib/assinatura/envio-db.ts`) — envelope meio montado, que se resolve mandando o contrato de
  // novo, não remendando signatário.
  if (!linha.documentoId) {
    return {
      erro:
        `O Panteon não guardou o id do documento deste envelope (${envelopeId}), e sem ele o signatário novo entraria SEM os dois requisitos — ` +
        "receberia o convite e não teria o que assinar. Nada foi mexido. O caminho aqui é voltar o card para a análise e mandar o contrato de novo.",
      ok: false,
      removido: false,
      status: 409,
    };
  }

  // ── 1. A REMOÇÃO — O PONTO SEM VOLTA ──────────────────────────────────────
  const remocao = await removerSignatario(envelopeId, signerId, porta);

  if (!remocao.ok && remocao.jaAssinou) {
    return { erro: RECUSA_DE_QUEM_JA_ASSINOU, ok: false, removido: false, status: 409 };
  }

  // ⚠️ O 404 SEGUE EM FRENTE, E ISSO É DELIBERADO. Ele é o estado que uma tentativa ANTERIOR desta
  // mesma troca deixa: removeu e não conseguiu recriar. Barrar aqui seria fechar o único caminho de
  // conserto e deixar a pessoa fora do envelope para sempre — o contrato nunca fecharia. O risco do
  // outro lado (um id errado fazer nascer um signatário repetido) é menor e é VISÍVEL: a linha
  // duplicada aparece na lista e pode ser removida, porque quem não assinou a Clicksign deixa sair.
  if (!remocao.ok && !remocao.naoEncontrado) {
    return {
      erro: `Não foi possível remover o signatário antigo: ${remocao.erro}. O envelope continua como estava, e ninguém perdeu o convite.`,
      ok: false,
      removido: false,
      status: 502,
    };
  }

  const avisos: string[] = [];
  if (!remocao.ok) {
    avisos.push(
      "A Clicksign não achou o signatário antigo (ele já tinha saído do envelope), então a troca seguiu direto para o cadastro do novo.",
    );
  }

  // ── 2 e 3. O CADASTRO E OS DOIS REQUISITOS ────────────────────────────────
  //
  // ⚠️ O CPF NÃO VOLTA NA TROCA, e é bom que não volte. `temis_envelopes.signatarios` congelou só
  // nome, e-mail, ordem e papel: o signatário recriado entra com `has_documentation: false`, ou
  // seja, autenticação só pelo e-mail — o mesmo caminho do `semCpf` do envio, e o desfecho seguro
  // (sem CPF a Clicksign não pede documento na hora de assinar, e ninguém trava na tela deles).
  // Adivinhar o CPF aqui é que seria errado; quem quiser mantê-lo tem de gravá-lo no jsonb do envio.
  const acrescimo = await acrescentarSignatario(
    envelopeId,
    {
      documentoId: linha.documentoId,
      pessoa: {
        cpf: null,
        email: conferido.email,
        nome: alvo.congelado.nome,
        ordem: alvo.congelado.ordem,
        papel: alvo.congelado.papel,
      },
      semCpf: true,
    },
    porta,
  );

  if (!acrescimo.ok) {
    // ⚠️ O CADASTRO PELA METADE É DESFEITO, E NÃO DEIXADO LÁ — e isto conserta um BECO SEM SAÍDA, não
    // é capricho de limpeza. Quando os requisitos falham, a pessoa entrou no envelope com o e-mail
    // NOVO e sem nada para assinar, enquanto a nossa lista congelada ainda guarda o e-mail ANTIGO.
    // A retentativa que a frase mandava fazer batia justamente aí: `acharOSignatario` procura o
    // signatário do diário dentro da lista congelada, pelo e-mail, não acha — e devolve *"está no
    // envelope da Clicksign mas não na lista que o Panteon congelou"*. Ou seja: o único caminho de
    // conserto estava fechado, com uma pessoa pendurada num envelope que nunca fecharia.
    //
    // ⚠️ REMOVER AQUI É SEGURO: este signatário nasceu segundos atrás e NÃO TEM REQUISITO, então não
    // há assinatura nenhuma a perder — e a Clicksign devolveria 403 se houvesse. Desfeito, o envelope
    // volta ao mesmo estado da falha de cadastro, que a retentativa já sabe atravessar (o 404 do
    // DELETE segue em frente).
    const desfeito =
      acrescimo.passo === "requisitos" && acrescimo.signerId !== null
        ? (await removerSignatario(envelopeId, acrescimo.signerId, porta)).ok
        : false;

    return {
      erro: fraseDaFalhaDepoisDeRemover({
        desfeito,
        detalhe: acrescimo.erro,
        envelopeId,
        nome: alvo.congelado.nome,
        passo: acrescimo.passo,
      }),
      ok: false,
      removido: true,
      status: 502,
    };
  }

  // ── 4. O CONVITE, SÓ PARA ELE ─────────────────────────────────────────────
  //
  // ⚠️ AQUI A FALHA NÃO DERRUBA A TROCA. A pessoa já está no envelope, com os requisitos: o que
  // faltou foi o e-mail sair, e para isso existe o botão de reenviar convite. Responder "falhou"
  // faria o operador clicar em trocar de novo — removendo quem acabou de entrar.
  const convite = await notificarSignatario(envelopeId, acrescimo.signerId, undefined, porta);
  if (!convite.ok) {
    avisos.push(
      convite.limiteDeEnvio
        ? "O e-mail novo entrou no envelope, mas a Clicksign pediu para esperar antes de mandar o convite (limite de envios). Use o botão de reenviar convite em um minuto."
        : `O e-mail novo entrou no envelope, mas o convite não saiu: ${convite.erro}. Use o botão de reenviar convite.`,
    );
  }

  // ── 5. O NOSSO REGISTRO ───────────────────────────────────────────────────
  const gravado = await gravarTrocaNoRegistro(sb, {
    chaveNova: acrescimo.signerId,
    emailAntigo: alvo.congelado.email,
    emailNovo: conferido.email,
    registroId: linha.registroId,
    signatarios: linha.signatarios,
  });
  if (!gravado) {
    avisos.push(
      `A troca foi feita na Clicksign, mas o Panteon não conseguiu atualizar o registro do envelope: a tela pode continuar mostrando ${alvo.congelado.email} até o próximo aviso da Clicksign. O contrato não é afetado.`,
    );
  }

  return {
    aviso: avisos.length > 0 ? avisos.join(" ") : null,
    email: conferido.email,
    nome: alvo.congelado.nome,
    ok: true,
    signerId: acrescimo.signerId,
  };
}

// ── AS LEITURAS ─────────────────────────────────────────────────────────────

type EnvelopeLido = {
  /** O id do documento NA CLICKSIGN — é ele que os requisitos apontam. */
  documentoId: string;
  ok: true;
  propostaId: null | string;
  /** A chave da NOSSA linha em `temis_envelopes`. */
  registroId: string;
  signatarios: SignatarioCongelado[];
};

/**
 * A nossa linha do envelope.
 *
 * ⚠️ PELO `envelope_id` DA CLICKSIGN, e não pelo id da nossa linha: é o número que a tela do diário
 * mostra e o que o operador vê. E é o filtro que garante que o id vindo do navegador é de um
 * envelope NOSSO, e não de outro contrato qualquer da conta de produção.
 */
async function lerEnvelope(
  sb: SupabaseClient,
  envelopeId: string,
): Promise<EnvelopeLido | { erro: string; ok: false; status: 404 | 503 }> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .select("id, proposta_id, provedor_documento_id, signatarios")
    .eq("envelope_id", envelopeId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[temis][troca de signatário] falha ao ler o envelope", error);
    return { erro: "Não foi possível abrir o envelope deste contrato.", ok: false, status: 503 };
  }

  const linha = data as null | {
    id: string;
    proposta_id: null | string;
    provedor_documento_id: null | string;
    signatarios: unknown;
  };

  if (!linha) {
    return {
      erro: `O Panteon não tem registro do envelope ${envelopeId}. Atualize a tela e tente de novo.`,
      ok: false,
      status: 404,
    };
  }

  return {
    documentoId: (linha.provedor_documento_id ?? "").trim(),
    ok: true,
    propostaId: linha.proposta_id,
    registroId: linha.id,
    signatarios: lerSignatariosCongelados(linha.signatarios),
  };
}

type SignatarioAchado = { congelado: SignatarioCongelado; ok: true };

/**
 * QUEM É ESTE `signerId`? — a ponte entre a chave da Clicksign e a nossa lista congelada.
 *
 * ⚠️ A LISTA CONGELADA NÃO TEM A CHAVE DA CLICKSIGN (ela nasce antes de o envelope existir), e é
 * por isso que a ponte passa pelo DIÁRIO: `diarioDaProposta` já junta o que os eventos contaram
 * (onde vive a `signer.key`) com o que o envio congelou. Reusá-lo evita uma segunda leitura de
 * payload — e evita uma segunda regra de casamento, que é o que faz o "assinou" de uma pessoa
 * aparecer na linha de outra.
 *
 * ⚠️ QUEM NÃO ESTÁ NA LISTA CONGELADA É RECUSADO, ANTES DE QUALQUER REMOÇÃO. Sem ele não sabemos a
 * ordem de assinatura nem o papel, e recriar a pessoa chutando o `group` mudaria em silêncio quem
 * espera quem para assinar.
 */
async function acharOSignatario(
  sb: SupabaseClient,
  pedido: {
    envelopeId: string;
    propostaId: null | string;
    signatarios: readonly SignatarioCongelado[];
    signerId: string;
  },
): Promise<SignatarioAchado | { erro: string; ok: false; status: 404 | 409 | 503 }> {
  // O atalho: depois da primeira troca a chave fica gravada no nosso jsonb.
  const pelaChave = pedido.signatarios.find((p) => p.chave === pedido.signerId);
  if (pelaChave) return { congelado: pelaChave, ok: true };

  if (!pedido.propostaId) {
    return {
      erro: `O envelope ${pedido.envelopeId} não está ligado a nenhuma proposta, e sem isso não dá para saber quem é este signatário. Nada foi mexido.`,
      ok: false,
      status: 404,
    };
  }

  const diario = await diarioDaProposta(sb, pedido.propostaId);
  if (!diario) {
    return {
      erro: "Não foi possível ler os signatários deste envelope agora. Nada foi mexido — tente de novo em alguns segundos.",
      ok: false,
      status: 503,
    };
  }

  // ⚠️ CONFERE QUE O DIÁRIO É DESTE ENVELOPE. `diarioDaProposta` devolve o envelope MAIS RECENTE da
  // proposta, e uma proposta pode ter mais de um (um recusado e um reenviado): casar a chave contra
  // a lista do envelope errado mandaria remover a pessoa certa do contrato errado.
  if (diario.envelope.envelopeId !== pedido.envelopeId) {
    return {
      erro: `Este contrato já tem um envelope mais novo na Clicksign. Atualize a tela: a troca de e-mail vale para o envelope que está valendo, não para o ${pedido.envelopeId}.`,
      ok: false,
      status: 409,
    };
  }

  const doDiario = diario.envelope.signatarios.find((s) => s.chave === pedido.signerId);
  if (!doDiario || !doDiario.email) {
    return {
      erro: "Não achei este signatário no envelope. Atualize a tela e tente de novo — nada foi mexido.",
      ok: false,
      status: 404,
    };
  }

  const congelado = pedido.signatarios.find(
    (p) => p.email.toLowerCase() === doDiario.email.trim().toLowerCase(),
  );
  if (!congelado) {
    return {
      erro:
        `${doDiario.nome || "Este signatário"} está no envelope da Clicksign mas não na lista que o Panteon congelou no envio, ` +
        "então não dá para saber a ordem de assinatura dele. Trocar o e-mail aqui poderia mudar quem espera quem para assinar. Nada foi mexido.",
      ok: false,
      status: 404,
    };
  }

  return { congelado, ok: true };
}

/**
 * GRAVA A TROCA NO NOSSO REGISTRO — mesclando, nunca substituindo.
 *
 * ⚠️ O JSONB INTEIRO NÃO SE SUBSTITUI, E ESTA CASA JÁ PAGOU POR ISSO: um update que trocou o jsonb
 * inteiro apagou a esteira de 122 CADs (20/07/2026, [[reference_apolo_metadata_sync_apaga]]). Aqui
 * seriam os OUTROS signatários do contrato sumindo da lista congelada — e é ela que dá o
 * denominador do "1/5" e o papel de cada um na tela.
 *
 * ⚠️ E A CHAVE NOVA VAI JUNTO COM O E-MAIL. Sem ela, a próxima troca da mesma pessoa teria de
 * esperar o webhook para saber quem ela é; com ela, o atalho de `acharOSignatario` resolve na hora.
 *
 * ⚠️ FALHA AQUI NÃO DESFAZ NADA, e nem poderia: a Clicksign já trocou. Vira aviso, como o
 * `carimbarSucesso` do envio faz — perder o id do nosso lado é ruim, mandar o operador clicar de
 * novo seria pior.
 */
async function gravarTrocaNoRegistro(
  sb: SupabaseClient,
  dados: {
    chaveNova: string;
    emailAntigo: string;
    emailNovo: string;
    registroId: string;
    signatarios: readonly SignatarioCongelado[];
  },
): Promise<boolean> {
  const alvo = dados.emailAntigo.trim().toLowerCase();
  const lista = dados.signatarios.map((p) =>
    p.email.trim().toLowerCase() === alvo
      ? { chave: dados.chaveNova, email: dados.emailNovo, nome: p.nome, ordem: p.ordem, papel: p.papel }
      : { ...(p.chave ? { chave: p.chave } : {}), email: p.email, nome: p.nome, ordem: p.ordem, papel: p.papel },
  );

  const { error } = await sb
    .from("temis_envelopes")
    .update({ atualizado_em: new Date().toISOString(), signatarios: lista })
    .eq("id", dados.registroId);

  if (error) {
    console.error(
      "[temis][troca de signatário] A TROCA FOI FEITA NA CLICKSIGN E O REGISTRO NÃO ATUALIZOU. registro:",
      dados.registroId,
      error,
    );
    return false;
  }
  return true;
}
