import { createApoloAdminClient } from "@/lib/apolo/server";

import { documentosDoEmpreendimento } from "./documentos";
import { empreendimentoPorSlug } from "./empreendimentos";
import { dataDeVencimento, type ItemDoLote, type LotePreparado } from "./lote";

// A CARTEIRA DO MÊS, LIDA DO BANCO — o que a tela mostra sem ninguém escolher arquivo.
//
// Pedido do Lucas (01/09/2026): *"não quero importar planilha, já traz isso pronto"*.
//
// ⚠️ O NAVEGADOR NÃO MANDA MAIS VALOR NENHUM. Antes a tela lia a planilha e enviava as linhas para a
// rota, que reaplicava a regra por cima — defesa necessária, mas ainda assim um caminho em que o
// valor do boleto passava pelo lado do cliente. Agora a rota recebe só `competencia` e
// `empreendimento`; o resto ela busca. É menos código e uma superfície a menos.

export type ParcelaDoMes = {
  bloqueio: null | string;
  competencia: string;
  empreendimento: string;
  nome: string;
  /** O 9 de "parcela 9 de 36". Vem da coluna "Parc. Atual" da planilha. */
  parcelaAtual: null | number;
  /** O 36 de "parcela 9 de 36". Vem da coluna "Nº Parc.". */
  totalParcelas: null | number;
  unidade: string;
  valor: null | number;
  vencimentoDia: null | number;
};

type LinhaCrua = {
  bloqueio: null | string;
  competencia: string;
  empreendimento: string;
  nome: string;
  parcela_atual: null | number;
  total_parcelas: null | number;
  unidade: string;
  valor: null | number | string;
  vencimento_dia: null | number;
};

/**
 * As parcelas de uma competência, nos empreendimentos pedidos.
 *
 * ⚠️ `valor` VOLTA COMO STRING do PostgREST, porque a coluna é `numeric` — o driver não a converte
 * para `number` para não perder precisão. Um `.reduce((a, b) => a + b.valor)` sem esta conversão
 * concatena texto e devolve "1044.671520.92…" como total do mês.
 */
export async function parcelasDaCompetencia(input: {
  competencia: string;
  empreendimentos: string[];
}): Promise<ParcelaDoMes[]> {
  if (input.empreendimentos.length === 0) return [];

  const supabase = createApoloAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("boletos_parcelas")
    .select(
      "bloqueio, competencia, empreendimento, nome, parcela_atual, total_parcelas, unidade, valor, vencimento_dia",
    )
    .eq("workspace_id", "careli")
    .eq("competencia", input.competencia)
    .in("empreendimento", input.empreendimentos);

  if (error || !data) return [];

  return (data as LinhaCrua[]).map((l) => ({
    bloqueio: l.bloqueio,
    competencia: l.competencia,
    empreendimento: l.empreendimento,
    nome: l.nome,
    parcelaAtual: l.parcela_atual,
    totalParcelas: l.total_parcelas,
    unidade: String(l.unidade).trim(),
    valor: l.valor === null ? null : Number(l.valor),
    vencimentoDia: l.vencimento_dia,
  }));
}

/**
 * O lote pronto para emitir: cruza as parcelas com os documentos e separa quem fica de fora.
 *
 * ⚠️ A DECISÃO DE EMITIR JÁ ESTÁ NA COLUNA `bloqueio`, gravada pela carga com a MESMA regra que a
 * tela usa. Reavaliar a planilha aqui não faria sentido: o arquivo não está mais no caminho. O que
 * esta função ainda confere é o que muda entre a carga e o clique — CPF que sumiu do cadastro,
 * unidade sem dia de vencimento.
 */
export async function loteDaCompetencia(input: {
  competencia: string;
  empreendimento: string;
}): Promise<LotePreparado> {
  const [parcelas, documentos] = await Promise.all([
    parcelasDaCompetencia({
      competencia: input.competencia,
      empreendimentos: [input.empreendimento],
    }),
    documentosDoEmpreendimento(input.empreendimento),
  ]);

  const emp = empreendimentoPorSlug(input.empreendimento);
  const nomeDoEmpreendimento = emp?.nome ?? input.empreendimento;

  const itens: ItemDoLote[] = [];
  const fora: LotePreparado["fora"] = [];

  for (const p of parcelas) {
    if (p.bloqueio) {
      fora.push({ motivo: p.bloqueio, nome: p.nome, unidade: p.unidade });
      continue;
    }
    if (typeof p.valor !== "number" || !Number.isFinite(p.valor) || p.valor <= 0) {
      fora.push({ motivo: "sem valor para o mês", nome: p.nome, unidade: p.unidade });
      continue;
    }

    const cadastro = documentos.get(p.unidade);
    if (!cadastro) {
      fora.push({
        motivo: `sem CPF/CNPJ cadastrado para a unidade ${p.unidade}`,
        nome: p.nome,
        unidade: p.unidade,
      });
      continue;
    }

    const vencimento =
      p.vencimentoDia === null ? null : dataDeVencimento(input.competencia, p.vencimentoDia);
    if (!vencimento) {
      fora.push({ motivo: "sem dia de vencimento", nome: p.nome, unidade: p.unidade });
      continue;
    }

    const [ano, mes] = input.competencia.split("-");
    itens.push({
      contato: cadastro.contato,
      descricao: `${nomeDoEmpreendimento} - Unidade ${p.unidade} - Competência ${mes}/${ano}`,
      documento: cadastro.documento,
      // O nome do CADASTRO, não o da planilha: esta traz "VINICIUS FERREIRA ARAUJO - TAXA SELIC",
      // e o sufixo é recado interno sobre o índice de reajuste.
      nome: cadastro.nome,
      referencia: `boleto:${input.empreendimento}:${p.unidade.replace(/\s+/g, "-")}:${input.competencia}`,
      unidade: p.unidade,
      valor: p.valor,
      vencimento,
    });
  }

  // A ordem que a tela mostra e a ordem em que os boletos são criados: por vencimento, depois por
  // unidade. Sem isto a lista muda de ordem a cada carregamento e a conferência fica impossível.
  itens.sort(
    (a, b) =>
      a.vencimento.localeCompare(b.vencimento) ||
      a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }),
  );

  return { fora, itens };
}

/**
 * Os nomes que divergem entre a planilha e o cadastro, na mesma unidade.
 *
 * ⚠️ AVISA, NÃO IMPEDE. "Alison Dutra" x "ALISON DUTRA" é a mesma pessoa. Mas um nome completamente
 * outro na mesma unidade quer dizer que o imóvel trocou de dono, e o boleto sairia no CPF do antigo.
 */
export async function divergenciasDeNome(input: {
  competencia: string;
  empreendimento: string;
}): Promise<{ cadastro: string; planilha: string; unidade: string }[]> {
  const [parcelas, documentos] = await Promise.all([
    parcelasDaCompetencia({
      competencia: input.competencia,
      empreendimentos: [input.empreendimento],
    }),
    documentosDoEmpreendimento(input.empreendimento),
  ]);

  const achados: { cadastro: string; planilha: string; unidade: string }[] = [];
  for (const p of parcelas) {
    const cadastro = documentos.get(p.unidade);
    if (!cadastro) continue;
    if (primeiroNome(p.nome) !== primeiroNome(cadastro.nome)) {
      achados.push({ cadastro: cadastro.nome, planilha: p.nome, unidade: p.unidade });
    }
  }
  return achados;
}

function primeiroNome(nome: string): string {
  return (
    String(nome ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase()
      .split(/\s+/)[0] ?? ""
  );
}
