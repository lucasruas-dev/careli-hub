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
  C2X_PERSON_TYPE,
  C2X_PROFILE,
  C2X_PROFISSAO_NAO_DECLARADA,
  C2X_USER_STATUS,
  matchCompanySizeId,
  matchEstadoCivilId,
  matchRegimeBensId,
  matchSexoId,
} from "./c2x-fields";
import {
  matchEscolaridadeId,
  matchFaixaRendaId,
  matchProfissaoId,
} from "./c2x-match";
import type { ApoloC2xCadastro, ApoloC2xRepresentante, ApoloC2xSpouse } from "./types";

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

// PAPEL da entidade no Apolo (`metadata.bornRole`) -> PERFIL no C2X.
//
// ⚠️ O perfil sai do PAPEL, NUNCA da persona PF/PJ. A regra antiga decidia por `entity_kind`
// ("pj" => imobiliária) e, com o filtro de PJ liberado, faria os clientes PJ credenciados
// nascerem como IMOBILIÁRIA (profile_id 6) em produção — o POST genérico cria de novo a cada
// chamada e não tem desfazer. Cliente é cliente, seja PF ou PJ (decisão do Lucas 05/08, olhando
// a tela do C2X: PJ entra pelo MESMO cadastro de cliente, mudando o tipo de pessoa).
//
// Quem NÃO tem perfil no C2X devolve null e NÃO sobe: o corretor mora só no Apolo (ver o
// comentário do C2X_PROFILE em c2x-fields.ts), e fornecedor/parceiro/colaborador não são
// cadastro do sistema de vendas. Null = não envia, em vez de chutar um perfil.
export function perfilPorPapel(papel: string | null | undefined): PerfilC2x | null {
  switch (String(papel ?? "").trim()) {
    case "prospect":
      return "cliente";
    case "imobiliaria":
      return "imobiliaria";
    case "incorporador":
      return "incorporador";
    default:
      return null;
  }
}

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

// HOJE em YYYY-MM-DD, no fuso de Brasília. A Vercel roda em UTC: usar `toISOString()` gravaria o
// dia seguinte em todo envio depois das 21h daqui.
function hojeIso(): string {
  // "en-CA" formata exatamente como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

// DATA DA ATUALIZAÇÃO CADASTRAL da PJ (`social_contract_updated_at`, coluna DATE no C2X).
//
// O que o campo é DE VERDADE: a "data da situação cadastral" do cartão CNPJ da Receita — em 464
// dos 523 clientes PJ do C2X ela é idêntica à data de abertura, que é a assinatura desse cartão.
// Por isso a fonte preferida é o dado real do cadastro.
//
// HOJE é o ÚLTIMO recurso, autorizado pelo Lucas em 05/08 ("pode ser a data de hoje") para o
// cadastro não travar por falta dela. É um preenchimento de conveniência, não um fato: só 14 dos
// 523 PJ do C2X têm data no ano corrente.
//
// ⚠️ SEMPRE devolve valor. `limpar()` (abaixo) apaga chave vazia do JSON, e sem a chave o C2X
// recusa a PJ com a MESMA mensagem de sempre ("data da atualização cadastral não pode ficar em
// branco") — o envio pareceria não ter sido corrigido.
export function dataAtualizacaoCadastralC2x(valor: string | null | undefined): string {
  return dataIso(valor) ?? hojeIso();
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

// ASSINANTE DA PJ: quem assina pela empresa é o REPRESENTANTE LEGAL, não a empresa e não um
// cônjuge (a PJ não tem). Sem representante legal a lista fica vazia e a chave nem entra.
function signersRepresentante(rep: ApoloC2xRepresentante | null): PayloadC2x[] {
  if (!rep?.name) return [];
  const cpf = soDigitos(rep.cpf) || null;
  return [
    limpar({
      document_type_id: cpf ? DOC_TYPE_CPF : null,
      email: rep.email,
      identification_number: cpf,
      name: rep.name,
    }),
  ];
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
  // Cliente PESSOA JURÍDICA entra pelo MESMO cadastro de cliente (profile_id 2), só mudando o
  // tipo de pessoa — é o que a tela do C2X faz. O caminho PF continua exatamente o de baixo,
  // sem um byte de diferença: é o fluxo principal, com centenas de cadastros criados.
  if (c.isCompany) return montarPayloadClientePj(dados, opts);

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

// CLIENTE PESSOA JURÍDICA (profile_id = 2, person_type_id = 2). A empresa compra o lote, então
// ela é CLIENTE — não imobiliária. O payload é a união do cliente (perfil, status, vínculo com a
// imobiliária, assinantes) com a parte de empresa da imobiliária (CNPJ, razão social, nome
// fantasia, NIRE, inscrição municipal, data de abertura, porte).
//
// O QUE FICA DE FORA, de propósito: cpf, document_type_id, identification_number, birthday,
// mother_name, civil_state_id, property_regime_id, sex_id, schooling_id, salary_range_id,
// naturalness, nacionality e spouse_attributes. Esses campos são da PESSOA FÍSICA e, nos 80
// clientes PJ que já existem no C2X, estão vazios em quase todos. Melhor ausente que inventado.
//
// O que vem do SÓCIO (autorizado pelo Lucas): a PROFISSÃO e o ASSINANTE do contrato, os dois do
// representante legal. Enquanto a etapa Sócios do wizard não coletar profissão, a profissão cai
// em "PROFISSÃO NÃO DECLARADA" — o mesmo id que 75 dos 80 clientes PJ do C2X usam.
export function montarPayloadClientePj(
  dados: DadosDaEntidade,
  opts: { senha?: string; vinculedById: number },
): PayloadC2x {
  const c = dados.cadastro;
  const rep = c.legalRepresentative;

  return limpar({
    name: dados.nome,
    email: dados.email,
    password: opts.senha ?? gerarSenha(),
    profile_id: C2X_PROFILE.cliente,
    user_status_id: C2X_USER_STATUS.aprovado,
    // Sem isto a empresa nasce marcada como pessoa FÍSICA com CNPJ: o C2X assume física.
    person_type_id: C2X_PERSON_TYPE.juridica,
    // O cliente não entra solto no C2X, nem quando é empresa: vai vinculado à imobiliária.
    vinculed_by_id: opts.vinculedById,
    phone: dados.telefone,

    cnpj: soDigitos(c.cnpj) || null,
    social_name: c.socialName,
    fantasy_name: c.fantasyName ?? dados.nome,
    municipal_inscription: c.municipalInscription,
    user_nire: c.nire,
    open_company_date: dataIso(c.openCompanyDate),
    // O C2X recusa a PJ sem esta data ("Documento data da atualização cadastral não pode ficar em
    // branco"). Nunca vem vazia: ver `dataAtualizacaoCadastralC2x`.
    social_contract_updated_at: dataAtualizacaoCadastralC2x(c.socialContractUpdatedAt),
    company_size_id: matchCompanySizeId(c.companySize),
    profession_id:
      matchProfissaoId(rep?.profession ?? c.profession) ?? C2X_PROFISSAO_NAO_DECLARADA,

    addresses_attributes: addressesAttributes(dados.endereco),
    phones_attributes: phonesAttributes(dados.telefone),
    signers_attributes: signersRepresentante(rep),
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

// ── ANEXO (contrato social da PJ) ─────────────────────────────────────────

// Nome da PARTE de arquivo no multipart. Espelha o nome do anexo no C2X
// (`active_storage_attachments.name = 'social_contract'`), do mesmo jeito que o resto da API
// espelha nome de coluna 1:1 (`open_company_date`, `user_nire`, `municipal_inscription`).
export const C2X_CAMPO_CONTRATO_SOCIAL = "social_contract";

// Teto do arquivo que sai daqui para o C2X. É o mesmo teto do upload no Apolo
// (APOLO_DOC_MAX_BYTES, em lib/apolo/documentos.ts): nada que o corretor consiga anexar na tela é
// descartado por tamanho no envio. Documento que chegou por outro caminho (importação) e passa
// disso NÃO sobe, e o motivo é gravado — melhor recusar com mensagem legível do que um POST que
// morre por tamanho no meio.
export const C2X_ANEXO_MAX_BYTES = 20 * 1024 * 1024;

// Um arquivo pronto para virar parte de multipart. `bytes` já veio do Storage.
export type AnexoC2x = {
  bytes: Uint8Array;
  // Nome da parte no formulário (ex.: "social_contract").
  campo: string;
  contentType: string;
  fileName: string;
};

// Payload -> multipart, na notação de colchetes que o Rack entende.
//
// ⚠️ POR QUE ISTO EXISTE E POR QUE É SÓ DA PJ: o payload de hoje é plano na raiz e leva nested
// attributes em ARRAY (`addresses_attributes`, `phones_attributes`, `signers_attributes`,
// `spouse_attributes`). Em JSON isso já funciona em centenas de cadastros PF, e trocar o
// transporte do fluxo geral por causa de um anexo seria arriscar o caminho que funciona. Só quem
// tem arquivo para mandar passa por aqui.
//
// A conversão é: escalar vira `chave=valor`; objeto vira `chave[sub]`; array vira `chave[0][sub]`
// (índice explícito — `chave[][sub]` só funciona enquanto cada item tem uma chave só).
export function payloadParaFormData(payload: PayloadC2x): FormData {
  const form = new FormData();
  const anexar = (chave: string, valor: unknown): void => {
    if (valor === null || valor === undefined) return;
    if (Array.isArray(valor)) {
      valor.forEach((item, i) => anexar(`${chave}[${i}]`, item));
      return;
    }
    if (typeof valor === "object") {
      for (const [sub, v] of Object.entries(valor as Record<string, unknown>)) {
        anexar(`${chave}[${sub}]`, v);
      }
      return;
    }
    form.append(chave, String(valor));
  };
  for (const [chave, valor] of Object.entries(payload)) anexar(chave, valor);
  return form;
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

  // DUPLICATA é só quando o DOCUMENTO (CPF/CNPJ) já existe: aí a pessoa realmente está no C2X e
  // quem chama resolve pelo id. Qualquer OUTRO campo repetido é erro de validação comum.
  //
  // ⚠️ POR QUE ISSO É ESTRITO (caso Vovo Braga, 05/08): a regra antiga marcava duplicata por
  // qualquer "já cadastrado" na mensagem. O C2X recusou a Vovo com TRÊS erros ("contrato social
  // não pode ficar em branco", "data da atualização cadastral não pode ficar em branco" e
  // "e-mail de acesso já cadastrado"), e o "já cadastrado" do E-MAIL fez o envio ser tratado como
  // duplicata. Como o CNPJ não estava no C2X, a busca pelo id voltava vazia e a ficha era marcada
  // "sem confirmação", com a mensagem culpando o AMBIENTE. Os três motivos reais ficavam
  // escondidos no corpo da resposta, e quem lesse a tela iria caçar env errada em vez de anexar
  // o contrato social.
  const chaves = Object.keys(erros).map((k) => k.toLowerCase());
  const documentoDuplicado = chaves.some((k) => k === "cpf" || k === "cnpj");
  const soFalaDoDocumento =
    /(cpf|cnpj)[^.]{0,40}j[aá] cadastrad/i.test(mensagem) ||
    (chaves.length > 0 && chaves.every((k) => k === "cpf" || k === "cnpj"));
  const duplicado = documentoDuplicado || soFalaDoDocumento;
  return { duplicado, erros, mensagem, status: "failed" };
}

// `anexo` só é passado quando há arquivo (hoje: o contrato social da PJ). SEM anexo o corpo é
// exatamente o JSON de sempre, byte a byte — é o caminho que criou centenas de cadastros PF e não
// muda. COM anexo o mesmo payload vai em multipart, os bytes na MESMA requisição que cria o user
// (é o que o banco do C2X mostra: em 522 de 522 contratos sociais o attachment e o blob nasceram
// juntos, então não é direct upload por `signed_id`).
//
// No multipart o `Content-Type` NÃO é definido à mão: quem escreve o cabeçalho com o boundary é o
// fetch, a partir do FormData. Definir na mão quebra o parse do lado do Rails.
export async function enviarUsuarioC2x(
  payload: PayloadC2x,
  anexo?: AnexoC2x | null,
): Promise<RespostaC2x> {
  const cfg = configC2x();
  if (!cfg) {
    return {
      detalhe: "C2X_WRITE_API_URL/C2X_WRITE_API_TOKEN não configuradas.",
      status: "erro_transporte",
    };
  }

  let corpoRequisicao: BodyInit;
  const cabecalhos: Record<string, string> = {
    Accept: "application/json",
    Authorization: cfg.token,
  };
  if (anexo) {
    const form = payloadParaFormData(payload);
    // O cast existe porque `bytes` pode vir como Buffer (Uint8Array<ArrayBufferLike>) e o tipo de
    // BlobPart do DOM só aceita ArrayBuffer. Em tempo de execução é o mesmo objeto.
    form.append(
      anexo.campo,
      new Blob([anexo.bytes as unknown as BlobPart], { type: anexo.contentType }),
      anexo.fileName,
    );
    corpoRequisicao = form;
  } else {
    corpoRequisicao = JSON.stringify(payload);
    cabecalhos["Content-Type"] = "application/json";
  }

  try {
    const resp = await fetch(`${cfg.base}/api/v1/users`, {
      body: corpoRequisicao,
      headers: cabecalhos,
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
