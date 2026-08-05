// COMO O LINK DA FILA CHEGA AO CLIENTE — o texto, o número e o endereço do wa.me.
//
// POR QUE wa.me E NÃO DISPARO PELA IRIS (decisão D1 da spec, resolvida aqui):
//
//   1. A Meta só deixa mandar mensagem livre dentro da janela de 24h de uma conversa que o
//      CLIENTE começou. Ninguém que vai ao lançamento puxou conversa com a gente, então o
//      caminho oficial seria TEMPLATE APROVADO — e template com link variável precisa passar
//      pela revisão da Meta, que leva dias. O evento é 01/08.
//   2. Template tem custo por mensagem, e são até 400 clientes (mais os reenvios de quem
//      apagou). O Lucas já fixou a regra na pré-venda do Asaas: reemissão é LINK, não disparo.
//   3. O parâmetro de template é a nossa armadilha conhecida: quantidade tem que bater e vazio
//      é recusado. Um erro de parâmetro no dia do evento derruba o aviso da fila inteira.
//   4. O wa.me é dependência ZERO: abre o WhatsApp que já está aberto no notebook do atendente
//      (ou o app, no celular do organizador) com o texto pronto. Custa nada, não depende de
//      aprovação e o operador VÊ para quem está mandando antes de apertar enviar.
//
// O preço de escolher wa.me é um toque humano por cliente: não dá para disparar sozinho no
// check-in. Essa parte segue como decisão aberta do Lucas (ver o retorno da task).
//
// Aqui só mora a REGRA (montar número, texto e URL). A assinatura do link é do `link-da-fila.ts`,
// que roda no servidor: esta metade é pura de propósito, para poder ser testada e reusada tanto
// pela tela do atendente quanto pelo app do organizador sem duas versões do mesmo texto.

// O NÚMERO COMO O WHATSAPP ESPERA: só dígitos, com o código do país na frente.
//
// A ordem dos testes é a regra, e ela existe por causa de uma armadilha: DDD 55 EXISTE (Santa
// Maria/RS). Um "55 9xxxx-xxxx" tem 11 dígitos e começa com 55 sem ter código de país nenhum.
// Por isso decidimos primeiro pelo TAMANHO e só depois olhamos o prefixo; na ordem inversa, todo
// cliente do DDD 55 receberia o link num número inexistente.
//
// Nulo = não dá para confiar no número. Quem chama abre o WhatsApp sem destinatário e o operador
// escolhe o contato na mão, que é melhor do que mandar a posição na fila para um estranho.
export function telefoneParaWhatsapp(bruto: string | null | undefined): string | null {
  const digitos = String(bruto ?? "").replace(/\D/g, "");
  if (!digitos) return null;

  // Discagem internacional colada pelo cadastro ("0055 31 ..."): o zero-zero não vai para o JID.
  const semDiscagem = digitos.startsWith("00") ? digitos.slice(2) : digitos;

  // 10 = fixo/celular antigo com DDD, 11 = celular com o nono dígito. Ambos são nacionais.
  if (semDiscagem.length === 10 || semDiscagem.length === 11) {
    return `55${semDiscagem}`;
  }

  // 12/13 dígitos começando com 55: já veio em E.164 (com e sem o nono dígito).
  if (
    (semDiscagem.length === 12 || semDiscagem.length === 13) &&
    semDiscagem.startsWith("55")
  ) {
    return semDiscagem;
  }

  // NÃO consertamos o nono dígito (nem pomos, nem tiramos). Quem faz isso na casa é a Iris, com
  // retry e resposta do provedor para saber se acertou; aqui não há resposta nenhuma — o link
  // simplesmente abriria uma conversa com um número errado, e ninguém ficaria sabendo.
  return null;
}

// O primeiro nome, para o texto soar como gente e não como sistema. Nome vazio devolve "".
export function primeiroNome(nome: string | null | undefined): string {
  return String(nome ?? "").trim().split(/\s+/)[0] ?? "";
}

// O TEXTO DA MENSAGEM. Sem travessão (regra do Lucas para texto que vai ao cliente) e sem
// negrito: o link já é o elemento que salta, e asterisco solto vira lixo quando o cliente cola
// o texto em outro lugar.
export function textoDoConviteDaFila(input: {
  lancamento?: string | null;
  link: string;
  nome: string | null | undefined;
}): string {
  const nome = primeiroNome(input.nome);
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  const lancamento = input.lancamento?.trim();
  const onde = lancamento ? ` do ${lancamento}` : "";

  return `${saudacao} Acompanhe a sua posição na fila${onde} por aqui: ${input.link}`;
}

// O ENDEREÇO QUE ABRE O WHATSAPP com a conversa certa e o texto já digitado.
//
// Sem número reconhecido a URL sai sem destinatário: o WhatsApp abre o seletor de contatos com o
// mesmo texto pronto. É o degrade honesto — o operador perde dois toques, ninguém recebe a
// posição de outra pessoa.
export function urlDoConviteNoWhatsapp(input: {
  lancamento?: string | null;
  link: string;
  nome: string | null | undefined;
  telefone: string | null | undefined;
}): string {
  const texto = encodeURIComponent(
    textoDoConviteDaFila({
      lancamento: input.lancamento,
      link: input.link,
      nome: input.nome,
    }),
  );
  const numero = telefoneParaWhatsapp(input.telefone);

  return numero ? `https://wa.me/${numero}?text=${texto}` : `https://wa.me/?text=${texto}`;
}
