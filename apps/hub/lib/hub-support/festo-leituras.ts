// O QUE O FESTOS CONSEGUE APURAR SOZINHO.
//
// Lucas (11/09/2026): *"o agente pode solicitar que ele faça o processo, caminho daquele erro e
// acompanhar esse olhando dentro do codigo, banco para entender o motivo do erro"*.
//
// ⚠️ ESTE ARQUIVO É PURO: recebe os dados já lidos e decide o que é relevante. Nenhuma query, nenhum
// modelo. É o que permite testar a apuração caso a caso — e é onde mora a regra de privacidade que
// nenhuma frase de prompt garantiria.
//
// ⚠️ A REGRA QUE MANDA AQUI: o que o servidor SABE e o que o agente VÊ são coisas diferentes. Para
// achar um chamado parecido é preciso ler a fila inteira, que é de todo mundo; mas o que volta para
// o modelo é só a CONTAGEM e a situação do mais recente. Título alheio, protocolo alheio e o nome de
// quem abriu ficam do lado de cá, e entram no chamado novo como nota interna — que só quem atende lê.

/** Uma entrada do changelog, do jeito reduzido que interessa aqui. */
export type VersaoDoChangelog = {
  deployedAt?: string;
  itens: readonly string[];
  title: string;
  version: string;
};

export type ChamadoParaComparar = {
  abertoEm: string;
  modulo: string;
  protocolo: string;
  situacao: string;
  titulo: string;
};

/**
 * ⚠️ 45 DIAS, E NÃO O HISTÓRICO INTEIRO. "Isso foi corrigido?" só é uma pergunta útil enquanto a
 * correção for recente o bastante para a pessoa ainda estar com a tela velha em cache ou ter ouvido
 * do problema. Uma correção de abril não explica o que ela está vendo hoje, e citá-la faz o Festos
 * parecer que está enrolando.
 */
const JANELA_DE_DIAS = 45;

/** Palavras que aparecem em quase todo relato e não distinguem nada. */
const PALAVRAS_VAZIAS = new Set([
  "para",
  "pelo",
  "pela",
  "com",
  "sem",
  "que",
  "nao",
  "uma",
  "uns",
  "dos",
  "das",
  "por",
  "mais",
  "esta",
  "este",
  "isso",
  "aqui",
  "tela",
  "sistema",
  "panteon",
  "erro",
  "problema",
  "consigo",
  "quando",
  "estou",
  "fazer",
  "ficou",
  "ficar",
  "abrir",
  "botao",
  "pagina",
]);

/**
 * Reduz um texto às palavras que distinguem: sem acento, sem pontuação, sem as vazias, sem as curtas.
 *
 * ⚠️ SEM ACENTO DE PROPÓSITO. Quem escreve para o suporte com pressa escreve "nao", "proposta ta
 * travada", "relatorio" — e uma comparação sensível a acento erraria justamente nos relatos mais
 * apressados, que são a maioria.
 */
export function palavrasQueDistinguem(texto: string): string[] {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((palavra) => palavra.length >= 4 && !PALAVRAS_VAZIAS.has(palavra));
}

/**
 * O começo da palavra, que é o que sobrevive à conjugação.
 *
 * ⚠️ ISTO NASCEU DE UM TESTE QUE FALHOU. Comparando palavra inteira, "não consigo SALVAR a
 * proposta" não casava com o chamado "Proposta não SALVA com dois compradores" — mesmo problema,
 * mesma tela, e o Festos abriria o segundo chamado idêntico sem ver o primeiro. Português conjuga
 * demais para comparação literal: salvar/salva/salvou, imprime/imprimir, carrega/carregando.
 *
 * ⚠️ CINCO LETRAS, e o número é um acordo. Menos que isso cola coisas distintas ("contrato" e
 * "conta" viram "cont"); mais que isso volta a perder a conjugação. Falsos positivos ainda passam —
 * "relatorio" e "relatar" viram "relat" —, e quem segura isso é a exigência de DUAS palavras em
 * comum: casar por acidente em duas ao mesmo tempo é bem mais raro do que em uma.
 */
function radical(palavra: string): string {
  return palavra.slice(0, 5);
}

/** As palavras de um texto, já reduzidas ao radical, sem repetição. */
function radicaisDe(texto: string): Set<string> {
  return new Set(palavrasQueDistinguem(texto).map(radical));
}

/**
 * As mudanças recentes que casam com o que a pessoa descreveu.
 *
 * ⚠️ SÓ OS ITENS AMIGÁVEIS. O `technical.done` de cada versão cita arquivo, migration e variável de
 * ambiente — é escrito para quem faz o deploy. O Festos é proibido de falar disso (está no system
 * dele), e a forma de garantir não é pedir: é não entregar.
 */
export function mudancasRecentes({
  hoje,
  termos,
  versoes,
}: {
  hoje: Date;
  termos: string;
  versoes: readonly VersaoDoChangelog[];
}): Array<{ item: string; quando: string; versao: string }> {
  const procurados = [...radicaisDe(termos)];
  if (procurados.length === 0) return [];

  const limite = new Date(hoje.getTime() - JANELA_DE_DIAS * 24 * 60 * 60 * 1000);
  const achados: Array<{ item: string; quando: string; versao: string }> = [];

  for (const versao of versoes) {
    if (versao.deployedAt) {
      const quando = new Date(versao.deployedAt);
      // Data ilegível não descarta a versão: o pior caso é mostrar algo velho demais, e isso é
      // melhor do que esconder a correção que a pessoa está procurando.
      if (!Number.isNaN(quando.getTime()) && quando < limite) continue;
    }

    for (const item of versao.itens) {
      const doItem = radicaisDe(item);
      const casam = procurados.filter((palavra) => doItem.has(palavra));

      // DUAS palavras em comum, e não uma. Com uma só, "proposta" casa com metade do changelog e o
      // Festos passa a responder "isso foi corrigido" para qualquer coisa — que é pior do que não
      // responder, porque manda a pessoa embora achando que está resolvido.
      if (casam.length >= 2) {
        achados.push({
          item: limparMarcacao(item),
          quando: (versao.deployedAt ?? "").slice(0, 10),
          versao: versao.version,
        });
      }
    }

    if (achados.length >= 6) break;
  }

  return achados.slice(0, 6);
}

/**
 * Quantos chamados parecidos existem na fila — e, só para o servidor, quais são.
 *
 * ⚠️ O RETORNO É DIVIDIDO EM DOIS DE PROPÓSITO. `paraOAgente` é o que pode ser dito em voz alta:
 * quantos e em que pé está o mais recente. `paraANotaInterna` carrega os protocolos, e existe para
 * ser gravado no chamado novo — onde só quem atende lê. Se os dois fossem um só, bastaria o modelo
 * se distrair uma vez para o protocolo de outra pessoa aparecer na tela de quem perguntou.
 */
export function parecidosNaFila({
  chamados,
  termos,
}: {
  chamados: readonly ChamadoParaComparar[];
  termos: string;
}): {
  paraANotaInterna: string[];
  paraOAgente: null | { quantos: number; situacaoDoMaisRecente: string };
} {
  const procurados = [...radicaisDe(termos)];
  if (procurados.length === 0) {
    return { paraANotaInterna: [], paraOAgente: null };
  }

  const parecidos = chamados.filter((chamado) => {
    const doChamado = radicaisDe(`${chamado.titulo} ${chamado.modulo}`);

    return procurados.filter((palavra) => doChamado.has(palavra)).length >= 2;
  });

  if (parecidos.length === 0) {
    return { paraANotaInterna: [], paraOAgente: null };
  }

  // A lista já vem do banco em ordem decrescente de abertura, então o primeiro é o mais recente.
  const maisRecente = parecidos[0];

  return {
    paraANotaInterna: parecidos
      .slice(0, 5)
      .map((chamado) => `${chamado.protocolo} (${chamado.situacao}, ${chamado.abertoEm})`),
    paraOAgente: {
      quantos: parecidos.length,
      situacaoDoMaisRecente: maisRecente?.situacao ?? "novo",
    },
  };
}

/**
 * Tira o markdown do item do changelog.
 *
 * Os itens são escritos com `**negrito**` para o painel de Novidades; dentro de uma conversa, o
 * asterisco vira ruído — e o system do Festos já pede para não usar markdown pesado.
 */
function limparMarcacao(item: string): string {
  return String(item ?? "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
