// Telefone brasileiro no padrão do Apolo: (37) 99956-9096 / (37) 3231-1234.
//
// Existe para duas frentes ao mesmo tempo (pedido do Lucas, 21/jul: "eu só preciso digitar e
// vai criando dentro do formato, e os que trouxerem a mesma coisa"):
//   1. MÁSCARA enquanto o operador digita, para ele não formatar na mão;
//   2. NORMALIZAÇÃO do que veio importado — o formulário do Asana trouxe telefone de tudo
//      quanto é jeito: "37999569096", "(37)998256365", "+55 37 99860-2317",
//      "0379991251532", "3793505-0441/3799909-8584".

export function soDigitosTelefone(valor: string): string {
  let d = String(valor ?? "").replace(/\D/g, "");

  // Vários números no mesmo campo ("fixo/celular"): fica o primeiro, que é o que dá para
  // discar. Guardar os dois juntos não serve para ligação nem para WhatsApp.
  // (o corte real acontece no formatar, aqui só limpamos)

  // +55 na frente: tira o país. Só quando sobra tamanho de número nacional, senão um
  // "5537..." legítimo de Minas seria mutilado.
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);

  // Zero de operadora na frente ("0379991251532").
  if (d.startsWith("0") && d.length >= 11) d = d.slice(1);

  return d;
}

// Formata o que der; o que não der, devolve os dígitos como estão (nunca "some" com o que a
// pessoa digitou — em cadastro, dado torto visível é melhor que dado apagado).
export function formatarTelefoneBR(valor: string): string {
  const bruto = String(valor ?? "");
  // Dois números separados por / ou ; — fica o primeiro.
  const primeiro = bruto.split(/[/;]/)[0] ?? bruto;
  const d = soDigitosTelefone(primeiro);

  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  // Celular com 9 dígitos: (37) 99956-9096
  if (d.length >= 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  // Fixo (10 dígitos) e o meio da digitação: o hífen entra já a partir do 7º dígito, senão
  // o número fica um bolo enquanto a pessoa escreve.
  return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

// Telefone utilizável = DDD + 8 ou 9 dígitos. Serve para não gravar lixo como se fosse número.
export function telefoneCompleto(valor: string): boolean {
  const d = soDigitosTelefone(String(valor ?? "").split(/[/;]/)[0] ?? "");
  return d.length === 10 || d.length === 11;
}
