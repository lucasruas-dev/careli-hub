// ASSINATURAS COM A D4SIGN COMO FONTE DA VERDADE.
//
// O pedido do dono (18/08/2026): *"queria usar somente o D4Sign, o C2X tem muito gap ainda"*.
//
// A DIVISÃO DE TRABALHO, que é o coração deste arquivo:
//   • o C2X continua dizendo QUAL documento é de qual unidade/contrato. Isso não tem outra fonte:
//     o `uuidDoc` mora em `contract_signatures`, e o caminho até a unidade
//     (`acquisition_request_contracts → acquisition_requests → enterprise_unities`) só existe lá.
//     A D4Sign conhece o documento, não conhece o lote.
//   • o C2X também continua dono da ORDEM. A D4Sign NÃO TEM campo de ordem/sequência (procurado
//     na sondagem: não existe `order`, `sequence` nem `priority`); quem tem é o `after_position`
//     do C2X, e é dele que sai a regra de "quem está na vez" que o dono definiu.
//   • o C2X também é dono do PERFIL. A D4Sign tem `nomenclatura` ("Assinar como parte"), que não
//     é o vocabulário da tela; Comprador/Backoffice/Imobiliária saem de `perfilDeTela`.
//   • a D4SIGN passa a ser dona do STATUS: se aquele documento acabou, e se cada pessoa assinou e
//     quando. É exatamente o que o C2X erra — 1.470 linhas "Em aberto" com `create_webhook = 0`
//     em 100% delas, ou seja, a D4Sign avisou e ninguém escutou.
//
// ⚠️ FALLBACK: DEGRADA MOSTRANDO O LEGADO, COM AVISO — NÃO ESCONDE O BLOCO. A escolha e o porquê
// estão em `AVISOS_DA_FONTE`, logo abaixo. Leia antes de mudar.
//
// ⚠️ NADA DE CPF, IP, GEOLOCALIZAÇÃO OU USER-AGENT SAI DAQUI. O e-mail é usado para CASAR o
// assinante da D4Sign com a linha do C2X e para `perfilDeTela` decidir quem é Backoffice; ele já
// existia em `LinhaAssinatura` (campo interno do painel, que a montagem da tela do portal não
// repassa). O que este arquivo acrescenta a uma linha é só: assinou, quando assinou.
import {
  consultarDocumentosD4Sign,
  interpretarStatusD4Sign,
  type ConsultaD4Sign,
  type OpcoesDeLote,
  type SignatarioD4Sign,
  type SituacaoD4Sign,
} from "@/lib/guardian/d4sign-consulta";
import {
  registrarDivergencias,
  type Divergencia,
  type TipoDeDivergencia,
} from "@/lib/apolo/d4sign-divergencias";
import { perfilDeTela, type LinhaAssinatura } from "@/lib/apolo/painel-assinatura";

/**
 * De onde veio o que está na tela.
 *
 * ⚠️ ISTO PRECISA CHEGAR NA TELA. Uma linha marcada "c2x-legado" pode estar dizendo "pendente"
 * sobre um contrato que já foi assinado — é literalmente o defeito que motivou esta troca. Marcar
 * e não mostrar é o mesmo que não marcar.
 */
export type FonteDaAssinatura = "c2x-legado" | "d4sign";

/**
 * A DECISÃO DE FALLBACK, e por quê.
 *
 * As duas saídas possíveis quando a D4Sign não responde eram: (a) esconder o bloco, (b) mostrar o
 * que o C2X tem, marcado. Ficou a (b), com aviso visível. O raciocínio:
 *
 *   1. O erro do C2X TEM DIREÇÃO CONHECIDA. Ele erra para MENOS: mostra "Em aberto"/"pendente"
 *      em contrato que a D4Sign já finalizou, porque o webhook nunca avisou. Ele não inventa
 *      assinatura que não houve. Então o pior caso do fallback é cobrar alguém que já assinou —
 *      chato, recuperável, e o aviso na tela explica exatamente isso. Esconder o bloco, por
 *      outro lado, tira do incorporador uma tela que hoje funciona para o acervo inteiro.
 *   2. Some com o bloco e o suporte vira adivinhação. Com o aviso, quem olha sabe se está vendo
 *      dado confirmado ou registro velho, e decide se confia.
 *   3. É a mesma régua que o repositório já usa: `carregarPainelAssinatura` falha FECHADA,
 *      devolvendo o cache velho com o carimbo do horário. Painel que some é pior que painel de
 *      cinco minutos atrás — desde que o carimbo impeça confundir um com o outro.
 *
 * O texto é constante daqui e não da tela: aviso que cada tela reescreve é aviso que uma delas
 * esquece.
 */
export const AVISOS_DA_FONTE = {
  credencialAusente:
    "A confirmação com o D4Sign está desligada neste ambiente. O que aparece abaixo é o registro do sistema antigo (C2X), que pode estar desatualizado.",
  documentoAusente:
    "O D4Sign não reconhece o documento deste contrato. O que aparece abaixo é o registro do sistema antigo (C2X) e não pôde ser confirmado.",
  indisponivel:
    "Sem resposta do D4Sign agora. O que aparece abaixo é o registro do sistema antigo (C2X), que pode mostrar como pendente uma assinatura já colhida.",
  semDocumento:
    "Este contrato não tem documento no D4Sign. O que aparece abaixo é o registro do sistema antigo (C2X).",
} as const;

export const FONTE_LABELS: Record<FonteDaAssinatura, string> = {
  "c2x-legado": "Informação do sistema antigo",
  d4sign: "Confirmado no D4Sign",
};

/**
 * O que o `contract_signature_status_id` do C2X quer dizer, traduzido para a régua da D4Sign.
 *
 * ⚠️ O 7 ("Em aberto") é lido como "aguardando assinaturas" DE PROPÓSITO. Ele é o balde do
 * webhook que nunca chegou, e tratar todo 7 como divergência transformaria o contador em ruído —
 * 1.470 linhas gritando a mesma coisa. Assim, só vira divergência de status o caso que importa:
 * a D4Sign já terminou (ou cancelou) e o C2X ainda acha que está andando.
 */
const EQUIVALENTE_D4SIGN_DO_C2X: Record<number, SituacaoD4Sign> = {
  3: "aguardando-assinaturas",
  4: "finalizado",
  6: "cancelado",
  7: "aguardando-assinaturas",
};

const ROTULO_STATUS_C2X: Record<number, string> = {
  3: "Aguardando assinaturas (3)",
  4: "Finalizado (4)",
  6: "Cancelado (6)",
  7: "Em aberto (7)",
};

/** O molde da unidade: o que toda linha do MESMO envio compartilha. */
export type MoldeDaLinha = Pick<
  LinhaAssinatura,
  "contrato" | "diasDesdeEnvio" | "emp" | "envio" | "lote" | "quadra" | "un" | "valor"
>;

export type ConciliacaoDoDocumento = {
  /** O aviso a mostrar junto do bloco. Nulo quando veio confirmado da D4Sign. */
  aviso: null | string;
  divergencias: Divergencia[];
  fonte: FonteDaAssinatura;
  /** As linhas já com a verdade da D4Sign onde ela existe. Mesma forma de sempre. */
  linhas: LinhaAssinatura[];
  /** A situação do documento na D4Sign. Nula quando ela não respondeu. */
  situacao: null | SituacaoD4Sign;
};

/** Tira acento, caixa e espaço dobrado: é o que faz "JOSÉ  DA SILVA" casar com "Jose da Silva". */
function chaveDeNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/** A data curta da assinatura, na régua de `LinhaAssinatura.assinadoEm` ("2026-07-01"). */
export function dataCurtaDaAssinatura(assinadoEm: null | string): null | string {
  if (!assinadoEm) return null;
  // `date_signed_atom` já vem no fuso local ("2024-05-27T15:48:06-03:00"), então o dia certo é o
  // que está escrito. Passar por `new Date()` converteria para UTC e viraria o dia anterior em
  // qualquer assinatura depois das 21h.
  const dia = assinadoEm.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null;
}

function divergencia(
  base: Pick<Divergencia, "csId" | "uuidDoc">,
  tipo: TipoDeDivergencia,
  campos: Partial<Divergencia> = {},
): Divergencia {
  return {
    c2x: null,
    csId: base.csId,
    d4sign: null,
    degrau: null,
    perfil: null,
    referencia: null,
    tipo,
    uuidDoc: base.uuidDoc,
    ...campos,
  };
}

/**
 * Casa os assinantes da D4Sign com as linhas do C2X, em três passadas.
 *
 * 1. E-MAIL. É a chave forte: foi o C2X que mandou o convite, então o e-mail é o mesmo dos dois
 *    lados. Só entra quando não está vazio — e ele às vezes está (`ss.email` é anulável).
 * 2. NOME normalizado. Pega o caso de e-mail vazio ou trocado depois.
 * 3. POSIÇÃO, e só quando sobra a MESMA quantidade dos dois lados. As duas listas descrevem o
 *    mesmo documento e vêm em ordem estável (o C2X por `after_position`, a D4Sign na ordem do
 *    convite); com um sobrando de cada lado, parear é bem mais provável de acertar do que criar
 *    um assinante fantasma e órfãos dos dois lados. Quando sobram QUANTIDADES diferentes, esta
 *    passada não roda: aí a gente não sabe, e não fingir que sabe é o ponto.
 */
function casarAssinantes(
  linhas: LinhaAssinatura[],
  signatarios: SignatarioD4Sign[],
): {
  paresPorLinha: Map<number, SignatarioD4Sign>;
  soNoC2x: number[];
  soNoD4Sign: SignatarioD4Sign[];
} {
  const paresPorLinha = new Map<number, SignatarioD4Sign>();
  const linhasUsadas = new Set<number>();
  const signatariosUsados = new Set<number>();

  const porEmail = new Map<string, number[]>();
  const porNome = new Map<string, number[]>();
  linhas.forEach((linha, indice) => {
    const email = linha.email.trim().toLowerCase();
    if (email) porEmail.set(email, [...(porEmail.get(email) ?? []), indice]);
    const nome = chaveDeNome(linha.usuario);
    if (nome) porNome.set(nome, [...(porNome.get(nome) ?? []), indice]);
  });

  const primeiroLivre = (indices: undefined | number[]): number | undefined =>
    indices?.find((indice) => !linhasUsadas.has(indice));

  const parear = (chave: (s: SignatarioD4Sign) => number | undefined): void => {
    signatarios.forEach((signatario, indice) => {
      if (signatariosUsados.has(indice)) return;
      const alvo = chave(signatario);
      if (alvo === undefined) return;
      linhasUsadas.add(alvo);
      signatariosUsados.add(indice);
      paresPorLinha.set(alvo, signatario);
    });
  };

  parear((s) => (s.email ? primeiroLivre(porEmail.get(s.email)) : undefined));
  parear((s) => primeiroLivre(porNome.get(chaveDeNome(s.nome))));

  const linhasSobrando = linhas.map((_, indice) => indice).filter((i) => !linhasUsadas.has(i));
  const signatariosSobrando = signatarios.filter((_, i) => !signatariosUsados.has(i));

  if (
    linhasSobrando.length > 0 &&
    linhasSobrando.length === signatariosSobrando.length
  ) {
    linhasSobrando.forEach((indice, posicao) => {
      const signatario = signatariosSobrando[posicao];
      if (signatario) paresPorLinha.set(indice, signatario);
    });
    return { paresPorLinha, soNoC2x: [], soNoD4Sign: [] };
  }

  return {
    paresPorLinha,
    soNoC2x: linhasSobrando,
    soNoD4Sign: signatariosSobrando,
  };
}

/**
 * Concilia UM documento: função pura, é ela que os testes fixam.
 *
 * @param consulta  O que a D4Sign devolveu (ou por que não devolveu).
 * @param csId      `contract_signatures.id` — a chave do envio, e o `contrato` das linhas.
 * @param linhas    As linhas do C2X DAQUELE envio.
 * @param molde     Usado só quando o envio não tem NENHUMA linha no C2X e a D4Sign tem assinantes
 *                  (o caso "envio sem assinante registrado"): sem ele não dá para dizer de que
 *                  unidade a linha nova é, e a gente não inventa.
 * @param statusC2x `contract_signature_status_id`, para a divergência de status.
 */
export function conciliarDocumento(args: {
  consulta: ConsultaD4Sign;
  csId: number;
  linhas: LinhaAssinatura[];
  molde?: MoldeDaLinha;
  statusC2x?: null | number;
  uuidDoc: null | string;
}): ConciliacaoDoDocumento {
  const { consulta, csId, linhas, statusC2x = null, uuidDoc } = args;
  const base = { csId, uuidDoc };

  // Sem uuid não há o que perguntar: o envio nunca virou documento na D4Sign.
  if (!uuidDoc || !uuidDoc.trim()) {
    return {
      aviso: AVISOS_DA_FONTE.semDocumento,
      divergencias: [],
      fonte: "c2x-legado",
      linhas,
      situacao: null,
    };
  }

  if (!consulta.ok) {
    // FALLBACK HONESTO: as linhas do C2X seguem para a tela, marcadas, com o aviso que diz de
    // onde vieram e o que pode estar errado nelas.
    const aviso =
      consulta.motivo === "credencial-ausente"
        ? AVISOS_DA_FONTE.credencialAusente
        : consulta.motivo === "documento-desconhecido"
          ? AVISOS_DA_FONTE.documentoAusente
          : AVISOS_DA_FONTE.indisponivel;

    return {
      aviso,
      // Documento que o C2X aponta e a D4Sign não conhece é dado ruim no legado, e vale registrar.
      // Indisponibilidade momentânea NÃO é divergência: ninguém discordou de ninguém.
      divergencias:
        consulta.motivo === "documento-desconhecido"
          ? [
              divergencia(base, "documento-ausente-no-d4sign", {
                c2x: statusC2x === null ? null : (ROTULO_STATUS_C2X[statusC2x] ?? `status ${statusC2x}`),
                d4sign: "documento nao encontrado",
              }),
            ]
          : [],
      fonte: "c2x-legado",
      linhas,
      situacao: null,
    };
  }

  const { documento, signatarios } = consulta;
  const divergencias: Divergencia[] = [];

  // ── status do documento ───────────────────────────────────────────────────
  if (statusC2x !== null) {
    const equivalente = EQUIVALENTE_D4SIGN_DO_C2X[statusC2x];
    if (equivalente && equivalente !== documento.situacao) {
      divergencias.push(
        divergencia(base, "status-do-documento", {
          c2x: ROTULO_STATUS_C2X[statusC2x] ?? `status ${statusC2x}`,
          d4sign: `${documento.statusName || documento.situacao} (${documento.statusId ?? "?"})`,
        }),
      );
    }
  }

  // ── assinante por assinante ───────────────────────────────────────────────
  const { paresPorLinha, soNoC2x, soNoD4Sign } = casarAssinantes(linhas, signatarios);

  const conciliadas: LinhaAssinatura[] = linhas.map((linha, indice) => {
    const signatario = paresPorLinha.get(indice);
    if (!signatario) return linha;

    const assinadoEm = dataCurtaDaAssinatura(signatario.assinadoEm);

    if (signatario.assinou !== linha.assinou) {
      divergencias.push(
        divergencia(base, signatario.assinou ? "assinatura-nao-registrada" : "assinatura-fantasma", {
          c2x: linha.assinou ? `assinou em ${linha.assinadoEm ?? "data ausente"}` : "nao assinou",
          d4sign: signatario.assinou ? `assinou em ${assinadoEm ?? "data ausente"}` : "nao assinou",
          degrau: linha.degrau,
          perfil: linha.perfil,
          referencia: signatario.chave || null,
        }),
      );
    } else if (signatario.assinou && assinadoEm && linha.assinadoEm && assinadoEm !== linha.assinadoEm) {
      divergencias.push(
        divergencia(base, "data-divergente", {
          c2x: linha.assinadoEm,
          d4sign: assinadoEm,
          degrau: linha.degrau,
          perfil: linha.perfil,
          referencia: signatario.chave || null,
        }),
      );
    }

    return {
      ...linha,
      assinadoEm,
      assinou: signatario.assinou,
      // `situacao` e `prazo` são recalculados rio abaixo (`marcarSituacao` e `prazoDoComprador`)
      // sobre o dado já corrigido: não adianta corrigir "assinou" e deixar a fila com a conta
      // velha.
      prazo: null,
      situacao: "aguardando",
    };
  });

  for (const indice of soNoC2x) {
    const linha = linhas[indice];
    if (!linha) continue;
    // A linha FICA, com o dado do C2X: a D4Sign não nos disse nada sobre essa pessoa, então não
    // temos nada melhor para colocar no lugar. O que a gente faz é registrar que os dois lados
    // não batem.
    divergencias.push(
      divergencia(base, "signatario-so-no-c2x", {
        c2x: linha.assinou ? "assinou" : "nao assinou",
        degrau: linha.degrau,
        perfil: linha.perfil,
      }),
    );
  }

  const moldeDaLinha: MoldeDaLinha | undefined = linhas[0]
    ? {
        contrato: linhas[0].contrato,
        diasDesdeEnvio: linhas[0].diasDesdeEnvio,
        emp: linhas[0].emp,
        envio: linhas[0].envio,
        lote: linhas[0].lote,
        quadra: linhas[0].quadra,
        un: linhas[0].un,
        valor: linhas[0].valor,
      }
    : args.molde;

  // Quem só a D4Sign conhece vira linha nova: ele assina o documento de verdade, e não mostrar
  // esconderia uma pendência real. O degrau é o ÚLTIMO da fila daquele contrato de propósito —
  // pôr no 0 faria a fila inteira parecer parada nele, que é o erro do "Northon com 181
  // pendências" que a regra da vez existe para não repetir.
  const maiorDegrau = linhas.reduce((maior, linha) => Math.max(maior, linha.degrau), 0);
  for (const signatario of soNoD4Sign) {
    divergencias.push(
      divergencia(base, "signatario-so-no-d4sign", {
        d4sign: signatario.assinou ? "assinou" : "nao assinou",
        referencia: signatario.chave || null,
      }),
    );

    if (!moldeDaLinha) continue;

    conciliadas.push({
      ...moldeDaLinha,
      assinadoEm: dataCurtaDaAssinatura(signatario.assinadoEm),
      assinou: signatario.assinou,
      degrau: maiorDegrau,
      email: signatario.email,
      // O rótulo sai da MESMA função de sempre. A `nomenclatura` da D4Sign ("Assinar como parte")
      // não é o vocabulário da tela, e injetá-la criaria grupos que nenhum outro contrato tem.
      perfil: perfilDeTela(null, signatario.email),
      prazo: null,
      situacao: "aguardando",
      usuario: signatario.nome,
    });
  }

  return {
    aviso: null,
    divergencias,
    fonte: "d4sign",
    linhas: conciliadas,
    situacao: documento.situacao,
  };
}

/** Um envio do C2X a conciliar: a ponte entre `contract_signatures` e o documento na D4Sign. */
export type EnvioParaConciliar = {
  /** `contract_signatures.id`. É também o `contrato` das linhas daquele envio. */
  csId: number;
  /** O molde da unidade, para o envio que não tem nenhuma linha de assinante no C2X. */
  molde?: MoldeDaLinha;
  /** `contract_signature_status_id`, quando o chamador tiver. Alimenta a divergência de status. */
  statusC2x?: null | number;
  uuidDoc: null | string;
};

export type ResumoDaReconciliacao = {
  /** Linhas em que a D4Sign discordou do C2X sobre TER assinado. O número que cobra o webhook. */
  assinaturasCorrigidas: number;
  /** Envios cuja verdade veio da D4Sign. */
  confirmados: number;
  /** Envios que caíram no fallback (a tela precisa avisar). */
  emFallback: number;
  envios: number;
};

export type ResultadoDaReconciliacao = {
  /** O aviso do QUADRO todo. Nulo quando nada caiu em fallback. */
  aviso: null | string;
  avisoPorEnvio: Map<number, null | string>;
  divergencias: Divergencia[];
  fontePorEnvio: Map<number, FonteDaAssinatura>;
  /** Todas as linhas conciliadas, de todos os envios. Mesma forma que entrou. */
  linhas: LinhaAssinatura[];
  resumo: ResumoDaReconciliacao;
  situacaoPorEnvio: Map<number, SituacaoD4Sign>;
};

/**
 * O aviso do quadro inteiro. Um bloco degradado no meio de 400 confirmados não merece um banner
 * dizendo que "a tela está desatualizada" — nesse caso a marca fica na linha. Só quando TUDO caiu
 * é que o quadro inteiro avisa.
 */
export function avisoDoQuadro(resumo: ResumoDaReconciliacao): null | string {
  if (resumo.emFallback === 0) return null;
  if (resumo.confirmados === 0) return AVISOS_DA_FONTE.indisponivel;
  return `${resumo.emFallback} de ${resumo.envios} contratos não puderam ser confirmados no D4Sign agora e aparecem com o registro do sistema antigo.`;
}

/**
 * Concilia o recorte inteiro: uma chamada por documento (com cache e deduplicação lá embaixo), e
 * as linhas de volta na MESMA forma que entraram — para que a montagem do quadro
 * (`montarQuadroDeAssinaturas`) não precise saber que a fonte mudou.
 *
 * ⚠️ SEM POLLING. Quem chama é uma carga de tela. O que evita a enxurrada de chamadas é o cache
 * do `d4sign-consulta` (5 min no que se move, 12 h no que já acabou, que é 93% do acervo).
 */
export async function reconciliarAssinaturasComD4Sign(
  linhas: LinhaAssinatura[],
  envios: EnvioParaConciliar[],
  opcoes: OpcoesDeLote = {},
): Promise<ResultadoDaReconciliacao> {
  const linhasPorEnvio = new Map<number, LinhaAssinatura[]>();
  for (const linha of linhas) {
    const lista = linhasPorEnvio.get(linha.contrato);
    if (lista) lista.push(linha);
    else linhasPorEnvio.set(linha.contrato, [linha]);
  }

  const uuids = envios
    .map((envio) => envio.uuidDoc?.trim() ?? "")
    .filter((uuid): uuid is string => uuid.length > 0);

  const consultas = await consultarDocumentosD4Sign(uuids, opcoes);

  const avisoPorEnvio = new Map<number, null | string>();
  const fontePorEnvio = new Map<number, FonteDaAssinatura>();
  const situacaoPorEnvio = new Map<number, SituacaoD4Sign>();
  const divergencias: Divergencia[] = [];
  const conciliadas: LinhaAssinatura[] = [];
  let assinaturasCorrigidas = 0;
  let confirmados = 0;

  for (const envio of envios) {
    const uuid = envio.uuidDoc?.trim() ?? "";
    const conciliacao = conciliarDocumento({
      consulta: consultas.get(uuid) ?? { motivo: "indisponivel", ok: false },
      csId: envio.csId,
      linhas: linhasPorEnvio.get(envio.csId) ?? [],
      molde: envio.molde,
      statusC2x: envio.statusC2x ?? null,
      uuidDoc: envio.uuidDoc,
    });

    avisoPorEnvio.set(envio.csId, conciliacao.aviso);
    fontePorEnvio.set(envio.csId, conciliacao.fonte);
    if (conciliacao.situacao) situacaoPorEnvio.set(envio.csId, conciliacao.situacao);
    if (conciliacao.fonte === "d4sign") confirmados += 1;
    divergencias.push(...conciliacao.divergencias);
    assinaturasCorrigidas += conciliacao.divergencias.filter(
      (d) => d.tipo === "assinatura-nao-registrada" || d.tipo === "assinatura-fantasma",
    ).length;
    conciliadas.push(...conciliacao.linhas);
    linhasPorEnvio.delete(envio.csId);
  }

  // Linhas de envio que ninguém pediu para conciliar seguem intactas: sumir com elas seria trocar
  // um dado velho por nenhum dado.
  for (const restantes of linhasPorEnvio.values()) conciliadas.push(...restantes);

  const resumo: ResumoDaReconciliacao = {
    assinaturasCorrigidas,
    confirmados,
    emFallback: envios.length - confirmados,
    envios: envios.length,
  };

  registrarDivergencias(divergencias);

  return {
    aviso: avisoDoQuadro(resumo),
    avisoPorEnvio,
    divergencias,
    fontePorEnvio,
    linhas: conciliadas,
    resumo,
    situacaoPorEnvio,
  };
}

/** Reexportado para quem só quer traduzir um `statusId` cru sem puxar o cliente HTTP. */
export { interpretarStatusD4Sign };
