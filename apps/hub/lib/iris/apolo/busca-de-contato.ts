// A busca que o modal "Abrir atendimento" usa para achar quem contactar.
//
// ⚠️ O NOME DA IMOBILIÁRIA ESTÁ NO ÍNDICE DE TODO CLIENTE DELA, e por isso ela afundava atrás da
// própria carteira. `lib/apolo/server.ts:4199` grava `user.linked_party_name` no normalized_text
// de CADA cliente. Medido em produção: "rr solucoes" casa 170 linhas, 169 são clientes dela, e a
// própria RR Soluções é a 170ª. Como a rota cortava em ordem física do heap (sem order by), ela
// nunca entrava nos 12 exibidos. Daí a régua abaixo: identidade ganha de carteira, sempre.
//
// ⚠️ O CONTATO DA ENTIDADE NÃO MORA EM `apolo_contacts`. Quem é cadastrado pelo card "Contatos"
// da aba Relacionamentos do Apolo vira linha em `apolo_relationships` com metadata.kind="contato"
// — nome no `label`, telefone em `metadata.phone`. Medido: 356 contatos, 258 com telefone, e 196
// desses telefones não existem em `apolo_contacts`. A Iris nunca leu essa tabela.

export type ContatoDaEntidade = {
  label: string | null;
  origem: "cadastro" | "relacionamento";
  primary: boolean;
  type: string;
  value: string;
};

export type EntidadeBuscavel = {
  displayName?: string | null;
  id: string;
  legalName?: string | null;
  tradeName?: string | null;
};

export type VinculoDeContato = {
  entity_id: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
};

// Mesma normalização de `app/api/iris/apolo/search/route.ts` — os dois lados têm que concordar,
// senão o termo pontuado aqui não é o termo procurado lá.
export function normalizarTermo(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[%_]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const SEM_TERMO = 3;

// Menor pontuação = mais relevante. 0 exato, 1 prefixo, 2 contém, 3 não tem o termo no nome
// próprio (chegou aqui só porque o índice guarda a carteira junto com a identidade).
export function pontuarRelevancia(
  entidade: EntidadeBuscavel,
  termo: string,
): number {
  const alvo = normalizarTermo(termo);

  if (!alvo) {
    return SEM_TERMO;
  }

  const nomes = [entidade.displayName, entidade.tradeName, entidade.legalName]
    .map((nome) => normalizarTermo(nome ?? ""))
    .filter(Boolean);

  let melhor = SEM_TERMO;

  for (const nome of nomes) {
    if (nome === alvo) {
      return 0;
    }

    if (nome.startsWith(alvo)) {
      melhor = Math.min(melhor, 1);
      continue;
    }

    if (nome.includes(alvo)) {
      melhor = Math.min(melhor, 2);
    }
  }

  return melhor;
}

// Ordenação ESTÁVEL: o índice entra como desempate para que resultados igualmente relevantes
// cheguem na ordem em que o banco os entregou, sem embaralhar a cada carga.
export function ordenarPorRelevancia<T extends EntidadeBuscavel>(
  entidades: T[],
  termo: string,
): T[] {
  if (!normalizarTermo(termo)) {
    return [...entidades];
  }

  return entidades
    .map((entidade, indice) => ({
      entidade,
      indice,
      pontos: pontuarRelevancia(entidade, termo),
    }))
    .sort((primeiro, segundo) =>
      primeiro.pontos !== segundo.pontos
        ? primeiro.pontos - segundo.pontos
        : primeiro.indice - segundo.indice,
    )
    .map((item) => item.entidade);
}

export function telefoneParaWhatsApp(valor: string): string | null {
  const digitos = (valor ?? "").replace(/\D/g, "");

  if (digitos.length >= 12 && digitos.length <= 15) {
    return digitos;
  }

  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos}`;
  }

  return null;
}

// ⚠️ TENTA TODOS, NÃO SÓ O PRIMEIRO. A versão anterior pegava o whatsapp e, se ele estivesse
// quebrado, devolvia null sem olhar o telefone seguinte — e a rota descartava a entidade inteira.
export function escolherTelefone(
  contatos: Array<{ type: string; value: string }>,
): string | null {
  const ordenados = [
    ...contatos.filter((contato) => contato.type === "whatsapp"),
    ...contatos.filter((contato) => contato.type !== "whatsapp"),
  ];

  for (const contato of ordenados) {
    const telefone = telefoneParaWhatsApp(contato.value ?? "");

    if (telefone) {
      return telefone;
    }
  }

  return null;
}

function textoDoMetadata(
  metadata: Record<string, unknown> | null | undefined,
  chave: string,
): string {
  const valor = metadata?.[chave];

  return typeof valor === "string" ? valor.trim() : "";
}

export function contatosDoVinculo(
  vinculos: VinculoDeContato[],
): Map<string, ContatoDaEntidade[]> {
  const porEntidade = new Map<string, ContatoDaEntidade[]>();

  for (const vinculo of vinculos) {
    const telefone = telefoneParaWhatsApp(
      textoDoMetadata(vinculo.metadata, "phone"),
    );

    if (!telefone) {
      continue;
    }

    const nome = (vinculo.label ?? "").trim();
    const papel = textoDoMetadata(vinculo.metadata, "role");
    const rotulo = nome
      ? papel
        ? `${nome} (${papel})`
        : nome
      : "Contato";

    const lista = porEntidade.get(vinculo.entity_id) ?? [];

    lista.push({
      label: rotulo,
      origem: "relacionamento",
      primary: false,
      type: "whatsapp",
      value: telefone,
    });
    porEntidade.set(vinculo.entity_id, lista);
  }

  return porEntidade;
}

// ⚠️ 62 dos 258 telefones de contato JÁ existem em `apolo_contacts`. Sem dedup o operador veria
// o mesmo número duas vezes, e a versão do cadastro (que tem `primary`) é a que manda.
// ⚠️ O CASAMENTO POR TELEFONE TEM QUE SER EM MEMÓRIA. O número mora no metadata COM MÁSCARA:
// medido, 194 dos 258 têm pontuação e 111 têm hífen ("+55 (31) 98980-4891"). Um `ilike` com
// dígitos crus no banco erraria justamente esses. Comparar só depois de normalizar os dois lados.
export function filtrarVinculosPorTermo(
  vinculos: VinculoDeContato[],
  termo: string,
  digitos: string,
): VinculoDeContato[] {
  const alvo = normalizarTermo(termo);
  const fone = (digitos ?? "").replace(/\D/g, "");
  const sufixo = fone.length >= 8 ? fone.slice(-8) : "";

  if (alvo.length < 2 && !sufixo) {
    return [];
  }

  return vinculos.filter((vinculo) => {
    if (alvo.length >= 2 && normalizarTermo(vinculo.label ?? "").includes(alvo)) {
      return true;
    }

    if (!sufixo) {
      return false;
    }

    const doVinculo = textoDoMetadata(vinculo.metadata, "phone").replace(
      /\D/g,
      "",
    );

    return doVinculo.length >= 8 && doVinculo.endsWith(sufixo);
  });
}

export function mesclarContatos(
  doCadastro: ContatoDaEntidade[],
  doRelacionamento: ContatoDaEntidade[],
): ContatoDaEntidade[] {
  const vistos = new Set(
    doCadastro.map((contato) => telefoneParaWhatsApp(contato.value) ?? contato.value),
  );
  const juntos = [...doCadastro];

  for (const contato of doRelacionamento) {
    const chave = telefoneParaWhatsApp(contato.value) ?? contato.value;

    if (vistos.has(chave)) {
      continue;
    }

    vistos.add(chave);
    juntos.push(contato);
  }

  return juntos;
}
