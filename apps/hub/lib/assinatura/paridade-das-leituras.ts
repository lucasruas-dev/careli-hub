import type { UnidadeDeAssinatura } from "@/lib/apolo/incorporador/assinaturas";
import type { SituacaoDaAssinatura } from "@/lib/apolo/incorporador/contratos";

import { type ContratoDoPanteon, quadroDosContratos } from "./contratos-do-panteon-montagem";
import type { Provedor } from "./tipos";

// A TRAVA DA F4: O ENSAIO DE PARIDADE, puro (plano da fonte única, F4, "Trava da F4").
//
// ⚠️ A ABA ASSINATURA SÓ TROCA DE FONTE COM "INEXPLICADO = 0". O leitor antigo (C2X + D4Sign ao vivo +
// as nativas do Panteon, v1.389.0) e o novo (a leitura única) são postos lado a lado, por empreendimento
// e por unidade, e toda diferença cai numa categoria que a regra do plano ou uma resposta do Lucas
// explica. O que não cai em nenhuma é `inexplicado`, e o deploy espera.
//
// ⚠️ A SAÍDA É ANONIMIZADA: contagens por empreendimento e categoria, e o código da unidade (que não é
// dado pessoal) nos inexplicados. Nunca nome, e-mail nem documento. É ela que vira a fixture do vitest.
//
// O script que alimenta isto é `scripts/temis/comparar-leitura-de-assinaturas.mjs` (só leitura).

export type Categoria =
  /** Mesma situação, mesmas contagens, mesmo esquema. */
  | "igual"
  /**
   * A venda nativa assinando na Clicksign. O leitor comparado (v1.389.0) JÁ a mostrava, pelo último
   * payload conferido (`envioId` 0), ou mostrava a redigitação "aguardando emissão". Explicada só com
   * o novo IGUAL OU À FRENTE do antigo: marca que some é regressão (o backfill da F1 que não rodou).
   */
  | "clicksign_no_panteon"
  /** Resposta 1: a venda que não está no Panteon aparece pelo envelope que o espelho ligou à unidade. */
  | "presente_pelo_envelope"
  /** Resposta 2: o contrato de venda desfeita saiu do portal e ficou na tela interna. */
  | "venda_desfeita_so_interna"
  /** A venda "aguardando emissão" cujo terreno tem um envelope sem venda: no portal fica a do envelope. */
  | "substituida_pelo_envelope"
  /** Diferença declarada (f): envio sem `uuidDoc` não é espelhado. */
  | "envio_sem_uuid"
  /** Status 6 do C2X: o espelho o marca cancelado. */
  | "status6"
  /** Diferença declarada (g): tipo do C2X não mapeado em `FINALIDADE_POR_TIPO_DO_C2X`. */
  | "tipo_nao_mapeado"
  /** A unidade do envio não existe no Panteon (o espelho não insere: `semUnidade`). */
  | "unidade_fora_do_panteon"
  /** Venda viva só no C2X (depois da carga) que nunca saiu para assinar: sem envelope, não há o que mostrar. */
  | "venda_so_no_c2x_sem_envio"
  /** Diferença declarada (c): venda da carga desfeita no C2X depois de 21/09 continua viva no Panteon. */
  | "venda_da_carga_desfeita_no_c2x"
  /** 0.30: a mesma venda da carga em duas glebas (LBR+ACT, RDP+RPC, SDT+TSC). Frente do cadastro. */
  | "mesma_venda_em_duas_glebas"
  /** Diferença declarada (b): a nativa da D4Sign aparece pela venda nativa, não pelo pedido redigitado. */
  | "nativa_ligada"
  /** Diferença declarada (h): degrau cru por provedor, ou o perfil pela régua da casa. */
  | "degrau_ou_perfil"
  /** O botão do PDF: D4Sign vigente com documento, em qualquer estado. */
  | "tem_contrato_diferente"
  /** O mesmo envio da D4Sign, o espelho um passo à frente do que o antigo mostrava. */
  | "d4sign_mais_recente"
  /**
   * Diferença declarada (d): um vigente por venda. O envio antigo sem par é do MESMO pedido do C2X (AR)
   * de um envio que tem par: o fato vem do C2X, não da forma da linha.
   */
  | "um_vigente_por_venda"
  /**
   * Unidade revendida: o envio antigo sem par é de um pedido que o C2X já não tem vivo, e a unidade tem
   * a linha do comprador atual. A resposta 2 (contrato de venda desfeita fica só na tela interna)
   * aplicada à linha sem venda, que o guarda em `outrosVivos`.
   */
  | "contrato_anterior_da_revenda"
  | "inexplicado";

export const CATEGORIAS_EXPLICADAS: readonly Categoria[] = [
  "igual",
  "clicksign_no_panteon",
  "presente_pelo_envelope",
  "venda_desfeita_so_interna",
  "substituida_pelo_envelope",
  "envio_sem_uuid",
  "status6",
  "tipo_nao_mapeado",
  "unidade_fora_do_panteon",
  "venda_so_no_c2x_sem_envio",
  "venda_da_carga_desfeita_no_c2x",
  "mesma_venda_em_duas_glebas",
  "nativa_ligada",
  "degrau_ou_perfil",
  "tem_contrato_diferente",
  "d4sign_mais_recente",
  "um_vigente_por_venda",
  "contrato_anterior_da_revenda",
];

/** Uma linha comparável: o que as duas telas mostram de um contrato. */
export type LinhaComparavel = {
  assinadas: number;
  empreendimento: string;
  /** Perfil e degrau de cada pessoa, ordenados (sem nome). */
  esquema: string[];
  /** `contract_signatures.id` do C2X quando é D4Sign (positivo); 0 sem envio; negativo na Clicksign. */
  envioId: number;
  situacao: SituacaoDaAssinatura;
  temContrato: boolean;
  /**
   * A linha tem "gerado em"? Não entra na categoria (é outra dimensão): o relatório conta à parte
   * quantas linhas o perdem, porque na venda da carga a data deixou de vir do histórico do C2X.
   */
  temGeradoEm: boolean;
  total: number;
  unidade: string;
};

export type LinhaNova = LinhaComparavel & {
  arC2xId: null | number;
  avisos: readonly string[];
  noPortal: boolean;
  origemDaVenda: "c2x" | "panteon" | null;
  propostaId: null | string;
  provedor: null | Provedor;
};

/** O que só o C2X (SELECT) e o Panteon sabem, reunido pelo script. Sem dado pessoal. */
export type FatosDaParidade = {
  /** AR vivos no C2X (a régua de `lerContratosVivos`). `null` = não medido. */
  arsVivosNoC2x: null | ReadonlySet<number>;
  /** Chaves EMP:UNIDADE de contrato vivo no C2X cujo AR não existe no Panteon. */
  chavesSoNoC2x: ReadonlySet<string>;
  /** Propostas da carga que são a mesma venda em duas glebas (0.30), achadas pelo script em memória. */
  duplicatasDeGleba: ReadonlySet<string>;
  /**
   * Por `contract_signatures.id`: o que explica o envio não ter linha no espelho, e o pedido do C2X
   * (`acquisition_requests.id`) dele. `arId` nulo = não medido: sem ele, nada se explica pelo pedido.
   */
  envios: ReadonlyMap<
    number,
    { arId: null | number; semUuid: boolean; status6: boolean; tipoNaoMapeado: boolean; unidadeForaDoPanteon: boolean }
  >;
};

export type Inexplicado = { empreendimento: string; motivo: string; unidade: string };

export type RelatorioDaParidade = {
  /** Pares em que o antigo tinha "gerado em" e o novo não: diferença MEDIDA, que o Zeus leva ao Lucas. */
  geradoEmPerdido: { porEmpreendimento: Record<string, number>; total: number };
  inexplicados: Inexplicado[];
  porCategoria: Partial<Record<Categoria, number>>;
  porEmpreendimento: Record<string, Partial<Record<Categoria, number>>>;
};

const ORDEM_DA_SITUACAO: Record<SituacaoDaAssinatura, number> = { "aguardando-emissao": 0, assinado: 2, "em-assinatura": 1 };

function chave(l: { empreendimento: string; unidade: string }): string {
  return `${l.empreendimento.trim().toUpperCase()}:${l.unidade.trim().toUpperCase()}`;
}

/** A linha do leitor antigo (o quadro que o portal recebia), comparável. */
export function linhaAntiga(u: Pick<UnidadeDeAssinatura, "assinadas" | "contrato" | "empreendimento" | "envioId" | "esquema" | "situacao" | "total" | "unidade">): LinhaComparavel {
  return {
    assinadas: u.assinadas,
    empreendimento: u.empreendimento,
    esquema: u.esquema.map((e) => `${e.degrau}:${e.perfil}`).sort(),
    envioId: u.envioId,
    situacao: u.situacao,
    temContrato: Boolean(u.contrato?.temContrato),
    temGeradoEm: Boolean(u.contrato?.geradoEm),
    total: u.total,
    unidade: u.unidade,
  };
}

/** As linhas do leitor novo (TODAS, com `noPortal`), cada contrato pela montagem de uma linha só. */
export function linhasNovas(contratos: readonly ContratoDoPanteon[], agora: Date): LinhaNova[] {
  const saida: LinhaNova[] = [];
  for (const c of contratos) {
    const [u] = quadroDosContratos([c], { agora, interno: true }).unidades;
    if (!u) continue;
    saida.push({
      ...linhaAntiga(u),
      arC2xId: c.proposta?.arC2xId ?? null,
      avisos: c.avisos,
      noPortal: c.noPortal,
      origemDaVenda: c.proposta?.origem ?? null,
      propostaId: c.proposta?.id ?? c.propostaDoEnvelope,
      provedor: c.envelope?.provedor ?? null,
    });
  }
  return saida;
}

function progresso(l: LinhaComparavel): number {
  return ORDEM_DA_SITUACAO[l.situacao] * 10_000 + l.assinadas;
}

type Resultado = Categoria | { motivo: string };

/**
 * O par (antigo, novo) da mesma unidade.
 *
 * ⚠️ SÓ SE EXPLICA COM FATO, NUNCA PELA FORMA DA LINHA (revisão da F4: o ataque "paridade tautológica"
 * voltando). Toda categoria que não é "o mesmo envio" exige o novo IGUAL OU À FRENTE do antigo
 * (`progresso`): uma Clicksign que perde marcas, uma nativa ligada que recua, um envelope sem venda
 * que mostra o contrato ASSINADO de outro comprador no lugar do vivo do comprador atual, tudo isso é
 * `inexplicado`. E a linha que sai do portal só se explica se o envio que o antigo mostrava continua
 * no portal por outra linha.
 */
function categoriaDoPar(a: LinhaComparavel, n: LinhaNova, fatos: FatosDaParidade, envioNoPortal: ReadonlySet<number>): Resultado {
  if (n.avisos.includes("contrato_de_venda_desfeita")) return "venda_desfeita_so_interna";
  if (!n.noPortal) {
    const oEnvioSegue = a.situacao === "aguardando-emissao" || (a.envioId !== 0 && envioNoPortal.has(a.envioId));
    return n.situacao === "aguardando-emissao" && oEnvioSegue
      ? "substituida_pelo_envelope"
      : { motivo: "a linha saiu do portal e o envio que o antigo mostrava não está em outra linha" };
  }
  const mesmasContagens = a.situacao === n.situacao && a.assinadas === n.assinadas && a.total === n.total;
  if (mesmasContagens) {
    if (a.temContrato !== n.temContrato) return "tem_contrato_diferente";
    return a.esquema.join("|") === n.esquema.join("|") ? "igual" : "degrau_ou_perfil";
  }
  if (a.envioId > 0 && a.envioId === n.envioId) {
    return progresso(n) >= progresso(a) ? "d4sign_mais_recente" : { motivo: "o espelho está atrás do antigo no mesmo envio" };
  }
  if (progresso(n) < progresso(a)) {
    return { motivo: `recuo: ${a.situacao} ${a.assinadas}/${a.total} para ${n.situacao} ${n.assinadas}/${n.total}` };
  }
  // Daqui para baixo o novo está igual ou à frente, e ainda precisa do fato que liga os dois envios:
  // o antigo sem envio (aguardando emissão) ou a linha nativa do Panteon (`envioId` 0 no antigo).
  const antigoSemEnvioDoC2x = a.situacao === "aguardando-emissao" || a.envioId <= 0;
  if (n.provedor === "clicksign" && antigoSemEnvioDoC2x) return "clicksign_no_panteon";
  if (n.propostaId && fatos.duplicatasDeGleba.has(n.propostaId)) return "mesma_venda_em_duas_glebas";
  if (n.provedor === "d4sign" && n.origemDaVenda === "panteon" && antigoSemEnvioDoC2x) return "nativa_ligada";
  if (n.avisos.includes("envelope_sem_venda") && a.situacao === "aguardando-emissao") return "presente_pelo_envelope";
  return { motivo: `outro envio: ${a.situacao} ${a.envioId > 0 ? "com" : "sem"} envio do C2X, para ${n.situacao}` };
}

/**
 * A linha antiga sem par na unidade.
 *
 * ⚠️ `um_vigente_por_venda` SÓ COM O MESMO PEDIDO: o envio sem par tem de ser do mesmo AR de um envio
 * que tem par (antes bastava a unidade ter outro par, e o contrato vivo do comprador novo de uma
 * unidade revendida sumia "explicado").
 */
function categoriaSoAntiga(a: LinhaComparavel, fatos: FatosDaParidade, pareadas: readonly LinhaComparavel[]): Resultado {
  const envio = a.envioId > 0 ? fatos.envios.get(a.envioId) : undefined;
  if (envio?.unidadeForaDoPanteon) return "unidade_fora_do_panteon";
  if (envio?.semUuid) return "envio_sem_uuid";
  if (envio?.status6) return "status6";
  if (envio?.tipoNaoMapeado) return "tipo_nao_mapeado";
  const ar = envio?.arId ?? null;
  if (ar !== null) {
    const doMesmoPedido = pareadas.some((p) => p.envioId > 0 && fatos.envios.get(p.envioId)?.arId === ar);
    if (doMesmoPedido) return "um_vigente_por_venda";
    if (pareadas.length > 0 && fatos.arsVivosNoC2x && !fatos.arsVivosNoC2x.has(ar)) return "contrato_anterior_da_revenda";
  }
  if (a.situacao === "aguardando-emissao" && fatos.chavesSoNoC2x.has(chave(a))) return "venda_so_no_c2x_sem_envio";
  return { motivo: "só no leitor antigo" };
}

function categoriaSoNova(n: LinhaNova, fatos: FatosDaParidade): Resultado {
  if (n.avisos.includes("contrato_de_venda_desfeita")) return "venda_desfeita_so_interna";
  if (!n.noPortal) return "substituida_pelo_envelope";
  if (n.avisos.includes("envelope_sem_venda")) return "presente_pelo_envelope";
  if (n.propostaId && fatos.duplicatasDeGleba.has(n.propostaId)) return "mesma_venda_em_duas_glebas";
  if (n.origemDaVenda === "c2x" && n.arC2xId !== null && fatos.arsVivosNoC2x && !fatos.arsVivosNoC2x.has(n.arC2xId)) {
    return "venda_da_carga_desfeita_no_c2x";
  }
  if (n.provedor === "clicksign") return "clicksign_no_panteon";
  if (n.provedor === "d4sign" && n.origemDaVenda === "panteon") return "nativa_ligada";
  return { motivo: "só no leitor novo" };
}

/**
 * Compara as duas leituras, unidade a unidade. Dentro da mesma unidade, o par é pelo mesmo envio da
 * D4Sign primeiro (o `contract_signatures.id` é o mesmo número nas duas), depois na ordem.
 */
export function compararLeituras(
  antigas: readonly LinhaComparavel[],
  novas: readonly LinhaNova[],
  fatos: FatosDaParidade,
): RelatorioDaParidade {
  const relatorio: RelatorioDaParidade = {
    geradoEmPerdido: { porEmpreendimento: {}, total: 0 },
    inexplicados: [],
    porCategoria: {},
    porEmpreendimento: {},
  };
  const envioNoPortal = new Set(novas.filter((n) => n.noPortal && n.envioId !== 0).map((n) => n.envioId));
  const anotar = (linha: LinhaComparavel, resultado: Resultado) => {
    const categoria: Categoria = typeof resultado === "string" ? resultado : "inexplicado";
    const emp = linha.empreendimento.trim().toUpperCase() || "-";
    relatorio.porCategoria[categoria] = (relatorio.porCategoria[categoria] ?? 0) + 1;
    const doEmp = relatorio.porEmpreendimento[emp] ?? {};
    doEmp[categoria] = (doEmp[categoria] ?? 0) + 1;
    relatorio.porEmpreendimento[emp] = doEmp;
    if (typeof resultado !== "string") {
      relatorio.inexplicados.push({ empreendimento: emp, motivo: resultado.motivo, unidade: linha.unidade });
    }
  };

  const porChave = new Map<string, { antigas: LinhaComparavel[]; novas: LinhaNova[] }>();
  const grupo = (k: string) => {
    const atual = porChave.get(k) ?? { antigas: [], novas: [] };
    porChave.set(k, atual);
    return atual;
  };
  for (const a of antigas) grupo(chave(a)).antigas.push(a);
  for (const n of novas) grupo(chave(n)).novas.push(n);

  for (const { antigas: as, novas: ns } of porChave.values()) {
    const livresA = [...as];
    const livresN = [...ns];
    const pares: Array<[LinhaComparavel, LinhaNova]> = [];
    for (const a of [...livresA]) {
      if (a.envioId <= 0) continue;
      const i = livresN.findIndex((n) => n.envioId === a.envioId);
      if (i < 0) continue;
      const [n] = livresN.splice(i, 1);
      livresA.splice(livresA.indexOf(a), 1);
      if (n) pares.push([a, n]);
    }
    while (livresA.length > 0 && livresN.length > 0) {
      const a = livresA.shift();
      const n = livresN.shift();
      if (a && n) pares.push([a, n]);
    }
    for (const [a, n] of pares) {
      anotar(a, categoriaDoPar(a, n, fatos, envioNoPortal));
      if (a.temGeradoEm && !n.temGeradoEm) {
        const emp = a.empreendimento.trim().toUpperCase() || "-";
        relatorio.geradoEmPerdido.total += 1;
        relatorio.geradoEmPerdido.porEmpreendimento[emp] = (relatorio.geradoEmPerdido.porEmpreendimento[emp] ?? 0) + 1;
      }
    }
    const pareadas = pares.map(([a]) => a);
    for (const a of livresA) anotar(a, categoriaSoAntiga(a, fatos, pareadas));
    for (const n of livresN) anotar(n, categoriaSoNova(n, fatos));
  }
  return relatorio;
}

/** Quantos inexplicados; o critério da trava é zero. */
export function totalInexplicado(relatorio: Pick<RelatorioDaParidade, "porCategoria">): number {
  return relatorio.porCategoria.inexplicado ?? 0;
}
