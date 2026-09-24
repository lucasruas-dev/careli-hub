import { type LinhaDaTrilha, type ParcelaNova, planejarReligamentoDaTrilha } from "./religar-trilha";

// A CARGA VAI DESFAZER ALGUMA COISA QUE O TIME FEZ NA TELA?
//
// Decisão do Lucas (19/08/2026), registrada na memória do LSoft: a carga do Access foi ÚNICA, e dali
// em diante o banco do Panteon é a verdade. Por isso a tela deixa editar vencimento, valor e baixa.
// Recarregar um empreendimento que o time já trabalhou contraria essa decisão: a carga apaga a
// parcela editada e grava a do Access, que pode não ter a edição. A trilha sobrevive (0188), mas o
// VALOR da baixa, não. A parcela volta em aberto e a trilha religada diz "paga".
//
// Esta função responde ANTES de gravar: para cada parcela que o time editou, o que a carga nova
// traria no lugar. Onde o valor diverge, a carga desfaria a edição. Onde a parcela nem casa, a
// edição ficaria sem parcela.
//
// ⚠️ PARA EMPREENDIMENTO NOVO ELA DEVOLVE ZERO, e é isso que a torna uma trava e não um obstáculo:
// não existe edição do time em Giant Towers ou On Sky, então a carga deles passa. Ela só segura a
// recarga de Garden, Vale do Sol e Vale do Ouro por cima do trabalho feito.
//
// ⚠️ SÓ OLHA OS EMPREENDIMENTOS DA CARGA. Desde 24/09 a carga só substitui os empreendimentos que
// vieram nela (carga.ts); a edição de um empreendimento que ficou de fora não corre risco.

/** Uma linha da trilha, com o que ela mudou. */
export type EdicaoDaTrilha = LinhaDaTrilha & {
  campo: string;
  criado_em: string;
  parcela_rotulo: null | string;
  valor_novo: null | string;
};

/** A parcela como a carga nova vai gravar, com os campos que a tela edita. */
export type ParcelaDaCarga = ParcelaNova & {
  data_recebido: null | string;
  lote?: null | string;
  paga: boolean;
  quadra?: null | string;
  valor_recebido: number | string;
};

export type Divergencia = {
  campo: string;
  cliente_codigo: string;
  /** O que o time deixou na tela. */
  naTela: null | string;
  /** O que a carga vai gravar no lugar. */
  naCarga: null | string;
  parcela_rotulo: null | string;
};

export type EdicaoSemParcela = {
  campos: string[];
  cliente_codigo: string;
  parcela_rotulo: null | string;
};

export type ResultadoDaDivergencia = {
  /** Edições que a carga desfaria: a parcela casa, mas o valor que vem é outro. */
  divergencias: Divergencia[];
  /** Edições cuja parcela não casa com nada da carga nova. */
  semParcela: EdicaoSemParcela[];
  /** Quantas parcelas editadas a checagem olhou. */
  parcelasEditadas: number;
};

const texto = (v: unknown): null | string => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};
const dinheiro = (v: unknown): null | string => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : texto(v);
};

/**
 * O valor do campo, do jeito que a trilha o grava, para comparar com a parcela nova.
 *
 * ⚠️ A TRILHA GRAVA `paga` COMO "paga" / "em aberto" (carteira.ts), não como booleano; e dinheiro
 * com duas casas. A comparação tem de usar a MESMA forma dos dois lados, senão toda linha diverge.
 */
function daParcela(campo: string, p: ParcelaDaCarga): null | string {
  switch (campo) {
    case "parcela.paga":
      return p.paga ? "paga" : "em aberto";
    case "parcela.valor":
      return dinheiro(p.valor);
    case "parcela.valor_recebido":
      return dinheiro(p.valor_recebido);
    case "parcela.data_recebido":
      return texto(p.data_recebido);
    case "parcela.vencimento":
      return texto(p.vencimento);
    case "parcela.observacoes":
      return texto(p.observacoes);
    case "parcela.parcela":
      return texto(p.parcela);
    case "parcela.lote":
      return texto(p.lote);
    case "parcela.quadra":
      return texto(p.quadra);
    case "parcela.empreendimento":
      return texto(p.empreendimento);
    default:
      return null;
  }
}

function normalizar(campo: string, v: null | string): null | string {
  if (campo === "parcela.valor" || campo === "parcela.valor_recebido") return dinheiro(v);
  return texto(v);
}

export function divergenciasDaCarga(trilha: EdicaoDaTrilha[], novas: ParcelaDaCarga[]): ResultadoDaDivergencia {
  // O estado que a carga deixa: toda trilha sem parcela, prestes a ser religada às novas.
  const semVinculo = trilha.filter((l) => l.impressao_digital).map((l) => ({ ...l, parcela_id: null }));
  const plano = planejarReligamentoDaTrilha(semVinculo, novas);

  const porId = new Map(novas.map((p) => [p.id, p]));
  const destino = new Map(plano.atualizacoes.map((u) => [u.id, u.parcela_id]));

  // Agrupa as edições por parcela ANTIGA (a mesma digital e o mesmo retrato), e dentro de cada
  // grupo fica a ÚLTIMA edição de cada campo: é ela que está na tela hoje.
  type Grupo = { linhas: EdicaoDaTrilha[]; ultimaPorCampo: Map<string, EdicaoDaTrilha> };
  const grupos = new Map<string, Grupo>();
  for (const l of semVinculo) {
    const chave = [l.impressao_digital, l.ordinal ?? 1, l.cliente_codigo, l.vencimento_no_momento, dinheiro(l.valor_no_momento)].join("¦");
    const g: Grupo = grupos.get(chave) ?? { linhas: [], ultimaPorCampo: new Map() };
    g.linhas.push(l);
    const atual = g.ultimaPorCampo.get(l.campo);
    if (!atual || l.criado_em > atual.criado_em) g.ultimaPorCampo.set(l.campo, l);
    grupos.set(chave, g);
  }

  const resultado: ResultadoDaDivergencia = { divergencias: [], parcelasEditadas: grupos.size, semParcela: [] };

  for (const g of grupos.values()) {
    const primeira = g.linhas[0];
    if (!primeira) continue;
    const idNovo = destino.get(primeira.id);
    const nova = idNovo ? porId.get(idNovo) : undefined;

    if (!nova) {
      resultado.semParcela.push({
        campos: [...g.ultimaPorCampo.keys()].sort(),
        cliente_codigo: primeira.cliente_codigo,
        parcela_rotulo: primeira.parcela_rotulo,
      });
      continue;
    }

    for (const [campo, ultima] of g.ultimaPorCampo) {
      const naTela = normalizar(campo, ultima.valor_novo);
      const naCarga = daParcela(campo, nova);
      if (naTela !== naCarga) {
        resultado.divergencias.push({
          campo,
          cliente_codigo: primeira.cliente_codigo,
          naCarga,
          naTela,
          parcela_rotulo: primeira.parcela_rotulo,
        });
      }
    }
  }

  return resultado;
}
