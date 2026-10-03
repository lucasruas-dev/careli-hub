// AS FRASES DE QUANDO O REENVIO DE CONVITE (OU A TROCA DE E-MAIL) NÃO PODE SER TENTADO.
//
// ⚠️ ELAS MORAM SOZINHAS NUM ARQUIVO SEM DEPENDÊNCIA DE SERVIDOR DE PROPÓSITO. Quem precisa delas
// são as DUAS telas do painel de assinatura (a da Têmis e a do Hades), a rota e o servidor;
// `trocar-signatario.ts` arrasta a porta da Clicksign, que lê `process.env`, e não pode ser
// importado de um componente de cliente só para buscar um texto.
//
// ⚠️ E CADA MOTIVO TEM UMA FRASE SÓ, PORQUE A TELA E O SERVIDOR TÊM DE CONTAR A MESMA HISTÓRIA.
// Medido em 24/09/2026: 21 envelopes em `temis_envelopes`, ZERO com `chave` congelada — ou seja, a
// explicação daqui era o que o operador via em 100% dos envelopes daquele dia. O Hades tinha a frase
// copiada à mão, com outras palavras; a Têmis não tinha frase nenhuma, e o botão simplesmente sumia.
//
// ⚠️ UMA FRASE SÓ NÃO É O MESMO QUE UMA FRASE PARA TODOS OS MOTIVOS, e foi assim que uma delas
// passou a AFIRMAR O CONTRÁRIO do caso que cobria: `RECUSA_DE_REENVIO_SEM_ID` diz que a pessoa "só
// aparece na lista que o envio congelou", e ela estava sendo mostrada também para quem está SÓ no
// payload do webhook e NÃO está na lista congelada — o inverso exato. Por isso o motivo viaja do
// servidor até a tela (`MotivoDoReenvioBloqueado`), e a frase sai do motivo.

/**
 * POR QUE o reenvio de convite não pode ser tentado nesta linha.
 *
 * ⚠️ A RÉGUA É A DO SERVIDOR, NA MESMA ORDEM. `reenviarConvite` (em `lib/temis/trocar-signatario.ts`)
 * pergunta primeiro o estado do envelope, depois se a chave fala com a Clicksign, depois se a pessoa
 * tem linha no quadro congelado — e o diário calcula o motivo na mesma sequência, para a tela nunca
 * oferecer o gesto que o servidor recusa.
 */
export type MotivoDoReenvioBloqueado =
  /** O envelope já terminou (cancelado, expirado, recusado, assinado): não recebe mais nada. */
  | "envelope_encerrado"
  /** A pessoa não tem linha no quadro congelado: foi acrescentada pelo painel da Clicksign. */
  | "fora_do_quadro"
  /** A `chave` da linha não é id da Clicksign: é o próprio e-mail, `tmp:` ou `c2x:`. */
  | "sem_id_na_clicksign";

/**
 * A FRASE DE QUANDO NÃO SE SABE O ID DO SIGNATÁRIO NA CLICKSIGN.
 *
 * ⚠️ ELA ENCOLHEU MUITO EM 01/10/2026, E O TEXTO MUDOU COM O MOTIVO. "Enviado antes de o Panteon
 * passar a guardar o id" deixou de ser razão para recusar, porque o id NUNCA PRECISOU SER GUARDADO
 * POR NÓS: medido em produção em 01/10/2026 (só SELECT, projeto bxgukywoxgivlrhjkwjx), a `chave` que
 * o envio congela e a `signer.key` que o webhook manda são O MESMO VALOR em 54 de 54 pares (8
 * envelopes, zero diferenças), e nos 18 envelopes vivos sem nenhuma `chave` congelada as 70 pessoas
 * sem `assinado_em` no quadro TODAS têm `signer.key` no payload que já está em
 * `temis_assinatura_eventos` (e 68 delas precisam de convite: 2 já assinaram pelo payload e a marca
 * do quadro ficou atrás). Lucas, no
 * mesmo dia: *"Nao consigo reenviar os contratos."*
 *
 * ⚠️ O QUE SOBROU É O CASO DE QUEM NÃO TEM `signer.key` NENHUMA: a pessoa que só existe na lista
 * congelada do envio, sem linha no payload. Para ela `juntarComOsCongelados` põe o PRÓPRIO E-MAIL na
 * `chave` da tela (`diario-do-envelope-db.ts`), e e-mail nunca é signer id — é esse, e só esse, o 422
 * de 24/09/2026. Medido no mesmo dia: das 55 chaves congeladas e das 160 `signer.key` dos envelopes
 * da Clicksign, ZERO têm "@".
 */
export const RECUSA_DE_REENVIO_SEM_ID =
  "O Panteon não tem o id desta pessoa na Clicksign: ela só aparece na lista que o envio congelou, e " +
  "a Clicksign ainda não avisou nada sobre ela. O reenvio do convite tem de ser feito no painel da " +
  "Clicksign. Nada foi mexido aqui.";

/**
 * A frase de quando o pedido não casa com nenhuma linha do quadro deste envelope.
 *
 * ⚠️ AQUI NÃO SE NOTIFICA ÀS CEGAS, E ISSO É O CORAÇÃO DA GUARDA. Sem achar a linha não se sabe se a
 * pessoa já assinou, e mandar para a Clicksign o `signerId` que veio do navegador é deixar o
 * navegador escolher quem recebe convite dentro de um envelope pago. Medido em produção em
 * 01/10/2026 (só SELECT): nos 18 envelopes vivos sem id, 17 das 87 linhas já têm `assinado_em`.
 *
 * ⚠️ E ELA NÃO PODE SER A DE CIMA, QUE AFIRMA O CONTRÁRIO. `RECUSA_DE_REENVIO_SEM_ID` diz que a
 * pessoa "só aparece na lista que o envio congelou"; aqui é o inverso — ela aparece no payload do
 * webhook e NÃO está na lista congelada. Mostrar uma pela outra manda a operadora ao painel deles
 * pelo motivo errado.
 */
export const RECUSA_DE_QUEM_NAO_ESTA_NO_QUADRO =
  "Esta pessoa NÃO está na lista de signatários que o Panteon guardou deste envelope: ela foi " +
  "acrescentada pelo painel da Clicksign, por fora daqui. Sem a linha dela o Panteon não sabe nem se " +
  "ela já assinou, então o reenvio do convite dela tem de ser feito no painel da Clicksign. Nada foi mexido.";

/**
 * A frase de quando a chave da linha não serve para a TROCA de e-mail.
 *
 * ⚠️ ELA É MAIS DURA QUE A DO REENVIO PORQUE O GESTO É IRREVERSÍVEL. A troca manda o `signerId` cru
 * para `DELETE /envelopes/{id}/signers/{signer_id}`: `tmp:`, `c2x:` e e-mail devolvem 404 (não 403), e
 * o 404 da remoção SEGUE EM FRENTE de propósito — o signatário antigo FICARIA no envelope e um
 * duplicado nasceria com o e-mail novo.
 */
export const RECUSA_DE_CHAVE_QUE_NAO_E_DA_CLICKSIGN =
  "O Panteon não tem o id desta pessoa na Clicksign, e sem ele a troca removeria o signatário errado " +
  "(ou nenhum, deixando o antigo no envelope e criando um duplicado). " +
  "A troca de e-mail desta pessoa tem de ser feita no painel da Clicksign. Nada foi mexido.";

/**
 * A frase de quando o envelope já terminou.
 *
 * ⚠️ E ELA NÃO É ZELO: medido em produção em 01/10/2026 (só SELECT), 3 dos 21 envelopes da Clicksign
 * sem nenhuma `chave` no quadro estão `cancelado` — e nada neste caminho olhava o estado, então eles
 * entrariam no reenvio junto com os 18 vivos. Convite de envelope cancelado é um link morto na caixa
 * de entrada do cliente, e de envelope assinado é um pedido para assinar o que já foi assinado.
 *
 * ⚠️ A FRASE NÃO FALA SÓ DE CONVITE, E ISSO É DELIBERADO: ela serve aos QUATRO lugares em que a mesma
 * verdade é dita — a recusa do reenvio, a recusa da TROCA DE E-MAIL (que também notifica, no passo 4
 * de `trocarEmailDoSignatario`), e os dois tooltips das telas. Uma segunda redação por gesto é como
 * as duas telas do painel de assinatura começaram a contar histórias diferentes
 * ([[reference_painel_assinatura_duas_telas]]).
 */
export function fraseDeEnvelopeEncerrado(estado: string, envelopeId: null | string): string {
  const comoSeDiz: Record<string, string> = {
    assinado: "já está assinado",
    cancelado: "foi cancelado",
    expirado: "expirou",
    recusado: "foi recusado",
  };
  const qual = envelopeId ? `O envelope ${envelopeId}` : "Este envelope";
  return (
    `${qual} ${comoSeDiz[estado] ?? `está ${estado}`}, e envelope encerrado não recebe mais nada: ` +
    "nem convite novo, nem troca de signatário. O link do convite não leva mais a nada. " +
    "Se o documento precisa ir para assinatura de novo, o card volta para a análise e o documento é " +
    "gerado outra vez. Nada foi mexido."
  );
}

/**
 * A FRASE DO MOTIVO — a única tradução de motivo para texto da casa.
 *
 * ⚠️ ELA EXISTE PARA O MOTIVO NÃO VIRAR UM `if` EM CADA TELA. Eram duas telas mostrando a MESMA
 * frase para motivos diferentes (e uma delas afirmava o contrário do caso); com a tradução num lugar
 * só, acrescentar um motivo é acrescentar um texto, e nenhuma tela fica atrás.
 */
export function fraseDoReenvioBloqueado(
  motivo: MotivoDoReenvioBloqueado,
  contexto: { envelopeId?: null | string; estado?: null | string } = {},
): string {
  if (motivo === "envelope_encerrado") {
    return fraseDeEnvelopeEncerrado(contexto.estado ?? "encerrado", contexto.envelopeId ?? null);
  }
  if (motivo === "fora_do_quadro") return RECUSA_DE_QUEM_NAO_ESTA_NO_QUADRO;
  return RECUSA_DE_REENVIO_SEM_ID;
}

/**
 * O AVISO ANTES DE CORRIGIR O E-MAIL: a pessoa vai para o fim da fila.
 *
 * ⚠️ É AVISO, NÃO RECUSA. A Clicksign põe no último degrau + 1 quem é recadastrado num envelope já
 * enviado, e o Lucas aceitou (02/10/2026: *"não tem problema da pessoa ir para o ultimo degrau"*). A
 * frase só existe para ninguém se surpreender depois: ela aparece quando há gente sem assinar que
 * hoje vem DEPOIS desta pessoa (ou junto com ela) e que passa a vir antes. Mora aqui, e não na tela,
 * porque é o diário (`diario-do-envelope-db.ts`) que sabe quantas são.
 */
export function fraseDaTrocaQueVaiParaOFim(nome: string, quantos: number): string {
  const quem = nome.trim() || "Esta pessoa";
  const esperando =
    quantos === 1 ? "1 pessoa que ainda não assinou" : `${quantos} pessoas que ainda não assinaram`;
  return (
    `Ao corrigir o e-mail, ${quem} vai para o fim da fila de assinatura (a Clicksign põe quem é recadastrado depois de todos) ` +
    `e passa a esperar ${esperando}.`
  );
}

// ── TROCAR QUEM ASSINA (03/10/2026) ─────────────────────────────────────────
//
// Lucas, 03/10/2026: *"é basicamente eu tirar uma pessoa e colocar outra para assinar, não precisa
// mudar em nada no cadastro"*. O caso típico é a testemunha ou a vendedora que não pode assinar.
//
// ⚠️ AS FRASES MORAM AQUI PELO MESMO MOTIVO DAS DE CIMA: a tela e o servidor contam a mesma
// história, e este arquivo é o único que os dois podem importar.
//
// ⚠️ VALE PARA TODO PAPEL, INCLUSIVE COMPRADOR E CÔNJUGE. A primeira versão bloqueava os dois (são
// as partes do contrato, com nome e CPF impressos no texto), e o Lucas decidiu o contrário no mesmo
// dia: *"a troca pode ser para qualquer pessoa até o comprador"* (03/10/2026). O texto do contrato
// continua como está; quem precisa de outro texto volta o card para a análise.

/** A frase de quando a troca de pessoa chega pelo portal do incorporador. */
export const RECUSA_DE_TROCA_DE_PESSOA_NO_PORTAL =
  "Trocar quem assina é feito pela equipe da Careli, no hub. Pelo portal dá para corrigir o e-mail de quem assina. Nada foi mexido.";

/** O lembrete do formulário: a troca não mexe no texto do contrato. */
export const AVISO_DA_TROCA_DE_PESSOA =
  "A pessoa nova entra antes de a antiga sair, e só ela recebe o convite. O texto do contrato não muda.";

/** O que fazer quando o erro está no texto, e não em quem assina. */
export const AVISO_DO_TEXTO_DO_CONTRATO =
  "Se o erro está no texto do contrato, trocar quem assina não resolve: o card volta para a análise e o contrato é gerado de novo.";

/**
 * O AVISO ANTES DE TROCAR QUEM ASSINA: quem entra vai para o fim da fila.
 *
 * ⚠️ A MESMA CONTA DE `fraseDaTrocaQueVaiParaOFim`, COM OUTRO SUJEITO. Quem vai para o fim não é a
 * pessoa da linha, é quem entra no lugar dela; e o número de quem passa a vir antes é o mesmo.
 */
export function fraseDaTrocaDePessoaQueVaiParaOFim(nome: string, quantos: number): string {
  const quem = nome.trim() || "esta pessoa";
  const esperando =
    quantos === 1 ? "1 pessoa que ainda não assinou" : `${quantos} pessoas que ainda não assinaram`;
  return (
    `Quem entrar no lugar de ${quem} vai para o fim da fila de assinatura (a Clicksign põe quem entra depois do envio atrás de todos) ` +
    `e passa a esperar ${esperando}.`
  );
}
