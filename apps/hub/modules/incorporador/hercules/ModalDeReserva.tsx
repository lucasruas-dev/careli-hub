"use client";

import { useEffect, useMemo, useState } from "react";

import { formatarDocumento, soDigitos } from "@/lib/apolo/documento";
import {
  BRASIL,
  buscarPaises,
  formatarTelefoneDoPais,
  type Pais,
  telefoneComPais,
} from "@/lib/hercules/paises";
import type { CorretorQueVende, ImobiliariaQueVende } from "@/lib/hercules/quem-pode-vender";
import {
  comoFoiOAviso,
  conferirReserva,
  type ErroDaReserva,
  PRAZO_PADRAO_EM_DIAS,
  PRAZOS_SUGERIDOS,
  vencimentoEmDias,
} from "@/lib/hercules/reserva";

import { BandeiraDoPais } from "./BandeiraDoPais";

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
  const [pais, setPais] = useState<Pais>(BRASIL);
  const [dias, setDias] = useState<number>(PRAZO_PADRAO_EM_DIAS);
  const [observacao, setObservacao] = useState("");
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
    ddi: pais.ddi,
    observacao,
    imobiliariaEntityId: imobiliariaEscolhida?.id ?? "",
    // ⚠️ O TELEFONE VAI COM O PAÍS NA FRENTE, sempre: é assim que o gateway entrega, e guardar sem
    // o código deixaria um número estrangeiro indistinguível de um nacional depois.
    proponente: { cpf, nome, telefone: telefoneComPais(telefone, pais.ddi) },
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
            data?: { avisos: Array<{ motivo?: string; ok: boolean; para: string }>; codigo?: string };
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

      // O COD na frente do recado: é o que ele vai anotar, e some da tela quando a faixa fecha.
      const cod = corpo.data?.codigo ? `${corpo.data.codigo} · ` : "";
      onReservado(
        `${cod}${unidade.nome} reservada. ${comoFoiOAviso(corpo.data?.avisos ?? [])}`,
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
                <CampoDeTelefone
                  aoMudarNumero={setTelefone}
                  aoMudarPais={setPais}
                  erro={erroDe("telefone")}
                  numero={telefone}
                  pais={pais}
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

          {/* ⚠️ CAMPO LIVRE, E NÃO UMA LISTA DE MOTIVOS (Lucas, 04/09/2026: *"vamos colocar um
              novo campo para reserva, comentário, assim damos ao usuário um campo para fazer suas
              observações"*). O que se anota numa reserva é o que a conversa teve de particular —
              "cliente viaja quinta", "quer o lote do lado se liberar" —, e isso não cabe em opção
              de menu. A coluna já existia na tabela desde a 0125; faltava a porta. */}
          <section style={bloco}>
            <div style={rotulo}>Observações</div>
            <textarea
              maxLength={500}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="O que foi combinado, o que o cliente pediu, o que lembrar depois."
              rows={3}
              style={{ ...campo, lineHeight: 1.45, resize: "vertical" }}
              value={observacao}
            />
            <p style={{ color: T.muted, fontSize: 11, margin: "6px 0 0" }}>
              Fica na reserva, para quem abrir depois. Não vai na mensagem do WhatsApp.
            </p>
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

/**
 * O telefone do cliente: bandeira, código do país e o número com a cara certa.
 *
 * Lucas (04/09/2026): *"deixar o telefone no formato do telefone, e habilitar também telefones
 * estrangeiros, trazer a bandeira dos países e o código para gente preencher (buscar)"*.
 *
 * ⚠️ NÃO DISCA NADA — ele foi explícito (*"não quero discar aqui não"*). Isto é um campo de
 * entrada; o telefone só aparece para leitura na ficha, e lá também sem link de chamada.
 *
 * ⚠️ A MÁSCARA É SÓ DO BRASIL. `(31) 98765-4321` é a forma que todo brasileiro reconhece; nos
 * outros países cada um tem a sua, e várias mudam por região — uma máscara errada deixa um número
 * certo com cara de errado. Fora do Brasil o número sai agrupado de três em três, como se dita.
 */
function CampoDeTelefone({
  aoMudarNumero,
  aoMudarPais,
  erro,
  numero,
  pais,
}: {
  aoMudarNumero: (v: string) => void;
  aoMudarPais: (p: Pais) => void;
  erro: null | string;
  numero: string;
  pais: Pais;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const achados = buscarPaises(busca);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => setAberto((a) => !a)}
          style={{
            ...campo,
            alignItems: "center",
            display: "flex",
            gap: 5,
            justifyContent: "center",
            width: 92,
          }}
          title={pais.nome}
          type="button"
        >
          <BandeiraDoPais altura={12} iso2={pais.iso2} nome={pais.nome} />
          <span style={{ fontSize: 12.5 }}>+{pais.ddi}</span>
        </button>

        <input
          inputMode="tel"
          onChange={(e) => aoMudarNumero(soDigitos(e.target.value))}
          placeholder={pais.ddi === "55" ? "(31) 98765-4321" : "Número com DDD"}
          style={{
            ...campo,
            border: `1px solid ${erro ? T.danger : T.border}`,
            flex: 1,
          }}
          value={formatarTelefoneDoPais(numero, pais.ddi)}
        />
      </div>

      {aberto ? (
        <div
          style={{
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            boxShadow: T.sombra,
            left: 0,
            maxHeight: 260,
            overflow: "auto",
            padding: 8,
            position: "absolute",
            top: "calc(100% + 4px)",
            width: 280,
            zIndex: 5,
          }}
        >
          <input
            autoFocus
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar país ou código"
            style={{ ...campo, marginBottom: 6 }}
            value={busca}
          />
          {achados.map((p) => (
            <button
              key={`${p.iso2}-${p.ddi}`}
              onClick={() => {
                aoMudarPais(p);
                setAberto(false);
                setBusca("");
              }}
              style={{
                alignItems: "center",
                background: p.iso2 === pais.iso2 ? T.soft : "transparent",
                border: "none",
                borderRadius: 7,
                color: T.text,
                cursor: "pointer",
                display: "flex",
                font: "inherit",
                fontSize: 12.5,
                gap: 8,
                padding: "6px 8px",
                textAlign: "left",
                width: "100%",
              }}
              type="button"
            >
              <BandeiraDoPais altura={12} iso2={p.iso2} nome={p.nome} />
              <span style={{ flex: 1 }}>{p.nome}</span>
              <span style={{ color: T.muted }}>+{p.ddi}</span>
            </button>
          ))}
          {achados.length === 0 ? (
            <p style={{ color: T.muted, fontSize: 11.5, margin: "6px 8px" }}>
              Nenhum país com esse nome ou código.
            </p>
          ) : null}
        </div>
      ) : null}

      {erro ? <Erro texto={erro} /> : null}
    </div>
  );
}

function Erro({ texto }: { texto: string }) {
  return <p style={{ color: T.danger, fontSize: 11.5, margin: "5px 0 0" }}>{texto}</p>;
}
