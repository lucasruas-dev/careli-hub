// O boleto que a Cacá gerou tem que CHEGAR ao cliente, mesmo quando ela responde por voz.
//
// ⚠️ O CONTRATO QUEBRADO QUE ISTO CONSERTA. Dois lados, cada um certo sozinho, que juntos
// sumiam com o boleto:
//   - o PROMPT de voz (lib/iris/caca/persona.ts:236) manda a Cacá NÃO escrever link na
//     resposta falada e "dizer que vai enviar por escrito em seguida";
//   - o CÓDIGO (meta-inbound-processor.ts:2682) só manda por texto quando a resposta TEM URL.
// A Cacá obedecia, tirava o link, o código não via URL, a resposta virava áudio — e o "por
// escrito em seguida" nunca existiu em lugar nenhum. Caso real: AT-013760 (16/09/2026), três
// boletos gerados no Asaas, prometidos em voz, nenhum entregue. Medido: 25 tickets, 33
// boletos gerados com sucesso e nunca entregues desde junho.
//
// ⚠️ O LINK VEM ESTRUTURADO DA FERRAMENTA, NÃO DO RESUMO. O resumo de cada ferramenta é
// cortado em 160 caracteres (lib/ai/claude-agent.ts:264), e uma das mensagens de boleto
// põe o NOME DO CLIENTE antes da URL: com nome longo, a URL sairia cortada. Mandar ao cliente
// um link quebrado é pior do que não mandar.

export type BoletoGerado = {
  parcela: string;
  url: string;
};

function ehUrlValida(url: string): boolean {
  return /^https?:\/\/\S+$/i.test((url ?? "").trim());
}

export function boletosQueFaltamNaResposta(
  gerados: BoletoGerado[],
  textoDaResposta: string,
): BoletoGerado[] {
  const texto = textoDaResposta ?? "";
  const vistas = new Set<string>();
  const faltam: BoletoGerado[] = [];

  for (const boleto of gerados) {
    const url = (boleto.url ?? "").trim();

    // Só sai link de verdade, uma vez só, e só o que o cliente ainda não recebeu no texto.
    if (!ehUrlValida(url) || vistas.has(url) || texto.includes(url)) {
      continue;
    }

    vistas.add(url);
    faltam.push(boleto);
  }

  return faltam;
}

export function mensagemDosBoletos(boletos: BoletoGerado[]): string {
  if (!boletos.length) {
    return "";
  }

  const abertura =
    boletos.length === 1
      ? "Segue o link do boleto:"
      : "Seguem os links dos boletos:";

  // ⚠️ O LINK FICA SOZINHO NA LINHA. Pontuação grudada no fim ("...j." ou "...j,") o WhatsApp
  // engole como parte da URL, e o cliente abre uma página de erro no lugar do boleto.
  const linhas = boletos.map(
    (boleto) => `${boleto.parcela.trim()}\n${boleto.url.trim()}`,
  );

  return [
    abertura,
    "",
    linhas.join("\n\n"),
    "",
    "Confere os dados antes de pagar, tá?",
  ].join("\n");
}
