// Lê a DESCRIÇÃO da CAD do Asana — o corpo do formulário que o corretor preencheu.
//
// É a fonte mais rica e mais barata que temos: o formulário "CAD - Vale do Ouro" já pergunta
// profissão, renda, estado civil, escolaridade e os dados do cônjuge. Tudo isso estava
// chegando na descrição e sendo ignorado, enquanto o plano era PAGAR enriquecimento
// (R$ 1,06 por CPF) para descobrir parte disso.
//
// Formato real (um campo por bloco, rótulo e valor em linhas seguidas):
//
//   Nome do Proponente / Empresa:
//   Márcia aparecida de paula souza
//
//   Telefone do Proponente:
//   37998070958
//
//   Estado Civil:
//   Casado(a)
//
// O parser aceita tanto "Rótulo:\nvalor" quanto "Rótulo: valor" na mesma linha, porque o
// Asana varia conforme o formulário.

export type DadosDaDescricao = {
  conjuge: {
    email?: string;
    escolaridade?: string;
    nome?: string;
    profissao?: string;
    renda?: string;
    telefone?: string;
  };
  corretor?: string;
  corretorEmail?: string;
  imobiliaria?: string;
  proponente: {
    email?: string;
    escolaridade?: string;
    estadoCivil?: string;
    nome?: string;
    perfil?: string;
    profissao?: string;
    renda?: string;
    telefone?: string;
  };
};

function normalizarRotulo(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "Não informado" é resposta de formulário, não dado. Vira ausência para o campo continuar
// editável pelo operador em vez de exibir texto inútil.
const VAZIOS = new Set(["", "-", "nao informado", "não informado", "n/a", "na", "nao", "não"]);

function limpar(valor: string | undefined): string | undefined {
  const texto = (valor ?? "").trim();
  if (!texto) return undefined;
  return VAZIOS.has(normalizarRotulo(texto)) ? undefined : texto;
}

// Quebra a descrição em pares rótulo → valor.
function lerPares(descricao: string): Map<string, string> {
  const pares = new Map<string, string>();
  // O Asana manda a descrição com <br>/HTML em alguns casos; normaliza para linhas.
  const linhas = descricao
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split(/\r?\n/)
    .map((linha) => linha.trim());

  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i] ?? "";
    const posicao = linha.indexOf(":");
    if (posicao < 1) continue;

    const rotulo = normalizarRotulo(linha.slice(0, posicao));
    if (!rotulo) continue;

    // Valor na mesma linha; se vazio, cai para a próxima linha não vazia.
    let valor = linha.slice(posicao + 1).trim();
    if (!valor) {
      for (let j = i + 1; j < linhas.length; j += 1) {
        const proxima = linhas[j] ?? "";
        if (!proxima) continue;
        // Se a próxima já é outro rótulo, este campo veio vazio mesmo.
        if (/^[^:]{2,40}:/.test(proxima)) break;
        valor = proxima.trim();
        break;
      }
    }

    if (valor && !pares.has(rotulo)) pares.set(rotulo, valor);
  }

  return pares;
}

// Procura o primeiro rótulo que contenha TODOS os pedaços informados.
function achar(
  pares: Map<string, string>,
  pedacos: string[],
  excluir: string[] = [],
): string | undefined {
  for (const [rotulo, valor] of pares) {
    if (!pedacos.every((pedaco) => rotulo.includes(pedaco))) continue;
    if (excluir.some((termo) => rotulo.includes(termo))) continue;
    return limpar(valor);
  }
  return undefined;
}

export function extrairDaDescricao(descricao: string | null | undefined): DadosDaDescricao {
  const pares = lerPares(String(descricao ?? ""));

  // ⚠️ "conjuge" e "corretor" precisam ser EXCLUÍDOS dos campos do proponente: os três têm
  // e-mail, telefone e profissão, e sem isso o telefone do cônjuge viraria o do cliente.
  const semOutros = ["conjuge", "corretor", "solicitante"];

  return {
    conjuge: {
      email: achar(pares, ["mail", "conjuge"]),
      escolaridade: achar(pares, ["escolaridade", "conjuge"]),
      nome: achar(pares, ["nome", "conjuge"]),
      profissao: achar(pares, ["profissao", "conjuge"]),
      renda: achar(pares, ["renda", "conjuge"]),
      telefone: achar(pares, ["telefone", "conjuge"]),
    },
    corretor: achar(pares, ["corretor"], ["mail"]),
    corretorEmail: achar(pares, ["mail", "corretor"]),
    imobiliaria: achar(pares, ["imobiliaria"]),
    proponente: {
      email: achar(pares, ["mail", "proponente"]) ?? achar(pares, ["mail"], semOutros),
      escolaridade: achar(pares, ["escolaridade"], semOutros),
      estadoCivil: achar(pares, ["estado civil"], ["conjuge"]),
      nome: achar(pares, ["nome", "proponente"]) ?? achar(pares, ["nome"], semOutros),
      perfil: achar(pares, ["perfil"]),
      profissao: achar(pares, ["profissao"], semOutros),
      renda: achar(pares, ["renda"], semOutros),
      telefone:
        achar(pares, ["telefone", "proponente"]) ?? achar(pares, ["telefone"], semOutros),
    },
  };
}
