// O TEMPLATE QUE LEVA O LINK DO BOLETO AO CLIENTE.
//
// Pedido do Lucas (01/09/2026): *"temos agora que gerar o template para gente enviar o link do
// boleto"*, na WABA do *4143*. E sobre o conteúdo: *"esse vai servir para todos os empreendimentos,
// então seria legal ter na mensagem, nome do cliente, nome do empreendimento a unidade, e a parcela
// (9/120) e a data de vencimento e o valor"*.
//
// ⚠️ UM TEMPLATE PARA TODOS OS EMPREENDIMENTOS. Por isso o nome do empreendimento é PARÂMETRO e não
// texto fixo: um template por carteira seriam nove submissões à Meta, nove aprovações e nove textos
// para manter em sincronia quando o jurídico pedir uma vírgula. E é por isso que o rodapé não nomeia
// beneficiário: dizer "CER" seria mentira no Garden, no Vale do Sol e nos outros seis.
//
// ⚠️ O TEXTO MORA AQUI, num lugar só. Quem cria o template na Meta e quem dispara precisam
// concordar na CONTAGEM de parâmetros: a Meta recusa o envio quando chegam menos que os declarados,
// e o erro fala de "number of parameters", não de qual campo faltou. Ver
// [[reference_meta_template_parametros]].
//
// ⚠️ CATEGORIA UTILITY, e não MARKETING. É aviso sobre uma cobrança que já existe, para quem tem
// contrato: transacional. Marketing custa mais por mensagem e a Meta reclassifica ao ler o texto.

export const TEMPLATE_BOLETO = "boleto_disponivel";
export const TEMPLATE_BOLETO_IDIOMA = "pt_BR";

/** O cabeçalho fixo, sem variável: dá destaque sem gastar um parâmetro. */
export const TEMPLATE_BOLETO_HEADER = "Boleto disponível";

/**
 * O corpo, com os sete parâmetros na ordem em que `parametrosDoBoleto` os produz.
 *
 * ⚠️ TERMINA COM TEXTO, E NENHUM PARÂMETRO É VIZINHO DE OUTRO. A Meta rejeita template que começa
 * ou termina com variável, e rejeita duas variáveis separadas só por espaço ou quebra de linha. É
 * por isso que existe a linha "Acesse o boleto pelo link:" entre o valor e a URL: sem ela, `{{6}}` e
 * `{{7}}` ficam adjacentes e a criação volta reprovada.
 *
 * ⚠️ O RÓTULO É "REFERENTE A", E NÃO "PARCELA". O `{{4}}` nem sempre é uma parcela: quando a
 * contagem da planilha não fecha (o Ed. Cristal 201 tem "parcela 7 de 5"), ele vira a competência. Com
 * o rótulo fixo "Parcela:", esses clientes leriam "Parcela: setembro de 2026". Rótulo aprovado não
 * se conserta sem nova submissão à Meta, então o substantivo vai DENTRO da variável.
 *
 * ⚠️ O FECHO É A ASSINATURA, E TAMBÉM É ESTRUTURAL. Ele diz de quem é a mensagem, que é o que o
 * cliente procura ao receber um link de pagamento de um número que não tem salvo. E resolve a regra
 * da Meta de o corpo não poder terminar em variável: sem uma linha depois do `{{7}}`, a criação do
 * template volta reprovada.
 *
 * Decisão do Lucas (01/09/2026), vendo a mensagem chegar no WhatsApp dele: *"só tirar a última
 * frase e colocar Time Careli no final"*. A frase anterior avisava que a Careli não muda conta nem
 * chave PIX por mensagem; ele leu e preferiu a assinatura curta.
 *
 * ⚠️ O NEGRITO DO WHATSAPP É UM ASTERISCO, não dois. Ver [[feedback_whatsapp_negrito]].
 */
export const TEMPLATE_BOLETO_CORPO = `Olá, {{1}}!

Segue o boleto do empreendimento *{{2}}*, unidade *{{3}}*.

Referente a: *{{4}}*
Vencimento: *{{5}}*
Valor: *R$ {{6}}*

Acesse o boleto pelo link:
{{7}}

Time Careli`;

/** A amostra que a Meta exige para aprovar. Precisa ser plausível, não real. */
export const TEMPLATE_BOLETO_EXEMPLO = [
  "Marcelo",
  "Ed. Rubi",
  "302",
  "Parcela 9 de 36",
  "20/09/2026",
  "2.102,58",
  "https://www.asaas.com/i/abc123def456",
] as const;

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Deixa um texto pronto para virar parâmetro da Meta.
 *
 * ⚠️ COLAPSA O ESPAÇO DO MIOLO, e não só apara as bordas. A Meta recusa parâmetro com quebra de
 * linha, e estes dados vêm de célula de Excel, onde um Alt+Enter chega como `\n` dentro do nome. Um
 * `.trim()` sozinho não veria: a quebra está no meio.
 */
function comoParametro(valor: unknown): string {
  return String(valor ?? "").replace(/\s+/g, " ").trim();
}

/**
 * O primeiro nome, para a mensagem não abrir com um nome de cartório inteiro.
 *
 * ⚠️ E TIRA O GRITO. O cadastro guarda "MARCELO SALDANHA NUNES" em caixa alta, e "Olá, MARCELO!"
 * soa como cobrança agressiva na tela do cliente.
 */
export function primeiroNomeParaSaudacao(nome: string): string {
  const primeiro = comoParametro(nome).split(" ")[0] ?? "";
  if (!primeiro) return "";
  return primeiro === primeiro.toUpperCase()
    ? primeiro.charAt(0) + primeiro.slice(1).toLowerCase()
    : primeiro;
}

/**
 * `2026-09` → `setembro de 2026`.
 *
 * ⚠️ DEVOLVE VAZIO QUANDO A COMPETÊNCIA NÃO É AAAA-MM. Antes montava a string mesmo assim e produzia
 * `"undefined de "`, que passa por qualquer teste de "não está vazio" e chega ao WhatsApp do cliente.
 */
export function competenciaPorExtenso(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(comoParametro(competencia));
  if (!m) return "";
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${mes} de ${m[1]}` : "";
}

/** `2026-09-15` → `15/09/2026`, fatiando a string (`new Date` mostraria o dia anterior no Brasil). */
export function dataPorExtenso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? "");
}

/** `1116.5` → `1.116,50`. O "R$" é texto fixo do template. */
export function valorParaOTexto(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

/**
 * O que o boleto está cobrando: `Parcela 9 de 36`, ou `Competência setembro de 2026`.
 *
 * ⚠️ A FRAÇÃO SÓ SAI QUANDO A CONTA FECHA. Medido na planilha de 31/08/2026: o Ed. Cristal, unidade
 * 201, tem "Parc. Atual" 7 e "Nº Parc." 5. Mandar "parcela 7 de 5" para o cliente é convite a uma
 * ligação perguntando se ele está pagando a mais, e não há resposta boa. Quando os números não se
 * sustentam, a competência entra no lugar: diz a mesma coisa (de que mês é este boleto) sem afirmar
 * uma contagem que a planilha não sabe.
 *
 * ⚠️ O SUBSTANTIVO VAI JUNTO, e não no rótulo fixo do template, justamente porque as duas respostas
 * são de naturezas diferentes.
 */
export function rotuloDaParcela(input: {
  atual: null | number | undefined;
  competencia: string;
  total: null | number | undefined;
}): string {
  const atual = Number(input.atual);
  const total = Number(input.total);
  const fracaoValida =
    Number.isInteger(atual) &&
    Number.isInteger(total) &&
    atual >= 1 &&
    total >= 1 &&
    atual <= total;

  if (fracaoValida) return `Parcela ${atual} de ${total}`;

  const mes = competenciaPorExtenso(input.competencia);
  return mes ? `Competência ${mes}` : "";
}

export type DadosDoDisparo = {
  competencia: string;
  empreendimento: string;
  link: string;
  nome: string;
  parcelaAtual?: null | number;
  totalParcelas?: null | number;
  unidade: string;
  valor: number;
  vencimento: string;
};

/**
 * Os sete parâmetros do corpo, na ordem do template.
 *
 * ⚠️ NENHUM PODE VOLTAR VAZIO. A Meta recusa a mensagem inteira quando um parâmetro chega em branco,
 * e a recusa acontece no disparo, com o boleto já emitido e o cliente sem aviso. Por isso a função
 * devolve `null` quando falta dado, em vez de mandar string vazia: quem chama trata como "não dá
 * para disparar" e mostra o motivo, em vez de descobrir pelo erro da Meta.
 */
export function parametrosDoBoleto(d: DadosDoDisparo): null | string[] {
  const nome = primeiroNomeParaSaudacao(d.nome);
  const empreendimento = comoParametro(d.empreendimento);
  const unidade = comoParametro(d.unidade);
  const link = comoParametro(d.link);

  if (!nome || !empreendimento || !unidade || !link) return null;
  if (!Number.isFinite(d.valor) || d.valor <= 0) return null;

  const vencimento = dataPorExtenso(d.vencimento);
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(vencimento)) return null;

  // ⚠️ Vazio aqui quer dizer que nem a fração nem a competência se sustentaram. Sem isto, o
  // parâmetro sairia em branco e a Meta recusaria a mensagem inteira.
  const referencia = rotuloDaParcela({
    atual: d.parcelaAtual,
    competencia: d.competencia,
    total: d.totalParcelas,
  });
  if (!referencia) return null;

  return [
    nome,
    empreendimento,
    unidade,
    referencia,
    vencimento,
    valorParaOTexto(d.valor),
    link,
  ];
}

/**
 * O texto que a mensagem vai ter, para a tela mostrar ANTES do disparo.
 *
 * ⚠️ EXISTE PARA O OPERADOR CONFERIR. Template disparado não se apaga, e o cliente lê o que chegou.
 * Ver a mensagem montada com os dados reais é a única chance de perceber um nome trocado ou um valor
 * fora de lugar enquanto isso ainda custa zero.
 */
export function previaDaMensagem(parametros: string[]): string {
  return TEMPLATE_BOLETO_CORPO.replace(
    /\{\{(\d)\}\}/g,
    (_, n) => parametros[Number(n) - 1] ?? `{{${n}}}`,
  );
}
