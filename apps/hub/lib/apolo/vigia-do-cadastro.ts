// O VIGIA DO CADASTRO DE EMPREENDIMENTOS CONTRA O C2X (PAN-124, fatia F3). PURO: sem banco e sem
// rede. Quem lê e grava é ./vigia-do-cadastro-servidor.ts, no sweep de notificações.
//
// POR QUE EXISTE. O C2X renomeia empreendimento sem avisar, e em cascata (sigla, nome e o prefixo das
// unidades). O 43 foi RDV, PDI, PLI e PTI em cinco dias (24 a 28/09/2026); o primeiro renome calou o
// coordenador e os dois seguintes ninguém viu. O Panteon é o dono do cadastro (decisão do Lucas,
// 26/09/2026: "o Panteon manda na sigla"), mas precisa SABER quando o legado mudou, para seguir,
// aceitar ou corrigir.
//
// O QUE ELE CONFERE, POR ID DO C2X. Cada item vira um MOTIVO; os motivos do mesmo id viram UM aviso.
//   • sem_cadastro: o id existe no C2X e o Panteon não tem cadastro dele (o 30, hoje);
//   • sumiu_do_c2x: o cadastro aponta para um id legado que o C2X não tem mais;
//   • sigla: a do cadastro contra a do C2X, salvo divergência aceita no retrato (F11). Compara o
//     ESTADO, não o evento: some sozinha quando alguém acompanha do outro lado;
//   • cidade e uf: idem, normalizadas (acento, caixa e espaço não contam);
//   • nome: o do C2X contra o `nome_aceito` do RETRATO, e NUNCA contra o nome do cadastro, que difere
//     de propósito em 18 de 34 (nome de mercado). O retrato nasce aceitando o nome de hoje;
//   • prefixo: unidades do Panteon daquele id que não começam pela sigla esperada, que é a do cadastro
//     (ou a do C2X, se não houver cadastro).
//
// ⚠️ O PREFIXO É PELA SIGLA DO ID, E NÃO PELO SEGMENTO. O plano dizia "quando houver segmento_id, vale
// o segmento". Medido em 30/09/2026, isso daria 707 alarmes falsos: as unidades do 31 (LAB) com
// segmento LBF, LBP e LBR têm código LAB..., e as do 35 (VLO) com segmento VOC e VOL têm código
// VLO.... Antes da unificação (PAI É A FONTE), o código segue o id onde a unidade mora. A regra pelo
// segmento entra junto com a unificação, que é quem troca os códigos.
//
// O SILÊNCIO. Quando o C2X passa a dizer, no nome, o que o cadastro ou a trilha (0192) já disseram, o
// retrato só anda e não há aviso: é a Nívea acompanhando no legado o que mudou no Panteon. Para
// sigla, cidade e UF o silêncio é natural, porque o motivo é o estado: lados iguais, motivo nenhum.
//
// O QUE ELE IGNORA: os ids de teste do C2X (C2X_TEST_ENTERPRISE_IDS: 2 e 34), o produto nascido no
// Panteon (id a partir de 100000, que só liga ao C2X na F12) e o ZZ TESTE (9001), pelo nome.

import { C2X_TEST_ENTERPRISE_IDS } from "@/lib/guardian/c2x-analytics";
import { codigoDoProduto, ehIdDoPanteon } from "@/lib/hercules/produto-novo";
import type {
  OperationsAlert,
  OperationsRiskLevel,
} from "@/lib/operations/monitoring";

/** Início de toda impressão digital do vigia. É por ela que o servidor acha os protocolos dele. */
export const PREFIXO_DA_IMPRESSAO = "cadastro-c2x:";

export type EmpreendimentoNoC2x = {
  cidade: string | null;
  codigo: string;
  id: string;
  nome: string;
  uf: string | null;
};

export type CadastroParaOVigia = {
  c2xId: string | null;
  cidade: string | null;
  codigo: string;
  /** O uuid de hercules_empreendimentos (é por ele que a trilha guarda os valores antigos). */
  id: string;
  nome: string;
  uf: string | null;
};

export type RetratoDoC2x = {
  cidade: string | null;
  codigo: string;
  enterpriseId: string;
  nome: string;
  nomeAceito: string;
  nomesAnteriores: string[];
  prefixosDivergentes: number;
  siglaDivergenteAceita: boolean;
  siglasAnteriores: string[];
  uf: string | null;
  ultimaAuditoriaId: number | null;
};

export type ResumoDasUnidades = {
  /** O começo do código das unidades fora do prefixo, sem repetição e em ordem. */
  encontrados: string[];
  esperado: string;
  fora: number;
  total: number;
};

export type MotivoDoVigia =
  | { tipo: "cidade"; cadastro: string; c2x: string }
  | { tipo: "nome"; aceito: string; c2x: string }
  | {
      tipo: "prefixo";
      encontrados: string[];
      esperado: string;
      fora: number;
      total: number;
    }
  | { tipo: "sem_cadastro" }
  | { tipo: "sigla"; cadastro: string; c2x: string }
  | { tipo: "sumiu_do_c2x"; codigo: string }
  | { tipo: "uf"; cadastro: string; c2x: string };

export type AvisoDoVigia = {
  enterpriseId: string;
  impressao: string;
  motivos: MotivoDoVigia[];
  rotulo: string;
};

/** O que o C2X já chamou um id, lido da auditoria dele (só no primeiro preenchimento). */
export type HistoricoDoC2x = { nomes: string[]; siglas: string[] };

export type EntradaDaConferencia = {
  /** A última auditoria de Enterprise lida por id (evento) ou a última de cada id (bootstrap). */
  auditorias: ReadonlyMap<string, number>;
  /** Cadastro do Panteon por id do C2X. */
  cadastros: ReadonlyMap<string, CadastroParaOVigia>;
  /** O C2X de agora, por id. Id ausente aqui = não existe mais no C2X. */
  c2x: ReadonlyMap<string, EmpreendimentoNoC2x>;
  /** Só no primeiro preenchimento. */
  historico?: ReadonlyMap<string, HistoricoDoC2x>;
  /** Os ids a conferir nesta rodada. */
  ids: Iterable<string>;
  /** Nomes que já valeram no cadastro (view da 0192), por uuid do cadastro. */
  nomesAntigosDoCadastro: ReadonlyMap<string, readonly string[]>;
  retratos: ReadonlyMap<string, RetratoDoC2x>;
  /** Códigos das unidades do Panteon (hercules_unidades.codigo), por id do C2X. */
  unidades: ReadonlyMap<string, readonly string[]>;
};

export type ResultadoDaConferencia = {
  avisos: AvisoDoVigia[];
  /** Os ids que a rodada conferiu de fato (sem os ignorados): é neles que o servidor fecha protocolo. */
  conferidos: string[];
  /** As linhas do retrato a gravar (upsert), inclusive as que não mudaram: gravar marca o visto_em. */
  retratos: RetratoDoC2x[];
};

/** Acento, caixa e espaço não contam. */
export function normalizar(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function ehIdDeTesteDoC2x(id: string): boolean {
  return C2X_TEST_ENTERPRISE_IDS.includes(Number(id));
}

/** O ZZ TESTE e qualquer cadastro marcado do mesmo jeito (nome começando por "ZZ "). */
export function ehCadastroDeTeste(cadastro: Pick<CadastroParaOVigia, "nome">): boolean {
  return normalizar(cadastro.nome).startsWith("ZZ ");
}

/**
 * Quantas unidades não começam pela sigla esperada. O código não tem formato fixo depois da sigla
 * ("VOC0104", "RVPF01", "ACPPARQUE GUAIBIM-0210"), então a regra é só o começo.
 */
export function resumoDasUnidades(
  codigos: readonly string[],
  esperado: string,
): ResumoDasUnidades {
  const sigla = codigoDoProduto(esperado);
  const encontrados = new Set<string>();
  let fora = 0;

  for (const bruto of codigos) {
    const codigo = codigoDoProduto(bruto);

    if (!codigo || codigo.startsWith(sigla)) {
      continue;
    }

    fora += 1;
    encontrados.add(codigo.slice(0, Math.max(sigla.length, 3)));
  }

  return {
    encontrados: [...encontrados].sort(),
    esperado: sigla,
    fora,
    total: codigos.length,
  };
}

/** Acrescenta sem repetir (pela forma normalizada) e tira o que voltou a valer. */
function anterioresSem(
  lista: readonly string[],
  novos: readonly string[],
  atual: string,
): string[] {
  const vistos = new Set<string>([normalizar(atual)]);
  const saida: string[] = [];

  for (const valor of [...lista, ...novos]) {
    const chave = normalizar(valor);

    if (!chave || vistos.has(chave)) {
      continue;
    }

    vistos.add(chave);
    saida.push(valor);
  }

  return saida;
}

/**
 * O retrato depois de ver o C2X de agora. Sem retrato anterior (bootstrap ou id novo no C2X), nasce
 * aceitando o nome de hoje: é isso que cala as diferenças intencionais de nome.
 */
export function retratoAtualizado({
  anterior,
  auditoriaId,
  c2x,
  historico,
  nomesDoPanteon,
  prefixosDivergentes,
}: {
  anterior: RetratoDoC2x | null;
  auditoriaId: number | null;
  c2x: EmpreendimentoNoC2x;
  historico?: HistoricoDoC2x;
  /** O nome do cadastro e os que já valeram nele: é o que dá o silêncio. */
  nomesDoPanteon: readonly string[];
  prefixosDivergentes: number;
}): RetratoDoC2x {
  if (!anterior) {
    return {
      cidade: c2x.cidade,
      codigo: c2x.codigo,
      enterpriseId: c2x.id,
      nome: c2x.nome,
      nomeAceito: c2x.nome,
      nomesAnteriores: anterioresSem([], historico?.nomes ?? [], c2x.nome),
      prefixosDivergentes,
      siglaDivergenteAceita: false,
      siglasAnteriores: anterioresSem([], historico?.siglas ?? [], c2x.codigo),
      uf: c2x.uf,
      ultimaAuditoriaId: auditoriaId,
    };
  }

  const siglaMudou = normalizar(anterior.codigo) !== normalizar(c2x.codigo);
  const nomeMudou = normalizar(anterior.nome) !== normalizar(c2x.nome);
  const panteonJaDisse = nomesDoPanteon.some(
    (nome) => normalizar(nome) === normalizar(c2x.nome),
  );

  return {
    cidade: c2x.cidade,
    codigo: c2x.codigo,
    enterpriseId: anterior.enterpriseId,
    nome: c2x.nome,
    nomeAceito: panteonJaDisse ? c2x.nome : anterior.nomeAceito,
    nomesAnteriores: anterioresSem(
      anterior.nomesAnteriores,
      nomeMudou ? [anterior.nome] : [],
      c2x.nome,
    ),
    prefixosDivergentes,
    // Aceitar PTI não é aceitar a próxima sigla que o C2X inventar.
    siglaDivergenteAceita: siglaMudou ? false : anterior.siglaDivergenteAceita,
    siglasAnteriores: anterioresSem(
      anterior.siglasAnteriores,
      siglaMudou ? [anterior.codigo] : [],
      c2x.codigo,
    ),
    uf: c2x.uf,
    ultimaAuditoriaId: maiorOuNulo(anterior.ultimaAuditoriaId, auditoriaId),
  };
}

function maiorOuNulo(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

const ORDEM_DOS_MOTIVOS: Record<MotivoDoVigia["tipo"], number> = {
  sumiu_do_c2x: 0,
  sem_cadastro: 1,
  sigla: 2,
  prefixo: 3,
  nome: 4,
  cidade: 5,
  uf: 6,
};

/** Os motivos de um id, na ordem de gravidade. Lista vazia = cadastro e C2X de acordo. */
export function motivosDoId({
  cadastro,
  c2x,
  retrato,
  unidades,
}: {
  cadastro: CadastroParaOVigia | null;
  c2x: EmpreendimentoNoC2x | null;
  retrato: RetratoDoC2x | null;
  unidades: ResumoDasUnidades | null;
}): MotivoDoVigia[] {
  const motivos: MotivoDoVigia[] = [];

  if (c2x && !cadastro) {
    motivos.push({ tipo: "sem_cadastro" });
  }

  if (!c2x && cadastro) {
    motivos.push({ codigo: cadastro.codigo, tipo: "sumiu_do_c2x" });
  }

  if (c2x && cadastro) {
    if (
      normalizar(c2x.codigo) !== normalizar(cadastro.codigo) &&
      !retrato?.siglaDivergenteAceita
    ) {
      motivos.push({ cadastro: cadastro.codigo, c2x: c2x.codigo, tipo: "sigla" });
    }

    for (const campo of ["cidade", "uf"] as const) {
      const doCadastro = cadastro[campo] ?? "";
      const doC2x = c2x[campo] ?? "";

      // Vazio de um lado não é divergência: é dado que falta, e a F9 cuida disso.
      if (normalizar(doCadastro) && normalizar(doC2x) && normalizar(doCadastro) !== normalizar(doC2x)) {
        motivos.push({ cadastro: doCadastro, c2x: doC2x, tipo: campo });
      }
    }
  }

  if (c2x && retrato && normalizar(c2x.nome) !== normalizar(retrato.nomeAceito)) {
    motivos.push({ aceito: retrato.nomeAceito, c2x: c2x.nome, tipo: "nome" });
  }

  if (unidades && unidades.fora > 0) {
    motivos.push({ ...unidades, tipo: "prefixo" });
  }

  return motivos.sort((a, b) => ORDEM_DOS_MOTIVOS[a.tipo] - ORDEM_DOS_MOTIVOS[b.tipo]);
}

/**
 * A chave de um motivo na impressão digital. Leva os VALORES, e não as contagens: uma unidade ADT a
 * mais não é divergência nova, e não deve nascer protocolo (nem notificação) por isso.
 */
function chaveDoMotivo(motivo: MotivoDoVigia): string {
  switch (motivo.tipo) {
    case "cidade":
    case "uf":
      return `${motivo.tipo}=${normalizar(motivo.cadastro)}>${normalizar(motivo.c2x)}`;
    case "nome":
      return `nome=${normalizar(motivo.c2x)}`;
    case "prefixo":
      return `prefixo=${motivo.esperado}:${motivo.encontrados.join(",")}`;
    case "sem_cadastro":
      return "sem_cadastro";
    case "sigla":
      return `sigla=${normalizar(motivo.cadastro)}>${normalizar(motivo.c2x)}`;
    case "sumiu_do_c2x":
      return `sumiu_do_c2x=${normalizar(motivo.codigo)}`;
  }
}

/** Um protocolo por id e por conjunto de divergências: 'cadastro-c2x:<id>:<motivos ordenados>'. */
export function impressaoDigital(
  enterpriseId: string,
  motivos: readonly MotivoDoVigia[],
): string {
  return `${PREFIXO_DA_IMPRESSAO}${enterpriseId}:${motivos.map(chaveDoMotivo).sort().join("|")}`;
}

/** O id do C2X de uma impressão do vigia, ou null se a impressão não é dele. */
export function idDaImpressao(impressao: string): string | null {
  if (!impressao.startsWith(PREFIXO_DA_IMPRESSAO)) {
    return null;
  }

  const id = impressao.slice(PREFIXO_DA_IMPRESSAO.length).split(":")[0] ?? "";

  return /^\d{1,18}$/.test(id) ? id : null;
}

export function textoDoMotivo(motivo: MotivoDoVigia): string {
  switch (motivo.tipo) {
    case "cidade":
      return `Cidade: ${motivo.cadastro} no Panteon, ${motivo.c2x} no C2X.`;
    case "nome":
      return `O nome no C2X mudou de "${motivo.aceito}" para "${motivo.c2x}".`;
    case "prefixo":
      return `${motivo.fora} de ${motivo.total} unidades do Panteon começam por ${motivo.encontrados.join(", ")}, e não pela sigla ${motivo.esperado}.`;
    case "sem_cadastro":
      return "O C2X tem este empreendimento e o Panteon não tem cadastro dele.";
    case "sigla":
      return `Sigla: ${motivo.cadastro} no Panteon, ${motivo.c2x} no C2X.`;
    case "sumiu_do_c2x":
      return `O cadastro ${motivo.codigo} aponta para um id que o C2X não tem mais.`;
    case "uf":
      return `UF: ${motivo.cadastro} no Panteon, ${motivo.c2x} no C2X.`;
  }
}

const NIVEL_DO_MOTIVO: Record<MotivoDoVigia["tipo"], OperationsRiskLevel> = {
  cidade: "baixo",
  nome: "baixo",
  prefixo: "medio",
  sem_cadastro: "medio",
  sigla: "medio",
  sumiu_do_c2x: "alto",
  uf: "baixo",
};

const PESO_DO_NIVEL: Record<OperationsRiskLevel, number> = {
  baixo: 0,
  medio: 1,
  alto: 2,
  critico: 3,
};

function nivelDoAviso(motivos: readonly MotivoDoVigia[]): OperationsRiskLevel {
  return motivos
    .map((motivo) => NIVEL_DO_MOTIVO[motivo.tipo])
    .reduce<OperationsRiskLevel>(
      (maior, nivel) => (PESO_DO_NIVEL[nivel] > PESO_DO_NIVEL[maior] ? nivel : maior),
      "baixo",
    );
}

/**
 * A conferência inteira de uma rodada, pura. O servidor lê os dois lados, chama isto e grava o que
 * sai: o retrato novo de cada id e um aviso por id com motivo.
 */
export function conferirCadastro(entrada: EntradaDaConferencia): ResultadoDaConferencia {
  const retratos: RetratoDoC2x[] = [];
  const avisos: AvisoDoVigia[] = [];
  const conferidos: string[] = [];
  const ids = [...new Set(entrada.ids)].sort((a, b) => Number(a) - Number(b));

  for (const id of ids) {
    const cadastro = entrada.cadastros.get(id) ?? null;

    if (ehIdDoPanteon(id) || (cadastro && ehCadastroDeTeste(cadastro))) {
      continue;
    }

    const c2x = entrada.c2x.get(id) ?? null;
    const anterior = entrada.retratos.get(id) ?? null;
    const teste = ehIdDeTesteDoC2x(id);
    const esperado = codigoDoProduto(cadastro?.codigo ?? c2x?.codigo ?? "");
    const unidades =
      esperado && !teste ? resumoDasUnidades(entrada.unidades.get(id) ?? [], esperado) : null;
    let retrato = anterior;

    if (c2x) {
      retrato = retratoAtualizado({
        anterior,
        auditoriaId: entrada.auditorias.get(id) ?? null,
        c2x,
        historico: entrada.historico?.get(id),
        nomesDoPanteon: cadastro
          ? [cadastro.nome, ...(entrada.nomesAntigosDoCadastro.get(cadastro.id) ?? [])]
          : [],
        prefixosDivergentes: unidades?.fora ?? 0,
      });
      retratos.push(retrato);
    } else if (anterior) {
      // Sumiu do C2X: o retrato fica como estava (é assim que se sabe o que ele era), só o visto_em anda.
      retratos.push(anterior);
    }

    // O teste entra no retrato (o cursor da auditoria precisa andar por ele também), e só.
    if (teste) {
      continue;
    }

    conferidos.push(id);
    const motivos = motivosDoId({ cadastro, c2x, retrato, unidades });

    if (motivos.length > 0) {
      avisos.push({
        enterpriseId: id,
        impressao: impressaoDigital(id, motivos),
        motivos,
        rotulo: rotuloDoId(id, cadastro, c2x),
      });
    }
  }

  return { avisos, conferidos, retratos };
}

function rotuloDoId(
  id: string,
  cadastro: CadastroParaOVigia | null,
  c2x: EmpreendimentoNoC2x | null,
): string {
  if (cadastro) return `${cadastro.nome} (${cadastro.codigo})`;
  if (c2x) return `${c2x.nome} (${c2x.codigo})`;
  return `id ${id}`;
}

/**
 * O aviso no formato dos protocolos do Zeus (hub_operations_alert_protocols). Nenhum campo leva o
 * JSON da auditoria do C2X: só sigla, nome, cidade e UF de EMPREENDIMENTO, e contagens.
 */
export function alertaDoAviso(aviso: AvisoDoVigia, agora: Date): OperationsAlert {
  const textos = aviso.motivos.map(textoDoMotivo);
  const protocolo = `AL-${hashCurto(aviso.impressao)}`;

  return {
    analysis: {
      action: "acionar",
      label: "Novo",
      reason: "Divergência nova entre o cadastro do Panteon e o C2X.",
      status: "novo",
    },
    command: [
      `Protocolo ${protocolo}: o cadastro do empreendimento ${aviso.rotulo}, id ${aviso.enterpriseId} do C2X, diverge do C2X.`,
      ...textos,
      "Decidir no cadastro (PAN-124): seguir o C2X, aceitar a divergência ou corrigir. O C2X é só leitura.",
    ].join("\n"),
    endpoint: "cron:/api/notifications/sweep#vigia-do-cadastro",
    expectedResult: "Cadastro do Panteon e C2X de acordo, ou a divergência aceita.",
    fingerprint: aviso.impressao,
    generatedAt: agora.toISOString(),
    httpStatus: 200,
    id: `cadastro-c2x-${aviso.enterpriseId}`,
    impact:
      "Rótulo, sigla ou prefixo de unidade diferente entre o Panteon e o C2X: consulta pela sigla volta vazia sem erro, e unidade nova pode nascer com o prefixo errado.",
    level: nivelDoAviso(aviso.motivos),
    module: "apolo",
    origin: "vigia do cadastro (PAN-124 F3)",
    payloadBytes: 0,
    protocol: protocolo,
    receivedResult: textos.join(" "),
    recommendation:
      "Abrir o cadastro do empreendimento e decidir. O vigia fecha este protocolo sozinho quando os dois lados baterem.",
    recommendedAgent: "Zeus",
    responseMs: 0,
    status: "ativo",
    title: `Cadastro x C2X: ${aviso.rotulo}`,
    type: "cadastro_divergente",
  };
}

/** O mesmo hash curto do monitoramento (lib/operations/monitoring.ts), para o protocolo reserva. */
function hashCurto(valor: string): string {
  let hash = 0;

  for (let indice = 0; indice < valor.length; indice += 1) {
    hash = (hash << 5) - hash + valor.charCodeAt(indice);
    hash |= 0;
  }

  return String((Math.abs(hash) % 9999) + 1).padStart(4, "0");
}

export type ProtocoloAberto = { fingerprint: string; protocol: string };

/**
 * Os protocolos do vigia que a rodada fecha: abertos, de um id CONFERIDO agora, cuja impressão não
 * está mais entre as de agora. Ou os lados bateram, ou a divergência mudou (e a nova tem protocolo
 * próprio). Id que a rodada não conferiu fica como está.
 */
export function protocolosAFechar(
  abertos: readonly ProtocoloAberto[],
  conferidos: readonly string[],
  impressoesDeAgora: readonly string[],
): ProtocoloAberto[] {
  const ids = new Set(conferidos);
  const atuais = new Set(impressoesDeAgora);

  return abertos.filter((protocolo) => {
    const id = idDaImpressao(protocolo.fingerprint);

    return id !== null && ids.has(id) && !atuais.has(protocolo.fingerprint);
  });
}

/**
 * Quem merece notificação: só o protocolo que NASCEU nesta rodada. `publishHubNotification` não tem
 * dedup (lib/notifications/publish.ts), e a conferência diária repete o mesmo aviso todo dia.
 */
export function protocolosQueNasceram<T extends { fingerprint: string; occurrenceCount: number }>(
  protocolos: readonly T[],
): T[] {
  return protocolos.filter(
    (protocolo) =>
      protocolo.occurrenceCount === 1 && protocolo.fingerprint.startsWith(PREFIXO_DA_IMPRESSAO),
  );
}
