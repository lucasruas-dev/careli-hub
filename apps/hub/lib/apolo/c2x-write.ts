// ESCRITA Apolo -> C2X: monta o payload do cadastro e envia à API de escrita do legado.
//
// Contexto (docs/architecture/c2x-api-escrita-diagnostico.md): a API é `POST {base}/api/v1/users`,
// autenticada por `Authorization: <token>`. Só cria `users`; o papel é o `profile_id`
// (2 cliente, 6 imobiliária, 3 incorporador — o corretor NÃO vai, mora só no Apolo). O cônjuge
// viaja aninhado em `spouse_attributes`. A resposta é sempre HTTP 201: o sucesso/erro está no
// corpo (`status: success|failed`), e o sucesso devolve `token`, não `id` — o id do C2X é lido
// depois no banco, pelo documento.
//
// Este módulo faz DUAS coisas separadas de propósito:
//   1. montar o payload (puro, testável, sem rede) — traduz os rótulos do Apolo para os ids do C2X;
//   2. transportar (POST) e interpretar a resposta.
// A orquestração (fila, ordem imobiliária->cliente, ler o id) vive em quem chama.
import { randomBytes } from "node:crypto";

import {
  C2X_ESCOLARIDADE,
  C2X_FAIXA_RENDA,
  C2X_PROFILE,
  C2X_USER_STATUS,
  matchEstadoCivilId,
  matchRegimeBensId,
  matchSexoId,
} from "./c2x-fields";
import {
  matchEscolaridadeId,
  matchFaixaRendaId,
  matchProfissaoId,
} from "./c2x-match";
import type { ApoloC2xCadastro, ApoloC2xSpouse } from "./types";

// Dados que NÃO moram no ApoloC2xCadastro (que é só a ficha): o nome, o e-mail e o telefone vêm
// da própria entidade (apolo_entities + apolo_contacts). Quem chama junta e passa aqui.
export type DadosDaEntidade = {
  cadastro: ApoloC2xCadastro;
  email: string | null;
  // Endereço com o estado e a cidade JÁ resolvidos para os ids do C2X (states/cities). O servidor
  // faz o lookup antes; aqui só monta. Nulo = sem endereço.
  endereco?: EnderecoC2x | null;
  nome: string;
  telefone: string | null;
};

// Endereço pronto para o C2X: state_id/city_id já são FKs resolvidas (não texto).
export type EnderecoC2x = {
  address: string | null;
  cityId: number | null;
  complement: string | null;
  district: string | null;
  number: string | null;
  stateId: number | null;
  zipcode: string | null;
};

export type PerfilC2x = "cliente" | "imobiliaria" | "incorporador";

// O payload que a API aceita. Campos opcionais só entram quando têm valor, para não mandar
// `null` onde a API espera ausência.
export type PayloadC2x = Record<string, unknown>;

// Só dígitos: a API valida CPF, e a comparação/dedup por documento no banco é sem máscara.
export function soDigitos(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\D/g, "");
}

// Data para o formato que a API quer (YYYY-MM-DD). Aceita ISO (já ok) ou BR (dd/mm/aaaa).
function dataIso(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const br = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = valor.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? valor.slice(0, 10) : null;
}

function idPorRotulo(
  lista: { id: number; label: string }[],
  valor: string | null | undefined,
): number | null {
  if (!valor) return null;
  const alvo = String(valor)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  const achado = lista.find(
    (o) =>
      o.label
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim() === alvo,
  );
  return achado ? achado.id : null;
}

// Uma senha que satisfaz a API. O cliente NÃO recebe (a devolutiva pede cadastro sem e-mail de
// boas-vindas); se um dia precisar acessar o C2X, usa a recuperação de senha de lá. Aleatória por
// cadastro, forte, e nunca persistida nem logada.
export function gerarSenha(): string {
  return `Ap!${randomBytes(12).toString("base64url")}9x`;
}

// Só inclui a chave quando o valor existe: manter `undefined` fora do JSON evita mandar
// `campo: null` para uma API que trata presença como obrigatoriedade.
function limpar(obj: Record<string, unknown>): PayloadC2x {
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(obj)) {
    if (valor === null || valor === undefined || valor === "") continue;
    // Array vazio (sem telefone/endereço/assinante) também fica de fora.
    if (Array.isArray(valor) && valor.length === 0) continue;
    saida[chave] = valor;
  }
  return saida;
}

// Tipo de documento no C2X é SEMPRE CPF (decisão do Lucas 28/jul): não capturamos RG, então o
// número de identificação repete o CPF. Simples e consistente com o que o operador informa.
const DOC_TYPE_CPF = 2;

// Cônjuge -> spouse_attributes (nested do Rails). Ainda a confirmar se a API materializa isto
// (ver diagnóstico); mandamos de qualquer forma, custo zero, e funciona assim que o POST aceitar.
function spouseAttributes(spouse: ApoloC2xSpouse | null): PayloadC2x | null {
  if (!spouse || !spouse.name) return null;
  const cpf = soDigitos(spouse.cpf) || null;
  return limpar({
    name: spouse.name,
    cpf,
    birthday: dataIso(spouse.birthday),
    email: spouse.email,
    cellphone: spouse.phone,
    // Sempre CPF: o número de identificação repete o CPF.
    identification_number: cpf,
    document_type_id: cpf ? DOC_TYPE_CPF : null,
    profession_id: matchProfissaoId(spouse.profession),
  });
}

// TELEFONE -> phones_attributes (has_many no Rails, então array). O C2X guarda o código do país
// separado ("+55") do número; o telefone do Apolo vem junto ("+55 (31) 9...."). Assumimos Brasil
// (+55) e mandamos o resto como número, marcando WhatsApp — no lançamento o contato é o WhatsApp.
function phonesAttributes(telefone: string | null): PayloadC2x[] {
  if (!telefone) return [];
  const numero = telefone.replace(/^\+?55\s*/, "").trim();
  if (!soDigitos(numero)) return [];
  return [{ is_whatsapp: true, phone: numero, phone_code: "+55" }];
}

// ENDEREÇO -> addresses_attributes (has_many, array). state_id/city_id já vêm resolvidos.
function addressesAttributes(endereco: EnderecoC2x | null | undefined): PayloadC2x[] {
  if (!endereco || !endereco.address) return [];
  return [
    limpar({
      address: endereco.address,
      city_id: endereco.cityId,
      complement: endereco.complement,
      district: endereco.district,
      number: endereco.number,
      state_id: endereco.stateId,
      zipcode: soDigitos(endereco.zipcode) || null,
    }),
  ];
}

// ASSINANTES -> signers_attributes (has_many, array). Quem assina o contrato: o TITULAR sempre, e
// o CÔNJUGE quando existe (decisão do Lucas: casado assinam os dois). Nome, e-mail e CPF de cada.
function signersAttributes(input: {
  cpf: string | null;
  email: string | null;
  nome: string;
  spouse: ApoloC2xSpouse | null;
}): PayloadC2x[] {
  const lista: PayloadC2x[] = [];
  const titularCpf = soDigitos(input.cpf) || null;
  if (input.nome) {
    lista.push(
      limpar({
        document_type_id: titularCpf ? DOC_TYPE_CPF : null,
        email: input.email,
        identification_number: titularCpf,
        name: input.nome,
      }),
    );
  }
  const spouseCpf = input.spouse ? soDigitos(input.spouse.cpf) || null : null;
  if (input.spouse?.name) {
    lista.push(
      limpar({
        document_type_id: spouseCpf ? DOC_TYPE_CPF : null,
        email: input.spouse.email,
        identification_number: spouseCpf,
        name: input.spouse.name,
      }),
    );
  }
  return lista;
}

// ── MONTAGEM DO PAYLOAD (puro) ────────────────────────────────────────────

// CLIENTE / proponente (profile_id = 2). Precisa do `vinculedById` (id da imobiliária no C2X): o
// cliente não entra solto. Os rótulos do cadastro (estado civil, escolaridade, renda, profissão)
// são traduzidos para os ids do C2X; quando o rótulo não casa, o campo fica de fora e o operador
// completa no C2X — melhor vazio que errado, porque profissão e renda entram na análise de crédito.
export function montarPayloadCliente(
  dados: DadosDaEntidade,
  opts: { senha?: string; vinculedById: number },
): PayloadC2x {
  const c = dados.cadastro;
  const casado = matchEstadoCivilId(c.civilState ?? "");

  return limpar({
    name: dados.nome,
    email: dados.email,
    password: opts.senha ?? gerarSenha(),
    profile_id: C2X_PROFILE.cliente,
    user_status_id: C2X_USER_STATUS.aprovado,
    vinculed_by_id: opts.vinculedById,

    cpf: soDigitos(c.cpf) || null,
    // Sempre CPF (decisão do Lucas): o número de identificação repete o CPF, não usamos o RG.
    document_type_id: DOC_TYPE_CPF,
    identification_number: soDigitos(c.cpf) || null,
    birthday: dataIso(c.birthday),
    phone: dados.telefone,

    civil_state_id: casado,
    // Regime de bens só é obrigatório para casado/união estável; matchRegimeBensId devolve string.
    property_regime_id:
      casado === 2 || casado === 6
        ? Number(matchRegimeBensId(c.propertyRegime ?? "")) || null
        : null,
    sex_id: matchSexoId(c.sex ?? ""),
    schooling_id:
      matchEscolaridadeId(c.schooling) ?? idPorRotulo(C2X_ESCOLARIDADE, c.schooling),
    salary_range_id:
      matchFaixaRendaId(c.salaryRange) ?? idPorRotulo(C2X_FAIXA_RENDA, c.salaryRange),
    profession_id: matchProfissaoId(c.profession),
    naturalness: c.naturalness,
    nacionality: c.nacionality,
    mother_name: c.motherName,

    spouse_attributes: spouseAttributes(c.spouse),
    addresses_attributes: addressesAttributes(dados.endereco),
    phones_attributes: phonesAttributes(dados.telefone),
    signers_attributes: signersAttributes({
      cpf: c.cpf,
      email: dados.email,
      nome: dados.nome,
      spouse: c.spouse,
    }),
  });
}

// IMOBILIÁRIA (profile_id = 6): pessoa jurídica. Vai com CNPJ, razão e nome fantasia.
export function montarPayloadImobiliaria(
  dados: DadosDaEntidade,
  opts?: { senha?: string },
): PayloadC2x {
  const c = dados.cadastro;
  return limpar({
    name: dados.nome,
    email: dados.email,
    password: opts?.senha ?? gerarSenha(),
    profile_id: C2X_PROFILE.imobiliaria,
    user_status_id: C2X_USER_STATUS.aprovado,
    person_type_id: 2, // Jurídica
    phone: dados.telefone,

    cnpj: soDigitos(c.cnpj) || null,
    social_name: c.socialName,
    fantasy_name: c.fantasyName ?? dados.nome,
    municipal_inscription: c.municipalInscription,
    user_nire: c.nire,
    open_company_date: dataIso(c.openCompanyDate),

    addresses_attributes: addressesAttributes(dados.endereco),
    phones_attributes: phonesAttributes(dados.telefone),
  });
}

// INCORPORADOR (profile_id = 3). Pode ser PF ou PJ; segue o cadastro.
export function montarPayloadIncorporador(
  dados: DadosDaEntidade,
  opts?: { senha?: string },
): PayloadC2x {
  const c = dados.cadastro;
  return limpar({
    name: dados.nome,
    email: dados.email,
    password: opts?.senha ?? gerarSenha(),
    profile_id: C2X_PROFILE.incorporador,
    user_status_id: C2X_USER_STATUS.aprovado,
    phone: dados.telefone,
    cpf: soDigitos(c.cpf) || null,
    cnpj: soDigitos(c.cnpj) || null,
    // Pessoa física do incorporador: sempre CPF, número repete o CPF.
    document_type_id: c.cnpj ? undefined : DOC_TYPE_CPF,
    identification_number: c.cnpj ? undefined : soDigitos(c.cpf) || null,
    birthday: dataIso(c.birthday),

    addresses_attributes: addressesAttributes(dados.endereco),
    phones_attributes: phonesAttributes(dados.telefone),
  });
}

export function montarPayload(
  perfil: PerfilC2x,
  dados: DadosDaEntidade,
  opts: { senha?: string; vinculedById?: number },
): PayloadC2x {
  if (perfil === "cliente") {
    if (!opts.vinculedById) {
      throw new Error("Cliente exige vinculedById (id da imobiliária no C2X).");
    }
    return montarPayloadCliente(dados, {
      senha: opts.senha,
      vinculedById: opts.vinculedById,
    });
  }
  if (perfil === "imobiliaria") return montarPayloadImobiliaria(dados, opts);
  return montarPayloadIncorporador(dados, opts);
}

// Documento (CPF/CNPJ) da entidade, só dígitos: a chave de reconciliação com o C2X.
export function documentoDoCadastro(cadastro: ApoloC2xCadastro): string {
  return soDigitos(cadastro.cnpj) || soDigitos(cadastro.cpf);
}

// ── TRANSPORTE ────────────────────────────────────────────────────────────

export type RespostaC2x =
  | { status: "success"; token: string | null }
  | { duplicado: boolean; erros: Record<string, string[]>; mensagem: string; status: "failed" }
  | { detalhe: string; status: "erro_transporte" };

type ConfigC2x = { base: string; token: string };

// A URL e a chave vêm da env (a chave é secret — configurada por fora, nunca no código).
export function configC2x(): ConfigC2x | null {
  const base = process.env.C2X_WRITE_API_URL?.trim();
  const token = process.env.C2X_WRITE_API_TOKEN?.trim();
  if (!base || !token) return null;
  return { base: base.replace(/\/$/, ""), token };
}

// A API responde 201 mesmo no erro: NUNCA olhar o código HTTP para decidir. O que vale é o campo
// `status` do corpo. A duplicata ("já cadastrado") não é falha real: é a idempotência da API, e
// quem chama resolve pelo id existente.
export function interpretarResposta(corpo: unknown): RespostaC2x {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (c.status === "success") {
    return { status: "success", token: typeof c.token === "string" ? c.token : null };
  }
  const erros = (c.errors ?? {}) as Record<string, string[]>;
  const mensagem = typeof c.errors_message === "string" ? c.errors_message : "";
  const duplicado = /j[aá] cadastrad/i.test(mensagem) || "cpf" in erros;
  return { duplicado, erros, mensagem, status: "failed" };
}

export async function enviarUsuarioC2x(payload: PayloadC2x): Promise<RespostaC2x> {
  const cfg = configC2x();
  if (!cfg) {
    return {
      detalhe: "C2X_WRITE_API_URL/C2X_WRITE_API_TOKEN não configuradas.",
      status: "erro_transporte",
    };
  }

  try {
    const resp = await fetch(`${cfg.base}/api/v1/users`, {
      body: JSON.stringify(payload),
      headers: {
        Accept: "application/json",
        Authorization: cfg.token,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const texto = await resp.text();
    let corpo: unknown = {};
    try {
      corpo = JSON.parse(texto);
    } catch {
      return {
        detalhe: `Resposta não-JSON (HTTP ${resp.status}): ${texto.slice(0, 200)}`,
        status: "erro_transporte",
      };
    }
    return interpretarResposta(corpo);
  } catch (erro) {
    return {
      detalhe: erro instanceof Error ? erro.message : String(erro),
      status: "erro_transporte",
    };
  }
}

// Documento (CPF/CNPJ) SEM máscara para logar/guardar. NUNCA logar a senha do payload.
export function payloadParaAuditoria(payload: PayloadC2x): PayloadC2x {
  const { password: _senha, ...resto } = payload;
  return resto;
}
