// O TELEFONE DO CADASTRO, NUM FORMATO SÓ.
//
// ⚠️ A COLUNA CHEGOU COM CINCO FORMATOS DIFERENTES na mesma tela: `62998662052`,
// `+55 37 9905-3938`, `37 9912-3556`, `37 99109-7380`, `31 8822-3571`. Vieram de planilhas
// diferentes, digitadas por pessoas diferentes, ao longo de anos.
//
// ⚠️ E VÁRIOS ESTÃO SEM O NONO DÍGITO, que é o defeito caro: `(37) 9905-3938` é DDD mais OITO
// dígitos, o formato antigo dos celulares. Mandado assim, a Meta responde 131026 ("message
// undeliverable") — a pessoa não recebe nada e o erro parece "esse número não tem WhatsApp". O
// disparo já corrige na hora de enviar, mas o cadastro continua errado, e quem olha a tela para
// conferir vê o número que não funciona.
//
// ⚠️ FIXO NÃO LEVA NONO DÍGITO. Celular começa com 6, 7, 8 ou 9; fixo começa com 2, 3, 4 ou 5.
// Enfiar um 9 num fixo produz um número que não existe — e o disparo falharia do mesmo jeito,
// agora por um erro que nós criamos.

/** `(37) 99905-3938`. Devolve o original quando não reconhece um telefone brasileiro. */
export function telefonePadrao(bruto: null | string | undefined): null | string {
  const original = String(bruto ?? "").trim();
  if (!original) return null;

  // ⚠️ E-MAIL NÃO VIRA TELEFONE. A coluna guarda e-mail em algumas linhas (as empresas da
  // devolutiva vieram assim), e um e-mail passado por `replace(/\D/g)` produz uma sequência de
  // dígitos plausível — que seria um número de outra pessoa.
  if (original.includes("@")) return original;

  let d = original.replace(/\D/g, "");
  if (!d) return original;

  // O DDI do Brasil, quando vem. `55` sozinho na frente de 10 ou 11 dígitos é DDI; em outros
  // tamanhos pode ser o próprio DDD, então só sai quando o resto tem tamanho de telefone.
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);

  if (d.length !== 10 && d.length !== 11) return original;

  const ddd = d.slice(0, 2);
  let numero = d.slice(2);

  // Oito dígitos começando em 6-9: celular no formato antigo, ganha o nono.
  if (numero.length === 8 && /^[6-9]/.test(numero)) numero = `9${numero}`;

  if (numero.length === 9) return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
  return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
}

/** O telefone está num formato que dá para usar? Serve para a tela avisar antes do disparo. */
export function telefoneUtilizavel(bruto: null | string | undefined): boolean {
  const p = telefonePadrao(bruto);
  if (!p) return false;
  return /^\(\d{2}\) 9\d{4}-\d{4}$/.test(p);
}
