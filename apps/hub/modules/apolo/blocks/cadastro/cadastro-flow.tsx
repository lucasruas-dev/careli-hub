"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
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
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";

import {
  type C2xOption,
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_SEXO,
  calcIdade,
  formatDateBR,
  mapDocType,
  matchEstadoCivilId,
  matchFaixaRendaId,
  matchSexoId,
  mesesDesde,
  normalizeSearch,
  titleCase,
} from "@/lib/apolo/c2x-fields";
import { C2X_PROFISSOES } from "@/lib/apolo/c2x-professions";
import { getHubSupabaseClient } from "@/lib/supabase/client";

import {
  type CadCampo,
  type CadSecao,
  gerarCadPdf,
} from "./cad-pdf";

// Wizard de cadastro de CAD (prospect). Etapas: Identificação -> Endereço ->
// (Cônjuge se casado) -> Revisão. Campos read-only vêm do documento/MOST;
// perfil (sexo/estado civil/escolaridade/renda) usa seletores do C2X.

// Opção de seletor que aceita id numérico (lookups do C2X) ou string (entidades
// do Apolo, como as imobiliárias vindas do read-model).
type SelectOption = { id: number | string; label: string };

// Fallback só do localhost (o endpoint real /api/apolo/imobiliarias usa a chave
// de serviço, que não valida local). Em produção vem a lista real do Apolo.
const IMOBILIARIAS_FALLBACK: SelectOption[] = [
  { id: 1, label: "Careli Imóveis" },
  { id: 2, label: "Vale do Ouro Imóveis" },
  { id: 3, label: "Lagoa Bonita Imóveis" },
];

type CadastroDraft = Record<string, string>;
type Extraction = {
  cadastro: CadastroDraft;
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

type Identidade = {
  cpf: string;
  dataNascimento: string;
  nome: string;
  nomeMae: string;
  nomePai: string;
  orgaoEmissor: string;
  rg: string;
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
  nome: string;
  nomeMae: string;
  patrimonio: string;
  profissaoId: string;
  rendaId: string;
  rg: string;
  sexoId: string;
  telefone: string;
};

const CONJUGE_VAZIO: Conjuge = {
  cpf: "", dataNascimento: "", documentoLido: false, email: "",
  escolaridadeId: "", nome: "", nomeMae: "", patrimonio: "", profissaoId: "",
  rendaId: "", rg: "", sexoId: "", telefone: "",
};

// Persona do cadastro, definida pelo documento: RG/CNH -> pessoa física (pf);
// cartão CNPJ -> pessoa jurídica (pj).
type Persona = "pf" | "pj";

type Socio = { nome: string; qualificacao: string };
// Pessoa jurídica: dados da empresa (cartão CNPJ + enriquecimento por CNPJ) +
// contato + vínculo. Sem sexo/estado civil/escolaridade (isso é PF).
type Empresa = {
  atividade: string;
  capitalSocial: string;
  cnae: string;
  cnpj: string;
  dataAbertura: string;
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
  atividade: "", capitalSocial: "", cnae: "", cnpj: "", dataAbertura: "",
  documentoLido: false, email: "", naturezaJuridica: "",
  nomeFantasia: "", porte: "", razaoSocial: "", situacaoCadastral: "",
  socios: [], telefone: "", tipoDocumento: "",
};

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
      nomeMae: "SUELI AGUIAR PACHECO GONCALVES", nomePai: "", numero: "",
      orgaoEmissor: "SSP/MG", rg: "MG-12.345.678", uf: "",
    },
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
      nome: "CARLOS EDUARDO PEREIRA", nomeMae: "MARIA APARECIDA PEREIRA",
      rg: "MG-9.876.543",
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
    renda: "3 a 6 salários mínimos", sexo: "M", source: "mock",
    telefones: ["(31) 99123-4567"], warnings: [],
  };
}

// Certidão/consulta oficial devolvida pela análise (PF_02 certidões, PF_03 GOLD).
type Certidao = {
  emissao: string;
  status: string;
  titulo: string;
  tone: "atencao" | "bom" | "neutro";
  url: string;
  validade: string;
};
type Analise = {
  available: boolean;
  certidoes: Certidao[];
  patrimonio: string;
  renda: string;
  warnings: string[];
};

function mockCertidoes(): Certidao[] {
  return [
    {
      emissao: "09/07/2026", status: "NADA CONSTA", titulo: "Antecedentes Criminais (Polícia Federal)",
      tone: "bom", url: "", validade: "07/10/2026",
    },
    {
      emissao: "09/07/2026", status: "NÃO CONSTA", titulo: "CND Trabalhista",
      tone: "bom", url: "", validade: "05/01/2027",
    },
    {
      emissao: "09/07/2026", status: "REGULAR", titulo: "Situação na Receita Federal",
      tone: "bom", url: "", validade: "",
    },
    {
      emissao: "09/07/2026", status: "CONSTA (2 processos)", titulo: "Processos COMPROT",
      tone: "atencao", url: "", validade: "",
    },
  ];
}

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
    capitalSocial: "R$ 500.000,00",
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

// MOST valida se o documento e mesmo uma certidao (classificacao do tipo).
function isCertidao(type: string): boolean {
  return /certid|casamento|nascimento|uniao|marriage|birth/i.test(type);
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
    renda: "2 a 4 salários mínimos", sexo: "F", source: "mock",
    telefones: ["(31) 98681-5697", "(31) 3466-5697"], warnings: [],
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
    patrimonio: "", profissaoId: "", rendaEstimada: "", rendaId: "",
    sexoId: "", telefone: "",
  });
  const [enrich, setEnrich] = useState<Enrichment | null>(null);
  const [endereco, setEndereco] = useState<Endereco | null>(null);
  const [conjuge, setConjuge] = useState<Conjuge>(CONJUGE_VAZIO);
  // Persona definida pelo documento (RG/CNH -> pf, cartão CNPJ -> pj).
  const [persona, setPersona] = useState<Persona>("pf");
  const [empresa, setEmpresa] = useState<Empresa>(EMPRESA_VAZIA);
  const [imobiliarias, setImobiliarias] = useState<SelectOption[]>(
    LOCAL_MOCK ? IMOBILIARIAS_FALLBACK : [],
  );

  // Imobiliárias reais do Apolo (read-model). No localhost usa o fallback.
  useEffect(() => {
    if (LOCAL_MOCK) return;
    let alive = true;
    void (async () => {
      try {
        const list = await apiGetImobiliarias();
        if (alive && list.length) setImobiliarias(list);
      } catch {
        // sem lista: seletor fica vazio (sem placeholder em produção)
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
  const steps = needsCertidao
    ? ["Identificação", "Endereço", "Certidão", "Revisão"]
    : ["Identificação", "Endereço", "Revisão"];
  const current = steps[Math.min(step, steps.length - 1)];

  function jump(target: number) {
    if (target <= step) setStep(target);
  }

  const activeIndex = Math.min(step, steps.length - 1);
  const pct = Math.round(((activeIndex + 1) / steps.length) * 100);

  return (
    <section className="grid h-full min-h-0 gap-4 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-1 py-1 pb-20">
        <div className="rounded-2xl border border-slate-200/70 bg-white px-6 py-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] print:hidden">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-lg font-semibold tracking-tight text-slate-800">
              Cadastro de CAD
            </h1>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 sm:inline-flex">
                <ShieldCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
                Ambiente seguro
              </span>
              <a
                href="/apolo"
                aria-label="Sair do cadastro"
                title="Sair do cadastro"
                className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
              >
                <X className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
          <span className="mt-5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Etapa {activeIndex + 1} de {steps.length}
          </span>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#0d141c] transition-all duration-500"
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
            onEmpresaChange={(patch) => setEmpresa((e) => ({ ...e, ...patch }))}
            onEmpresaExtract={(ext, emp) => {
              const c = ext.cadastro;
              setEmpresa((prev) => ({
                ...prev,
                ...emp,
                cnpj: c.cnpj ?? "",
                dataAbertura: c.dataAbertura ?? "",
                documentoLido: true,
                naturezaJuridica: c.naturezaJuridica || emp.naturezaJuridica || "",
                nomeFantasia: c.nomeFantasia ?? "",
                razaoSocial: c.razaoSocial ?? "",
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
                nome: c.nome ?? "", nomeMae: c.nomeMae || enr.nomeMae,
                nomePai: c.nomePai || enr.nomePai,
                orgaoEmissor: c.orgaoEmissor ?? "", rg: c.rg ?? "",
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
                sexoId: matchSexoId(enr.sexo)?.toString() || p.sexoId,
                telefone: p.telefone || enr.telefones[0] || "",
              }));
              setEnrich(enr);
            }}
            onPerfilChange={(patch) => setPerfil((p) => ({ ...p, ...patch }))}
            onNext={() => setStep(1)}
          />
        ) : null}

        {current === "Endereço" ? (
          <StepEndereco
            endereco={endereco}
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
            onNext={() => setStep(step + 1)}
          />
        ) : null}

        {current === "Revisão" ? (
          <StepRevisao
            conjuge={temConjuge ? conjuge : null}
            empresa={empresa}
            endereco={endereco}
            identidade={identidade}
            imobiliarias={imobiliarias}
            perfil={perfil}
            persona={persona}
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
                    ? "border-slate-200 bg-white text-slate-400"
                    : "border-[#0d141c] bg-[#0d141c] text-white",
                ].join(" ")}
              >
                {state === "done" ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span
                className={[
                  "hidden text-xs font-semibold sm:inline",
                  state === "todo" ? "text-slate-400" : "text-slate-700",
                ].join(" ")}
              >
                {label}
              </span>
            </button>
            {index < steps.length - 1 ? (
              <div
                className={`mx-2 h-px flex-1 ${index < step ? "bg-[#0d141c]/30" : "bg-slate-200"}`}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------- uploader ----------

function DocUploader({
  busy,
  hint,
  label,
  mockData,
  onExtracted,
}: {
  busy?: boolean;
  hint: string;
  label: string;
  mockData?: (file: File) => Extraction;
  onExtracted: (ext: Extraction) => void | Promise<void>;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const working = loading || Boolean(busy);

  // Ao importar, ja le automaticamente (sem botao).
  async function processFile(file: File) {
    setFileName(file.name);
    setDone(false);
    setError(null);
    setLoading(true);
    try {
      let ext: Extraction;
      if (LOCAL_MOCK && mockData) {
        await delay(1600); // finge a leitura pra mostrar a barra
        ext = mockData(file);
      } else {
        ext = await apiPost<Extraction>({
          action: "extract",
          fileBase64: await fileToBase64(file),
          fileName: file.name,
        });
      }
      await onExtracted(ext);
      setDone(true);
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
        className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-7 text-center transition-colors hover:border-[#0d141c]/40 hover:bg-slate-50 disabled:cursor-wait"
      >
        {working ? (
          <>
            <Loader2 className="size-6 animate-spin text-[#0d141c]" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-700">
              {loading ? "Lendo documento…" : "Consultando dados pelo CPF…"}
            </span>
            <span className="text-xs text-slate-400">Aguarde um instante</span>
          </>
        ) : done ? (
          <>
            <CheckCircle2 className="size-6 text-emerald-500" aria-hidden="true" />
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <FileText className="size-3.5" aria-hidden="true" />
              {fileName}
            </span>
            <span className="text-xs text-slate-400">Clique para trocar o documento</span>
          </>
        ) : (
          <>
            <UploadCloud className="size-6 text-slate-400" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-600">{label}</span>
            <span className="text-xs text-slate-400">{hint}</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void processFile(file);
          event.target.value = "";
        }}
      />
      {working ? (
        <ReadingBar text={loading ? "Lendo documento…" : "Consultando dados pelo CPF…"} />
      ) : null}
      {error ? (
        <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}

// Barra de leitura (indeterminada) durante a validação do documento/consulta.
function ReadingBar({ text }: { text: string }) {
  return (
    <div className="mt-3">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <ShieldCheck className="size-3 text-emerald-500" aria-hidden="true" />
        {text}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="reading-bar h-full w-1/3 rounded-full bg-[#0d141c]" />
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
    <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-4 grid gap-5">{children}</div>
    </div>
  );
}

function Secao({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0d141c]">
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
          className="inline-flex h-9 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50"
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
        className="inline-flex h-9 items-center rounded-lg bg-[#0d141c] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0d141c]/90 disabled:cursor-not-allowed disabled:opacity-40"
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
    const c = ext.cadastro;
    setEnrichingConjuge(true);
    let enr: Enrichment = {
      available: false, conjuge: "", emails: [], estadoCivil: "",
      nomeMae: "", nomePai: "", patrimonio: "", profissao: "", renda: "",
      sexo: "", source: "", telefones: [], warnings: [],
    };
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
      nome: c.nome ?? "",
      nomeMae: c.nomeMae || enr.nomeMae,
      patrimonio: conjuge.patrimonio || enr.patrimonio || perfil.patrimonio,
      rendaId: conjuge.rendaId || matchFaixaRendaId(enr.renda),
      rg: c.rg ?? "",
      sexoId: conjuge.sexoId || matchSexoId(enr.sexo)?.toString() || "",
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
      }
      // Em produção o enriquecimento PJ (query MOST por CNPJ) ainda não está
      // provisionado; segue com o que o cartão CNPJ trouxe.
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

      <div className="print:hidden">
        <DocUploader
          busy={enriching}
          label="Adicionar documento do cliente"
          hint="RG / CNH (pessoa física) ou cartão CNPJ (empresa) · imagem ou PDF"
          mockData={(file) =>
            /cnpj/i.test(file.name) ? mockPjExtraction() : mockIdentidadeExtraction()
          }
          onExtracted={async (ext) => {
            if (isCnpjDoc(ext.documentType)) {
              onPersona("pj");
              await lerEmpresa(ext);
              return;
            }
            onPersona("pf");
            setEnriching(true);
            let enr: Enrichment = {
              available: false, conjuge: "", emails: [], estadoCivil: "",
              nomeMae: "", nomePai: "", patrimonio: "", profissao: "", renda: "",
              sexo: "", source: "", telefones: [], warnings: [],
            };
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
              <ReadField label="CNAE" value={empresa.cnae} />
              <ReadField label="Atividade principal" value={empresa.atividade} span2 />
              <ReadField label="Capital social" value={empresa.capitalSocial} />
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
          <p className="text-xs text-slate-400">
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
            <ReadField label="RG" value={identidade.rg} />
            <ReadField label="Nome da mãe" value={titleCase(identidade.nomeMae)} span2 />
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
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0d141c]">
                <UserRound className="size-3.5" aria-hidden="true" />
                Cônjuge
              </p>
              <p className="mb-3 text-xs text-slate-500">
                Mesma ficha do titular. Envie o documento do cônjuge: leitura e
                enriquecimento (sexo, telefone, renda) automáticos.
              </p>
              <div className="print:hidden">
                <DocUploader
                  busy={enrichingConjuge}
                  label="Documento do cônjuge"
                  hint="RG ou CNH · imagem ou PDF"
                  mockData={mockConjugeExtraction}
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
                    <ReadField label="RG" value={conjuge.rg} />
                    <ReadField label="Nome da mãe" value={titleCase(conjuge.nomeMae)} span2 />
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
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
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

function StepEndereco({
  endereco,
  onBack,
  onExtract,
  onNext,
}: {
  endereco: Endereco | null;
  onBack: () => void;
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
          onExtracted={onExtract}
        />
      </div>
      {endereco ? (
        <>
          <Secao title="Endereço">
            <ReadField label="Tipo" value={mapDocType(endereco.tipoDocumento)} />
            <ReadField label="Logradouro" value={titleCase(endereco.logradouro)} span2 />
            <ReadField label="Número" value={endereco.numero} />
            <ReadField label="Bairro" value={titleCase(endereco.bairro)} />
            <ReadField label="Cidade" value={titleCase(endereco.cidade)} />
            <ReadField label="UF" value={endereco.uf} />
            <ReadField label="CEP" value={endereco.cep} />
          </Secao>
          {endereco.dataDocumento ? (
            <ComprovanteRecencia data={endereco.dataDocumento} />
          ) : null}
        </>
      ) : null}
      <NavButtons canNext={Boolean(endereco)} onBack={onBack} onNext={onNext} />
    </StepCard>
  );
}

function StepCertidao({
  estadoCivilId,
  onBack,
  onNext,
}: {
  estadoCivilId: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const [certidao, setCertidao] = useState<Extraction | null>(null);
  const valida = certidao ? isCertidao(certidao.documentType) : null;
  const esperada = certidaoEsperada(estadoCivilId);
  const tituloMinusculo = esperada.titulo.toLowerCase();

  return (
    <StepCard title="3. Certidão">
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 print:hidden">
        Envie a <span className="font-semibold">{tituloMinusculo}</span>. O MOST
        verifica a autenticidade do documento.
      </p>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0d141c]">
          {esperada.titulo}
        </p>
        <div className="print:hidden">
          <DocUploader
            label={`Enviar ${tituloMinusculo}`}
            hint={`${esperada.hint} · imagem ou PDF`}
            mockData={mockCertidaoExtraction}
            onExtracted={setCertidao}
          />
        </div>
        {certidao ? (
          valida ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Autenticidade confirmada pelo MOST ({mapCertidao(certidao.documentType)}).
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              <X className="size-4" aria-hidden="true" />
              Documento não reconhecido como certidão. Reenvie a certidão correta.
            </div>
          )
        ) : null}
      </div>

      <NavButtons
        canNext={Boolean(valida)}
        onBack={onBack}
        onNext={onNext}
        nextLabel="Avançar para revisão"
      />
    </StepCard>
  );
}

function StepRevisao({
  conjuge,
  empresa,
  endereco,
  identidade,
  imobiliarias,
  onBack,
  perfil,
  persona,
}: {
  conjuge: Conjuge | null;
  empresa: Empresa;
  endereco: Endereco | null;
  identidade: Identidade | null;
  imobiliarias: SelectOption[];
  onBack: () => void;
  perfil: Perfil;
  persona: Persona;
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
  const [certidoes, setCertidoes] = useState<Certidao[] | null>(null);
  const [certLoading, setCertLoading] = useState(false);
  const [certErro, setCertErro] = useState("");
  const [gold, setGold] = useState<Analise | null>(null);
  const [goldLoading, setGoldLoading] = useState(false);
  const [goldErro, setGoldErro] = useState("");
  const cpfDigits = (identidade?.cpf ?? "").replace(/\D/g, "");
  const podeAnalisar = !isPj && cpfDigits.length === 11;

  async function rodarAnalise(query: string): Promise<Analise> {
    if (LOCAL_MOCK) {
      await delay(1800);
      return {
        available: true, certidoes: mockCertidoes(),
        patrimonio: "R$ 100 mil a R$ 250 mil", renda: "3 a 6 salários", warnings: [],
      };
    }
    return apiPost<Analise>({ action: "enrich", cpf: cpfDigits, query });
  }

  // Ao enviar, dispara as CERTIDÕES (CARELI_PF_02) em segundo plano.
  async function enviar() {
    setEnviado(true);
    if (!podeAnalisar) return;
    setCertLoading(true);
    setCertErro("");
    try {
      const data = await rodarAnalise("CARELI_PF_02");
      setCertidoes(data.certidoes ?? []);
    } catch (err) {
      setCertErro((err as Error).message);
    } finally {
      setCertLoading(false);
    }
  }

  // Análise financeira profunda (CARELI_PF_03, GOLD) — manual.
  async function rodarGold() {
    setGoldLoading(true);
    setGoldErro("");
    try {
      setGold(await rodarAnalise("CARELI_PF_03"));
    } catch (err) {
      setGoldErro((err as Error).message);
    } finally {
      setGoldLoading(false);
    }
  }

  function gerarCad() {
    const secoes: CadSecao[] = [];
    if (isPj) {
      secoes.push(
        cadSection("Dados da empresa", [
          cadField("Razão social", nomeCliente, true),
          cadField("Nome fantasia", titleCase(empresa.nomeFantasia)),
          cadField("CNPJ", empresa.cnpj),
          cadField("Abertura", formatDateBR(empresa.dataAbertura)),
          cadField("Situação cadastral", empresa.situacaoCadastral),
          cadField("Natureza jurídica", empresa.naturezaJuridica, true),
          cadField("Porte", empresa.porte),
          cadField("CNAE", empresa.cnae),
          cadField("Atividade principal", empresa.atividade, true),
          cadField("Capital social", empresa.capitalSocial),
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
    } else {
      secoes.push(
        cadSection("Identificação", [
          cadField("Nome", nomeCliente, true),
          cadField("CPF", identidade?.cpf ?? ""),
          cadField("RG", identidade?.rg ?? ""),
          cadField("Nascimento", formatDateBR(identidade?.dataNascimento ?? "")),
          cadField("Idade", calcIdade(identidade?.dataNascimento ?? "")),
          cadField("Nome da mãe", titleCase(identidade?.nomeMae ?? ""), true),
          cadField("Sexo", label(C2X_SEXO, perfil.sexoId)),
          cadField("Estado civil", label(C2X_ESTADO_CIVIL, perfil.estadoCivilId)),
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
            cadField("RG", conjuge.rg),
            cadField("Nascimento", formatDateBR(conjuge.dataNascimento)),
            cadField("Nome da mãe", titleCase(conjuge.nomeMae), true),
            cadField("Sexo", label(C2X_SEXO, conjuge.sexoId)),
            cadField("Estado civil", label(C2X_ESTADO_CIVIL, perfil.estadoCivilId)),
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
    void gerarCadPdf({
      arquivo: cadTitulo,
      data: registro.data,
      hora: registro.hora,
      nome: nomeCliente,
      papel: isPj ? "Pessoa jurídica" : "Prospect",
      secoes,
      vinculo: label(imobiliarias, perfil.imobiliariaId),
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[#0d141c] text-white">
            <UserRound className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Cadastro de CAD</h2>
            <p className="text-xs text-slate-500">
              {nomeCliente} · registro {registro.completo}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={gerarCad}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0d141c] px-4 text-sm font-semibold text-white hover:bg-[#0d141c]/90"
        >
          <Download className="size-4" aria-hidden="true" />
          Baixar CAD (PDF)
        </button>
      </div>

      {isPj ? (
        <>
          <Secao title="Dados da empresa">
            <ReadField label="Razão social" value={nomeCliente} span2 />
            <ReadField label="Nome fantasia" value={titleCase(empresa.nomeFantasia)} />
            <ReadField label="CNPJ" value={empresa.cnpj} />
            <ReadField label="Abertura" value={formatDateBR(empresa.dataAbertura)} />
            <ReadField label="Situação cadastral" value={empresa.situacaoCadastral} />
            <ReadField label="Natureza jurídica" value={empresa.naturezaJuridica} span2 />
            <ReadField label="Porte" value={empresa.porte} />
            <ReadField label="CNAE" value={empresa.cnae} />
            <ReadField label="Atividade principal" value={empresa.atividade} span2 />
            <ReadField label="Capital social" value={empresa.capitalSocial} />
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
        </>
      ) : (
        <>
          <Secao title="Identificação">
            <ReadField label="Nome" value={nomeCliente} span2 />
            <ReadField label="CPF" value={identidade?.cpf ?? ""} />
            <ReadField label="Nascimento" value={formatDateBR(identidade?.dataNascimento ?? "")} />
            <ReadField label="Idade" value={calcIdade(identidade?.dataNascimento ?? "")} />
            <ReadField label="RG" value={identidade?.rg ?? ""} />
            <ReadField label="Nome da mãe" value={titleCase(identidade?.nomeMae ?? "")} span2 />
            <ReadField label="Sexo" value={label(C2X_SEXO, perfil.sexoId)} />
            <ReadField label="Estado civil" value={label(C2X_ESTADO_CIVIL, perfil.estadoCivilId)} />
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
              <ReadField label="RG" value={conjuge.rg} />
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

      {enviado ? (
        <div className="mt-6 border-t border-slate-100 pt-5">
          <Secao title="Certidões">
            {certLoading ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <ReadingBar text="Consultando certidões (pode levar até 2 minutos)…" />
              </div>
            ) : certErro ? (
              <p className="text-xs font-medium text-rose-600 sm:col-span-2 lg:col-span-3">
                {certErro}
              </p>
            ) : certidoes && certidoes.length ? (
              certidoes.map((certidao, index) => (
                <CertidaoCard key={`${certidao.titulo}-${index}`} certidao={certidao} />
              ))
            ) : (
              <p className="text-xs text-slate-400 sm:col-span-2 lg:col-span-3">
                {podeAnalisar
                  ? "Nenhuma certidão retornada."
                  : "Certidões disponíveis para pessoa física."}
              </p>
            )}
          </Secao>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0d141c]">
                Análise financeira
              </p>
              {podeAnalisar && !gold ? (
                <button
                  type="button"
                  onClick={rodarGold}
                  disabled={goldLoading}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {goldLoading ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                  {goldLoading ? "Rodando…" : "Rodar análise financeira"}
                </button>
              ) : null}
            </div>
            {goldErro ? (
              <p className="mt-2 text-xs font-medium text-rose-600">{goldErro}</p>
            ) : null}
            {gold ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <ReadField label="Renda estimada" value={gold.renda} />
                <ReadField label="Patrimônio" value={gold.patrimonio} />
                {gold.certidoes.map((certidao, index) => (
                  <CertidaoCard key={`g-${certidao.titulo}-${index}`} certidao={certidao} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Voltar
        </button>
        {enviado ? (
          <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <Check className="size-4" aria-hidden="true" />
            Cadastro enviado
          </span>
        ) : (
          <button
            type="button"
            onClick={enviar}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0d141c] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0d141c]/90"
          >
            <Send className="size-4" aria-hidden="true" />
            Enviar
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
      className={`rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 ${
        span2 ? "sm:col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <Lock className="size-2.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-0.5 min-h-[1.25rem] break-words text-sm text-slate-800">
        {value || <span className="text-slate-300">—</span>}
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
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
        {hint ? <span className="text-[10px] text-[#A07C3B]">{hint}</span> : null}
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 w-full bg-transparent text-sm text-slate-800 outline-none"
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
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-300"
      />
    </div>
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
    <div className="relative rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
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
        className="mt-0.5 w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-300"
      />
      {open ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {filtered.length ? (
              filtered.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onChange(option.id.toString());
                    setOpen(false);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  {titleCase(option.label)}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-xs text-slate-400">Nenhuma opção</p>
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
    <div className="relative rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
        <span className="flex items-center gap-1 text-[9px] font-medium text-slate-400">
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
          className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-slate-50"
          title={country.name}
        >
          <span className="text-sm leading-none">{country.flag}</span>
          <span className="text-xs text-slate-500">+{country.dial}</span>
          <ChevronDown className="size-3 text-slate-400" aria-hidden="true" />
        </button>
        <input
          inputMode="tel"
          value={applyPhoneMask(national, country.mask)}
          onChange={(event) =>
            onChange(composePhone(country, event.target.value.replace(/\D/g, "")))
          }
          onFocus={() => temEscolha && setOpenSug(true)}
          placeholder={country.mask.replace(/#/g, "0")}
          className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-300"
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
          <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {PHONE_COUNTRIES.map((c) => (
              <button
                key={c.iso}
                type="button"
                onClick={() => {
                  onChange(composePhone(c, national));
                  setOpenPais(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span className="leading-none">{c.flag}</span>
                <span className="flex-1">{c.name}</span>
                <span className="text-xs text-slate-400">+{c.dial}</span>
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
          <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
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
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
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
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        E-mail
      </div>
      <div className="flex items-center gap-2">
        <Mail className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        <input
          type="email"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="email@dominio.com"
          className="mt-0.5 w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-300"
        />
        {touched ? (
          valid ? (
            <Check className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : (
            <X className="size-4 shrink-0 text-rose-500" aria-hidden="true" />
          )
        ) : null}
      </div>
      {touched ? (
        <p className={`mt-1 text-[11px] ${valid ? "text-emerald-600" : "text-rose-600"}`}>
          {mensagem}
        </p>
      ) : null}
    </div>
  );
}

function CertidaoCard({ certidao }: { certidao: Certidao }) {
  const tone =
    certidao.tone === "bom"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : certidao.tone === "atencao"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <FileText className="size-2.5" aria-hidden="true" />
        {certidao.titulo}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}
        >
          {certidao.status || "consultado"}
        </span>
        {certidao.url ? (
          <a
            href={certidao.url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-[#A07C3B] hover:underline"
          >
            Ver PDF
          </a>
        ) : null}
        {certidao.validade ? (
          <span className="text-[10px] text-slate-400">val. {certidao.validade}</span>
        ) : null}
      </div>
    </div>
  );
}

function EnrichWarn({ enrich }: { enrich: Enrichment }) {
  const simulado = enrich.source === "mock";
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs print:hidden ${
        simulado
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-500"
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
