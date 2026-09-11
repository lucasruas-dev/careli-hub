"use client";

import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// CHAT · DOCUMENTOS · HISTÓRICO — a coluna que fica em TODAS as etapas.
//
// Lucas (09/09/2026): *"chat - documento - historico ficam em todas as etapas"*. Por isso ela vive
// FORA do componente de etapa: quem troca é o painel da esquerda, esta coluna não recarrega nem
// perde o que estava escrito no campo de mensagem ao mudar de etapa.
//
// ⚠️ O RECORTE É A PROPOSTA, e não o lote. As telas do Hércules leem por `unidade_id`, o que faz
// sentido lá (a ficha é do lote); aqui o card é de UMA venda, e um lote passa por várias — o 01 04
// do Portal dos Vales teve proposta de sete clientes em quatro dias. Filtrar pelo lote traria a
// conversa e os documentos do comprador anterior para dentro do contrato do atual.

type Aba = "chat" | "documentos" | "historico";

type Mensagem = {
  autor_nome: null | string;
  codigo: null | string;
  criado_em: string;
  id: string;
  texto: string;
  tipo: null | string;
};

type Documento = {
  criadoEm: string;
  fonte: "proponente" | "venda";
  id: string;
  nome: string;
  quem: null | string;
  tipo: null | string;
};

/** O mesmo `EventoDaUnidade` de `lib/hercules/historico-da-unidade.ts`, conferido campo a campo. */
type Evento = {
  cliente: null | string;
  codigo: null | string;
  fato: string;
  id: string;
  observacao: null | string;
  quando: string;
  quem: null | string;
  tipo: "assinatura" | "etapa" | "pagamento";
  valor: null | number;
};

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "chat", rotulo: "Chat" },
  { id: "documentos", rotulo: "Documentos" },
  { id: "historico", rotulo: "Histórico" },
];

export function ColunaFixa({
  podeEscrever,
  propostaId,
}: {
  /** Só quem trabalha o contrato escreve; quem consulta lê. */
  podeEscrever: boolean;
  propostaId: null | string;
}) {
  const [aba, setAba] = useState<Aba>("chat");

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border border-line bg-surface">
      <nav className="flex shrink-0 gap-1 border-b border-line p-1.5">
        {ABAS.map((a) => (
          <button
            className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
              aba === a.id
                // A aba ativa é grafite, como a Pílula do Hércules — e não dourada: o dourado da
                // marca ficou reservado para dizer em que etapa o card está.
                ? "bg-inverse text-surface"
                : "text-ink-soft hover:bg-subtle hover:text-ink"
            }`}
            key={a.id}
            onClick={() => setAba(a.id)}
            type="button"
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!propostaId ? (
          <p className="m-0 text-xs text-ink-muted">
            Sem venda ligada a este card.
          </p>
        ) : aba === "chat" ? (
          <Chat podeEscrever={podeEscrever} propostaId={propostaId} />
        ) : aba === "documentos" ? (
          <Documentos propostaId={propostaId} />
        ) : (
          <Historico propostaId={propostaId} />
        )}
      </div>
    </aside>
  );
}

// ── CHAT ───────────────────────────────────────────────────────────────────

function Chat({
  podeEscrever,
  propostaId,
}: {
  podeEscrever: boolean;
  propostaId: string;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<"carregando" | "erro" | "pronto">("carregando");
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/trabalho/conversa?proposta=${encodeURIComponent(propostaId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const j = (await r.json().catch(() => ({}))) as { data?: { mensagens: Mensagem[] } };
      if (!r.ok || !j.data) {
        setEstado("erro");
        return;
      }
      setMensagens(j.data.mensagens);
      setEstado("pronto");
    } catch {
      setEstado("erro");
    }
  }, [propostaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (estado === "carregando") {
    return <p className="m-0 text-xs text-ink-muted">Carregando…</p>;
  }
  if (estado === "erro") {
    return <p className="m-0 text-xs text-ink-muted">Não consegui carregar a conversa.</p>;
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1 space-y-2 overflow-auto">
        {mensagens.length === 0 ? (
          <p className="m-0 text-xs text-ink-muted">Nenhuma mensagem ainda.</p>
        ) : (
          mensagens.map((m) => (
            <article className="rounded-lg bg-subtle px-2.5 py-2" key={m.id}>
              <p className="m-0 whitespace-pre-wrap text-xs text-ink">{m.texto}</p>
              <p className="m-0 mt-1 text-[10px] text-ink-muted">
                {[m.autor_nome, new Date(m.criado_em).toLocaleString("pt-BR")]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </article>
          ))
        )}
      </div>

      {podeEscrever ? (
        <div className="shrink-0">
          <textarea
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-xs text-ink"
            onChange={(ev) => setTexto(ev.target.value)}
            placeholder="Escreva uma nota…"
            rows={2}
            value={texto}
          />
          <button
            className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:bg-subtle disabled:opacity-50"
            disabled={enviando || !texto.trim()}
            onClick={async () => {
              setEnviando(true);
              try {
                const token = await getApoloAccessToken();
                const r = await fetch("/api/temis/trabalho/conversa", {
                  body: JSON.stringify({ proposta: propostaId, texto }),
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  method: "POST",
                });
                if (r.ok) {
                  setTexto("");
                  await carregar();
                }
              } finally {
                setEnviando(false);
              }
            }}
            type="button"
          >
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── DOCUMENTOS ─────────────────────────────────────────────────────────────

function Documentos({ propostaId }: { propostaId: string }) {
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [estado, setEstado] = useState<"carregando" | "erro" | "pronto">("carregando");

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const r = await fetch(
          `/api/temis/trabalho/documentos?proposta=${encodeURIComponent(propostaId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = (await r.json().catch(() => ({}))) as {
          data?: { documentos: Documento[] };
        };
        if (!vivo) return;
        if (!r.ok || !j.data) {
          setEstado("erro");
          return;
        }
        setDocumentos(j.data.documentos);
        setEstado("pronto");
      } catch {
        if (vivo) setEstado("erro");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [propostaId]);

  const abrir = useCallback(
    async (doc: Documento) => {
      const janela = window.open("", "_blank", "noopener,noreferrer");
      try {
        const token = await getApoloAccessToken();
        const r = await fetch(
          `/api/temis/trabalho/documentos?proposta=${encodeURIComponent(propostaId)}&abrir=${encodeURIComponent(doc.id)}&fonte=${doc.fonte}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = (await r.json().catch(() => ({}))) as { data?: { url: string } };
        if (j.data?.url) {
          if (janela) janela.location.href = j.data.url;
          else window.location.href = j.data.url;
        } else {
          janela?.close();
        }
      } catch {
        janela?.close();
      }
    },
    [propostaId],
  );

  if (estado === "carregando") {
    return <p className="m-0 text-xs text-ink-muted">Carregando…</p>;
  }
  if (estado === "erro") {
    return <p className="m-0 text-xs text-ink-muted">Não consegui carregar os documentos.</p>;
  }

  // ⚠️ DOIS BLOCOS, e é o que o Lucas pediu: *"documentos - (trazer os documentos dos
  // proponentes)"*. Os da VENDA são o que se trocou nesta negociação; os do PROPONENTE são RG,
  // CPF e comprovantes colhidos na CAD — e a tela do Hércules não mostra os segundos.
  const daVenda = documentos.filter((d) => d.fonte === "venda");
  const doProponente = documentos.filter((d) => d.fonte === "proponente");

  return (
    <div className="space-y-3">
      <Bloco
        aoAbrir={abrir}
        itens={daVenda}
        titulo="Da venda"
        vazio="Nenhum documento nesta venda."
      />
      <Bloco
        aoAbrir={abrir}
        itens={doProponente}
        titulo="Do proponente"
        vazio="Nenhum documento no cadastro."
      />
    </div>
  );
}

function Bloco({
  aoAbrir,
  itens,
  titulo,
  vazio,
}: {
  aoAbrir: (d: Documento) => void;
  itens: Documento[];
  titulo: string;
  vazio: string;
}) {
  return (
    <section>
      <h4 className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {titulo}
      </h4>
      {itens.length === 0 ? (
        <p className="m-0 mt-1 text-xs text-ink-muted">{vazio}</p>
      ) : (
        <ul className="m-0 mt-1 list-none space-y-1 p-0">
          {itens.map((d) => (
            <li key={`${d.fonte}-${d.id}`}>
              <button
                className="w-full rounded-lg bg-subtle px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-line/40"
                onClick={() => aoAbrir(d)}
                type="button"
              >
                {d.nome}
                <span className="block text-[10px] text-ink-muted">
                  {[d.tipo, new Date(d.criadoEm).toLocaleDateString("pt-BR"), d.quem]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── HISTÓRICO ──────────────────────────────────────────────────────────────

function Historico({ propostaId }: { propostaId: string }) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [estado, setEstado] = useState<"carregando" | "erro" | "pronto">("carregando");

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const r = await fetch(
          `/api/temis/trabalho/historico?proposta=${encodeURIComponent(propostaId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const j = (await r.json().catch(() => ({}))) as { data?: { eventos: Evento[] } };
        if (!vivo) return;
        if (!r.ok || !j.data) {
          setEstado("erro");
          return;
        }
        setEventos(j.data.eventos);
        setEstado("pronto");
      } catch {
        if (vivo) setEstado("erro");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [propostaId]);

  if (estado === "carregando") {
    return <p className="m-0 text-xs text-ink-muted">Carregando…</p>;
  }
  if (estado === "erro") {
    return <p className="m-0 text-xs text-ink-muted">Não consegui carregar o histórico.</p>;
  }
  if (eventos.length === 0) {
    return <p className="m-0 text-xs text-ink-muted">Nada registrado ainda.</p>;
  }

  return (
    <ol className="m-0 list-none space-y-2 p-0">
      {eventos.map((e) => (
        <li
          className={`border-l-2 pl-2.5 ${
            // Pagamento e assinatura ganham destaque; etapa é o corpo da linha do tempo.
            e.tipo === "pagamento"
              ? "border-emerald-500/60"
              : e.tipo === "assinatura"
                ? "border-[#A07C3B]"
                : "border-line"
          }`}
          key={e.id}
        >
          <p className="m-0 text-xs font-semibold text-ink">{e.fato}</p>
          {e.observacao ? (
            <p className="m-0 text-[11px] text-ink-soft">{e.observacao}</p>
          ) : null}
          <p className="m-0 text-[10px] text-ink-muted">
            {[
              new Date(e.quando).toLocaleString("pt-BR"),
              e.quem,
              e.valor !== null
                ? e.valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </li>
      ))}
    </ol>
  );
}
