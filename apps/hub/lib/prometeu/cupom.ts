// O CUPOM E OS PROPONENTES DA RESERVA — funções PURAS, seguras para o client.
//
// ⚠️ Este módulo existe para as telas (client) não importarem reservas-evento.ts, que puxa
// mysql2/node:crypto — no build da Vercel isso estoura "Can't resolve 'net'/'tls'" (o bundle
// do navegador tenta empacotar o driver do MySQL). Regra: função sem I/O mora aqui; leitura e
// escrita moram em reservas-evento.ts, que REEXPORTA estas para o servidor usar de um lugar só.

// O código normalizado é a CHAVE da trava única (evento_id, codigo). "vlo0212 " e "VLO0212"
// têm que colidir — por isso a normalização mora aqui e TODO gravador passa por ela.
export function normalizarCodigoDeUnidade(codigo: string): string {
  return String(codigo ?? "")
    .trim()
    .toUpperCase();
}

// Cupom: mesmo desenho da credencial (credencial.ts) — o QR carrega o grupo_id CRU (uuid, sem
// URL: papel fotografado não abre nada fora do app), e o código curto é o plano B digitável.
export function conteudoDoQrDoCupom(grupoId: string): string {
  return grupoId;
}

export function codigoDoCupom(grupoId: string): string {
  return `RSV-${grupoId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export function ehIdDeCupom(lido: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(lido ?? "").trim(),
  );
}

// Até 5 proponentes por reserva (limite do C2X — Lucas, 24/08); com mais de um, a % de
// participação é obrigatória e a soma fecha 100. O 1º é o titular (o credenciado da linha).
export type ProponenteDaReserva = {
  credenciadoId: string;
  documento: null | string;
  // A ENTIDADE DO APOLO da pessoa — é ela que abre a ficha no CRM.
  //
  // ⚠️ Todo credenciado é cadastrado no Apolo (Lucas, 28/08: "todo cliente tem que está
  // cadastrado do apolo, então tem que vim o link sim"), e o vínculo já existe em
  // `prometeu_credenciados.entity_id`. Fica gravado aqui pelo mesmo motivo da origem: quem lê a
  // reserva depois não deveria ter que voltar ao credenciado para descobrir isso.
  entityId?: null | string;
  nome: string;
  // DE ONDE A PESSOA VEIO, como o cupom imprime: "IMOBILIÁRIA · Corretor".
  //
  // ⚠️ Fica GRAVADO na reserva, e não é resolvido depois. A imobiliária de um credenciado sai de
  // uma cadeia (vínculo do Apolo → de-para de texto → coluna crua) que custa dois round-trips
  // por pessoa: barato uma vez, no bip; caro numa tela que lista cem unidades. E, gravada, ela
  // vira o RETRATO do momento da reserva — o mesmo que saiu impresso no cupom que o cliente
  // levou na mão. Opcional porque as reservas antigas não têm.
  origem?: null | string;
  percentual: number;
};

export const MAX_PROPONENTES = 5;

export function validarProponentes(
  proponentes: ProponenteDaReserva[],
): null | string {
  if (proponentes.length === 0) return "Informe ao menos um proponente.";
  if (proponentes.length > MAX_PROPONENTES) {
    return `No máximo ${MAX_PROPONENTES} proponentes (limite do C2X).`;
  }
  const ids = new Set(proponentes.map((p) => p.credenciadoId));
  if (ids.size !== proponentes.length) return "Proponente repetido.";
  const soma = proponentes.reduce((total, p) => total + p.percentual, 0);
  if (Math.abs(soma - 100) > 0.05) {
    return `A participação precisa somar 100% (está em ${soma.toFixed(1)}%).`;
  }
  if (proponentes.some((p) => p.percentual <= 0)) {
    return "Todo proponente precisa de participação maior que zero.";
  }
  return null;
}
