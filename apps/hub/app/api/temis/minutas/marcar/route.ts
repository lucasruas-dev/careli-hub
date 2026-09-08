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

  const corpo = (await request.json().catch(() => ({}))) as { texto?: unknown };
  const texto = typeof corpo.texto === "string" ? corpo.texto : "";

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
      max_tokens: 16_000,
      messages: [
        {
          content: `CATÁLOGO DE VARIÁVEIS:\n${catalogoParaOModelo()}\n\n---\n\nTEXTO DA MINUTA:\n\n${texto}`,
          role: "user",
        },
      ],
      model: CLAUDE_MODEL.frontier,
      system: CONHECIMENTO_DA_TEMIS,
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
