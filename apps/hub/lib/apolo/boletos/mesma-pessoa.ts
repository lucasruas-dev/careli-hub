// DOIS NOMES SÃO DA MESMA PESSOA?
//
// ⚠️ ISTO EXISTE PARA NÃO GRITAR À TOA. O aviso de "mesmo CPF em outra unidade" serve para pegar
// documento trocado — lote revendido que levou o CPF do dono anterior. Só que comparar os nomes
// caractere a caractere acusa onze casos na carteira, e DEZ deles são a mesma pessoa escrita de
// outro jeito:
//
//   SERGIO ANTÔNIO DE SOUSA        ↔  SÉRGIO ANTÔNIO DE SOUZA
//   SIDMAR SOUSA SOARES            ↔  SIDMAR SOUZA SOARES
//   LUIS HENRIQUE SANTIAGO RANGEL  ↔  LUIZ HENRIQUE SANTIAGO RANGEL
//   RAFAEL ASSUNCAO ABREU          ↔  RAFAEL ASSUNÇÃO ABREU
//   WOLMERT MARCUS OLIVEIRA BORGES ↔  WOLMERT MARCUS OLIVEIRA BORGES.
//   ÂNGELA MARIA DE OLIVEIRA       ↔  ANGELA MARIA DE OLIVEIRA EUFRAZIO MACIEL
//   JULIANA FERREIRA TEIXEIRA A.   ↔  JULIANA FERREIRA E ANDRÉ LUIS
//   VAGNER HENRIQUE DAS MERCÊS     ↔  VAGNER E BRUNA  ↔  VAGNER MERCES/BRUNA MAIA
//
// Um aviso que aparece dez vezes errado para acertar uma ensina a ignorar avisos — e aí ele deixa
// de servir justamente no caso que importa.
//
// ⚠️ O QUE SOBRA DEPOIS DO FILTRO É O QUE MERECE OLHAR: `ATHOS FIORAVANTE BARROS BARBOSA` e
// `JFB EMPREEDIMENTOS LTDA` com o mesmo CPF não são erro de grafia de ninguém.

const PARTICULAS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);

/** Sem acento, maiúsculas, pontuação virando espaço, partículas fora. */
function partes(nome: string): string[] {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !PARTICULAS.has(t));
}

/** Distância de edição, para tolerar UMA letra trocada (SOUSA/SOUZA, LUIS/LUIZ) e não mais. */
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    for (let j = 1; j <= b.length; j += 1) {
      atual[j] = Math.min(
        anterior[j]! + 1,
        atual[j - 1]! + 1,
        anterior[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    anterior = atual;
  }
  return anterior[b.length]!;
}

const quaseIgual = (a: string, b: string) => distancia(a, b) <= 1;

/**
 * Os dois nomes podem ser da mesma pessoa?
 *
 * ⚠️ NA DÚVIDA, DIZ QUE SIM — e isso é deliberado. O custo de errar aqui não é simétrico: dizer
 * "sim" a mais só deixa de mostrar um aviso; dizer "não" a mais enche a tela de alarme falso, que é
 * como se perde a confiança em todos os avisos.
 *
 * ⚠️ O PRIMEIRO NOME MANDA. Sobrenome é herdado e se repete no mesmo loteamento; o primeiro nome é
 * o que distingue as pessoas. `CASSIO ALVES DOS SANTOS` e `GETULIO ALVES SANTOS ROSA` compartilham
 * dois sobrenomes e são gente diferente.
 */
export function podeSerAMesmaPessoa(nomeA: string, nomeB: string): boolean {
  const a = partes(nomeA);
  const b = partes(nomeB);
  if (a.length === 0 || b.length === 0) return true;

  // Primeiro nome diferente: pessoas diferentes, e é aqui que o aviso serve.
  if (!quaseIgual(a[0]!, b[0]!)) return false;

  // ⚠️ NOME CURTO É ABREVIAÇÃO, NÃO OUTRA PESSOA. `VAGNER E BRUNA` (o "E" é partícula, sobra
  // `VAGNER BRUNA`) contra `VAGNER HENRIQUE DAS MERCÊS`: mesmo primeiro nome, nenhum sobrenome em
  // comum — e são a mesma pessoa, com o cônjuge no lugar do sobrenome. Com dois nomes de um lado
  // não há sobrenome suficiente para comparar, e exigir isso produziria alarme falso.
  if (a.length <= 2 || b.length <= 2) return true;

  const sobrenomesA = a.slice(1);
  const sobrenomesB = b.slice(1);
  return sobrenomesA.some((x) => sobrenomesB.some((y) => quaseIgual(x, y)));
}
