// O HISTÓRICO DA FICHA DO BOARD PELO PORTAL: quais edições saem e com que nome de autor.
//
// `historicoDaFicha` (lib/apolo/board-do-servidor.ts) lê `apolo_audit_events` da PESSOA, sem olhar
// empreendimento, e resolve o autor pelo `hub_users` (nome ou e-mail). Para o hub é o certo. Pelo
// portal, com o Cecílio passando pela porta do board (16/09/2026, *"eles meio que vão andar
// sozinhos sem o time administrativo da Careli"*), saíam duas coisas que não são dele:
//   • a edição da CAD da mesma pessoa em OUTRO loteamento, com o valor de antes e o de depois;
//   • o nome e o e-mail de quem da Careli mexeu na ficha.
//
// ⚠️ O HUB NÃO MUDA. A rota /api/apolo/board/[id]/historico chama `historicoDaFicha` sem filtro e
// recebe o mesmo de sempre. Só a rota do portal passa `filtroDoHistoricoDoPortal`.
import type { FiltroDoHistorico, LinhaAuditoria } from "@/lib/apolo/board-do-servidor";
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";

/** Como a equipe da Careli aparece para quem está do lado de fora. */
export const EQUIPE_CARELI = "Equipe Careli";

/**
 * O evento é de um empreendimento que a sessão alcança?
 *
 * ⚠️ SEM `metadata.enterpriseId`, NÃO, POR ESTA FUNÇÃO. Até 16/09/2026 nenhum `edit_ficha` gravava o
 * empreendimento, e o `edit_identity` do hub não grava (corrigir nome ou CPF é correção da PESSOA, em
 * todas as CADs dela; lib/apolo/identidade-persist.ts). O evento sem marca é decidido à parte, por
 * `eventoSemMarcaNoRecorte`, que só abre quando não há outro produto de onde ele possa ter vindo.
 */
export function eventoNoRecorte(
  metadata: LinhaAuditoria["metadata"],
  recorte: ReadonlySet<string>,
): boolean {
  const id = normalizarEnterpriseId(metadata?.enterpriseId);
  return id !== null && recorte.has(id);
}

function nomeNoMetadata(metadata: LinhaAuditoria["metadata"]): null | string {
  const nome = metadata?.autorNome;
  return typeof nome === "string" && nome.trim() ? nome.trim() : null;
}

/**
 * O autor como o portal mostra.
 *   • conta do HUB (está em `hub_users`): "Equipe Careli", nunca o nome nem o e-mail;
 *   • leitura das contas do hub falhou (`contasDoHub` nulo): todo autor com conta vira "Equipe
 *     Careli", porque não dá para provar que não é da casa;
 *   • conta de PORTAL: o nome que o próprio portal gravou em `metadata.autorNome` (o hub não grava
 *     esse campo: a rota do hub chama `salvarFichaDoBoard` sem nome);
 *   • conta desconhecida sem nome: traço, como no hub; sem conta nenhuma: "Sistema".
 *
 * ⚠️ O TESTE DE "É DO HUB" VEM ANTES DO NOME DO METADATA. Se um dia alguém passar a gravar
 * `autorNome` também pelo hub, o nome continua sem sair.
 */
export function autorNoPortal(
  linha: Pick<LinhaAuditoria, "actor_user_id" | "metadata">,
  contasDoHub: null | ReadonlySet<string>,
): string {
  const conta = linha.actor_user_id;
  if (conta && (contasDoHub === null || contasDoHub.has(conta))) return EQUIPE_CARELI;

  const nome = nomeNoMetadata(linha.metadata);
  if (nome) return nome;

  return conta ? "—" : "Sistema";
}

/** Nome comparável: sem acento, sem caixa, sem espaço repetido. */
function nomeComparavel(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A linha do tempo da UNIDADE (venda/historico) como o portal de incorporador recebe.
 *
 * (16/09/2026, revisão) ⚠️ O "QUEM" DO FUNIL É O TIME DA CARELI. `autor_nome` dos movimentos veio do
 * C2X (o nome do analista), e `etapa_por`, `cancelada_por_nome` e `criado_por_nome` são de quem mexeu
 * na venda. Antes só o comercial abria esta tela; com o Cecílio, os nomes da equipe iam para fora,
 * contra a regra que a onda já aplicou ao histórico do board, aos analistas e aos arquivos. Nos
 * eventos de ETAPA, o nome só fica quando é de uma conta DESTE portal (quem do próprio time agiu);
 * qualquer outro vira "Equipe Careli". Pagamento e assinatura ficam como estão: ali o `quem` é quem
 * pagou ou assinou, não quem operou.
 *
 * `nomesDoPortal` nulo = não deu para ler as contas, e todo nome de etapa vira "Equipe Careli".
 */
export function linhaDoTempoParaOPortal<T extends { quem: null | string; tipo: string }>(
  eventos: readonly T[],
  nomesDoPortal: null | ReadonlySet<string>,
): T[] {
  const conhecidos = new Set([...(nomesDoPortal ?? [])].map(nomeComparavel).filter(Boolean));
  return eventos.map((evento) => {
    if (evento.tipo !== "etapa" || !evento.quem?.trim()) return evento;
    if (conhecidos.has(nomeComparavel(evento.quem))) return evento;
    return { ...evento, quem: EQUIPE_CARELI };
  });
}

/**
 * O que a rota sabe da PESSOA, para decidir o evento que chegou SEM marca.
 *
 * `esteira` e `vinculos` são TODOS os empreendimentos dela (`lerEmpreendimentosDaPessoa`, a mesma
 * leitura da régua dos documentos); `imobiliaria` diz se ela entrou pela porta do vínculo de
 * imobiliária (`cadNoEscopo`).
 */
export type PessoaDoHistorico = {
  esteira: readonly string[];
  imobiliaria: boolean;
  vinculos: readonly string[];
};

/**
 * O evento SEM marca pode sair?
 *
 * (16/09/2026, revisão da onda) ⚠️ SEM ESTA METADE O HISTÓRICO FICAVA VAZIO, INCLUSIVE NO COMERCIAL.
 * Só o `edit_ficha` da CAD passou a gravar a marca; o `edit_identity`, a edição da ficha da
 * imobiliária (ramo sem esteira) e TODO o histórico anterior ao deploy não têm. O board da Gurgel,
 * no ar desde 02/09, perdia a história inteira e até a correção que o coordenador acabou de fazer.
 * A régua é a mesma dos documentos (documentos-do-portal.ts):
 *   • ficha da IMOBILIÁRIA sem esteira: é a mesma ficha para todo produto dela; sai;
 *   • pessoa com empreendimento conhecido e TODOS no recorte: o evento só pode ser deste produto;
 *     sai;
 *   • qualquer outra coisa (CAD em outro loteamento, pessoa sem empreendimento): fica fora.
 */
export function eventoSemMarcaNoRecorte(
  pessoa: PessoaDoHistorico,
  recorte: ReadonlySet<string>,
): boolean {
  if (pessoa.imobiliaria && pessoa.esteira.length === 0) return true;
  const daPessoa = new Set(
    [...pessoa.esteira, ...pessoa.vinculos]
      .map((id) => normalizarEnterpriseId(id))
      .filter((id): id is string => id !== null),
  );
  if (daPessoa.size === 0) return false;
  for (const id of daPessoa) if (!recorte.has(id)) return false;
  return true;
}

/**
 * O filtro do portal COMERCIAL (a Gurgel) para `historicoDaFicha`: a ficha inteira, com os nomes do
 * hub, menos o evento MARCADO com empreendimento fora do recorte (ver `filtroDoHistoricoDoPortal`).
 * O recorte que chega aqui já traz o espelho do pai, para a edição da CAD que mora no 35 continuar
 * aparecendo para quem vende o 37.
 */
export function filtroDoHistoricoDoComercial(recorte: ReadonlySet<string>): FiltroDoHistorico {
  return {
    // Sem `autor`: o nome sai como no hub (D4).
    manter: (linha) =>
      normalizarEnterpriseId(linha.metadata?.enterpriseId) === null ||
      eventoNoRecorte(linha.metadata, recorte),
  };
}

/**
 * O filtro que a rota do portal entrega para `historicoDaFicha`, para quem NÃO é o comercial.
 *
 * (16/09/2026, D4 do Lucas) ⚠️ O COMERCIAL TEM O PRÓPRIO FILTRO, `filtroDoHistoricoDoComercial`,
 * logo acima: a Gurgel voltou a ver os nomes dos analistas da Careli e a história inteira da ficha,
 * como antes da onda 1 (a rota dela chamava `historicoDaFicha` sem filtro). A única coisa que fica de fora para
 * ela é o evento MARCADO com empreendimento fora do recorte: a marca só existe desde 16/09, e é a
 * edição que o time de outro portal (a Cecílio, na ficha compartilhada da D5) fez no produto dele.
 *
 * Com `pessoa`, o evento sem marca passa pela inferência de `eventoSemMarcaNoRecorte`; sem ela, só
 * o evento marcado sai (o comportamento estrito da primeira versão). Evento MARCADO com empreendimento
 * fora do recorte nunca sai: a marca manda.
 */
export function filtroDoHistoricoDoPortal(
  recorte: ReadonlySet<string>,
  pessoa?: PessoaDoHistorico,
): Required<FiltroDoHistorico> {
  return {
    autor: (linha, contasDoHub) => autorNoPortal(linha, contasDoHub),
    manter: (linha) => {
      if (normalizarEnterpriseId(linha.metadata?.enterpriseId) !== null) {
        return eventoNoRecorte(linha.metadata, recorte);
      }
      return pessoa ? eventoSemMarcaNoRecorte(pessoa, recorte) : false;
    },
  };
}
