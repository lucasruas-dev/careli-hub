import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  type CadastroDraft,
  type DocumentExtraction,
  MostqiError,
  enrichPerson,
  extractDocument,
} from "@/lib/apolo/mostqi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const noStore = { "Cache-Control": "no-store" } as const;
const MAX_BASE64_LENGTH = 28_000_000;
const MAX_FILES = 6;

type IncomingFile = { fileBase64: string; fileName?: string };

type DocumentoLido = {
  arquivo: string;
  confianca: number | null;
  fields: DocumentExtraction["fields"];
  tipo: string;
};

// Ficha consolidada no formato do cadastro do Apolo.
type Ficha = {
  contato: { emails: string[]; telefones: string[] };
  documentos: DocumentoLido[];
  endereco: {
    bairro: string;
    cep: string;
    cidade: string;
    complemento: string;
    logradouro: string;
    numero: string;
    uf: string;
  };
  enriquecimento: {
    source: string;
    status: "indisponivel" | "ok" | "simulado";
    warnings: string[];
  };
  identificacao: {
    cpf: string;
    dataNascimento: string;
    naturalidade: string;
    nacionalidade: string;
    nome: string;
    nomeMae: string;
    nomePai: string;
    orgaoEmissor: string;
    rg: string;
    sexo: string;
  };
  perfil: {
    conjuge: string;
    estadoCivil: string;
    obito: boolean;
    profissao: string;
    renda: string;
  };
};

function stripDataUrl(value: string): string {
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
}

// Preenche o alvo apenas quando ainda esta vazio (primeiro documento com o
// campo ganha; identidade vem do RG/CNH, endereco do comprovante).
function fill(target: Record<string, string>, key: string, value: string) {
  if (value && !target[key]) target[key] = value;
}

function mergeIdentidade(ficha: Ficha, c: CadastroDraft) {
  fill(ficha.identificacao, "nome", c.nome);
  fill(ficha.identificacao, "cpf", c.cpf);
  fill(ficha.identificacao, "rg", c.rg);
  fill(ficha.identificacao, "orgaoEmissor", c.orgaoEmissor);
  fill(ficha.identificacao, "dataNascimento", c.dataNascimento);
  fill(ficha.identificacao, "naturalidade", c.naturalidade);
  fill(ficha.identificacao, "nomeMae", c.nomeMae);
  fill(ficha.identificacao, "nomePai", c.nomePai);
}

function mergeEndereco(ficha: Ficha, c: CadastroDraft) {
  fill(ficha.endereco, "logradouro", c.logradouro);
  fill(ficha.endereco, "numero", c.numero);
  fill(ficha.endereco, "bairro", c.bairro);
  fill(ficha.endereco, "cidade", c.cidade);
  fill(ficha.endereco, "uf", c.uf);
  fill(ficha.endereco, "cep", c.cep);
}

export async function POST(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as {
    files?: IncomingFile[];
  } | null;

  const files = (body?.files ?? []).filter((f) => f?.fileBase64);
  if (!files.length) {
    return NextResponse.json(
      { error: "Envie ao menos um documento." },
      { headers: noStore, status: 400 },
    );
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Maximo de ${MAX_FILES} documentos por cadastro.` },
      { headers: noStore, status: 413 },
    );
  }
  for (const file of files) {
    if (file.fileBase64.length > MAX_BASE64_LENGTH) {
      return NextResponse.json(
        { error: "Arquivo acima do limite de 20MB." },
        { headers: noStore, status: 413 },
      );
    }
  }

  const ficha: Ficha = {
    contato: { emails: [], telefones: [] },
    documentos: [],
    endereco: { bairro: "", cep: "", cidade: "", complemento: "", logradouro: "", numero: "", uf: "" },
    enriquecimento: { source: "", status: "indisponivel", warnings: [] },
    identificacao: {
      cpf: "", dataNascimento: "", nacionalidade: "", naturalidade: "",
      nome: "", nomeMae: "", nomePai: "", orgaoEmissor: "", rg: "", sexo: "",
    },
    perfil: { conjuge: "", estadoCivil: "", obito: false, profissao: "", renda: "" },
  };

  // 1) Le cada documento (iOCR) e consolida.
  try {
    for (const file of files) {
      const extraction = await extractDocument({
        fileBase64: stripDataUrl(file.fileBase64),
        fileName: file.fileName,
      });
      ficha.documentos.push({
        arquivo: file.fileName ?? "documento",
        confianca: extraction.overallConfidence,
        fields: extraction.fields,
        tipo: extraction.documentType,
      });

      const isComprovante = /comprovante|fatura|endereco|conta|residencia/i.test(
        `${extraction.documentType} ${extraction.stdType}`,
      );
      if (isComprovante) {
        mergeEndereco(ficha, extraction.cadastro);
      } else {
        mergeIdentidade(ficha, extraction.cadastro);
      }
      // Endereco tambem pode vir no doc de identidade; nao sobrescreve.
      mergeEndereco(ficha, extraction.cadastro);
    }
  } catch (error) {
    if (error instanceof MostqiError) {
      return NextResponse.json(
        { error: error.message },
        { headers: noStore, status: error.status ?? 502 },
      );
    }
    return NextResponse.json(
      { error: `Falha ao ler documento: ${(error as Error).message}` },
      { headers: noStore, status: 500 },
    );
  }

  // 2) Enriquece por CPF (best-effort). Nunca quebra o cadastro.
  const enr = await enrichPerson(ficha.identificacao.cpf);
  ficha.enriquecimento = {
    source: enr.source,
    status:
      enr.source === "mock" ? "simulado" : enr.available ? "ok" : "indisponivel",
    warnings: enr.warnings,
  };
  if (enr.available) {
    ficha.perfil.estadoCivil = enr.estadoCivil;
    ficha.perfil.conjuge = enr.conjuge;
    ficha.perfil.profissao = enr.profissao;
    ficha.perfil.renda = enr.renda;
    ficha.perfil.obito = enr.obito;
    fill(ficha.identificacao, "nomeMae", enr.nomeMae);
    fill(ficha.identificacao, "nomePai", enr.nomePai);
    ficha.contato.telefones = enr.telefones;
    ficha.contato.emails = enr.emails;
    if (!ficha.endereco.logradouro && enr.enderecos[0]) {
      ficha.endereco.logradouro = enr.enderecos[0];
    }
  }

  return NextResponse.json({ data: ficha }, { headers: noStore });
}
