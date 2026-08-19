"use client";

import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { ApiDoLsoft } from "./api";

import {
  CATEGORIAS_SUGERIDAS,
  type DocumentoDoLsoft,
  LSOFT_DOC_MAX_BYTES,
  LSOFT_DOC_MAX_LABEL,
} from "@/lib/lsoft/documentos-tipos";

// A ABA DE DOCUMENTOS da ficha do LSoft.
//
// Pedido do Lucas (19/08/2026): "deixar aba para subir documentação".
//
// POR QUE ELA EXISTE. A base do LSoft veio de um Access sem anexo nenhum: o que existe de documento
// desses 237 clientes está em papel ou na máquina de alguém do CER. Como são eles que validam a base
// antes de ela subir para o C2X e o Apolo, o lugar de juntar o documento é a mesma ficha onde o dado
// está sendo corrigido.
//
// ⚠️ EM ARQUIVO PRÓPRIO, e não dentro do CarteiraLsoft: aquele arquivo já passa de 1.300 linhas, e
// foi exatamente num recorte grande ali que um efeito se perdeu sem o typecheck perceber.
//
// ⚠️ O ARQUIVO VAI DIRETO DO NAVEGADOR PARA O STORAGE (ver `enviarDocumento` em ./api). O servidor
// só assina a permissão de gravar um caminho; os bytes não passam por ele. Em base64 dentro do JSON
// eles estourariam o limite de 4,5MB da Vercel e voltariam como 413, sem explicação — foi o que
// aconteceu no CAD.
//
// ⚠️ A LISTA CARREGA SÓ QUANDO A ABA ABRE. Buscar documento junto da ficha custaria uma consulta a
// mais em toda ficha aberta, para mostrar o que quase ninguém olha de primeira.

/** Bytes para algo que uma pessoa lê. */
function tamanhoLegivel(bytes: null | number): null | string {
  if (bytes == null || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function DocumentosDoCliente({ api, codigo }: { api: ApiDoLsoft; codigo: string }) {
  const [documentos, setDocumentos] = useState<DocumentoDoLsoft[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<null | string>(null);
  const [categoria, setCategoria] = useState("");
  const [observacao, setObservacao] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);

  const buscar = useCallback(async () => {
    setCarregando(true);
    setDocumentos(await api.documentos.listar(codigo));
    setCarregando(false);
  }, [api, codigo]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  async function enviar() {
    if (!arquivo) return;

    // O teto também é conferido no servidor; aqui é para a pessoa não esperar um upload inteiro
    // só para ouvir "não".
    if (arquivo.size > LSOFT_DOC_MAX_BYTES) {
      setAviso(`Cada documento pode ter até ${LSOFT_DOC_MAX_LABEL}.`);
      return;
    }

    setEnviando(true);
    setAviso(null);
    try {
      const resultado = await api.documentos.enviar(codigo, arquivo, { categoria, observacao });
      if (!resultado.ok) {
        setAviso(resultado.erro ?? "Não foi possível enviar.");
        return;
      }
      setArquivo(null);
      setCategoria("");
      setObservacao("");
      await buscar();
    } finally {
      setEnviando(false);
    }
  }

  async function abrir(id: string) {
    const url = await api.documentos.abrir(codigo, id);
    if (!url) {
      setAviso("Não foi possível abrir o documento.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function remover(documento: DocumentoDoLsoft) {
    // O arquivo sai do bucket de verdade, então a pergunta é obrigatória.
    if (!window.confirm(`Remover "${documento.nomeArquivo}"? O arquivo é apagado de vez.`)) return;

    const resultado = await api.documentos.remover(codigo, documento.id);
    if (!resultado.ok) {
      setAviso(resultado.erro ?? "Não foi possível remover.");
      return;
    }
    await buscar();
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-2.5 rounded-xl border border-line bg-subtle p-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Arquivo
            </span>
            <input
              className="text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-canvas"
              onChange={(evento) => {
                setArquivo(evento.target.files?.[0] ?? null);
                setAviso(null);
              }}
              type="file"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Categoria
            </span>
            {/* Sugestão com escrita livre: o CER está organizando uma base antiga e vai aparecer
                documento que não cabe numa lista fechada. Recusar o que não está na lista faria a
                pessoa desistir de anexar, que é o oposto do que esta aba quer. */}
            <input
              className="h-9 rounded-lg border border-line bg-canvas px-2.5 text-sm text-ink"
              list="lsoft-categorias"
              onChange={(evento) => setCategoria(evento.target.value)}
              placeholder="RG, contrato…"
              value={categoria}
            />
            <datalist id="lsoft-categorias">
              {CATEGORIAS_SUGERIDAS.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>
        </div>

        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Observação
          </span>
          <input
            className="h-9 rounded-lg border border-line bg-canvas px-2.5 text-sm text-ink"
            onChange={(evento) => setObservacao(evento.target.value)}
            placeholder="Opcional"
            value={observacao}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-semibold text-canvas disabled:opacity-50"
            disabled={!arquivo || enviando}
            onClick={() => void enviar()}
            type="button"
          >
            {enviando ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
            {enviando ? "Enviando…" : "Enviar"}
          </button>
          <span className="text-[11px] text-ink-soft">Até {LSOFT_DOC_MAX_LABEL} por arquivo.</span>
        </div>

        {aviso ? <p className="m-0 text-sm text-ink-soft">{aviso}</p> : null}
      </section>

      {carregando ? (
        <div className="h-24 animate-pulse rounded-xl border border-line bg-subtle" />
      ) : documentos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/[0.12] p-8 text-center text-sm text-ink-soft dark:border-white/[0.12]">
          Nenhum documento anexado a esta ficha.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {documentos.map((documento) => (
            <li
              className="flex items-center gap-3 rounded-xl border border-line bg-subtle px-4 py-2.5"
              key={documento.id}
            >
              <FileText className="shrink-0 text-ink-soft" size={17} />

              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-sm font-semibold text-ink">
                  {documento.nomeArquivo}
                </p>
                <p className="m-0 text-[11px] text-ink-soft">
                  {[
                    documento.categoria,
                    tamanhoLegivel(documento.tamanhoBytes),
                    documento.enviadoPor,
                    new Date(documento.criadoEm).toLocaleDateString("pt-BR"),
                    // A origem distingue quem é da Careli de quem é do cliente, igual à trilha
                    // de edição do cadastro.
                    documento.enviadoOrigem === "incorporador" ? "pelo portal" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {documento.observacao ? (
                  <p className="m-0 truncate text-[11px] text-ink-soft">{documento.observacao}</p>
                ) : null}
              </div>

              {/* Ícone e não texto, como o resto da tela. O `title` carrega o rótulo. */}
              <button
                aria-label={`Abrir ${documento.nomeArquivo}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-canvas"
                onClick={() => void abrir(documento.id)}
                title="Abrir"
                type="button"
              >
                <Download size={15} />
              </button>
              <button
                aria-label={`Remover ${documento.nomeArquivo}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-canvas"
                onClick={() => void remover(documento)}
                title="Remover"
                type="button"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
