// O DOCUMENTO BATEU. MAS É A MESMA PESSOA?
//
// A reconciliação (e a trava anti-duplicado que a antecede) casa Apolo x C2X pelo DOCUMENTO, que é
// a chave natural dos dois lados. O buraco desse casamento é silencioso e caro: um CPF digitado
// errado no Apolo bate com OUTRA pessoa no C2X, e a CAD de um vira o cliente de outro — em sistema
// de CONTRATOS. Não existe alarme natural para isso: o `users.id` volta certinho, a gravação dá
// certo, e o erro só aparece quando alguém assina.
//
// Por isso o documento não decide sozinho: o NOME é a segunda testemunha. Ele não serve para
// autorizar (nome igual não prova nada — homônimo existe), serve para VETAR: quando os dois nomes
// não se parecem, ninguém é reconciliado e ninguém é enviado; o par vai para uma lista de suspeitos
// para uma pessoa olhar.
//
// ⚠️ O VETO É DELIBERADAMENTE ASSIMÉTRICO. Um falso suspeito custa um par de olhos por 10 segundos;
// um falso "confere" custa uma CAD ligada ao cliente errado. Então, na dúvida, NÃO CONFERE.
//
// A tolerância é a do mundo real, medida no que o C2X e o Apolo guardam de verdade:
//   • acento e caixa            -> "LUCÉLIA" = "lucelia" (o C2X grava em caixa alta e sem acento);
//   • partículas               -> "MARIA DA SILVA" = "MARIA SILVA";
//   • nome do meio a mais/menos -> "MARIA SILVA" = "MARIA APARECIDA SILVA" (a importação antiga
//                                  truncava, e o wizard novo pede o nome completo);
//   • um erro de digitação por palavra -> "WILLIAN" = "WILLIAM".
// O que NÃO é tolerado é troca de nome próprio ou de sobrenome — que é exatamente o sintoma de CPF
// errado.

// Partículas de ligação. Saem dos dois lados antes da comparação porque uma fonte escreve "MARIA DA
// SILVA" e a outra "MARIA SILVA", e isso nunca foi divergência de identidade.
// "VAN"/"VON"/"DEL" ficam de fora desta lista de propósito: nesses sobrenomes a partícula é parte do
// nome, e removê-la aproximaria nomes que deveriam continuar distantes.
const PARTICULAS = new Set(["DA", "DAS", "DE", "DI", "DO", "DOS", "E"]);

export function normalizarNomeC2x(nome: string | null | undefined): string {
  return String(nome ?? "")
    .normalize("NFD")
    // Tira os diacríticos (a faixa combinante do Unicode), não as letras.
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function palavras(nome: string | null | undefined): string[] {
  return normalizarNomeC2x(nome)
    .split(" ")
    .filter((p) => p.length > 0 && !PARTICULAS.has(p));
}

// ONDE está a única diferença entre duas palavras — não só QUANTAS. Saber a POSIÇÃO é o que separa
// um erro de digitação de uma troca de pessoa: "WILLIAN"/"WILLIAM" (última letra, consoante) e
// "PAULO"/"PAULA" (última letra, vogal) têm a MESMA distância 1 e significados opostos.
//
// Devolve `null` quando há mais de uma edição. Cópia local e minúscula de propósito: o
// `c2x-match.ts` casa texto livre contra LISTA FECHADA (profissão, escolaridade), e misturar as
// duas faria uma mudança de limiar lá mexer em quem vira cliente aqui.
type EdicaoUnica =
  | { i: number; tipo: "substituicao" }
  // Uma letra a mais no lado MAIOR, na posição `i` dele.
  | { i: number; tipo: "insercao" }
  | { tipo: "igual" };

function edicaoUnica(a: string, b: string): EdicaoUnica | null {
  if (a === b) return { tipo: "igual" };

  if (a.length === b.length) {
    let onde = -1;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] === b[i]) continue;
      if (onde !== -1) return null;
      onde = i;
    }
    return onde === -1 ? { tipo: "igual" } : { i: onde, tipo: "substituicao" };
  }

  if (Math.abs(a.length - b.length) !== 1) return null;
  const maior = a.length > b.length ? a : b;
  const menor = a.length > b.length ? b : a;
  for (let i = 0; i < menor.length; i += 1) {
    if (maior[i] === menor[i]) continue;
    // A partir daqui os dois só podem ser iguais se o resto do maior casar com o resto do menor.
    return maior.slice(i + 1) === menor.slice(i) ? { i, tipo: "insercao" } : null;
  }
  // Só sobrou a letra final do maior.
  return { i: menor.length, tipo: "insercao" };
}

// Vogais que marcam GÊNERO em português. Uma diferença que se resume a elas no fim da palavra não é
// erro de digitação: é outra pessoa.
const VOGAIS_DE_GENERO = new Set(["A", "E", "O"]);

// Duas PALAVRAS são a mesma? Igualdade, ou UM erro de digitação em palavra com 5+ letras
// ("WILLIAN"/"WILLIAM"; "ELZA"/"ELSA" não — 4 letras). Abaixo disso uma letra muda o nome inteiro
// ("ANA"/"ANE", "LIA"/"LIS"), e a tolerância viraria a porta de entrada do erro.
//
// 🔴 DUAS EXCEÇÕES, E AS DUAS SAÍRAM DE DADO REAL DE PRODUÇÃO (medido em 08/08 no banco do C2X):
//
//  1. TROCA DA PRIMEIRA LETRA NUNCA É ERRO DE DIGITAÇÃO. No C2X existem, lado a lado, os usuários
//     2135 "VANDER INCOMPLETO" e 2136 "SANDER INCOMPLETO" (pessoas DIFERENTES, mesmo CPF de
//     placeholder), e 3714 "SELIOMAR SIMOES DA SILVA" x 3919 "HELIOMAR SIMOES DA SILVA" (CPFs
//     DIFERENTES). A régua antiga dizia "mesma pessoa" para os dois pares. A primeira letra é o que
//     o olho usa para distinguir nome próprio; tolerá-la é abrir mão da testemunha inteira.
//
//  2. FLEXÃO DE GÊNERO NO FIM DA PALAVRA NUNCA É ERRO DE DIGITAÇÃO — é o cônjuge. "PAULO"/"PAULA",
//     "ROBERTO"/"ROBERTA", "LUCIANO"/"LUCIANA", "FRANCISCO"/"FRANCISCA", "MARIA"/"MARIO" passavam
//     todos. E cônjuge trocado é EXATAMENTE o erro que esta casa já tem catalogado em ficha de CAD
//     (as ~19 fichas com dados do cônjuge): a testemunha do nome não pode ser cega justo nele.
//     "WILLIAN"/"WILLIAM" continua passando porque N e M são consoantes, não marcam gênero.
function mesmaPalavra(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;

  const edicao = edicaoUnica(a, b);
  if (!edicao) return false;
  if (edicao.tipo === "igual") return true;

  // (1) primeira letra: vale para troca E para letra a mais no começo ("ANDERSON"/"SANDERSON").
  if (edicao.i === 0) return false;

  // (2) só a última letra, e as duas são vogais de flexão.
  if (edicao.tipo === "substituicao" && edicao.i === a.length - 1) {
    const fimA = a[edicao.i] ?? "";
    const fimB = b[edicao.i] ?? "";
    if (VOGAIS_DE_GENERO.has(fimA) && VOGAIS_DE_GENERO.has(fimB)) return false;
  }
  // Vogal de flexão SOBRANDO no fim ("LUCIAN"/"LUCIANA" não é a mesma palavra).
  if (edicao.tipo === "insercao") {
    const maior = a.length > b.length ? a : b;
    if (edicao.i === maior.length - 1 && VOGAIS_DE_GENERO.has(maior[edicao.i] ?? "")) return false;
  }

  return true;
}

// O cadastro do C2X está SEM NOME? É um desfecho PRÓPRIO, não uma divergência: não existe nome do
// outro lado para divergir. Quem escreve a recusa precisa saber a diferença, porque as duas mandam
// o operador para lugares opostos — divergência manda conferir o CPF na ficha do Apolo (que pode
// estar certíssimo), e ausência de nome manda preencher o cadastro lá no C2X.
export function semNomeNoC2x(nomeNoC2x: string | null | undefined): boolean {
  return normalizarNomeC2x(nomeNoC2x).length === 0;
}

export type ConfereNomeC2x = {
  confere: boolean;
  // Frase pronta para o card, o log e a lista de suspeitos do ensaio — em PT-BR, dizendo O QUE não
  // bateu. "Os nomes divergem" não é trabalho para ninguém; "o primeiro nome não bate" é.
  motivo: string;
  // O nome do Apolo que melhor casou (ou o primeiro não vazio). A entidade tem até três (display,
  // razão social, nome fantasia) e a lista de suspeitos precisa mostrar o que foi comparado.
  nomeApolo: string | null;
};

// O nome do Apolo pode estar em três campos, e para PJ eles divergem de propósito (o C2X guarda a
// RAZÃO SOCIAL em `users.name`, enquanto o card do Apolo mostra o nome fantasia). Qualquer um que
// case já prova que é a mesma pessoa/empresa — exigir que o campo certo case seria reprovar PJ por
// uma diferença que não é de identidade.
export function confereNomeC2x(
  nomesDoApolo: (string | null | undefined)[],
  nomeNoC2x: string | null | undefined,
): ConfereNomeC2x {
  const candidatos = nomesDoApolo
    .map((n) => String(n ?? "").trim())
    .filter((n) => n.length > 0 && palavras(n).length > 0);
  const primeiro = candidatos[0] ?? null;

  const doC2x = palavras(nomeNoC2x);
  if (doC2x.length === 0) {
    return {
      confere: false,
      motivo: "o cadastro encontrado no C2X está SEM NOME, então não dá para confirmar que é a mesma pessoa.",
      nomeApolo: primeiro,
    };
  }
  if (candidatos.length === 0) {
    return {
      confere: false,
      motivo: "a ficha do Apolo está SEM NOME, então não dá para confirmar que é a mesma pessoa.",
      nomeApolo: null,
    };
  }

  let melhorMotivo = "";
  for (const candidato of candidatos) {
    const resultado = compararUm(palavras(candidato), doC2x);
    if (resultado.confere) return { confere: true, motivo: resultado.motivo, nomeApolo: candidato };
    if (!melhorMotivo) melhorMotivo = resultado.motivo;
  }
  return { confere: false, motivo: melhorMotivo, nomeApolo: primeiro };
}

function compararUm(apolo: string[], c2x: string[]): { confere: boolean; motivo: string } {
  if (apolo.join(" ") === c2x.join(" ")) {
    return { confere: true, motivo: "os nomes são iguais." };
  }

  // O PRIMEIRO NOME É INEGOCIÁVEL. É o campo que muda por completo quando o documento pertence a
  // outra pessoa, e o que menos varia entre as duas fontes da mesma pessoa.
  if (!mesmaPalavra(apolo[0] ?? "", c2x[0] ?? "")) {
    return {
      confere: false,
      motivo: `o primeiro nome não bate ("${apolo[0] ?? ""}" no Apolo x "${c2x[0] ?? ""}" no C2X).`,
    };
  }

  // Só o primeiro nome em comum não prova nada: "MARIA" e "MARIA APARECIDA SILVA" são milhares de
  // pessoas. Com um nome só de cada lado, exige-se igualdade das duas listas inteiras (o caso acima
  // já teria devolvido). Aqui, portanto, um lado com uma palavra só é sempre suspeito.
  const menor = apolo.length <= c2x.length ? apolo : c2x;
  const maior = apolo.length <= c2x.length ? c2x : apolo;
  if (menor.length < 2) {
    return {
      confere: false,
      motivo:
        `um dos lados tem só o primeiro nome ("${menor.join(" ")}"), e primeiro nome igual não ` +
        "prova que é a mesma pessoa.",
    };
  }

  // TODA palavra do nome mais curto tem que aparecer no mais longo. É o que aceita nome do meio a
  // mais (ou a menos) e continua recusando troca de sobrenome. Consumo greedy para o nome repetido
  // ("MARIA MARIA") não casar duas vezes com a mesma palavra do outro lado.
  const disponiveis = [...maior];
  const semPar: string[] = [];
  for (const palavra of menor) {
    const i = disponiveis.findIndex((d) => mesmaPalavra(palavra, d));
    if (i === -1) semPar.push(palavra);
    else disponiveis.splice(i, 1);
  }

  if (semPar.length > 0) {
    return {
      confere: false,
      motivo:
        `os sobrenomes não batem: "${semPar.join(", ")}" está em um lado e não no outro ` +
        `("${apolo.join(" ")}" no Apolo x "${c2x.join(" ")}" no C2X).`,
    };
  }

  return {
    confere: true,
    motivo:
      disponiveis.length > 0
        ? `mesma pessoa, com nome do meio a mais de um lado ("${disponiveis.join(" ")}").`
        : "os nomes são iguais.",
  };
}
