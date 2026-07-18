// Valores dos lookups do C2X (prod_careli) usados nos seletores do cadastro E
// no envio (users.<campo>_id). id = FK no C2X; label = exibicao. Levantado
// direto das tabelas civil_states / salary_ranges / schoolings / sexes.

export type C2xOption = { id: number; label: string };

export const C2X_SEXO: C2xOption[] = [
  { id: 1, label: "Masculino" },
  { id: 2, label: "Feminino" },
  { id: 3, label: "Não quero informar" },
];

export const C2X_ESTADO_CIVIL: C2xOption[] = [
  { id: 1, label: "Solteiro (a)" },
  { id: 2, label: "Casado (a)" },
  { id: 3, label: "Divorciado (a)" },
  { id: 4, label: "Separado (a) judicialmente" },
  { id: 5, label: "Viúvo (a)" },
  { id: 6, label: "União Estável" },
];

// Regime de bens (property_regimes do C2X, levantado 16/jul). So se aplica a casado /
// uniao estavel; a fonte e a certidao de casamento.
export const C2X_REGIME_BENS: C2xOption[] = [
  { id: 1, label: "Comunhão parcial de bens" },
  { id: 2, label: "Comunhão universal de bens" },
  { id: 3, label: "Separação de bens" },
  { id: 4, label: "Participação final nos aquestos" },
  { id: 5, label: "Regime misto" },
  { id: 6, label: "Pacto antenupcial" },
];

export const C2X_ESCOLARIDADE: C2xOption[] = [
  { id: 1, label: "Analfabeto" },
  { id: 2, label: "Fundamental Incompleto" },
  { id: 3, label: "Fundamental Completo" },
  { id: 4, label: "Médio Incompleto" },
  { id: 5, label: "Médio Completo" },
  { id: 6, label: "Superior Incompleto" },
  { id: 7, label: "Superior Completo" },
  { id: 8, label: "Mestrado" },
  { id: 9, label: "Doutorado" },
];

export const C2X_FAIXA_RENDA: C2xOption[] = [
  { id: 1, label: "Abaixo de 1 salário" },
  { id: 2, label: "1 a 3 salários" },
  { id: 3, label: "3 a 6 salários" },
  { id: 4, label: "6 a 9 salários" },
  { id: 5, label: "9 a 12 salários" },
  { id: 6, label: "Acima de 12 salários" },
];

function normalize(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

// Busca tolerante a acento (ex.: "medico" acha "Médico(a)").
export function normalizeSearch(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Mapeia o estado civil que o enriquecimento devolve (CASADO, SOLTEIRO...) para
// o id do C2X. Retorna null quando nao ha correspondencia.
export function matchEstadoCivilId(label: string): number | null {
  const v = normalize(label);
  if (!v) return null;
  if (v.includes("SOLTEIR")) return 1;
  if (v.includes("CASAD")) return 2;
  if (v.includes("DIVORC")) return 3;
  if (v.includes("SEPARAD")) return 4;
  if (v.includes("VIUV")) return 5;
  if (v.includes("UNIAO") || v.includes("ESTAVEL")) return 6;
  return null;
}

// Casa o regime de bens lido da certidao (texto livre: "COMUNHAO PARCIAL DE BENS",
// "SEPARACAO TOTAL"...) com o id do C2X. Devolve "" quando nao reconhece -- ai o operador
// escolhe na mao. Ordem importa: "universal" antes de "parcial" nao colide, mas "pacto
// antenupcial" costuma vir junto com o regime, entao vem por ultimo.
export function matchRegimeBensId(text: string): string {
  const v = normalize(text);
  if (!v) return "";
  if (v.includes("UNIVERSAL")) return "2";
  if (v.includes("PARCIAL")) return "1";
  if (v.includes("SEPARA")) return "3";
  if (v.includes("AQUESTO") || v.includes("PARTICIPACAO FINAL")) return "4";
  if (v.includes("MISTO")) return "5";
  if (v.includes("ANTENUPCIAL")) return "6";
  return "";
}

// Mapeia genero do enriquecimento (F/M) para o sexo do C2X.
export function matchSexoId(gender: string): number | null {
  const v = normalize(gender);
  if (v.startsWith("M")) return 1;
  if (v.startsWith("F")) return 2;
  return null;
}

// Converte a estimativa de renda do MOST ("2 a 4 salários mínimos", "Abaixo de
// 1"...) para a faixa do C2X (id como string). Usa o limite inferior.
export function matchFaixaRendaId(text: string): string {
  const v = normalize(text);
  if (!v) return "";
  const lower = Number(v.match(/\d+/)?.[0] ?? NaN);
  if (v.includes("ABAIXO") || lower < 1) return "1";
  if (Number.isNaN(lower)) return "";
  if (lower < 3) return "2"; // 1 a 3
  if (lower < 6) return "3"; // 3 a 6
  if (lower < 9) return "4"; // 6 a 9
  if (lower < 12) return "5"; // 9 a 12
  return "6"; // acima de 12
}

// Primeira letra de cada palavra em maiuscula (nome, endereco...).
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s/'-])([a-zà-ú])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

// "1980-05-02" (ou ISO) -> "02/05/1980".
export function formatDateBR(value: string): string {
  const m = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

// Meses (aproximados) entre a data informada e hoje. Aceita dd/mm/aaaa, mm/aaaa
// ou ISO. Retorna null se não parsear. Usado pra saber se o comprovante está
// atual (últimos 3 meses).
export function mesesDesde(value: string): number | null {
  const s = String(value ?? "").trim();
  let y = 0;
  let mo = 0;
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  const br = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const brMes = s.match(/^(\d{2})\/(\d{4})$/);
  if (iso) [y, mo] = [Number(iso[1]), Number(iso[2])];
  else if (br) [mo, y] = [Number(br[2]), Number(br[3])];
  else if (brMes) [mo, y] = [Number(brMes[1]), Number(brMes[2])];
  else return null;
  if (!y || !mo || mo < 1 || mo > 12) return null;
  const now = new Date();
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - mo);
}

// Idade a partir da data de nascimento (aceita ISO ou dd/mm/aaaa).
export function calcIdade(value: string): string {
  let y = 0;
  let mo = 0;
  let d = 0;
  const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  const br = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) [d, mo, y] = [Number(br[1]), Number(br[2]), Number(br[3])];
  else return "";
  const now = new Date();
  let age = now.getFullYear() - y;
  const monthDiff = now.getMonth() - (mo - 1);
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d)) age--;
  return age > 0 && age < 130 ? `${age} anos` : "";
}

// Tipo do documento a partir da classificacao do MOST (identidade OU
// comprovante de endereco). Se nao reconhecer, mostra o que o MOST classificou
// (em vez de um generico), pra facilitar o mapeamento.
export function mapDocType(type: string, stdType = ""): string {
  const v = normalize(`${type} ${stdType}`);
  // Identificacao.
  if (/\bCNH\b|HABILITACAO|DRIVER|MOTORISTA/.test(v)) return "CNH";
  if (/PASSAPORT|PASSPORT/.test(v)) return "Passaporte";
  if (/\bRG\b|IDENTIDADE|IDENTITY|CARTEIRA DE IDENT/.test(v)) return "RG";
  // Comprovantes de endereco.
  if (/LUZ|ENERGIA|ELETRIC|CEMIG|ENEL|LIGHT|COPEL/.test(v)) return "Conta de luz";
  if (/\bAGUA\b|WATER|SANEAMENTO|COPASA|SABESP|SANEPAR/.test(v)) return "Conta de água";
  if (/TELEFON|CELULAR|TELECOM|VIVO|CLARO|TIM|OI\b/.test(v)) return "Conta de telefone";
  if (/\bGAS\b/.test(v)) return "Conta de gás";
  if (/BANC|EXTRATO|FATURA.*CARTAO|CARTAO.*FATURA|CORRESPONDENCIA/.test(v))
    return "Correspondência bancária";
  if (/COMPROVANTE|RESIDENCIA|ENDERECO/.test(v)) return "Comprovante de endereço";
  // Empresa.
  if (/\bCNPJ\b|PESSOA.?JUR|COMPROVANTE.*INSCRI/.test(v)) return "Cartão CNPJ";
  if (/CONTRATO.?SOCIAL/.test(v)) return "Contrato social";

  const raw = String(type || stdType || "").trim();
  // O documentType chega como type+stdType+TAGS concatenados ("formulario form country=bra
  // id=bra-cadastro-cnpj-1 person=legal ..."). Isso e diagnostico, nao rotulo -- jogar na tela
  // despeja a string inteira no campo "Tipo".
  const ehDiagnostico = raw.includes("=") || raw.length > 30;
  return raw && !ehDiagnostico && !/desconhec|unknown/i.test(raw)
    ? titleCase(raw)
    : "Documento";
}
