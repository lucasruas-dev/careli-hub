"use client";

import { Check, ChevronRight, Loader2, Plus, SendHorizontal, Wand2, X } from "lucide-react";
import type { Value } from "platejs";
import {
  Plate,
  type PlateEditor,
  useEditorRef,
  usePlateEditor,
  usePluginOption,
} from "platejs/react";
import { useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";

import { discussionPlugin } from "@/components/editor/plugins/discussion-kit";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  type BlocoPronto,
  BLOCOS_PRONTOS,
  nosDoBloco,
  textoDoBloco,
} from "@/lib/temis/blocos-prontos";
import type { NoDoDocumento } from "@/lib/temis/documento-html";
import { migrarAlinhamentoAntigo } from "@/lib/temis/migrar-documento";
import { acharVariavel, variaveisDoTexto } from "@/lib/temis/variaveis";
import { setMinutaAtualParaUpload } from "@/lib/temis/upload-midia";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { useAuth } from "@/providers/auth-provider";

import { faixaDoTrecho, textoDoDocumento, trechoJaEmNegrito } from "./plugins/achar-trecho";
import { noDeQuebraDePagina } from "./plugins/quebra-de-pagina-base";

import { EditorKitTemis } from "./editor-kit-temis";
import { TemisToolbarPlugin } from "./plugins/temis-toolbar-kit";
import { inserirVariavel } from "./plugins/variavel-input-kit";
import {
  noDeVariavel,
  origemPendente,
  promoverVariaveisNoValor,
  VARIAVEIS_POR_GRUPO,
  variaveisNoValor,
} from "./plugins/variavel-kit-base";

// O EDITOR DA MINUTA — o "Word" do jurídico, agora com o Plate UI completo.
//
// Pedido do Lucas (01/09/2026): *"não quero o mesmo editor do C2x, é muito ruimmmmmmmmm, quero algo
// mais proximo de um word"*, e *"lembrando que temos que inserir as variaveis que vão se alimentadas
// pelo sistema"*. E em 02/09/2026, ao comparar com o demo "An AI editor" do Plate: *"não temos todas
// essas ferramentas, revise as documentações pois quero isso completo, estamos muito simples"*.
//
// ⚠️ NADA DO C2X. Lucas (02/09/2026): *"não quero nada do c2x, todas as variáveis tem que nascer do
// panteon, esquece c2x como consulta"*. O botão "Do C2X" saiu; a prop `enterpriseId` saiu com ele
// (só existia para listar minutas do legado). O que entra aqui vem do .docx do loteador ou é escrito.
//
// O QUE ESTE ARQUIVO FAZ, e o que delega:
// - monta o editor com `EditorKitTemis` (o EditorKit do Plate + variável + busca + barra da Têmis);
// - converte o documento na fronteira (Value do Plate ↔ NoDoDocumento[] do Temis) UMA vez, aqui;
// - mostra o painel de variáveis ao lado da folha;
// - liga o upload de mídia à minuta aberta e o usuário logado às discussões.
// A barra de ferramentas é o plugin `temis-toolbar-kit.tsx`; o chip e o combobox da variável são
// `variavel-kit.tsx`/`variavel-input-kit.tsx`; o HTML do contrato continua em
// `lib/temis/documento-html.ts` (serializador próprio — ver a decisão no topo dele).
//
// ⚠️ A PÁGINA TEM LARGURA DE PAPEL, e não é estética: o jurídico revisa quebra de linha e quebra de
// cláusula. Um editor que ocupa 1.900 px de tela mostra um texto que não se parece com o contrato
// impresso, e o revisor perde a única referência que tem.
//
// ⚠️ A VARIÁVEL É INSERIDA PELO MENU OU PELO `[`, e nunca digitada solta. `[nome_cliente]` digitado
// à mão erra por um caractere e o contrato sai com "[nome_clientes]" impresso — foi assim que
// `[Nome]` e `[CPF]` entraram nas minutas antigas. O catálogo só oferece o que o Panteon preenche.

// ⚠️ O DOCUMENTO ATRAVESSA A FRONTEIRA UMA VEZ SÓ, E É AQUI. Do lado do editor ele é o `Value` do
// Plate; do lado do Temis é `NoDoDocumento[]`, que é o que `documento-html.ts` sabe serializar. São
// a mesma coisa em memória — a diferença é só de tipo. Concentrar a conversão neste ponto evita
// espalhar `as` pelo módulo inteiro e deixa claro onde a garantia começa. Não há migração de shape:
// os kits do Plate usam as MESMAS chaves e props dos plugins que já gravávamos (p, h1, td, bold,
// fontFamily, align, indent, listStyleType…); o JSON salvo abre sem conversão.
export type ValorDoDocumento = NoDoDocumento[];

function paraOEditor(valor: ValorDoDocumento): Value {
  return valor as unknown as Value;
}

function paraOTemis(valor: Value): ValorDoDocumento {
  return valor as unknown as ValorDoDocumento;
}

type Props = {
  aoAvisar?: (aviso: string) => void;
  aoMudar: (valor: ValorDoDocumento) => void;
  /** A minuta aberta: é o prefixo onde a mídia enviada pelo editor fica no bucket. */
  minutaId: string;
  somenteLeitura?: boolean;
  valorInicial: ValorDoDocumento;
};

/**
 * A FOLHA CONTINUA CLARA NO DARK — e os tokens do Plate UI acompanham.
 *
 * ⚠️ Os componentes do registro (placeholder, código, callout, toggle…) pintam com os tokens do
 * shadcn (`--muted`, `--foreground`…), que no dark viram cinza-escuro. Como o papel fica branco de
 * propósito (decisão de 01/09/2026: o jurídico compara com o contrato impresso), os tokens são
 * refeitos AQUI, só dentro da folha, para não sair texto escuro em fundo escuro em cima do papel
 * claro. Os popovers abrem em portal, fora da folha, e seguem o tema do app.
 */
const ESTILO_DA_FOLHA = {
  "--accent": "oklch(0.97 0 0)",
  "--accent-foreground": "oklch(0.205 0 0)",
  "--background": "#ffffff",
  "--border": "oklch(0.922 0 0)",
  "--card": "#ffffff",
  "--card-foreground": "oklch(0.145 0 0)",
  "--foreground": "oklch(0.145 0 0)",
  "--input": "oklch(0.922 0 0)",
  "--muted": "oklch(0.97 0 0)",
  "--muted-foreground": "oklch(0.556 0 0)",
  "--primary": "oklch(0.205 0 0)",
  "--primary-foreground": "oklch(0.985 0 0)",
  "--secondary": "oklch(0.97 0 0)",
  "--secondary-foreground": "oklch(0.205 0 0)",
  fontFamily: "Georgia, 'Times New Roman', serif",
} as React.CSSProperties;

export default function EditorDeMinuta({
  aoAvisar,
  aoMudar,
  minutaId,
  somenteLeitura,
  valorInicial,
}: Props) {
  const editor = usePlateEditor({
    plugins: EditorKitTemis,
    // Minutas salvas antes do chip trazem `[nome]` como texto: viram nós na abertura. `aoMudar` só
    // dispara quando o usuário mexe, então isso não marca a minuta como "não salva" sozinho.
    //
    // ⚠️ E as salvas pelo editor ANTIGO trazem o alinhamento em `textAlign` (a chave do plugin de
    // então); o AlignKit atual só lê `align`. Sem a migração o título centralizado abre à esquerda
    // e, pior, realinhar aqui não mudava o HTML do contrato. Ver `lib/temis/migrar-documento.ts`.
    value: promoverVariaveisNoValor(paraOEditor(migrarAlinhamentoAntigo(valorInicial))),
  });
  const { hubUser } = useAuth();
  const [valorAtual, setValorAtual] = useState<ValorDoDocumento>(valorInicial);

  // A mídia enviada pelo editor (imagem, vídeo, arquivo) vai para `temis-minutas/<minutaId>/` no
  // bucket — o hook de upload lê daqui qual é a minuta aberta.
  useEffect(() => {
    setMinutaAtualParaUpload(minutaId);
    return () => setMinutaAtualParaUpload(null);
  }, [minutaId]);

  // A barra é renderizada pelo Plate, fora desta árvore de props: o `aoAvisar` da tela vai por
  // opção do plugin (a importação do .docx avisa por ele).
  useEffect(() => {
    editor.setOption(TemisToolbarPlugin, "aoAvisar", aoAvisar ?? null);
  }, [aoAvisar, editor]);

  // Comentários e sugestões assinados por quem está logado — o kit do registro vinha com "alice".
  useEffect(() => {
    if (!hubUser) return;
    editor.setOption(discussionPlugin, "users", {
      [hubUser.id]: { avatarUrl: hubUser.avatarUrl ?? "", id: hubUser.id, name: hubUser.name },
    });
    editor.setOption(discussionPlugin, "currentUserId", hubUser.id);
  }, [editor, hubUser]);

  // Quais variáveis JÁ estão no texto. O painel marca cada uma, e é isso que responde de relance a
  // pergunta que se faz o tempo todo numa minuta longa: "já coloquei o CPF do cônjuge?".
  const jaUsadas = useMemo(() => new Set(variaveisNoValor(valorAtual)), [valorAtual]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-subtle/30">
      {/* ⚠️ O PROVIDER DO TOOLTIP É OBRIGATÓRIO. Todo botão da barra com `tooltip` (withTooltip em
          components/ui/toolbar.tsx) monta o <Tooltip> do Radix depois do primeiro efeito, e o Radix
          lança "`Tooltip` must be used within `TooltipProvider`" — a árvore inteira do editor caía
          ao abrir a minuta. O hub não tem esse provider no layout (o editor é a única tela que usa
          o Tooltip do Radix), então ele vive aqui. */}
      <TooltipProvider delayDuration={300}>
        <Plate
          editor={editor}
          // ⚠️ `onValueChange`, e não `onChange`: o `onChange` dispara em TODA operação do Slate,
          // inclusive mover o cursor — um clique na folha marcava a minuta como "não salva",
          // travava o Publicar ("salve o rascunho antes") e reserializava o documento inteiro a
          // cada tecla de seta. `onValueChange` só dispara quando `editor.children` muda.
          onValueChange={({ value }) => {
            const convertido = paraOTemis(value);
            setValorAtual(convertido);
            aoMudar(convertido);
          }}
          readOnly={somenteLeitura}
        >
          <Miolo jaUsadas={jaUsadas} somenteLeitura={somenteLeitura} />
        </Plate>
      </TooltipProvider>

      {/* Um só por tela: os toasts do upload de mídia e do menu de IA (sonner) saem por aqui. */}
      <Toaster position="bottom-right" richColors />
    </div>
  );
}

/** A folha e o painel — dentro do `<Plate>`, para os hooks do editor funcionarem. */
function Miolo({ jaUsadas, somenteLeitura }: { jaUsadas: Set<string>; somenteLeitura?: boolean }) {
  const editor = useEditorRef();
  const painelAberto = usePluginOption(TemisToolbarPlugin, "painelAberto");

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* A FOLHA. O contêiner rola sozinho e ocupa toda a altura que sobrar; a barra fixa da Têmis
          entra pelo plugin (`render.beforeEditable`) e fica grudada no topo dele. */}
      <EditorContainer className="min-h-0 flex-1 bg-subtle/30 px-4 pb-5">
        <Editor
          className="mx-auto my-5 min-h-[65vh] max-w-[820px] rounded-lg bg-white px-14 py-12 text-[15px] leading-relaxed text-slate-900 shadow-sm outline-none dark:bg-slate-100 [&_table]:w-full [&_table]:table-fixed"
          placeholder="Cole aqui a minuta, importe o .docx do loteador, ou digite `[` para inserir uma variável."
          spellCheck={false}
          style={ESTILO_DA_FOLHA}
          variant="none"
        />
      </EditorContainer>

      {painelAberto && !somenteLeitura ? (
        <PainelLateral
          aoFechar={() => editor.setOption(TemisToolbarPlugin, "painelAberto", false)}
          editor={editor}
          jaUsadas={jaUsadas}
        />
      ) : null}
    </div>
  );
}

/**
 * O painel ao lado, com duas abas: os BLOCOS prontos e as VARIÁVEIS.
 *
 * Pedido do Lucas (07/09/2026): *"podia ter um bloco de Partes, e já meio que trazer pronto, bloco
 * de preços e tal, isso ia facilitar"*. Montar a qualificação das partes variável a variável são
 * ~20 cliques e ~20 chances de escolher o nome errado; o bloco entrega o parágrafo inteiro já
 * marcado, com os pares de bloco fechados.
 *
 * ⚠️ A ABA QUE ABRE DEPENDE DO DOCUMENTO. Minuta ainda sem nenhuma variável é minuta que está
 * começando: abre em Blocos, que é o que essa pessoa precisa. Minuta com marcação abre em
 * Variáveis, porque quem já tem o texto está ajustando marca a marca.
 */
function PainelLateral({
  aoFechar,
  editor,
  jaUsadas,
}: {
  aoFechar: () => void;
  editor: PlateEditor;
  jaUsadas: Set<string>;
}) {
  const [aba, setAba] = useState<Aba>(jaUsadas.size === 0 ? "blocos" : "variaveis");
  const [propostas, setPropostas] = useState<null | RespostaDoAgente>(null);
  // A CONVERSA. Lucas, 08/09/2026: *"acho que pode ter um chat entre o usuário e o agente"*.
  const [conversa, setConversa] = useState<MensagemDaConversa[]>([]);
  const [conversando, setConversando] = useState(false);
  const pedidos = usePluginOption(TemisToolbarPlugin, "pedidoDeMarcacao");

  /**
   * Manda a pergunta e trata a resposta.
   *
   * ⚠️ A PERGUNTA ENTRA NA TELA ANTES DA RESPOSTA VOLTAR. Uma chamada a modelo de fronteira sobre um
   * contrato leva dezenas de segundos; sem a mensagem aparecer na hora, quem perguntou acha que o
   * clique não pegou e pergunta de novo.
   *
   * ⚠️ E AS PROPOSTAS DA CONVERSA ENTRAM NA MESMA LISTA das do botão. Uma segunda lista faria a
   * pessoa procurar em dois lugares o que ela aplica no mesmo gesto — e a triagem que as validou é
   * exatamente a mesma.
   */
  const perguntar = async (pergunta: string) => {
    const historico: MensagemDaConversa[] = [...conversa, { conteudo: pergunta, papel: "usuario" }];
    setConversa(historico);
    setConversando(true);
    try {
      const r = await conversarComOAgente(textoDoDocumento(editor.children), historico);
      setConversa((atual) => [
        ...atual,
        { conteudo: r.erro ?? r.resposta, papel: "agente" },
      ]);
      if (r.propostas.length > 0 || r.recusadas.length > 0) {
        setPropostas((atual) => ({
          propostas: [...(atual?.propostas ?? []), ...r.propostas],
          recusadas: [...(atual?.recusadas ?? []), ...r.recusadas],
        }));
      }
    } finally {
      setConversando(false);
    }
  };

  // O botão da barra só levanta um pedido; quem lê o documento e chama a rota é este painel, que
  // já tem o editor em mãos. Assim a barra não precisa conhecer o conteúdo da folha.
  useEffect(() => {
    if (pedidos === 0) return;
    let cancelado = false;

    const marcar = async () => {
      editor.setOption(TemisToolbarPlugin, "marcando", true);
      setAba("agente");
      setPropostas(null);
      try {
        const resposta = await pedirMarcacao(textoDoDocumento(editor.children));
        if (!cancelado) setPropostas(resposta);
      } finally {
        if (!cancelado) editor.setOption(TemisToolbarPlugin, "marcando", false);
      }
    };

    void marcar();
    return () => {
      cancelado = true;
    };
  }, [editor, pedidos]);

  const abas: { chave: Aba; conta?: number; rotulo: string }[] = [
    { chave: "blocos", rotulo: "Blocos" },
    { chave: "variaveis", conta: jaUsadas.size, rotulo: "Variáveis" },
    { chave: "agente", conta: propostas?.propostas.length, rotulo: "Agente" },
  ];

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-2">
        <div className="flex gap-1">
          {abas.map((a) => (
            <button
              className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                aba === a.chave
                  ? "bg-inverse text-brand-ink"
                  : "text-ink-muted hover:bg-subtle hover:text-ink"
              }`}
              key={a.chave}
              onClick={() => setAba(a.chave)}
              type="button"
            >
              {a.rotulo}
              {a.conta ? (
                <span className="ml-1 font-normal normal-case opacity-70">{a.conta}</span>
              ) : null}
            </button>
          ))}
        </div>
        <button
          aria-label="Fechar o painel"
          className="flex size-7 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
          onClick={aoFechar}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      {aba === "blocos" ? <ListaDeBlocos editor={editor} /> : null}
      {aba === "variaveis" ? <ListaDeVariaveis editor={editor} jaUsadas={jaUsadas} /> : null}
      {aba === "agente" ? (
        <ListaDoAgente
          conversa={conversa}
          conversando={conversando}
          aoPerguntar={(t) => void perguntar(t)}
          editor={editor}
          aoAplicar={(p) => {
            aplicarProposta(editor, p);
            setPropostas((atual) =>
              atual
                ? { ...atual, propostas: atual.propostas.filter((x) => x.trecho !== p.trecho) }
                : atual,
            );
          }}
          aoAplicarTodas={(lista) => {
            // ⚠️ DE TRÁS PARA A FRENTE. Cada aplicação muda o documento; começar pelo fim mantém as
            // posições das anteriores válidas. (`aplicarProposta` reacha o trecho a cada vez, mas a
            // ordem ainda importa: um trecho curto pode passar a aparecer duas vezes depois de uma
            // substituição à frente dele, e aí ele seria pulado sem motivo.)
            const aplicadas = new Set<string>();
            for (const p of [...lista].sort((a, b) => b.posicao - a.posicao)) {
              if (aplicarProposta(editor, p)) aplicadas.add(p.trecho);
            }
            setPropostas((atual) =>
              atual
                ? { ...atual, propostas: atual.propostas.filter((x) => !aplicadas.has(x.trecho)) }
                : atual,
            );
          }}
          resposta={propostas}
        />
      ) : null}
    </aside>
  );
}

type Aba = "agente" | "blocos" | "variaveis";

type PropostaDoAgente = {
  /** O que a proposta vai fazer, em português — vem escrito do servidor. */
  acao: string;
  /** A âncora que torna o trecho único (ver `lib/temis/casar-trecho.ts`). Vazia quando não precisa. */
  contexto?: string;
  motivo: string;
  nome: string;
  origem: string;
  posicao: number;
  rotulo: string;
  tipo?: "envolver" | "negrito" | "quebra" | "variavel";
  trecho: string;
};

type RespostaDoAgente = {
  erro?: string;
  propostas: PropostaDoAgente[];
  recusadas: { motivo: string; nome: string; trecho: string }[];
};

/** Uma volta da conversa. `agente` também carrega o erro, quando há — ele fala, não some. */
type MensagemDaConversa = { conteudo: string; papel: "agente" | "usuario" };

type RespostaDaConversa = RespostaDoAgente & { resposta: string };

/**
 * ⚠️ O CONTRATO VAI EM PARTES, e isso saiu de uma falha real. Na primeira tentativa com o Villa
 * Paris — 136.781 caracteres — a chamada única estourou o tempo da função e a tela mostrou só "o
 * agente não respondeu": o timeout da Vercel volta como TEXTO, não como JSON, então nem a mensagem
 * de erro chegava ([[reference_vercel_timeout_vira_erro_de_json]]).
 *
 * Partir também melhora o resultado: o modelo lendo 25 mil caracteres erra menos que lendo 136 mil,
 * e uma parte que falha não leva as outras junto.
 */
// ⚠️ O TAMANHO DA PARTE É UM EQUILÍBRIO ENTRE DUAS COISAS QUE PUXAM PARA LADOS OPOSTOS.
//
//   PARTE GRANDE   decide melhor. Cada parte é lida SOZINHA: o agente que enxerga só o meio do
//                  documento não sabe se aquele "CPF n.º" é do comprador ou do representante da
//                  vendedora — e essa é exatamente a decisão que ele precisa tomar.
//   PARTE PEQUENA  cabe no tempo. Cada leitura é uma requisição com teto de 300 segundos na Vercel,
//                  e o modelo escreve 80 propostas com trecho e contexto para uma minuta cheia.
//
// 30 mil é o meio-termo medido em 08/09/2026: a minuta do Aldeia (50.770 caracteres) vira duas
// partes com folga de tempo, e cada uma ainda carrega seção inteira — as partes, o imóvel, o preço.
// Já foi 25 mil (partia demais) e 45 mil (uma leitura só não terminava a tempo).
const TAMANHO_DA_PARTE = 30_000;

/**
 * Corta o texto em pedaços, SEMPRE em quebra de linha.
 *
 * ⚠️ NUNCA NO MEIO DE UMA LINHA. Cortar em qualquer posição partiria uma cláusula ao meio, e o
 * modelo proporia trechos que não existem inteiros em parte nenhuma — todos recusados depois pela
 * triagem, com cara de agente burro.
 */
function partirEmPedacos(texto: string): string[] {
  if (texto.length <= TAMANHO_DA_PARTE) return [texto];

  const partes: string[] = [];
  let atual = "";
  for (const linha of texto.split("\n")) {
    if (atual.length + linha.length + 1 > TAMANHO_DA_PARTE && atual) {
      partes.push(atual);
      atual = "";
    }
    atual += (atual ? "\n" : "") + linha;
  }
  if (atual) partes.push(atual);
  return partes;
}

async function umaParte(
  texto: string,
  token: string,
  jaPropostas?: PropostaDoAgente[],
): Promise<RespostaDoAgente> {
  try {
    const r = await fetch("/api/temis/minutas/marcar", {
      // Com `jaPropostas`, a rota faz a RELEITURA: procura só o que a primeira leitura deixou passar.
      body: JSON.stringify({ jaPropostas: jaPropostas ?? [], texto }),
      // ⚠️ O TOKEN É OBRIGATÓRIO, e esquecê-lo foi o defeito que fez o agente responder 401 no
      // primeiro teste real. A rota exige `authorizeApoloRead` como todas as do módulo; o resto da
      // Têmis já manda o `Bearer` e eu não mandei aqui.
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      method: "POST",
    });
    // ⚠️ LÊ COMO TEXTO ANTES DE TENTAR JSON: um timeout da Vercel devolve HTML, e `r.json()`
    // rejeitaria — engolindo a única pista do que aconteceu.
    const cru = await r.text().catch(() => "");
    let corpo: (Partial<RespostaDoAgente> & { erro?: string }) | null = null;
    try {
      corpo = cru ? (JSON.parse(cru) as Partial<RespostaDoAgente> & { erro?: string }) : null;
    } catch {
      corpo = null;
    }

    if (!r.ok || !corpo) {
      return {
        erro:
          corpo?.erro ??
          (r.status === 504 || !corpo
            ? "O agente demorou demais nesta parte do contrato. As outras partes seguiram."
            : `O agente respondeu ${r.status}.`),
        propostas: [],
        recusadas: [],
      };
    }
    return { propostas: corpo.propostas ?? [], recusadas: corpo.recusadas ?? [] };
  } catch {
    return { erro: "Falha de rede ao chamar o agente.", propostas: [], recusadas: [] };
  }
}

/**
 * Uma volta de conversa com o agente.
 *
 * ⚠️ A MINUTA VAI INTEIRA, SEM PARTIR. O botão parte o contrato em pedaços de 25 mil caracteres
 * porque varre tudo; a conversa é uma pergunta sobre um documento, e partir aqui daria seis
 * respostas diferentes para a mesma pergunta. A rota corta no teto e AVISA que cortou — resposta
 * incompleta com aviso é melhor do que seis respostas.
 */
async function conversarComOAgente(
  texto: string,
  mensagens: MensagemDaConversa[],
): Promise<RespostaDaConversa> {
  let token: null | string = null;
  try {
    token = await getApoloAccessToken();
  } catch {
    token = null;
  }
  if (!token) {
    return { erro: "Sessão expirada. Recarregue a página.", propostas: [], recusadas: [], resposta: "" };
  }

  try {
    const r = await fetch("/api/temis/minutas/conversar", {
      body: JSON.stringify({ mensagens, texto }),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      method: "POST",
    });
    // Lê como texto antes de tentar JSON: um timeout da Vercel devolve HTML, e `r.json()` rejeitaria
    // engolindo a única pista do que aconteceu.
    const cru = await r.text().catch(() => "");
    let corpo: (Partial<RespostaDaConversa> & { erro?: string }) | null = null;
    try {
      corpo = cru ? (JSON.parse(cru) as Partial<RespostaDaConversa> & { erro?: string }) : null;
    } catch {
      corpo = null;
    }

    if (!r.ok || !corpo) {
      return {
        erro:
          corpo?.erro ??
          (r.status === 504 || !corpo
            ? "O agente demorou demais para responder. Tente uma pergunta mais curta."
            : `O agente respondeu ${r.status}.`),
        propostas: [],
        recusadas: [],
        resposta: "",
      };
    }
    return {
      propostas: corpo.propostas ?? [],
      recusadas: corpo.recusadas ?? [],
      resposta: corpo.resposta ?? "",
    };
  } catch {
    return { erro: "Falha de rede ao falar com o agente.", propostas: [], recusadas: [], resposta: "" };
  }
}

async function pedirMarcacao(texto: string): Promise<RespostaDoAgente> {
  // ⚠️ SEM TOKEN NÃO SE CHAMA. `getApoloAccessToken` devolve null quando a sessão caiu, e mandar a
  // requisição assim mesmo devolveria 401 — que foi exatamente o "O agente respondeu 401" do
  // primeiro teste real, quando eu nem estava mandando o cabeçalho.
  let token: null | string = null;
  try {
    token = await getApoloAccessToken();
  } catch {
    token = null;
  }
  if (!token) {
    return { erro: "Sessão expirada. Recarregue a página.", propostas: [], recusadas: [] };
  }

  const partes = partirEmPedacos(texto);
  const propostas: PropostaDoAgente[] = [];
  const recusadas: RespostaDoAgente["recusadas"] = [];
  const falhas: string[] = [];

  // Em série, de propósito: são chamadas caras a um modelo de fronteira, e disparar seis de uma vez
  // bate no limite de concorrência e devolve erro em todas.
  for (const parte of partes) {
    const r = await umaParte(parte, token);
    if (r.erro) falhas.push(r.erro);
    propostas.push(...r.propostas);
    recusadas.push(...r.recusadas);
  }

  // ⚠️ A SEGUNDA LEITURA — é ela que separa "marcou o começo" de "preparou a minuta". Lucas
  // (08/09/2026): *"se te pedir para montar essa minuta você vai conseguir, queria era esse tipo de
  // inteligência"*. Uma pessoa não entrega a primeira lista que escreve: ela relê o documento com a
  // lista na mão e pergunta "o que passou?". A primeira leitura é minuciosa nas partes e no imóvel,
  // e vai rareando — foro, assinaturas e quadro-resumo quase sempre ficam de fora.
  //
  // ⚠️ ELA NUNCA DERRUBA A PRIMEIRA. Se a releitura falhar, a lista original continua valendo: 30
  // propostas na tela é infinitamente melhor do que um erro no lugar delas.
  for (const [indice, parte] of partes.entries()) {
    const daParte = propostas.filter((p) => parte.includes(p.trecho));
    const r = await umaParte(parte, token, daParte);
    if (r.erro) {
      // A releitura que falha vira nota de rodapé, não erro da operação.
      falhas.push(`Na segunda leitura da parte ${indice + 1}: ${r.erro}`);
      continue;
    }
    // ⚠️ SEM REPETIR. A chave é tipo+nome+trecho: a releitura pode legitimamente propor OUTRA
    // variável para o mesmo trecho (viu que aquele CPF é do representante, não do comprador), e as
    // duas devem aparecer. O que não pode é a mesma proposta duas vezes — a pessoa clicaria na
    // segunda depois de aplicar a primeira e não entenderia por que nada acontece.
    const vistas = new Set(propostas.map((p) => `${p.tipo ?? "variavel"}|${p.nome}|${p.trecho}`));
    for (const nova of r.propostas) {
      if (!vistas.has(`${nova.tipo ?? "variavel"}|${nova.nome}|${nova.trecho}`)) propostas.push(nova);
    }
    recusadas.push(...r.recusadas);
  }

  return {
    // ⚠️ FALHA VIRA AVISO, NUNCA TELA VAZIA. Perder uma parte não apaga o que as outras acharam — e
    // dizer QUANTAS propostas sobreviveram importa mais do que dizer quantas chamadas falharam:
    // "1 de 2 partes falharam" fez o Lucas achar que o resultado estava truncado quando o problema
    // era outro (o JSON estourava o limite de saída).
    erro:
      propostas.length === 0 && falhas.length > 0
        ? falhas[0]
        : falhas.length > 0
          ? `${propostas.length} proposta(s) vieram, mas ${falhas.length} leitura(s) falharam — pode ter ficado coisa de fora. Mande marcar de novo para completar.`
          : undefined,
    propostas,
    recusadas,
  };
}

/**
 * Faz no documento o que a proposta diz.
 *
 * ⚠️ ACHA A FAIXA DE NOVO, NA HORA DO CLIQUE. A posição veio do texto de quando o agente leu; se
 * alguém editou a folha nesse meio-tempo, ela não vale mais. `faixaDoTrecho` devolve null quando o
 * trecho sumiu ou passou a aparecer duas vezes — e aí não se aplica nada, em vez de agir por
 * aproximação. Devolve `true` quando aplicou, para quem aplica em lote saber o que entrou.
 *
 * ⚠️ SÃO QUATRO OPERAÇÕES, e nenhuma delas reescreve texto. Pedido do Lucas (08/09/2026): *"vindo
 * colocando as quebras de páginas, inserir os negritos, os quadros quando precisar"* — e o quadro é
 * o caso "variavel", porque a tabela do contrato já existe como `[tabela_geral_pagamentos]`.
 */
function aplicarProposta(editor: PlateEditor, proposta: PropostaDoAgente): boolean {
  const faixa = faixaDoTrecho(editor.children, proposta.trecho, proposta.contexto);
  if (!faixa) return false;

  const at = { anchor: faixa.inicio, focus: faixa.fim };

  switch (proposta.tipo) {
    // O par de bloco entra como TEXTO, nas duas pontas do trecho. Ele não é um nó de variável: é o
    // marcador que o motor de geração lê, e é assim que ele já aparece nos blocos prontos.
    //
    // ⚠️ O FIM ENTRA PRIMEIRO. Inserir no começo empurraria o fim alguns caracteres para a frente, e
    // o marcador de fechamento cairia dentro do trecho — envolvendo menos do que se pediu.
    case "envolver": {
      const cru = proposta.nome.replace(/^(inicio|fim)_/, "");
      editor.tf.insertText(`[fim_${cru}]`, { at: faixa.fim });
      editor.tf.insertText(`[inicio_${cru}]`, { at: faixa.inicio });
      break;
    }
    case "negrito": {
      editor.tf.setNodes({ bold: true }, { at, match: (n) => "text" in (n as object), split: true });
      break;
    }
    // ⚠️ A QUEBRA VAI ANTES DO BLOCO INTEIRO, não no meio do parágrafo. O trecho citado é o título
    // da peça ("CONTRATO PARTICULAR DE CORRETAGEM"), e quebrar no meio dele deixaria a primeira
    // palavra órfã no fim da folha anterior.
    case "quebra": {
      const bloco = faixa.inicio.path.slice(0, 1);
      editor.tf.insertNodes(noDeQuebraDePagina() as never, { at: bloco });
      break;
    }
    default: {
      editor.tf.removeNodes({ at, empty: true });
      editor.tf.delete({ at });
      editor.tf.insertNodes(noDeVariavel(proposta.nome) as never, { at: faixa.inicio, select: true });
    }
  }

  editor.tf.focus();
  return true;
}

/**
 * O QUE O AGENTE PROPÔS.
 *
 * ⚠️ APLICAR TODAS EXISTE, e é o pedido do Lucas (08/09/2026): *"ao clicar em inserir ela coloca as
 * variáveis para gente"*. A versão anterior só aceitava uma a uma, por medo de o operador aprovar 80
 * marcações sem olhar. Mas numa minuta de 30 páginas o clique-a-clique era o próprio trabalho manual
 * que o agente veio eliminar — e a revisão de verdade acontece depois, lendo a folha, onde o erro
 * aparece no lugar em que ele importa.
 *
 * A rede de segurança que sobra é a que sempre valeu: nenhuma proposta muda o texto jurídico (só
 * troca um trecho por variável, envolve num bloco, quebra a página ou põe negrito), tudo passou pela
 * triagem do catálogo, e o desfazer do editor desmancha o lote inteiro de uma vez.
 *
 * ⚠️ E O QUE FOI RECUSADO APARECE, com o motivo. Não é erro escondido: é a rede de segurança se
 * mostrando, e é como quem usa aprende onde o agente erra.
 */
function ListaDoAgente({
  aoAplicar,
  aoAplicarTodas,
  aoPerguntar,
  conversa,
  conversando,
  editor,
  resposta,
}: {
  aoAplicar: (p: PropostaDoAgente) => void;
  aoAplicarTodas: (ps: PropostaDoAgente[]) => void;
  aoPerguntar: (pergunta: string) => void;
  conversa: MensagemDaConversa[];
  conversando: boolean;
  editor: PlateEditor;
  resposta: null | RespostaDoAgente;
}) {
  const marcando = usePluginOption(TemisToolbarPlugin, "marcando");

  // ⚠️ A CONVERSA FICA SEMPRE DISPONÍVEL, inclusive antes da primeira varredura e enquanto ela roda.
  // Ela é o outro caminho para o agente, não um extra da varredura: dá para começar perguntando
  // "essa minuta usa qual formato de fluxo?" sem mandar marcar nada.
  const conteudo = marcando ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <Wand2 aria-hidden="true" className="size-5 animate-pulse text-ink-muted" />
      <p className="m-0 text-xs text-ink-soft">
        Lendo a minuta inteira e procurando onde cada variável entra. Contrato longo leva alguns
        minutos.
      </p>
    </div>
  ) : !resposta ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <Wand2 aria-hidden="true" className="size-5 text-ink-muted" />
      <p className="m-0 text-xs text-ink-soft">
        Clique em <strong className="font-semibold text-ink">Marcar variáveis</strong> na barra para
        ele ler a minuta inteira — ou pergunte aqui embaixo. Ele conhece o catálogo e o texto na
        tela, e não altera nada sem você aplicar.
      </p>
    </div>
  ) : (
    <CorpoDoAgente
      aoAplicar={aoAplicar}
      aoAplicarTodas={aoAplicarTodas}
      editor={editor}
      resposta={resposta}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {conteudo}
        <Conversa conversa={conversa} conversando={conversando} />
      </div>
      <CampoDaConversa aoPerguntar={aoPerguntar} ocupado={conversando} />
    </div>
  );
}

/**
 * As bolhas da conversa.
 *
 * ⚠️ O ERRO APARECE COMO FALA DO AGENTE, e não como faixa vermelha. "A IA não respondeu, tente de
 * novo" no lugar da resposta mantém a conversa legível: quem lê de cima para baixo entende que
 * aquela pergunta ficou sem resposta, em vez de ver um aviso solto sem saber a qual pergunta ele
 * se refere.
 */
function Conversa({
  conversa,
  conversando,
}: {
  conversa: MensagemDaConversa[];
  conversando: boolean;
}) {
  if (conversa.length === 0 && !conversando) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-line p-3">
      {conversa.map((m, i) => (
        <div
          className={
            m.papel === "usuario"
              ? "self-end rounded-xl rounded-br-sm bg-[#A07C3B] px-2.5 py-1.5 text-[11px] leading-snug text-white max-w-[85%]"
              : "self-start whitespace-pre-wrap rounded-xl rounded-bl-sm bg-subtle px-2.5 py-1.5 text-[11px] leading-snug text-ink max-w-[92%]"
          }
          key={`${m.papel}-${i}`}
        >
          {m.conteudo}
        </div>
      ))}
      {conversando ? (
        <span className="self-start px-2.5 text-[11px] italic text-ink-muted">Pensando…</span>
      ) : null}
    </div>
  );
}

/**
 * O campo de perguntar.
 *
 * ⚠️ ENTER MANDA, SHIFT+ENTER QUEBRA A LINHA. É a convenção de todo chat, e quem está no meio de uma
 * revisão não quer procurar botão. O botão continua lá para quem prefere clicar.
 */
function CampoDaConversa({
  aoPerguntar,
  ocupado,
}: {
  aoPerguntar: (pergunta: string) => void;
  ocupado: boolean;
}) {
  const [texto, setTexto] = useState("");

  const mandar = () => {
    const limpo = texto.trim();
    if (!limpo || ocupado) return;
    setTexto("");
    aoPerguntar(limpo);
  };

  return (
    <div className="flex items-end gap-1.5 border-t border-line p-2">
      <textarea
        className="max-h-32 min-h-[2.25rem] flex-1 resize-none rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px] leading-snug text-ink outline-none placeholder:text-ink-muted focus:border-[#A07C3B]"
        disabled={ocupado}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            mandar();
          }
        }}
        placeholder="Pergunte ou mande fazer: “esse é o cônjuge, não o comprador”"
        rows={1}
        value={texto}
      />
      <button
        aria-label="Perguntar ao agente"
        className="rounded-lg bg-[#A07C3B] px-2 py-2 text-white transition-colors hover:bg-[#8A6A32] disabled:opacity-40"
        disabled={ocupado || texto.trim() === ""}
        onClick={mandar}
        onMouseDown={(e) => e.preventDefault()}
        type="button"
      >
        {ocupado ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <SendHorizontal aria-hidden="true" className="size-3.5" />
        )}
      </button>
    </div>
  );
}

/** A lista de propostas — o resultado da varredura e o que a conversa acrescentou a ela. */
function CorpoDoAgente({
  aoAplicar,
  aoAplicarTodas,
  editor,
  resposta,
}: {
  aoAplicar: (p: PropostaDoAgente) => void;
  aoAplicarTodas: (ps: PropostaDoAgente[]) => void;
  editor: PlateEditor;
  resposta: RespostaDoAgente;
}) {

  // ⚠️ SÓ MOSTRA O QUE DÁ PARA APLICAR. O contrato vai ao modelo EM PARTES, e um trecho pode ser
  // único dentro da sua parte e aparecer duas vezes no documento inteiro — "CPF n.º" é o caso. A
  // triagem do servidor confere contra a parte; esta é a conferência contra o documento todo.
  // Mostrar uma proposta que o clique recusaria seria pior que não mostrar: o operador clicaria,
  // nada aconteceria, e ele não saberia por quê.
  const aplicaveis = resposta.propostas.filter(
    (p) =>
      faixaDoTrecho(editor.children, p.trecho, p.contexto) &&
      // ⚠️ NEGRITO NO QUE JÁ É NEGRITO NÃO ENTRA NA LISTA. O agente lê texto puro e não enxerga
      // formatação: em 08/09/2026 ele devolveu 24 propostas e todas eram negrito em título que já
      // estava em negrito. Mostrar isso faria a pessoa clicar 24 vezes para não mudar nada.
      !(p.tipo === "negrito" && trechoJaEmNegrito(editor.children, p.trecho, p.contexto)),
  );
  const semLugar = resposta.propostas.length - aplicaveis.length;
  // ⚠️ A CONTA POR TIPO É O QUE DIZ SE O PASSE FOI BOM. "24 propostas" esconde que as 24 eram
  // negrito; "18 variáveis · 2 blocos" diz na hora o que o agente entendeu do contrato.
  const porTipo = ["variavel", "envolver", "quebra", "negrito"]
    .map((t) => ({
      n: aplicaveis.filter((p) => (p.tipo ?? "variavel") === t).length,
      rotulo: { envolver: "bloco", negrito: "negrito", quebra: "quebra", variavel: "variável" }[t] ?? t,
    }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${x.rotulo}${x.n > 1 ? (x.rotulo === "variável" ? "is" : "s") : ""}`)
    .join(" · ");

  return (
    <div className="min-h-0 flex-1 overflow-auto p-1.5">
      {resposta.erro ? (
        <p className="m-0 mb-1 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-tight text-amber-800 dark:bg-amber-500/12 dark:text-amber-300">
          {resposta.erro}
        </p>
      ) : null}

      {aplicaveis.length === 0 ? (
        <p className="m-0 px-3 py-4 text-xs text-ink-soft">
          {/* ⚠️ ERRO E "NÃO ACHOU NADA" SÃO COISAS DIFERENTES, e mostrar os dois juntos custou uma
              rodada de teste: a tela dizia "a IA não respondeu" E "o agente não achou nada novo" ao
              mesmo tempo, o que sugere que ele leu e não viu nada — quando na verdade ele nem
              chegou a ler. Com erro, a faixa de cima já explicou; aqui não se afirma mais nada. */}
          {resposta.erro
            ? "A leitura não chegou a terminar — veja o aviso acima e mande de novo."
            : resposta.propostas.length > 0
              ? "As propostas do agente não casaram com o texto atual. Se você editou a folha depois de mandar marcar, peça de novo."
              : "O agente não achou nada novo para marcar. Se a minuta já está marcada, é isso mesmo."}
        </p>
      ) : (
        <div className="px-3 py-2">
          <button
            className="mb-1.5 w-full rounded-lg bg-[#A07C3B] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#8A6A32]"
            onClick={() => aoAplicarTodas(aplicaveis)}
            onMouseDown={(e) => e.preventDefault()}
            type="button"
          >
            Aplicar as {aplicaveis.length}
          </button>
          <p className="m-0 text-[10px] leading-tight text-ink-muted">
            {porTipo}. Ou clique uma a uma, para ver onde cada uma cai. Ctrl+Z desfaz.
            {semLugar > 0 ? ` ${semLugar} ficou de fora (não casou com o texto, ou não mudaria nada).` : ""}
          </p>
        </div>
      )}

      {aplicaveis.map((p) => (
        <button
          className="group mb-1 flex w-full flex-col items-start gap-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-subtle"
          key={`${p.posicao}-${p.nome}`}
          onClick={() => aoAplicar(p)}
          onMouseDown={(e) => e.preventDefault()}
          type="button"
        >
          <span className="flex w-full items-center gap-1.5">
            <Wand2 aria-hidden="true" className="size-3 shrink-0 text-ink-muted" />
            <span className="flex-1 truncate text-xs font-medium text-ink">{p.rotulo}</span>
          </span>
          {/* O trecho é o que o operador precisa ver: é o pedaço do CONTRATO que vai mudar. */}
          <span className="w-full truncate rounded bg-subtle px-1.5 py-1 text-[10px] italic text-ink-soft">
            “{p.trecho}”
          </span>
          {/* ⚠️ A AÇÃO POR EXTENSO, e não só o nome da variável. Quando a proposta é uma quebra de
              página ou um negrito não há nome nenhum, e "[]" na tela não diz nada a quem revisa. */}
          <span className="pl-[1.125rem] font-mono text-[10px] text-ink-muted">
            {p.tipo && p.tipo !== "variavel" ? p.acao : `[${p.nome}]`}
          </span>
          {p.motivo ? (
            <span className="pl-[1.125rem] text-[10px] leading-tight text-ink-soft">{p.motivo}</span>
          ) : null}
        </button>
      ))}

      {resposta.recusadas.length > 0 ? (
        <section className="mt-2 border-t border-line pt-2">
          <p className="m-0 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {resposta.recusadas.length} recusada(s) pela conferência
          </p>
          {resposta.recusadas.map((r, i) => (
            <p
              className="m-0 px-3 py-1 text-[10px] leading-tight text-amber-700 dark:text-amber-300"
              key={`${r.nome}-${i}`}
            >
              {r.motivo}
            </p>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Os blocos prontos — um clique põe a cláusula inteira na folha.
 *
 * ⚠️ O BLOCO ENTRA NO PONTO DO CURSOR, e as variáveis são PROMOVIDAS na entrada: o texto `[nome]`
 * vira o nó de variável pelo mesmo caminho do que é colado e do que vem do .docx
 * (`promoverVariaveisNoValor`). Sem isso o chip não se forma, o painel não conta a variável e o
 * negrito aplicado depois partiria o nome no meio — o defeito que imprimiu `[nome_cl</strong>iente]`
 * no primeiro contrato de teste do JDG.
 */
function ListaDeBlocos({ editor }: { editor: PlateEditor }) {
  const [aberto, setAberto] = useState<null | string>(null);

  const inserirClausula = (bloco: BlocoPronto) => {
    // `paraOEditor` é a mesma fronteira do documento inteiro (ver o topo): NoDoDocumento[] e Value
    // são a mesma coisa em memória, e a conversão vive só aqui.
    editor.tf.insertNodes(promoverVariaveisNoValor(paraOEditor(nosDoBloco(bloco))));
    editor.tf.focus();
  };

  return (
    <>
      <p className="m-0 border-b border-line px-3 py-2 text-[10px] leading-tight text-ink-muted">
        Clique no bloco para ver as variáveis daquele assunto. O{" "}
        <Plus aria-hidden="true" className="inline size-3" /> insere a cláusula inteira, já marcada.
      </p>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {BLOCOS_PRONTOS.map((bloco) => {
          const expandido = aberto === bloco.id;
          // As variáveis QUE AQUELE ASSUNTO USA, na ordem em que aparecem na cláusula. É o filtro
          // que o Lucas pediu: *"ter o bloco das variáveis que faz parte das partes"*. Sem
          // repetição — a cláusula cita `[nome_cliente]` no corpo e na linha de assinatura.
          const nomes = [...new Set(variaveisDoTexto(textoDoBloco(bloco)))];

          return (
            <section className="mb-1" key={bloco.id}>
              <div className="flex items-start gap-1">
                <button
                  className="flex min-w-0 flex-1 items-start gap-1.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-subtle"
                  onClick={() => setAberto(expandido ? null : bloco.id)}
                  onMouseDown={(e) => e.preventDefault()}
                  type="button"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={`mt-0.5 size-3.5 shrink-0 text-ink-muted transition-transform ${
                      expandido ? "rotate-90" : ""
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-ink">{bloco.rotulo}</span>
                    <span className="mt-0.5 block text-[10px] leading-tight text-ink-soft">
                      {expandido ? bloco.descricao : `${nomes.length} variáveis`}
                    </span>
                  </span>
                </button>

                {/* ⚠️ INSERIR A CLÁUSULA É UM BOTÃO PRÓPRIO, e não o clique na linha. Antes, clicar
                    no bloco despejava o texto inteiro na folha — o Lucas clicou em "Partes" para ver
                    o que era e levou a cláusula. Ação que MUDA o documento não pode ser o gesto de
                    quem só quer olhar. */}
                <button
                  aria-label={`Inserir a cláusula ${bloco.rotulo}`}
                  className="mt-1.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-inverse hover:text-brand-ink"
                  onClick={() => inserirClausula(bloco)}
                  onMouseDown={(e) => e.preventDefault()}
                  title={`Inserir a cláusula inteira: ${bloco.rotulo}`}
                  type="button"
                >
                  <Plus aria-hidden="true" className="size-4" />
                </button>
              </div>

              {expandido
                ? nomes.map((nome) => {
                    const v = acharVariavel(nome);
                    return (
                      <button
                        className="flex w-full flex-col items-start gap-0.5 rounded-lg py-1.5 pl-7 pr-2 text-left transition-colors hover:bg-subtle"
                        key={nome}
                        onClick={() => {
                          inserirVariavel(editor, nome);
                          editor.tf.focus();
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                        title={`Inserir [${nome}]`}
                        type="button"
                      >
                        <span className="w-full truncate text-xs text-ink">
                          {v?.rotulo ?? nome}
                        </span>
                        <span className="font-mono text-[10px] text-ink-muted">[{nome}]</span>
                      </button>
                    );
                  })
                : null}
            </section>
          );
        })}
      </div>
    </>
  );
}

/**
 * A lista de variáveis, ao lado da folha.
 *
 * ⚠️ O PAINEL FICA AO LADO, ABERTO. Pedido do Lucas (01/09/2026): "a ideia das variveis, é abrir ao
 * lado e trazer elas separadas por grupos, seria mais facil de visualizar". Num menu suspenso,
 * escolher uma variável fecha a lista e apaga o contexto — e quem marca uma minuta de 27 páginas
 * insere dezenas seguidas. Ao lado, a lista fica de pé o tempo todo.
 *
 * ⚠️ CADA GRUPO DIZ QUANTAS JÁ ESTÃO NO TEXTO. Numa minuta com cinco compradores, a pergunta que o
 * jurídico faz o tempo todo é "já marquei o cônjuge do segundo?" — e a resposta precisa estar à
 * vista, não a três cliques de distância.
 */
function ListaDeVariaveis({
  editor,
  jaUsadas,
}: {
  editor: PlateEditor;
  jaUsadas: Set<string>;
}) {
  const [busca, setBusca] = useState("");
  // Os três primeiros grupos abertos: são os que toda minuta usa. O resto abre sob demanda —
  // 223 variáveis de uma vez viram uma parede que ninguém lê.
  const [abertos, setAbertos] = useState<Set<string>>(
    () => new Set(["comprador", "conjuge", "unidade"]),
  );

  const filtro = busca.trim().toLowerCase();

  return (
    <>
      <div className="border-b border-line p-2">
        <input
          className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar (nome, CPF, quadra…)"
          value={busca}
        />
        <p className="m-0 mt-1.5 px-1 text-[10px] leading-tight text-ink-muted">
          Na folha, digite <kbd className="rounded border border-line px-1 font-mono">[</kbd> para
          escolher sem sair do teclado.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {VARIAVEIS_POR_GRUPO.map((g) => {
          const achadas = g.variaveis.filter(
            (v) => !filtro || v.nome.includes(filtro) || v.rotulo.toLowerCase().includes(filtro),
          );
          if (achadas.length === 0) return null;

          // Durante a busca todo grupo com resultado abre — senão a busca acharia e esconderia.
          const aberto = filtro !== "" || abertos.has(g.grupo);
          const usadas = achadas.filter((v) => jaUsadas.has(v.nome)).length;

          return (
            <section className="mb-1" key={g.grupo}>
              <button
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-subtle"
                onClick={() =>
                  setAbertos((atual) => {
                    const novo = new Set(atual);
                    if (novo.has(g.grupo)) novo.delete(g.grupo);
                    else novo.add(g.grupo);
                    return novo;
                  })
                }
                type="button"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={`size-3.5 shrink-0 text-ink-muted transition-transform ${
                    aberto ? "rotate-90" : ""
                  }`}
                />
                <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {g.rotulo}
                </span>
                <span className="text-[10px] tabular-nums text-ink-muted">
                  {usadas > 0 ? `${usadas}/${achadas.length}` : achadas.length}
                </span>
              </button>

              {aberto
                ? achadas.map((v) => {
                    const pendente = origemPendente(v);
                    return (
                      <button
                        className="group flex w-full flex-col items-start gap-0.5 rounded-lg py-1.5 pl-6 pr-2 text-left transition-colors hover:bg-subtle"
                        key={v.nome}
                        onClick={() => {
                          // Nó de variável, não texto: é o que impede a marca de partir o nome.
                          inserirVariavel(editor, v.nome);
                          editor.tf.focus();
                        }}
                        // ⚠️ `onMouseDown` com preventDefault: sem isso o clique tira o foco do
                        // editor, o cursor se perde e a variável entra no lugar errado — ou em
                        // lugar nenhum.
                        onMouseDown={(e) => e.preventDefault()}
                        title={`Inserir [${v.nome}]`}
                        type="button"
                      >
                        <span className="flex w-full items-center gap-1.5">
                          {jaUsadas.has(v.nome) ? (
                            <Check
                              aria-hidden="true"
                              className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                            />
                          ) : (
                            <span aria-hidden="true" className="size-3 shrink-0" />
                          )}
                          <span className="flex-1 truncate text-xs font-medium text-ink">
                            {v.rotulo}
                          </span>
                          {/* "pendente": está no catálogo, mas o Panteon ainda não tem a coluna.
                              Sai vazio no contrato até existir — e NUNCA se busca no C2X. */}
                          {pendente ? (
                            <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                              pendente
                            </span>
                          ) : null}
                        </span>
                        <span className="pl-[1.125rem] font-mono text-[10px] text-ink-muted">
                          [{v.nome}]
                        </span>
                        {/* A origem responde à pergunta que o jurídico faz o tempo todo: "de onde vem
                            esse dado?". Sem ela, ele deixa o campo em branco por via das dúvidas. */}
                        <span className="pl-[1.125rem] text-[10px] leading-tight text-ink-soft opacity-0 transition-opacity group-hover:opacity-100">
                          {v.origem}
                        </span>
                      </button>
                    );
                  })
                : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
