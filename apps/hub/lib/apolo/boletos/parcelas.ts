import { createApoloAdminClient } from "@/lib/apolo/server";

import { documentosDoEmpreendimento } from "./documentos";
import { empreendimentoPorSlug } from "./empreendimentos";
import { referenciaDaCobranca } from "./emissao";
import { rotuloDaParcela } from "./template-whatsapp";
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
  /**
   * A identidade da parcela do lado de fora: `Q10 L03`, ou `Q10 L03#2` quando a unidade tem mais de
   * uma cobrança no mês. Ver `chaveDaParcela`.
   */
  chave: string;
  competencia: string;
  empreendimento: string;
  nome: string;
  /** O 9 de "parcela 9 de 36". Vem da coluna "Parc. Atual" da planilha. */
  parcelaAtual: null | number;
  /**
   * O recado interno que distingue duas linhas da mesma unidade: "Mensal", "Entrada".
   *
   * ⚠️ NÃO SAI NO BOLETO NEM NO WHATSAPP. O que o cliente lê continua vindo de `rotuloDaParcela`.
   */
  rotulo: null | string;
  /**
   * Separa duas cobranças da MESMA unidade no MESMO mês. 1 = a única, ou a primeira.
   *
   * ⚠️ SEM SIGNIFICADO DE NEGÓCIO, de propósito — ver o cabeçalho da migration 0146.
   */
  sequencia: number;
  /** O 36 de "parcela 9 de 36". Vem da coluna "Nº Parc.". */
  totalParcelas: null | number;
  unidade: string;
  /**
   * A unidade identifica a cobranca, mas NAO pode ser dita ao cliente.
   *
   * O Garden foi renumerado e as duas fontes de conversao do lote discordam em nove casos -- na
   * quadra 7 sao cinco clientes deslocados um lote na mesma direcao. Decisao do Lucas (02/09/2026):
   * *"esses que estao com divergencia no lote deixa somente o nome do empreendimento, assim nao
   * corremos o risco de informar coisa errada"*. Marcada, a descricao sai sem o lote.
   */
  unidadeIncerta: boolean;
  valor: null | number;
  vencimentoDia: null | number;
  /** Quando o link foi mandado ao cliente. Nulo = não enviado, ou o envio falhou. */
  whatsappEnviadoEm: null | string;
  whatsappErro: null | string;
};

type LinhaCrua = {
  bloqueio: null | string;
  competencia: string;
  empreendimento: string;
  nome: string;
  parcela_atual: null | number;
  rotulo: null | string;
  sequencia: null | number;
  total_parcelas: null | number;
  unidade: string;
  unidade_incerta: boolean | null;
  valor: null | number | string;
  vencimento_dia: null | number;
  whatsapp_enviado_em: null | string;
  whatsapp_erro: null | string;
};

/**
 * A identidade de uma parcela do lado de fora do banco: a tela, o corpo das rotas e a referência da
 * cobrança no Asaas.
 *
 * `Q10 L03` para a mensal; `Q10 L03#2` para a entrada que vence no mesmo mês, na mesma unidade.
 *
 * ⚠️ A SEQUÊNCIA 1 NÃO APARECE, E É ISSO QUE MANTÉM O PASSADO VÁLIDO. As 4.094 linhas já gravadas
 * nascem com `sequencia = 1` pelo DEFAULT da 0146, então continuam se chamando `Q10 L03`: a seleção
 * da tela, o `unidades: [...]` do POST e as referências das cobranças já emitidas no Asaas não
 * mudam para nenhuma delas. Só a segunda cobrança da mesma unidade ganha sufixo.
 *
 * ⚠️ O `#` NÃO EXISTE EM NENHUMA UNIDADE. Medido em 08/09/2026: 0 de 4.094 linhas de
 * `boletos_parcelas` e 0 de 343 de `boletos_documentos` têm `#` ou `:` na unidade — as grafias são
 * `Q10 L03`, `307`, `00000430`. Se um dia tiverem, a leitura abaixo parte a chave no lugar errado.
 */
export function chaveDaParcela(input: { sequencia?: null | number; unidade: string }): string {
  const unidade = String(input.unidade ?? "").trim();
  const sequencia = Number(input.sequencia ?? 1);
  return Number.isInteger(sequencia) && sequencia > 1 ? `${unidade}#${sequencia}` : unidade;
}

/**
 * A chave de volta em unidade e sequência.
 *
 * ⚠️ O QUE NÃO FOR CHAVE VOLTA COMO SEQUÊNCIA 1, e não como erro. Quem chama a rota direto manda a
 * unidade crua (`Q10 L03`), e é isso que ela sempre significou: a primeira cobrança da unidade.
 */
export function lerChaveDaParcela(chave: string): { sequencia: number; unidade: string } {
  const texto = String(chave ?? "").trim();
  const corte = texto.lastIndexOf("#");
  if (corte <= 0) return { sequencia: 1, unidade: texto };
  const sequencia = Number(texto.slice(corte + 1));
  if (!Number.isInteger(sequencia) || sequencia < 1) return { sequencia: 1, unidade: texto };
  return { sequencia, unidade: texto.slice(0, corte).trim() };
}

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
      "bloqueio, competencia, empreendimento, nome, parcela_atual, rotulo, sequencia, total_parcelas, unidade, unidade_incerta, valor, vencimento_dia, whatsapp_enviado_em, whatsapp_erro",
    )
    .eq("workspace_id", "careli")
    .eq("competencia", input.competencia)
    .in("empreendimento", input.empreendimentos);

  if (error || !data) return [];

  return (data as LinhaCrua[])
    .map((l) => {
      const unidade = String(l.unidade).trim();
      const sequencia = Number(l.sequencia ?? 1) || 1;
      return {
        bloqueio: l.bloqueio,
        chave: chaveDaParcela({ sequencia, unidade }),
        competencia: l.competencia,
        empreendimento: l.empreendimento,
        nome: l.nome,
        parcelaAtual: l.parcela_atual,
        rotulo: l.rotulo,
        sequencia,
        totalParcelas: l.total_parcelas,
        unidade,
        unidadeIncerta: l.unidade_incerta === true,
        valor: l.valor === null ? null : Number(l.valor),
        vencimentoDia: l.vencimento_dia,
        whatsappEnviadoEm: l.whatsapp_enviado_em,
        whatsappErro: l.whatsapp_erro,
      };
    })
    // ⚠️ ORDEM ESTÁVEL, E A SEQUÊNCIA DESEMPATA. Duas linhas na mesma unidade voltariam do
    // PostgREST em ordem qualquer; sem isto, "a mensal" e "a entrada" trocam de lugar entre dois
    // carregamentos e a conferência do operador não fecha.
    .sort(
      (a, b) =>
        a.empreendimento.localeCompare(b.empreendimento) ||
        a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }) ||
        a.sequencia - b.sequencia,
    );
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

    itens.push({
      chave: p.chave,
      contato: cadastro.contato,
      // A unidade some da descricao quando nao se pode garantir qual e -- `unidadeIncerta`. A
      // `referencia` abaixo mantem a unidade: ela e interna, e e por ela que a cobranca e achada.
      // ⚠️ A DESCRIÇÃO DIZ A PARCELA, E COM O MESMO TEXTO DA MENSAGEM. Pedido do Lucas
      // (02/09/2026): *"no boleto na descrição tem que ir a parcela também"*, *"igual a mensagem no
      // celular"*. É o que o cliente lê no boleto e no WhatsApp, e os dois discordarem sobre qual
      // parcela é abre exatamente a dúvida que a cobrança precisa não abrir. Por isso o rótulo sai
      // de `rotuloDaParcela`, o mesmo que monta o `{{4}}` do template: quando a contagem da
      // planilha não fecha (o Ed. Cristal 201 tem "parcela 7 de 5"), os dois caem para a
      // competência juntos.
      // ⚠️ A UNIDADE SAIU DA DESCRIÇÃO TAMBÉM, e pelo mesmo motivo da mensagem: são erros de
      // cadastro que aparecem todo dia, e o boleto é o documento que o cliente guarda. A cobrança
      // continua identificada pela unidade na `referencia` — o que muda é só o que se afirma a ele.
      descricao: [
        nomeDoEmpreendimento,
        rotuloDaParcela({
          atual: p.parcelaAtual,
          competencia: input.competencia,
          total: p.totalParcelas,
        }),
      ]
        .filter(Boolean)
        .join(" - "),
      documento: cadastro.documento,
      // O nome do CADASTRO, não o da planilha: esta traz "VINICIUS FERREIRA ARAUJO - TAXA SELIC",
      // e o sufixo é recado interno sobre o índice de reajuste.
      nome: cadastro.nome,
      // ⚠️ A SEQUÊNCIA ENTRA NA REFERÊNCIA, E SÓ A PARTIR DA SEGUNDA. É por `externalReference` que
      // a rodada seguinte descobre que o boleto já existe (`cobrancasDaReferencia`, igualdade
      // exata). Sem ela, a entrada do Lucas Aguiar teria a MESMA referência da mensal: a consulta
      // acharia a mensal, diria "já existe" e a entrada nunca sairia. Mantendo a sequência 1 sem
      // sufixo, as cobranças já emitidas continuam casando.
      referencia: referenciaDaCobranca({
        competencia: input.competencia,
        empreendimento: input.empreendimento,
        sequencia: p.sequencia,
        unidade: p.unidade,
      }),
      sequencia: p.sequencia,
      unidade: p.unidade,
      valor: p.valor,
      vencimento,
    });
  }

  // A ordem que a tela mostra e a ordem em que os boletos são criados: por vencimento, depois por
  // unidade. Sem isto a lista muda de ordem a cada carregamento e a conferência fica impossível.
  // A sequência desempata as duas cobranças da mesma unidade que vencem no mesmo dia.
  itens.sort(
    (a, b) =>
      a.vencimento.localeCompare(b.vencimento) ||
      a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }) ||
      a.sequencia - b.sequencia,
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
  // ⚠️ UM AVISO POR UNIDADE, E NÃO POR PARCELA. O cadastro é da unidade: com duas cobranças na
  // mesma unidade (a mensal e a entrada do Lucas Aguiar), a mesma divergência sairia duas vezes, e
  // um aviso repetido faz o operador contar dois problemas onde há um.
  const jaAvisadas = new Set<string>();
  for (const p of parcelas) {
    const cadastro = documentos.get(p.unidade);
    if (!cadastro) continue;
    if (jaAvisadas.has(p.unidade)) continue;
    if (primeiroNome(p.nome) !== primeiroNome(cadastro.nome)) {
      jaAvisadas.add(p.unidade);
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
