"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  NOME_DO_TIPO_DE_MENSAGEM,
  type TipoDaMensagem,
} from "@/lib/hercules/documentos-da-venda";

import { T } from "../tema";

// A CONVERSA DA VENDA — o registro interno do lote.
//
// Lucas (06/09/2026): *"terei que ter um chat para relatar, tirar dúvidas, informar de forma
// formalizada (...) o chat é onde vai ficar os registros de conversas, formalizações,
// observações"*. E: *"deixa o chat como principal, primeiro chat - documentos - histórico"*.
//
// ⚠️ NÃO É A IRIS. A Iris fala COM O CLIENTE, por WhatsApp e e-mail, com fila e dono. Aqui é o que
// a casa combina sobre a venda: o que o coordenador acertou com o corretor, o que o jurídico
// respondeu, a observação que explica por que o desconto saiu daquele tamanho. Nada daqui sai para
// fora — e é por isso que serve de prova depois.
//
// ⚠️ A CONVERSA LÊ-SE DE CIMA PARA BAIXO, ao contrário do histórico ao lado. Chat com a mensagem
// mais nova no topo obriga a ler de trás para frente para entender o que foi combinado.
//
// ⚠️ SÓ A CAIXA DE TEXTO (Lucas, 06/09/2026: *"deixa somente a caixa de texto, não precisa dessas
// abas, mensagem, observação"*, e *"não precisa, vi o código aqui"* sobre o COD repetido em cada
// linha). Eu tinha posto três pílulas de tipo antes de alguém ter escrito a primeira frase aqui —
// três decisões pedidas de graça a quem só quer registrar uma coisa — e o COD em toda mensagem, num
// chat em que todas são da mesma venda. A COLUNA `tipo` FICA no banco e a tela continua sabendo
// pintar o que vier diferente: no dia em que a formalização precisar existir, ela nasce de um gesto
// próprio sobre uma mensagem já escrita, e não de um seletor que todos atravessam para escrever
// qualquer coisa.

type MensagemDaVenda = {
  autor_nome: null | string;
  codigo: null | string;
  criado_em: string;
  id: string;
  texto: string;
  tipo: string;
};

/** O tom de cada tipo. Só a formalização ganha destaque: ela é a que alguém procura depois. */
const TOM: Record<string, { fundo: string; traco: string }> = {
  formalizacao: { fundo: T.okBg, traco: T.ok },
  mensagem: { fundo: "transparent", traco: T.border },
  observacao: { fundo: T.soft, traco: T.border },
};

export function ConversaDaVenda({ unidadeId, versao }: { unidadeId: null | string; versao: number }) {
  const [mensagens, setMensagens] = useState<MensagemDaVenda[]>([]);
  const [estado, setEstado] = useState<"carregando" | "erro" | "pronto">("pronto");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  const rolagem = useRef<HTMLDivElement | null>(null);

  /**
   * ⚠️ A CARGA DE UM LOTE NÃO PODE POUSAR EM OUTRO. O `pedido` é o selo desta chamada: se ela
   * demorar e a pessoa clicar noutro lote no meio, a resposta antiga chega depois — e sem o selo
   * ela sobrescreveria a conversa do lote que está na tela AGORA, com o texto de outro cliente.
   * É o mesmo defeito que a ficha já teve com o histórico.
   */
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    if (!unidadeId) {
      setMensagens([]);
      return;
    }
    setEstado("carregando");
    try {
      const r = await fetch(
        `/api/incorporador/venda/conversa?unidade=${encodeURIComponent(unidadeId)}`,
        { cache: "no-store" },
      );
      const j = (await r.json().catch(() => null)) as null | {
        data?: { mensagens: MensagemDaVenda[] };
      };
      if (meu !== pedido.current) return;
      if (!r.ok || !j?.data) {
        setEstado("erro");
        return;
      }
      setMensagens(j.data.mensagens);
      setEstado("pronto");
    } catch {
      if (meu === pedido.current) setEstado("erro");
    }
  }, [unidadeId]);

  // ⚠️ TROCAR DE LOTE ESVAZIA A LISTA NA HORA. Sem isto, a conversa do lote anterior fica na tela
  // enquanto a nova carrega — e ela parece ser deste cliente.
  useEffect(() => {
    setMensagens([]);
    setTexto("");
    setErro(null);
  }, [unidadeId]);

  // ⚠️ O `versao` NÃO APAGA O QUE ESTÁ SENDO DIGITADO. Ele sobe a cada carga do fluxo (reservar,
  // gerar proposta, cancelar), e limpar o campo aí faria a pessoa perder um parágrafo escrito à mão
  // por causa de uma ação que ela mesma fez noutro canto da tela.
  useEffect(() => {
    void carregar();
  }, [carregar, versao]);

  // ⚠️ ROLA A LISTA, E NÃO A PÁGINA. `scrollIntoView` sobe por todos os ancestrais que rolam: numa
  // ficha que já rola por dentro, ele levava os botões de ação para fora da vista a cada mensagem.
  // Aqui a rolagem é do próprio painel, direto no `scrollTop`.
  useEffect(() => {
    const lista = rolagem.current;
    if (lista) lista.scrollTop = lista.scrollHeight;
  }, [mensagens.length]);

  async function enviar() {
    const limpo = texto.trim();
    if (!unidadeId || limpo.length === 0 || enviando) return;

    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/incorporador/venda/conversa", {
        body: JSON.stringify({ texto: limpo, unidadeId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const j = (await r.json().catch(() => null)) as null | {
        data?: { mensagem: MensagemDaVenda };
        error?: string;
      };
      if (!r.ok || !j?.data) {
        setErro(j?.error ?? "Não foi possível registrar.");
        return;
      }
      // ⚠️ ENTRA NA LISTA SEM RECARREGAR A CONVERSA INTEIRA: a resposta já traz a linha gravada,
      // com o id e a hora do servidor. Refazer o GET aqui piscaria a tela por nada.
      //
      // ⚠️ E A CARGA EM VOO É INVALIDADA. Um GET disparado antes deste POST responderia DEPOIS, com
      // uma lista que não tem esta mensagem — e ela sumiria da tela segundos após aparecer, com a
      // pessoa achando que não registrou.
      pedido.current += 1;
      const nova = j.data.mensagem;
      setMensagens((atuais) =>
        atuais.some((m) => m.id === nova.id) ? atuais : [...atuais, nova],
      );
      setTexto("");
    } catch {
      setErro("Não foi possível registrar agora.");
    } finally {
      setEnviando(false);
    }
  }

  if (!unidadeId) {
    return (
      <p style={{ color: T.muted, fontSize: 12.5, margin: 0, padding: "18px 2px" }}>
        Escolha uma unidade para ver a conversa.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
      {/* ⚠️ A ALTURA TEM DE SER LIMITADA PARA HAVER ROLAGEM. `overflow: auto` sem teto não rola: o
          bloco cresce, o `scrollTop` vira no-op e o campo de escrever desce para fora da vista a
          cada mensagem nova. O teto é em `vh` porque a coluna da ficha já tem a altura dela. */}
      <div
        ref={rolagem}
        style={{
          display: "grid",
          gap: 8,
          maxHeight: "min(46vh, 420px)",
          minHeight: 0,
          overflow: "auto",
        }}
      >
        {estado === "carregando" && mensagens.length === 0 ? (
          <p style={{ color: T.muted, fontSize: 12, margin: 0 }}>Carregando…</p>
        ) : estado === "erro" ? (
          <p style={{ color: T.danger, fontSize: 12.5, margin: 0 }}>
            Não foi possível carregar a conversa.
          </p>
        ) : mensagens.length === 0 ? (
          <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
            Nada registrado ainda. O que for combinado aqui fica gravado com autor e hora — é o que
            explica esta venda para quem olhar depois.
          </p>
        ) : (
          mensagens.map((m) => {
            const tom = TOM[m.tipo] ?? TOM.mensagem!;
            return (
              <article
                key={m.id}
                style={{
                  background: tom.fundo,
                  borderLeft: `2px solid ${tom.traco}`,
                  display: "grid",
                  gap: 3,
                  padding: "6px 0 6px 10px",
                }}
              >
                <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <b style={{ fontSize: 12 }}>{m.autor_nome ?? "—"}</b>
                  <span style={{ color: T.muted, fontSize: 11 }}>{quando(m.criado_em)}</span>
                  {m.tipo !== "mensagem" ? (
                    <span
                      style={{
                        color: m.tipo === "formalizacao" ? T.ok : T.muted,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 0.4,
                        textTransform: "uppercase",
                      }}
                    >
                      {NOME_DO_TIPO_DE_MENSAGEM[m.tipo as TipoDaMensagem] ?? m.tipo}
                    </span>
                  ) : null}
                </div>
                <p style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0, whiteSpace: "pre-wrap" }}>
                  {m.texto}
                </p>
              </article>
            );
          })
        )}
      </div>

      <div style={{ borderTop: `1px solid ${T.border}`, display: "grid", gap: 6, paddingTop: 10 }}>
        <textarea
          disabled={enviando}
          // ⚠️ O CORTE É AVISADO ANTES, e não depois. O servidor apara em 4.000; sem o `maxLength`,
          // uma formalização longa seria gravada pela metade e a pessoa só descobriria relendo.
          maxLength={4000}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // ⚠️ ENTER MANDA, SHIFT+ENTER QUEBRA LINHA — o gesto de todo chat. Sem isso, quem
            // escreve rápido manda a mensagem pela metade procurando o botão.
            //
            // ⚠️ E NÃO NO MEIO DE UM ACENTO. Teclado que compõe caractere (o "ã" de "não", o
            // corretor do celular) usa Enter para CONFIRMAR a composição: sem esta guarda, escrever
            // "não" manda a mensagem em "n~". `isComposing` é o sinal padrão do navegador.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void enviar();
            }
          }}
          placeholder="Registrar algo sobre esta venda…"
          rows={2}
          style={{
            background: T.page,
            border: `1px solid ${T.border}`,
            borderRadius: 9,
            color: T.text,
            font: "inherit",
            fontSize: 12.5,
            padding: "8px 10px",
            resize: "vertical",
          }}
          value={texto}
        />

        {erro ? <span style={{ color: T.danger, fontSize: 11.5 }}>{erro}</span> : null}

        <div style={{ alignItems: "center", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <span style={{ color: T.muted, fontSize: 11, marginRight: "auto" }}>
            Fica gravado com seu nome e a hora. Não se apaga.
          </span>
          <button
            disabled={enviando || texto.trim().length === 0}
            onClick={() => void enviar()}
            style={{
              background: texto.trim().length === 0 ? T.soft : T.btnBg,
              border: `1px solid ${texto.trim().length === 0 ? T.border : "transparent"}`,
              borderRadius: 9,
              color: texto.trim().length === 0 ? T.muted : T.btnFg,
              cursor: texto.trim().length === 0 ? "default" : "pointer",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 650,
              padding: "7px 16px",
            }}
            type="button"
          >
            {enviando ? "Registrando…" : "Registrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "06/09 15:13" — no fuso da operação, como o resto da tela. */
function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}
