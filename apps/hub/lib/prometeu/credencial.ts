// A CREDENCIAL do cliente: o que vai impresso no cracha e o que o organizador le no check-in.
//
// Duas chaves, de proposito:
//
//   QR  -> o id completo do credenciado. A camera le o que for, entao nao ha motivo pra encurtar,
//          e id completo torna IMPOSSIVEL confundir uma pessoa com outra no dia.
//   CODIGO curto -> so pra DIGITAR quando o QR nao le (cracha amassado, sol na camera, celular
//          ruim). E' derivado do id, entao nao precisa de coluna nova nem de contador — mas,
//          sendo curto, e' PROBABILISTICAMENTE ambiguo: com 348 pessoas a chance de dois codigos
//          baterem e' ~0,4%. Por isso quem busca por codigo TEM que tratar o caso de vir mais de
//          um resultado (mostrar os nomes e deixar o organizador escolher), nunca assumir o
//          primeiro. E' o unico jeito de um atalho de emergencia nao virar check-in na pessoa
//          errada.
//
// O QR NAO carrega URL de proposito: o cracha fica pendurado no cliente o evento inteiro e
// qualquer pessoa consegue fotografar. Identificador sozinho nao abre nada sem o app autenticado.

const PREFIXO = "APL";
const TAMANHO_DO_CODIGO = 6;

function apenasHex(valor: string): string {
  return valor.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

// "3f2a9c7b-..." -> "APL-3F2A9C"
export function codigoDaCredencial(credenciadoId: string): string {
  const hex = apenasHex(credenciadoId);

  if (hex.length < TAMANHO_DO_CODIGO) {
    return "";
  }

  return `${PREFIXO}-${hex.slice(0, TAMANHO_DO_CODIGO)}`;
}

// O que e' gravado no QR: o id, cru.
export function conteudoDoQrCredencial(credenciadoId: string): string {
  return credenciadoId.trim();
}

// Aceita o que o organizador digitar: com ou sem prefixo, com ou sem hifen, em qualquer caixa.
export function normalizarCodigoDigitado(digitado: string): string {
  const limpo = digitado.trim().toUpperCase().replace(/\s+/g, "");
  const semPrefixo = limpo.startsWith(`${PREFIXO}-`)
    ? limpo.slice(PREFIXO.length + 1)
    : limpo.startsWith(PREFIXO)
      ? limpo.slice(PREFIXO.length)
      : limpo;

  return apenasHex(semPrefixo).slice(0, TAMANHO_DO_CODIGO);
}

// True quando o codigo digitado aponta para este credenciado. Pode dar true para MAIS DE UM
// credenciado (ver o comentario do topo) — quem chama decide o desempate.
export function credencialCasaComCodigo(
  credenciadoId: string,
  digitado: string,
): boolean {
  const alvo = normalizarCodigoDigitado(digitado);

  if (alvo.length < TAMANHO_DO_CODIGO) {
    return false;
  }

  return apenasHex(credenciadoId).startsWith(alvo);
}

// O que foi lido pela camera e' um id de credencial (e nao um QR de outra coisa qualquer)?
export function ehIdDeCredencial(lido: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    lido.trim(),
  );
}
