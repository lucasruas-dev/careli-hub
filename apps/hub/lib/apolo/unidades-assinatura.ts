import type { LinhaAssinatura } from "./painel-assinatura";

// AS UNIDADES E O ANDAMENTO DA ASSINATURA — o cálculo, num lugar só.
//
// ⚠️ ISTO ESTAVA DUPLICADO LINHA A LINHA em duas telas: o painel interno
// (modules/apolo/blocks/assinaturas/painel-assinatura.tsx) e o painel público do coordenador
// (modules/publico/painel/aba-assinatura.tsx). As duas mostram a MESMA lista para as MESMAS
// pessoas, então uma divergência entre elas é um bug que ninguém percebe: cada uma conta um número
// e as duas parecem certas.
//
// ⚠️ O DESENHO É O DO PERFIL DO INCORPORADOR (modules/incorporador/TelaVendas.tsx), que o time já
// usa e o Lucas aprovou: *"pode seguir o mesmo padrão que fizemos no perfil do incorporador"*
// (25/08/2026). Lá cada contrato mostra UMA BARRA POR PERFIL — Imobiliária 1 de 1, Comprador 1 de
// 1, Incorporador 6 de 6, Backoffice 0 de 2 — e não uma barra única de progresso. A diferença não é
// estética: a barra única responde "quanto falta", a régua por perfil responde "QUEM está
// segurando", que é a pergunta que faz alguém agir.

/** Um perfil dentro de um contrato: quantos daquele perfil já assinaram. */
export type GrupoDeAssinatura = {
  assinadas: number;
  /** true quando a fila está parada exatamente neste perfil. */
  naVez: boolean;
  /** O menor degrau deste perfil no contrato — define a ordem das barras. */
  ordem: number;
  perfil: string;
  total: number;
};

/** Uma unidade pronta para virar linha: o que a lista precisa sem refazer a conta. */
export type UnidadeComAssinatura = {
  /** Quantas assinaturas do contrato já saíram. */
  assinadas: number;
  /** Todas as pessoas do contrato, na ordem da fila. */
  assinantes: LinhaAssinatura[];
  /** false enquanto algum comprador não assinou. */
  compradorAssinou: boolean;
  /** true quando não falta ninguém. */
  concluida: boolean;
  /** A ordem que está travando a fila agora. `null` = contrato completo. */
  degrau: null | number;
  /** Dias entre o envio e a última assinatura do comprador. */
  dias: null | number;
  /** Data em que o contrato saiu para assinatura. */
  envio: null | string;
  /** Quem está com a bola neste momento (nomes). */
  esperando: string[];
  /** Uma barra por perfil que assina este contrato, na ordem da fila. */
  grupos: GrupoDeAssinatura[];
  /** Nome dos compradores, separados por vírgula. */
  nomes: string;
  /** Os PERFIS parados agora — é por eles que o "Parado com" filtra. */
  perfisNaVez: string[];
  /** Total de assinaturas previstas no contrato. */
  total: number;
  /** Data da última assinatura do comprador. */
  ultima: null | string;
  un: string;
};

/**
 * Monta a lista de unidades com o andamento de cada contrato.
 *
 * ⚠️ ENTRA TODA UNIDADE, não só aquelas em que o comprador já assinou. O recorte antigo escondia
 * justamente as mais urgentes: quem está travado no comprador é o começo da fila, e some da visão.
 * O Lucas topou nisso em 25/08 filtrando pela VOC0305 — *"cadê a barrinha desse aí?"*. Quem quiser
 * só as que passaram do comprador usa `compradorAssinou`.
 *
 * ⚠️ O DEGRAU É O MENOR PENDENTE, não o maior nem o próximo na sequência. A fila da D4Sign é
 * ordenada: quem está no degrau 5 só é chamado quando TODOS os anteriores assinarem, então o menor
 * degrau ainda em aberto é o que trava o contrato inteiro atrás dele.
 *
 * ⚠️ `degrau || 99` MANDA QUEM NÃO TEM ORDEM PARA O FIM. Assinatura sem `after_position` vem com 0,
 * e 0 seria o menor de todos — o contrato apareceria travado numa ordem que não existe.
 */
export function agruparUnidadesDeAssinatura(
  porUnidade: Map<string, LinhaAssinatura[]>,
): UnidadeComAssinatura[] {
  const saida: UnidadeComAssinatura[] = [];

  for (const [un, linhas] of porUnidade) {
    const primeira = linhas[0];
    if (!primeira) continue;

    const compradores = linhas.filter((x) => x.perfil === "Comprador");
    const compradorAssinou = compradores.length > 0 && compradores.every((x) => x.assinou);

    const datas = compradores
      .map((x) => x.assinadoEm)
      .filter((d): d is string => Boolean(d))
      .sort();
    const ultima = compradorAssinou ? (datas[datas.length - 1] ?? null) : null;

    const pendentes = linhas.filter((x) => !x.assinou);
    const degrau = pendentes.length ? Math.min(...pendentes.map((x) => x.degrau || 99)) : null;
    const naVez = degrau === null ? [] : pendentes.filter((x) => (x.degrau || 99) === degrau);
    const perfisNaVez = [...new Set(naVez.map((x) => x.perfil))];

    // ── UMA BARRA POR PERFIL ────────────────────────────────────────────────
    // ⚠️ SÓ OS PERFIS DAQUELE CONTRATO desenham barra. Perfil que não assina ali não vira barra
    // vazia, porque barra vazia diz "falta alguém" de quem nunca foi chamado.
    const porPerfil = new Map<string, GrupoDeAssinatura>();
    for (const linha of linhas) {
      const atual = porPerfil.get(linha.perfil) ?? {
        assinadas: 0,
        naVez: false,
        ordem: 99,
        perfil: linha.perfil,
        total: 0,
      };
      atual.total += 1;
      if (linha.assinou) atual.assinadas += 1;
      // A barra fica na posição do PRIMEIRO degrau daquele perfil: é a ordem em que ele é chamado.
      atual.ordem = Math.min(atual.ordem, linha.degrau || 99);
      porPerfil.set(linha.perfil, atual);
    }
    for (const perfil of perfisNaVez) {
      const grupo = porPerfil.get(perfil);
      if (grupo) grupo.naVez = true;
    }

    saida.push({
      assinadas: linhas.filter((x) => x.assinou).length,
      // Na ordem da fila, com desempate pelo nome: a tabela do detalhe conta a história na
      // sequência em que as assinaturas acontecem, não na ordem que o banco devolveu.
      assinantes: [...linhas].sort(
        (a, b) =>
          (a.degrau || 99) - (b.degrau || 99) || a.usuario.localeCompare(b.usuario, "pt-BR"),
      ),
      compradorAssinou,
      concluida: degrau === null,
      degrau,
      dias: ultima
        ? Math.round(
            (new Date(ultima).getTime() - new Date(primeira.envio).getTime()) / 86_400_000,
          )
        : null,
      envio: primeira.envio,
      esperando: [...new Set(naVez.map((x) => x.usuario))],
      grupos: [...porPerfil.values()].sort(
        (a, b) => a.ordem - b.ordem || a.perfil.localeCompare(b.perfil, "pt-BR"),
      ),
      nomes: [...new Set(compradores.map((x) => x.usuario))].join(", "),
      perfisNaVez,
      // ⚠️ O DENOMINADOR É O CONTRATO INTEIRO, não só o que falta: "4 de 12" é a leitura que o
      // Lucas pediu com as barras.
      total: linhas.length,
      ultima,
      un,
    });
  }

  // ⚠️ O MAIS PARADO PRIMEIRO — é a ordem do perfil do incorporador ("Quem está mais atrasado
  // aparece primeiro"). Contrato completo vai para o fim: ele não pede nada de ninguém.
  return saida.sort((a, b) => {
    if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;
    return (a.envio ?? "").localeCompare(b.envio ?? "") || a.un.localeCompare(b.un, "pt-BR");
  });
}

/** Quantas unidades estão paradas em cada perfil — alimenta os filtros "Parado com". */
export function contarParadoPorPerfil(
  unidades: UnidadeComAssinatura[],
): { perfil: string; quantas: number }[] {
  const contagem = new Map<string, number>();
  for (const unidade of unidades) {
    if (unidade.concluida) continue;
    for (const perfil of unidade.perfisNaVez) {
      contagem.set(perfil, (contagem.get(perfil) ?? 0) + 1);
    }
  }
  return [...contagem.entries()]
    .map(([perfil, quantas]) => ({ perfil, quantas }))
    .sort((a, b) => b.quantas - a.quantas || a.perfil.localeCompare(b.perfil, "pt-BR"));
}
