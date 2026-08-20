// IMPORTAÇÃO DE UNIDADES PARA O C2X — as regras puras (sem rede, sem banco).
//
// Pedido do Lucas (20/08/2026): *"cria para mim dentro do setup do Panteon uma tela para importar
// unidades dentro do C2X... o operador possa subir uma tabela (aí define o arquivo padrão) os
// campos necessários, para que a pessoa possa importar"*. E: *"os status possíveis (disponível,
// bloqueado) mapeia tudo"*.
//
// ⚠️ CRIAR UNIDADE NÃO TEM DESFAZER. O C2X não expõe exclusão por esta API, e uma unidade errada
// vira contrato errado lá na frente. Por isso tudo aqui é desenhado para RECUSAR antes de enviar:
// a conferência é obrigatória, o envio é um segundo passo explícito, e qualquer linha duvidosa
// bloqueia a linha, nunca "passa com o que deu".
//
// ⚠️ O EMPREENDIMENTO NÃO VEM NA PLANILHA, e isso é deliberado. É a escolha mais perigosa do
// processo (subir 300 lotes no empreendimento errado), então ela é feita UMA vez, na tela, com o
// nome por extenso à vista — e não repetida em 300 linhas onde um replace errado passa batido.

/** Os `sale_statuses` do C2X, conferidos em 20/08/2026. */
export const STATUS_DO_C2X = [
  { id: 1, nome: "Disponível" },
  { id: 2, nome: "Reservado" },
  { id: 3, nome: "Em negociação" },
  { id: 4, nome: "Vendido" },
  { id: 5, nome: "Bloqueado para venda" },
] as const;

/** Os `enterprise_unity_types`. São só dois. */
export const TIPOS_DO_C2X = [
  { id: 1, nome: "Unidade interna" },
  { id: 2, nome: "Unidade externa" },
] as const;

/**
 * O que o operador pode escrever na coluna `status`, e no que isso vira.
 *
 * ⚠️ `sale_blocked` ANDA JUNTO E NÃO É OPCIONAL. No C2X os dois campos existem em paralelo, e a
 * carteira tem 882 unidades com status "Disponível" E o flag de bloqueio ligado — combinação que
 * a tela de Vendas mostra como bloqueada e que ninguém consegue explicar de cabeça. Deixar o flag
 * a cargo de quem preenche a planilha produziria mais linhas assim; aqui cada rótulo já define os
 * DOIS campos, de forma que "Bloqueado" signifique uma coisa só.
 *
 * As grafias sem acento entram porque planilha vem de todo lugar, e recusar "disponivel" por causa
 * de um acento é criar trabalho sem proteger ninguém.
 */
const STATUS_ACEITOS: Record<string, { saleBlocked: 0 | 1; statusId: number }> = {
  "a venda": { saleBlocked: 0, statusId: 1 },
  bloqueada: { saleBlocked: 1, statusId: 5 },
  bloqueado: { saleBlocked: 1, statusId: 5 },
  "bloqueado para venda": { saleBlocked: 1, statusId: 5 },
  disponivel: { saleBlocked: 0, statusId: 1 },
  "em negociacao": { saleBlocked: 0, statusId: 3 },
  livre: { saleBlocked: 0, statusId: 1 },
  negociacao: { saleBlocked: 0, statusId: 3 },
  reservada: { saleBlocked: 0, statusId: 2 },
  reservado: { saleBlocked: 0, statusId: 2 },
  vendida: { saleBlocked: 0, statusId: 4 },
  vendido: { saleBlocked: 0, statusId: 4 },
};

const TIPOS_ACEITOS: Record<string, number> = {
  externa: 2,
  interna: 1,
  "unidade externa": 2,
  "unidade interna": 1,
};

/**
 * Os status que fazem sentido numa unidade NOVA.
 *
 * Vendido, Reservado e Em negociação dependem de uma PROPOSTA que ainda não existe — importar uma
 * unidade já vendida cria um lote que a tela de Vendas conta como vendido sem contrato nenhum por
 * trás, e o número passa a mentir. A planilha aceita, a conferência avisa, e a decisão fica com
 * quem está olhando.
 */
const STATUS_ESPERADOS_EM_UNIDADE_NOVA = new Set([1, 5]);

/** A coluna, o que ela quer dizer e se pode faltar. */
export const COLUNAS_DA_PLANILHA = [
  { chave: "quadra", exemplo: "01", obrigatoria: true, rotulo: "Quadra" },
  { chave: "lote", exemplo: "07", obrigatoria: true, rotulo: "Lote" },
  { chave: "area", exemplo: "1000,00", obrigatoria: true, rotulo: "Área (m²)" },
  { chave: "valor", exemplo: "140401,00", obrigatoria: false, rotulo: "Valor (R$)" },
  { chave: "matricula", exemplo: "25.862", obrigatoria: false, rotulo: "Matrícula" },
  { chave: "status", exemplo: "Disponível", obrigatoria: false, rotulo: "Status" },
  { chave: "tipo", exemplo: "Unidade interna", obrigatoria: false, rotulo: "Tipo" },
] as const;

export type LinhaDaPlanilha = Record<string, unknown>;

export type UnidadeParaImportar = {
  area: number;
  linha: number;
  lote: string;
  matricula: null | string;
  quadra: string;
  saleBlocked: 0 | 1;
  statusId: number;
  statusRotulo: string;
  tipoId: number;
  valor: number;
};

export type ProblemaDaLinha = {
  campo: string;
  linha: number;
  motivo: string;
  /** `true` quando é só um alerta: a linha sobe, mas alguém precisa olhar. */
  soAviso?: boolean;
  valor: string;
};

/** Texto limpo, ou null. */
function texto(valor: unknown): null | string {
  const t = String(valor ?? "").trim();
  return t === "" ? null : t;
}

/** Chave de comparação: sem acento, minúscula, espaços colapsados. */
export function normalizar(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Número em português para número de verdade.
 *
 * ⚠️ "1.002,00" É MIL E DOIS, NÃO UM VÍRGULA ZERO ZERO DOIS. Passar isso direto para `Number()`
 * devolve `NaN` no melhor caso e um valor mil vezes menor no pior — e um lote de R$ 140.401
 * viraria R$ 140,401 sem nada acusar. Excel também devolve número puro quando a célula é
 * numérica, então os dois caminhos precisam funcionar.
 */
export function numeroBR(valor: unknown): null | number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;

  const cru = texto(valor);
  if (!cru) return null;

  // Tira "R$", "m²", espaços e qualquer coisa que não seja dígito, vírgula, ponto ou sinal.
  const limpo = cru.replace(/[^\d,.-]/g, "");
  if (!limpo) return null;

  // Com vírgula, ela é o decimal e o ponto é separador de milhar (padrão BR).
  // Sem vírgula, o ponto pode ser milhar ("1.000") ou decimal ("1000.5"): só é decimal quando
  // sobram 1 ou 2 casas depois dele.
  const temVirgula = limpo.includes(",");
  let normalizado: string;

  if (temVirgula) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = limpo.split(".");
    normalizado =
      partes.length > 1 && (partes.at(-1) as string).length <= 2 ? limpo : limpo.replace(/\./g, "");
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Quadra e lote com dois dígitos.
 *
 * ⚠️ O C2X GUARDA "01" E A PLANILHA TRAZ "1". Sem normalizar os dois lados, a conferência de
 * duplicidade não acha o que já existe e a importação cria tudo de novo, em duplicidade — foi o
 * cuidado que o script de linha de comando já tomava, e que não pode se perder aqui.
 *
 * Quadra com letra (a Lagoa Bonita usa "C01") passa intacta, só em caixa alta.
 */
export function doisDigitos(valor: unknown): string {
  const t = texto(valor);
  if (!t) return "";
  return /^\d+$/.test(t) ? t.padStart(2, "0") : t.toUpperCase();
}

/** Como o C2X nomeia a unidade: prefixo do empreendimento + quadra + lote, sem separador. */
export function nomeDaUnidade(prefixo: string, quadra: unknown, lote: unknown): string {
  return `${prefixo.trim().toUpperCase()}${doisDigitos(quadra)}${doisDigitos(lote)}`;
}

export type Conferencia = {
  problemas: ProblemaDaLinha[];
  /** Linhas prontas para subir. */
  unidades: UnidadeParaImportar[];
};

/**
 * Lê as linhas da planilha e devolve o que sobe e o que trava.
 *
 * ⚠️ UMA LINHA COM PROBLEMA NÃO SOBE, e o resto sobe. Recusar a planilha inteira por causa de uma
 * célula obrigaria o operador a caçar a linha ruim no escuro; deixar a linha ruim passar com valor
 * chutado cria unidade errada, que não tem desfazer. O meio-termo é este: a linha sai da lista e
 * aparece nomeada no relatório.
 */
export function conferirPlanilha(linhas: LinhaDaPlanilha[]): Conferencia {
  const problemas: ProblemaDaLinha[] = [];
  const unidades: UnidadeParaImportar[] = [];
  const vistas = new Map<string, number>();

  linhas.forEach((bruta, indice) => {
    // +2: a linha 1 é o cabeçalho, e o operador conta a partir de 1 na tela do Excel.
    const linha = indice + 2;
    const erro = (campo: string, motivo: string, valor: unknown) => {
      problemas.push({ campo, linha, motivo, valor: String(valor ?? "") });
    };

    const quadra = doisDigitos(bruta.quadra);
    const lote = doisDigitos(bruta.lote);
    const area = numeroBR(bruta.area);
    const valor = numeroBR(bruta.valor);

    let temErro = false;

    if (!quadra) {
      erro("quadra", "Quadra em branco.", bruta.quadra);
      temErro = true;
    }
    if (!lote) {
      erro("lote", "Lote em branco.", bruta.lote);
      temErro = true;
    }
    if (area === null || area <= 0) {
      erro("area", "Área precisa ser um número maior que zero.", bruta.area);
      temErro = true;
    }
    // ⚠️ O VALOR PODE FALTAR, e isso é uma decisão de produto (Lucas, 20/08/2026: *"vou testar
    // depois, pois eu ainda não tenho o valor dessas matrículas"*). O caso real é ter a matrícula,
    // a quadra, o lote e a metragem em mãos — vindos do cartório — e o preço só semanas depois.
    // Exigir o valor aqui obrigaria a inventar um número para poder cadastrar, e número inventado
    // em campo de preço é pior que campo vazio: ele entra no VGV e ninguém desconfia.
    //
    // Preenchido, continua tendo que ser um número de verdade: "a combinar" segue travando.
    const valorVazio = texto(bruta.valor) === null;
    if (!valorVazio && (valor === null || valor <= 0)) {
      erro("valor", "Valor precisa ser um número maior que zero, ou ficar em branco.", bruta.valor);
      temErro = true;
    }

    // Status: em branco vira Disponível, que é o estado de uma unidade recém-cadastrada.
    const statusCru = texto(bruta.status);
    const status = statusCru ? STATUS_ACEITOS[normalizar(statusCru)] : { saleBlocked: 0 as const, statusId: 1 };
    if (!status) {
      erro(
        "status",
        `Status não reconhecido. Use: ${STATUS_DO_C2X.map((s) => s.nome).join(", ")}.`,
        statusCru,
      );
      temErro = true;
    }

    const tipoCru = texto(bruta.tipo);
    const tipoId = tipoCru ? TIPOS_ACEITOS[normalizar(tipoCru)] : 1;
    if (!tipoId) {
      erro("tipo", "Tipo não reconhecido. Use: Unidade interna ou Unidade externa.", tipoCru);
      temErro = true;
    }

    // ⚠️ DUPLICIDADE DENTRO DA PRÓPRIA PLANILHA. Duas linhas com a mesma quadra e lote criariam
    // duas unidades iguais no C2X, e a segunda só apareceria quando alguém fosse vender.
    if (quadra && lote) {
      const chave = `${quadra}|${lote}`;
      const jaVista = vistas.get(chave);
      if (jaVista) {
        erro("quadra/lote", `Repetida: a linha ${jaVista} já traz a quadra ${quadra} lote ${lote}.`, chave);
        temErro = true;
      } else {
        vistas.set(chave, linha);
      }
    }

    if (temErro || !status || !tipoId || area === null) return;

    // Passou. O que sobra é aviso: sobe, mas alguém precisa ver.
    if (!STATUS_ESPERADOS_EM_UNIDADE_NOVA.has(status.statusId)) {
      problemas.push({
        campo: "status",
        linha,
        motivo:
          "Unidade nova costuma nascer Disponível ou Bloqueada. Este status depende de uma proposta, que não existe ainda.",
        soAviso: true,
        valor: statusCru ?? "",
      });
    }

    if (valorVazio) {
      problemas.push({
        campo: "valor",
        linha,
        motivo:
          "Sem valor de tabela. A unidade sobe com R$ 0 e NÃO entra no VGV até alguém preencher o preço no C2X.",
        soAviso: true,
        valor: "",
      });
    }

    if (!texto(bruta.matricula)) {
      problemas.push({
        campo: "matricula",
        linha,
        motivo: "Sem matrícula. A unidade sobe, mas o contrato vai precisar dela depois.",
        soAviso: true,
        valor: "",
      });
    }

    unidades.push({
      area,
      linha,
      lote,
      matricula: texto(bruta.matricula),
      quadra,
      saleBlocked: status.saleBlocked,
      statusId: status.statusId,
      statusRotulo: STATUS_DO_C2X.find((s) => s.id === status.statusId)?.nome ?? "?",
      tipoId,
      // Sem preço vai ZERO, e não nulo: o C2X exige `price` no corpo, e a unidade precisa existir
      // para o preço poder ser preenchido depois.
      valor: valor ?? 0,
    });
  });

  return { problemas, unidades };
}

/** O corpo do POST, exatamente como o C2X espera. */
export function payloadDaUnidade(
  unidade: UnidadeParaImportar,
  enterpriseId: number,
  prefixo: string,
): Record<string, unknown> {
  return {
    area: unidade.area,
    block: unidade.quadra,
    enterprise_id: enterpriseId,
    enterprise_unity_type_id: unidade.tipoId,
    lot: unidade.lote,
    name: nomeDaUnidade(prefixo, unidade.quadra, unidade.lote),
    price: unidade.valor,
    // Os dois campos de matrícula recebem o mesmo valor: é o que o C2X faz na tela dele, e foi
    // assim que a carga do Vale do Ouro subiu em 01/08.
    ...(unidade.matricula
      ? { registration: unidade.matricula, registration_number: unidade.matricula }
      : {}),
    sale_blocked: unidade.saleBlocked,
    sale_status_id: unidade.statusId,
  };
}

/**
 * O cabeçalho da planilha para a chave que a validação entende.
 *
 * ⚠️ ACEITA A VARIAÇÃO DO DIA A DIA de propósito. A planilha vem do cartório, do loteador, do
 * corretor — e cada um escreve "Área (m²)", "AREA", "Metragem". Recusar por causa do rótulo faria
 * o operador editar o cabeçalho na mão toda vez, que é onde ele erraria de verdade.
 */
export function chaveDaColuna(bruto: string): string {
  const limpo = normalizar(bruto)
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (limpo.startsWith("quadra")) return "quadra";
  if (limpo.startsWith("lote")) return "lote";
  if (limpo.startsWith("area") || limpo.startsWith("metragem")) return "area";
  if (limpo.startsWith("valor") || limpo.startsWith("preco")) return "valor";
  if (limpo.startsWith("matricula")) return "matricula";
  if (limpo.startsWith("status") || limpo.startsWith("situacao")) return "status";
  if (limpo.startsWith("tipo")) return "tipo";
  return "";
}

/**
 * Lê um CSV em linhas.
 *
 * ⚠️ O SEPARADOR É DESCOBERTO, NÃO ASSUMIDO. O Excel em português salva com ponto e vírgula e o
 * resto do mundo com vírgula; cravar um dos dois faria metade das planilhas virar uma coluna só,
 * e o erro apareceria como "quadra em branco" em todas as linhas — mensagem que não ajuda ninguém
 * a descobrir que o problema era o separador.
 */
export function lerCsv(texto: string): LinhaDaPlanilha[] {
  const linhas = texto.replace(/^\ufeff/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhas.length < 2) return [];

  const primeira = linhas[0] as string;
  const pontoEVirgula = (primeira.match(/;/g) ?? []).length;
  const virgula = (primeira.match(/,/g) ?? []).length;
  const separador = pontoEVirgula >= virgula ? ";" : ",";

  const cabecalho = primeira.split(separador).map((c) => chaveDaColuna(c));

  return linhas.slice(1).map((linha) => {
    const celulas = linha.split(separador);
    const registro: LinhaDaPlanilha = {};
    cabecalho.forEach((chave, i) => {
      if (chave) registro[chave] = (celulas[i] ?? "").trim().replace(/^"|"$/g, "");
    });
    return registro;
  });
}
