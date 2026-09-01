import { empreendimentoPorSlug } from "./empreendimentos";
import { type LinhaDaPlanilha, vereditoDaLinha } from "./regra-de-emissao";

// O LOTE DE UM MÊS — o que sai da planilha e vira boleto, conferido ANTES de tocar no Asaas.
//
// ⚠️ ESTE ARQUIVO RODA NO SERVIDOR E REFAZ A CONTA DO NAVEGADOR. A tela lê o arquivo no cliente e
// já mostra quem emite; mandar essa decisão pronta para a rota seria deixar o valor do boleto ser
// escolhido pelo lado que o operador consegue editar. A rota recebe a LINHA como ela está na
// planilha e aplica a mesma regra de novo — quem manda no que é emitido é o servidor.
//
// ⚠️ O ASAAS NÃO DESFAZ EMISSÃO EM LOTE. Cancelar é uma chamada por cobrança e o cliente já pode
// ter recebido; por isso tudo que dá para conferir é conferido aqui, com o lote inteiro na mão e
// nada criado ainda.

export type LinhaParaEmitir = LinhaDaPlanilha & {
  unidade: null | string;
  /** O dia do vencimento como a planilha escreve: 5, 10, 15, 20, 24, 25, 30. */
  vencimento: null | number;
};

export type ItemDoLote = {
  /** O CPF/CNPJ, só dígitos, vindo de `boletos_documentos`. */
  documento: string;
  nome: string;
  /** A descrição que vai no boleto e separa as carteiras no extrato da conta. */
  descricao: string;
  referencia: string;
  unidade: string;
  valor: number;
  /** `2026-09-15`. */
  vencimento: string;
  contato: null | string;
};

export type ItemDeFora = {
  motivo: string;
  nome: string;
  unidade: null | string;
};

export type LotePreparado = {
  fora: ItemDeFora[];
  itens: ItemDoLote[];
};

/**
 * A data de vencimento da parcela, a partir do dia que a planilha traz.
 *
 * ⚠️ NEM TODO MÊS TEM O DIA. A IZALTINA (Ed. Jade, apto 202) vence dia 30: existe em setembro, não
 * existe em fevereiro. Montar `2026-02-30` faz o Asaas recusar a cobrança inteira — e, pior, um
 * `new Date("2026-02-30")` em JavaScript escorrega sozinho para 2 de março, emitindo silenciosamente
 * com a data errada. Aqui o dia é preso ao último do mês, que é o que o administrativo faz à mão.
 */
export function dataDeVencimento(competencia: string, dia: number): null | string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia.trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  if (!Number.isFinite(dia) || dia < 1) return null;

  // Dia 0 do mês seguinte = último dia deste mês. Em UTC, porque `getDate()` no fuso do Brasil
  // devolveria o dia anterior — ver [[reference_exceljs_duas_armadilhas]].
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const escolhido = Math.min(Math.trunc(dia), ultimo);
  return `${m[1]}-${m[2]}-${String(escolhido).padStart(2, "0")}`;
}

/** `2026-09` → `boleto:ed-rubi:401:2026-09`, com a unidade sem espaço. */
function referencia(empreendimento: string, unidade: string, competencia: string): string {
  return `boleto:${empreendimento}:${unidade.trim().replace(/\s+/g, "-")}:${competencia}`;
}

/** `Ed. Rubi - Unidade 401 - Competência 09/2026`. */
function descricao(nome: string, unidade: string, competencia: string): string {
  const [ano, mes] = competencia.split("-");
  const alvo = unidade.trim();
  return [nome, alvo ? `Unidade ${alvo}` : null, `Competência ${mes}/${ano}`]
    .filter(Boolean)
    .join(" - ");
}

/**
 * Monta o lote: cruza as linhas da planilha com os documentos e separa quem fica de fora.
 *
 * ⚠️ QUEM NÃO TEM DOCUMENTO NÃO ENTRA, E APARECE NA LISTA DE FORA. O Asaas recusa criar cliente sem
 * CPF/CNPJ; descobrir isso no meio da emissão deixa metade do lote criado e a outra metade não, e
 * repetir a rodada duplicaria a primeira metade.
 *
 * ⚠️ A CHAVE É A UNIDADE, e não o nome: o MARCELO SALDANHA NUNES aparece duas vezes no Ed. Rubi
 * (aptos 202 e 302) com o mesmo CPF e valores diferentes. Casar por nome daria o valor de um
 * apartamento aos dois.
 */
export function prepararLote(input: {
  competencia: string;
  /** `unidade` → documento, como está em `boletos_documentos`. */
  documentos: Map<string, { contato: null | string; documento: string; nome: string }>;
  empreendimento: string;
  linhas: LinhaParaEmitir[];
}): LotePreparado {
  const emp = empreendimentoPorSlug(input.empreendimento);
  const nomeDoEmpreendimento = emp?.nome ?? input.empreendimento;

  const itens: ItemDoLote[] = [];
  const fora: ItemDeFora[] = [];

  for (const linha of input.linhas) {
    const veredito = vereditoDaLinha(linha);
    if (!veredito.emite) {
      fora.push({ motivo: veredito.explicacao, nome: linha.nome, unidade: linha.unidade });
      continue;
    }

    const unidade = (linha.unidade ?? "").trim();
    if (!unidade) {
      fora.push({
        motivo: "sem unidade na planilha — é ela que identifica a cobrança",
        nome: linha.nome,
        unidade: null,
      });
      continue;
    }

    const cadastro = input.documentos.get(unidade);
    if (!cadastro) {
      fora.push({
        motivo: `sem CPF/CNPJ cadastrado para a unidade ${unidade}`,
        nome: linha.nome,
        unidade,
      });
      continue;
    }

    const vencimento =
      linha.vencimento === null ? null : dataDeVencimento(input.competencia, linha.vencimento);
    if (!vencimento) {
      fora.push({
        motivo: "sem dia de vencimento na planilha",
        nome: linha.nome,
        unidade,
      });
      continue;
    }

    itens.push({
      contato: cadastro.contato,
      descricao: descricao(nomeDoEmpreendimento, unidade, input.competencia),
      documento: cadastro.documento,
      // ⚠️ O NOME QUE VAI PARA O ASAAS É O DO CADASTRO, não o da planilha. A planilha escreve
      // "VINICIUS FERREIRA ARAUJO - TAXA SELIC" — o sufixo é recado interno sobre o índice de
      // reajuste, e sairia impresso no boleto do cliente.
      nome: cadastro.nome,
      referencia: referencia(input.empreendimento, unidade, input.competencia),
      unidade,
      valor: veredito.valor,
      vencimento,
    });
  }

  return { fora, itens };
}

/**
 * O nome divergiu entre a planilha e o cadastro?
 *
 * ⚠️ NÃO IMPEDE A EMISSÃO, AVISA. A unidade é a chave, e nome é grafia: "Alison Dutra" x "ALISON
 * DUTRA" é a mesma pessoa. Mas se a planilha trouxer um nome completamente outro na mesma unidade,
 * o imóvel trocou de dono e o boleto sairia no CPF do antigo — e isso ninguém vê no total.
 */
export function nomesDivergentes(
  linhas: LinhaParaEmitir[],
  documentos: Map<string, { nome: string }>,
): { cadastro: string; planilha: string; unidade: string }[] {
  const achados: { cadastro: string; planilha: string; unidade: string }[] = [];
  for (const linha of linhas) {
    const unidade = (linha.unidade ?? "").trim();
    const cadastro = unidade ? documentos.get(unidade) : undefined;
    if (!cadastro) continue;
    if (primeiroNome(linha.nome) !== primeiroNome(cadastro.nome)) {
      achados.push({ cadastro: cadastro.nome, planilha: linha.nome, unidade });
    }
  }
  return achados;
}

function primeiroNome(nome: string): string {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .split(/\s+/)[0] ?? "";
}
