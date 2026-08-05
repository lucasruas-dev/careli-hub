// A ficha de uma pessoa nascida no Apolo vive em DOIS lugares, e até agora a integração com o C2X
// só olhava um deles:
//
//   `apolo_entities.metadata.cadastro` — o que a IMPORTAÇÃO do Asana gravou (ids do C2X em texto);
//   `apolo_esteira.ficha`              — o que o OPERADOR preencheu/corrigiu na tela do Board.
//
// A ficha tem campos que o cadastro nem conhece (sexo, regime de bens, RG e o endereço inteiro), e
// é ela que alimenta a CAD em PDF — o documento que o cliente assina. Por isso a ordem aqui é a
// MESMA de `cad-de-entidade.ts:6`: cadastro < ficha, a ficha ganha. Assim o que sobe pro C2X é
// igual ao que está no papel.
//
// O porém: em algumas fichas as duas fontes discordam sobre QUEM é a pessoa (nome da mãe e data de
// nascimento diferentes). Esses campos identificam o titular e vão no contrato, então divergência
// neles não se resolve escolhendo um lado: vira `divergenciasDeIdentidade` e a ficha fica de fora
// do envio automático, para conferência humana.
//
// ⚠️ O QUE ESTE SINAL **NÃO** PEGA. Ele não detecta a CAD montada com a pessoa errada (o OCR que
// para no documento do cônjuge). Motivo: a importação COPIA `metadata.cadastro` para a ficha
// (`gravarFichaDoLote`, asana-import.ts), então numa CAD que ninguém corrigiu as duas fontes
// nascem IDÊNTICAS — e dado trocado, sendo igual dos dois lados, passa liso. A divergência só
// aparece depois que um operador editou a ficha, que é justamente o caso já resolvido.
// Quem sabe responder "de quem é esta ficha" é `cad-diagnostico.ts` (`classificarCad`), porque usa
// a ÂNCORA certa: o nome do proponente no formulário do Asana. Rodar aquele diagnóstico continua
// sendo pré-requisito do envio em massa; o que está aqui é uma rede a mais, não a rede principal.
//
// Profissão, renda, escolaridade e estado civil também divergem às vezes, mas ali a ficha ganha sem
// alarde: são dados que mudam com o tempo e o operador é a fonte mais nova.

import { normalizeSearch } from "./c2x-fields";

// Campos pessoais que as duas fontes compartilham (mesma chave nos dois lados).
export const CAMPOS_PESSOAIS = [
  "dataNascimento",
  "escolaridadeId",
  "estadoCivilId",
  "nacionalidade",
  "naturalidade",
  "nomeMae",
  "nomePai",
  "orgaoEmissor",
  "profissaoId",
  "regimeBensId",
  "rendaId",
  "rg",
  "sexoId",
] as const;

// Divergir NESTES dois é sinal de ficha trocada: identificam o titular e vão no contrato.
export const CAMPOS_DE_IDENTIDADE = ["dataNascimento", "nomeMae"] as const;

export type FonteCadastro = Record<string, unknown> | null | undefined;

export type EnderecoDaFicha = {
  bairro: string;
  cep: string;
  cidade: string;
  complemento: string;
  logradouro: string;
  numero: string;
  uf: string;
};

export type CadastroUnido = {
  // Campos onde as duas fontes discordam sobre a IDENTIDADE — bloqueiam o envio automático.
  divergenciasDeIdentidade: string[];
  // Campos onde discordam sem risco de identidade (a ficha ganhou). Só para o relatório.
  divergenciasComuns: string[];
  // Campos que só existiam na ficha e o cadastro não tinha. Só para o relatório.
  vindosDaFicha: string[];
  valores: Record<string, string>;
};

const texto = (v: unknown): string =>
  typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();

// Duas grafias do mesmo dado ("DJAN RA DE FATIMA" vs "Djanra de Fátima") não são divergência de
// verdade: comparamos sem acento, sem caixa e com os espaços colapsados.
function mesmoValor(a: string, b: string): boolean {
  const limpar = (v: string) => normalizeSearch(v).replace(/\s+/g, " ");
  return limpar(a) === limpar(b);
}

// Junta as duas fontes. A ficha ganha quando tem valor; o cadastro entra onde a ficha é omissa.
export function unirCadastroEFicha(cadastro: FonteCadastro, ficha: FonteCadastro): CadastroUnido {
  const cad = (cadastro ?? {}) as Record<string, unknown>;
  const fic = (ficha ?? {}) as Record<string, unknown>;

  const valores: Record<string, string> = {};
  const divergenciasDeIdentidade: string[] = [];
  const divergenciasComuns: string[] = [];
  const vindosDaFicha: string[] = [];

  for (const campo of CAMPOS_PESSOAIS) {
    const doCadastro = texto(cad[campo]);
    const daFicha = texto(fic[campo]);

    if (doCadastro && daFicha && !mesmoValor(doCadastro, daFicha)) {
      const ehIdentidade = (CAMPOS_DE_IDENTIDADE as readonly string[]).includes(campo);
      (ehIdentidade ? divergenciasDeIdentidade : divergenciasComuns).push(campo);
    } else if (daFicha && !doCadastro) {
      vindosDaFicha.push(campo);
    }

    const escolhido = daFicha || doCadastro;
    if (escolhido) valores[campo] = escolhido;
  }

  return { divergenciasComuns, divergenciasDeIdentidade, valores, vindosDaFicha };
}

// ── CÔNJUGE ───────────────────────────────────────────────────────────────
//
// O cônjuge também vive em dois lugares: `apolo_relationships` (criado no cadastro) e a ficha
// (onde o operador edita — o PATCH do board grava SÓ na ficha). A CAD assinada resolve campo a
// campo com a ficha ganhando (`cad-de-entidade.ts:303`), e é isso que espelhamos aqui: sem isso o
// C2X recebe o nome antigo do relacionamento enquanto o cliente assinou o novo, e um casado cujo
// cônjuge só existe na ficha subiria sem cônjuge nenhum nos assinantes do contrato.
export type ConjugeUnido = {
  cpf: string;
  email: string;
  nome: string;
  telefone: string;
};

export function unirConjuge(
  ficha: FonteCadastro,
  doRelacionamento: { cpf?: unknown; email?: unknown; nome?: unknown; telefone?: unknown } | null,
): ConjugeUnido | null {
  const f = (ficha ?? {}) as Record<string, unknown>;
  const r = doRelacionamento ?? {};

  const nome = texto(f.conjugeNome) || texto(r.nome);
  // Sem nome não há cônjuge para o C2X — é o campo que identifica o assinante.
  if (!nome) return null;

  return {
    cpf: texto(f.conjugeCpf) || texto(r.cpf),
    email: texto(f.conjugeEmail) || texto(r.email),
    nome,
    telefone: texto(f.conjugeTelefone) || texto(r.telefone),
  };
}

// ── FICHA COSTURADA DE DUAS PESSOAS ───────────────────────────────────────
//
// Quando a ficha tem o cônjuge preenchido, dá para pegar um caso que a comparação entre as duas
// fontes nunca veria: titular e cônjuge dividindo um dado que duas pessoas não dividem. Não é a
// checagem principal (essa é a do Asana, em `cad-diagnostico.ts`), e alcança só as fichas com
// cônjuge — mas quando dispara, dispara com razão.
export function sinaisDeFichaCosturada(
  ficha: FonteCadastro,
  documentoDoTitular: string | null,
): string[] {
  const f = (ficha ?? {}) as Record<string, unknown>;
  const sinais: string[] = [];
  const digitos = (v: unknown) => texto(v).replace(/\D/g, "");

  const cpfConjuge = digitos(f.conjugeCpf);
  if (cpfConjuge && cpfConjuge === digitos(documentoDoTitular)) {
    sinais.push("o CPF do cônjuge é o mesmo do titular");
  }

  const maeTitular = texto(f.nomeMae);
  const maeConjuge = texto(f.conjugeMae);
  if (maeTitular && maeConjuge && mesmoValor(maeTitular, maeConjuge)) {
    sinais.push("titular e cônjuge com a mesma mãe");
  }

  const nascTitular = texto(f.dataNascimento);
  const nascConjuge = texto(f.conjugeNascimento);
  if (nascTitular && nascConjuge && nascTitular === nascConjuge) {
    sinais.push("titular e cônjuge com a mesma data de nascimento");
  }

  return sinais;
}

// ── ENDEREÇO ──────────────────────────────────────────────────────────────
//
// Só 10 das 343 CADs do lançamento têm linha em `apolo_addresses`; o endereço de 314 delas está
// solto na ficha. Sem isto o C2X recebe cliente sem endereço.
// Resolve o endereço CAMPO A CAMPO, com a ficha do operador ganhando de `apolo_addresses` — a
// mesma regra da CAD assinada (`cad-de-entidade.ts:319`). Escolher a fonte inteira faria o cliente
// assinar "Rua B, 250" (ficha corrigida) e o C2X gravar "Rua A, 10" (endereço antigo da tabela).
export function unirEndereco(
  ficha: FonteCadastro,
  cadastrado: Partial<EnderecoDaFicha> | null,
): EnderecoDaFicha | null {
  const f = (ficha ?? {}) as Record<string, unknown>;
  const c = cadastrado ?? {};
  const escolher = (daFicha: unknown, doCadastro: unknown) => texto(daFicha) || texto(doCadastro);

  const endereco: EnderecoDaFicha = {
    bairro: escolher(f.bairro, c.bairro),
    cep: escolher(f.cep, c.cep),
    cidade: escolher(f.cidade, c.cidade),
    complemento: escolher(f.complemento, c.complemento),
    logradouro: escolher(f.logradouro, c.logradouro),
    numero: escolher(f.numero, c.numero),
    uf: escolher(f.uf, c.uf),
  };

  // Sem rua nem CEP não há endereço utilizável — o C2X recusaria de qualquer forma.
  if (!endereco.logradouro && !endereco.cep) return null;
  return endereco;
}

// ── NACIONALIDADE ─────────────────────────────────────────────────────────

const UFS = new Set([
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]);

// A naturalidade vem como "PARA DE MINAS / MG" (o formato dominante) ou só "PARA DE MINAS".
export function partesDaNaturalidade(naturalidade: string): { cidade: string; uf: string | null } {
  const bruto = texto(naturalidade);
  const m = bruto.match(/^(.*?)[\s]*[/\-][\s]*([A-Za-z]{2})$/);
  if (m?.[1] != null && m[2]) {
    const uf = m[2].toUpperCase();
    if (UFS.has(uf)) return { cidade: m[1].trim(), uf };
  }
  return { cidade: bruto, uf: null };
}

// Deriva a nacionalidade a partir da naturalidade, como o Lucas pediu: cidade brasileira -> pessoa
// brasileira. Nunca sobrescreve uma nacionalidade já preenchida.
//
// A UF sufixada já é prova (só existem as 27 daqui). Sem UF, quem decide é `ehCidadeBrasileira` —
// injetado para que o chamador consulte a tabela `cities` do C2X (a mesma que resolve o endereço)
// em vez de a gente adivinhar por lista. Se ninguém souber responder, devolve null: melhor campo
// vazio do que nacionalidade inventada num contrato.
export function derivarNacionalidade(
  naturalidade: string,
  nacionalidadeAtual: string,
  ehCidadeBrasileira?: (cidade: string) => boolean,
): string | null {
  if (texto(nacionalidadeAtual)) return null;
  const { cidade, uf } = partesDaNaturalidade(naturalidade);
  if (!cidade) return null;
  if (uf) return "Brasileira";
  return ehCidadeBrasileira?.(cidade) ? "Brasileira" : null;
}
