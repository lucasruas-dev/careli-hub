"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  conferirArquivo,
  type GrupoDeDocumentos,
  GERADO_PELO_SISTEMA,
  NOME_DO_TIPO_DE_DOCUMENTO,
  TAMANHO_MAXIMO_ESCRITO,
  tamanhoEscrito,
  type TipoDeDocumento,
} from "@/lib/hercules/documentos-da-venda";
import { getHubSupabaseClient } from "@/lib/supabase/client";

import { T } from "../tema";

// OS DOCUMENTOS DA VENDA — agrupados por protocolo.
//
// Lucas (06/09/2026): *"documentos é para transitar documentos referente àquela reserva, proposta
// de forma segura e formalizada (...) os documentos têm que ser agrupados por protocolo, código"*.
//
// ⚠️ O ARQUIVO NÃO PASSA PELO SERVIDOR. São dois passos: a rota assina a permissão de gravar um
// caminho (requisição minúscula) e o navegador grava os bytes DIRETO no Storage. É o que permite
// 20 MB — o mesmo teto do Apolo e do LSoft. Mandar o arquivo pela função esbarraria no limite de
// 4,5 MB do corpo da Vercel, que é o teto da PLATAFORMA e não uma regra de produto.
//
// ⚠️ O CLIENTE DO SUPABASE AQUI É O ANÔNIMO, e está certo: quem autoriza a gravação é o TOKEN
// assinado pelo service role, não a sessão de quem clica. O portal comercial não tem sessão do hub.

type Estado = "carregando" | "erro" | "pronto";

export function DocumentosDaVenda({
  unidadeId,
  versao,
}: {
  unidadeId: null | string;
  versao: number;
}) {
  const [grupos, setGrupos] = useState<GrupoDeDocumentos[]>([]);
  const [estado, setEstado] = useState<Estado>("pronto");
  const [erro, setErro] = useState<null | string>(null);
  const [enviando, setEnviando] = useState(false);
  const campo = useRef<HTMLInputElement | null>(null);

  const carregar = useCallback(async () => {
    if (!unidadeId) {
      setGrupos([]);
      return;
    }
    setEstado("carregando");
    try {
      const r = await fetch(
        `/api/incorporador/venda/documentos?unidade=${encodeURIComponent(unidadeId)}`,
        { cache: "no-store" },
      );
      const j = (await r.json().catch(() => null)) as null | {
        data?: { grupos: GrupoDeDocumentos[] };
      };
      if (!r.ok || !j?.data) {
        setEstado("erro");
        return;
      }
      setGrupos(j.data.grupos);
      setEstado("pronto");
    } catch {
      setEstado("erro");
    }
  }, [unidadeId]);

  useEffect(() => {
    setErro(null);
    void carregar();
  }, [carregar, versao]);

  async function enviar(arquivo: File) {
    if (!unidadeId) return;

    // A mesma régua do servidor, aqui: recusar antes de subir poupa a espera inteira.
    const conferido = conferirArquivo({ nome: arquivo.name, tamanho: arquivo.size });
    if (!conferido.ok) {
      setErro(conferido.motivo);
      return;
    }

    setEnviando(true);
    setErro(null);
    try {
      const preparo = await fetch("/api/incorporador/venda/documentos", {
        body: JSON.stringify({
          acao: "preparar",
          nome: arquivo.name,
          tamanho: arquivo.size,
          unidadeId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const p = (await preparo.json().catch(() => null)) as null | {
        data?: { bucket: string; caminho: string; token: string };
        error?: string;
      };
      if (!preparo.ok || !p?.data) {
        setErro(p?.error ?? "Não foi possível preparar o envio.");
        return;
      }

      // ⚠️ O CLIENTE PODE NÃO EXISTIR: `getHubSupabaseClient` devolve `null` quando a configuração
      // pública não chegou ao bundle. Sem esta guarda, o erro sairia como "Cannot read properties of
      // null" no console e a tela ficaria muda depois de a pessoa esperar o upload.
      const supabase = getHubSupabaseClient();
      if (!supabase) {
        setErro("Envio indisponível nesta tela agora. Recarregue a página e tente de novo.");
        return;
      }

      const subida = await supabase.storage
        .from(p.data.bucket)
        .uploadToSignedUrl(p.data.caminho, p.data.token, arquivo, {
          contentType: arquivo.type || "application/octet-stream",
        });
      if (subida.error) {
        setErro("O arquivo não subiu. Tente de novo.");
        return;
      }

      const registro = await fetch("/api/incorporador/venda/documentos", {
        body: JSON.stringify({
          acao: "registrar",
          caminho: p.data.caminho,
          nome: arquivo.name,
          tamanho: arquivo.size,
          tipoDoArquivo: arquivo.type,
          unidadeId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const reg = (await registro.json().catch(() => null)) as null | { error?: string };
      if (!registro.ok) {
        setErro(reg?.error ?? "O arquivo subiu, mas não foi registrado. Tente de novo.");
        return;
      }

      await carregar();
    } catch {
      setErro("Não foi possível enviar agora.");
    } finally {
      setEnviando(false);
      if (campo.current) campo.current.value = "";
    }
  }

  async function abrir(id: string) {
    if (!unidadeId) return;
    // ⚠️ A ABA ABRE ANTES DO PEDIDO: chamar `window.open` depois do `await` é chamá-lo fora do
    // clique, e todo navegador com bloqueio de pop-up engole essa janela.
    const aba = window.open("", "_blank");
    try {
      const r = await fetch(
        `/api/incorporador/venda/documentos?unidade=${encodeURIComponent(
          unidadeId,
        )}&baixar=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const j = (await r.json().catch(() => null)) as null | {
        data?: { url: string };
        error?: string;
      };
      if (!r.ok || !j?.data) {
        aba?.close();
        setErro(j?.error ?? "Não foi possível abrir o documento.");
        return;
      }
      if (aba) {
        aba.opener = null;
        aba.location.href = j.data.url;
      } else {
        setErro("Libere as janelas deste site no navegador para abrir o documento.");
      }
    } catch {
      aba?.close();
      setErro("Não foi possível abrir o documento.");
    }
  }

  if (!unidadeId) {
    return (
      <p style={{ color: T.muted, fontSize: 12.5, margin: 0, padding: "18px 2px" }}>
        Escolha uma unidade para ver os documentos.
      </p>
    );
  }

  const vazio = grupos.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
      <div style={{ display: "grid", gap: 14, minHeight: 0, overflow: "auto" }}>
        {estado === "carregando" && vazio ? (
          <p style={{ color: T.muted, fontSize: 12, margin: 0 }}>Carregando…</p>
        ) : estado === "erro" ? (
          <p style={{ color: T.danger, fontSize: 12.5, margin: 0 }}>
            Não foi possível carregar os documentos.
          </p>
        ) : vazio ? (
          <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
            Nenhum documento nesta unidade. O que for enviado aqui fica guardado com o COD da venda
            e aparece também na ficha do cliente no Apolo.
          </p>
        ) : (
          grupos.map((g) => (
            <section key={g.codigo ?? "sem"} style={{ display: "grid", gap: 6 }}>
              {/* ⚠️ O COD É O TÍTULO DO GRUPO. Um lote passa por várias vendas, e o documento de
                  quem desistiu não pode parecer do comprador atual. */}
              <div style={{ alignItems: "baseline", display: "flex", gap: 8 }}>
                <b
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 11.5,
                    letterSpacing: 0.4,
                  }}
                >
                  {g.codigo ?? "Sem protocolo"}
                </b>
                <span style={{ color: T.muted, fontSize: 11 }}>
                  {g.documentos.length} {g.documentos.length === 1 ? "documento" : "documentos"}
                </span>
              </div>

              {g.documentos.map((d) => {
                const doSistema = GERADO_PELO_SISTEMA.has(d.tipo);
                const tamanho = tamanhoEscrito(d.tamanho_bytes);
                return (
                  <button
                    key={d.id}
                    onClick={() => void abrir(d.id)}
                    style={{
                      background: T.card,
                      border: `1px solid ${T.border}`,
                      borderRadius: 9,
                      color: T.text,
                      cursor: "pointer",
                      display: "grid",
                      font: "inherit",
                      gap: 2,
                      padding: "8px 10px",
                      textAlign: "left",
                    }}
                    type="button"
                  >
                    <div style={{ alignItems: "baseline", display: "flex", gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{d.nome}</span>
                      {/* O que o sistema gerou vale como prova; o que alguém subiu, não. */}
                      {doSistema ? (
                        <span
                          style={{
                            background: T.okBg,
                            borderRadius: 999,
                            color: T.ok,
                            fontSize: 9.5,
                            fontWeight: 700,
                            letterSpacing: 0.3,
                            padding: "1px 7px",
                            textTransform: "uppercase",
                          }}
                        >
                          {NOME_DO_TIPO_DE_DOCUMENTO[d.tipo as TipoDeDocumento] ?? d.tipo}
                        </span>
                      ) : null}
                    </div>
                    <span style={{ color: T.muted, fontSize: 11 }}>
                      {[quando(d.criado_em), d.enviado_por_nome, tamanho].filter(Boolean).join(" · ")}
                    </span>
                    {d.observacao ? (
                      <span style={{ color: T.sub, fontSize: 11.5 }}>{d.observacao}</span>
                    ) : null}
                  </button>
                );
              })}
            </section>
          ))
        )}
      </div>

      <div style={{ borderTop: `1px solid ${T.border}`, display: "grid", gap: 6, paddingTop: 10 }}>
        {erro ? <span style={{ color: T.danger, fontSize: 11.5 }}>{erro}</span> : null}
        <input
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) void enviar(arquivo);
          }}
          ref={campo}
          style={{ display: "none" }}
          type="file"
        />
        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <span style={{ color: T.muted, fontSize: 11, marginRight: "auto" }}>
            PDF, imagem, Word ou Excel, até {TAMANHO_MAXIMO_ESCRITO}.
          </span>
          <button
            disabled={enviando}
            onClick={() => campo.current?.click()}
            style={{
              background: enviando ? T.soft : T.btnBg,
              border: `1px solid ${enviando ? T.border : "transparent"}`,
              borderRadius: 9,
              color: enviando ? T.muted : T.btnFg,
              cursor: enviando ? "default" : "pointer",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 650,
              padding: "7px 16px",
            }}
            type="button"
          >
            {enviando ? "Enviando…" : "Enviar documento"}
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
