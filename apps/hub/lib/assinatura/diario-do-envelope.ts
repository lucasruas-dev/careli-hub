import { ehFalhaDeAutenticacao, estadoDoEventoClicksign } from "./traduzir";

// O DIÁRIO DO ENVELOPE — o que aconteceu com o contrato depois que ele saiu daqui.
//
// ⚠️ A INFORMAÇÃO MAIS ÚTIL DO WEBHOOK ESTAVA SENDO JOGADA FORA. Medido em produção em 12/09/2026
// (envelope 3e9a331d-ec2f-4eb5-9ae1-aafbeae8b395): o Lucas mandou o contrato para dois signatários,
// assinou como a compradora, e a tela disse só "Parcialmente assinado". Quatro segundos depois do
// envio, a Clicksign já tinha avisado que o convite do segundo signatário NUNCA FOI ENTREGUE —
// `tracking_notification_error`, `last_status: "bounce"`, `HardBounce`, "NoSuchUser". O aviso estava
// gravado no nosso próprio banco e o repo inteiro não tinha uma ocorrência de "bounce": a operação
// ficaria esperando para sempre uma assinatura de alguém que nunca recebeu o e-mail.
//
// ⚠️ E ELE NÃO CHEGA COMO WEBHOOK PRÓPRIO. A tabela `temis_assinatura_eventos` tem as linhas dos
// eventos que a conta assina (`upload`, `add_signer`, `signature_started`, `sign`) e NENHUMA de
// `tracking_notification_error`. O aviso vem DENTRO do payload dos webhooks seguintes, no array
// `document.events[]`, que a Clicksign manda INTEIRO toda vez. É por isso que esta camada lê o
// payload e não a coluna `evento`: quem olha só a coluna não vê a metade que interessa.
//
// ⚠️ POR ISSO UM PAYLOAD BASTA. O `document.events[]` do evento MAIS RECENTE contém a história toda,
// desde o upload. Ler os N eventos do envelope e juntar daria a mesma resposta com N vezes o custo.
//
// ⚠️ E POR ISSO TUDO AQUI É PURO. Nada de rede nem de banco: a leitura mora em
// `diario-do-envelope-db.ts`. Este arquivo é o que precisa estar certo, e é o que o teste prende
// contra o payload real (`__fixtures__/clicksign-sign-com-bounce.json`, anonimizado).

// ── O QUE SAI DAQUI ─────────────────────────────────────────────────────────

/**
 * O que sabemos sobre o convite que a Clicksign mandou para esta pessoa.
 *
 * ⚠️ `sem_noticia` NÃO É `entregue`, E ESSA DISTINÇÃO É O CORAÇÃO DESTE ARQUIVO. A Clicksign só
 * avisa quando algo DÁ ERRADO: silêncio quer dizer que nenhum erro chegou, e não que o e-mail caiu
 * na caixa de entrada de alguém. Chamar silêncio de "entregue" seria afirmar, na tela de um
 * contrato, uma coisa que ninguém disse — e é exatamente a afirmação que faria o operador parar de
 * procurar. `entregue` só sai quando a própria Clicksign mandar uma notificação dizendo isso.
 */
export type ConviteDoSignatario = "entregue" | "nao_entregue" | "sem_noticia";

/** Como está cada pessoa do envelope, do ponto de vista de quem cobra a assinatura. */
export type SignatarioDoEnvelope = {
  /** Quando assinou, em ISO. `null` = ainda não assinou. */
  assinouEm: null | string;
  /** A `signer.key` da Clicksign. É a identidade; o nome não é. */
  chave: string;
  /** Quando abriu o documento pela PRIMEIRA vez (`signature_started`). `null` = nunca abriu. */
  comecouEm: null | string;
  convite: ConviteDoSignatario;
  /** O motivo, em português quando dá para traduzir; o texto cru do provedor quando não dá. */
  conviteDetalhe: null | string;
  /** Quando a notícia do convite chegou, em ISO. */
  conviteQuando: null | string;
  email: string;
  nome: string;
};

/** A gravidade de um fato, para a tela pintar sem precisar reconhecer o evento. */
export type GravidadeDoFato = "erro" | "marco" | "normal";

/** Uma linha do diário, já em português e pronta para a tela. */
export type FatoDoEnvelope = {
  /** A segunda linha, quando há: o motivo do erro, o detalhe cru. */
  detalhe: null | string;
  fato: string;
  gravidade: GravidadeDoFato;
  /** De quem é o fato: o signatário, ou quem operou. `null` quando é do envelope inteiro. */
  quem: null | string;
  /** Em ISO, normalizado. Fica o texto cru quando a data do provedor não é legível. */
  quando: string;
};

// ── QUEM ASSINOU ────────────────────────────────────────────────────────────

/**
 * Um item por signatário do envelope, com o que os eventos contaram sobre cada um.
 *
 * ⚠️ A CHAVE DE CASAMENTO É `signer.key`, COM O E-MAIL COMO DESEMPATE — NUNCA O NOME. Nome se
 * repete (dois "José Silva" num contrato de quatro compradores é rotina), muda de acento entre o
 * que a CAD gravou e o que a Clicksign devolve, e é o campo que a operação corrige na mão. Casar
 * por nome trocaria o "assinou" de uma pessoa pelo da outra — no documento em que isso importa.
 *
 * ⚠️ O ROSTO DA LISTA É `document.signers[]`, mas quem aparece só nos eventos TAMBÉM ENTRA: um
 * signatário removido do documento depois de ter recebido convite continua sendo parte da história.
 */
export function quemAssinou(payload: unknown): SignatarioDoEnvelope[] {
  const documento = documentoDoPayload(payload);
  const eventos = eventosDoDocumento(payload);

  const porChave = new Map<string, SignatarioDoEnvelope>();
  const chavePorEmail = new Map<string, string>();

  // ⚠️ A LISTA DE QUEM ESTÁ NO ENVELOPE É `document.signers`, E NÃO "quem apareceu em algum
  // evento". A Clicksign permite REMOVER signatário de envelope em andamento, e o Panteon usa isso
  // justamente para corrigir e-mail que quicou: remove a pessoa e a recria com o endereço certo.
  // Depois disso os eventos citam TRÊS pessoas para um envelope de duas — e contar os eventos faria
  // a tela dizer "1 de 3 assinaram", com um fantasma na lista cobrando um conserto já feito, e
  // faria `fechouComTodasAsAssinaturas` virar falso num envelope que fechou completo.
  //
  // ⚠️ O FALLBACK EXISTE PARA O PAYLOAD POBRE: o `upload` chega com `signers` VAZIO (medido em
  // produção no documento 8cf69cde). Sem ninguém na lista, quem apareceu nos eventos é tudo o que
  // temos, e mostrar isso é melhor que mostrar vazio.
  const temListaOficial = lista(documento.signers).length > 0;

  const registrar = (
    bruto: unknown,
    { criar }: { criar: boolean } = { criar: true },
  ): null | SignatarioDoEnvelope => {
    const pessoa = objeto(bruto);
    const chave = texto(pessoa.key);
    const email = texto(pessoa.email);
    const nome = texto(pessoa.name);
    if (!chave && !email) return null;

    // O e-mail desempata quando a `key` não veio no evento — acontece nos formatos mais enxutos.
    const identidade = chave || chavePorEmail.get(email.toLowerCase()) || email;
    const existente = porChave.get(identidade);
    if (existente) {
      // O evento mais completo enriquece o que o anterior deixou vazio, e nunca apaga.
      if (!existente.email && email) existente.email = email;
      if (!existente.nome && nome) existente.nome = nome;
      return existente;
    }

    // Fora da lista oficial: o evento ENRIQUECE quem está no envelope, mas não cria ninguém novo.
    if (!criar) return null;

    const novo: SignatarioDoEnvelope = {
      assinouEm: null,
      chave: identidade,
      comecouEm: null,
      convite: "sem_noticia",
      conviteDetalhe: null,
      conviteQuando: null,
      email,
      nome,
    };
    porChave.set(identidade, novo);
    if (email) chavePorEmail.set(email.toLowerCase(), identidade);
    return novo;
  };

  for (const pessoa of lista(documento.signers)) registrar(pessoa);

  // ⚠️ DO MAIS ANTIGO PARA O MAIS NOVO, e isto não é estética: `comecouEm` é a PRIMEIRA vez que a
  // pessoa abriu e `convite` é a ÚLTIMA notícia que chegou (um convite reenviado depois de um
  // bounce tem de vencer o bounce). Percorrer na ordem do relógio resolve os dois com um `if`.
  for (const evento of [...eventos].sort(porQuandoCrescente)) {
    const dados = evento.dados;
    const nome = evento.nome;

    for (const pessoa of pessoasDoEvento(dados)) registrar(pessoa, { criar: !temListaOficial });

    const alvo = registrar(dados.signer, { criar: !temListaOficial });
    if (!alvo) continue;

    // ⚠️ `evento.quando` VAZIO NÃO VIRA ASSINATURA. `emIso` devolve "" quando o evento chega sem
    // `occurred_at`, e um `assinouEm` vazio é truthy-falso: o contador (`!== null`) somava e a linha
    // da tela (que testa o valor) mostrava a pessoa como não-assinante. O cabeçalho dizia "1 de 2" e
    // a lista inteira dizia "sem notícia", sem ninguém conseguir dizer quem era o 1.
    if (nome === "sign" && evento.quando) alvo.assinouEm = alvo.assinouEm ?? evento.quando;
    if (nome === "signature_started" && evento.quando) {
      alvo.comecouEm = alvo.comecouEm ?? evento.quando;
    }

    const noticia = noticiaDoConvite(nome, dados);
    if (noticia) {
      alvo.convite = noticia.convite;
      alvo.conviteDetalhe = noticia.detalhe;
      alvo.conviteQuando = evento.quando;
    }
  }

  return [...porChave.values()];
}

/**
 * O que este evento diz sobre o CONVITE de quem assina — ou nada.
 *
 * ⚠️ SÓ O CONVITE DE ASSINATURA CONTA COMO "convite". A Clicksign usa o mesmo `notification` para
 * lembretes e para o aviso de documento finalizado (`kind` diferente de `signature_request`); um
 * lembrete que voltou não quer dizer que o convite original não chegou, e misturar os dois
 * mandaria o operador reenviar um contrato que a pessoa já tem na mão.
 *
 * ⚠️ `entregue` SÓ SAI DE UMA AFIRMAÇÃO DO PROVEDOR. Até 12/09/2026 a única notificação que chegou
 * em produção foi a de ERRO — nunca vimos uma de entrega. O ramo existe para o dia em que vier, e
 * não para preencher o silêncio: ver a nota de `ConviteDoSignatario`.
 */
function noticiaDoConvite(
  nomeDoEvento: string,
  dados: Record<string, unknown>,
): null | { convite: ConviteDoSignatario; detalhe: null | string } {
  const notificacao = objeto(dados.notification);
  if (Object.keys(notificacao).length === 0) return null;
  if (texto(notificacao.kind) !== "signature_request") return null;

  const status = texto(notificacao.last_status).toLowerCase();
  if (status === "delivered") return { convite: "entregue", detalhe: null };

  const deuErrado =
    nomeDoEvento === "tracking_notification_error" ||
    ["blocked", "bounce", "dropped", "failed", "spam", "spamcomplaint"].includes(status);
  if (!deuErrado) return null;

  return { convite: "nao_entregue", detalhe: motivoDaFalhaDeEnvio(notificacao) };
}

/**
 * O motivo do e-mail não ter chegado, em português.
 *
 * ⚠️ O TEXTO CRU NÃO SOME QUANDO NÃO DÁ PARA TRADUZIR. Ele é feio — vem do SMTP do destinatário,
 * em inglês, com código e id de sessão —, mas é a única coisa que responde "por que não chegou?"
 * quando o caso é novo. Engolir o que não se entende é o mesmo defeito que este arquivo veio
 * consertar, só que uma camada acima.
 */
function motivoDaFalhaDeEnvio(notificacao: Record<string, unknown>): null | string {
  const detalhes = texto(notificacao.details);
  const status = texto(notificacao.last_status);
  const cru = `${texto(notificacao.last_bounce_type)} ${status} ${detalhes}`.toLowerCase();

  if (/nosuchuser|does not exist|no such user|user unknown|5\.1\.1/.test(cru)) {
    return "E-mail inexistente: o endereço não existe no servidor de destino. Confira o cadastro e reenvie.";
  }
  if (/mailbox full|over quota|quota exceeded|insufficient storage|5\.2\.2/.test(cru)) {
    return "Caixa de entrada cheia: o servidor de destino não aceitou a mensagem.";
  }
  if (/spam|blocked|blacklist|reject|5\.7\./.test(cru)) {
    return "Recusado pelo servidor de destino (bloqueio ou filtro de spam).";
  }
  if (/softbounce|transient|temporar/.test(cru)) {
    return "Recusa temporária do servidor de destino: pode ser que uma nova tentativa entre.";
  }

  if (detalhes) return detalhes;
  return status ? `A Clicksign reportou o envio como "${status}".` : null;
}

// ── O DIÁRIO ────────────────────────────────────────────────────────────────

/**
 * A linha do tempo do envelope, em português, do mais recente para o mais antigo.
 *
 * ⚠️ EVENTO QUE NÃO CONHECEMOS NÃO SOME: sai com o nome cru e gravidade `normal`. Sumir com ele
 * faria o diário mentir por omissão justamente no dia em que a Clicksign criasse um evento novo — e
 * este é o diário de um CONTRATO. O mesmo vale para os ~30 eventos de bastidor: eles não movem o
 * card (ver `estadoDoEventoClicksign`), mas aparecem aqui.
 */
export function diarioDoEnvelope(payload: unknown): FatoDoEnvelope[] {
  const eventos = eventosDoDocumento(payload);
  if (eventos.length === 0) return [];

  const todosAssinaram = fechouComTodasAsAssinaturas(payload);
  const fatos = eventos.map((e) => traduzirFato(e, todosAssinaram));

  // ⚠️ ORDENAÇÃO ESTÁVEL, DO MAIS NOVO PARA O MAIS ANTIGO. Empate de carimbo (os dois `add_signer`
  // do envio real ficam a 6 MILÉSIMOS um do outro) mantém a ordem em que a Clicksign mandou; data
  // ilegível vai para o fim, em vez de embaralhar o resto.
  return [...fatos].sort((a, b) => instante(b.quando) - instante(a.quando));
}

/**
 * O envelope fechou com TODO MUNDO assinado?
 *
 * ⚠️ NÃO É PERGUNTA RETÓRICA, E O MOTIVO ESTÁ EM `traduzir.ts`: o
 * `deadline_partial_signature_action` pode FECHAR o envelope no vencimento com as assinaturas que
 * tiver. Um `auto_close` desses viraria a frase "Todos assinaram" num diário de contrato — a mentira
 * mais cara que esta tela poderia contar. Quando o próprio payload prova que alguém não assinou, a
 * frase muda e a gravidade vira erro.
 *
 * Devolve `null` quando não há como saber (sem lista de signatários no payload): aí vale o padrão,
 * que é a leitura otimista de sempre. Ignorância não vira acusação.
 */
function fechouComTodasAsAssinaturas(payload: unknown): boolean | null {
  const pessoas = quemAssinou(payload);
  if (pessoas.length === 0) return null;
  return pessoas.every((p) => p.assinouEm !== null);
}

type EventoCru = {
  dados: Record<string, unknown>;
  nome: string;
  quando: string;
};

function traduzirFato(evento: EventoCru, todosAssinaram: boolean | null): FatoDoEnvelope {
  const { dados, nome, quando } = evento;
  const nomes = pessoasDoEvento(dados)
    .map((p) => texto(objeto(p).name))
    .filter((n) => n !== "");
  // Quem operou (`data.user`) só aparece nos eventos que NÓS causamos: `upload` e `add_signer`.
  const quem = nomes[0] ?? texto(objeto(dados.user).name);
  const alguem = quem || "Signatário";

  switch (nome) {
    case "upload":
      return fato("Contrato enviado para a Clicksign", "normal", quando, { quem });

    case "add_signer":
      return fato(
        nomes.length > 1
          ? `${nomes.join(", ")} entraram como signatários`
          : `${alguem} entrou como signatário`,
        "normal",
        quando,
        { quem: nomes[0] ?? null },
      );

    case "tracking_notification_error": {
      const notificacao = objeto(dados.notification);
      const kind = texto(notificacao.kind);
      return fato(
        kind === "signature_request"
          ? `Convite NÃO entregue para ${alguem}`
          : `Aviso da Clicksign não entregue para ${alguem}${kind ? ` (${kind})` : ""}`,
        "erro",
        quando,
        { detalhe: motivoDaFalhaDeEnvio(notificacao), quem },
      );
    }

    case "signature_started":
      return fato(`${alguem} abriu para assinar`, "normal", quando, { quem });

    case "sign":
      return fato(`${alguem} assinou`, "marco", quando, { quem });

    case "auto_close":
    case "close":
    case "document_closed":
      return todosAssinaram === false
        ? fato("Envelope fechado SEM todas as assinaturas", "erro", quando, {
            detalhe:
              "O prazo venceu e a Clicksign fechou o documento com as assinaturas que tinha. " +
              "Contrato fechado não é contrato assinado: confira quem falta.",
          })
        : fato("Todos assinaram", "marco", quando, {});

    case "refusal":
      return fato(`${alguem} recusou assinar`, "erro", quando, { quem });

    case "cancel":
      return fato("Envelope cancelado", "erro", quando, { quem });

    case "deadline":
      return fato("Prazo do envelope venceu", "erro", quando, { quem });

    default:
      // ⚠️ AQUI NÃO NASCE UM SEGUNDO CATÁLOGO DE EVENTOS. `ehFalhaDeAutenticacao` e
      // `estadoDoEventoClicksign` já são a lista da casa, em `traduzir.ts` — o que este arquivo
      // acrescenta é a FRASE, não o conhecimento. No dia em que um evento entrar lá, ele já sai
      // daqui com a gravidade certa sem ninguém tocar neste `switch`.
      if (ehFalhaDeAutenticacao(nome)) {
        return fato(`${alguem} não passou na autenticação`, "erro", quando, {
          detalhe: `A Clicksign registrou "${nome}".`,
          quem,
        });
      }
      return fato(nome || "Evento sem nome", gravidadeHerdada(nome), quando, { quem });
  }
}

/** A gravidade de um evento que não tem frase própria, herdada da tradução de estado da casa. */
function gravidadeHerdada(nome: string): GravidadeDoFato {
  switch (estadoDoEventoClicksign(nome)) {
    case "assinado":
    case "parcial":
      return "marco";
    case "cancelado":
    case "expirado":
    case "recusado":
      return "erro";
    default:
      return "normal";
  }
}

function fato(
  frase: string,
  gravidade: GravidadeDoFato,
  quando: string,
  extras: { detalhe?: null | string; quem?: null | string },
): FatoDoEnvelope {
  return {
    detalhe: extras.detalhe ?? null,
    fato: frase,
    gravidade,
    quem: extras.quem ? extras.quem : null,
    quando,
  };
}

// ── A LEITURA DO PAYLOAD ────────────────────────────────────────────────────

/**
 * Os eventos que a Clicksign mandou dentro do documento.
 *
 * ⚠️ SÓ `document.events[]`, E O `event` DA RAIZ FICA DE FORA DE PROPÓSITO. Medido no payload real
 * de 12/09/2026: o evento que disparou o webhook é sempre o PRIMEIRO item do array (o `sign` da
 * raiz, às 23:24:44.972-03:00, é o mesmo `sign` de `events[0]`, 02:24:44.972Z). Somar os dois
 * duplicaria toda última linha do diário.
 *
 * ⚠️ E PAYLOAD TORTO DEVOLVE VAZIO, NUNCA LANÇA. Isto é enfeite de tela: derrubar a etapa do
 * contrato porque um webhook veio num formato novo seria trocar uma informação a mais por uma tela
 * a menos.
 */
/**
 * O `document` do payload, ACEITANDO AS TRES FORMAS que a Clicksign usa.
 *
 * ⚠️ LER SÓ A RAIZ ZERA A TELA SEM ERRO NENHUM. O card do quadro já procurava nos três lugares
 * (`lerEventosDoPayload`, em `lib/temis/trabalhos-db.ts`) e esta lib procurava em um só — então um
 * payload no formato JSON:API (`data.document`) fazia o painel dizer "0 de 2 assinaram" ao lado de
 * um card dizendo "1/2". Duas telas, duas verdades, sobre o mesmo envelope.
 *
 * ⚠️ E ISSO NÃO É HIPÓTESE: a Clicksign reenvia o webhook que não recebeu 200, e todo POST grava
 * linha nova — basta uma retentativa do `upload` chegar depois do `sign` para a linha mais recente
 * ser a mais pobre.
 */
function documentoDoPayload(payload: unknown): Record<string, unknown> {
  const raiz = objeto(payload);
  for (const candidato of [raiz.document, objeto(raiz.data).document, objeto(raiz.event).document]) {
    const achado = objeto(candidato);
    if (Object.keys(achado).length > 0) return achado;
  }
  return {};
}

function eventosDoDocumento(payload: unknown): EventoCru[] {
  const documento = documentoDoPayload(payload);
  const saida: EventoCru[] = [];
  for (const bruto of lista(documento.events)) {
    const evento = objeto(bruto);
    // ⚠️ ITEM QUE NÃO É OBJETO NÃO É "EVENTO DESCONHECIDO": é lixo, e não carrega fato nenhum. A
    // regra de nunca sumir com evento vale para o que a Clicksign afirmou e nós não entendemos —
    // um `null` no meio do array não afirma nada, e virar linha no diário seria inventar uma.
    if (Object.keys(evento).length === 0) continue;
    const nome = texto(evento.name) || texto(evento.type);
    saida.push({
      dados: objeto(evento.data),
      nome: nome.toLowerCase(),
      quando: emIso(evento.occurred_at),
    });
  }
  return saida;
}

/**
 * As pessoas de um evento.
 *
 * ⚠️ A CLICKSIGN USA OS DOIS FORMATOS NO MESMO PAYLOAD: `add_signer` traz `data.signers[]` (array,
 * mesmo com uma pessoa só) e `sign` / `signature_started` / `tracking_notification_error` trazem
 * `data.signer` (objeto). Ler só um dos dois perde metade dos nomes do diário.
 */
function pessoasDoEvento(dados: Record<string, unknown>): unknown[] {
  const doArray = lista(dados.signers);
  if (doArray.length > 0) return doArray;
  const unico = objeto(dados.signer);
  return Object.keys(unico).length > 0 ? [unico] : [];
}

/**
 * A data em ISO, normalizada.
 *
 * ⚠️ OS DOIS FUSOS CONVIVEM NO MESMO PAYLOAD: o `event.occurred_at` da raiz chega em `-03:00` e os
 * de `document.events[]` chegam em `Z`. Sem normalizar, ordenar como texto misturaria a linha do
 * tempo — e é a linha do tempo de um contrato.
 *
 * ⚠️ O QUE NÃO DÁ PARA LER FICA COMO VEIO. Devolver vazio apagaria a única pista de quando o fato
 * aconteceu; a ordenação já sabe jogar o ilegível para o fim.
 */
function emIso(bruto: unknown): string {
  const cru = texto(bruto);
  if (!cru) return "";
  const instanteLido = Date.parse(cru);
  return Number.isNaN(instanteLido) ? cru : new Date(instanteLido).toISOString();
}

function instante(quando: string): number {
  const lido = Date.parse(quando);
  // Ilegível vai para o fim da lista (que é ordenada do mais novo para o mais antigo).
  return Number.isNaN(lido) ? Number.NEGATIVE_INFINITY : lido;
}

function porQuandoCrescente(a: EventoCru, b: EventoCru): number {
  return instante(a.quando) - instante(b.quando);
}

// ⚠️ ESTES TRÊS AJUDANTES SÃO GÊMEOS DOS DE `clicksign/webhook.ts`, e não dá para reusar aqueles:
// lá eles são privados do módulo, e exportá-los mudaria um arquivo que outra frente está editando.
// São quatro linhas cada e não guardam conhecimento nenhum sobre a Clicksign — o catálogo de
// eventos, que é o que não pode ter duas cópias, mora em `traduzir.ts` e é lido de lá.
function objeto(bruto: unknown): Record<string, unknown> {
  return bruto && typeof bruto === "object" && !Array.isArray(bruto)
    ? (bruto as Record<string, unknown>)
    : {};
}

function lista(bruto: unknown): unknown[] {
  return Array.isArray(bruto) ? bruto : [];
}

function texto(bruto: unknown): string {
  return typeof bruto === "string" ? bruto.trim() : "";
}
