"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Lock,
  Mail,
  Pencil,
  Send,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";

import {
  type C2xOption,
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_REGIME_BENS,
  C2X_SEXO,
  calcIdade,
  formatDateBR,
  mapDocType,
  matchEstadoCivilId,
  matchFaixaRendaId,
  matchRegimeBensId,
  matchSexoId,
  mesesDesde,
  normalizeSearch,
  titleCase,
} from "@/lib/apolo/c2x-fields";
import { C2X_PROFISSOES } from "@/lib/apolo/c2x-professions";
import { getHubSupabaseClient } from "@/lib/supabase/client";

import {
  type CadCampo,
  type CadDoc,
  type CadSecao,
} from "./cad-pdf";
import {
  arquivoParaDrive,
  arquivoParaLeitura,
  ehPdf,
  trocarExtensaoParaJpg,
} from "../../lib/document-capture";
import { buscarEnderecoPorCep, soDigitos } from "../../lib/cep";

// Wizard de cadastro de CAD (prospect). Etapas: Identificação -> Endereço ->
// (Cônjuge se casado) -> Revisão. Campos read-only vêm do documento/MOST;
// perfil (sexo/estado civil/escolaridade/renda) usa seletores do C2X.

// Opção de seletor que aceita id numérico (lookups do C2X) ou string (entidades
// do Apolo, como as imobiliárias vindas do read-model).
type SelectOption = { id: number | string; label: string };

type CadastroDraft = Record<string, string>;
type Extraction = {
  cadastro: CadastroDraft;
  // Confiança do documento inteiro, dita pela MOST (result[].score) — é o porteiro.
  confiancaDocumento?: number | null;
  // Recorte tratado que a MOST devolve (endireitado, sem fundo). Vai pro drive no lugar da
  // foto crua quando existir.
  crop?: string;
  documentType: string;
  fields: { confidence: number | null; key: string; label: string; value: string }[];
  overallConfidence: number | null;
};
type Enrichment = {
  available: boolean;
  conjuge: string;
  emails: string[];
  estadoCivil: string;
  nomeMae: string;
  nomePai: string;
  patrimonio: string;
  profissao: string;
  raw?: unknown;
  renda: string;
  sexo: string;
  source: string;
  telefones: string[];
  warnings: string[];
};

const ENRICH_VAZIO: Enrichment = {
  available: false, conjuge: "", emails: [], estadoCivil: "", nomeMae: "",
  nomePai: "", patrimonio: "", profissao: "", renda: "", sexo: "",
  source: "", telefones: [], warnings: [],
};

// Sem RG: o número do RG está sendo extinto (decisão do Lucas 16/jul) — o cadastro se apoia
// no CPF. Isso vale pro titular, pro cônjuge e pra CAD.
// Espelha o CompanyEnrichment do mostqi (o wizard não importa o módulo server-side).
type CompanyEnrichment = {
  atividade: string;
  available: boolean;
  cnae: string;
  dataAbertura: string;
  emails: string[];
  naturezaJuridica: string;
  nomeFantasia: string;
  porte: string;
  razaoSocial: string;
  situacaoCadastral: string;
  socios: Array<{ nome: string; qualificacao: string }>;
  source: string;
  telefones: string[];
  warnings: string[];
};

type Identidade = {
  cpf: string;
  dataNascimento: string;
  // Vêm do próprio documento (a CNH devolve LOCAL_NASCIMENTO e NACIONALIDADE, ~98%).
  nacionalidade: string;
  naturalidade: string;
  nome: string;
  nomeMae: string;
  nomePai: string;
  orgaoEmissor: string;
  tipoDocumento: string;
};
type Endereco = {
  bairro: string;
  cep: string;
  cidade: string;
  complemento: string;
  dataDocumento: string;
  logradouro: string;
  numero: string;
  tipoDocumento: string;
  uf: string;
};
type Perfil = {
  email: string;
  escolaridadeId: string;
  estadoCivilId: string;
  imobiliariaId: string;
  patrimonio: string;
  profissaoId: string;
  // Regime de bens (só casado / união estável). Fonte = certidão de casamento.
  regimeBensId: string;
  rendaEstimada: string;
  rendaId: string;
  sexoId: string;
  telefone: string;
};
// Cônjuge: mesma ficha do titular. Documento (nome/cpf/rg/nascimento/mãe) +
// enriquecimento próprio (sexo, telefone, faixa de renda, patrimônio) +
// escolaridade/profissão manuais. Estado civil herda do titular.
type Conjuge = {
  cpf: string;
  dataNascimento: string;
  documentoLido: boolean;
  email: string;
  escolaridadeId: string;
  // Lidos do documento do próprio cônjuge (o RG dela traz naturalidade e nacionalidade).
  nacionalidade: string;
  naturalidade: string;
  nome: string;
  nomeMae: string;
  patrimonio: string;
  profissaoId: string;
  rendaId: string;
  sexoId: string;
  telefone: string;
};

const CONJUGE_VAZIO: Conjuge = {
  cpf: "", dataNascimento: "", documentoLido: false, email: "",
  escolaridadeId: "", nacionalidade: "", naturalidade: "", nome: "", nomeMae: "",
  patrimonio: "", profissaoId: "", rendaId: "", sexoId: "", telefone: "",
};

// Persona do cadastro, definida pelo documento: RG/CNH -> pessoa física (pf);
// cartão CNPJ -> pessoa jurídica (pj).
type Persona = "pf" | "pj";

// Arquivo que o operador anexou. Fica retido no fluxo porque, no envio, o original vai pro
// drive da entidade junto do CAD (decisão do Lucas: "Arquivos + CAD").
type ArquivoAnexado = { fileBase64: string; fileName: string; mimeType: string };
// Categoria do documento no drive (vira document_type no Apolo).
type DocCategoria =
  | "certidao"
  | "comprovante_endereco"
  | "contrato_social"
  | "identificacao"
  | "identificacao_conjuge";
// N arquivos por categoria: um documento pode ter frente + verso, ou varias paginas.
type DocumentosAnexados = Partial<Record<DocCategoria, ArquivoAnexado[]>>;

// QSA que vem do enriquecimento por CNPJ: informativo, read-only.
type Socio = { nome: string; qualificacao: string };

// Sócio CADASTRADO pelo operador — ficha própria, porque é pessoa física de verdade e é quem
// responde/assina pela empresa. O comprovante de endereço nasce DENTRO do bloco do sócio
// (decisão do Lucas 17/jul): em etapas separadas não dá pra saber qual comprovante é de quem.
// Estado civil é manual e NÃO puxa cônjuge — no PJ o cônjuge não interessa ao negócio.
type SocioCadastro = {
  arquivosComprovante: ArquivoAnexado[];
  arquivosIdentificacao: ArquivoAnexado[];
  cpf: string;
  dataNascimento: string;
  documentoLido: boolean;
  email: string;
  endereco: Endereco;
  estadoCivilId: string;
  id: string;
  nacionalidade: string;
  naturalidade: string;
  nome: string;
  nomeMae: string;
  // Quem assina pela empresa (o contrato social é que define). Sem isto a CAD não habilita
  // contrato, que é o propósito dela.
  representanteLegal: boolean;
  sexoId: string;
  telefone: string;
};

const SOCIO_VAZIO: Omit<SocioCadastro, "id"> = {
  arquivosComprovante: [],
  arquivosIdentificacao: [],
  cpf: "",
  dataNascimento: "",
  documentoLido: false,
  email: "",
  endereco: {
    bairro: "", cep: "", cidade: "", complemento: "", dataDocumento: "",
    logradouro: "", numero: "", tipoDocumento: "", uf: "",
  },
  estadoCivilId: "",
  nacionalidade: "",
  naturalidade: "",
  nome: "",
  nomeMae: "",
  representanteLegal: false,
  sexoId: "",
  telefone: "",
};
// Pessoa jurídica: dados da empresa (cartão CNPJ + enriquecimento por CNPJ) +
// contato + vínculo. Sem sexo/estado civil/escolaridade (isso é PF).
type Empresa = {
  atividade: string;
  cnae: string;
  cnpj: string;
  dataAbertura: string;
  // Data da atualização cadastral. O C2X exige; a fonte é o contrato social (leitura), com
  // fallback pra data de situação cadastral do cartão CNPJ. Prospect não informa NIRE nem
  // inscrição municipal (vão "isento" no C2X) — decisão do Lucas 17/jul.
  dataAtualizacao: string;
  documentoLido: boolean;
  email: string;
  naturezaJuridica: string;
  nomeFantasia: string;
  porte: string;
  razaoSocial: string;
  situacaoCadastral: string;
  socios: Socio[];
  telefone: string;
  tipoDocumento: string;
};

const EMPRESA_VAZIA: Empresa = {
  atividade: "", cnae: "", cnpj: "", dataAbertura: "", dataAtualizacao: "",
  documentoLido: false, email: "", naturezaJuridica: "",
  nomeFantasia: "", porte: "", razaoSocial: "", situacaoCadastral: "",
  socios: [], telefone: "", tipoDocumento: "",
};

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}


// No localhost o token do servidor nao valida (chave de servico de homolog), e
// pra iterar a UI a gente FINGE a leitura: dados de exemplo com um atraso pra
// mostrar a barra de processamento. Em producao o fluxo real roda normal.
const LOCAL_MOCK =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Acha a data de emissão/referência/vencimento do comprovante nos campos lidos
// pelo MOST (pra saber se está atual). Prefere um campo com rótulo de data;
// senão pega a primeira data encontrada.
function acharDataComprovante(fields: Extraction["fields"]): string {
  const dateRe = /\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/;
  const prefer = /emiss|referenc|venc|competenc|data/i;
  for (const field of fields) {
    if (prefer.test(`${field.label} ${field.key}`)) {
      const match = field.value.match(dateRe);
      if (match) return match[0];
    }
  }
  for (const field of fields) {
    const match = field.value.match(dateRe);
    if (match) return match[0];
  }
  return "";
}

function mockIdentidadeExtraction(): Extraction {
  return {
    cadastro: {
      bairro: "", cep: "", cidade: "", complemento: "", cpf: "041.310.596-22",
      dataNascimento: "1980-05-02", logradouro: "", nome: "DANIELLE AGUIAR PACHECO DE OLIVEIRA",
      nacionalidade: "BRASILEIRO A", naturalidade: "PARA DE MINAS / MG",
      nomeMae: "SUELI AGUIAR PACHECO GONCALVES", nomePai: "", numero: "",
      orgaoEmissor: "SSP/MG", sexo: "F", uf: "",
    },
    documentType: "cnh",
    fields: [],
    overallConfidence: 0.96,
  };
}

// Anexo puro (contrato social): nada foi lido, entao nao ha campo, tipo nem score pra conferir.
const EXTRACAO_VAZIA: Extraction = {
  cadastro: {},
  confiancaDocumento: null,
  crop: "",
  documentType: "",
  fields: [],
  overallConfidence: null,
};

function mockSocioExtraction(): Extraction {
  return {
    cadastro: {
      cpf: "058.183.866-19", dataNascimento: "1978-11-20",
      nacionalidade: "BRA", naturalidade: "BELO HORIZONTE",
      nome: "CARLOS EDUARDO PACHECO", nomeMae: "MARIA APARECIDA PACHECO",
      sexo: "M",
    },
    confiancaDocumento: 0.96,
    documentType: "cnh",
    fields: [],
    overallConfidence: 0.96,
  };
}

function mockEnderecoExtraction(): Extraction {
  return {
    cadastro: {
      bairro: "PORTAL DO SOL", cep: "32183-788", cidade: "CONTAGEM",
      logradouro: "RUA ERIDANO", numero: "56", uf: "MG",
    },
    documentType: "conta-de-luz-cemig",
    fields: [
      { confidence: 0.9, key: "data-emissao", label: "Data de emissão", value: "10/06/2026" },
    ],
    overallConfidence: 0.94,
  };
}

function mockConjugeExtraction(): Extraction {
  return {
    cadastro: {
      cpf: "058.183.866-19", dataNascimento: "1978-11-20",
      nacionalidade: "BRASILEIRO A", naturalidade: "BELO HORIZONTE / MG",
      nome: "CARLOS EDUARDO PEREIRA", nomeMae: "MARIA APARECIDA PEREIRA",
      sexo: "M",
    },
    documentType: "cnh",
    fields: [],
    overallConfidence: 0.95,
  };
}

function mockConjugeEnrichment(): Enrichment {
  return {
    available: true, conjuge: "", emails: [], estadoCivil: "CASADO",
    nomeMae: "MARIA APARECIDA PEREIRA", nomePai: "",
    patrimonio: "R$ 250 mil a R$ 500 mil", profissao: "", raw: undefined,
    renda: "3 a 6 salários mínimos", sexo: "M",
    source: "mock", telefones: ["(31) 99123-4567"], warnings: [],
  };
}

// Certidão/consulta oficial devolvida pela análise (PF_02 certidões, PF_03 GOLD).
// MOST classifica o documento. Cartão CNPJ / comprovante de inscrição -> PJ.
function isCnpjDoc(type: string): boolean {
  return /cnpj|cartao.?cnpj|comprovante.*inscri|pessoa.?jur|company|business/i.test(
    String(type ?? ""),
  );
}

function mockPjExtraction(): Extraction {
  return {
    cadastro: {
      bairro: "SAVASSI", cep: "30112-000", cidade: "BELO HORIZONTE",
      cnpj: "12.345.678/0001-90", dataAbertura: "2015-03-12",
      logradouro: "AVENIDA DO CONTORNO", naturezaJuridica: "206-2 - Sociedade Empresária Limitada",
      nomeFantasia: "ORION INCORPORADORA", numero: "8000",
      razaoSocial: "ORION EMPREENDIMENTOS IMOBILIARIOS LTDA",
      situacaoCadastral: "ATIVA", uf: "MG",
    },
    documentType: "cartao-cnpj",
    fields: [],
    overallConfidence: 0.97,
  };
}

// Enriquecimento por CNPJ (mock local): sócios, porte, CNAE, capital, contato.
function mockPjEnrichment(): Partial<Empresa> {
  return {
    atividade: "Incorporação de empreendimentos imobiliários",
    cnae: "41.10-7-00",
    email: "contato@orionincorporadora.com.br",
    naturezaJuridica: "206-2 - Sociedade Empresária Limitada",
    porte: "Empresa de Pequeno Porte (EPP)",
    situacaoCadastral: "ATIVA",
    socios: [
      { nome: "Roberto Andrade Lima", qualificacao: "Sócio-Administrador" },
      { nome: "Fernanda Costa Andrade", qualificacao: "Sócia" },
    ],
    telefone: "(31) 3333-8000",
  };
}

// ---------- telefone internacional (bandeira + formato por país) ----------

type PhoneCountry = { dial: string; flag: string; iso: string; mask: string; name: string };

// Brasil primeiro (padrão). Máscara usa # por dígito.
const BR_PHONE: PhoneCountry = {
  dial: "55", flag: "🇧🇷", iso: "BR", mask: "(##) #####-####", name: "Brasil",
};
const PHONE_COUNTRIES: PhoneCountry[] = [
  BR_PHONE,
  { dial: "351", flag: "🇵🇹", iso: "PT", mask: "### ### ###", name: "Portugal" },
  { dial: "1", flag: "🇺🇸", iso: "US", mask: "(###) ###-####", name: "Estados Unidos" },
  { dial: "54", flag: "🇦🇷", iso: "AR", mask: "## ####-####", name: "Argentina" },
  { dial: "595", flag: "🇵🇾", iso: "PY", mask: "### ### ###", name: "Paraguai" },
  { dial: "598", flag: "🇺🇾", iso: "UY", mask: "#### ####", name: "Uruguai" },
  { dial: "56", flag: "🇨🇱", iso: "CL", mask: "# #### ####", name: "Chile" },
  { dial: "57", flag: "🇨🇴", iso: "CO", mask: "### ### ####", name: "Colômbia" },
  { dial: "591", flag: "🇧🇴", iso: "BO", mask: "### #####", name: "Bolívia" },
  { dial: "34", flag: "🇪🇸", iso: "ES", mask: "### ## ## ##", name: "Espanha" },
  { dial: "39", flag: "🇮🇹", iso: "IT", mask: "### ### ####", name: "Itália" },
  { dial: "33", flag: "🇫🇷", iso: "FR", mask: "# ## ## ## ##", name: "França" },
  { dial: "49", flag: "🇩🇪", iso: "DE", mask: "#### #######", name: "Alemanha" },
  { dial: "44", flag: "🇬🇧", iso: "GB", mask: "##### ######", name: "Reino Unido" },
  { dial: "52", flag: "🇲🇽", iso: "MX", mask: "## #### ####", name: "México" },
  { dial: "244", flag: "🇦🇴", iso: "AO", mask: "### ### ###", name: "Angola" },
];

function applyPhoneMask(digits: string, mask: string): string {
  let out = "";
  let di = 0;
  for (const ch of mask) {
    if (di >= digits.length) break;
    if (ch === "#") out += digits[di++];
    else out += ch;
  }
  if (di < digits.length) out += digits.slice(di);
  return out;
}

function parsePhone(value: string): { country: PhoneCountry; national: string } {
  const v = String(value ?? "").trim();
  if (v.startsWith("+")) {
    const digits = v.replace(/\D/g, "");
    const byLen = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    const match = byLen.find((c) => digits.startsWith(c.dial));
    if (match) return { country: match, national: digits.slice(match.dial.length) };
  }
  return { country: BR_PHONE, national: v.replace(/\D/g, "") };
}

function composePhone(country: PhoneCountry, national: string): string {
  const nat = applyPhoneMask(national, country.mask);
  return nat ? `+${country.dial} ${nat}` : `+${country.dial}`;
}

function mockCertidaoExtraction(): Extraction {
  return {
    cadastro: {},
    documentType: "certidao-casamento",
    fields: [],
    overallConfidence: 0.97,
  };
}

// Tenta achar o REGIME DE BENS na certidão lida pelo MOST. Best-effort de propósito: o
// catálogo de enriquecimento do MOST não tem regime de bens (só estado civil), e não temos
// confirmação de que o iOCR devolve esse campo na certidão. Então primeiro procuramos um campo
// rotulado "regime"; se não houver, varremos os valores atrás do texto do regime. Não achando,
// devolve "" e o operador escolhe na mão — nunca trava o fluxo.
function acharRegimeCertidao(ext: Extraction): string {
  for (const campo of ext.fields) {
    if (/regime/i.test(campo.key) || /regime/i.test(campo.label)) {
      const id = matchRegimeBensId(campo.value);
      if (id) return id;
    }
  }
  for (const campo of ext.fields) {
    const id = matchRegimeBensId(campo.value);
    if (id) return id;
  }
  return "";
}

// MOST valida se o documento e mesmo uma certidao (classificacao do tipo).
function isCertidao(type: string): boolean {
  return /certid|casamento|nascimento|uniao|marriage|birth/i.test(type);
}

// Familia do documento, usando a MESMA classificacao do mapDocType (fonte unica). Serve pra
// barrar documento trocado de etapa: o cadastro pede identificacao e o operador sobe o
// comprovante, o iOCR "meio que le" e a ficha nasce com dado do documento errado.
type FamiliaDoc = "certidao" | "cnpj" | "comprovante" | "identidade" | "outro";

const LABELS_IDENTIDADE = ["RG", "CNH", "Passaporte"];
const LABELS_COMPROVANTE = [
  "Comprovante de endereço",
  "Conta de gás",
  "Conta de luz",
  "Conta de telefone",
  "Conta de água",
  "Correspondência bancária",
];

function familiaDoc(type: string): FamiliaDoc {
  if (isCnpjDoc(type)) return "cnpj";
  if (isCertidao(type)) return "certidao";
  const label = mapDocType(type);
  if (LABELS_IDENTIDADE.includes(label)) return "identidade";
  if (LABELS_COMPROVANTE.includes(label)) return "comprovante";
  return "outro";
}

// Confiança MÍNIMA do documento (o score que a própria MOST dá pro documento inteiro).
// Identificação (RG/CNH/cartão CNPJ) é padronizada: 80%. Comprovante e certidão são documentos
// variados (conta de luz, certidão de cartório) que a MOST lê com menos confiança — 65% (decisão
// do Lucas 17/jul), senão o corte barrava documento legítimo.
const CONFIANCA_MINIMA: Record<FamiliaDoc, number> = {
  certidao: 0.65,
  cnpj: 0.8,
  comprovante: 0.65,
  identidade: 0.8,
  outro: 0.65,
};

// Recusa o documento trocado. So barra quando a leitura reconheceu OUTRA familia com clareza —
// tipo nao reconhecido ("outro") passa, pra nao travar documento legitimo mal classificado.
function conferirDocumento(ext: Extraction, aceitas: FamiliaDoc[], pedido: string): void {
  const familia = familiaDoc(ext.documentType);

  if (familia !== "outro" && !aceitas.includes(familia)) {
    const lido = mapDocType(ext.documentType);
    throw new Error(
      `Documento incorreto: parece ${lido ? `"${lido}"` : "de outro tipo"}. Envie ${pedido}.`,
    );
  }

  // Qualidade do documento: usa o score que a PRÓPRIA MOST dá pro documento inteiro
  // (result[].score). Não usar a média dos campos: ela afunda com QR code / código de segurança
  // e reprovaria documento bom.
  const minima = CONFIANCA_MINIMA[familia];
  const confianca = ext.confiancaDocumento ?? null;
  if (confianca !== null && confianca < minima) {
    throw new Error(
      `A qualidade do documento está ruim (leitura de ${Math.round(confianca * 100)}%, ` +
        `mínimo ${Math.round(minima * 100)}%). Envie outra foto: documento inteiro ` +
        "na imagem, sem reflexo e bem focado.",
    );
  }
}

function mapCertidao(type: string): string {
  const v = type.toLowerCase();
  if (v.includes("casamento")) return "Certidão de casamento";
  if (v.includes("uniao")) return "Certidão de união estável";
  if (v.includes("nascimento")) return "Certidão de nascimento";
  return "Certidão";
}

// Certidão que o CAD exige conforme o estado civil (id do C2X).
function certidaoEsperada(estadoCivilId: string): { hint: string; titulo: string } {
  switch (estadoCivilId) {
    case "3":
      return {
        hint: "Certidão de casamento com averbação do divórcio",
        titulo: "Certidão de casamento (averbação do divórcio)",
      };
    case "4":
      return {
        hint: "Certidão de casamento com averbação da separação",
        titulo: "Certidão de casamento (averbação da separação)",
      };
    case "6":
      return {
        hint: "Certidão ou escritura pública de união estável",
        titulo: "Certidão de união estável",
      };
    default:
      return { hint: "Certidão de casamento atualizada", titulo: "Certidão de casamento" };
  }
}

function mockEnrichmentData(): Enrichment {
  return {
    available: true, conjuge: "", emails: [], estadoCivil: "CASADO",
    nomeMae: "SUELI AGUIAR PACHECO GONCALVES", nomePai: "",
    patrimonio: "R$ 100 mil a R$ 250 mil", profissao: "", raw: undefined,
    renda: "2 a 4 salários mínimos", sexo: "F",
    source: "mock", telefones: ["(31) 98681-5697", "(31) 3466-5697"], warnings: [],
  };
}

async function apiPost<T>(body: Record<string, unknown>): Promise<T> {
  const token = await accessToken();
  const response = await fetch("/api/apolo/mostqi", {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: "POST",
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: T; error?: string }
    | null;
  if (!response.ok || !json?.data) {
    throw new Error(json?.error ?? `Falha HTTP ${response.status}`);
  }
  return json.data;
}

// Fecha o ciclo: cria a ENTIDADE (papel prospect) e salva os documentos + a CAD no drive.
// Diferente do apiPost (que fala com a leitura documental), esta rota escreve no Apolo.
// A CAD volta pronta do servidor (com o código de autenticação impresso).
type SalvarResposta = {
  autenticacao: string;
  cadBase64: string | null;
  entityId: string;
  savedDocs: string[];
  warnings: string[];
};

async function apiSalvarCadastro(body: Record<string, unknown>): Promise<SalvarResposta> {
  const token = await accessToken();
  const response = await fetch("/api/apolo/cadastro/salvar", {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: "POST",
  });
  const json = (await response.json().catch(() => null)) as
    | (Partial<SalvarResposta> & { error?: string })
    | null;
  if (!response.ok || !json?.entityId) {
    throw new Error(json?.error ?? `Falha HTTP ${response.status}`);
  }
  return {
    autenticacao: json.autenticacao ?? "",
    cadBase64: json.cadBase64 ?? null,
    entityId: json.entityId,
    savedDocs: json.savedDocs ?? [],
    warnings: json.warnings ?? [],
  };
}

// Baixa a CAD que o SERVIDOR gerou (base64) — é o mesmo arquivo guardado no drive, com o
// código de autenticação impresso.
function baixarCadBase64(base64: string, nomeArquivo: string): void {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let index = 0; index < binario.length; index += 1) {
    bytes[index] = binario.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo.replace(/[\\/:*?"<>|]+/g, " ").trim();
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function apiGetImobiliarias(): Promise<SelectOption[]> {
  const token = await accessToken();
  const response = await fetch("/api/apolo/imobiliarias", {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: { imobiliarias?: SelectOption[] } }
    | null;
  return json?.data?.imobiliarias ?? [];
}

// ---------- geração do documento CAD (PDF impresso) ----------

type Registro = { completo: string; data: string; hora: string };

function formatRegistro(d: Date): Registro {
  const p = (n: number) => String(n).padStart(2, "0");
  const data = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  const hora = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return { completo: `${data} ${hora}`, data, hora };
}

// Monta um campo estruturado do CAD (o PDF cuida do layout).
function cadField(label: string, value: string, full = false): CadCampo {
  return { full, label, value: (value ?? "").trim() || "—" };
}

function cadSection(title: string, fields: CadCampo[]): CadSecao {
  return { fields, title };
}

export function CadastroFlow() {
  const [step, setStep] = useState(0);
  const [identidade, setIdentidade] = useState<Identidade | null>(null);
  const [perfil, setPerfil] = useState<Perfil>({
    email: "", escolaridadeId: "", estadoCivilId: "", imobiliariaId: "",
    patrimonio: "", profissaoId: "", regimeBensId: "", rendaEstimada: "",
    rendaId: "", sexoId: "", telefone: "",
  });
  const [enrich, setEnrich] = useState<Enrichment | null>(null);
  const [endereco, setEndereco] = useState<Endereco | null>(null);
  const [conjuge, setConjuge] = useState<Conjuge>(CONJUGE_VAZIO);
  // Persona definida pelo documento (RG/CNH -> pf, cartão CNPJ -> pj).
  const [persona, setPersona] = useState<Persona>("pf");
  const [empresa, setEmpresa] = useState<Empresa>(EMPRESA_VAZIA);
  // Originais anexados em cada etapa; vao pro drive da entidade no envio.
  const [documentos, setDocumentos] = useState<DocumentosAnexados>({});
  // Sócios cadastrados (PJ). Cada um carrega os próprios arquivos.
  const [socios, setSocios] = useState<SocioCadastro[]>([]);
  const [imobiliarias, setImobiliarias] = useState<SelectOption[]>([]);

  // Imobiliárias reais do Apolo (read-model), inclusive no localhost: a chave de serviço do
  // .env.local valida contra o projeto de produção (verificado 16/jul), então o antigo gate de
  // LOCAL_MOCK + placeholders só escondia a lista real -- e deixava vincular a CAD a uma
  // imobiliária inexistente. Sem lista, o seletor fica vazio (nunca placeholder).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await apiGetImobiliarias();
        if (alive && list.length) setImobiliarias(list);
      } catch {
        // sem lista: seletor fica vazio
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // PJ não tem certidão/cônjuge. PF: Casado(2), Divorciado(3), Separado(4) e
  // União Estável(6) exigem certidão (o MOST valida a autenticidade).
  const isPj = persona === "pj";
  const needsCertidao = !isPj && ["2", "3", "4", "6"].includes(perfil.estadoCivilId);
  // Cônjuge presente: casado ou união estável (só PF).
  const temConjuge = !isPj && ["2", "6"].includes(perfil.estadoCivilId);
  // PJ tem jornada própria (Lucas 17/jul): o endereço da empresa já vem do cartão CNPJ, então
  // não se pede comprovante dela — o que se pede é o contrato social e a ficha de cada sócio
  // (com o comprovante DELE dentro do próprio bloco).
  const steps = isPj
    ? ["Identificação", "Contrato social", "Sócios", "Revisão"]
    : needsCertidao
      ? ["Identificação", "Endereço", "Certidão", "Revisão"]
      : ["Identificação", "Endereço", "Revisão"];
  const current = steps[Math.min(step, steps.length - 1)];

  function jump(target: number) {
    if (target <= step) setStep(target);
  }

  const reterDocumento = (categoria: DocCategoria) => (arquivo: ArquivoAnexado) =>
    setDocumentos((prev) => ({ ...prev, [categoria]: [...(prev[categoria] ?? []), arquivo] }));

  const activeIndex = Math.min(step, steps.length - 1);
  const pct = Math.round(((activeIndex + 1) / steps.length) * 100);

  return (
    <section className="grid h-full min-h-0 gap-4 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-1 py-1 pb-20">
        <div className="rounded-2xl border border-line bg-surface px-6 py-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] print:hidden">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              Cadastro de CAD
            </h1>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-line bg-subtle px-3 py-1.5 text-xs font-medium text-ink-soft sm:inline-flex">
                <ShieldCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
                Ambiente seguro
              </span>
              <a
                href="/apolo"
                aria-label="Sair do cadastro"
                title="Sair do cadastro"
                className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
              >
                <X className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
          <span className="mt-5 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Etapa {activeIndex + 1} de {steps.length}
          </span>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-inverse transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <Stepper steps={steps} step={step} onJump={jump} />
        </div>

        {current === "Identificação" ? (
          <StepIdentificacao
            conjuge={conjuge}
            empresa={empresa}
            enrich={enrich}
            identidade={identidade}
            imobiliarias={imobiliarias}
            perfil={perfil}
            persona={persona}
            onConjugeChange={(patch) => setConjuge((c) => ({ ...c, ...patch }))}
            onDocumento={reterDocumento("identificacao")}
            onDocumentoConjuge={reterDocumento("identificacao_conjuge")}
            onEmpresaChange={(patch) => setEmpresa((e) => ({ ...e, ...patch }))}
            onEmpresaExtract={(ext, emp) => {
              const c = ext.cadastro;
              // Regra: o DOCUMENTO manda, o enriquecimento cobre o que ele não trouxe.
              // (Antes era `c.campo ?? ""`, que apagava o valor do enriquecimento sempre que o
              // cartão CNPJ não tinha o campo — ou seja, quase sempre.)
              setEmpresa((prev) => ({
                ...prev,
                ...emp,
                atividade: c.atividade || emp.atividade || "",
                cnae: c.cnae || emp.cnae || "",
                cnpj: c.cnpj || emp.cnpj || "",
                dataAbertura: c.dataAbertura || emp.dataAbertura || "",
                // Fallback do cartão pra atualização cadastral; a leitura do contrato social
                // (a fonte preferida) e o aviso ao operador entram com a tela de validação.
                dataAtualizacao: c.dataAtualizacao || "",
                documentoLido: true,
                naturezaJuridica: c.naturezaJuridica || emp.naturezaJuridica || "",
                nomeFantasia: c.nomeFantasia || emp.nomeFantasia || "",
                porte: c.porte || emp.porte || "",
                razaoSocial: c.razaoSocial || emp.razaoSocial || "",
                situacaoCadastral: c.situacaoCadastral || emp.situacaoCadastral || "",
                tipoDocumento: ext.documentType,
              }));
              // O endereço da empresa vem no próprio cartão CNPJ.
              if (c.logradouro || c.cidade) {
                setEndereco({
                  bairro: c.bairro ?? "", cep: c.cep ?? "", cidade: c.cidade ?? "",
                  complemento: "", dataDocumento: "", logradouro: c.logradouro ?? "",
                  numero: c.numero ?? "", tipoDocumento: ext.documentType, uf: c.uf ?? "",
                });
              }
            }}
            onPersona={setPersona}
            onExtract={(ext, enr) => {
              const c = ext.cadastro;
              setIdentidade({
                cpf: c.cpf ?? "", dataNascimento: c.dataNascimento ?? "",
                nacionalidade: c.nacionalidade ?? "",
                naturalidade: c.naturalidade ?? "",
                nome: c.nome ?? "", nomeMae: c.nomeMae || enr.nomeMae,
                nomePai: c.nomePai || enr.nomePai,
                orgaoEmissor: c.orgaoEmissor ?? "",
                tipoDocumento: ext.documentType,
              });
              setPerfil((p) => ({
                ...p,
                email: p.email || enr.emails[0] || "",
                estadoCivilId:
                  matchEstadoCivilId(enr.estadoCivil)?.toString() || p.estadoCivilId,
                patrimonio: p.patrimonio || enr.patrimonio,
                rendaEstimada: enr.renda || p.rendaEstimada,
                rendaId: p.rendaId || matchFaixaRendaId(enr.renda),
                // Sexo: o documento manda (RG/CNH trazem impresso); o enriquecimento é a rede.
                sexoId:
                  matchSexoId(c.sexo ?? "")?.toString() ||
                  matchSexoId(enr.sexo)?.toString() ||
                  p.sexoId,
                telefone: p.telefone || enr.telefones[0] || "",
              }));
              setEnrich(enr);
            }}
            onPerfilChange={(patch) => setPerfil((p) => ({ ...p, ...patch }))}
            onNext={() => setStep(1)}
          />
        ) : null}

        {current === "Contrato social" ? (
          <StepContratoSocial
            anexado={(documentos.contrato_social ?? []).length > 0}
            onBack={() => setStep((v) => v - 1)}
            onDocumento={reterDocumento("contrato_social")}
            onNext={() => setStep((v) => v + 1)}
          />
        ) : null}

        {current === "Sócios" ? (
          <StepSocios
            socios={socios}
            onAdicionar={() =>
              setSocios((lista) => [
                ...lista,
                { ...SOCIO_VAZIO, id: `socio-${Date.now()}-${lista.length}` },
              ])
            }
            onBack={() => setStep((v) => v - 1)}
            onAnexar={(id, campo, arquivo) =>
              // Updater: acumula sobre o estado atual, então frente+verso subidos juntos ficam
              // ambos (o closure sobrescrevia e salvava só o último).
              setSocios((lista) =>
                lista.map((socio) =>
                  socio.id === id ? { ...socio, [campo]: [...socio[campo], arquivo] } : socio,
                ),
              )
            }
            onMudar={(id, patch) =>
              setSocios((lista) =>
                lista.map((socio) => (socio.id === id ? { ...socio, ...patch } : socio)),
              )
            }
            onNext={() => setStep((v) => v + 1)}
            onRemover={(id) => setSocios((lista) => lista.filter((socio) => socio.id !== id))}
          />
        ) : null}

        {current === "Endereço" ? (
          <StepEndereco
            endereco={endereco}
            onDocumento={reterDocumento("comprovante_endereco")}
            onEnderecoChange={(patch) =>
              setEndereco((atual) => ({
                bairro: "", cep: "", cidade: "", complemento: "", dataDocumento: "",
                logradouro: "", numero: "", tipoDocumento: "", uf: "",
                ...atual,
                ...patch,
              }))
            }
            onExtract={(ext) => {
              const c = ext.cadastro;
              setEndereco({
                bairro: c.bairro ?? "", cep: c.cep ?? "", cidade: c.cidade ?? "",
                complemento: "", dataDocumento: acharDataComprovante(ext.fields),
                logradouro: c.logradouro ?? "", numero: c.numero ?? "",
                tipoDocumento: ext.documentType, uf: c.uf ?? "",
              });
            }}
            onBack={() => setStep(step - 1)}
            onNext={() => setStep(step + 1)}
          />
        ) : null}

        {current === "Certidão" ? (
          <StepCertidao
            estadoCivilId={perfil.estadoCivilId}
            onBack={() => setStep(step - 1)}
            onDocumento={reterDocumento("certidao")}
            onNext={() => setStep(step + 1)}
            onPerfilChange={(patch) => setPerfil((p) => ({ ...p, ...patch }))}
            regimeBensId={perfil.regimeBensId}
          />
        ) : null}

        {current === "Revisão" ? (
          <StepRevisao
            conjuge={temConjuge ? conjuge : null}
            documentos={documentos}
            empresa={empresa}
            endereco={endereco}
            identidade={identidade}
            imobiliarias={imobiliarias}
            perfil={perfil}
            persona={persona}
            socios={socios}
            onBack={() => setStep(step - 1)}
          />
        ) : null}
      </div>
    </section>
  );
}

function Stepper({
  onJump,
  step,
  steps,
}: {
  onJump: (n: number) => void;
  step: number;
  steps: string[];
}) {
  return (
    <div className="mt-4 flex items-center">
      {steps.map((label, index) => {
        const state = index === step ? "current" : index < step ? "done" : "todo";
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => onJump(index)}
              disabled={index > step}
              className="flex shrink-0 items-center gap-2"
            >
              <span
                className={[
                  "flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  state === "todo"
                    ? "border-line bg-surface text-ink-muted"
                    : "border-line-strong bg-inverse text-brand-ink",
                ].join(" ")}
              >
                {state === "done" ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span
                className={[
                  "hidden text-xs font-semibold sm:inline",
                  state === "todo" ? "text-ink-muted" : "text-ink",
                ].join(" ")}
              >
                {label}
              </span>
            </button>
            {index < steps.length - 1 ? (
              <div
                className={`mx-2 h-px flex-1 ${index < step ? "bg-inverse/30" : "bg-subtle"}`}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------- uploader ----------

// Um DOCUMENTO pode ter varios arquivos: RG antigo tem os dados partidos entre frente (foto,
// nome, filiacao) e verso (CPF, nascimento, naturalidade), e contrato social tem N paginas.
// Mesclamos o que cada face trouxe: o primeiro valor preenchido ganha, o score do conjunto e o
// da PIOR face, e os campos crus sao concatenados.
function mesclarExtracoes(extracoes: Extraction[]): Extraction {
  const cadastro: CadastroDraft = {};
  const fields: Extraction["fields"] = [];
  const scores: number[] = [];
  const tipos: string[] = [];
  let crop = "";

  for (const ext of extracoes) {
    for (const [chave, valor] of Object.entries(ext.cadastro ?? {})) {
      if (valor && !cadastro[chave]) cadastro[chave] = valor;
    }
    fields.push(...(ext.fields ?? []));
    if (typeof ext.confiancaDocumento === "number") scores.push(ext.confiancaDocumento);
    if (ext.documentType) tipos.push(ext.documentType);
    if (!crop && ext.crop) crop = ext.crop;
  }

  const gerais = extracoes
    .map((ext) => ext.overallConfidence)
    .filter((valor): valor is number => typeof valor === "number");

  return {
    cadastro,
    // Vale a PIOR face: um verso ilegivel nao pode passar escondido atras de uma frente boa.
    confiancaDocumento: scores.length ? Math.min(...scores) : null,
    crop,
    // Junta os tipos: a familia do documento é reconhecida por qualquer uma das faces.
    documentType: tipos.join(" "),
    fields,
    overallConfidence: gerais.length
      ? gerais.reduce((total, valor) => total + valor, 0) / gerais.length
      : null,
  };
}

type ArquivoLido = { arquivo: ArquivoAnexado; ext: Extraction; nome: string };

function DocUploader({
  busy,
  hint,
  label,
  mockData,
  onExtracted,
  onFile,
  // Documento que e SO anexo (contrato social): nao manda pra leitura. Cada arquivo lido e uma
  // consulta cobrada -- um contrato de 8 paginas queimava 8 consultas sem usar nada.
  semLeitura = false,
}: {
  busy?: boolean;
  hint: string;
  label: string;
  mockData?: (file: File) => Extraction;
  onExtracted: (ext: Extraction) => void | Promise<void>;
  onFile?: (arquivo: ArquivoAnexado) => void;
  semLeitura?: boolean;
}) {
  const [lidos, setLidos] = useState<ArquivoLido[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const working = loading || Boolean(busy);
  const done = lidos.length > 0;

  // Ao importar, ja le automaticamente (sem botao).
  async function processFiles(files: File[]) {
    if (!files.length) return;
    setError(null);
    setLoading(true);
    try {
      const novos: ArquivoLido[] = [];

      for (const file of files) {
        let ext: Extraction = EXTRACAO_VAZIA;
        // Rotação que a MOST reconheceu (0 = imagem já em pé, ou PDF, ou anexo puro).
        let graus = 0;

        if (semLeitura) {
          // Anexo puro (contrato): nao le, entao nem gera a versao de alta qualidade.
          ext = EXTRACAO_VAZIA;
        } else if (LOCAL_MOCK && mockData) {
          await delay(1200); // finge a leitura pra mostrar a barra
          ext = mockData(file);
        } else {
          // Foto do WhatsApp costuma vir deitada e a MOST não gira sozinha (result vazio). Tenta
          // em pé; se não reconhecer nada, gira e tenta de novo. PDF não gira. So paga consulta
          // extra quando o documento veio vazio — documento bom lê na primeira.
          const rotacoes = ehPdf(file) ? [0] : [0, 90, 270, 180];
          for (const tentativa of rotacoes) {
            const paraLeitura = await arquivoParaLeitura(file, tentativa);
            ext = await apiPost<Extraction>({
              action: "extract",
              fileBase64: paraLeitura.fileBase64,
              fileName: paraLeitura.fileName,
            });
            // Reconheceu = extraiu ao menos um campo. Não dá pra usar documentType: result vazio
            // volta como "desconhecido" (truthy), o que faria parar sem girar.
            if (ext.fields.length > 0) {
              graus = tentativa;
              break;
            }
          }
        }
        // Pro DRIVE: o recorte tratado da MOST (ja pequeno) se veio; senao, versao comprimida na
        // MESMA rotação que a leitura reconheceu (pro arquivo guardado ficar em pé).
        const arquivo: ArquivoAnexado = ext.crop
          ? {
              fileBase64: ext.crop,
              fileName: trocarExtensaoParaJpg(file.name),
              mimeType: "image/jpeg",
            }
          : await arquivoParaDrive(file, graus);
        novos.push({ arquivo, ext, nome: file.name });
      }

      const todos = [...lidos, ...novos];
      // Alimenta a ficha com TUDO que foi lido (frente + verso). onExtracted valida e LANCA se
      // for o tipo errado / qualidade ruim; por isso os arquivos so sao retidos depois.
      await onExtracted(mesclarExtracoes(todos.map((item) => item.ext)));
      for (const novo of novos) onFile?.(novo.arquivo);
      setLidos(todos);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={working}
        className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong bg-subtle px-4 py-7 text-center transition-colors hover:border-line-strong/40 hover:bg-subtle disabled:cursor-wait"
      >
        {working ? (
          <>
            <Loader2 className="size-6 animate-spin text-ink" aria-hidden="true" />
            <span className="text-sm font-medium text-ink">
              {loading ? "Lendo documento…" : "Consultando dados pelo CPF…"}
            </span>
            <span className="text-xs text-ink-muted">Aguarde um instante</span>
          </>
        ) : done ? (
          <>
            <CheckCircle2 className="size-6 text-emerald-500" aria-hidden="true" />
            <span className="text-sm font-medium text-ink">
              {lidos.length === 1 ? "1 arquivo anexado" : `${lidos.length} arquivos anexados`}
            </span>
            <span className="text-xs text-ink-muted">
              Clique para adicionar mais arquivos
            </span>
          </>
        ) : (
          <>
            <UploadCloud className="size-6 text-ink-muted" aria-hidden="true" />
            <span className="text-sm font-medium text-ink-soft">{label}</span>
            <span className="text-xs text-ink-muted">{hint}</span>
          </>
        )}
      </button>

      {/* Cada arquivo lido do documento (frente, verso, páginas do contrato). */}
      {lidos.length ? (
        <ul className="mt-2 grid gap-1">
          {lidos.map((item, index) => (
            <li
              className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-soft"
              key={`${item.nome}-${index}`}
            >
              <FileText className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item.nome}</span>
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
            </li>
          ))}
        </ul>
      ) : null}

      {/* No PC o seletor aceita varios de uma vez (e clicar de novo acumula); no celular a
          camera tira uma foto por vez e cada foto se soma as anteriores. */}
      <button
        type="button"
        onClick={() => cameraRef.current?.click()}
        disabled={working}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-subtle disabled:cursor-wait disabled:opacity-60"
      >
        <Camera className="size-3.5" aria-hidden="true" />
        Usar câmera do dispositivo
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void processFiles(files);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void processFiles(files);
          event.target.value = "";
        }}
      />
      {working ? (
        <ReadingBar text={loading ? "Lendo documento…" : "Consultando dados pelo CPF…"} />
      ) : null}
      {error ? (
        <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>
      ) : null}
    </div>
  );
}

// Barra de leitura (indeterminada) durante a validação do documento/consulta.
function ReadingBar({ text }: { text: string }) {
  return (
    <div className="mt-3">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
        <ShieldCheck className="size-3 text-emerald-500" aria-hidden="true" />
        {text}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
        <div className="reading-bar h-full w-1/3 rounded-full bg-inverse" />
      </div>
      <style>{`
        @keyframes readingSlide { 0%{transform:translateX(-120%)} 100%{transform:translateX(320%)} }
        .reading-bar { animation: readingSlide 1.1s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// ---------- etapas ----------

function StepCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-4 grid gap-5">{children}</div>
    </div>
  );
}

function Secao({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
        {title}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function NavButtons({
  canNext,
  nextLabel = "Confirmar e avançar",
  onBack,
  onNext,
}: {
  canNext: boolean;
  nextLabel?: string;
  onBack?: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 print:hidden">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink-soft hover:bg-subtle"
        >
          Voltar
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        className="inline-flex h-9 items-center rounded-lg bg-inverse px-5 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {nextLabel}
      </button>
    </div>
  );
}

function StepIdentificacao({
  conjuge,
  empresa,
  enrich,
  identidade,
  imobiliarias,
  onConjugeChange,
  onDocumento,
  onDocumentoConjuge,
  onEmpresaChange,
  onEmpresaExtract,
  onExtract,
  onNext,
  onPerfilChange,
  onPersona,
  perfil,
  persona,
}: {
  conjuge: Conjuge;
  empresa: Empresa;
  enrich: Enrichment | null;
  identidade: Identidade | null;
  imobiliarias: SelectOption[];
  onConjugeChange: (patch: Partial<Conjuge>) => void;
  onDocumento: (arquivo: ArquivoAnexado) => void;
  onDocumentoConjuge: (arquivo: ArquivoAnexado) => void;
  onEmpresaChange: (patch: Partial<Empresa>) => void;
  onEmpresaExtract: (ext: Extraction, emp: Partial<Empresa>) => void;
  onExtract: (ext: Extraction, enr: Enrichment) => void;
  onNext: () => void;
  onPerfilChange: (patch: Partial<Perfil>) => void;
  onPersona: (persona: Persona) => void;
  perfil: Perfil;
  persona: Persona;
}) {
  const [enriching, setEnriching] = useState(false);
  const [enrichingConjuge, setEnrichingConjuge] = useState(false);
  const isPj = persona === "pj";

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailValido = emailRegex.test(perfil.email);
  // Cônjuge presente: casado (2) ou união estável (6).
  const temConjuge = ["2", "6"].includes(perfil.estadoCivilId);
  const estadoCivilLabel =
    C2X_ESTADO_CIVIL.find((o) => o.id.toString() === perfil.estadoCivilId)?.label ?? "";
  const conjugeEmailOk =
    emailRegex.test(conjuge.email) &&
    conjuge.email.trim().toLowerCase() !== perfil.email.trim().toLowerCase();
  const conjugeOk =
    !temConjuge ||
    Boolean(
      conjuge.documentoLido &&
        conjuge.sexoId &&
        conjuge.rendaId &&
        conjuge.escolaridadeId &&
        conjuge.profissaoId &&
        conjugeEmailOk,
    );

  // Lê o documento do cônjuge e, em seguida, enriquece pelo CPF (sexo, telefone,
  // faixa de renda, patrimônio). Escolaridade e profissão continuam manuais.
  async function lerConjuge(ext: Extraction) {
    conferirDocumento(
      ext,
      ["identidade"],
      "o documento de identificação do cônjuge (RG, CNH ou passaporte)",
    );
    const c = ext.cadastro;
    // Barra o documento do PRÓPRIO titular subido no lugar do cônjuge: mesmo CPF (ou, sem
    // CPF legível, mesmo nome) = documento repetido, e a ficha do cônjuge nasceria do titular.
    const soDigitos = (valor: string) => valor.replace(/\D/g, "");
    const mesmoCpf =
      soDigitos(c.cpf ?? "") &&
      soDigitos(c.cpf ?? "") === soDigitos(identidade?.cpf ?? "");
    const mesmoNome =
      normalizeSearch(c.nome ?? "") &&
      normalizeSearch(c.nome ?? "") === normalizeSearch(identidade?.nome ?? "");
    if (mesmoCpf || mesmoNome) {
      throw new Error(
        "Este é o documento do titular. Envie o documento de identificação do cônjuge.",
      );
    }
    setEnrichingConjuge(true);
    let enr: Enrichment = ENRICH_VAZIO;
    try {
      if (LOCAL_MOCK) {
        await delay(1400);
        enr = mockConjugeEnrichment();
      } else {
        enr = await apiPost<Enrichment>({ action: "enrich", cpf: c.cpf ?? "" });
      }
    } catch {
      // enriquecimento é best-effort; segue com o que o documento trouxe
    } finally {
      setEnrichingConjuge(false);
    }
    onConjugeChange({
      cpf: c.cpf ?? "",
      dataNascimento: c.dataNascimento ?? "",
      documentoLido: true,
      nacionalidade: c.nacionalidade ?? "",
      naturalidade: c.naturalidade ?? "",
      nome: c.nome ?? "",
      nomeMae: c.nomeMae || enr.nomeMae,
      patrimonio: conjuge.patrimonio || enr.patrimonio || perfil.patrimonio,
      rendaId: conjuge.rendaId || matchFaixaRendaId(enr.renda),
      sexoId:
        conjuge.sexoId ||
        matchSexoId(c.sexo ?? "")?.toString() ||
        matchSexoId(enr.sexo)?.toString() ||
        "",
      telefone: conjuge.telefone || enr.telefones[0] || "",
    });
  }

  // Lê o cartão CNPJ e enriquece por CNPJ (sócios, porte, CNAE, contato).
  async function lerEmpresa(ext: Extraction) {
    let emp: Partial<Empresa> = {};
    setEnriching(true);
    try {
      if (LOCAL_MOCK) {
        await delay(1400);
        emp = mockPjEnrichment();
      } else {
        // O cartão CNPJ dá o número; razão social, fantasia, abertura, situação e o QSA vêm do
        // enriquecimento por CNPJ (CARELI_PJ_01). Sem isto o fluxo PJ nascia todo vazio.
        const cnpj = ext.cadastro.cnpj ?? "";
        if (cnpj) {
          const dados = await apiPost<CompanyEnrichment>({ action: "enrich-company", cnpj });
          emp = {
            dataAbertura: dados.dataAbertura,
            email: dados.emails[0] ?? "",
            nomeFantasia: dados.nomeFantasia,
            porte: dados.porte,
            razaoSocial: dados.razaoSocial,
            situacaoCadastral: dados.situacaoCadastral,
            socios: dados.socios,
            telefone: dados.telefones[0] ?? "",
          };
        }
      }
    } catch {
      // enriquecimento é best-effort: segue com o que o cartão CNPJ trouxe
    } finally {
      setEnriching(false);
    }
    onEmpresaExtract(ext, emp);
  }

  const podeAvancarPf = Boolean(
    identidade &&
      perfil.sexoId &&
      perfil.estadoCivilId &&
      perfil.escolaridadeId &&
      perfil.rendaId &&
      perfil.profissaoId &&
      perfil.imobiliariaId &&
      emailValido &&
      conjugeOk,
  );
  const podeAvancarPj = Boolean(
    empresa.documentoLido && perfil.imobiliariaId && emailRegex.test(empresa.email),
  );
  const podeAvancar = isPj ? podeAvancarPj : podeAvancarPf;

  return (
    <StepCard title="1. Identificação">
      <Secao title="Vínculo">
        <SearchableSelect
          label="Imobiliária / corretor"
          value={perfil.imobiliariaId}
          options={imobiliarias}
          placeholder="Buscar imobiliária ou corretor…"
          onChange={(v) => onPerfilChange({ imobiliariaId: v })}
        />
      </Secao>

      <p className="m-0 mb-3 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-3 py-2 text-xs text-[#7a5e2c] print:hidden dark:text-[#d9b877]">
        Pessoa física: envie <span className="font-semibold">RG, CNH ou passaporte</span>.
        Pessoa jurídica: envie o <span className="font-semibold">cartão CNPJ</span> — o tipo é
        identificado pelo documento.
      </p>
      <div className="print:hidden">
        <DocUploader
          busy={enriching}
          label="Adicionar documento do cliente"
          hint="RG / CNH (pessoa física) ou cartão CNPJ (empresa) · imagem ou PDF"
          mockData={(file) =>
            // SÓ no localhost (sem MOST): o mock precisa de um palpite pra simular PF ou PJ, e
            // usa o nome do arquivo. Em produção/preview NADA disso roda — o conteúdo vai pra
            // MOST, que lê os pixels. O nome do arquivo (quase sempre vindo do WhatsApp) nunca
            // decide o tipo do documento.
            /cnpj/i.test(file.name) ? mockPjExtraction() : mockIdentidadeExtraction()
          }
          onFile={onDocumento}
          onExtracted={async (ext) => {
            // Aqui só entra documento de identificação (PF) ou cartão CNPJ (PJ).
            conferirDocumento(
              ext,
              ["identidade", "cnpj"],
              "o documento de identificação (RG, CNH ou passaporte) ou o cartão CNPJ",
            );
            if (isCnpjDoc(ext.documentType)) {
              onPersona("pj");
              await lerEmpresa(ext);
              return;
            }
            onPersona("pf");
            setEnriching(true);
            let enr: Enrichment = ENRICH_VAZIO;
            try {
              if (LOCAL_MOCK) {
                await delay(1400);
                enr = mockEnrichmentData();
              } else {
                enr = await apiPost<Enrichment>({
                  action: "enrich",
                  cpf: ext.cadastro.cpf ?? "",
                });
              }
            } catch (err) {
              enr.warnings = [`Enriquecimento falhou: ${(err as Error).message}`];
            } finally {
              setEnriching(false);
            }
            onExtract(ext, enr);
          }}
        />
      </div>

      {isPj ? (
        empresa.documentoLido ? (
          <>
            <Secao title="Dados da empresa">
              <ReadField label="Tipo" value="Cartão CNPJ" />
              <ReadField label="Razão social" value={titleCase(empresa.razaoSocial)} span2 />
              <ReadField label="Nome fantasia" value={titleCase(empresa.nomeFantasia)} />
              <ReadField label="CNPJ" value={empresa.cnpj} />
              <ReadField label="Abertura" value={formatDateBR(empresa.dataAbertura)} />
              <ReadField label="Situação cadastral" value={empresa.situacaoCadastral} />
              <ReadField label="Natureza jurídica" value={empresa.naturezaJuridica} span2 />
              <ReadField label="Porte" value={empresa.porte} />
              <ReadField label="CNAE" value={empresa.cnae} span2 />
              <ReadField label="Atividade principal" value={empresa.atividade} span2 />
            </Secao>

            {empresa.socios.length ? (
              <Secao title="Quadro societário (QSA)">
                {empresa.socios.map((socio, index) => (
                  <ReadField
                    key={`${socio.nome}-${index}`}
                    label={socio.qualificacao || "Sócio"}
                    value={titleCase(socio.nome)}
                    span2
                  />
                ))}
              </Secao>
            ) : null}

            <Secao title="Contato">
              <PhoneField
                value={empresa.telefone}
                sugestoes={[]}
                onChange={(v) => onEmpresaChange({ telefone: v })}
              />
              <div className="sm:col-span-2">
                <EmailField
                  value={empresa.email}
                  onChange={(v) => onEmpresaChange({ email: v })}
                />
              </div>
            </Secao>
          </>
        ) : (
          <p className="text-xs text-ink-muted">
            Envie o cartão CNPJ para ler os dados da empresa.
          </p>
        )
      ) : identidade ? (
        <>
          <Secao title="Dados do documento">
            <ReadField label="Tipo" value={mapDocType(identidade.tipoDocumento, "")} />
            <ReadField label="Nome" value={titleCase(identidade.nome)} span2 />
            <ReadField label="CPF" value={identidade.cpf} />
            <ReadField label="Nascimento" value={formatDateBR(identidade.dataNascimento)} />
            <ReadField label="Idade" value={calcIdade(identidade.dataNascimento)} />
            <ReadField label="Nome da mãe" value={titleCase(identidade.nomeMae)} span2 />
            <ReadField label="Naturalidade" value={titleCase(identidade.naturalidade)} />
            <ReadField label="Nacionalidade" value={titleCase(identidade.nacionalidade)} />
          </Secao>

          <Secao title="Perfil">
            <SelectField
              label="Sexo"
              value={perfil.sexoId}
              options={C2X_SEXO}
              onChange={(v) => onPerfilChange({ sexoId: v })}
            />
            <SelectField
              label="Estado civil"
              value={perfil.estadoCivilId}
              options={C2X_ESTADO_CIVIL}
              onChange={(v) => onPerfilChange({ estadoCivilId: v })}
            />
            <SelectField
              label="Escolaridade"
              value={perfil.escolaridadeId}
              options={C2X_ESCOLARIDADE}
              onChange={(v) => onPerfilChange({ escolaridadeId: v })}
            />
            <SelectField
              label="Faixa de renda"
              value={perfil.rendaId}
              options={C2X_FAIXA_RENDA}
              onChange={(v) => onPerfilChange({ rendaId: v })}
            />
            <TextField
              label="Patrimônio"
              value={perfil.patrimonio}
              placeholder="—"
              onChange={(v) => onPerfilChange({ patrimonio: v })}
            />
            <SearchableSelect
              label="Profissão"
              value={perfil.profissaoId}
              options={C2X_PROFISSOES}
              placeholder="Buscar profissão…"
              onChange={(v) => onPerfilChange({ profissaoId: v })}
            />
          </Secao>

          <Secao title="Contato">
            <PhoneField
              value={perfil.telefone}
              sugestoes={enrich?.telefones ?? []}
              onChange={(v) => onPerfilChange({ telefone: v })}
            />
            <div className="sm:col-span-2">
              <EmailField
                value={perfil.email}
                onChange={(v) => onPerfilChange({ email: v })}
              />
            </div>
          </Secao>

          {temConjuge ? (
            <div className="rounded-xl border border-line bg-subtle p-4">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
                <UserRound className="size-3.5" aria-hidden="true" />
                Cônjuge
              </p>
              <p className="mb-3 text-xs text-ink-muted">
                Mesma ficha do titular. Envie o documento do cônjuge: leitura e
                enriquecimento (sexo, telefone, renda) automáticos.
              </p>
              <div className="print:hidden">
                <DocUploader
                  busy={enrichingConjuge}
                  label="Documento do cônjuge"
                  hint="RG ou CNH · imagem ou PDF"
                  mockData={mockConjugeExtraction}
                  onFile={onDocumentoConjuge}
                  onExtracted={lerConjuge}
                />
              </div>

              {conjuge.documentoLido ? (
                <div className="mt-4 grid gap-5">
                  <Secao title="Dados do documento">
                    <ReadField label="Nome" value={titleCase(conjuge.nome)} span2 />
                    <ReadField label="CPF" value={conjuge.cpf} />
                    <ReadField label="Nascimento" value={formatDateBR(conjuge.dataNascimento)} />
                    <ReadField label="Idade" value={calcIdade(conjuge.dataNascimento)} />
                    <ReadField label="Nome da mãe" value={titleCase(conjuge.nomeMae)} span2 />
                    <ReadField label="Naturalidade" value={titleCase(conjuge.naturalidade)} />
                    <ReadField label="Nacionalidade" value={titleCase(conjuge.nacionalidade)} />
                  </Secao>

                  <Secao title="Perfil do cônjuge">
                    <SelectField
                      label="Sexo"
                      value={conjuge.sexoId}
                      options={C2X_SEXO}
                      onChange={(v) => onConjugeChange({ sexoId: v })}
                    />
                    <ReadField label="Estado civil" value={estadoCivilLabel} />
                    <SelectField
                      label="Escolaridade"
                      value={conjuge.escolaridadeId}
                      options={C2X_ESCOLARIDADE}
                      onChange={(v) => onConjugeChange({ escolaridadeId: v })}
                    />
                    <SelectField
                      label="Faixa de renda"
                      value={conjuge.rendaId}
                      options={C2X_FAIXA_RENDA}
                      onChange={(v) => onConjugeChange({ rendaId: v })}
                    />
                    <TextField
                      label="Patrimônio"
                      value={conjuge.patrimonio}
                      placeholder="—"
                      onChange={(v) => onConjugeChange({ patrimonio: v })}
                    />
                    <SearchableSelect
                      label="Profissão"
                      value={conjuge.profissaoId}
                      options={C2X_PROFISSOES}
                      placeholder="Buscar profissão…"
                      onChange={(v) => onConjugeChange({ profissaoId: v })}
                    />
                  </Secao>

                  <Secao title="Contato do cônjuge">
                    <PhoneField
                      value={conjuge.telefone}
                      sugestoes={[]}
                      onChange={(v) => onConjugeChange({ telefone: v })}
                    />
                    <div className="sm:col-span-2">
                      <EmailField
                        value={conjuge.email}
                        bloquear={perfil.email}
                        bloqueioMsg="O e-mail do cônjuge não pode ser igual ao do titular."
                        onChange={(v) => onConjugeChange({ email: v })}
                      />
                    </div>
                  </Secao>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {enrich && enrich.source !== "mostqi" ? <EnrichWarn enrich={enrich} /> : null}

      <NavButtons canNext={podeAvancar} onNext={onNext} />
    </StepCard>
  );
}

// Selo de comprovante atual (últimos 3 meses) ou desatualizado.
function ComprovanteRecencia({ data }: { data: string }) {
  const meses = mesesDesde(data);
  if (meses === null) {
    return null;
  }
  const atual = meses <= 3;
  const quando = meses <= 0 ? "recente" : `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
        atual
          ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
          : "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300"
      }`}
    >
      {atual ? (
        <CheckCircle2 className="size-4" aria-hidden="true" />
      ) : (
        <AlertTriangle className="size-4" aria-hidden="true" />
      )}
      Comprovante {atual ? "atual" : "desatualizado"} · emitido em {formatDateBR(data)} ({quando}).
    </div>
  );
}

// Contrato social: documento livre (não é formulário padronizado como o cartão CNPJ), então
// aqui ele é ANEXO — não tentamos ler campo dele. É de onde saem os sócios, que o operador
// cadastra na etapa seguinte.
function StepContratoSocial({
  anexado,
  onBack,
  onDocumento,
  onNext,
}: {
  anexado: boolean;
  onBack: () => void;
  onDocumento: (arquivo: ArquivoAnexado) => void;
  onNext: () => void;
}) {
  return (
    <StepCard title="2. Contrato social">
      <p className="m-0 mb-3 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-3 py-2 text-xs text-[#7a5e2c] dark:text-[#d9b877]">
        Envie o <span className="font-semibold">contrato social</span> (ou a última alteração
        consolidada). Pode anexar várias páginas de uma vez.
      </p>
      <div className="print:hidden">
        <DocUploader
          label="Adicionar contrato social"
          hint="Todas as páginas · imagem ou PDF"
          onFile={onDocumento}
          // Anexo puro: documento livre (nao e formulario padronizado), nao ha campo a ler --
          // e cada arquivo lido seria uma consulta cobrada a toa.
          semLeitura
          onExtracted={() => {}}
        />
      </div>
      <NavButtons canNext={anexado} onBack={onBack} onNext={onNext} />
    </StepCard>
  );
}

// Um bloco por sócio: identificação + ficha + comprovante DELE, tudo junto. Em etapas separadas
// não dá pra saber qual comprovante é de qual sócio.
function BlocoSocio({
  aoAnexar,
  aoMudar,
  aoRemover,
  indice,
  podeRemover,
  socio,
}: {
  // Anexa via função updater (não pelo closure): subir frente+verso de uma vez chamava onFile
  // 2x no mesmo render e o segundo sobrescrevia o primeiro — salvava só 1 dos 2 documentos.
  aoAnexar: (campo: "arquivosComprovante" | "arquivosIdentificacao", arquivo: ArquivoAnexado) => void;
  aoMudar: (patch: Partial<SocioCadastro>) => void;
  aoRemover: () => void;
  indice: number;
  podeRemover: boolean;
  socio: SocioCadastro;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold text-ink">
          Sócio {indice + 1}
          {socio.nome ? <span className="text-ink-muted"> · {titleCase(socio.nome)}</span> : null}
        </h3>
        {podeRemover ? (
          <button
            type="button"
            onClick={aoRemover}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Remover
          </button>
        ) : null}
      </div>

      <DocUploader
        label="Adicionar documento de identificação"
        hint="RG, CNH ou passaporte · imagem ou PDF"
        mockData={mockSocioExtraction}
        onFile={(arquivo) =>
          aoAnexar("arquivosIdentificacao", arquivo)
        }
        onExtracted={async (ext) => {
          conferirDocumento(
            ext,
            ["identidade"],
            "o documento de identificação do sócio (RG, CNH ou passaporte)",
          );
          const c = ext.cadastro;
          // Enriquece o sócio por CPF, igual titular e cônjuge: sexo, telefone e nome da mãe.
          // O await mantém o uploader em "consultando" até terminar.
          let enr: Enrichment = ENRICH_VAZIO;
          try {
            if (LOCAL_MOCK) {
              await delay(1200);
              enr = mockConjugeEnrichment();
            } else {
              enr = await apiPost<Enrichment>({ action: "enrich", cpf: c.cpf ?? "" });
            }
          } catch {
            // enriquecimento é best-effort: sem ele, os campos ficam manuais.
          }
          aoMudar({
            cpf: c.cpf ?? "",
            dataNascimento: c.dataNascimento ?? "",
            documentoLido: true,
            nacionalidade: c.nacionalidade ?? "",
            naturalidade: c.naturalidade ?? "",
            nome: c.nome ?? "",
            nomeMae: c.nomeMae || enr.nomeMae || "",
            // Documento manda; enriquecimento é a rede.
            sexoId:
              matchSexoId(c.sexo ?? "")?.toString() ||
              matchSexoId(enr.sexo)?.toString() ||
              socio.sexoId,
            telefone: enr.telefones[0] ?? socio.telefone,
          });
        }}
      />

      {socio.documentoLido ? (
        <>
          <Secao title="Dados do sócio">
            <ReadField label="Nome" value={titleCase(socio.nome)} span2 />
            <ReadField label="CPF" value={socio.cpf} />
            <ReadField label="Nascimento" value={formatDateBR(socio.dataNascimento)} />
            <ReadField label="Nome da mãe" value={titleCase(socio.nomeMae)} span2 />
            <ReadField label="Naturalidade" value={titleCase(socio.naturalidade)} />
            <ReadField label="Nacionalidade" value={titleCase(socio.nacionalidade)} />
          </Secao>

          <Secao title="Perfil do sócio">
            <SelectField
              label="Sexo"
              value={socio.sexoId}
              options={C2X_SEXO}
              onChange={(v) => aoMudar({ sexoId: v })}
            />
            {/* Estado civil é manual e NÃO puxa cônjuge: no PJ o cônjuge não interessa ao
                negócio, só a informação (decisão do Lucas 17/jul). */}
            <SelectField
              label="Estado civil"
              value={socio.estadoCivilId}
              options={C2X_ESTADO_CIVIL}
              onChange={(v) => aoMudar({ estadoCivilId: v })}
            />
          </Secao>

          <Secao title="Contato do sócio">
            <PhoneField
              label="Telefone"
              sugestoes={[]}
              value={socio.telefone}
              onChange={(v) => aoMudar({ telefone: v })}
            />
            <EmailField value={socio.email} onChange={(v) => aoMudar({ email: v })} />
          </Secao>

          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2">
            <input
              type="checkbox"
              checked={socio.representanteLegal}
              onChange={(e) => aoMudar({ representanteLegal: e.target.checked })}
              className="mt-0.5 size-4 accent-[#A07C3B]"
            />
            <span className="text-xs text-ink-soft">
              <span className="font-semibold text-ink">Representante legal</span> — assina pela
              empresa (conforme o contrato social).
            </span>
          </label>

          <div className="mt-4">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Comprovante de endereço do sócio
            </span>
            <DocUploader
              label="Adicionar comprovante de endereço"
              hint="Conta de luz, água, telefone · imagem ou PDF"
              mockData={mockEnderecoExtraction}
              onFile={(arquivo) =>
                aoAnexar("arquivosComprovante", arquivo)
              }
              onExtracted={(ext) => {
                conferirDocumento(
                  ext,
                  ["comprovante"],
                  "um comprovante de endereço (conta de luz, água ou telefone)",
                );
                const emissao = acharDataComprovante(ext.fields);
                const meses = emissao ? mesesDesde(emissao) : null;
                if (meses !== null && meses > 3) {
                  throw new Error(
                    `Comprovante vencido: emitido há ${meses} meses (${formatDateBR(emissao)}). ` +
                      "Envie um comprovante com até 3 meses de emissão.",
                  );
                }
                const c = ext.cadastro;
                aoMudar({
                  endereco: {
                    bairro: c.bairro ?? "",
                    cep: c.cep ?? "",
                    cidade: c.cidade ?? "",
                    complemento: "",
                    dataDocumento: emissao ?? "",
                    logradouro: c.logradouro ?? "",
                    numero: c.numero ?? "",
                    tipoDocumento: ext.documentType,
                    uf: c.uf ?? "",
                  },
                });
              }}
            />
            {/* Aviso quando a MOST não leu o comprovante (foto ruim/girada): o documento já ficou
                salvo, e o operador reenvia ou preenche pelo CEP. */}
            {socio.arquivosComprovante.length > 0 &&
            !socio.endereco.logradouro &&
            !socio.endereco.cidade ? (
              <p className="m-0 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300">
                Não consegui ler o endereço no comprovante. O documento foi salvo — envie a conta
                inteira e bem enquadrada para tentar de novo, ou preencha pelo CEP abaixo.
              </p>
            ) : null}

            {/* CEP-first: digitou o CEP, o endereço vem sozinho. Aparece após anexar o
                comprovante (preenchido pela leitura quando a MOST lê). */}
            {socio.arquivosComprovante.length > 0 ? (
              <EnderecoEditavel
                endereco={socio.endereco}
                onChange={(patch) => aoMudar({ endereco: { ...socio.endereco, ...patch } })}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function StepSocios({
  onAdicionar,
  onAnexar,
  onBack,
  onMudar,
  onNext,
  onRemover,
  socios,
}: {
  onAdicionar: () => void;
  onAnexar: (
    id: string,
    campo: "arquivosComprovante" | "arquivosIdentificacao",
    arquivo: ArquivoAnexado,
  ) => void;
  onBack: () => void;
  onMudar: (id: string, patch: Partial<SocioCadastro>) => void;
  onNext: () => void;
  onRemover: (id: string) => void;
  socios: SocioCadastro[];
}) {
  // Cada sócio precisa de documento lido, estado civil, sexo e comprovante; e alguém tem que
  // assinar pela empresa, senão a CAD não habilita contrato.
  const completos = socios.every(
    (socio) =>
      socio.documentoLido &&
      socio.sexoId &&
      socio.estadoCivilId &&
      socio.arquivosComprovante.length > 0 &&
      socio.endereco.logradouro.trim() &&
      socio.endereco.cidade.trim(),
  );
  const temRepresentante = socios.some((socio) => socio.representanteLegal);

  return (
    <StepCard title="3. Sócios">
      <div className="grid gap-4">
        {socios.map((socio, index) => (
          <BlocoSocio
            aoAnexar={(campo, arquivo) => onAnexar(socio.id, campo, arquivo)}
            aoMudar={(patch) => onMudar(socio.id, patch)}
            aoRemover={() => onRemover(socio.id)}
            indice={index}
            key={socio.id}
            podeRemover={socios.length > 1}
            socio={socio}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onAdicionar}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-subtle px-3 py-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-subtle/70"
      >
        <UserRound className="size-3.5" aria-hidden="true" />
        Adicionar sócio
      </button>

      {socios.length && !temRepresentante ? (
        <p className="m-0 mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">
          Marque quem é o representante legal (quem assina pela empresa).
        </p>
      ) : null}

      <NavButtons
        canNext={socios.length > 0 && completos && temRepresentante}
        onBack={onBack}
        onNext={onNext}
      />
    </StepCard>
  );
}

function StepEndereco({
  endereco,
  onBack,
  onDocumento,
  onEnderecoChange,
  onExtract,
  onNext,
}: {
  endereco: Endereco | null;
  onBack: () => void;
  onDocumento: (arquivo: ArquivoAnexado) => void;
  onEnderecoChange: (patch: Partial<Endereco>) => void;
  onExtract: (ext: Extraction) => void;
  onNext: () => void;
}) {
  return (
    <StepCard title="2. Comprovante de endereço">
      <div className="print:hidden">
        <DocUploader
          label="Adicionar comprovante de endereço"
          hint="Conta de luz, água, telefone · imagem ou PDF"
          mockData={mockEnderecoExtraction}
          onFile={onDocumento}
          onExtracted={(ext) => {
            // Aqui só entra comprovante: RG/certidão/cartão CNPJ são recusados.
            conferirDocumento(
              ext,
              ["comprovante"],
              "um comprovante de endereço (conta de luz, água ou telefone)",
            );
            // Comprovante vence em 3 meses: acima disso não serve de prova de endereço.
            const emissao = acharDataComprovante(ext.fields);
            const meses = emissao ? mesesDesde(emissao) : null;
            if (meses !== null && meses > 3) {
              throw new Error(
                `Comprovante vencido: emitido há ${meses} meses (${formatDateBR(emissao)}). ` +
                  "Envie um comprovante com até 3 meses de emissão.",
              );
            }
            onExtract(ext);
          }}
        />
      </div>
      {endereco ? (
        <>
          {/* Aviso quando a MOST não leu o comprovante: documento salvo, preenche pelo CEP. */}
          {!endereco.logradouro && !endereco.cidade ? (
            <p className="m-0 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300">
              Não consegui ler o endereço no comprovante. O documento foi salvo — envie a conta
              inteira e bem enquadrada para tentar de novo, ou preencha pelo CEP abaixo.
            </p>
          ) : null}
          <EnderecoEditavel endereco={endereco} onChange={onEnderecoChange} />
          {endereco.dataDocumento ? (
            <ComprovanteRecencia data={endereco.dataDocumento} />
          ) : null}
        </>
      ) : null}
      <NavButtons
        canNext={Boolean(endereco?.logradouro && endereco?.cidade)}
        onBack={onBack}
        onNext={onNext}
      />
    </StepCard>
  );
}

function StepCertidao({
  estadoCivilId,
  onBack,
  onDocumento,
  onNext,
  onPerfilChange,
  regimeBensId,
}: {
  estadoCivilId: string;
  onBack: () => void;
  onDocumento: (arquivo: ArquivoAnexado) => void;
  onNext: () => void;
  onPerfilChange: (patch: Partial<Perfil>) => void;
  regimeBensId: string;
}) {
  const [certidao, setCertidao] = useState<Extraction | null>(null);
  const [regimeLido, setRegimeLido] = useState(false);
  const valida = certidao ? isCertidao(certidao.documentType) : null;
  const esperada = certidaoEsperada(estadoCivilId);
  const tituloMinusculo = esperada.titulo.toLowerCase();
  // Regime de bens só existe em casamento / união estável (o C2X guarda em property_regimes).
  const pedeRegime = ["2", "6"].includes(estadoCivilId);

  return (
    <StepCard title="3. Certidão">
      <p className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 print:hidden">
        Envie a <span className="font-semibold">{tituloMinusculo}</span>. A autenticidade do
        documento é verificada automaticamente.
      </p>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
          {esperada.titulo}
        </p>
        <div className="print:hidden">
          <DocUploader
            label={`Enviar ${tituloMinusculo}`}
            hint={`${esperada.hint} · imagem ou PDF`}
            mockData={mockCertidaoExtraction}
            onFile={onDocumento}
            onExtracted={(ext) => {
              conferirDocumento(ext, ["certidao"], `a ${tituloMinusculo}`);
              setCertidao(ext);
              if (!pedeRegime) {
                return;
              }
              // Se o MOST reconheceu o regime na certidão, preenche; senão fica manual.
              const id = acharRegimeCertidao(ext);
              setRegimeLido(Boolean(id));
              if (id) {
                onPerfilChange({ regimeBensId: id });
              }
            }}
          />
        </div>
        {certidao ? (
          valida ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/12 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Autenticidade confirmada ({mapCertidao(certidao.documentType)}).
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/12 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">
              <X className="size-4" aria-hidden="true" />
              Documento não reconhecido como certidão. Reenvie a certidão correta.
            </div>
          )
        ) : null}
      </div>

      {/* O regime só existe depois da certidão lida: antes disso não há o que mostrar (era o
          campo aparecendo em branco, pedindo digitação, antes mesmo do documento). */}
      {pedeRegime && certidao ? (
        <Secao title="Regime de bens">
          {/* Lido da certidão = read-only (o documento é a fonte, não a digitação). Só quando a
              leitura não reconhece o regime é que o campo abre pra seleção manual. */}
          {regimeLido ? (
            <ReadField
              label="Regime de casamento"
              value={
                C2X_REGIME_BENS.find((o) => o.id.toString() === regimeBensId)?.label ?? ""
              }
            />
          ) : (
            <>
              <SelectField
                label="Regime de casamento"
                value={regimeBensId}
                options={C2X_REGIME_BENS}
                onChange={(v) => onPerfilChange({ regimeBensId: v })}
              />
              {certidao ? (
                <p className="m-0 self-center text-xs text-ink-muted sm:col-span-2">
                  Não foi possível ler o regime nesta certidão. Selecione conforme o documento.
                </p>
              ) : null}
            </>
          )}
        </Secao>
      ) : null}

      <NavButtons
        canNext={Boolean(valida) && (!pedeRegime || Boolean(regimeBensId))}
        onBack={onBack}
        onNext={onNext}
        nextLabel="Avançar para revisão"
      />
    </StepCard>
  );
}

function StepRevisao({
  conjuge,
  documentos,
  empresa,
  endereco,
  identidade,
  imobiliarias,
  onBack,
  perfil,
  persona,
  socios,
}: {
  conjuge: Conjuge | null;
  documentos: DocumentosAnexados;
  empresa: Empresa;
  endereco: Endereco | null;
  identidade: Identidade | null;
  imobiliarias: SelectOption[];
  onBack: () => void;
  perfil: Perfil;
  persona: Persona;
  socios: SocioCadastro[];
}) {
  const label = (options: SelectOption[], id: string) =>
    options.find((o) => o.id.toString() === id)?.label ?? "";

  const isPj = persona === "pj";
  const nomeCliente = isPj
    ? titleCase(empresa.razaoSocial || "Empresa")
    : titleCase(identidade?.nome ?? "Cliente");
  const registro = formatRegistro(new Date());
  const cadTitulo = `CAD - ${nomeCliente} - ${registro.completo}`;
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [resultado, setResultado] = useState<SalvarResposta | null>(null);

  // Certidões, análise financeira (GOLD) e demais consultas sob demanda saíram
  // do cadastro (decisão do Lucas 11/jul): o cadastro/CAD mostra só o que é
  // automático; o sob demanda o operador roda depois, na ficha do Apolo.
  // Envio = nascimento da ENTIDADE pelo papel Prospect: cria o cadastro no Apolo e sobe pro
  // drive os documentos originais anexados + o CAD gerado aqui.
  async function enviar() {
    setEnviando(true);
    setErroEnvio(null);
    try {
      const anexos = Object.entries(documentos).flatMap(([categoria, arquivos]) =>
        (arquivos ?? []).map((arquivo) => ({
          categoria,
          fileBase64: arquivo.fileBase64,
          fileName: arquivo.fileName,
          mimeType: arquivo.mimeType,
        })),
      );

      // A categoria carrega o índice do sócio ("identificacao_socio_1"): sem isso o servidor
      // agruparia os documentos de TODOS os sócios num PDF só.
      const anexosSocios = socios.flatMap((socio, index) => [
        ...socio.arquivosIdentificacao.map((arquivo) => ({
          categoria: `identificacao_socio_${index + 1}`,
          fileBase64: arquivo.fileBase64,
          fileName: arquivo.fileName,
          mimeType: arquivo.mimeType,
        })),
        ...socio.arquivosComprovante.map((arquivo) => ({
          categoria: `comprovante_socio_${index + 1}`,
          fileBase64: arquivo.fileBase64,
          fileName: arquivo.fileName,
          mimeType: arquivo.mimeType,
        })),
      ]);

      const salvo = await apiSalvarCadastro({
        // Estrutura da CAD: o PDF é montado no servidor, com o código de autenticação.
        cad: montarCadDoc(),
        conjuge: conjuge
          ? {
              cpf: conjuge.cpf,
              dataNascimento: conjuge.dataNascimento,
              email: conjuge.email,
              nome: conjuge.nome,
              nomeMae: conjuge.nomeMae,
              telefone: conjuge.telefone,
            }
          : null,
        documentos: [...anexos, ...anexosSocios],
        empresa: isPj ? empresa : null,
        endereco,
        identidade,
        perfil: { ...perfil, imobiliariaLabel: label(imobiliarias, perfil.imobiliariaId) },
        persona,
        role: "prospect",
        socios: isPj
          ? socios.map((socio) => ({
              cpf: socio.cpf,
              dataNascimento: socio.dataNascimento,
              email: socio.email,
              endereco: {
                bairro: socio.endereco.bairro,
                cep: socio.endereco.cep,
                cidade: socio.endereco.cidade,
                logradouro: socio.endereco.logradouro,
                numero: socio.endereco.numero,
                uf: socio.endereco.uf,
              },
              estadoCivilId: socio.estadoCivilId,
              nacionalidade: socio.nacionalidade,
              naturalidade: socio.naturalidade,
              nome: socio.nome,
              nomeMae: socio.nomeMae,
              representanteLegal: socio.representanteLegal,
              sexoId: socio.sexoId,
              telefone: socio.telefone,
            }))
          : undefined,
      });
      setResultado(salvo);
      setEnviado(true);
    } catch (error) {
      setErroEnvio((error as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  // Monta o CAD uma vez: serve tanto pro botao Baixar quanto pro arquivo salvo no drive.
  function montarCadDoc(): CadDoc {
    const secoes: CadSecao[] = [];
    if (isPj) {
      // Razão social / nome NÃO entram como campo: já vão em destaque no topo da ficha.
      secoes.push(
        cadSection("Dados da empresa", [
          cadField("Nome fantasia", titleCase(empresa.nomeFantasia)),
          cadField("CNPJ", empresa.cnpj),
          cadField("Porte", empresa.porte),
          cadField("Abertura", formatDateBR(empresa.dataAbertura)),
          cadField("Atualização cadastral", formatDateBR(empresa.dataAtualizacao)),
          cadField("Situação cadastral", empresa.situacaoCadastral),
          cadField("Natureza jurídica", empresa.naturezaJuridica, true),
          cadField("CNAE", empresa.cnae),
          cadField("Atividade principal", empresa.atividade, true),
        ]),
      );
      if (empresa.socios.length) {
        secoes.push(
          cadSection(
            "Quadro societário (QSA)",
            empresa.socios.map((socio) =>
              cadField(socio.qualificacao || "Sócio", titleCase(socio.nome), true),
            ),
          ),
        );
      }
      secoes.push(
        cadSection("Endereço", [
          cadField("Logradouro", titleCase(endereco?.logradouro ?? ""), true),
          cadField("Número", endereco?.numero ?? ""),
          cadField("Bairro", titleCase(endereco?.bairro ?? "")),
          cadField("CEP", endereco?.cep ?? ""),
          cadField("Cidade", titleCase(endereco?.cidade ?? "")),
          cadField("UF", endereco?.uf ?? ""),
        ]),
      );
      secoes.push(
        cadSection("Contato", [
          cadField("Telefone", empresa.telefone),
          cadField("E-mail", empresa.email),
        ]),
      );
      for (const [index, socio] of socios.entries()) {
        secoes.push(
          cadSection(
            `Sócio ${index + 1}${socio.representanteLegal ? " · representante legal" : ""}`,
            [
              cadField("Nome", titleCase(socio.nome), true),
              cadField("CPF", socio.cpf),
              cadField("Nascimento", formatDateBR(socio.dataNascimento)),
              cadField("Sexo", label(C2X_SEXO, socio.sexoId)),
              cadField("Estado civil", label(C2X_ESTADO_CIVIL, socio.estadoCivilId)),
              cadField("Telefone", socio.telefone),
              cadField("E-mail", socio.email, true),
              cadField(
                "Endereço",
                [
                  titleCase(socio.endereco.logradouro),
                  socio.endereco.numero,
                  titleCase(socio.endereco.cidade),
                  socio.endereco.uf,
                ]
                  .filter(Boolean)
                  .join(", "),
                true,
              ),
            ],
          ),
        );
      }
    } else {
      // O nome NÃO entra como campo: já vai em destaque no topo da ficha.
      secoes.push(
        cadSection("Identificação", [
          cadField("CPF", identidade?.cpf ?? ""),
          cadField("Nascimento", formatDateBR(identidade?.dataNascimento ?? "")),
          cadField("Idade", calcIdade(identidade?.dataNascimento ?? "")),
          cadField("Nome da mãe", titleCase(identidade?.nomeMae ?? ""), true),
          cadField("Naturalidade", titleCase(identidade?.naturalidade ?? "")),
          cadField("Nacionalidade", titleCase(identidade?.nacionalidade ?? "")),
          cadField("Sexo", label(C2X_SEXO, perfil.sexoId)),
          cadField("Estado civil", label(C2X_ESTADO_CIVIL, perfil.estadoCivilId)),
          // Regime só entra quando existe (casado / união estável).
          ...(perfil.regimeBensId
            ? [cadField("Regime de bens", label(C2X_REGIME_BENS, perfil.regimeBensId))]
            : []),
        ]),
      );
      secoes.push(
        cadSection("Perfil", [
          cadField("Escolaridade", label(C2X_ESCOLARIDADE, perfil.escolaridadeId)),
          cadField("Faixa de renda", label(C2X_FAIXA_RENDA, perfil.rendaId)),
          cadField("Patrimônio", perfil.patrimonio),
          cadField("Profissão", titleCase(label(C2X_PROFISSOES, perfil.profissaoId))),
        ]),
      );
      secoes.push(
        cadSection("Endereço", [
          cadField("Logradouro", titleCase(endereco?.logradouro ?? ""), true),
          cadField("Número", endereco?.numero ?? ""),
          cadField("Complemento", titleCase(endereco?.complemento ?? "")),
          cadField("Bairro", titleCase(endereco?.bairro ?? "")),
          cadField("CEP", endereco?.cep ?? ""),
          cadField("Cidade", titleCase(endereco?.cidade ?? "")),
          cadField("UF", endereco?.uf ?? ""),
        ]),
      );
      secoes.push(
        cadSection("Contato", [
          cadField("Telefone", perfil.telefone),
          cadField("E-mail", perfil.email),
        ]),
      );
      if (conjuge) {
        secoes.push(
          cadSection("Cônjuge", [
            cadField("Nome", titleCase(conjuge.nome), true),
            cadField("CPF", conjuge.cpf),
            cadField("Nascimento", formatDateBR(conjuge.dataNascimento)),
            cadField("Idade", calcIdade(conjuge.dataNascimento)),
            cadField("Nome da mãe", titleCase(conjuge.nomeMae), true),
            cadField("Naturalidade", titleCase(conjuge.naturalidade)),
            cadField("Nacionalidade", titleCase(conjuge.nacionalidade)),
            cadField("Sexo", label(C2X_SEXO, conjuge.sexoId)),
            cadField("Estado civil", label(C2X_ESTADO_CIVIL, perfil.estadoCivilId)),
            // Regime é do CASAMENTO: o cônjuge herda o mesmo do titular.
            ...(perfil.regimeBensId
              ? [cadField("Regime de bens", label(C2X_REGIME_BENS, perfil.regimeBensId))]
              : []),
            cadField("Escolaridade", label(C2X_ESCOLARIDADE, conjuge.escolaridadeId)),
            cadField("Faixa de renda", label(C2X_FAIXA_RENDA, conjuge.rendaId)),
            cadField("Patrimônio", conjuge.patrimonio),
            cadField("Profissão", titleCase(label(C2X_PROFISSOES, conjuge.profissaoId))),
            cadField("Telefone", conjuge.telefone),
            cadField("E-mail", conjuge.email, true),
          ]),
        );
      }
    }
    return {
      arquivo: cadTitulo,
      data: registro.data,
      hora: registro.hora,
      nome: nomeCliente,
      papel: isPj ? "Pessoa jurídica" : "Prospect",
      secoes,
      vinculo: label(imobiliarias, perfil.imobiliariaId),
    };
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Sem "baixar" antes do envio: a CAD só existe depois de enviada, gerada no servidor e
          autenticada. Assim não circula ficha sem código de autenticação. */}
      <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-inverse text-brand-ink">
            <UserRound className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-ink">Cadastro de CAD</h2>
            <p className="text-xs text-ink-muted">
              {nomeCliente} · registro {registro.completo}
            </p>
          </div>
        </div>
      </div>

      {isPj ? (
        <>
          <Secao title="Dados da empresa">
            <ReadField label="Razão social" value={nomeCliente} span2 />
            <ReadField label="Nome fantasia" value={titleCase(empresa.nomeFantasia)} />
            <ReadField label="CNPJ" value={empresa.cnpj} />
            <ReadField label="Porte" value={empresa.porte} />
            <ReadField label="Abertura" value={formatDateBR(empresa.dataAbertura)} />
            <ReadField
              label="Atualização cadastral"
              value={formatDateBR(empresa.dataAtualizacao)}
            />
            <ReadField label="Situação cadastral" value={empresa.situacaoCadastral} />
            <ReadField label="Natureza jurídica" value={empresa.naturezaJuridica} span2 />
            <ReadField label="CNAE" value={empresa.cnae} span2 />
            <ReadField label="Atividade principal" value={empresa.atividade} span2 />
          </Secao>

          {empresa.socios.length ? (
            <Secao title="Quadro societário (QSA)">
              {empresa.socios.map((socio, index) => (
                <ReadField
                  key={`${socio.nome}-${index}`}
                  label={socio.qualificacao || "Sócio"}
                  value={titleCase(socio.nome)}
                  span2
                />
              ))}
            </Secao>
          ) : null}

          <Secao title="Endereço">
            <ReadField label="Logradouro" value={titleCase(endereco?.logradouro ?? "")} span2 />
            <ReadField label="Número" value={endereco?.numero ?? ""} />
            <ReadField label="Bairro" value={titleCase(endereco?.bairro ?? "")} />
            <ReadField label="CEP" value={endereco?.cep ?? ""} />
            <ReadField label="Cidade" value={titleCase(endereco?.cidade ?? "")} />
            <ReadField label="UF" value={endereco?.uf ?? ""} />
          </Secao>

          <Secao title="Contato e vínculo">
            <ReadField label="Telefone" value={empresa.telefone} />
            <ReadField label="E-mail" value={empresa.email} span2 />
            <ReadField label="Imobiliária" value={label(imobiliarias, perfil.imobiliariaId)} />
          </Secao>

          {socios.map((socio, index) => (
            <Secao
              key={socio.id}
              title={`Sócio ${index + 1}${socio.representanteLegal ? " · representante legal" : ""}`}
            >
              <ReadField label="Nome" value={titleCase(socio.nome)} span2 />
              <ReadField label="CPF" value={socio.cpf} />
              <ReadField label="Nascimento" value={formatDateBR(socio.dataNascimento)} />
              <ReadField label="Sexo" value={label(C2X_SEXO, socio.sexoId)} />
              <ReadField label="Estado civil" value={label(C2X_ESTADO_CIVIL, socio.estadoCivilId)} />
              <ReadField label="Telefone" value={socio.telefone} />
              <ReadField label="E-mail" value={socio.email} span2 />
              <ReadField
                label="Endereço"
                value={[
                  titleCase(socio.endereco.logradouro),
                  socio.endereco.numero,
                  titleCase(socio.endereco.cidade),
                  socio.endereco.uf,
                ]
                  .filter(Boolean)
                  .join(", ")}
                span2
              />
            </Secao>
          ))}
        </>
      ) : (
        <>
          <Secao title="Identificação">
            <ReadField label="Nome" value={nomeCliente} span2 />
            <ReadField label="CPF" value={identidade?.cpf ?? ""} />
            <ReadField label="Nascimento" value={formatDateBR(identidade?.dataNascimento ?? "")} />
            <ReadField label="Idade" value={calcIdade(identidade?.dataNascimento ?? "")} />
            <ReadField label="Nome da mãe" value={titleCase(identidade?.nomeMae ?? "")} span2 />
            <ReadField label="Naturalidade" value={titleCase(identidade?.naturalidade ?? "")} />
            <ReadField label="Nacionalidade" value={titleCase(identidade?.nacionalidade ?? "")} />
            <ReadField label="Sexo" value={label(C2X_SEXO, perfil.sexoId)} />
            <ReadField label="Estado civil" value={label(C2X_ESTADO_CIVIL, perfil.estadoCivilId)} />
            {perfil.regimeBensId ? (
              <ReadField
                label="Regime de bens"
                value={label(C2X_REGIME_BENS, perfil.regimeBensId)}
              />
            ) : null}
          </Secao>

          <Secao title="Perfil">
            <ReadField label="Escolaridade" value={label(C2X_ESCOLARIDADE, perfil.escolaridadeId)} />
            <ReadField label="Faixa de renda" value={label(C2X_FAIXA_RENDA, perfil.rendaId)} />
            <ReadField label="Patrimônio" value={perfil.patrimonio} />
            <ReadField label="Profissão" value={titleCase(label(C2X_PROFISSOES, perfil.profissaoId))} span2 />
          </Secao>

          <Secao title="Endereço">
            <ReadField label="Logradouro" value={titleCase(endereco?.logradouro ?? "")} span2 />
            <ReadField label="Número" value={endereco?.numero ?? ""} />
            <ReadField label="Bairro" value={titleCase(endereco?.bairro ?? "")} />
            <ReadField label="CEP" value={endereco?.cep ?? ""} />
            <ReadField label="Cidade" value={titleCase(endereco?.cidade ?? "")} />
            <ReadField label="UF" value={endereco?.uf ?? ""} />
          </Secao>

          <Secao title="Contato e vínculo">
            <ReadField label="Telefone" value={perfil.telefone} />
            <ReadField label="E-mail" value={perfil.email} span2 />
            <ReadField label="Imobiliária" value={label(imobiliarias, perfil.imobiliariaId)} />
          </Secao>

          {conjuge ? (
            <Secao title="Cônjuge">
              <ReadField label="Nome" value={titleCase(conjuge.nome)} span2 />
              <ReadField label="CPF" value={conjuge.cpf} />
              <ReadField label="Nascimento" value={formatDateBR(conjuge.dataNascimento)} />
              <ReadField label="Sexo" value={label(C2X_SEXO, conjuge.sexoId)} />
              <ReadField label="Escolaridade" value={label(C2X_ESCOLARIDADE, conjuge.escolaridadeId)} />
              <ReadField label="Faixa de renda" value={label(C2X_FAIXA_RENDA, conjuge.rendaId)} />
              <ReadField label="Patrimônio" value={conjuge.patrimonio} />
              <ReadField label="Profissão" value={titleCase(label(C2X_PROFISSOES, conjuge.profissaoId))} />
              <ReadField label="Telefone" value={conjuge.telefone} />
              <ReadField label="E-mail" value={conjuge.email} span2 />
            </Secao>
          ) : null}
        </>
      )}

      {erroEnvio ? (
        <p className="mt-4 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/12 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">
          {erroEnvio}
        </p>
      ) : null}

      {/* Fecho do processo: popup sobre a ficha (fundo embaçado) confirmando o nascimento da
          entidade e entregando a CAD na mão. Fechar volta pro Apolo. */}
      {enviado ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                  <Check className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="m-0 text-base font-semibold text-ink">
                    CAD enviada com sucesso
                  </h2>
                  <p className="m-0 mt-0.5 text-xs text-ink-muted">
                    {nomeCliente} · Prospect
                  </p>
                  <p className="m-0 text-xs text-ink-muted">
                    Enviada em {registro.data} às {registro.hora}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => {
                  window.location.href = "/apolo";
                }}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {resultado?.autenticacao ? (
              <div className="mt-4 rounded-lg border border-line bg-subtle px-3 py-2">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Código de autenticação
                </p>
                <p className="m-0 mt-0.5 font-mono text-sm font-semibold text-ink">
                  {resultado.autenticacao}
                </p>
              </div>
            ) : null}

            {resultado?.savedDocs.length ? (
              <p className="m-0 mt-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
                {resultado.savedDocs.length}{" "}
                {resultado.savedDocs.length === 1 ? "arquivo salvo" : "arquivos salvos"} no
                drive do cadastro.
              </p>
            ) : null}

            {resultado?.warnings.length ? (
              <p className="m-0 mt-2 rounded-lg bg-amber-50 dark:bg-amber-500/12 px-3 py-2 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                Revisar: {resultado.warnings.join(" · ")}
              </p>
            ) : null}

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={!resultado?.cadBase64}
                onClick={() => {
                  // Baixa exatamente o PDF que o servidor gerou e guardou (com o código).
                  if (resultado?.cadBase64) {
                    baixarCadBase64(resultado.cadBase64, `${cadTitulo}.pdf`);
                  }
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-50"
              >
                <Download className="size-4" aria-hidden="true" />
                Baixar CAD
              </button>
              <a
                href="/apolo/cadastro"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink-soft transition-colors hover:bg-subtle"
              >
                Novo cadastro
              </a>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink-soft hover:bg-subtle"
        >
          Voltar
        </button>
        {enviado ? null : (
          <button
            type="button"
            disabled={enviando}
            onClick={() => void enviar()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-inverse px-5 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-wait disabled:opacity-70"
          >
            {enviando ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {enviando ? "Enviando" : "Enviar"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- campos ----------

function ReadField({
  label,
  span2 = false,
  value,
}: {
  label: string;
  span2?: boolean;
  value: string;
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-subtle px-3 py-2 ${
        span2 ? "sm:col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        <Lock className="size-2.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-0.5 min-h-[1.25rem] break-words text-sm text-ink">
        {value || <span className="text-ink-muted">—</span>}
      </div>
    </div>
  );
}

function SelectField({
  hint,
  label,
  onChange,
  options,
  value,
}: {
  hint?: string;
  label: string;
  onChange: (value: string) => void;
  options: C2xOption[];
  value: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        {hint ? <span className="text-[10px] text-[#A07C3B]">{hint}</span> : null}
      </div>
      {/* O popup do <select> e desenhado pelo browser: com bg-transparent ele cai no branco
          padrao e a <option> herda o text-ink claro do dark -> texto ilegivel. Por isso o
          fundo e a cor das opcoes vao explicitos aqui (o color-scheme global cuida do resto). */}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 w-full bg-surface text-sm text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
      >
        <option value="">Selecione…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
      />
    </div>
  );
}

// Endereço editável com CEP-first: o operador digita o CEP e logradouro/bairro/cidade/UF vêm do
// ViaCEP. É o fallback pro comprovante que a MOST não leu (foto ruim/girada) — o documento fica
// salvo e o endereço se completa na mão sem digitar tudo.
function EnderecoEditavel({
  endereco,
  onChange,
}: {
  endereco: Endereco;
  onChange: (patch: Partial<Endereco>) => void;
}) {
  const [buscando, setBuscando] = useState(false);

  async function aoMudarCep(valor: string) {
    onChange({ cep: valor });
    if (soDigitos(valor).length !== 8) return;
    setBuscando(true);
    const achado = await buscarEnderecoPorCep(valor);
    setBuscando(false);
    if (achado) {
      onChange({
        bairro: achado.bairro || endereco.bairro,
        cidade: achado.cidade || endereco.cidade,
        logradouro: achado.logradouro || endereco.logradouro,
        uf: achado.uf || endereco.uf,
      });
    }
  }

  return (
    <Secao title="Endereço">
      <div className="relative">
        <TextField label="CEP" placeholder="00000-000" value={endereco.cep} onChange={aoMudarCep} />
        {buscando ? (
          <Loader2
            className="absolute right-3 top-3 size-4 animate-spin text-ink-muted"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <TextField
        label="Número"
        value={endereco.numero}
        onChange={(v) => onChange({ numero: v })}
      />
      <TextField
        label="Complemento"
        value={endereco.complemento}
        onChange={(v) => onChange({ complemento: v })}
      />
      <div className="sm:col-span-2">
        <TextField
          label="Logradouro"
          value={endereco.logradouro}
          onChange={(v) => onChange({ logradouro: v })}
        />
      </div>
      <TextField label="Bairro" value={endereco.bairro} onChange={(v) => onChange({ bairro: v })} />
      <TextField label="Cidade" value={endereco.cidade} onChange={(v) => onChange({ cidade: v })} />
      <TextField label="UF" value={endereco.uf} onChange={(v) => onChange({ uf: v })} />
    </Secao>
  );
}

// Combobox com busca (profissão: 234 opções do C2X).
function SearchableSelect({
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  value: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id.toString() === value);
  const q = normalizeSearch(query);
  const filtered = (q
    ? options.filter((option) => normalizeSearch(option.label).includes(q))
    : options
  ).slice(0, 60);

  return (
    <div className="relative rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <input
        value={open ? query : selected ? titleCase(selected.label) : ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
      />
      {open ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
            {filtered.length ? (
              filtered.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onChange(option.id.toString());
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-subtle"
                >
                  {titleCase(option.label)}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-xs text-ink-muted">Nenhuma opção</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// Telefone internacional: seletor de país (bandeira + DDI), formatação por país
// e ícone indicando que é editável. Se o enriquecimento traz mais de um número,
// um dropdown discreto lista as opções.
function PhoneField({
  label = "Telefone",
  onChange,
  sugestoes,
  value,
}: {
  label?: string;
  onChange: (value: string) => void;
  sugestoes: string[];
  value: string;
}) {
  const [openPais, setOpenPais] = useState(false);
  const [openSug, setOpenSug] = useState(false);
  const { country, national } = parsePhone(value);
  const opcoes = sugestoes.filter(Boolean);
  const temEscolha = opcoes.length > 1;

  return (
    <div className="relative rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        <span className="flex items-center gap-1 text-[9px] font-medium text-ink-muted">
          <Pencil className="size-2.5" aria-hidden="true" />
          editável
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setOpenPais((v) => !v);
            setOpenSug(false);
          }}
          className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-subtle"
          title={country.name}
        >
          <span className="text-sm leading-none">{country.flag}</span>
          <span className="text-xs text-ink-muted">+{country.dial}</span>
          <ChevronDown className="size-3 text-ink-muted" aria-hidden="true" />
        </button>
        <input
          inputMode="tel"
          value={applyPhoneMask(national, country.mask)}
          onChange={(event) =>
            onChange(composePhone(country, event.target.value.replace(/\D/g, "")))
          }
          onFocus={() => temEscolha && setOpenSug(true)}
          placeholder={country.mask.replace(/#/g, "0")}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </div>

      {openPais ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setOpenPais(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
            {PHONE_COUNTRIES.map((c) => (
              <button
                key={c.iso}
                type="button"
                onClick={() => {
                  onChange(composePhone(c, national));
                  setOpenPais(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-subtle"
              >
                <span className="leading-none">{c.flag}</span>
                <span className="flex-1">{c.name}</span>
                <span className="text-xs text-ink-muted">+{c.dial}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {openSug && temEscolha ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setOpenSug(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-line bg-surface py-1 shadow-lg">
            <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Números encontrados
            </p>
            {opcoes.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  const parsed = parsePhone(item);
                  onChange(composePhone(parsed.country, parsed.national));
                  setOpenSug(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-subtle"
              >
                {item}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function EmailField({
  bloqueioMsg,
  bloquear,
  onChange,
  value,
}: {
  bloqueioMsg?: string;
  bloquear?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const touched = value.length > 0;
  const formatoOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const duplicado = Boolean(
    bloquear && value.trim().toLowerCase() === bloquear.trim().toLowerCase() && value.length > 0,
  );
  const valid = formatoOk && !duplicado;
  const mensagem = !formatoOk
    ? "Formato de e-mail inválido."
    : duplicado
      ? bloqueioMsg ?? "E-mail já utilizado."
      : "Formato válido. Enviaremos um e-mail de confirmação.";
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        E-mail
      </div>
      <div className="flex items-center gap-2">
        <Mail className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
        <input
          type="email"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="email@dominio.com"
          className="mt-0.5 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        {touched ? (
          valid ? (
            <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
          ) : (
            <X className="size-4 shrink-0 text-rose-500" aria-hidden="true" />
          )
        ) : null}
      </div>
      {touched ? (
        <p className={`mt-1 text-[11px] ${valid ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>
          {mensagem}
        </p>
      ) : null}
    </div>
  );
}

function EnrichWarn({ enrich }: { enrich: Enrichment }) {
  const simulado = enrich.source === "mock";
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs print:hidden ${
        simulado
          ? "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300"
          : "border-line bg-subtle text-ink-muted"
      }`}
    >
      <div className="flex items-center gap-2 font-medium">
        {simulado ? (
          <AlertTriangle className="size-3.5" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
        )}
        {simulado
          ? "Enriquecimento simulado (localhost sem chave)."
          : "Enriquecimento indisponível: preencha os campos manualmente."}
      </div>
    </div>
  );
}
