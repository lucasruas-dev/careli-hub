// EMISSÃO DOS BOLETOS NO ASAAS — a camada que fala com a API, uma conta por empreendimento.
//
// Pedido do Lucas (01/09/2026): *"Nessa tela vamos emitir os boletos, gerar os pagamentos. (…) esse
// mês vou fazer de forma mais manual, somente com essa tela (…) esse mês é pegar os valores da
// tabela e vamos emitir por ela"*.
//
// ⚠️ A CONTA É PARÂMETRO, E É A DIFERENÇA PARA O QUE JÁ EXISTE. `asaas-prevenda.ts` amarra a chave
// da Gurgel dentro do módulo, e `guardian/asaas.ts` a da Careli. Aqui não dá: são nove
// empreendimentos e cada um emite pela SUA conta. O boleto sai no CNPJ da dona da chave e o dinheiro
// cai nela — chave errada é dinheiro na conta errada, e ninguém percebe até o extrato.
//
// ⚠️ O VALOR É ARREDONDADO AQUI, E DE PROPÓSITO. Os valores da planilha chegam com até 13 casas
// decimais (medido: 139 de 142) e o Asaas aceita duas. Mandar cru não é "ser fiel": é deixar o
// arredondamento acontecer no servidor deles, sem registro nosso. Arredondando aqui, a tela mostra
// o valor da planilha e o emitido lado a lado, e a diferença total do lote fica visível ANTES do
// clique. Fidelidade que não dá para conferir não é fidelidade.

import { chaveDaConta, type ContaAsaas, rotuloDaConta } from "../asaas-contas";

function baseUrl(): string {
  return (process.env.ASAAS_API_BASE_URL?.trim() || "https://api.asaas.com").replace(/\/+$/, "");
}

export type ResultadoAsaas<T> =
  | { data: T; ok: true }
  | { erro: string; ok: false; status: number };

async function chamar<T>(
  conta: ContaAsaas,
  caminho: string,
  init?: { body?: unknown; method?: string },
): Promise<ResultadoAsaas<T>> {
  const chave = chaveDaConta(conta);
  if (!chave) {
    return {
      erro: `A conta ${rotuloDaConta(conta)} não tem chave configurada.`,
      ok: false,
      status: 0,
    };
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/v3${caminho}`, {
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Careli Boletos",
        access_token: chave,
      },
      method: init?.method ?? "GET",
    });
  } catch (e) {
    return { erro: (e as Error).message, ok: false, status: 0 };
  }

  const corpo = (await res.json().catch(() => null)) as
    | (T & { errors?: { code?: string; description?: string }[] })
    | null;

  if (!res.ok) {
    return {
      erro: corpo?.errors?.[0]?.description || `HTTP ${res.status}`,
      ok: false,
      status: res.status,
    };
  }
  return { data: corpo as T, ok: true };
}

/**
 * O valor que vai para o Asaas.
 *
 * ⚠️ ARREDONDA PARA CIMA — decisão do Lucas (01/09/2026): *"arredonda para cima"*. Os valores da
 * planilha chegam com até 13 casas decimais (139 de 142 medidos) e o Asaas aceita duas. Para cima
 * significa que a diferença nunca é contra a empresa: no pior caso o cliente paga um centavo a mais,
 * nunca a menos.
 *
 * ⚠️ O `.toFixed(6)` ANTES DO `Math.ceil` NÃO É ENFEITE, E SEM ELE A CONTA ERRA. Em ponto flutuante,
 * `1.09 * 100` dá `109.00000000000001` — e `Math.ceil` disso sobe para 110, transformando R$ 1,09 em
 * R$ 1,10 sem nenhum motivo. Achei seis casos assim só entre 0,01 e 50,00 (0.07, 0.14, 0.28, 0.55,
 * 0.56, 1.09), e todos são valores que JÁ tinham duas casas: subiriam um centavo à toa. Limpar o
 * ruído na sexta casa antes de arredondar resolve, porque nenhum valor de dinheiro tem informação
 * real ali.
 */
export function valorParaOAsaas(valorDaPlanilha: number): number {
  const centavos = Number((valorDaPlanilha * 100).toFixed(6));
  return Math.ceil(centavos) / 100;
}

/** Quanto o arredondamento mexeu, para a tela mostrar antes do clique. */
export function diferencaDoArredondamento(valores: number[]): {
  emitido: number;
  linhasAjustadas: number;
  planilha: number;
} {
  let planilha = 0;
  let emitido = 0;
  let linhasAjustadas = 0;

  for (const v of valores) {
    const arredondado = valorParaOAsaas(v);
    planilha += v;
    emitido += arredondado;
    if (arredondado !== v) linhasAjustadas += 1;
  }

  return {
    emitido: Math.round(emitido * 100) / 100,
    linhasAjustadas,
    planilha: Math.round(planilha * 100) / 100,
  };
}

export type ClienteAsaas = { cpfCnpj?: string; id: string; name?: string };

/**
 * Acha o cliente pelo documento, ou cria.
 *
 * ⚠️ PROCURA ANTES DE CRIAR. O Asaas aceita dois clientes com o mesmo CPF sem reclamar, e aí a
 * segunda emissão do mês cria um cliente novo: o cliente recebe boleto de um "cadastro" e vê o
 * histórico noutro. Como esta tela roda todo mês com as mesmas pessoas, sem esta busca a base do
 * Asaas dobraria de tamanho a cada rodada.
 */
export async function acharOuCriarCliente(
  conta: ContaAsaas,
  input: { contato?: null | string; documento: string; nome: string; referencia?: string },
): Promise<ResultadoAsaas<{ cliente: ClienteAsaas; criado: boolean }>> {
  const documento = input.documento.replace(/\D/g, "");

  const busca = await chamar<{ data: ClienteAsaas[] }>(
    conta,
    `/customers?cpfCnpj=${encodeURIComponent(documento)}&limit=1`,
  );
  if (!busca.ok) return busca;

  const existente = busca.data.data?.[0];
  if (existente) return { data: { cliente: existente, criado: false }, ok: true };

  // ⚠️ O CONTATO PODE SER E-MAIL OU TELEFONE. Na devolutiva do administrativo, as empresas trazem
  // e-mail na coluna de telefone (a BCM, por exemplo). Mandar um e-mail no campo `mobilePhone` faz o
  // Asaas recusar o cadastro inteiro.
  const contato = (input.contato ?? "").trim();
  const ehEmail = contato.includes("@");
  const telefone = ehEmail ? undefined : contato.replace(/\D/g, "") || undefined;

  const criacao = await chamar<ClienteAsaas>(conta, "/customers", {
    body: {
      cpfCnpj: documento,
      email: ehEmail ? contato : undefined,
      externalReference: input.referencia,
      mobilePhone: telefone,
      name: input.nome,
    },
    method: "POST",
  });
  if (!criacao.ok) return criacao;

  return { data: { cliente: criacao.data, criado: true }, ok: true };
}

export type CobrancaAsaas = {
  bankSlipUrl?: string;
  dueDate: string;
  id: string;
  invoiceUrl?: string;
  status: string;
  value: number;
};

/**
 * Cria o boleto.
 *
 * ⚠️ `externalReference` CARREGA A IDENTIDADE DA COBRANÇA — empreendimento, unidade e competência.
 * É por ele que a próxima rodada descobre que este boleto já existe, e é por ele que se acha a
 * cobrança para cancelar quando o administrativo errar o lote. Sem isso, a única saída seria casar
 * por nome e valor, que é como se paga duas vezes.
 *
 * ⚠️ `billingType: "BOLETO"` explícito. O `UNDEFINED` deixa o pagador escolher e faz o Asaas exigir
 * chave PIX na conta; conta sem chave gera cobrança que expira no mesmo dia. Ver a pendência
 * anotada em 31/08 — aqui a escolha é boleto, que é o que o administrativo manda.
 */
export function criarBoleto(
  conta: ContaAsaas,
  input: {
    cliente: string;
    descricao: string;
    referencia: string;
    valor: number;
    vencimento: string;
  },
): Promise<ResultadoAsaas<CobrancaAsaas>> {
  return chamar<CobrancaAsaas>(conta, "/payments", {
    body: {
      billingType: "BOLETO",
      customer: input.cliente,
      description: input.descricao,
      dueDate: input.vencimento,
      externalReference: input.referencia,
      value: valorParaOAsaas(input.valor),
    },
    method: "POST",
  });
}

/**
 * As cobranças já emitidas para uma competência, pela referência.
 *
 * ⚠️ É O QUE IMPEDE A EMISSÃO DUPLICADA. A tela roda todo mês e alguém vai clicar duas vezes; sem
 * consultar antes, o cliente recebe dois boletos do mesmo mês e liga perguntando qual pagar.
 */
export function cobrancasDaReferencia(
  conta: ContaAsaas,
  referencia: string,
): Promise<ResultadoAsaas<{ data: CobrancaAsaas[]; totalCount: number }>> {
  return chamar<{ data: CobrancaAsaas[]; totalCount: number }>(
    conta,
    `/payments?externalReference=${encodeURIComponent(referencia)}&limit=100`,
  );
}

export type CobrancaListada = CobrancaAsaas & {
  clientPaymentDate?: null | string;
  customer: string;
  dateCreated?: string;
  description?: string;
  externalReference?: null | string;
  paymentDate?: null | string;
};

/**
 * As cobranças de uma conta num intervalo de vencimento.
 *
 * ⚠️ FILTRA POR VENCIMENTO, E NÃO PELA REFERÊNCIA. O Asaas só casa `externalReference` por igualdade
 * exata — não há busca por prefixo. Como a referência carrega a unidade
 * (`boleto:guaimbe:307:2026-09`), procurar "todos os boletos de setembro do Guaimbé" exigiria uma
 * chamada por unidade. Trazendo por intervalo e filtrando aqui, é uma chamada por conta.
 *
 * ⚠️ PAGINA ATÉ O FIM. O Asaas devolve 100 por página com `hasMore`; parar na primeira faria a tela
 * mostrar 100 boletos de 142 sem dizer que faltam — e o operador emitiria os 42 de novo.
 */
export async function listarCobrancas(
  conta: ContaAsaas,
  intervalo: { fim: string; inicio: string },
): Promise<ResultadoAsaas<CobrancaListada[]>> {
  const todas: CobrancaListada[] = [];
  let offset = 0;

  // Teto de segurança: 50 páginas = 5.000 cobranças. Acima disso é laço infinito, não carteira.
  for (let pagina = 0; pagina < 50; pagina += 1) {
    const res = await chamar<{ data: CobrancaListada[]; hasMore: boolean }>(
      conta,
      `/payments?dueDate[ge]=${intervalo.inicio}&dueDate[le]=${intervalo.fim}` +
        `&limit=100&offset=${offset}`,
    );
    if (!res.ok) return res;

    todas.push(...(res.data.data ?? []));
    if (!res.data.hasMore) break;
    offset += 100;
  }

  return { data: todas, ok: true };
}

/** As cobranças que vieram desta tela, por competência — as outras da conta ficam de fora. */
export function apenasDaCompetencia(
  cobrancas: CobrancaListada[],
  competencia: string,
): CobrancaListada[] {
  const sufixo = `:${competencia}`;
  return cobrancas.filter(
    (c) => (c.externalReference ?? "").startsWith("boleto:") && (c.externalReference ?? "").endsWith(sufixo),
  );
}

/** O empreendimento e a unidade de volta, a partir da referência. */
export function lerReferencia(
  referencia: null | string | undefined,
): null | { competencia: string; empreendimento: string; unidade: string } {
  const partes = (referencia ?? "").split(":");
  if (partes.length !== 4 || partes[0] !== "boleto") return null;
  return { competencia: partes[3]!, empreendimento: partes[1]!, unidade: partes[2]! };
}

/** Confere que a chave responde e de quem é a conta — antes de emitir 142 boletos. */
export function conferirConta(
  conta: ContaAsaas,
): Promise<ResultadoAsaas<{ companyName?: string; email?: string; name?: string }>> {
  return chamar(conta, "/myAccount");
}

export type SituacaoCadastral = {
  bankAccountInfo: StatusDoCadastro;
  commercialInfo: StatusDoCadastro;
  documentation: StatusDoCadastro;
  general: StatusDoCadastro;
};

export type StatusDoCadastro = "APPROVED" | "AWAITING_APPROVAL" | "PENDING" | "REJECTED";

/**
 * A situação cadastral da conta no Asaas.
 *
 * ⚠️ ISTO NÃO É BUROCRACIA, É O QUE DECIDE SE O LOTE PASSA. Enquanto o cadastro está pendente de
 * aprovação, o Asaas limita a emissão a **100 boletos por dia**; depois de aprovado, 5.000. O Vale
 * do Sol sozinho tem 102 boletos — numa conta ainda não aprovada, os dois últimos falham e o
 * operador só descobre no fim da fila, sem saber por quê.
 *
 * A conta está inteira quando `general` volta `APPROVED`.
 */
export function situacaoCadastral(
  conta: ContaAsaas,
): Promise<ResultadoAsaas<SituacaoCadastral>> {
  return chamar<SituacaoCadastral>(conta, "/myAccount/status");
}

/** O limite diário do Asaas para a conta, dado o estado do cadastro. */
export function limiteDiario(situacao: SituacaoCadastral): number {
  return situacao.general === "APPROVED" ? 5000 : 100;
}

/**
 * O que impede esta conta de emitir agora — em português, para a tela dizer antes do clique.
 *
 * Devolve lista vazia quando está tudo certo.
 */
export function impedimentosDaConta(
  situacao: SituacaoCadastral,
  quantosBoletos: number,
): string[] {
  const problemas: string[] = [];

  if (situacao.general === "REJECTED") {
    problemas.push("O cadastro desta conta foi REJEITADO pelo Asaas. Ela não emite.");
    return problemas;
  }

  const limite = limiteDiario(situacao);
  if (quantosBoletos > limite) {
    problemas.push(
      `São ${quantosBoletos} boletos e esta conta só pode emitir ${limite} por dia — ` +
        (limite === 100
          ? "o cadastro ainda não foi aprovado pelo Asaas."
          : "acima do limite da conta."),
    );
  }

  // Os pendentes não impedem a emissão, mas explicam o limite baixo — e é o que o operador precisa
  // resolver para o mês que vem.
  const faltando: string[] = [];
  if (situacao.documentation !== "APPROVED") faltando.push("documentação");
  if (situacao.bankAccountInfo !== "APPROVED") faltando.push("conta bancária");
  if (situacao.commercialInfo !== "APPROVED") faltando.push("dados comerciais");

  if (faltando.length && situacao.general !== "APPROVED") {
    problemas.push(
      `Cadastro incompleto no Asaas (${faltando.join(", ")}) — por isso o limite de 100 por dia.`,
    );
  }

  return problemas;
}

/**
 * A descrição que aparece no boleto e no extrato da conta.
 *
 * ⚠️ É O QUE SEPARA AS CARTEIRAS QUANDO A CONTA É COMPARTILHADA. Jade, Ruby, Cristal e Esmeralda
 * emitem todos pela CER (decisão do Lucas, 01/09/2026: *"vão ser em uma conta somente, CER, por
 * isso na descrição vamos ter que apontar qual empreendimento"*). No extrato da CER os quatro
 * chegam misturados; sem o nome aqui, não há como saber de qual prédio veio cada pagamento — nem
 * na conciliação, nem quando o cliente liga perguntando do que é a cobrança.
 *
 * ⚠️ O NOME VEM DA PLANILHA, e não de uma lista nossa. Decisão do Lucas: *"segue o que está na
 * planilha"*. A planilha escreve "Ed. Rubi"; um print de conversa dizia "EDIFICIO RUBY". Quem manda
 * é o arquivo, porque é o que o administrativo confere na hora de bater a cobrança.
 *
 * `descricaoDoBoleto({ competencia: "2026-09", empreendimento: "Ed. Rubi", unidade: "301" })`
 *   → "Ed. Rubi - Unidade 301 - Competência 09/2026"
 */
export function descricaoDoBoleto(input: {
  competencia: string;
  empreendimento: string;
  unidade: null | string;
}): string {
  const [ano, mes] = input.competencia.split("-");
  const partes = [input.empreendimento.trim()];

  // Unidade em branco acontece: algumas abas trazem a linha sem número. Melhor a descrição sair sem
  // ela do que com "Unidade null" impresso no boleto do cliente.
  const unidade = (input.unidade ?? "").trim();
  if (unidade) partes.push(`Unidade ${unidade}`);

  partes.push(mes && ano ? `Competência ${mes}/${ano}` : `Competência ${input.competencia}`);
  return partes.join(" - ");
}

/**
 * A referência de uma cobrança: empreendimento, unidade e competência.
 *
 * Formato estável e legível no painel do Asaas — quem abrir lá vê de onde veio sem consultar nada.
 */
export function referenciaDaCobranca(input: {
  competencia: string;
  empreendimento: string;
  unidade: string;
}): string {
  const unidade = input.unidade.trim().replace(/\s+/g, "-");
  return `boleto:${input.empreendimento}:${unidade}:${input.competencia}`;
}

// ── DESFAZER E CORRIGIR ─────────────────────────────────────────────────────

export type CobrancaCancelada = { deleted: boolean; id: string };

/**
 * Cancela a cobrança no Asaas.
 *
 * Pedido do Lucas (01/09/2026): *"temos agora que criar a rota de cancelamento desse boleto"*.
 *
 * ⚠️ CANCELAR NÃO DESFAZ O QUE O CLIENTE JÁ VIU. O boleto pode estar impresso, no aplicativo do
 * banco ou já agendado; o cancelamento impede o pagamento futuro, e é isso que faz dele uma ação
 * séria e não um "ctrl+z". Quem cancela precisa avisar o cliente.
 *
 * ⚠️ COBRANÇA PAGA NÃO CANCELA. O Asaas recusa, e é bom que recuse: apagar o registro de um
 * pagamento recebido é como o dinheiro some da conciliação. O erro dele vem com a explicação, e
 * quem chama a repassa em vez de traduzir para "não deu".
 */
export function cancelarCobranca(
  conta: ContaAsaas,
  cobrancaId: string,
): Promise<ResultadoAsaas<CobrancaCancelada>> {
  return chamar<CobrancaCancelada>(conta, `/payments/${encodeURIComponent(cobrancaId)}`, {
    method: "DELETE",
  });
}

/**
 * Corrige uma cobrança já emitida: valor, vencimento ou descrição.
 *
 * Pedido do Lucas (01/09/2026): *"podemos editar o numero, valor de boleto, alterar descrição"*.
 *
 * ⚠️ O ASAAS GERA UM BOLETO NOVO quando o valor ou o vencimento mudam: a linha digitável antiga
 * deixa de valer. Se o cliente já recebeu o link, ele precisa receber de novo — por isso a tela
 * oferece o reenvio logo depois de editar.
 *
 * ⚠️ MANDA SÓ O QUE MUDOU. O endpoint aceita atualização parcial, e enviar o objeto inteiro faria
 * um campo não informado (a descrição, por exemplo) ser sobrescrito com vazio.
 */
export function atualizarCobranca(
  conta: ContaAsaas,
  cobrancaId: string,
  mudancas: { descricao?: string; valor?: number; vencimento?: string },
): Promise<ResultadoAsaas<CobrancaAsaas>> {
  const body: Record<string, unknown> = {};
  if (mudancas.valor !== undefined) body.value = valorParaOAsaas(mudancas.valor);
  if (mudancas.vencimento !== undefined) body.dueDate = mudancas.vencimento;
  if (mudancas.descricao !== undefined) body.description = mudancas.descricao;

  return chamar<CobrancaAsaas>(conta, `/payments/${encodeURIComponent(cobrancaId)}`, {
    body,
    method: "PUT",
  });
}
