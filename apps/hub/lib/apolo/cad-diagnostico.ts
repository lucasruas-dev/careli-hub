// Diagnóstico das CADs importadas: QUEM é o titular de cada ficha, segundo o Asana.
//
// O problema (visto em produção, 21/jul): a leitura de documentos PARA no primeiro anexo que
// devolve um CPF válido. No PDF de um casal esse costuma ser o documento do CÔNJUGE — e aí a
// ficha nasce com a identidade da pessoa errada. Pior: o perfil (telefone, profissão, renda)
// vem do formulário e é do PROPONENTE, então a ficha vira uma costura de duas pessoas.
//
// Exemplo real: CAD do Mateus Lázaro (proponente) com a Karla (cônjuge). A ficha ficou com
// nome/CPF/mãe da Karla e telefone/profissão/renda do Mateus.
//
// A ÂNCORA é o formulário do Asana, que diz explicitamente quem é proponente e quem é cônjuge.
// O documento diz os DADOS de cada um; o Asana diz o LUGAR de cada um.
import { normalizarNome, similaridade } from "@/lib/apolo/asana-import";

export type VereditoCad =
  // O titular da ficha é o proponente. Nada a fazer.
  | "ok"
  // A ficha está com o CÔNJUGE no lugar do proponente. É o caso a corrigir.
  | "trocado"
  // O titular não casa nem com o proponente nem com o cônjuge: ninguém decide isso sozinho.
  | "conferir"
  // Casado, ficha correta, mas o cônjuge não está cadastrado.
  | "falta_conjuge";

export type DiagnosticoCad = {
  detalhe: string;
  // Confiança do casamento de nome que gerou o veredito (0 a 1).
  similaridade: number;
  veredito: VereditoCad;
};

// Casamento DIRETO com o proponente: acima disto a ficha está certa e nem se compara com o
// cônjuge. Mesmo limiar do casamento de CADs do importador.
const LIMIAR_DIRETO = 0.86;
// Piso para considerar que o nome se parece com alguém. Mais baixo de propósito: o nome no
// Apolo veio de OCR e pode ter sobrenome lido errado ("COELHO" virou "COMO").
const LIMIAR_MINIMO = 0.6;
// A vantagem que um lado precisa ter sobre o outro para a decisão ser confiável. Sem isso,
// nomes de família parecidos (mesmo sobrenome) decidiriam a troca no fio do bigode.
const VANTAGEM_MINIMA = 0.25;

// Similaridade nome a nome, comparando TOKEN A TOKEN. A distância de edição sobre a string
// inteira é enganosa aqui: "joao marcos rezende coelho" x "joao marcus rezende como" tem 3 de
// 4 tokens praticamente idênticos e mesmo assim cai para ~0,81 por causa do último sobrenome.
function parecido(a: string, b: string): number {
  const na = normalizarNome(a);
  const nb = normalizarNome(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = na.split(" ").filter(Boolean);
  const tb = nb.split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 0;

  // Cada token do nome mais curto procura seu melhor par no outro. A média resultante tolera
  // um sobrenome lido errado sem tolerar duas pessoas diferentes.
  const [menor, maior] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const soma = menor.reduce(
    (acc, token) => acc + Math.max(...maior.map((outro) => similaridade(token, outro))),
    0,
  );
  return soma / menor.length;
}

// Decide de quem é a ficha, comparando o nome que está no Apolo com os DOIS nomes que o
// formulário do Asana informou.
export function classificarCad(input: {
  casado: boolean;
  // Nome do cônjuge no formulário do Asana.
  conjugeAsana: string | null;
  // Cônjuge já registrado como relacionamento no Apolo.
  conjugeRegistrado: string | null;
  // Nome do proponente no formulário do Asana — a ÂNCORA.
  proponenteAsana: string | null;
  // display_name da entidade no Apolo (hoje vem do documento lido).
  tituloApolo: string;
}): DiagnosticoCad {
  const comProponente = input.proponenteAsana ? parecido(input.tituloApolo, input.proponenteAsana) : 0;
  const comConjuge = input.conjugeAsana ? parecido(input.tituloApolo, input.conjugeAsana) : 0;

  // Sem âncora não se decide nada: a CAD vai para conferência humana.
  if (!input.proponenteAsana) {
    return {
      detalhe: "A CAD do Asana não informa o proponente.",
      similaridade: 0,
      veredito: "conferir",
    };
  }

  const daProponente = (): DiagnosticoCad => {
    if (input.casado && !input.conjugeRegistrado) {
      return {
        detalhe: `Ficha correta (${input.proponenteAsana}), mas é casado e o cônjuge não está cadastrado.`,
        similaridade: comProponente,
        veredito: "falta_conjuge",
      };
    }
    return {
      detalhe: `Titular confere com o proponente (${input.proponenteAsana}).`,
      similaridade: comProponente,
      veredito: "ok",
    };
  };

  // ⚠️ A ORDEM IMPORTA. Casou bem com o proponente: a ficha está certa e nem se compara com o
  // cônjuge. Manter como está é sempre mais seguro do que trocar a identidade por engano.
  if (comProponente >= LIMIAR_DIRETO) return daProponente();

  // Nenhum casamento direto. Aqui a decisão é RELATIVA: dentro de uma CAD só existem dois
  // candidatos, então o que vale é qual deles está claramente na frente. Exigir vantagem
  // mínima evita decidir troca entre marido e mulher de mesmo sobrenome no fio do bigode.
  if (
    comConjuge >= LIMIAR_MINIMO &&
    comConjuge - comProponente >= VANTAGEM_MINIMA
  ) {
    return {
      detalhe:
        `A ficha está com o CÔNJUGE (${input.conjugeAsana}) no lugar do proponente ` +
        `(${input.proponenteAsana}).`,
      similaridade: comConjuge,
      veredito: "trocado",
    };
  }

  if (comProponente >= LIMIAR_MINIMO && comProponente >= comConjuge) return daProponente();

  return {
    detalhe:
      `O titular no Apolo ("${input.tituloApolo}") não casa com o proponente ` +
      `("${input.proponenteAsana}") nem com o cônjuge ("${input.conjugeAsana ?? "—"}").`,
    similaridade: Math.max(comProponente, comConjuge),
    veredito: "conferir",
  };
}
