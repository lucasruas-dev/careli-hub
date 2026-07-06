// Telefone + país — funções PURAS (client-safe, sem env/fetch), usadas pelo read model do
// C2X (montar o número de envio) e pelo frontend (mostrar a bandeira do país).
//
// Contexto: a tabela `phones` do C2X guarda o país em `phone_code` (ex.: "+1", "+55"), mas
// o número em `phone` é só o nacional. Historicamente o código ignorava o `phone_code` e
// montava tudo como BR, mangulando estrangeiro (ex.: (617) 755-0385 EUA -> +55 (61) 7755-0385).
// Regra validada contra a base (2.366 BR intactos, 283 estrangeiros corrigidos). Ver
// [[project-iris-foreign-phone]].

// Celular BR = DDD (2) + 9 + 8 dígitos. Usado pra detectar erro de cadastro (phone_code
// estrangeiro num número que é claramente um celular BR, ex.: +86 num "(31) 9xxxx-xxxx").
const BR_MOBILE_RE = /^[1-9][0-9]9[0-9]{8}$/;

// Monta o número de WhatsApp em E.164 (só dígitos) respeitando o país do cadastro.
// phone_code = "+55"/vazio -> BR (55 + nacional). Outro país -> código + nacional, SEM a
// lógica do 9º dígito. Celular BR válido é sempre tratado como BR (cobre país errado no
// cadastro). Retorna null se não houver dígitos.
export function buildC2xWhatsAppNumber(
  phoneCode: string | null | undefined,
  phone: string | null | undefined,
): string | null {
  const national = String(phone ?? "").replace(/\D/g, "");

  if (!national) {
    return null;
  }

  const code = String(phoneCode ?? "").replace(/\D/g, ""); // "+55" -> "55", "" -> ""
  const isBrazil = code === "" || code === "55" || BR_MOBILE_RE.test(national);

  if (isBrazil) {
    // Já tem 55 na frente e comprimento de E.164 BR (>=12)? mantém. Senão prefixa 55.
    const withCountry =
      national.startsWith("55") && national.length >= 12
        ? national
        : `55${national}`;

    // 9º dígito: o C2X ainda guarda celular no formato ANTIGO (DDD + 8 dígitos
    // começando em 6-9, ex.: (37) 9938-4413) — sem esta regra o envio sai sem o
    // 9 e a Meta devolve 131026 Message Undeliverable (caso real AT-000229).
    return fixLegacyBrazilianMobileNumber(withCountry);
  }

  // Estrangeiro: E.164 = país + nacional. Tira um "0" de tronco inicial (comum fora do BR).
  const trimmed = national.startsWith("0") ? national.slice(1) : national;

  return trimmed.startsWith(code) ? trimmed : `${code}${trimmed}`;
}

// Celular BR no formato antigo (55 + DDD + 8 dígitos começando em 6-9) ganha o 9º
// dígito. Fixo (assinante começando em 2-5) e qualquer outro formato passam intactos.
// Pura e idempotente — usada no montador e como rede final no disparo ativo.
export function fixLegacyBrazilianMobileNumber(value: string): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  const legacy = /^55([1-9][0-9])([6-9][0-9]{7})$/.exec(digits);

  return legacy ? `55${legacy[1]}9${legacy[2]}` : value;
}

// Código de discagem (só dígitos) -> ISO 3166-1 alpha-2, para os países que aparecem na
// base + os mais comuns. Sem match confiável => null (mostra 🌐).
const DIAL_CODE_TO_ISO2: Record<string, string> = {
  "1": "US", // EUA/Canadá — representativo
  "27": "ZA",
  "31": "NL",
  "32": "BE",
  "33": "FR",
  "34": "ES",
  "351": "PT",
  "352": "LU",
  "353": "IE",
  "39": "IT",
  "41": "CH",
  "44": "GB",
  "49": "DE",
  "51": "PE",
  "52": "MX",
  "54": "AR",
  "55": "BR",
  "56": "CL",
  "57": "CO",
  "58": "VE",
  "595": "PY",
  "598": "UY",
  "61": "AU",
  "81": "JP",
  "86": "CN",
  "91": "IN",
  "971": "AE",
  "972": "IL",
  "351351": "PT",
};

function iso2ToFlagEmoji(iso2: string): string {
  if (!/^[A-Z]{2}$/.test(iso2)) {
    return "🌐";
  }

  return String.fromCodePoint(
    ...[...iso2].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}

// País (ISO2) derivado do phone_code + número, com a MESMA regra do montador (celular BR
// válido = BR mesmo com phone_code estrangeiro). Retorna null se desconhecido.
export function iso2ForC2xPhone(
  phoneCode: string | null | undefined,
  phone: string | null | undefined,
): string | null {
  const national = String(phone ?? "").replace(/\D/g, "");
  const code = String(phoneCode ?? "").replace(/\D/g, "");

  if (code === "" || code === "55" || BR_MOBILE_RE.test(national)) {
    return "BR";
  }

  return DIAL_CODE_TO_ISO2[code] ?? null;
}

// Bandeira (emoji) do número, pra exibir ao lado do telefone. País desconhecido -> 🌐.
export function flagEmojiForC2xPhone(
  phoneCode: string | null | undefined,
  phone: string | null | undefined,
): string {
  const iso2 = iso2ForC2xPhone(phoneCode, phone);

  return iso2 ? iso2ToFlagEmoji(iso2) : "🌐";
}

// Bandeira a partir de um número JÁ em E.164 (só dígitos, COM o país — ex.: "16177550385",
// "5531983440284"). Casa o prefixo de discagem mais longo conhecido (1-3 dígitos). Usado no
// display do telefone do contato/cadastro. Desconhecido -> 🌐.
export function flagEmojiForE164(e164: string | null | undefined): string {
  const digits = String(e164 ?? "").replace(/\D/g, "");

  if (!digits) {
    return "🌐";
  }

  // Número JÁ em E.164 (com país). BR = 55 + 10/11 dígitos = 12/13. Estrangeiro sempre chega
  // com o código (wa_id). Casa o prefixo de discagem mais longo primeiro (ex.: "1" só bate
  // se não houver "351"/"55"/... na frente).
  for (const length of [3, 2, 1]) {
    const iso2 = DIAL_CODE_TO_ISO2[digits.slice(0, length)];

    if (iso2) {
      return iso2ToFlagEmoji(iso2);
    }
  }

  // Sem código de país reconhecido. Neste sistema (BR-first) um número "solto" de 10-11
  // dígitos é um nacional BR guardado sem o 55 (ex.: "31983440284") — não a Holanda.
  if (digits.length >= 10 && digits.length <= 11) {
    return iso2ToFlagEmoji("BR");
  }

  return "🌐";
}

// É estrangeiro (não-BR)? Pra o frontend decidir se destaca.
export function isForeignC2xPhone(
  phoneCode: string | null | undefined,
  phone: string | null | undefined,
): boolean {
  return iso2ForC2xPhone(phoneCode, phone) !== "BR";
}
