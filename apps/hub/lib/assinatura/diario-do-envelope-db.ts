import type { SupabaseClient } from "@supabase/supabase-js";

import { ehTerminal, type EstadoDaAssinatura } from "@/lib/assinatura/tipos";

import { chaveDaClicksign } from "./congelar-signatarios";
import {
  diarioDoEnvelope,
  type FatoDoEnvelope,
  quemAssinou,
  recadastrosDepoisDoEnvio,
  type SignatarioDoEnvelope,
  vencimentoDoPayload,
} from "./diario-do-envelope";
import { naOrdemDaFila } from "./fila-de-assinatura";
import { fraseDoReenvioBloqueado, type MotivoDoReenvioBloqueado } from "./recusa-de-reenvio";

// O DIÁRIO DA PROPOSTA — a leitura que a tela e o card usam.
//
// ⚠️ UM PAYLOAD BASTA, E É ISSO QUE TORNA A COISA BARATA. A Clicksign manda o `document.events[]`
// INTEIRO em todo webhook: o payload do evento mais recente contém a história toda, desde o upload.
// Ler os N eventos do envelope e juntar daria exatamente a mesma resposta com N vezes o custo — e a
// casa já teve fatura alta da Vercel por leitura repetida. São DUAS consultas, sempre: o envelope e
// um payload.
//
// ⚠️ E NÃO HÁ POLLING AQUI. Isto é leitura sob demanda, na carga da tela. Quem atualiza o estado é o
// webhook (`estado-db.ts`), que é empurrado pela Clicksign.
//
// ⚠️ NUNCA LANÇA. O diário é enfeite: ele explica por que o contrato está parado. Derrubar a etapa
// do contrato porque a consulta do enfeite falhou seria trocar a tela inteira por uma informação a
// mais. Erro vira `null` e um `console.error`.

/** Como a tela recebe cada pessoa: o que os eventos contaram, mais o papel que NÓS congelamos. */
export type SignatarioDaProposta = SignatarioDoEnvelope & {
  /**
   * Quando esta pessoa foi recadastrada com o envelope já enviado (e por isso foi para o FIM da fila
   * de assinatura). `null` = não foi. Ver `recadastrosDepoisDoEnvio`.
   */
  foiParaOFimEm: null | string;
  /**
   * `comprador`, `conjuge`, `vendedora`… vindo de `temis_envelopes.signatarios`.
   *
   * ⚠️ ELE NÃO VEM DA CLICKSIGN. A Clicksign só conhece `qualification`; o papel no CONTRATO é
   * nosso, congelado no envio, e é o que a tela mostra ao lado do nome. `null` quando a pessoa
   * apareceu nos eventos e não está na lista congelada (signatário acrescentado por fora).
   */
  papel: null | string;
  /**
   * O PERFIL DE TELA ("Comprador", "Backoffice", "Imobiliária"…), SÓ NO QUADRO DA D4SIGN. Ausente na
   * Clicksign, onde quem diz é o `papel`.
   *
   * ⚠️ NA D4SIGN O PAPEL É NULO (o C2X não diz cônjuge nem vendedora, `espelho-d4sign/quadro.ts`), e é
   * o perfil "Comprador" que a régua do comprador reconhece (`ehCompradorNoQuadro`). Sem ele na tela, o
   * painel não saberia contar os compradores que levam o card ao Pré-faturamento.
   */
  perfil?: null | string;
  /**
   * O DEGRAU DESTA PESSOA NA FILA DE ASSINATURA — o `group` da Clicksign. `null` = fora do quadro
   * congelado (acrescentada por fora), e aí a tela a põe no fim, sem degrau.
   *
   * ⚠️ É O SERVIDOR QUE NUMERA, E A TELA SÓ AGRUPA (Lucas, 02/10/2026, no mockup aprovado da etapa
   * "Em assinatura": a lista vira uma fila de degraus). O número é o que `naOrdemDaFila` já usava para
   * ordenar: o degrau do envio (`max(1, ordem)`), e para quem foi recadastrado com o envelope rodando,
   * o último degrau + 1 por recadastro. Recalcular na tela seria uma segunda régua para a mesma fila.
   *
   * ⚠️ OS NÚMEROS PODEM TER BURACO: a Maura do VOC0306 saiu do degrau 3 (o 3 ficou vazio) e foi para o
   * 6. A tela numera os degraus em sequência para quem lê; este é o número da Clicksign.
   */
  posicao: null | number;
  /**
   * O reenvio de convite NÃO PODE ser tentado para esta pessoa — `null` = pode.
   *
   * ⚠️ ELE ENCOLHEU EM 01/10/2026, PORQUE A `signer.key` DO WEBHOOK É O SIGNER ID. O endpoint do
   * reenvio é `POST /envelopes/{id}/signers/{signer_id}/notifications`, e até aqui o código afirmava
   * que o único id aceito era o que a Clicksign devolveu no ENVIO — então quem não tinha `chave`
   * congelada ficava com o botão desabilitado. A afirmação era dedução. Medido em produção em
   * 01/10/2026 (só SELECT, projeto bxgukywoxgivlrhjkwjx), cruzando a `chave` congelada com
   * `temis_assinatura_eventos.payload->document->signers[].key` por envelope e e-mail: 54 pares, 54
   * IDÊNTICAS, 0 diferentes, 8 envelopes. E nos 18 envelopes VIVOS sem nenhuma `chave` (14 termos de
   * acordo do Hades e 4 contratos da Têmis) as 70 pessoas sem `assinado_em` no quadro TODAS têm
   * `signer.key` no payload — e 68 delas precisam de convite, porque 2 já assinaram pelo payload e a
   * marca do quadro ficou atrás. Lucas, no mesmo dia: *"Nao consigo reenviar os contratos."*
   *
   * ⚠️ E ELE DEIXOU DE SER UM BOOLEANO, PORQUE UM BOOLEANO MENTIA. São TRÊS motivos (ver
   * `MotivoDoReenvioBloqueado`), e as duas telas mostravam `RECUSA_DE_REENVIO_SEM_ID` nos três — uma
   * frase que afirma que a pessoa "só aparece na lista que o envio congelou", o INVERSO exato do
   * motivo `fora_do_quadro`. O motivo viaja junto com a frase pronta: o motivo é o que o teste
   * prende, e a frase é o que a tela escreve, sem um `if` por tela.
   *
   * ⚠️ E O ESTADO DO ENVELOPE ENTRA AQUI, NÃO SÓ NO SERVIDOR. `reenviarConvite` passou a recusar
   * envelope terminal, e sem esta régua a tela OFERECIA o gesto que o servidor recusa com 409.
   * Medido em produção em 01/10/2026 (só SELECT): nos 3 envelopes `cancelado` sem nenhuma `chave` no
   * quadro são 16 linhas com `signer.key` em forma de uuid, com linha no quadro e `assinado_em` nulo
   * — 16 botões que ficariam habilitados para dar faixa vermelha. A própria casa já escreveu a regra
   * no painel do Hades: *"O BOTÃO QUE TENTA E FALHA É PIOR DO QUE O BOTÃO DESABILITADO"*.
   */
  reenvioIndisponivel: null | { frase: string; motivo: MotivoDoReenvioBloqueado };
  /**
   * O aviso de que corrigir o e-mail desta pessoa a manda para o fim da fila. `null` = não muda nada
   * (ela já é a última, já assinou, ou o envelope terminou). Ver `fraseDaTrocaQueVaiParaOFim`.
   */
  trocaVaiParaOFim: null | string;
};

export type EnvelopeDoDiario = {
  atualizadoEm: null | string;
  /**
   * Quando o espelho conferiu este envelope com a D4Sign pela última vez (`temis_envelopes.conferido_em`).
   * SÓ NA D4SIGN: lá não há webhook, e o painel diz de quando é o que mostra. Ausente na Clicksign.
   */
  conferidoEm?: null | string;
  /**
   * O NOSSO documento que ESTE envelope levou — a linha de `hercules_documentos` cujo arquivo foi
   * baixado do Storage e mandado para a Clicksign (`lib/assinatura/envio-db.ts`).
   *
   * ⚠️ ELE NÃO É "O CONTRATO VIGENTE", e a diferença é o motivo de o campo existir. `contratoVigente`
   * responde "qual a geração mais recente"; este campo responde "qual folha está na mão de quem
   * assina". Gerar uma v2 depois do envio separa as duas respostas sem avisar ninguém, e conferir a
   * folha errada é pior do que não conferir. Nívea (24/09/2026): *"Não consigo visualizar o contrato
   * depois que enviamos para assinatura. Se precisamos validar alguma informação, não conseguimos
   * ver."*
   *
   * ⚠️ MEDIDO EM 24/09/2026: nos 5 cards em "Em assinatura" os dois coincidem hoje — mas três deles
   * têm 2, 3 e 6 versões guardadas, então a coincidência é sorte de calendário, não regra.
   *
   * `null` = envelope antigo, gravado antes de a coluna ser preenchida.
   */
  documentoId: null | string;
  /**
   * O id do envelope NA CLICKSIGN — o número que se procura na conta deles.
   *
   * ⚠️ NÃO CONFUNDIR COM `id`, QUE É A NOSSA LINHA. É este que a tela escreve ao lado do log: quem
   * lê o painel e precisa abrir a Clicksign procura por ele, e mostrar o uuid da nossa tabela
   * mandaria o operador caçar um número que não existe do lado de lá. `null` = envio que começou e
   * o Panteon não soube como terminou.
   */
  envelopeId: null | string;
  /** O estado no vocabulário da Têmis: `aguardando`, `parcial`, `assinado`… */
  estado: string;
  estadoCru: null | string;
  /** A chave da NOSSA linha em `temis_envelopes`. */
  id: string;
  provedor: string;
  provedorDocumentoId: null | string;
  signatarios: SignatarioDaProposta[];
  /**
   * Quando o envelope vence, em ISO: no vencimento sem todas as assinaturas, a Clicksign o CANCELA.
   * `null` = nenhum payload ainda, ou o payload sem a data. Ver `vencimentoDoPayload`.
   */
  venceEm: null | string;
};

/**
 * O diário de UM envelope: quantos assinaram, de quantos, e a história que os eventos contaram.
 *
 * ⚠️ O NOME NÃO FALA MAIS EM PROPOSTA porque desde 20/09/2026 ele serve a DOIS documentos: o
 * contrato de venda (chaveado em `proposta_id`) e o termo de acordo do Hades (chaveado em
 * `compromisso_id`). O cálculo é o mesmo, e ele é um só de propósito: duas contagens do "2 de 3
 * assinaram" divergiriam no primeiro ajuste, que é a armadilha catalogada em
 * [[reference_painel_assinatura_duas_telas]].
 */
export type DiarioDaAssinatura = {
  /** Quantos JÁ assinaram — o numerador do "1/5" que o Lucas pediu no card (12/09/2026). */
  assinaram: number;
  /** Do mais recente para o mais antigo. Vem vazio enquanto nenhum webhook chegou. */
  diario: FatoDoEnvelope[];
  envelope: EnvelopeDoDiario;
  /** Quantos signatários o envelope tem — o denominador do "1/5". */
  total: number;
};

/** O nome antigo, mantido para quem já lê o diário do contrato. */
export type DiarioDaProposta = DiarioDaAssinatura;

type LinhaDoEnvelope = {
  atualizado_em: null | string;
  documento_id: null | string;
  /** Quando NÓS carimbamos o envio: o marco que separa o cadastro do envio de um recadastro. */
  enviado_em?: null | string;
  envelope_id: null | string;
  estado: null | string;
  estado_cru: null | string;
  id: string;
  provedor: null | string;
  provedor_documento_id: null | string;
  signatarios: unknown;
};

/**
 * O diário do envelope MAIS RECENTE desta proposta.
 *
 * Devolve `null` quando não há envelope nenhum, ou quando alguma consulta falhou — os dois casos em
 * que a tela simplesmente não mostra o bloco. Um envelope que existe mas ainda não recebeu webhook
 * volta como objeto, com `diario` vazio e a contagem vinda da lista congelada no envio: é a
 * diferença entre "não temos o que contar ainda" e "não há o que contar".
 */
export async function diarioDaProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<DiarioDaAssinatura | null> {
  if (!propostaId) return null;

  const envelope = await envelopeMaisRecente(sb, propostaId);
  if (!envelope) return null;

  return diarioDaLinha(sb, envelope);
}

/**
 * O diário do envelope mais recente de um ACORDO do Hades (`guardian_compromissos`).
 *
 * ⚠️ MESMO MIOLO, OUTRA CHAVE, E É SÓ ISSO QUE MUDA. O acordo não tem proposta — `proposta_id` fica
 * NULO no envelope dele de propósito (ver `lib/hades/acordo/envio-db.ts`) —, então a consulta é por
 * `compromisso_id`. Tudo o que vem depois (o payload do webhook, `quemAssinou`, `diarioDoEnvelope`,
 * a junção com a lista congelada) é exatamente o mesmo código que o contrato usa.
 *
 * ⚠️ E ELE TOLERA A MIGRATION 0179 AUSENTE. Sem a coluna, a consulta falha com 42703 e a resposta é
 * `null`, que é a resposta CERTA: sem coluna não existe envelope de acordo nenhum para narrar. A
 * tela simplesmente não desenha o bloco, como faz quando o acordo ainda não foi enviado.
 */
export async function diarioDoCompromisso(
  sb: SupabaseClient,
  compromissoId: string,
): Promise<DiarioDaAssinatura | null> {
  if (!compromissoId) return null;

  const envelope = await envelopeMaisRecenteDoCompromisso(sb, compromissoId);
  if (!envelope) return null;

  return diarioDaLinha(sb, envelope);
}

/**
 * O miolo, a partir da LINHA do envelope: vale para contrato e para acordo.
 *
 * ⚠️ ELE RECEBE A LINHA, E NÃO O ID, e essa é a costura inteira da reutilização. Quem sabe procurar
 * o envelope é quem conhece a chave (proposta ou compromisso); daqui para a frente nada mais
 * depende de saber que documento é aquele.
 */
async function diarioDaLinha(
  sb: SupabaseClient,
  envelope: LinhaDoEnvelope,
): Promise<DiarioDaAssinatura> {
  const payload = await payloadMaisRecente(sb, envelope);
  const congelados = signatariosCongelados(envelope.signatarios);

  const doPayload = payload === null ? [] : quemAssinou(payload);
  const recadastros = payload === null ? new Map<string, string>() : recadastrosDepoisDoEnvio(payload, envelope.enviado_em ?? null);
  // ⚠️ O ESTADO VAI JUNTO PARA A TELA NÃO OFERECER O QUE O SERVIDOR RECUSA. `reenviarConvite` recusa
  // envelope terminal com 409 (medido: 3 envelopes `cancelado` sem chave, 16 linhas que ficariam com
  // o botão habilitado), e a régua do botão é esta junção.
  const signatarios = juntarComOsCongelados(
    doPayload,
    congelados,
    { envelopeId: envelope.envelope_id, estado: envelope.estado },
    recadastros,
  );

  return {
    assinaram: signatarios.filter((s) => s.assinouEm !== null).length,
    diario: payload === null ? [] : diarioDoEnvelope(payload),
    envelope: {
      atualizadoEm: envelope.atualizado_em,
      documentoId: envelope.documento_id,
      envelopeId: envelope.envelope_id,
      estado: envelope.estado ?? "desconhecido",
      estadoCru: envelope.estado_cru,
      id: envelope.id,
      provedor: envelope.provedor ?? "clicksign",
      provedorDocumentoId: envelope.provedor_documento_id,
      signatarios,
      venceEm: payload === null ? null : vencimentoDoPayload(payload),
    },
    total: signatarios.length,
  };
}

/**
 * O envelope mais recente da proposta.
 *
 * ⚠️ MAIS RECENTE, E NÃO "O ENVELOPE". Uma proposta pode ter mais de um ao longo da vida — um
 * recusado e um reenviado —, e é a mesma razão pela qual `acharEnvelope` (em `estado-db.ts`) ordena
 * por `criado_em` decrescente. O diário do envelope velho contaria uma história que já não vale.
 *
 * ⚠️ E SÓ DA CLICKSIGN (0.15 do plano da fonte única). O diário é a narração do webhook DA CLICKSIGN
 * (o payload, o bounce, o reenvio de convite). Desde a F3 a mesma tabela guarda os envelopes que o
 * C2X mandou pela D4Sign, e o mais recente da proposta pode ser um deles: o diário diria "0 de 0"
 * e o botão de reenviar mandaria à Clicksign um documento que ela não conhece. O card da D4Sign tem
 * leitura própria desde 02/10/2026, pelo QUADRO (`quadro-da-d4sign-db.ts`), e quem escolhe entre as
 * duas é `abrirCardDoTrabalho`.
 */
async function envelopeMaisRecente(
  sb: SupabaseClient,
  propostaId: string,
): Promise<LinhaDoEnvelope | null> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .select(
      "id, provedor, envelope_id, provedor_documento_id, documento_id, estado, estado_cru, atualizado_em, enviado_em, signatarios",
    )
    .eq("provedor", "clicksign")
    .eq("proposta_id", propostaId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[temis][diário] falha ao ler o envelope da proposta", error.message);
    return null;
  }
  return (data as LinhaDoEnvelope | null) ?? null;
}

/**
 * O envelope mais recente de um acordo do Hades.
 *
 * ⚠️ A COLUNA PODE NÃO EXISTIR AINDA. A migration 0179 nasce pendente (aguardando o OK do Lucas) e
 * o código sobe antes dela: um 42703 aqui vira `null` sem `console.error`, porque não é defeito — é
 * a ausência esperada, e encher o log de "column compromisso_id does not exist" a cada carga de card
 * esconderia o erro de verdade no dia em que ele aparecesse.
 */
async function envelopeMaisRecenteDoCompromisso(
  sb: SupabaseClient,
  compromissoId: string,
): Promise<LinhaDoEnvelope | null> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .select(
      "id, provedor, envelope_id, provedor_documento_id, documento_id, estado, estado_cru, atualizado_em, enviado_em, signatarios",
    )
    .eq("provedor", "clicksign")
    .eq("compromisso_id", compromissoId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    const texto = `${error.code ?? ""} ${error.message ?? ""}`;
    const semAColuna =
      /compromisso_id/i.test(texto) && /42703|PGRST204|does not exist|schema cache/i.test(texto);
    if (!semAColuna) {
      console.error("[hades][diário] falha ao ler o envelope do acordo", error.message);
    }
    return null;
  }
  return (data as LinhaDoEnvelope | null) ?? null;
}

/**
 * O payload do último webhook deste envelope.
 *
 * ⚠️ O CASAMENTO É POR `provedor_documento_id`, E ISSO FOI MEDIDO, NÃO ESCOLHIDO. Nas sete linhas de
 * `temis_assinatura_eventos` existentes em 12/09/2026 a coluna `envelope_id` está NULA em TODAS:
 * quem grava o evento é a rota do webhook, que só conhece os ids que a Clicksign mandou, e a
 * Clicksign manda `document.key`. Procurar por `envelope_id` primeiro não acharia nada.
 *
 * ⚠️ E O `envelope_id` CONTINUA COMO SEGUNDA TENTATIVA. Ele é o id do ENVELOPE na Clicksign (a v3
 * tem os dois conceitos), e os eventos de envelope o trazem. Hoje não casa com nada; no dia em que
 * casar, casa sem ninguém mexer aqui — e a ordem "primeiro o preciso, depois o que salva" é a mesma
 * de `acharEnvelope`.
 *
 * ⚠️ SÓ O CONFERIDO NARRA (revisão da F1, 28/09/2026). Antes daqui não se filtrava, para não
 * esconder a pista do evento sem HMAC válido; mas desde a F1 o não conferido é gravado como
 * ESQUELETO (sem pessoa nem fato), e um só deles como o mais recente deixava o diário em "0 de N
 * assinaram" ao lado do "1/2" do card (que já filtra o conferido, `trabalhos-db.ts`). Bastava um POST
 * forjado com a chave do documento, ou o segredo do HMAC faltar na Vercel (`sem-segredo`), para
 * apagar a narração de todo envelope. A pista do não conferido continua na tabela; narração não é.
 */
// ⚠️ EXPORTADA SÓ PARA O TESTE (`diario-do-envelope.test.ts`): o filtro do conferido só se prova
// olhando o que ela pede ao banco.
export async function payloadMaisRecente(
  sb: SupabaseClient,
  envelope: Pick<LinhaDoEnvelope, "envelope_id" | "provedor_documento_id">,
): Promise<unknown> {
  const tentativas: Array<[string, string]> = [];
  if (envelope.provedor_documento_id) {
    tentativas.push(["provedor_documento_id", envelope.provedor_documento_id]);
  }
  if (envelope.envelope_id) tentativas.push(["envelope_id", envelope.envelope_id]);

  for (const [coluna, valor] of tentativas) {
    const { data, error } = await sb
      .from("temis_assinatura_eventos")
      .select("payload")
      .eq(coluna, valor)
      .eq("assinatura_conferida", true)
      .order("recebido_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[temis][diário] falha ao ler o payload do envelope", error.message);
      continue;
    }
    const linha = data as null | { payload: unknown };
    if (linha?.payload) return linha.payload;
  }

  return null;
}

export type SignatarioCongelado = {
  /** O id na Clicksign, congelado no envio (ou gravado por uma troca de e-mail). */
  chave: null | string;
  email: string;
  nome: string;
  /**
   * O degrau de assinatura que o envio mandou (o `group` da Clicksign). `0` = envelope sem ordem.
   * Opcional só para quem monta a lista à mão (os testes); quem lê o quadro sempre preenche.
   */
  ordem?: number;
  papel: null | string;
};

/** A lista que o envio congelou em `temis_envelopes.signatarios` (`{ nome, email, ordem, papel }`). */
function signatariosCongelados(bruto: unknown): SignatarioCongelado[] {
  if (!Array.isArray(bruto)) return [];
  const saida: SignatarioCongelado[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const pessoa = item as Record<string, unknown>;
    saida.push({
      // ⚠️ `tmp:` (antes do carimbo), `c2x:` (D4Sign) e e-mail NÃO SÃO ID DA CLICKSIGN: contá-los como
      // chave liberaria o reenvio de convite com um valor que leva 422.
      chave: chaveDaClicksign(pessoa.chave),
      email: typeof pessoa.email === "string" ? pessoa.email.trim() : "",
      nome: typeof pessoa.nome === "string" ? pessoa.nome.trim() : "",
      ordem: typeof pessoa.ordem === "number" && Number.isFinite(pessoa.ordem) ? pessoa.ordem : 0,
      papel: typeof pessoa.papel === "string" ? pessoa.papel : null,
    });
  }
  return saida;
}

/**
 * Junta o que os eventos contaram com o que o envio congelou.
 *
 * ⚠️ QUEM NUNCA APARECEU NUM EVENTO PRECISA APARECER NA CONTA. O denominador do "1/5" é quantas
 * pessoas TÊM de assinar — e antes do primeiro webhook nenhuma delas apareceu em evento nenhum. Sem
 * esta junção o card mostraria "0/0" no envelope recém-enviado, que é a hora em que o operador mais
 * olha para ele.
 *
 * ⚠️ O CASAMENTO AQUI É POR E-MAIL, e não por `signer.key`, porque a lista congelada NÃO TEM chave:
 * ela nasce antes de a Clicksign existir para aquele contrato. O e-mail serve porque a CAD já trava
 * e-mail repetido por pessoa (`lib/apolo/email-unico.ts`) — e continua não sendo o nome, que é o
 * campo que se repete e muda de acento.
 */
export function juntarComOsCongelados(
  doPayload: SignatarioDoEnvelope[],
  congelados: SignatarioCongelado[],
  envelope: { envelopeId?: null | string; estado?: null | string } = {},
  recadastros: ReadonlyMap<string, string> = new Map(),
): SignatarioDaProposta[] {
  const congeladoPorEmail = new Map<string, SignatarioCongelado>();
  for (const c of congelados) {
    if (c.email) congeladoPorEmail.set(c.email.toLowerCase(), c);
  }

  /**
   * O envelope já terminou? Então NENHUMA linha tem reenvio, e o motivo é do envelope, não da pessoa.
   *
   * ⚠️ `desconhecido` E VAZIO NÃO SÃO TERMINAIS, pela mesma régua do `?? "desconhecido"` daqui e do
   * `estado` de `lerEnvelope`: o que não se sabe não pode virar recusa. `ehTerminal` só diz sim para
   * `assinado`, `recusado`, `cancelado` e `expirado` (`lib/assinatura/tipos.ts`).
   */
  const estado = (envelope.estado ?? "").trim();
  const encerrado =
    estado && ehTerminal(estado as EstadoDaAssinatura)
      ? {
          frase: fraseDoReenvioBloqueado("envelope_encerrado", {
            envelopeId: envelope.envelopeId ?? null,
            estado,
          }),
          motivo: "envelope_encerrado" as const,
        }
      : null;

  /** O motivo da linha, na MESMA ORDEM em que `reenviarConvite` pergunta. */
  const bloqueio = (
    chave: null | string,
    temLinhaNoQuadro: boolean,
  ): null | { frase: string; motivo: MotivoDoReenvioBloqueado } => {
    if (encerrado) return encerrado;
    if (chaveDaClicksign(chave) === null) {
      return { frase: fraseDoReenvioBloqueado("sem_id_na_clicksign"), motivo: "sem_id_na_clicksign" };
    }
    if (!temLinhaNoQuadro) {
      return { frase: fraseDoReenvioBloqueado("fora_do_quadro"), motivo: "fora_do_quadro" };
    }
    return null;
  };

  // ⚠️ A CHAVE CONGELADA VENCE A DO WEBHOOK, E AS DUAS SERVEM. Medido em produção em 01/10/2026 (só
  // SELECT): elas são o MESMO valor em 54 de 54 pares (8 envelopes, zero diferenças), então a ordem
  // aqui é só preferência pelo que já é nosso. `congelado.chave` já passou por `chaveDaClicksign` (em
  // `signatariosCongelados`, acima): `tmp:`, `c2x:` e e-mail chegam como `null`, e aí a `signer.key`
  // do payload é o que a linha leva — e é ela que destrava os 68 que precisam de convite nos 18
  // envelopes (70 sem `assinado_em` no quadro, e 2 dessas já assinaram pelo payload).
  const juntos: SignatarioDaProposta[] = doPayload.map((s) => {
    const congelado = congeladoPorEmail.get(s.email.toLowerCase());
    const chave = congelado?.chave ?? s.chave;
    return {
      ...s,
      chave,
      foiParaOFimEm: recadastros.get(chave) ?? recadastros.get(s.chave) ?? null,
      papel: congelado?.papel ?? null,
      // Numerada depois, com a lista inteira: ver `naOrdemDaFila`.
      posicao: null,
      // ⚠️ A RÉGUA É A DO SERVIDOR, LINHA POR LINHA: o envelope não pode estar encerrado, a `chave`
      // tem de servir para falar com a Clicksign (e-mail, `tmp:` e `c2x:` não servem) E a pessoa tem
      // de ter linha no quadro congelado, que é onde moram `assinado_em` e `recusado_em`. Faltando
      // qualquer uma, `reenviarConvite` recusa — e oferecer o botão ali seria mandar o operador
      // clicar para ver a faixa vermelha.
      reenvioIndisponivel: bloqueio(chave, congelado !== undefined),
      // Calculado depois, com a lista inteira na ordem da fila: ver `naOrdemDaFila`.
      trocaVaiParaOFim: null,
    };
  });

  const jaTem = new Set(juntos.map((s) => s.email.toLowerCase()).filter((e) => e !== ""));
  for (const c of congelados) {
    if (c.email && jaTem.has(c.email.toLowerCase())) continue;
    juntos.push({
      assinouEm: null,
      // Sem a chave congelada sobra o e-mail, que identifica a linha na tela e NÃO vai para a
      // Clicksign: `reenvioIndisponivel` é o que impede isso, pela mesma régua do servidor.
      chave: c.chave ?? c.email,
      comecouEm: null,
      convite: "sem_noticia",
      conviteDetalhe: null,
      conviteQuando: null,
      email: c.email,
      foiParaOFimEm: c.chave === null ? null : (recadastros.get(c.chave) ?? null),
      nome: c.nome,
      papel: c.papel,
      posicao: null,
      // Quem está aqui TEM linha no quadro (ele É a linha), então decidem o estado do envelope e a chave.
      reenvioIndisponivel: bloqueio(c.chave ?? c.email, true),
      trocaVaiParaOFim: null,
    });
  }

  // ⚠️ A FILA É A RÉGUA ÚNICA DE `fila-de-assinatura.ts` (a mesma do quadro da D4Sign); aqui só se diz
  // onde cada linha está no quadro congelado, pelo e-mail (a CAD trava e-mail repetido por pessoa).
  return naOrdemDaFila(
    juntos,
    (linha) => {
      const congelado = congeladoPorEmail.get(linha.email.toLowerCase());
      return congelado === undefined ? null : { ordem: congelado.ordem ?? 0 };
    },
    { encerrado: encerrado !== null },
  );
}
