// O FESTO SE VESTE PARA A DATA.
//
// Lucas (11/09/2026): *"podiamos brincar com as festas nossas, por exemplo, estamos no mes de
// setembro que é a o mes da independencia do brasil, acho que o festo poderia está caracterizado
// com o tema"* e, sobre a bandeira: *"nesse agora ele pode levantar uma bandeira do brasil tipo
// comemorando"*.
//
// ⚠️ ADEREÇO, NUNCA FANTASIA. O que muda é o que ele SEGURA ou VESTE por cima — o robô continua o
// mesmo boneco, com a mesma silhueta e o mesmo rosto. Redesenhar o Festos a cada data faria as
// pessoas perderem a referência visual do suporte quatro vezes por ano, justamente no elemento que
// elas precisam achar sem pensar.
//
// ⚠️ E A JANELA É CURTA, de propósito. Bandeira o mês inteiro vira papel de parede: ninguém repara
// no dia 20 e ninguém sorri. Alguns dias em volta da data mantêm a graça de ser uma aparição.
//
// ⚠️ A DATA É A DO NAVEGADOR DE QUEM OLHA, e não a do servidor. Um traje é enfeite: se o relógio da
// máquina estiver errado, o pior que acontece é o Festos comemorar fora de hora, e ninguém perde
// trabalho por isso. Não vale uma consulta ao servidor.

export type TrajeDoFesto = "bandeira-brasil" | "gorro-natal" | "nenhum";

/**
 * O que o Festos veste na data.
 *
 * Novas datas entram aqui, e em nenhum outro lugar: o desenho de cada adereço mora no componente,
 * mas quem decide QUANDO é esta função — que é pura, e por isso dá para testar sem montar tela.
 */
export function trajeDaData(data: Date): TrajeDoFesto {
  const mes = data.getMonth() + 1;
  const dia = data.getDate();

  // Independência, 7 de setembro. A semana em volta.
  if (mes === 9 && dia >= 2 && dia <= 12) return "bandeira-brasil";

  // Natal e a virada.
  if ((mes === 12 && dia >= 18) || (mes === 1 && dia <= 2)) return "gorro-natal";

  return "nenhum";
}

/** O que o Festos diz quando está caracterizado. Entra no lugar da fala normal, na data. */
export function falasDoTraje(traje: TrajeDoFesto): readonly string[] {
  if (traje === "bandeira-brasil") {
    return [
      "Setembro! Já pensou no feriadão?",
      "Independência chegando. Trabalha menos, respira mais.",
      "Semana da pátria. Bora fechar as pendências antes do feriado?",
    ];
  }
  if (traje === "gorro-natal") {
    return [
      "Fim de ano chegando. Vai com calma no que for pra produção.",
      "Natal na porta. Deixa o deploy grande pra janeiro.",
      "Boas festas! Eu fico de plantão.",
    ];
  }
  return [];
}
