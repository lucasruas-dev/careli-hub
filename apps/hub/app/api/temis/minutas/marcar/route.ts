import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { CLAUDE_MODEL, getAnthropicClient } from "@/lib/ai/claude";
import {
  descreverProposta,
  motivoDaRecusa,
  type Proposta,
  type TipoDeProposta,
  triarPropostas,
} from "@/lib/temis/marcar-variaveis";
import { catalogoParaOModelo, CONHECIMENTO_DA_TEMIS } from "@/lib/temis/agente-conhecimento";

// O SUPER AGENTE DA MINUTA — lê o texto e diz onde cada variável entra.
//
// Lucas (07/09/2026): *"isso é o que eu quero, um super agente que consiga inserir as variáveis,
// olhar o texto e identificar onde as variáveis vão, e conhece todas as variáveis, pode subir para
// opus 5"*.
//
// ⚠️ ELE PROPÕE, NÃO REESCREVE — a decisão está explicada em `lib/temis/marcar-variaveis.ts`. O
// modelo devolve pares {trecho, variável}; o texto do contrato nunca passa por ele de volta. Assim
// nenhuma palavra do instrumento muda por conta de uma geração, e `[nome do cliente]` não tem como
// nascer.
//
// ⚠️ TODA PROPOSTA É CONFERIDA AQUI, no servidor, antes de chegar à tela: variável fora do catálogo,
// trecho que não existe no texto, trecho repetido e trecho já marcado são descartados. A tela mostra
// o que foi recusado e por quê — isso é informação útil, não erro escondido.
//
// ⚠️ OPUS 5 (`CLAUDE_MODEL.frontier`), e não o modelo padrão: a tarefa é ler um contrato de 60 mil
// caracteres e casar trechos com um catálogo de ~280 nomes parecidos entre si (`nome_cliente` x
// `nome_conjuge` x `nome_cliente_2`). Errar aqui é marcar o cônjuge como comprador.
//
// ⚠️ SÃO DUAS PASSADAS, E É AQUI QUE MORA A DIFERENÇA. Lucas, 08/09/2026, depois do primeiro teste
// com a minuta do Aldeia da Cachoeira: *"achei pouco as variáveis a serem inseridas, ainda não está
// legal, o que podemos fazer? Pois se te pedir para montar essa minuta você vai conseguir — queria
// era esse tipo de inteligência"*.
//
// Ele está certo, e a diferença não era de modelo: era de MÉTODO. Uma pessoa preparando essa minuta
// não entrega a primeira lista que escreve — ela relê o documento com a lista na mão e pergunta "o
// que passou?". Uma passada só é ótima nas primeiras seções (partes, imóvel) e vai rareando: as
// qualificações do começo são fáceis, e o modelo dá o trabalho por feito antes do fim.
//
// Então:
//
//   PASSADA 1   lê o texto e propõe.
//   PASSADA 2   recebe o TEXTO e a LISTA da primeira, e procura só o que ficou de fora — seção por
//               seção, com a pergunta explícita "que dado deste contrato ainda está escrito aqui?".
//
// As duas listas são unidas e passam pela mesma triagem. É o padrão do crítico de completude, e ele
// custa o dobro de uma passada — o que é barato perto de um jurídico marcando 60 variáveis à mão.
//
// ⚠️ E SÃO DUAS REQUISIÇÕES, NÃO DUAS CHAMADAS NUMA SÓ. O teto da função na Vercel é 300 segundos, e
// uma leitura de 45 mil caracteres por um modelo de fronteira, com resposta longa, come uma boa
// parte disso. Somar as duas na mesma requisição colocaria as DUAS passadas em risco de estourar
// junto — e um timeout aqui volta como TEXTO, não como JSON, então nem a mensagem de erro chega
// ([[reference_vercel_timeout_vira_erro_de_json]]). Separadas, cada uma tem os 300 segundos
// inteiros, e a segunda pode falhar sem levar a primeira junto.
//
// Quem orquestra é a TELA: manda a primeira rodada, recebe as propostas, e manda a segunda passando
// o que já veio (`jaPropostas` no corpo).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Contrato inteiro num modelo de fronteira: precisa de fôlego. O teto da Vercel é 300.
export const maxDuration = 300;

/** Quanto texto aceitamos de uma vez. Acima disso, a tela manda por partes. */
const TETO_DE_TEXTO = 120_000;

export async function POST(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  const cliente = getAnthropicClient();
  if (!cliente) {
    return NextResponse.json(
      { erro: "A IA não está configurada (falta ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    jaPropostas?: unknown;
    texto?: unknown;
  };
  const texto = typeof corpo.texto === "string" ? corpo.texto : "";
  // Quando vem lista, esta requisição é a RELEITURA: procura o que a primeira deixou passar.
  const jaPropostas = lerPropostas(
    typeof corpo.jaPropostas === "string" ? corpo.jaPropostas : JSON.stringify({ propostas: corpo.jaPropostas ?? [] }),
  );
  const ehReleitura = (jaPropostas?.length ?? 0) > 0;

  if (!texto.trim()) {
    return NextResponse.json({ erro: "Sem texto para marcar." }, { status: 400 });
  }

  if (texto.length > TETO_DE_TEXTO) {
    return NextResponse.json(
      {
        erro: `O texto tem ${texto.length.toLocaleString("pt-BR")} caracteres e o teto é ${TETO_DE_TEXTO.toLocaleString("pt-BR")}. Selecione um trecho e marque por partes.`,
      },
      { status: 413 },
    );
  }

  let bruto = "";
  try {
    const resposta = await cliente.messages.create({
      // ⚠️ 16 MIL TRUNCAVA A RESPOSTA, e o sintoma era "1 de 2 partes falharam" sem explicação: o
      // JSON vinha cortado no meio, `lerPropostas` não conseguia lê-lo, e a parte inteira virava
      // erro. Uma minuta de 50 mil caracteres rende 60 a 100 propostas, cada uma com trecho e
      // contexto — passa fácil de 16 mil tokens de saída.
      max_tokens: 48_000,
      messages: [
        {
          content: ehReleitura
            ? `CATÁLOGO DE VARIÁVEIS:\n${catalogoParaOModelo()}\n\n---\n\nTEXTO DA MINUTA:\n\n${texto}\n\n---\n\nO QUE JÁ FOI PROPOSTO NA PRIMEIRA LEITURA (${jaPropostas?.length ?? 0}):\n${listaDoQueJaVeio(jaPropostas ?? [])}`
            : `CATÁLOGO DE VARIÁVEIS:\n${catalogoParaOModelo()}\n\n---\n\nTEXTO DA MINUTA:\n\n${texto}`,
          role: "user",
        },
      ],
      model: CLAUDE_MODEL.frontier,
      system: ehReleitura ? `${CONHECIMENTO_DA_TEMIS}\n\n${RELEITURA}` : CONHECIMENTO_DA_TEMIS,
    });
    // Só os blocos de texto: a resposta pode trazer outros tipos (raciocínio, uso de ferramenta),
    // e concatenar tudo cegamente colocaria lixo dentro do JSON que vamos ler.
    bruto = resposta.content
      .map((bloco) => (bloco.type === "text" ? bloco.text : ""))
      .join("");
  } catch (e) {
    console.error("[temis][marcar] falha ao chamar o modelo", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "A IA não respondeu. Tente de novo." }, { status: 502 });
  }

  const propostas = lerPropostas(bruto);
  if (!propostas) {
    return NextResponse.json(
      { erro: "A IA respondeu num formato que não deu para ler." },
      { status: 502 },
    );
  }

  const { aceitas, recusadas } = triarPropostas(texto, propostas);

  return NextResponse.json({
    // A ordem de aplicação é de trás para a frente; a tela mostra na ordem do texto, que é como
    // quem revisa lê.
    propostas: [...aceitas].sort((a, b) => a.posicao - b.posicao).map((a) => ({
      // O que a proposta VAI FAZER, escrito em português: a tela mostra isso, e não o nome cru.
      acao: descreverProposta(a),
      // ⚠️ O CONTEXTO VIAJA ATÉ A TELA. Ela reacha o trecho no clique (o documento pode ter mudado),
      // e sem a mesma âncora a lacuna voltaria a ser ambígua exatamente onde a triagem a resolveu.
      contexto: a.contexto ?? "",
      motivo: a.motivo,
      nome: a.nome,
      // Só o tipo `variavel` tem origem e rótulo de catálogo; os outros descrevem a si mesmos.
      origem: a.variavel?.origem ?? "",
      posicao: a.posicao,
      rotulo: a.variavel?.rotulo ?? descreverProposta(a),
      tipo: a.tipo,
      trecho: a.trecho,
    })),
    // O que foi recusado é informação, não erro escondido: mostra que a rede de segurança agiu.
    recusadas: recusadas.map((r) => ({
      motivo: motivoDaRecusa(r),
      nome: r.proposta.nome,
      trecho: r.proposta.trecho,
    })),
  });
}

/**
 * Lê o JSON da resposta.
 *
 * ⚠️ TOLERA CERCA DE CÓDIGO E TEXTO EM VOLTA. O modelo às vezes embrulha o JSON em ```json apesar da
 * instrução; recusar por isso desperdiçaria uma resposta boa. O que NÃO se tolera é conteúdo
 * inválido — aí a triagem recusa proposta por proposta, que é onde a segurança mora.
 */
function lerPropostas(bruto: string): null | Proposta[] {
  const semCerca = bruto.replace(/^```(?:json)?/gm, "").replace(/```$/gm, "").trim();
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return null;

  try {
    const corpo = JSON.parse(semCerca.slice(inicio, fim + 1)) as { propostas?: unknown };
    if (!Array.isArray(corpo.propostas)) return null;
    return corpo.propostas
      .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
      .map((p) => ({
        contexto: typeof p.contexto === "string" ? p.contexto : undefined,
        motivo: typeof p.motivo === "string" ? p.motivo : "",
        nome: typeof p.nome === "string" ? p.nome : "",
        // Tipo desconhecido não é recusado aqui: a triagem trata como `variavel`, que é o que a
        // primeira versão do agente devolvia e o que ele faz na esmagadora maioria das vezes.
        tipo: typeof p.tipo === "string" ? (p.tipo as TipoDeProposta) : undefined,
        trecho: typeof p.trecho === "string" ? p.trecho : "",
      }));
  } catch {
    return null;
  }
}

/**
 * A lista do que a primeira leitura já propôs, como o modelo precisa ver.
 *
 * ⚠️ É ELA QUE TORNA A RELEITURA DIFERENTE DE RODAR DUAS VEZES. Sem a lista, a segunda chamada
 * devolveria mais ou menos as mesmas propostas — as fáceis, do começo do documento. Com a lista, a
 * pergunta muda de "o que tem aqui?" para "o que ficou de fora?", que é a pergunta que uma pessoa
 * faz na segunda leitura.
 */
function listaDoQueJaVeio(propostas: Proposta[]): string {
  if (propostas.length === 0) return "(nada)";
  return propostas
    .map((p) => `- [${p.nome || p.tipo || "?"}] sobre "${cortarParaLista(p.trecho)}"`)
    .join("\n");
}

function cortarParaLista(t: string): string {
  const limpo = (t ?? "").replace(/\s+/g, " ").trim();
  return limpo.length > 60 ? `${limpo.slice(0, 60)}…` : limpo;
}

const RELEITURA = `# ESTA É A SEGUNDA LEITURA

Você já leu esta minuta uma vez e produziu a lista que está no fim da mensagem. Agora releia o
documento com essa lista na mão e ache O QUE FICOU DE FORA.

Não repita nada da lista. Não comente o que já foi proposto. Devolva SÓ o que falta.

⚠️ ONDE A PRIMEIRA LEITURA COSTUMA FALHAR — procure nestes lugares primeiro:

1. NO FIM DO DOCUMENTO. A primeira leitura é minuciosa nas partes e no imóvel, e vai rareando: foro,
   assinaturas, quadro-resumo, cláusulas de tributos e de rescisão quase sempre ficam sem marcação.
2. NOS VALORES. Preço, sinal, entrada, saldo, prazo, dia de vencimento, comissão — e o POR EXTENSO
   de cada um deles, que é uma variável separada e é esquecida com frequência.
3. NAS REPETIÇÕES. O nome do comprador e a identificação do lote costumam aparecer três ou quatro
   vezes no contrato (qualificação, objeto, quadro-resumo, assinatura). A primeira leitura marca a
   primeira ocorrência e esquece as outras — use "contexto" para desambiguar cada uma.
4. NO CABEÇALHO E NO RODAPÉ DAS SEÇÕES. Títulos com o nome do empreendimento, "QUADRA X - LOTE Y",
   a cidade e a data.
5. NAS LACUNAS DISCRETAS: um "____" curto no meio de uma frase, um "(extenso)" vazio, um "[●]".
6. NOS BLOCOS CONDICIONAIS que ninguém propôs: o trecho do cônjuge, o do segundo comprador, o que só
   vale para pessoa jurídica. Se o documento tem uma qualificação de cônjuge solta, ela precisa de
   "envolver".

Percorra o documento inteiro, do título à última assinatura. Se você não achar nada, devolva
{"propostas":[]} — mas antes confira o fim do contrato, que é onde quase sempre há coisa.

Mesmo formato de saída de sempre, e as mesmas regras (trecho copiado, único ou com contexto, nome do
catálogo). Sem cerca de código.`;
