"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { PainelAssinatura } from "@/lib/apolo/painel-assinatura";

import { C, GOLD, Selo, dataCurta, numeroBR } from "./ui";

// AS UNIDADES COM O COMPRADOR ASSINADO — em barras, não em tabela.
//
// Pedido do Lucas (25/08/2026): *"o pessoal está reclamando muito sobre a disposição das
// assinaturas, está difícil de entender. Vamos deixar igual temos no perfil dos incorporadores,
// aquele mesmo esquema de barras, ao clicar abrir as assinaturas e os indicadores"*.
//
// ⚠️ POR QUE A TABELA CONFUNDIA. A coluna "Agora espera" despejava a lista de nomes de quem falta
// numa célula estreita — três, quatro nomes cortados no meio, com "ordem 5" embaixo. Para saber
// como uma unidade estava era preciso ler nomes e cruzar de cabeça com a fila de ordens. O número
// que a pessoa procura ("falta muito?") não estava em lugar nenhum.
//
// ⚠️ O DESENHO VEM DO PERFIL DO INCORPORADOR (modules/incorporador/TelaVendas.tsx), que o Lucas já
// aprovou e o time já usa: "X de Y assinaturas" + barra + a tabela de assinantes ao abrir. Portado
// para a paleta clara desta tela pública, não para as classes do chrome do HUB — elas seguem o tema
// do hub e viriam escuras aqui.

/** Uma unidade pronta para virar barra: o que a lista precisa saber sem reabrir a conta. */
export type UnidadeComBarra = {
  /** Quantas assinaturas do contrato já saíram. */
  assinadas: number;
  /** Todas as pessoas do contrato, na ordem da fila. */
  assinantes: PainelAssinatura["linhas"];
  /** Dias entre o envio e a última assinatura do comprador. */
  dias: null | number;
  /** A ordem que está travando a fila agora (null = contrato completo). */
  degrau: null | number;
  /** Quem está com a bola neste momento. */
  esperando: string[];
  /** Data em que o contrato saiu para assinatura. */
  envio: null | string;
  /** Nome dos compradores. */
  nomes: string;
  /** Data da última assinatura do comprador. */
  ultima: null | string;
  /** Total de assinaturas previstas no contrato. */
  total: number;
  un: string;
};

export function UnidadesComBarra({ unidades }: { unidades: UnidadeComBarra[] }) {
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
        Nenhuma unidade com o comprador assinado neste recorte.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {unidades.map((unidade) => {
        const aberta = abertas.has(unidade.un);
        const percentual =
          unidade.total > 0 ? Math.round((100 * unidade.assinadas) / unidade.total) : 0;
        const completa = unidade.degrau === null;

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
                  gap: 12,
                  gridTemplateColumns: "minmax(0, 1fr) minmax(140px, 260px) auto",
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
                  {/* O comprador vem embaixo e pode truncar: quem procura unidade acha pela unidade. */}
                  <span
                    style={{
                      color: C.sub,
                      display: "block",
                      fontSize: 12,
                      marginLeft: 20,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {unidade.nomes}
                  </span>
                </span>

                <span>
                  <span
                    style={{
                      color: C.sub,
                      display: "block",
                      fontSize: 11.5,
                      marginBottom: 4,
                    }}
                  >
                    {numeroBR(unidade.assinadas)} de {numeroBR(unidade.total)} assinaturas
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      background: C.soft,
                      borderRadius: 999,
                      display: "block",
                      height: 8,
                      overflow: "hidden",
                    }}
                  >
                    <i
                      style={{
                        background: completa ? "#0F9D58" : GOLD,
                        display: "block",
                        height: "100%",
                        width: `${percentual}%`,
                      }}
                    />
                  </span>
                </span>

                <span style={{ minWidth: 92, textAlign: "right" }}>
                  <span
                    style={{
                      color: completa ? "#0F9D58" : C.text,
                      display: "block",
                      fontSize: 15,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 700,
                    }}
                  >
                    {percentual}%
                  </span>
                  <span style={{ color: C.muted, display: "block", fontSize: 11 }}>
                    {completa ? "completo" : `ordem ${unidade.degrau}`}
                  </span>
                </span>
              </div>

              {/* ⚠️ A LINHA QUE A TABELA NÃO CONSEGUIA DAR: quem está com a bola AGORA, por extenso,
                  com espaço para caber. Era a coluna "Agora espera" espremida. */}
              {!completa && unidade.esperando.length > 0 ? (
                <p
                  style={{
                    color: C.sub,
                    fontSize: 12,
                    margin: "8px 0 0 20px",
                  }}
                >
                  <span style={{ color: C.muted }}>Agora espera:</span>{" "}
                  {unidade.esperando.join(", ")}
                </p>
              ) : null}
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
                              tom={assinante.situacao === "assinado"
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
