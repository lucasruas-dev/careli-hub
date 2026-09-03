"use client";

import { useEffect, useMemo, useState } from "react";

import { formatarDocumento, soDigitos } from "@/lib/apolo/documento";
import type { CorretorQueVende, ImobiliariaQueVende } from "@/lib/hercules/quem-pode-vender";
import {
  conferirReserva,
  type ErroDaReserva,
  PRAZO_PADRAO_EM_DIAS,
  PRAZOS_SUGERIDOS,
  vencimentoEmDias,
} from "@/lib/hercules/reserva";

import { T } from "../tema";

// O FORMULÁRIO DA RESERVA.
//
// Lucas (03/09/2026): *"ao clicar, o usuário tem que buscar a imobiliária ou corretor — o ideal é o
// corretor e trazer a imobiliária junto, mas se ele selecionar a imobiliária, mostrar os corretores
// disponíveis (...). Depois que ele aponta corretor e imobiliária, ele vai informar o Nome do
// cliente, CPF e Telefone (somente) e o prazo de vencimento dessa reserva."*
//
// ⚠️ UMA BUSCA SÓ PARA OS DOIS. Ele descreveu dois caminhos ("buscar a imobiliária OU corretor"),
// e o instinto seria dar dois campos. Mas quem está na mesa sabe UM nome — ora o do corretor, ora o
// da imobiliária — e dois campos obrigam a decidir em qual deles digitar antes de digitar. Aqui é
// um campo: a lista mostra os dois tipos, e escolher um resolve o outro.
//
// ⚠️ TUDO NUMA TELA, sem passos. São seis campos; um wizard de três etapas para seis campos cobra
// dois cliques a mais em cada reserva e esconde do coordenador o que ainda falta preencher.
//
// ⚠️ A LISTA VEM FILTRADA PELO EMPREENDIMENTO, e o filtro é o da IMOBILIÁRIA. Ela é credenciada no
// empreendimento; o corretor é credenciado nela. Uma primeira versão exigia também vínculo do
// corretor com o empreendimento e deixava 42 dos 65 corretores do Vale do Ouro cinza — o Lucas
// desfez isso na hora: *"não entendi o motivo de não trazer todos os corretores"*.

export type DadosDaReserva = {
  corretorEntityId: null | string;
  imobiliariaEntityId: string;
  proponente: { cpf: string; nome: string; telefone: string };
  validadeEm: string;
};

type Lista = { corretores: CorretorQueVende[]; imobiliarias: ImobiliariaQueVende[] };

type Escolhido =
  | { corretor: CorretorQueVende; tipo: "corretor" }
  | { imobiliaria: ImobiliariaQueVende; tipo: "imobiliaria" }
  | null;

export function ModalDeReserva({
  onFechar,
  onReservado,
  unidade,
  valorDaUnidade,
}: {
  onFechar: () => void;
  onReservado: (mensagem: string) => void;
  unidade: { id: string; nome: string; produto: string };
  valorDaUnidade: number;
}) {
  const [lista, setLista] = useState<Lista | null>(null);
  const [falhaDaLista, setFalhaDaLista] = useState<null | string>(null);
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<Escolhido>(null);
  const [corretorId, setCorretorId] = useState<null | string>(null);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");
  const [dias, setDias] = useState<number>(PRAZO_PADRAO_EM_DIAS);
  const [enviando, setEnviando] = useState(false);
  const [erroDoServidor, setErroDoServidor] = useState<null | string>(null);
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [onFechar]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch(
          `/api/incorporador/venda/reserva?unidade=${encodeURIComponent(unidade.id)}`,
          { cache: "no-store" },
        );
        const texto = await r.text();
        const corpo = texto ? (JSON.parse(texto) as { data?: Lista; error?: string }) : {};
        if (!vivo) return;
        if (!r.ok) {
          setFalhaDaLista(corpo.error ?? "Não foi possível carregar quem pode vender.");
          return;
        }
        setLista(corpo.data ?? { corretores: [], imobiliarias: [] });
      } catch {
        if (vivo) setFalhaDaLista("Não foi possível carregar quem pode vender.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [unidade.id]);

  const validadeEm = useMemo(() => vencimentoEmDias(new Date().toISOString(), dias), [dias]);

  const imobiliariaEscolhida = useMemo(() => {
    if (!escolhido) return null;
    if (escolhido.tipo === "imobiliaria") return escolhido.imobiliaria;
    return (
      lista?.imobiliarias.find((i) => i.id === escolhido.corretor.imobiliariaId) ?? {
        documento: null,
        id: escolhido.corretor.imobiliariaId,
        nome: escolhido.corretor.imobiliariaNome,
        verificada: false,
      }
    );
  }, [escolhido, lista]);

  /** Os corretores da imobiliária escolhida — a segunda metade do pedido dele. */
  const corretoresDaEscolhida = useMemo(
    () =>
      imobiliariaEscolhida
        ? (lista?.corretores ?? []).filter((c) => c.imobiliariaId === imobiliariaEscolhida.id)
        : [],
    [imobiliariaEscolhida, lista],
  );

  const achados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!lista) return { corretores: [], imobiliarias: [] };
    if (!termo) return { corretores: lista.corretores.slice(0, 6), imobiliarias: lista.imobiliarias };
    return {
      corretores: lista.corretores.filter(
        (c) =>
          c.nome.toLowerCase().includes(termo) || c.imobiliariaNome.toLowerCase().includes(termo),
      ),
      imobiliarias: lista.imobiliarias.filter((i) => i.nome.toLowerCase().includes(termo)),
    };
  }, [busca, lista]);

  const pedido = {
    corretorEntityId: corretorId,
    imobiliariaEntityId: imobiliariaEscolhida?.id ?? "",
    proponente: { cpf, nome, telefone },
    unidadeId: unidade.id,
    validadeEm,
  };

  const erros = conferirReserva(pedido, new Date().toISOString());
  const erroDe = (campo: ErroDaReserva["campo"]) =>
    tentou ? (erros.find((e) => e.campo === campo)?.mensagem ?? null) : null;

  async function reservar() {
    setTentou(true);
    setErroDoServidor(null);
    if (erros.length > 0) return;

    setEnviando(true);
    try {
      const r = await fetch("/api/incorporador/venda/reserva", {
        body: JSON.stringify(pedido),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const texto = await r.text();
      const corpo = texto
        ? (JSON.parse(texto) as {
            data?: { avisos: Array<{ ok: boolean; para: string }> };
            erros?: ErroDaReserva[];
            error?: string;
          })
        : {};

      if (!r.ok) {
        setErroDoServidor(
          corpo.error ?? corpo.erros?.map((e) => e.mensagem).join(" ") ?? "Não foi possível reservar.",
        );
        return;
      }

      const semAviso = (corpo.data?.avisos ?? []).filter((a) => !a.ok);
      onReservado(
        semAviso.length === 0
          ? `${unidade.nome} reservada. Corretor, imobiliária e coordenador avisados.`
          : `${unidade.nome} reservada. Sem aviso para: ${semAviso.map((a) => a.para).join(", ")}.`,
      );
    } catch {
      setErroDoServidor("Não foi possível reservar agora.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      style={{
        background: "rgb(0 0 0 / .55)",
        display: "grid",
        inset: 0,
        padding: 24,
        placeItems: "center",
        position: "fixed",
        zIndex: 70,
      }}
    >
      <div
        style={{
          background: T.page,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          color: T.text,
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(92vh, 860px)",
          overflow: "hidden",
          width: "min(94vw, 620px)",
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            justifyContent: "space-between",
            padding: "12px 16px",
          }}
        >
          <div>
            <b style={{ fontSize: 14 }}>Reservar {unidade.nome}</b>
            <div style={{ color: T.muted, fontSize: 11.5 }}>
              {unidade.produto}
              {valorDaUnidade > 0
                ? ` · R$ ${Math.round(valorDaUnidade).toLocaleString("pt-BR")}`
                : ""}
            </div>
          </div>
          <button onClick={onFechar} style={botaoDiscreto} type="button">
            Fechar
          </button>
        </div>

        <div style={{ display: "grid", gap: 14, overflow: "auto", padding: 16 }}>
          {/* ── QUEM VENDE ───────────────────────────────────────────── */}
          <section style={bloco}>
            <div style={rotulo}>Quem está vendendo</div>

            {falhaDaLista ? (
              <p style={{ color: T.danger, fontSize: 12.5, margin: 0 }}>{falhaDaLista}</p>
            ) : !lista ? (
              <p style={{ color: T.muted, fontSize: 12.5, margin: 0 }}>Carregando…</p>
            ) : lista.imobiliarias.length === 0 ? (
              <p style={{ color: T.muted, fontSize: 12.5, margin: 0 }}>
                Nenhuma imobiliária habilitada a vender neste empreendimento. O vínculo é feito no
                credenciamento, no Apolo.
              </p>
            ) : escolhido ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    alignItems: "center",
                    background: T.card,
                    border: `1px solid ${T.border}`,
                    borderRadius: 10,
                    display: "flex",
                    gap: 10,
                    justifyContent: "space-between",
                    padding: "9px 12px",
                  }}
                >
                  <span>
                    <b style={{ fontSize: 13 }}>{imobiliariaEscolhida?.nome}</b>
                    <div style={{ color: T.muted, fontSize: 11 }}>
                      Imobiliária{imobiliariaEscolhida?.documento ? ` · ${imobiliariaEscolhida.documento}` : ""}
                    </div>
                  </span>
                  <button
                    onClick={() => {
                      setEscolhido(null);
                      setCorretorId(null);
                      setBusca("");
                    }}
                    style={botaoDiscreto}
                    type="button"
                  >
                    Trocar
                  </button>
                </div>

                {/* ⚠️ ESCOLHER A IMOBILIÁRIA MOSTRA OS CORRETORES DELA — é o segundo caminho que
                    ele descreveu, e o corretor continua opcional (*"o ideal é o corretor"*). */}
                <div>
                  <div style={{ ...rotulo, marginBottom: 6 }}>Corretor</div>
                  {corretoresDaEscolhida.length === 0 ? (
                    <p style={{ color: T.muted, fontSize: 11.5, margin: 0 }}>
                      Esta imobiliária não tem corretor cadastrado. A reserva sai no nome dela.
                    </p>
                  ) : (
                    <div style={{ display: "grid", gap: 5 }}>
                      {corretoresDaEscolhida.map((c) => {
                        const ativo = corretorId === c.id;
                        return (
                          <button
                            key={c.id}
                            onClick={() => setCorretorId(ativo ? null : c.id)}
                            style={{
                              alignItems: "center",
                              background: ativo ? T.soft : T.card,
                              border: `1px solid ${ativo ? T.gold : T.border}`,
                              borderRadius: 9,
                              color: T.text,
                              cursor: "pointer",
                              display: "flex",
                              font: "inherit",
                              fontSize: 12.5,
                              gap: 8,
                              justifyContent: "space-between",
                              padding: "8px 11px",
                              textAlign: "left",
                            }}
                            type="button"
                          >
                            <span>{c.nome}</span>
                            {ativo ? (
                              <span style={{ color: T.gold, fontSize: 11, fontWeight: 700 }}>
                                escolhido
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <input
                  autoFocus
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar corretor ou imobiliária"
                  style={campo}
                  value={busca}
                />
                <div style={{ display: "grid", gap: 4, maxHeight: 210, overflow: "auto" }}>
                  {achados.corretores.map((c) => (
                    <button
                      key={`c-${c.id}`}
                      onClick={() => {
                        setEscolhido({ corretor: c, tipo: "corretor" });
                        setCorretorId(c.id);
                      }}
                      style={{ ...linhaDaBusca, color: T.text }}
                      type="button"
                    >
                      <span>
                        <b style={{ fontSize: 12.5 }}>{c.nome}</b>
                        <div style={{ color: T.muted, fontSize: 11 }}>
                          Corretor · {c.imobiliariaNome}
                        </div>
                      </span>
                    </button>
                  ))}
                  {achados.imobiliarias.map((i) => (
                    <button
                      key={`i-${i.id}`}
                      onClick={() => setEscolhido({ imobiliaria: i, tipo: "imobiliaria" })}
                      style={linhaDaBusca}
                      type="button"
                    >
                      <span>
                        <b style={{ fontSize: 12.5 }}>{i.nome}</b>
                        <div style={{ color: T.muted, fontSize: 11 }}>
                          Imobiliária{i.documento ? ` · ${i.documento}` : ""}
                        </div>
                      </span>
                    </button>
                  ))}
                  {achados.corretores.length + achados.imobiliarias.length === 0 ? (
                    <p style={{ color: T.muted, fontSize: 12, margin: "4px 0 0" }}>
                      Ninguém com esse nome está habilitado neste empreendimento.
                    </p>
                  ) : null}
                </div>
              </div>
            )}
            {erroDe("imobiliaria") ? <Erro texto={erroDe("imobiliaria")!} /> : null}
          </section>

          {/* ── O CLIENTE ────────────────────────────────────────────── */}
          <section style={bloco}>
            <div style={rotulo}>O cliente</div>
            <div style={{ display: "grid", gap: 8 }}>
              <Campo
                aoMudar={setNome}
                erro={erroDe("nome")}
                placeholder="Nome completo"
                valor={nome}
              />
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <Campo
                  aoMudar={(v) => setCpf(formatarDocumento(soDigitos(v).slice(0, 11)) || v)}
                  erro={erroDe("cpf")}
                  placeholder="CPF"
                  valor={cpf}
                />
                <Campo
                  aoMudar={setTelefone}
                  erro={erroDe("telefone")}
                  placeholder="Telefone com DDD"
                  valor={telefone}
                />
              </div>
            </div>
          </section>

          {/* ── O PRAZO ──────────────────────────────────────────────── */}
          <section style={bloco}>
            <div style={rotulo}>Vence em</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PRAZOS_SUGERIDOS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDias(d)}
                  style={{
                    background: dias === d ? T.soft : "transparent",
                    border: `1px solid ${dias === d ? T.gold : T.border}`,
                    borderRadius: 999,
                    color: dias === d ? T.text : T.sub,
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "5px 12px",
                  }}
                  type="button"
                >
                  {d} {d === 1 ? "dia" : "dias"}
                </button>
              ))}
            </div>
            <p style={{ color: T.muted, fontSize: 11.5, margin: "8px 0 0" }}>
              A reserva vale até{" "}
              <b>
                {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(
                  new Date(validadeEm),
                )}
              </b>
              , no fim do dia.
            </p>
            {erroDe("validade") ? <Erro texto={erroDe("validade")!} /> : null}
          </section>

          {erroDoServidor ? <Erro texto={erroDoServidor} /> : null}
        </div>

        <div
          style={{
            alignItems: "center",
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            gap: 10,
            justifyContent: "space-between",
            padding: "12px 16px",
          }}
        >
          <span style={{ color: T.muted, fontSize: 11.5 }}>
            Ao reservar, corretor, imobiliária e coordenador recebem o aviso pelo WhatsApp do
            Relacionamento.
          </span>
          <button
            disabled={enviando}
            onClick={reservar}
            style={{
              background: enviando ? T.soft : T.btnBg,
              border: "none",
              borderRadius: 9,
              color: enviando ? T.muted : T.btnFg,
              cursor: enviando ? "default" : "pointer",
              font: "inherit",
              fontSize: 13,
              fontWeight: 650,
              padding: "9px 20px",
              whiteSpace: "nowrap",
            }}
            type="button"
          >
            {enviando ? "Reservando…" : "Reservar"}
          </button>
        </div>
      </div>
    </div>
  );
}

const bloco = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: 12,
} as const;

const rotulo = {
  color: T.muted,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  marginBottom: 8,
  textTransform: "uppercase",
} as const;

const campo = {
  background: T.soft,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  font: "inherit",
  fontSize: 13,
  padding: "8px 10px",
  width: "100%",
} as const;

const linhaDaBusca = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 9,
  cursor: "pointer",
  font: "inherit",
  padding: "8px 11px",
  textAlign: "left",
  width: "100%",
} as const;

const botaoDiscreto = {
  background: "transparent",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.sub,
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  padding: "5px 12px",
} as const;

function Campo({
  aoMudar,
  erro,
  placeholder,
  valor,
}: {
  aoMudar: (v: string) => void;
  erro: null | string;
  placeholder: string;
  valor: string;
}) {
  return (
    <div>
      <input
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        style={{ ...campo, border: `1px solid ${erro ? T.danger : T.border}` }}
        value={valor}
      />
      {erro ? <Erro texto={erro} /> : null}
    </div>
  );
}

function Erro({ texto }: { texto: string }) {
  return <p style={{ color: T.danger, fontSize: 11.5, margin: "5px 0 0" }}>{texto}</p>;
}
