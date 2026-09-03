// O RESUMO DE UM PRODUTO NO HÉRCULES: a faixa do processo do coordenador, num número por fase.
//
// Lucas (02/09/2026): *"produtos é replicar a tela que temos hoje em empreendimento do apolo"* — e a
// aba Resumo da ficha ganha, além do ResumoTab do Apolo (% vendido + dados do empreendimento), a
// FAIXA DO PROCESSO: quem vende (imobiliárias, corretores) → cadastro (CADs em andamento,
// credenciados) → venda (reservas, propostas, em contrato, vendidas). É o funil que o coordenador
// acompanha de ponta a ponta, e que hoje ele só enxerga somando três telas.
//
// TRÊS FONTES, uma por fase:
//   • QUEM VENDE  — `apolo_relationships` (vínculo `empreendimento` de imobiliária, via
//                   `lerImobiliariasVinculadas`) + os nomes de corretor gravados na esteira;
//   • CADASTRO    — `apolo_esteira`, a CAD por (pessoa, empreendimento) (`lerEsteiraDoEscopo`);
//   • VENDA       — o C2X, uma unidade por estágio (`loadApoloEnterpriseVendas`).
//
// ⚠️ NENHUM NÚMERO NOVO NASCE AQUI. Cada contagem é a mesma que a aba de origem já mostra (o CRM
// conta CAD por imobiliária pelo `imobiliaria_entity_id`; a Vendas conta unidade por `stage`).
// Se a faixa discordar da aba, a aba está certa e este arquivo está errado.
//
// Função pura: a rota lê as três fontes e chama daqui. Tudo o que é regra está coberto por teste.
import type { ApoloVendaStage, ApoloVendaUnit } from "@/lib/apolo/vendas";

import { contarCadsPorImobiliaria, type LinhaEsteira, rotuloDaEtapa } from "./crm";

// ── O CONTRATO COM A TELA ───────────────────────────────────────────────────

/** Os onze números da faixa, na ordem do processo do coordenador. */
export type FaixaDoProcesso = {
  /** CADs na etapa `correcao` — subconjunto de `cadsEmAndamento`. */
  cadsCorrecao: number;
  /** CADs que ainda não chegaram ao fim: tudo que não é `credenciado` nem `indeferido`. */
  cadsEmAndamento: number;
  /** Nomes DISTINTOS de corretor nas CADs do produto. */
  corretores: number;
  credenciados: number;
  emAssinatura: number;
  emContrato: number;
  /** Vínculo de empreendimento ativo mas ainda não `verified`. */
  imobiliariasAguardando: number;
  /** Vínculo de empreendimento `verified`. */
  imobiliariasHabilitadas: number;
  propostas: number;
  reservas: number;
  /** Unidades faturadas. */
  vendidas: number;
};

export type CadPorEtapa = {
  /** A etapa REPRESENTANTE do rótulo (a primeira do caminho que cai nele). */
  etapa: string;
  quantidade: number;
  /** O rótulo no vocabulário do cliente (`rotuloDaEtapa`). */
  rotulo: string;
};

export type QuemVende = {
  aguardando: number;
  corretores: number;
  habilitadas: number;
  /** A imobiliária com mais CADs no produto. Nulo quando nenhuma CAD tem imobiliária. */
  maior: null | { cads: number; nome: string };
};

export type ResumoDoProduto = {
  cadsPorEtapa: CadPorEtapa[];
  processo: FaixaDoProcesso;
  quemVende: QuemVende;
};

/** O que `lerImobiliariasVinculadas` devolve por imobiliária — só o que o resumo usa. */
export type ImobiliariaVinculada = {
  id: string;
  nome: string;
  verificada: boolean;
};

// ── AS ETAPAS ───────────────────────────────────────────────────────────────
//
// A ordem do CAMINHO da CAD, para as barras saírem na sequência em que a pessoa anda. `cadastro`
// entra na frente (a CAD que ainda está sendo preenchida) e os desvios ficam onde acontecem.
// `credito` e `revisao` caem no MESMO rótulo ("Em análise") de propósito: `rotuloDaEtapa` esconde
// o veredito de crédito do incorporador, e duas barras "Em análise" contariam a mesma coisa duas
// vezes — por isso o agrupamento é por RÓTULO, e a etapa que sai é a representante.
const CAMINHO_DA_CAD = [
  "cadastro",
  "validacao",
  "credito",
  "revisao",
  "correcao",
  "prevenda",
  "credenciado",
  "indeferido",
] as const;

/** As etapas em que a CAD já PAROU: ou virou credenciado, ou não seguiu. */
const ETAPAS_FINAIS = new Set<string>(["credenciado", "indeferido"]);

function etapaLimpa(etapa: null | string | undefined): string {
  return String(etapa ?? "").trim().toLowerCase();
}

/** Chave de comparação de nome: espaços colapsados, sem caixa. "João  Silva" = "joão silva". */
function chaveDeNome(nome: null | string | undefined): string {
  return String(nome ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// ── A MONTAGEM ──────────────────────────────────────────────────────────────

/**
 * As barras "CADs por etapa": uma por RÓTULO, na ordem do caminho.
 *
 * Os rótulos do caminho saem SEMPRE (mesmo com zero): o coordenador vê o funil inteiro, e uma
 * etapa vazia é informação ("ninguém em correção"). Etapa que a esteira gravou fora do caminho
 * cai em "Em andamento", e essa só aparece quando tem alguém — barra de zero para etapa que não
 * existe seria ruído.
 */
export function contarCadsPorEtapa(esteira: LinhaEsteira[]): CadPorEtapa[] {
  const porRotulo = new Map<string, CadPorEtapa>();

  for (const etapa of CAMINHO_DA_CAD) {
    const rotulo = rotuloDaEtapa(etapa);
    if (!porRotulo.has(rotulo)) porRotulo.set(rotulo, { etapa, quantidade: 0, rotulo });
  }

  const conhecidas = new Set<string>(CAMINHO_DA_CAD);
  let foraDoCaminho = 0;

  for (const linha of esteira) {
    const etapa = etapaLimpa(linha.etapa);
    if (!conhecidas.has(etapa)) {
      foraDoCaminho += 1;
      continue;
    }
    const balde = porRotulo.get(rotuloDaEtapa(etapa));
    if (balde) balde.quantidade += 1;
  }

  const barras = [...porRotulo.values()];
  if (foraDoCaminho > 0) {
    barras.push({ etapa: "outra", quantidade: foraDoCaminho, rotulo: rotuloDaEtapa("outra") });
  }

  return barras;
}

/** Quantos corretores DIFERENTES aparecem nas CADs (pelo nome normalizado). */
export function contarCorretores(esteira: LinhaEsteira[]): number {
  const nomes = new Set<string>();
  for (const linha of esteira) {
    const chave = chaveDeNome(linha.corretor);
    if (chave) nomes.add(chave);
  }
  return nomes.size;
}

/**
 * A imobiliária com mais CADs no produto.
 *
 * ⚠️ PELO `imobiliaria_entity_id`, nunca pelo texto — a mesma regra de `contarCadsPorImobiliaria`
 * (a mesma imobiliária aparece escrita de três formas na esteira). O NOME vem do vínculo quando
 * ela está vinculada; senão, do texto mais frequente que a esteira gravou para aquele id. Empate
 * de contagem desempata pelo nome, para o card não trocar de imobiliária a cada carregamento.
 */
export function maiorImobiliaria(
  esteira: LinhaEsteira[],
  imobiliarias: ImobiliariaVinculada[],
): null | { cads: number; nome: string } {
  const contagem = contarCadsPorImobiliaria(esteira);
  if (contagem.size === 0) return null;

  const nomeVinculado = new Map(imobiliarias.map((imob) => [imob.id, imob.nome]));

  // O texto mais frequente da esteira por id, para quem não tem vínculo (ou o vínculo veio sem nome).
  const textosPorId = new Map<string, Map<string, number>>();
  for (const linha of esteira) {
    const id = linha.imobiliaria_entity_id;
    const texto = String(linha.imobiliaria ?? "").trim();
    if (!id || !texto) continue;
    const textos = textosPorId.get(id) ?? new Map<string, number>();
    textos.set(texto, (textos.get(texto) ?? 0) + 1);
    textosPorId.set(id, textos);
  }

  const nomeDe = (id: string): string => {
    const vinculado = String(nomeVinculado.get(id) ?? "").trim();
    if (vinculado) return vinculado;

    let melhor = "";
    let maior = 0;
    for (const [texto, vezes] of textosPorId.get(id) ?? []) {
      if (vezes > maior || (vezes === maior && texto.localeCompare(melhor, "pt-BR") < 0)) {
        melhor = texto;
        maior = vezes;
      }
    }
    return melhor || "Sem nome";
  };

  const candidatos = [...contagem.entries()]
    .map(([id, cads]) => ({ cads, nome: nomeDe(id) }))
    .sort((a, b) => b.cads - a.cads || a.nome.localeCompare(b.nome, "pt-BR"));

  return candidatos[0] ?? null;
}

/** Unidades por estágio do funil — `disponivel` fica de fora (não é venda). */
export function contarPorEstagio(
  unidades: Array<Pick<ApoloVendaUnit, "stage">>,
): Record<ApoloVendaStage, number> {
  const contagem: Record<ApoloVendaStage, number> = {
    assinatura: 0,
    contrato: 0,
    disponivel: 0,
    faturado: 0,
    proposta: 0,
    reservado: 0,
  };

  for (const unidade of unidades) {
    if (unidade.stage in contagem) contagem[unidade.stage] += 1;
  }

  return contagem;
}

export function montarResumoDoProduto({
  esteira,
  imobiliarias,
  unidades,
}: {
  esteira: LinhaEsteira[];
  imobiliarias: ImobiliariaVinculada[];
  unidades: Array<Pick<ApoloVendaUnit, "stage">>;
}): ResumoDoProduto {
  const habilitadas = imobiliarias.filter((imob) => imob.verificada).length;
  const aguardando = imobiliarias.length - habilitadas;
  const corretores = contarCorretores(esteira);

  let cadsEmAndamento = 0;
  let cadsCorrecao = 0;
  let credenciados = 0;

  for (const linha of esteira) {
    const etapa = etapaLimpa(linha.etapa);
    if (etapa === "credenciado") {
      credenciados += 1;
      continue;
    }
    if (ETAPAS_FINAIS.has(etapa)) continue;
    cadsEmAndamento += 1;
    if (etapa === "correcao") cadsCorrecao += 1;
  }

  const porEstagio = contarPorEstagio(unidades);

  return {
    cadsPorEtapa: contarCadsPorEtapa(esteira),
    processo: {
      cadsCorrecao,
      cadsEmAndamento,
      corretores,
      credenciados,
      emAssinatura: porEstagio.assinatura,
      emContrato: porEstagio.contrato,
      imobiliariasAguardando: aguardando,
      imobiliariasHabilitadas: habilitadas,
      propostas: porEstagio.proposta,
      reservas: porEstagio.reservado,
      vendidas: porEstagio.faturado,
    },
    quemVende: {
      aguardando,
      corretores,
      habilitadas,
      maior: maiorImobiliaria(esteira, imobiliarias),
    },
  };
}

// ── OS IDS QUE AS TABELAS DO APOLO ENTENDEM ─────────────────────────────────

/**
 * Completa os ids REAIS do C2X (o que `expandirIdDoPainel` devolve para "pai:<uuid>") com o id do
 * GRUPO do catálogo que eles cobrem — só quando cobrem o grupo INTEIRO e o grupo está na sessão.
 *
 * ⚠️ POR QUE ISTO EXISTE. As tabelas do Apolo guardam o empreendimento em DOIS formatos (medido em
 * 17/08/2026: 150 vínculos com a divisão, 1 com "group:Lagoa Bonita"). A Vendas não sente isso —
 * ela lê o C2X por CÓDIGO —, mas a esteira e os vínculos filtram por id, e um pai cujos filhos são
 * LBF + LBR + LBP deixaria de fora a imobiliária vinculada ao grupo. É o furo descrito em
 * [[empreendimento-equivalencia]], só que no caminho do pai.
 *
 * ⚠️ SÓ REDUZ O QUE A SESSÃO JÁ TEM. O grupo entra apenas se estiver em `permitidos` (a lista que
 * `idsDaSessao` expandiu) E se TODAS as divisões dele estiverem nos ids do pai: quem tem só a gleba
 * do Fernando não ganha o vínculo do grupo, porque o grupo é o conjunto — e o conjunto não é dele.
 */
export function comIdsDoGrupo(
  idsDoC2x: string[],
  catalogo: Array<{ id: string; stageIds: string[] }>,
  permitidos: Set<string>,
): string[] {
  const reais = new Set(idsDoC2x.map((id) => String(id).trim()).filter(Boolean));
  const saida = new Set(reais);

  for (const emp of catalogo) {
    const grupo = String(emp.id).trim();
    if (!grupo || !permitidos.has(grupo)) continue;

    const divisoes = emp.stageIds.map((id) => String(id).trim()).filter(Boolean);
    if (divisoes.length === 0) continue;
    if (!divisoes.every((id) => reais.has(id))) continue;

    saida.add(grupo);
  }

  return [...saida];
}
