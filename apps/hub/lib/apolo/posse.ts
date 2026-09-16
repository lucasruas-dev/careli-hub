// A DATA DA POSSE — o marco que decide se existe fruição.
//
// Lucas (15/09/2026): *"vamos precisar de incluir esse campo de posse, ae vc pode incluir no lugar
// correto. se não estiver preenchido é que a posse não aconteceu."*
//
// A Lei 13.786/18 permite reter, na rescisão, o valor da FRUIÇÃO: o comprador que ocupou o imóvel
// paga pelo tempo de ocupação. O marco inicial é a posse, e sem ela a rubrica inteira não existe.
//
// ⚠️ A AUSÊNCIA É O ESTADO NORMAL, NÃO UMA PENDÊNCIA DE CADASTRO. A minuta da Lavra do Ouro
// (cláusula 5.1) concede a posse *"após 2 (dois) anos a contar da assinatura deste instrumento E
// DESDE QUE ESTEJA(M) ELE(S) EM DIA com suas obrigações"*. São duas condições, e a segunda elimina
// justamente quem chega à rescisão: o inadimplente nunca recebeu a posse. Tela nenhuma deve tratar
// o campo vazio como erro, cobrança ou alerta.
//
// ⚠️ A DATA NÃO DÁ PARA DERIVAR DO CONTRATO, e isto foi medido nos 3.020 contratos com texto do
// C2X: 62% citam a imissão na posse, mas 23% a ligam à ASSINATURA, 14% à QUITAÇÃO e 44% falam de
// habite-se ou termo de vistoria. Não há regra única. Por isso o campo é preenchido à mão, e a
// `origem` vai impressa no termo: o jurídico precisa saber se o número veio de um papel assinado
// ou da memória de quem cadastrou.
//
// ⚠️ NÃO EXISTE COLUNA DE POSSE NO C2X. Varri `information_schema.columns` por posse, possession,
// delivery, entrega e habite: o único achado é `enterprises.expected_delivery_date`, que é a
// entrega PREVISTA do empreendimento, não a posse DESTE comprador. A casa do dado é
// `hercules_posse` (migration 0165), no Panteon.

/** De onde a data saiu. Os nomes são os mesmos do CHECK da migration 0165. */
export type OrigemDaPosse = "contrato" | "declarada" | "termo_de_vistoria";

/** Como a tela e o termo chamam cada origem. */
export const ORIGENS_DA_POSSE: { rotulo: string; valor: OrigemDaPosse }[] = [
  { rotulo: "Termo de vistoria assinado", valor: "termo_de_vistoria" },
  { rotulo: "Cláusula do contrato com data certa", valor: "contrato" },
  { rotulo: "Declarada pelo operador", valor: "declarada" },
];

export type PosseRegistrada = {
  dataDaPosse: string;
  observacao: null | string;
  origem: OrigemDaPosse;
  registradoEm: null | string;
  registradoPorNome: null | string;
};

/** O formato de erro da casa: o campo que errou e a frase que a tela mostra. */
export type ErroDePosse = { campo: string; mensagem: string };

const ORIGENS_VALIDAS = new Set<string>(ORIGENS_DA_POSSE.map((o) => o.valor));

/**
 * Lê 'YYYY-MM-DD' como meia-noite UTC.
 *
 * ⚠️ `new Date("2024-03-15")` JÁ É UTC, mas `new Date(2024, 2, 15)` é local, e misturar os dois
 * desloca a conta em um dia inteiro no fuso do Brasil — o suficiente para a fruição sair com um dia
 * a mais ou a menos e o número nunca fechar com o que o jurídico calculou à mão.
 */
function emUtc(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto ?? "").trim());
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  // ⚠️ O `Date.UTC` ACEITA 31 DE FEVEREIRO e devolve 2 ou 3 de março, calado. Comparar de volta é o
  // que transforma data impossível em erro de formulário em vez de fruição a mais.
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    return null;
  }
  return data;
}

/** A data de hoje, zerada em UTC — para comparar com a data da posse sem carregar a hora. */
function hojeUtc(hoje: Date): Date {
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
}

/**
 * Confere o que a tela mandou antes de gravar.
 *
 * ⚠️ O TETO É CONFERIDO AQUI, E NÃO NO BANCO, porque o Postgres não aceita `current_date` num CHECK
 * (não é IMMUTABLE). A migration 0165 trava só o piso de 2000-01-01; "posse no futuro" é erro de
 * digitação e precisa voltar para o operador com a frase que explica, não com um 23514 genérico.
 */
export function conferirPosse(entrada: {
  dataDaPosse: unknown;
  hoje?: Date;
  observacao?: unknown;
  origem: unknown;
}): ErroDePosse[] {
  const erros: ErroDePosse[] = [];

  const texto = String(entrada.dataDaPosse ?? "").trim();
  if (!texto) {
    erros.push({ campo: "dataDaPosse", mensagem: "Informe a data em que a posse foi concedida." });
  } else {
    const data = emUtc(texto);
    if (!data) {
      erros.push({ campo: "dataDaPosse", mensagem: "Data inválida. Use o formato dia/mês/ano." });
    } else {
      const hoje = hojeUtc(entrada.hoje ?? new Date());
      // ⚠️ MESMA ARMADILHA DO NaN, do outro lado: com um `hoje` invalido, `data > hoje` e false e a
      // trava de data futura DESLIGA EM SILENCIO. Conferir o relogio antes de usa-lo como regua.
      if (!Number.isFinite(hoje.getTime())) {
        erros.push({
          campo: "dataDaPosse",
          mensagem: "Nao foi possivel conferir a data de hoje. Tente de novo.",
        });
      } else if (data.getTime() > hoje.getTime()) {
        erros.push({
          campo: "dataDaPosse",
          mensagem: "A posse não pode ser uma data futura. Se ainda não aconteceu, deixe em branco.",
        });
      }
      if (data.getUTCFullYear() < 2000) {
        erros.push({
          campo: "dataDaPosse",
          mensagem: "Data anterior a 2000. Confira o ano.",
        });
      }
    }
  }

  const origem = String(entrada.origem ?? "").trim();
  if (!ORIGENS_VALIDAS.has(origem)) {
    erros.push({ campo: "origem", mensagem: "Escolha de onde a data da posse saiu." });
  }

  const observacao = entrada.observacao == null ? "" : String(entrada.observacao);
  if (observacao.length > 500) {
    erros.push({ campo: "observacao", mensagem: "A observação passa de 500 caracteres." });
  }

  return erros;
}

/**
 * Quantos meses de ocupação existem entre a posse e a restituição, com fração.
 *
 * ⚠️ MÊS COMERCIAL DE 30 DIAS, pro rata die — a mesma régua que `lib/hades/dossie/encargos.ts` usa
 * para os juros de mora (`(taxa / 100) / 30 * dias`). Não é a convenção mais precisa do calendário,
 * é a convenção DESTA CASA, e duas réguas discordando no mesmo cliente é o defeito que o
 * levantamento já registrou entre o acordo e o dossiê. Uma régua só.
 *
 * ⚠️ DEVOLVE ZERO EM VEZ DE NEGATIVO quando a posse é posterior à restituição. Fruição negativa
 * viraria um crédito ao cliente numa linha de dedução, e o papel diria o contrário do que a conta
 * pretende.
 *
 * ⚠️ E DEVOLVE ZERO QUANDO NÃO HÁ POSSE. `null`, vazio ou data inválida = a rubrica inteira some do
 * termo, que é exatamente o que o Lucas definiu para o campo em branco.
 */
export function mesesDeFruicao(entrada: {
  ateRestituicao?: Date | null;
  dataDaPosse: null | string | undefined;
}): number {
  if (!entrada.dataDaPosse) return 0;
  const posse = emUtc(entrada.dataDaPosse);
  if (!posse) return 0;

  const fim = hojeUtc(entrada.ateRestituicao ?? new Date());
  const dias = Math.floor((fim.getTime() - posse.getTime()) / 86_400_000);

  // ⚠️ `NaN <= 0` E FALSE, e por isso a guarda tem de citar o NaN em voz alta. Um `Date` invalido
  // em `ateRestituicao` (um `new Date("")` vindo de campo de formulario vazio) faz `getTime()`
  // devolver NaN, e a comparacao sozinha deixaria passar. O estrago nao seria um "NaN" impresso:
  // `calcularRescisao` filtra com `Number.isFinite` antes de montar a linha, entao a FRUICAO — a
  // rubrica mais pesada do termo — simplesmente sumiria do papel, calada.
  if (!Number.isFinite(dias) || dias <= 0) return 0;

  // Duas casas: o papel imprime "por 21,53 meses" e a conta tem de bater com o que está impresso.
  return Math.round((dias / 30) * 100) / 100;
}

/**
 * "15/03/2024" — a data como o papel escreve, sem o deslocamento de fuso do `toLocaleDateString`.
 *
 * ⚠️ SIM, EXISTE UMA `dataBr` NA CASA (`lib/apolo/extrato-cliente.ts`), E ELA NÃO SERVE AQUI. Aquela
 * função só reordena os dígitos do regex, sem conferir o calendário: medido em 15/09/2026,
 * `dataBr("2025-02-31")` devolve "31/02/2025" e `dataBr("2024-13-99")` devolve "99/13/2024". Esta
 * passa por `emUtc`, que faz o round-trip e recusa as duas (devolve `null`). Num TERMO DE RESCISÃO,
 * imprimir "31/02/2025" como data da posse é pior do que não imprimir nada — e o "-" que a `dataBr`
 * devolve para o vazio ainda apagaria a diferença entre "a posse não aconteceu" e "a data está
 * quebrada", que é justamente a distinção que esta rubrica precisa fazer. A duplicação é
 * deliberada: não troque uma pela outra.
 */
export function dataDaPosseEmTexto(dataDaPosse: null | string | undefined): null | string {
  if (!dataDaPosse) return null;
  const data = emUtc(dataDaPosse);
  if (!data) return null;
  const dia = String(data.getUTCDate()).padStart(2, "0");
  const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${data.getUTCFullYear()}`;
}

/** O rótulo da origem, para a tela e para o termo. */
export function rotuloDaOrigem(origem: null | string | undefined): null | string {
  return ORIGENS_DA_POSSE.find((o) => o.valor === origem)?.rotulo ?? null;
}
