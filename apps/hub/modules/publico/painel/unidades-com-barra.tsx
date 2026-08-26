"use client";

import { CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { GrupoDeAssinatura, UnidadeComAssinatura } from "@/lib/apolo/unidades-assinatura";

import { C, GOLD, Selo, dataCurta, numeroBR } from "./ui";

// OS CONTRATOS POR UNIDADE — uma barra por perfil, igual ao perfil do incorporador.
//
// Pedido do Lucas (25/08/2026): *"o pessoal está reclamando muito sobre a disposição das
// assinaturas, está difícil de entender. Vamos deixar igual temos no perfil dos incorporadores,
// aquele mesmo esquema de barras, ao clicar abrir as assinaturas e os indicadores"*.
//
// ⚠️ A RÉGUA POR PERFIL, NÃO UMA BARRA DE PROGRESSO. Foi o erro do primeiro porte: uma barra única
// responde "quanto falta", mas a pergunta que faz alguém agir é "QUEM está segurando". Aqui cada
// perfil do contrato tem a sua barra — Imobiliária 1 de 1, Comprador 1 de 1, Incorporador 6 de 6,
// Backoffice 0 de 2 — e a do perfil parado ganha o anel. Desenho de
// modules/incorporador/TelaVendas.tsx, que o time já usa e o Lucas aprovou.
//
// ⚠️ SÓ OS PERFIS DAQUELE CONTRATO desenham barra. Perfil que não assina ali não vira barra vazia,
// porque barra vazia diz "falta alguém" de quem nunca foi chamado.
//
// ⚠️ PALETA FIXA, não as classes do chrome: esta tela roda fora do hub, sem o tema dele. O gêmeo
// interno (modules/apolo/blocks/assinaturas/unidades-em-barra.tsx) tem o mesmo desenho com as
// classes do hub — trocar uma pela outra deixa texto de um tema no fundo do outro.

const VERDE = "#0F9D58";

/** "há 17 dias" a partir de uma data ISO curta. */
function rotuloDeEspera(iso: null | string): string {
  if (!iso) return "sem data de envio";
  const dias = Math.round(
    (Date.now() - new Date(`${iso.slice(0, 10)}T12:00:00`).getTime()) / 86_400_000,
  );
  if (dias <= 0) return "hoje";
  if (dias === 1) return "há 1 dia";
  return `há ${numeroBR(dias)} dias`;
}

export function UnidadesComBarra({ unidades }: { unidades: UnidadeComAssinatura[] }) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  const alternar = (un: string) =>
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(un)) proximo.delete(un);
      else proximo.add(un);
      return proximo;
    });

  if (unidades.length === 0) {
    return (
      <p
        style={{
          border: `1px dashed ${C.border}`,
          borderRadius: 12,
          color: C.muted,
          fontSize: 13,
          margin: 0,
          padding: 32,
          textAlign: "center",
        }}
      >
        Nenhum contrato neste recorte.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {unidades.map((unidade) => {
        const aberta = abertas.has(unidade.un);
        const percentual =
          unidade.total > 0 ? Math.round((100 * unidade.assinadas) / unidade.total) : 0;

        return (
          <div
            key={unidade.un}
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <button
              aria-expanded={aberta}
              onClick={() => alternar(unidade.un)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                display: "block",
                padding: "12px 14px",
                textAlign: "left",
                width: "100%",
              }}
              type="button"
            >
              <div
                style={{
                  alignItems: "center",
                  display: "grid",
                  gap: 14,
                  gridTemplateColumns: "minmax(150px, 1.1fr) minmax(0, 2fr) minmax(118px, auto)",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      alignItems: "center",
                      color: C.text,
                      display: "flex",
                      fontSize: 13.5,
                      fontWeight: 700,
                      gap: 6,
                    }}
                  >
                    {aberta ? (
                      <ChevronDown aria-hidden="true" color={C.muted} size={14} />
                    ) : (
                      <ChevronRight aria-hidden="true" color={C.muted} size={14} />
                    )}
                    {unidade.un}
                  </span>
                  <span
                    style={{
                      color: C.sub,
                      display: "block",
                      fontSize: 11.5,
                      marginLeft: 20,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {unidade.nomes || "comprador não registrado no envio"}
                  </span>
                </span>

                {unidade.grupos.length === 0 ? (
                  <span style={{ color: C.muted, fontSize: 12 }}>
                    Nenhum assinante ficou registrado neste envio.
                  </span>
                ) : (
                  <span
                    style={{
                      display: "grid",
                      gap: 10,
                      gridTemplateColumns: `repeat(${unidade.grupos.length}, minmax(0, 1fr))`,
                    }}
                  >
                    {unidade.grupos.map((grupo) => (
                      <BarraDoPerfil grupo={grupo} key={grupo.perfil} />
                    ))}
                  </span>
                )}

                <span style={{ minWidth: 0, textAlign: "right" }}>
                  <span
                    style={{
                      color: C.text,
                      display: "block",
                      fontSize: 13,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                    }}
                  >
                    {numeroBR(unidade.assinadas)} de {numeroBR(unidade.total)}
                    <span style={{ color: C.muted, fontWeight: 500 }}> · {percentual}%</span>
                  </span>
                  {/* ⚠️ QUEM SEGURA E HÁ QUANTO TEMPO: é a informação que a coluna "Agora espera"
                      tentava dar espremida entre nomes cortados. */}
                  {unidade.concluida ? (
                    <span
                      style={{
                        alignItems: "center",
                        color: VERDE,
                        display: "inline-flex",
                        fontSize: 11.5,
                        fontWeight: 600,
                        gap: 5,
                        marginTop: 3,
                      }}
                    >
                      <CheckCircle2 aria-hidden="true" size={13} />
                      contrato completo
                    </span>
                  ) : (
                    <span
                      style={{ color: C.muted, display: "block", fontSize: 11.5, marginTop: 3 }}
                    >
                      com <b style={{ color: C.sub }}>{unidade.perfisNaVez.join(", ") || "—"}</b> ·{" "}
                      {rotuloDeEspera(unidade.envio)}
                    </span>
                  )}
                </span>
              </div>
            </button>

            {aberta ? (
              <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 14px 14px" }}>
                <div
                  style={{
                    display: "grid",
                    gap: "10px 16px",
                    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                    marginBottom: 12,
                  }}
                >
                  <Indicador rotulo="Enviado em" valor={dataCurta(unidade.envio)} />
                  <Indicador rotulo="Comprador assinou" valor={dataCurta(unidade.ultima)} />
                  <Indicador
                    rotulo="Dias até assinar"
                    valor={unidade.dias === null ? "—" : numeroBR(unidade.dias)}
                  />
                  <Indicador
                    rotulo="Faltam assinar"
                    valor={numeroBR(Math.max(unidade.total - unidade.assinadas, 0))}
                  />
                </div>

                <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={cabecalho}>Ordem</th>
                      <th style={cabecalho}>Assinante</th>
                      <th style={cabecalho}>Perfil</th>
                      <th style={cabecalho}>Situação</th>
                      <th style={{ ...cabecalho, textAlign: "right" }}>Assinou em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unidade.assinantes.map((assinante, indice) => (
                      <tr key={`${assinante.contrato}-${assinante.email}-${indice}`}>
                        <td style={{ ...celulaLocal, color: C.muted, width: 54 }}>
                          {assinante.degrau || "—"}
                        </td>
                        <td style={{ ...celulaLocal, color: C.text }}>
                          {assinante.usuario}
                          <span style={{ color: C.muted, display: "block", fontSize: 11 }}>
                            {assinante.email}
                          </span>
                        </td>
                        <td style={{ ...celulaLocal, color: C.sub }}>{assinante.perfil}</td>
                        <td style={celulaLocal}>
                          <Selo
                            tom={
                              assinante.situacao === "assinado"
                                ? "verde"
                                : assinante.situacao === "vez"
                                  ? "ambar"
                                  : "cinza"
                            }
                          >
                            {assinante.situacao === "assinado"
                              ? "Assinou"
                              : assinante.situacao === "vez"
                                ? "É a vez"
                                : "Aguardando"}
                          </Selo>
                        </td>
                        <td
                          style={{
                            ...celulaLocal,
                            color: C.sub,
                            fontVariantNumeric: "tabular-nums",
                            textAlign: "right",
                          }}
                        >
                          {dataCurta(assinante.assinadoEm)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A barra de UM perfil dentro do contrato.
 *
 * ⚠️ O ANEL SÓ NO PERFIL DA VEZ. É ele que faz a linha ler "falta o Backoffice" de relance, sem
 * ninguém comparar frações. Os perfis que ainda nem foram chamados ficam esmaecidos: eles não devem
 * nada agora, e destacá-los espalharia a culpa por quem não tem culpa.
 */
function BarraDoPerfil({ grupo }: { grupo: GrupoDeAssinatura }) {
  const completo = grupo.assinadas >= grupo.total;
  const percentual = grupo.total > 0 ? (100 * grupo.assinadas) / grupo.total : 0;
  const tinta = completo ? VERDE : grupo.naVez ? GOLD : C.muted;

  return (
    <span
      style={{ display: "block", minWidth: 0, opacity: completo || grupo.naVez ? 1 : 0.55 }}
      title={`${grupo.perfil}: ${grupo.assinadas} de ${grupo.total}`}
    >
      <span
        style={{
          color: grupo.naVez && !completo ? C.text : C.muted,
          display: "block",
          fontSize: 10.5,
          fontWeight: grupo.naVez && !completo ? 700 : 500,
          marginBottom: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {grupo.perfil}
      </span>
      <span
        aria-hidden="true"
        style={{
          background: C.border,
          borderRadius: 999,
          boxShadow: grupo.naVez && !completo ? `0 0 0 1.5px ${C.text}` : "none",
          display: "block",
          height: 6,
          overflow: "hidden",
        }}
      >
        <i
          style={{ background: tinta, display: "block", height: "100%", width: `${percentual}%` }}
        />
      </span>
      <span
        style={{
          color: C.muted,
          display: "block",
          fontSize: 10.5,
          fontVariantNumeric: "tabular-nums",
          marginTop: 3,
        }}
      >
        {numeroBR(grupo.assinadas)} de {numeroBR(grupo.total)}
      </span>
    </span>
  );
}

const cabecalho: React.CSSProperties = {
  borderBottom: `1px solid ${C.border}`,
  color: C.muted,
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: "0.05em",
  padding: "6px 8px",
  textAlign: "left",
  textTransform: "uppercase",
};

const celulaLocal: React.CSSProperties = {
  borderBottom: `1px solid ${C.border}`,
  padding: "7px 8px",
  verticalAlign: "top",
};

function Indicador({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p
        style={{
          color: C.muted,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.05em",
          margin: 0,
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </p>
      <p
        style={{
          color: C.text,
          fontSize: 13.5,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          margin: "2px 0 0",
        }}
      >
        {valor}
      </p>
    </div>
  );
}
