// A FRASE DE QUANDO NÃO SE SABE O ID DO SIGNATÁRIO NA CLICKSIGN.
//
// ⚠️ ELA MORA SOZINHA NUM ARQUIVO SEM DEPENDÊNCIA DE SERVIDOR DE PROPÓSITO. Quem precisa dela são
// as DUAS telas do painel de assinatura (a da Têmis e a do Hades) e a rota; `trocar-signatario.ts`
// arrasta a porta da Clicksign, que lê `process.env`, e não pode ser importado de um componente de
// cliente só para buscar um texto.
//
// ⚠️ E É UMA FRASE SÓ PORQUE AS DUAS TELAS TÊM DE CONTAR A MESMA HISTÓRIA. Medido em 24/09/2026:
// 21 envelopes em `temis_envelopes`, ZERO com `chave` congelada — ou seja, esta é a explicação que
// o operador vê em 100% dos envelopes de hoje. O Hades tinha a frase copiada à mão, com outras
// palavras; a Têmis não tinha frase nenhuma, e o botão simplesmente sumia.
export const RECUSA_DE_REENVIO_SEM_ID =
  "Este envelope foi enviado antes de o Panteon passar a guardar o id do signatário, então o " +
  "reenvio do convite tem de ser feito no painel da Clicksign. Nada foi mexido aqui.";
