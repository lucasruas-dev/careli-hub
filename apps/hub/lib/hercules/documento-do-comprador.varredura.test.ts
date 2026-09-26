import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// UMA PEÇA SÓ DECIDE SE O DOCUMENTO DO COMPRADOR É DE PF OU DE PJ (varredura, 26/09/2026).
//
// Lucas (26/09/2026): *"na hora da reserva, dentro do hercules, temos que habilitar pessoa fisica e
// pessoa juridica, hoje só atende pessoa fisica"*.
//
// ⚠️ ANTES DESTE LOTE, A PERGUNTA "É PF OU PJ?" ESTAVA RESPONDIDA EM NOVE LUGARES, e três deles
// erravam em silêncio: `hashIdentifier("cpf", ...)` com um CNPJ dentro gera uma chave que JAMAIS
// casa com a CAD da empresa (o hash é `apolo-identifier:TIPO:valor`), e o documento anexado
// desaparece da ficha do cliente sem erro nenhum no log.
//
// ⚠️ E ISTO NÃO É TYPECHECK. `npm run check-types` passa com o namespace errado: os dois são a
// string "cpf". Só uma varredura no texto do repositório enxerga.
//
// As três varreduras deste arquivo:
//   1. nenhum arquivo do caminho da VENDA hasheia identificador no namespace literal "cpf";
//   2. nenhum arquivo do caminho da venda compara um tamanho com 11 ou 14 por conta própria;
//   3. nenhum arquivo lê a chave `cpf` de um item de `proponentes` fora do leitor único.
//
// ⚠️ A VARREDURA 2 NÃO EXIGE MAIS O NOME DA VARIÁVEL ANTES DO `.length` (26/09/2026). A expressão
// antiga era `\b(digitos|documento|doc|cpf|cnpj)\w*\.length ...`, e ela casava NOME, não a
// pergunta: `soDigitos(alvo.documento).length !== 11` — a forma mais natural de reescrever o
// portão que este lote mexeu — passava batido, e foi por isso que a cópia byte por byte de
// `mascararDocumento` em `lib/hercules/historico-da-unidade.ts` ficou verde com a varredura
// anunciando "nenhuma comparação de tamanho fora da peça única". Sem o nome, quem mede OUTRA coisa
// (telefone) precisa estar na lista de exceções, com o motivo escrito.
const RAIZ = path.resolve(__dirname, "..", "..");
const PASTAS = ["app", "components", "lib", "modules"];

/**
 * Quem pode hashear no namespace literal "cpf".
 *
 * O Apolo tem o tipo DECLARADO do identificador (o cadastro pergunta PF ou PJ e grava `cpf` ou
 * `cnpj` como tipo da linha): lá o literal é o dado, não um chute. No caminho da venda o documento
 * é o que decide, e quem responde é `namespaceDoHash`.
 */
const PODEM_HASHEAR_CPF = [
  path.join("lib", "apolo", "cadastro-persist.ts"),
  path.join("lib", "apolo", "credenciamento.ts"),
  path.join("lib", "apolo", "server.ts"),
  path.join("lib", "hercules", "documento-do-comprador.ts"),
];

/**
 * Quem pode comparar o tamanho do documento com 11 ou 14.
 *
 * `lib/temis/dados-do-contrato.ts` é o DONO da decisão do contrato e está documentado como tal
 * (o comentário de 08/09/2026 registra as seis entidades pj que carregavam CPF, e por isso o
 * documento vence o `entity_kind`); `lib/apolo/documento.ts` é o validador de CPF e CNPJ, onde o
 * tamanho é a definição do formato.
 */
const PODEM_MEDIR_TAMANHO = [
  path.join("lib", "apolo", "documento.ts"),
  path.join("lib", "hercules", "documento-do-comprador.ts"),
  path.join("lib", "temis", "dados-do-contrato.ts"),
  // O documento da IMOBILIÁRIA, que é sempre CNPJ por definição: não é documento de comprador, e
  // por isso a pergunta "PF ou PJ?" nem se faz ali.
  path.join("modules", "incorporador", "hercules", "ImobiliariasDoProduto.tsx"),
  // ⚠️ MEDE TELEFONE, NÃO DOCUMENTO. `formatarTelefoneGuardado` compara 10, 11, 12 e 13 dígitos
  // para separar DDI de DDD; o 11 dali é celular brasileiro sem DDI, e não CPF. Está aqui porque a
  // varredura deixou de exigir o nome da variável, e não porque a pergunta "PF ou PJ?" se faça nele.
  path.join("lib", "hercules", "paises.ts"),
];

/**
 * Quem pode ABRIR o jsonb `proponentes` por conta própria.
 *
 * ⚠️ `lib/prometeu/reservas-evento.ts` e `lib/prometeu/reservas-vivas.ts` leem
 * `prometeu_reservas.proponentes` — o CUPOM do salão, que é OUTRA tabela — e de lá tiram só `nome`,
 * `entityId` e `origem`. Documento nenhum passa por ali, e é por isso que ficam de fora da régua: a
 * invariante é do jsonb de `hercules_reservas`, que é o que vira proposta e contrato.
 */
const PODEM_ABRIR_PROPONENTES = [
  path.join("lib", "hercules", "proponente.ts"),
  path.join("lib", "prometeu", "reservas-evento.ts"),
  path.join("lib", "prometeu", "reservas-vivas.ts"),
];

/**
 * Onde a reserva do Hércules é escrita e lida. Inclui `lib/prometeu` porque o tótem do salão é a
 * SEGUNDA porta de escrita de `hercules_reservas.proponentes` (`proponentesParaOHercules`), e a
 * invariante da chave `cpf` vale para as duas.
 */
const CAMINHO_DA_RESERVA = [
  path.join("app", "api", "incorporador", "venda"),
  path.join("lib", "hercules"),
  path.join("lib", "prometeu"),
  path.join("modules", "incorporador", "hercules"),
];

/**
 * Só o caminho da venda: é onde o comprador entra, e é o que este lote arrumou.
 *
 * ⚠️ `lib/prometeu` FICA DE FORA DESTA LISTA de propósito, e está em `CAMINHO_DA_RESERVA`. Lá não
 * existe pergunta "PF ou PJ?" nenhuma (quem escreve o proponente do salão delega para
 * `documento-do-comprador.ts`), e o que existe é medida de TELEFONE: `boas-vindas-disparo.ts`,
 * `chamado-disparo.ts` e `convite-da-fila.ts` comparam 10, 11, 12 e 13 dígitos para separar DDI de
 * DDD. Trazer a pasta para cá só encheria a lista de exceções de coisas que não são documento.
 */
const CAMINHO_DA_VENDA = [
  path.join("app", "api", "incorporador", "venda"),
  path.join("lib", "hercules"),
  path.join("lib", "temis"),
  path.join("modules", "incorporador", "hercules"),
];

function arquivosDe(pasta: string): string[] {
  const saida: string[] = [];
  const andar = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === "node_modules" || item.name.startsWith(".")) continue;
      const cheio = path.join(dir, item.name);
      if (item.isDirectory()) andar(cheio);
      else if (/\.tsx?$/.test(item.name)) saida.push(cheio);
    }
  };
  const inicio = path.join(RAIZ, pasta);
  if (fs.existsSync(inicio)) andar(inicio);
  return saida;
}

const TODOS = PASTAS.flatMap(arquivosDe).map((cheio) => ({
  cheio,
  relativo: path.relative(RAIZ, cheio),
  texto: fs.readFileSync(cheio, "utf8"),
}));

const naVenda = (relativo: string) => CAMINHO_DA_VENDA.some((p) => relativo.startsWith(p));
const naReserva = (relativo: string) => CAMINHO_DA_RESERVA.some((p) => relativo.startsWith(p));
const ehTeste = (relativo: string) => /\.test\.tsx?$/.test(relativo);

/** Linhas de código, sem comentário de linha nem de bloco: o aviso fala de `cpf` de propósito. */
function linhasDeCodigo(texto: string): string[] {
  const semBloco = texto.replace(/\/\*[\s\S]*?\*\//g, "");
  return semBloco
    .split("\n")
    .map((linha) => linha.replace(/\/\/.*$/, ""))
    .filter((linha) => linha.trim().length > 0);
}

describe("o namespace do hash sai do documento, nunca de um literal", () => {
  it('⚠️ nenhum arquivo do caminho da venda escreve hashIdentifier("cpf"', () => {
    const achados: string[] = [];
    for (const { relativo, texto } of TODOS) {
      if (ehTeste(relativo)) continue;
      if (PODEM_HASHEAR_CPF.includes(relativo)) continue;
      if (!naVenda(relativo)) continue;
      for (const linha of linhasDeCodigo(texto)) {
        if (/hashIdentifier\(\s*["']cpf["']/.test(linha)) achados.push(`${relativo}: ${linha.trim()}`);
      }
    }
    expect(achados).toEqual([]);
  });
});

describe("o tamanho do documento é assunto de uma peça só", () => {
  it("⚠️ nenhum arquivo do caminho da venda compara documento com 11 ou 14 por conta própria", () => {
    // O `if (digitos.length !== 11)` do credenciamento e o `>= 11` dos dois hashes eram exatamente
    // isto: a mesma pergunta respondida de novo, cada vez um pouco diferente.
    const achados: string[] = [];
    for (const { relativo, texto } of TODOS) {
      if (ehTeste(relativo)) continue;
      if (PODEM_MEDIR_TAMANHO.includes(relativo)) continue;
      if (!naVenda(relativo)) continue;
      for (const linha of linhasDeCodigo(texto)) {
        if (/\b(digitos|documento|doc|cpf|cnpj)\w*\.length\s*[!=><]=+\s*(11|14)\b/i.test(linha)) {
          achados.push(`${relativo}: ${linha.trim()}`);
        }
        if (/\b(slice|substring)\(\s*0\s*,\s*11\s*\)/.test(linha) && /digito|documento|cpf/i.test(linha)) {
          achados.push(`${relativo}: ${linha.trim()}`);
        }
      }
    }
    expect(achados).toEqual([]);
  });
});

describe("as telas da venda nao chamam CNPJ de CPF", () => {
  // ⚠️ A FRASE "sem CPF no cadastro" MENTIA. `ModalDeProposta.tsx` deixava o candidato PJ
  // credenciado CINZA com ela, e ele tem CNPJ: o coordenador concluía que a empresa não tem
  // cadastro. E `TelaVenda.tsx` escrevia o rótulo "CPF" na unha, na tela em que se confere se é a
  // pessoa certa.
  it("⚠️ nenhuma tela da venda valida documento de comprador com cpfValido", () => {
    const achados: string[] = [];
    for (const { relativo, texto } of TODOS) {
      if (ehTeste(relativo)) continue;
      if (!relativo.startsWith(path.join("modules", "incorporador", "hercules"))) continue;
      for (const linha of linhasDeCodigo(texto)) {
        if (/\bcpfValido\s*\(/.test(linha)) achados.push(`${relativo}: ${linha.trim()}`);
      }
    }
    expect(achados).toEqual([]);
  });

  it('⚠️ a frase "sem CPF no cadastro" nao existe mais', () => {
    // Só o caminho da venda: a emissão de boletos tem a própria frase e é frente própria.
    const achados = TODOS.filter(
      ({ relativo, texto }) =>
        !ehTeste(relativo) &&
        naVenda(relativo) &&
        linhasDeCodigo(texto).some((linha) => linha.includes("sem CPF no cadastro")),
    ).map(({ relativo }) => relativo);
    expect(achados).toEqual([]);
  });

  it('⚠️ TelaVenda nao escreve o rotulo "CPF" na unha no card Cliente', () => {
    const tela = TODOS.find(
      ({ relativo }) => relativo === path.join("modules", "incorporador", "hercules", "TelaVenda.tsx"),
    );
    expect(tela).toBeTruthy();
    expect(tela!.texto).not.toContain('rotulo="CPF"');
    expect(tela!.texto).toContain("dados.documentoRotulo");
  });
});

describe("o jsonb dos proponentes tem um leitor só", () => {
  // ⚠️ ESTA É A VARREDURA QUE FALTAVA, E ELA É DO MECANISMO, NÃO DO NOME (26/09/2026). As QUATRO
  // leituras ad-hoc de `hercules_reservas.proponentes` (em `lib/hercules/reserva.ts`, em
  // `venda/proposta/route.ts`, em `venda/cliente/route.ts` e em `venda/documentos/route.ts`)
  // começaram todas do mesmo jeito: alguém abriu o array na mão e leu a chave que precisava. A
  // quarta sobreviveu à primeira versão deste lote lendo SÓ `primeiro?.cpf`, e como a rota da
  // reserva passou a espelhar `cpf` apenas quando o documento é CPF, ela gravava
  // `cliente_documento_hash` NULO numa reserva de PJ: o contrato social anexado desaparecia da
  // ficha da empresa, sem erro nenhum no log. A varredura do `hashIdentifier("cpf"` não pega isso,
  // porque o literal está certo; o que estava errado era o documento que entrava nele.
  //
  // ⚠️ A RÉGUA É ABRIR O ARRAY, E NÃO O NOME DA CHAVE, de propósito: para ler `cpf` (ou `nome`, ou
  // `documento`) de um proponente é preciso PRIMEIRO transformar o jsonb em array. Proibir o
  // `Array.isArray(...proponentes)` pega as SEIS leituras que existiam antes deste lote — inclusive
  // a de `documentos/route.ts`, que rebatizava a lista (`const lista = ...`) antes de indexar, e por
  // isso uma régua que procurasse só `proponentes[0]` a deixaria passar.
  it("⚠️ ninguém abre `proponentes` fora de lib/hercules/proponente.ts", () => {
    const achados: string[] = [];
    for (const { relativo, texto } of TODOS) {
      if (ehTeste(relativo)) continue;
      if (PODEM_ABRIR_PROPONENTES.includes(relativo)) continue;
      if (!naReserva(relativo)) continue;
      for (const linha of linhasDeCodigo(texto)) {
        if (/Array\.isArray\([^)]*proponentes/i.test(linha)) {
          achados.push(`${relativo}: ${linha.trim()}`);
        }
        if (/proponentes\s*\)?\s*\[\s*\d/.test(linha)) achados.push(`${relativo}: ${linha.trim()}`);
      }
    }
    expect(achados).toEqual([]);
  });
});
