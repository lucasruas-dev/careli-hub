import type { SupabaseClient } from "@supabase/supabase-js";

import type { PortaDaClicksign } from "@/lib/assinatura/clicksign/cliente";
import {
  acrescentarSignatario,
  notificarSignatario,
  removerSignatario,
} from "@/lib/assinatura/clicksign/envelope";
import { chaveDaClicksign } from "@/lib/assinatura/congelar-signatarios";
import { quemAssinou } from "@/lib/assinatura/diario-do-envelope";
import { diarioDaProposta, payloadMaisRecente } from "@/lib/assinatura/diario-do-envelope-db";
import {
  fraseDeEnvelopeEncerrado,
  RECUSA_DE_CHAVE_QUE_NAO_E_DA_CLICKSIGN,
  RECUSA_DE_QUEM_NAO_ESTA_NO_QUADRO,
  RECUSA_DE_REENVIO_SEM_ID,
} from "@/lib/assinatura/recusa-de-reenvio";
import { chamarRegistroDasAssinaturas, type ItemParaGravar } from "@/lib/assinatura/registro-db";
import { conferirSignatarios, type Pessoa } from "@/lib/assinatura/signatarios";
import {
  ehTerminal,
  type EstadoDaAssinatura,
  PAPEIS,
  type PapelNoContrato,
} from "@/lib/assinatura/tipos";

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
  /**
   * Quando esta pessoa assinou, pela marca do quadro. `null` = ainda não assinou.
   *
   * ⚠️ ELA É A TRAVA DE QUEM JÁ ASSINOU, e não enfeite: é ela que impede o convite de um documento
   * JÁ ASSINADO de cair na caixa de entrada de quem assinou, e a troca de e-mail de remover do
   * envelope uma assinatura que vale. Medido em produção em 01/10/2026 (só SELECT): nos 18 envelopes
   * vivos sem id da Clicksign são 17 assinaturas em 87 linhas, 3 delas num contrato da Têmis de 11
   * signatários.
   */
  assinadoEm: null | string;
  /** O id na Clicksign, quando o quadro já o tem — do envio ou de uma troca de e-mail. */
  chave: null | string;
  email: string;
  nome: string;
  ordem: number;
  papel: PapelNoContrato;
  /**
   * Quando esta pessoa RECUSOU o documento. `null` = não recusou.
   *
   * ⚠️ ELA ANDA NO MESMO NÍVEL DE `assinadoEm`, E ISSO NÃO É SIMETRIA DE ENFEITE: a função da 0195
   * carrega `assinado_em`, `recusado_em`, `convite_falhou_em` e `convite_entregue_em` lado a lado
   * (parte (a) de `0195_o_contrato_mora_no_panteon.sql`). Ler só a primeira faria quem recusou passar
   * por pendente e receber o convite de um documento que ele negou. Medido em produção em 01/10/2026
   * (só SELECT): 0 das 87 linhas dos 18 envelopes vivos tem `recusado_em` hoje — a marca existe no
   * modelo, e a trava não espera o primeiro caso para nascer.
   */
  recusadoEm: null | string;
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
      assinadoEm: marcaDoQuadro(pessoa.assinado_em),
      chave: typeof pessoa.chave === "string" && pessoa.chave.trim() ? pessoa.chave.trim() : null,
      email,
      nome,
      ordem: typeof pessoa.ordem === "number" && Number.isFinite(pessoa.ordem) ? pessoa.ordem : 1,
      papel: ehPapelConhecido(papel) ? papel : "comprador",
      recusadoEm: marcaDoQuadro(pessoa.recusado_em),
    });
  }
  return saida;
}

function ehPapelConhecido(bruto: string): bruto is PapelNoContrato {
  return PAPEIS.some((papel) => papel === bruto);
}

/** Uma marca de data do quadro (`assinado_em`, `recusado_em`): texto com conteúdo, ou `null`. */
function marcaDoQuadro(bruto: unknown): null | string {
  return typeof bruto === "string" && bruto.trim() ? bruto.trim() : null;
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

export type FalhaNoReenvio = {
  erro: string;
  ok: false;
  /** 409 = esta pessoa já assinou: não há convite a reenviar, e a linha dela não é tocada. */
  status: 400 | 404 | 409 | 429 | 502 | 503;
};

/** A frase de quem já assinou e não precisa de convite nenhum. */
export const RECUSA_DE_CONVITE_DE_QUEM_JA_ASSINOU =
  "Esta pessoa JÁ ASSINOU este documento: não há convite para reenviar. " +
  "Mandar o convite de novo poria na caixa de entrada dela um e-mail de algo que ela já assinou. Nada foi mexido.";

/**
 * A frase de quem RECUSOU o documento.
 *
 * ⚠️ RECUSA NÃO É PENDÊNCIA, e reenviar convite para quem negou o documento é pedir que ele negue de
 * novo. A marca `recusado_em` anda no mesmo nível de `assinado_em` na função da 0195, e esta frase
 * existe para o desfecho não cair na de quem assinou, que diria uma coisa falsa sobre a pessoa.
 */
export const RECUSA_DE_CONVITE_DE_QUEM_RECUSOU =
  "Esta pessoa RECUSOU este documento, e reenviar o convite não desfaz a recusa: " +
  "o caminho é o card voltar para a análise e o documento ser gerado de novo. Nada foi mexido.";

/**
 * A frase de quando o id que o pedido trouxe não é de ninguém DESTE envelope.
 *
 * ⚠️ O NAVEGADOR NÃO ESCOLHE QUEM RECEBE CONVITE DENTRO DE UM ENVELOPE PAGO, e é esta frase que
 * fecha a porta. A conta da Clicksign é de PRODUÇÃO, com contratos de outras vendas dentro: o id tem
 * de constar no quadro congelado ou no payload de webhook deste envelope, e os dois são lidos do
 * nosso banco antes de qualquer chamada.
 */
export const RECUSA_DE_ID_QUE_NAO_E_DESTE_ENVELOPE =
  "O signatário que a tela mandou não é de ninguém deste envelope: ele não está na lista que o " +
  "Panteon congelou no envio nem nos avisos que a Clicksign já mandou sobre este documento. " +
  "Atualize a tela e tente de novo. Nada foi mexido.";

/**
 * A frase de quando o envelope já terminou.
 *
 * ⚠️ ELA MORA EM `lib/assinatura/recusa-de-reenvio.ts` E É A MESMA DA TELA. O servidor recusa o
 * reenvio e a troca com ela, e as duas telas do painel mostram ela no tooltip do botão desabilitado
 * (via `reenvioIndisponivel`, em `diario-do-envelope-db.ts`): se a tela e o servidor contassem
 * histórias diferentes sobre o mesmo envelope cancelado, o operador clicaria para descobrir qual das
 * duas valia. Medido em produção em 01/10/2026 (só SELECT): 3 dos 21 envelopes da Clicksign sem
 * nenhuma `chave` no quadro estão `cancelado`, com 16 linhas pendentes dentro deles.
 */
export { fraseDeEnvelopeEncerrado } from "@/lib/assinatura/recusa-de-reenvio";

/**
 * A frase de quando o mesmo endereço aparece duas vezes na nossa lista.
 *
 * ⚠️ AÍ NÃO SE SABE QUEM É, e não se sabe nem se essa pessoa já assinou: escolher a primeira linha
 * mandaria o convite de um contrato para a pessoa errada, ou para quem já assinou.
 */
export const RECUSA_DE_EMAIL_REPETIDO_NO_QUADRO =
  "Este mesmo e-mail aparece em duas pessoas deste envelope, e assim não dá para saber de quem é o convite. " +
  "Corrija o endereço de uma delas (editar e-mail) e reenvie depois. Nada foi mexido.";

/**
 * A frase de quando o pedido não casa com nenhuma linha do quadro deste envelope.
 *
 * ⚠️ AQUI NÃO SE NOTIFICA ÀS CEGAS, E ISSO É O CORAÇÃO DA GUARDA. Sem achar a linha não se sabe se
 * a pessoa já assinou, e mandar para a Clicksign o `signerId` que veio do navegador é deixar o
 * navegador escolher quem recebe convite dentro de um envelope pago. Medido em produção em
 * 01/10/2026 (só SELECT): nos 18 envelopes vivos sem id, 17 das 87 linhas já têm `assinado_em`.
 *
 * ⚠️ E O TEXTO MORA EM `lib/assinatura/recusa-de-reenvio.ts` porque é ELE que a tela mostra no
 * tooltip do motivo `fora_do_quadro`. Antes as duas telas mostravam `RECUSA_DE_REENVIO_SEM_ID` nesse
 * caso, uma frase que afirma o INVERSO ("ela só aparece na lista que o envio congelou").
 */
export { RECUSA_DE_QUEM_NAO_ESTA_NO_QUADRO } from "@/lib/assinatura/recusa-de-reenvio";

/**
 * A frase do 422 — e ela NÃO PODE MAIS dizer "o Panteon não tem o id".
 *
 * ⚠️ DIZER QUE FALTA O ID AQUI É FALSO DESDE 01/10/2026. O id que foi mandado saiu do quadro
 * congelado ou do payload de webhook DESTE envelope, conferido antes da chamada: mandar a operadora
 * ao painel da Clicksign "porque o Panteon não tem o id" a faria encontrar a pessoa com o id lá
 * certinho e não entender nada. O que o 422 quer dizer neste ponto é que a Clicksign não aceitou
 * aquele signatário no convite — normalmente porque alguém mexeu no envelope pelo painel deles.
 */
export function fraseDoIdQueNaoFoiAceito(envelopeId: string): string {
  return (
    `A Clicksign não aceitou mandar o convite para este signatário do envelope ${envelopeId}. ` +
    "Isso acontece quando a pessoa já assinou ou saiu do envelope por fora do Panteon: confira no painel da Clicksign. " +
    "O envelope continua como estava, e clicar de novo não muda este desfecho."
  );
}

/**
 * A frase de quando a chave da linha não serve para falar com a Clicksign.
 *
 * ⚠️ `tmp:`, `c2x:` E O PRÓPRIO E-MAIL NÃO SÃO SIGNATÁRIO DE NINGUÉM LÁ, e a diferença importa no
 * DELETE: a Clicksign responde 404, não 403, e o 404 da remoção SEGUE EM FRENTE de propósito (ver a
 * nota do passo 1). Mandar `tmp:3` ou um e-mail para lá faria o signatário antigo FICAR no envelope e
 * um duplicado nascer com o e-mail novo. Medido em produção em 01/10/2026 (só SELECT): hoje não há
 * nenhum item `tmp:` nos envelopes da Clicksign, mas `abrirRegistro` grava `tmp:<posição>` em todo
 * mundo antes do carimbo do envio (`lib/assinatura/envio-db.ts`), então o estado existe entre os dois
 * passos — e o e-mail chega em toda linha dos 18 envelopes que não congelaram chave nenhuma.
 *
 * ⚠️ O TEXTO MORA EM `lib/assinatura/recusa-de-reenvio.ts` porque a tela da Têmis o usa no tooltip do
 * botão desabilitado, e este arquivo arrasta a porta da Clicksign (que lê `process.env`).
 */
export { RECUSA_DE_CHAVE_QUE_NAO_E_DA_CLICKSIGN } from "@/lib/assinatura/recusa-de-reenvio";

/**
 * A frase de quando a troca de e-mail é pedida para quem JÁ ASSINOU.
 *
 * ⚠️ ESTA TRAVA É NOSSA, E NÃO DO PROVEDOR. Até aqui a única barreira era o 403 da Clicksign na
 * remoção (`RECUSA_DE_QUEM_JA_ASSINOU`): nem `podeMexer` na tela nem `conferirEmailDaTroca` olhavam
 * assinatura. Depender do 403 é depender de o id que mandamos ser o da pessoa certa — e quando ele
 * não é, vem 404, que SEGUE EM FRENTE. Medido em produção em 01/10/2026 (só SELECT): 17 das 87
 * linhas dos 18 envelopes vivos sem id já têm `assinado_em`, e 3 delas estão num contrato da Têmis
 * com 11 signatários.
 */
export const RECUSA_DE_TROCA_DE_QUEM_JA_ASSINOU =
  "Esta pessoa JÁ ASSINOU este documento, e trocar o e-mail dela aqui a removeria do envelope. " +
  "A assinatura vale e não se desfaz: se o documento precisa mudar, o card volta para a análise e o contrato é gerado de novo. Nada foi mexido.";

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
 *
 * ⚠️ E DESDE 01/10/2026 ELE ACEITA O ID QUE O PEDIDO TRAZ, EM VEZ DE RECUSAR PORQUE O QUADRO NÃO TEM
 * A `chave`. Lucas, no mesmo dia: *"Nao consigo reenviar os contratos. Precisamos sentar e resolver
 * os pontos pendentes da Temis."* O id NUNCA PRECISOU SER BUSCADO: medido em produção em 01/10/2026
 * (só SELECT, projeto bxgukywoxgivlrhjkwjx), a `chave` que o envio congela e a `signer.key` que o
 * webhook manda são O MESMO VALOR em 54 de 54 pares (8 envelopes, zero diferenças), e nos 18
 * envelopes vivos sem nenhuma `chave` congelada as 70 pessoas sem `assinado_em` no quadro TODAS têm
 * `signer.key` no payload que já está em `temis_assinatura_eventos` (e 68 delas precisam de convite:
 * 2 já assinaram pelo payload, e é a trava de `doWebhook.assinouEm` que as segura). Ou seja a `signer.key` É o `signer_id` que
 * `POST /envelopes/{id}/signers/{signer_id}/notifications` aceita, e ela já chega no pedido: a tela
 * manda exatamente esse valor (`juntarComOsCongelados`, em `diario-do-envelope-db.ts`).
 *
 * ⚠️ ENTÃO NÃO HÁ CHAMADA NOVA NENHUMA, E O QUADRO NÃO É REESCRITO. Os 18 envelopes destravam com as
 * leituras que já existiam, e `temis_envelopes.signatarios` fica intacto: a função da 0195 só
 * reencontra uma linha SEM `chave` pelo e-mail ÚNICO, e reescrever o quadro para "aproveitar" um id
 * é como a casa perdeu a esteira de 122 CADs (20/07/2026).
 *
 * ⚠️ MAS O NAVEGADOR NÃO ESCOLHE QUEM RECEBE CONVITE DENTRO DE UM ENVELOPE PAGO. O `signerId` do
 * pedido é CONFERIDO no servidor contra o que sabemos deste envelope — o quadro congelado ou o
 * payload de webhook dele — antes de qualquer chamada, e o que não consta em nenhum dos dois é
 * recusado. A conferência mora AQUI, e não no diário, por três razões: o pedido chega por HTTP e só o
 * servidor pode decidir (uma marca calculada no diário voltaria pelo navegador e não valeria nada);
 * ela reusa `payloadMaisRecente` + `quemAssinou`, que é o PAR que o diário já usa, então há UMA régua
 * só para "de quem é esta `signer.key`" (duas réguas é como o "assinou" de uma pessoa aparece na
 * linha de outra); e é um SELECT na tabela que o diário já lê, só no clique e só quando o quadro
 * ainda não tem a chave — nos 8 envelopes que a têm, nada é lido a mais.
 *
 * ⚠️ E O 422 DE 24/09/2026 CONTINUA RECUSADO ANTES DA CHAMADA, porque ele é do outro caso: quem só
 * existe na lista congelada não tem `signer.key`, e a `chave` que a tela manda nessa linha é o
 * PRÓPRIO E-MAIL. E-mail nunca é signer id (`chaveDaClicksign`).
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

  // ⚠️ ENVELOPE ENCERRADO NÃO RECEBE CONVITE, E NADA AQUI OLHAVA O ESTADO. Medido em produção em
  // 01/10/2026 (só SELECT): dos 21 envelopes da Clicksign sem nenhuma `chave` no quadro, 3 estão
  // `cancelado` — eles entrariam no caminho novo junto com os 18 vivos, e o convite de um envelope
  // cancelado é um link morto na caixa de entrada do cliente.
  if (linha.estado && ehTerminal(linha.estado)) {
    return { erro: fraseDeEnvelopeEncerrado(linha.estado, envelopeId), ok: false, status: 409 };
  }

  // ⚠️ E-MAIL, `tmp:` E `c2x:` NÃO SÃO SIGNER ID, E A RECUSA VEM ANTES DA CHAMADA QUE COBRA. É o 422
  // de 24/09/2026: quem só existe na lista congelada do envio não tem `signer.key`, e a `chave` que a
  // tela manda nessa linha é o próprio e-mail (`juntarComOsCongelados`).
  const idPedido = chaveDaClicksign(signerId);
  if (!idPedido) return { erro: RECUSA_DE_REENVIO_SEM_ID, ok: false, status: 400 };

  // ── DE QUEM É ESTE ID? ────────────────────────────────────────────────────
  //
  // ⚠️ PRIMEIRO O NOSSO QUADRO, QUE NÃO CUSTA LEITURA. Nos 8 envelopes que têm o id de todo mundo a
  // conferência acaba aqui (medido em 01/10/2026, só SELECT).
  const pelaChave = linha.signatarios.find((p) => chaveDaClicksign(p.chave) === idPedido);

  /**
   * A linha do payload de webhook deste envelope com esta `signer.key`, quando foi preciso procurar.
   *
   * ⚠️ É ELA QUE PROVA QUE O ID É DESTE ENVELOPE. `payloadMaisRecente` + `quemAssinou` é o mesmo par
   * que o diário usa (`diario-do-envelope-db.ts`), de propósito: uma segunda régua para "de quem é
   * esta key" é como o "assinou" de uma pessoa acaba na linha de outra.
   */
  const doWebhook = pelaChave
    ? null
    : await noPayloadDesteEnvelope(sb, { documentoId: linha.documentoId, envelopeId }, idPedido);

  if (!pelaChave && !doWebhook) {
    return { erro: RECUSA_DE_ID_QUE_NAO_E_DESTE_ENVELOPE, ok: false, status: 409 };
  }

  // ⚠️ O PAYLOAD JÁ SABE QUEM ASSINOU, E JOGAR ISSO FORA DEIXAVA UM BURACO. `quemAssinou` calcula o
  // `assinouEm` de cada pessoa a partir dos eventos `sign` do documento, e a trava de "quem já
  // assinou" olhava só o `assinado_em` do nosso quadro — que pode estar ATRÁS. Medido em produção em
  // 01/10/2026 (só SELECT, reproduzindo a leitura deste código: evento mais recente com
  // `assinatura_conferida = true`): nos 18 envelopes vivos sem chave há 19 eventos `sign` no payload
  // e só 17 `assinado_em` nas 87 linhas do quadro. As 2 de diferença são pessoas reais de termos de
  // acordo do Hades — envelope 9eafed62-4451-4ba2-b76f-c552f47c5f8a (assinou 23/09/2026 15:37Z) e
  // envelope f76d7af0-1f51-4161-a094-abeee04a5829 (assinou 24/09/2026 17:58Z), as duas com
  // `assinado_em` NULO no quadro. Ou seja: dos 70 "pendentes" do recorte, 2 já assinaram, e quem deve
  // receber convite são 68. Sem esta trava elas receberiam convite de documento que já assinaram.
  if (doWebhook?.assinouEm) {
    return { erro: RECUSA_DE_CONVITE_DE_QUEM_JA_ASSINOU, ok: false, status: 409 };
  }

  // ⚠️ A LINHA DO QUADRO É A FONTE DAS MARCAS, e por isso ela é procurada mesmo quando o id veio do
  // payload: `assinado_em` e `recusado_em` moram em `temis_envelopes.signatarios`, que é o registro do
  // Panteon.
  //
  // ⚠️ E O E-MAIL QUE CASA A LINHA SAI DO PAYLOAD, NUNCA DO PEDIDO. Até aqui havia um `|| pedido.email`
  // de última saída, e ele era o único ponto em que o navegador influenciava a trava: no payload
  // "pobre" (`document.signers` vazio, as pessoas saindo dos eventos — medido em 01/10/2026, 28 dos
  // 283 payloads conferidos têm `signers` vazio) a key pode chegar sem e-mail, e aí o endereço do
  // navegador escolhia QUAL linha do quadro era auditada. Mandando a key de quem já assinou com o
  // e-mail de um pendente, a trava não disparava e o convite saía para quem assinou. Sem e-mail no
  // payload não se sabe de quem é a linha: recusa. Medido no mesmo dia: das 104 `signer.key` dos
  // envelopes sem chave, ZERO chegam sem e-mail, então isto não tira nada dos 68.
  const alvo = pelaChave
    ? { ambiguo: false, pessoa: pelaChave }
    : acharNoQuadro(linha.signatarios, {
        email: (doWebhook?.email ?? "").trim(),
        signerId: idPedido,
      });

  // ⚠️ DUAS LINHAS COM O MESMO ENDEREÇO NÃO IDENTIFICAM NINGUÉM, e aí nem a trava de quem já assinou
  // vale. É a mesma régua que a função da 0195 usa para casar o quadro por e-mail (só quando é
  // único). Medido em 01/10/2026 (só SELECT): nenhum dos 29 envelopes da Clicksign tem e-mail
  // repetido hoje, mas 23 dos 2.231 da D4Sign têm — a forma existe em contrato real.
  if (alvo.ambiguo) {
    return { erro: RECUSA_DE_EMAIL_REPETIDO_NO_QUADRO, ok: false, status: 409 };
  }

  // ⚠️ SEM A LINHA DO QUADRO NÃO SE SABE SE A PESSOA JÁ ASSINOU, e esta é a guarda do SERVIDOR. É o
  // caso de quem foi acrescentado ao envelope pelo painel da Clicksign, por fora do Panteon: notificar
  // ali seria mandar convite sem poder olhar nenhuma marca.
  if (alvo.pessoa === null) {
    return { erro: RECUSA_DE_QUEM_NAO_ESTA_NO_QUADRO, ok: false, status: 409 };
  }

  // ⚠️ QUEM JÁ ASSINOU NÃO RECEBE CONVITE DE NOVO, e as duas telas esconderem o botão não basta: o
  // pedido chega por HTTP, com um id que está visível no payload. Medido em 01/10/2026 (só SELECT):
  // 17 das 87 linhas dos 18 envelopes vivos sem id já têm `assinado_em`, e um convite de documento já
  // assinado é o tipo de e-mail que gera ligação para o atendimento.
  if (alvo.pessoa.assinadoEm) {
    return { erro: RECUSA_DE_CONVITE_DE_QUEM_JA_ASSINOU, ok: false, status: 409 };
  }

  // ⚠️ E QUEM RECUSOU, NO MESMO NÍVEL: a 0195 carrega as duas marcas lado a lado, e reenviar convite
  // para quem negou o documento é pedir que ele negue de novo.
  if (alvo.pessoa.recusadoEm) {
    return { erro: RECUSA_DE_CONVITE_DE_QUEM_RECUSOU, ok: false, status: 409 };
  }

  const enviado = await notificarSignatario(envelopeId, idPedido, undefined, porta);
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

  // ⚠️ O 422 NÃO É ERRO DE REDE, E NÃO ADIANTA CLICAR DE NOVO. Ele quer dizer que a Clicksign não
  // aceitou aquele signatário no convite. Desde 01/10/2026 ele deixou de ser o caminho normal (o id
  // que vai é o que o quadro ou o payload deste envelope já tinham) e virou a REDE: alguém mexeu no
  // envelope pelo painel da Clicksign e o id deixou de valer lá.
  //
  // ⚠️ E A FRASE NÃO PODE MAIS DIZER "O PANTEON NÃO TEM O ID", porque ele tem — foi conferido contra
  // o nosso banco antes da chamada. Dizer o contrário manda a operadora ao painel deles procurar um
  // id que ela vai encontrar lá certinho.
  if (enviado.status === 422) {
    return { erro: fraseDoIdQueNaoFoiAceito(envelopeId), ok: false, status: 502 };
  }

  return {
    erro: `Não foi possível reenviar o convite: ${enviado.erro}. O envelope continua como estava.`,
    ok: false,
    status: 502,
  };
}

/**
 * A frase de quando não se sabe o id do signatário na Clicksign.
 *
 * ⚠️ ELA DIZ O QUE FAZER, e é por isso que existe como constante: as DUAS telas do painel de
 * assinatura usam a mesma explicação no tooltip do botão desabilitado, e as três não podem contar
 * histórias diferentes. O texto mora em `lib/assinatura/recusa-de-reenvio.ts` porque este arquivo
 * arrasta a porta da Clicksign (que lê `process.env`) e não pode entrar num componente de cliente.
 */
export { RECUSA_DE_REENVIO_SEM_ID } from "@/lib/assinatura/recusa-de-reenvio";

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

  // ⚠️ CHAVE QUE NÃO FALA COM A CLICKSIGN NÃO ENTRA NESTE FLUXO, e a recusa vem aqui porque daqui
  // para baixo o `signerId` é o que vai no `DELETE /envelopes/{id}/signers/{id}` do passo 1. `tmp:`
  // (o que `abrirRegistro` grava em todo mundo antes do carimbo do envio, em
  // `lib/assinatura/envio-db.ts`), `c2x:` (D4Sign) e o PRÓPRIO E-MAIL (o que `juntarComOsCongelados`
  // põe na `chave` de quem só existe na lista congelada) não são signatário de ninguém lá: a resposta
  // é 404, não 403, e o 404 SEGUE EM FRENTE de propósito no passo 1 — o signatário antigo FICARIA no
  // envelope, um duplicado nasceria com o e-mail novo e a tela escreveria "a Clicksign não achou o
  // signatário antigo", que é verdade sobre uma chave que nunca foi dele.
  //
  // ⚠️ ATÉ 01/10/2026 ESTA GUARDA DEIXAVA O E-MAIL PASSAR, e quem o barrava era `podeMexer` na tela
  // (`modules/temis/blocks/trabalho/tela-de-trabalho.tsx`) — que apagava a faixa de ações INTEIRA no
  // caminho. A régua desceu para cá, onde o pedido chega por HTTP, e lá ela ficou só no botão da troca.
  if (!chaveDaClicksign(signerId)) {
    return { erro: RECUSA_DE_CHAVE_QUE_NAO_E_DA_CLICKSIGN, ok: false, removido: false, status: 409 };
  }

  // ── 0. O QUE SE CONFERE ANTES DE MEXER EM QUALQUER COISA ──────────────────
  const linha = await lerEnvelope(sb, envelopeId);
  if (!linha.ok) return { erro: linha.erro, ok: false, removido: false, status: linha.status };

  // ⚠️ ENVELOPE ENCERRADO NÃO RECEBE TROCA, E ESTA É A OUTRA PORTA DO MESMO DANO. A trava de estado
  // nasceu no reenvio, e a troca é o gesto IRREVERSÍVEL que TAMBÉM NOTIFICA (passo 4, logo abaixo):
  // sem esta guarda, o convite de um envelope morto continuava alcançável por aqui, com uma remoção
  // de signatário por cima. Medido em produção em 01/10/2026 (só SELECT): dos 29 envelopes da
  // Clicksign, 4 estão `cancelado` e 3 deles não têm nenhuma `chave` no quadro — e nesses 3 a tela da
  // Têmis habilita "Corrigir o e-mail", porque `podeTrocarEmail` só olha o "@" e a chave que o diário
  // entrega é o uuid do webhook. O resultado seria: signatário removido de um envelope cancelado,
  // outro criado em cima, e um link morto na caixa de entrada do cliente.
  if (linha.estado && ehTerminal(linha.estado)) {
    return {
      erro: fraseDeEnvelopeEncerrado(linha.estado, envelopeId),
      ok: false,
      removido: false,
      status: 409,
    };
  }

  const alvo = await acharOSignatario(sb, {
    envelopeId,
    propostaId: linha.propostaId,
    signatarios: linha.signatarios,
    signerId,
  });
  if (!alvo.ok) return { erro: alvo.erro, ok: false, removido: false, status: alvo.status };

  // ⚠️ QUEM JÁ ASSINOU NÃO TEM E-MAIL TROCADO, E A TRAVA É NOSSA. Até 01/10/2026 a única barreira era
  // o 403 da Clicksign na remoção: nem `podeMexer` na tela (`tela-de-trabalho.tsx`, que só exige que
  // a chave não tenha "@") nem `conferirEmailDaTroca` olhavam assinatura. Depender do 403 é depender
  // de o id mandado ser o da pessoa certa — e quando ele não é, vem 404, que SEGUE EM FRENTE. Medido
  // em produção em 01/10/2026 (só SELECT): 17 das 87 linhas dos 18 envelopes vivos sem id já têm
  // `assinado_em`, 3 delas num contrato da Têmis de 11 signatários.
  if (alvo.congelado.assinadoEm) {
    return { erro: RECUSA_DE_TROCA_DE_QUEM_JA_ASSINOU, ok: false, removido: false, status: 409 };
  }

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
    envelopeId,
    lido: linha,
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
  /**
   * O `atualizado_em` da linha quando ela foi lida: a VERSÃO do quadro. A troca a manda para a
   * função da 0195 (`p_quadro_de`), que recusa se o quadro mudou no meio (plano, bug 8.6).
   */
  atualizadoEm: null | string;
  /** O id do documento NA CLICKSIGN — é ele que os requisitos apontam. */
  documentoId: string;
  /**
   * O estado no vocabulário da Têmis, para o reenvio não convidar ninguém a um envelope encerrado.
   *
   * ⚠️ `null` = a coluna veio vazia (envelope antigo), e aí ele NÃO é tratado como terminal: o
   * desconhecido não pode virar recusa, pela mesma régua do `?? "desconhecido"` do diário.
   */
  estado: EstadoDaAssinatura | null;
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
 *
 * ⚠️ E SÓ DA CLICKSIGN (0.15 do plano). Desde a F3 a mesma tabela guarda os envelopes que o C2X
 * mandou pela D4Sign; trocar signatário e reenviar convite são ações DA CLICKSIGN, e uma linha da
 * D4Sign aqui mandaria à Clicksign o id de um documento que ela não conhece.
 */
async function lerEnvelope(
  sb: SupabaseClient,
  envelopeId: string,
): Promise<EnvelopeLido | { erro: string; ok: false; status: 404 | 503 }> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .select("id, proposta_id, provedor_documento_id, signatarios, atualizado_em, estado")
    .eq("provedor", "clicksign")
    .eq("envelope_id", envelopeId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[temis][troca de signatário] falha ao ler o envelope", {
      code: error.code ?? null,
      message: error.message ?? null,
    });
    return { erro: "Não foi possível abrir o envelope deste contrato.", ok: false, status: 503 };
  }

  const linha = data as null | {
    atualizado_em?: null | string;
    estado?: null | string;
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
    atualizadoEm: linha.atualizado_em ?? null,
    documentoId: (linha.provedor_documento_id ?? "").trim(),
    estado: (linha.estado?.trim() || null) as EstadoDaAssinatura | null,
    ok: true,
    propostaId: linha.proposta_id,
    registroId: linha.id,
    signatarios: lerSignatariosCongelados(linha.signatarios),
  };
}

/**
 * ESTA `signer.key` É DE ALGUÉM DESTE ENVELOPE? — pelo payload que o webhook já deixou no banco.
 *
 * ⚠️ É A CONFERÊNCIA QUE IMPEDE O NAVEGADOR DE ESCOLHER QUEM RECEBE CONVITE. Nos 18 envelopes vivos
 * sem `chave` no quadro (medidos em 01/10/2026, só SELECT) o id que a tela manda vem de
 * `temis_assinatura_eventos.payload->document->signers[].key` — e é lendo de lá que o servidor
 * confirma que aquele id é mesmo deste envelope, sem acreditar no pedido.
 *
 * ⚠️ E O PAR É O MESMO DO DIÁRIO, DE PROPÓSITO. `payloadMaisRecente` filtra o evento CONFERIDO (HMAC
 * válido) e casa por `provedor_documento_id`, e `quemAssinou` é a única régua da casa para extrair
 * pessoa de payload. Uma segunda leitura ou uma segunda régua aqui é como o "assinou" de uma pessoa
 * aparece na linha de outra.
 *
 * ⚠️ NUNCA LANÇA, E `null` NÃO ACUSA NINGUÉM: ele quer dizer "não temos de onde provar", e quem chama
 * recusa sem chamada nenhuma.
 *
 * ⚠️ E ELE DEVOLVE O `assinouEm` QUE `quemAssinou` JÁ CALCULOU, porque jogá-lo fora era um buraco.
 * O payload sabe mais que o quadro: medido em produção em 01/10/2026 (só SELECT), nos 18 envelopes
 * vivos sem chave há 19 eventos `sign` no payload mais recente e só 17 `assinado_em` nas 87 linhas de
 * `temis_envelopes.signatarios`. Devolver só o e-mail fazia a trava de "quem já assinou" perguntar
 * apenas ao quadro, e as 2 linhas de diferença (pessoas reais, de termos de acordo do Hades)
 * receberiam convite de um documento que elas já assinaram.
 */
async function noPayloadDesteEnvelope(
  sb: SupabaseClient,
  pedido: { documentoId: string; envelopeId: string },
  idPedido: string,
): Promise<null | { assinouEm: null | string; email: string }> {
  const payload = await payloadMaisRecente(sb, {
    envelope_id: pedido.envelopeId || null,
    provedor_documento_id: pedido.documentoId || null,
  });
  if (payload === null) return null;

  const achado = quemAssinou(payload).find((s) => chaveDaClicksign(s.chave) === idPedido);
  return achado ? { assinouEm: achado.assinouEm, email: achado.email } : null;
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
  //
  // ⚠️ SÓ VALE PARA CHAVE QUE É ID DA CLICKSIGN. `tmp:`, `c2x:` e e-mail não são signatário de ninguém
  // lá, e casar por eles aqui faria o `signerId` do navegador ser aceito como identidade e seguir cru para
  // o `DELETE /signers/{id}` do passo 1, onde a resposta é 404 (não 403) e o 404 SEGUE EM FRENTE: o
  // signatário antigo ficaria no envelope e um duplicado nasceria com o e-mail novo. Sem o atalho, a
  // identidade cai no diário, que é onde ela de fato está.
  const pelaChave = chaveDaClicksign(pedido.signerId)
    ? pedido.signatarios.find((p) => p.chave === pedido.signerId)
    : undefined;
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
    // ⚠️ A FRASE DIZ O PROVEDOR DO ENVELOPE QUE ESTÁ VALENDO (0.15 do plano), e não "Clicksign" fixo:
    // o diário lê só a Clicksign hoje, mas a frase não pode mandar alguém procurar lá um envelope
    // que está em outro provedor no dia em que isso mudar.
    const provedor = diario.envelope.provedor === "d4sign" ? "D4Sign" : "Clicksign";
    return {
      erro: `Este contrato já tem um envelope mais novo na ${provedor}. Atualize a tela: a troca de e-mail vale para o envelope que está valendo, não para o ${pedido.envelopeId}.`,
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

  // ⚠️ E-MAIL REPETIDO NO QUADRO NÃO IDENTIFICA NINGUÉM, E A RECUSA VEM COM O MOTIVO CERTO. A
  // remoção já NÃO era alcançável neste caso (medido no próprio código em 01/10/2026, desfazendo esta
  // guarda: `conferirEmailDaTroca` projeta o e-mail novo em TODA linha com o endereço antigo, as duas
  // viram o mesmo endereço e `conferirSignatarios` recusa com 409, sem nenhuma chamada). O que estava
  // errado era a FRASE, que culpava o endereço NOVO e mandava o operador corrigir o campo errado.
  //
  // ⚠️ E DESARMA DUAS ARMADILHAS LATENTES: o `find` escolhia a PRIMEIRA linha com aquele endereço, e é
  // dela que a trava de `assinadoEm` lê a marca (a key de quem JÁ ASSINOU casava na linha pendente);
  // e `quadroComATroca` gravava a mesma `chaveNova` e o mesmo e-mail novo em TODAS as linhas que
  // casassem. Qualquer reordenação futura destas conferências viraria remoção de quem assinou. Medido
  // em produção em 01/10/2026 (só SELECT): nenhum dos 29 envelopes da Clicksign tem e-mail repetido
  // hoje, mas 23 dos 2.231 da D4Sign têm — a forma existe em contrato real.
  const comEsseEmail = pedido.signatarios.filter(
    (p) => p.email.toLowerCase() === doDiario.email.trim().toLowerCase(),
  );
  if (comEsseEmail.length > 1) {
    return { erro: RECUSA_DE_EMAIL_REPETIDO_NO_QUADRO, ok: false, status: 409 };
  }

  const congelado = comEsseEmail[0];
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
 * ⚠️ E DESDE A F1 DA FONTE ÚNICA (28/09/2026) QUEM GRAVA É A FUNÇÃO DA 0195 (bug 8.6), com a VERSÃO
 * lida (`p_quadro_de` = o `atualizado_em` de quando a linha foi lida). O update antigo reescrevia o
 * jsonb sem trava: um webhook que gravasse a assinatura de alguém entre a leitura e a escrita
 * perdia a marca. A função casa cada pessoa pela `chave`, leva as marcas de quem continua no quadro
 * (`assinado_em` não se perde) e recusa com `quadro_mudou` se a linha andou; aí esta função relê e
 * tenta UMA vez.
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
    envelopeId: string;
    lido: EnvelopeLido;
  },
): Promise<boolean> {
  let lido = dados.lido;

  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    const lista = quadroComATroca(lido.signatarios, dados);
    const chamada = await chamarRegistroDasAssinaturas(sb, lido.registroId, {
      quadro: lista,
      quadroDe: lido.atualizadoEm,
    });

    if (chamada.tipo === "feito" && !chamada.registro.recusa) return true;

    if (chamada.tipo === "feito" && chamada.registro.recusa === "quadro_mudou" && tentativa === 1) {
      // ⚠️ RELÊ E TENTA UMA VEZ: alguém (o webhook, quase sempre) gravou no quadro entre a leitura e
      // esta escrita. A lista é refeita a partir do quadro NOVO, com as marcas dele.
      const relido = await lerEnvelope(sb, dados.envelopeId);
      if (!relido.ok) break;
      lido = relido;
      continue;
    }

    // ⚠️ SEM A 0195 (`funcao_ausente`) NÃO HÁ GESTO DE RESERVA (plano, F1: "sem caminho antigo de
    // reserva"). O update antigo do jsonb inteiro é o próprio bug 8.6; a F1 só sobe com a 0195
    // aplicada, e se faltar, a troca vira o aviso abaixo, como qualquer outra falha do registro.
    break;
  }

  // ⚠️ O LOG NÃO LEVA E-MAIL NEM NOME: só o id da nossa linha. Ver a nota de
  // `chamarRegistroDasAssinaturas` sobre o que o erro do PostgREST arrasta junto.
  console.error(
    "[temis][troca de signatário] A TROCA FOI FEITA NA CLICKSIGN E O REGISTRO NÃO ATUALIZOU. registro:",
    lido.registroId,
  );
  return false;
}

/**
 * A lista congelada com a pessoa trocada: e-mail novo e a chave nova da Clicksign.
 *
 * ⚠️ QUEM NÃO TEM `chave` SAI SEM O CAMPO, E NÃO COM `tmp:<posição>` CUNHADA AGORA. Era isso que esta
 * função fazia (`p.chave ?? chaveProvisoria(indice + 1)`), e a chave inventada MOVE ASSINATURA. Medido
 * em produção em 01/10/2026 (só SELECT): ZERO das 87 linhas dos 18 envelopes vivos sem id têm o campo
 * `chave`, e 104 das 159 linhas de todos os 29 envelopes da Clicksign também não. A parte (a) da
 * `0195_o_contrato_mora_no_panteon.sql` (perto da 251) casa a linha antiga PELA CHAVE antes de casar
 * pelo e-mail: gravado um `tmp:1` POSICIONAL na linha de quem assinou, uma reescrita seguinte em que a
 * ordem do quadro mudou põe esse mesmo `tmp:1` na linha de OUTRA pessoa — e a função leva o
 * `assinado_em` junto, para quem nunca assinou. Sem o campo, a 0195 reencontra a linha pelo e-mail
 * ÚNICO (ela só testa `nullif(item->>'chave','') is not null`), que é o caminho que o banco já usa.
 *
 * ⚠️ E O `tmp:` NÃO ERA SÓ RISCO DE MARCA: ele vira o `signerId` que a tela manda, e `tmp:N` no
 * `DELETE /envelopes/{id}/signers/{id}` volta 404 — que a troca de e-mail SEGUE EM FRENTE de propósito,
 * deixando o signatário antigo no envelope e um duplicado nascendo com o e-mail novo.
 */
function quadroComATroca(
  signatarios: readonly SignatarioCongelado[],
  dados: { chaveNova: string; emailAntigo: string; emailNovo: string },
): ItemParaGravar[] {
  const alvo = dados.emailAntigo.trim().toLowerCase();
  // ⚠️ UMA LINHA SÓ, E A PRIMEIRA — porque duas linhas com o mesmo endereço receberiam A MESMA
  // `chaveNova` E O MESMO e-mail novo, virando a mesma pessoa duas vezes no quadro. `acharOSignatario`
  // já recusa e-mail repetido antes de qualquer remoção, então aqui só existe uma; a guarda do
  // índice é o que limita o dano se o quadro ganhar um repetido entre a leitura e a releitura do
  // `quadro_mudou` (`gravarTrocaNoRegistro` relê e refaz a lista).
  let trocada = false;
  return signatarios.map((p) => {
    if (!trocada && p.email.trim().toLowerCase() === alvo) {
      trocada = true;
      return {
        chave: dados.chaveNova,
        email: dados.emailNovo,
        nome: p.nome,
        ordem: p.ordem,
        papel: p.papel,
      };
    }
    return {
      ...(p.chave === null ? {} : { chave: p.chave }),
      email: p.email,
      nome: p.nome,
      ordem: p.ordem,
      papel: p.papel,
    };
  });
}

/**
 * QUEM É A LINHA QUE O OPERADOR CLICOU? — pelo quadro, que é a nossa fonte.
 *
 * ⚠️ PRIMEIRO PELA CHAVE, DEPOIS PELO E-MAIL. A chave acerta nos 8 envelopes que a têm congelada; o
 * e-mail é o que sobra nos 18 que não a têm, e é por ele que a `signer.key` do payload encontra a
 * linha do quadro onde moram `assinado_em` e `recusado_em`.
 *
 * ⚠️ E-MAIL REPETIDO NÃO IDENTIFICA NINGUÉM, e aí a resposta é `ambiguo`. Escolher o primeiro mandaria
 * o convite para a pessoa errada, sem nem poder olhar se ela já assinou; é a mesma régua que a função
 * da 0195 usa para casar quadro por e-mail (só quando ele é único).
 */
export function acharNoQuadro(
  signatarios: readonly SignatarioCongelado[],
  pedido: { email?: string; signerId: string },
): { ambiguo: boolean; pessoa: null | SignatarioCongelado } {
  const pelaChave = signatarios.find((p) => p.chave !== null && p.chave === pedido.signerId);
  if (pelaChave) return { ambiguo: false, pessoa: pelaChave };

  const email = (pedido.email ?? "").trim().toLowerCase();
  if (!email) return { ambiguo: false, pessoa: null };

  const casam = signatarios.filter((p) => p.email.trim().toLowerCase() === email);
  // ⚠️ DUAS LINHAS COM O MESMO ENDEREÇO NÃO SÃO "NÃO ACHEI": são um pedido que não dá para atender,
  // e quem chama precisa distinguir, porque na dúvida nem a trava de quem já assinou vale.
  if (casam.length > 1) return { ambiguo: true, pessoa: null };
  return { ambiguo: false, pessoa: casam[0] ?? null };
}
