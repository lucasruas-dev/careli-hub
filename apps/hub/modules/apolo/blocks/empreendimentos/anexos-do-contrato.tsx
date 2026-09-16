"use client";

import { FileText, ImageIcon, Loader2, Power, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AnexoDoContrato,
  LIMITE_ANEXO_BYTES,
  LIMITE_ANEXO_ROTULO,
  POSICAO_MAXIMA,
  rotuloDoAlcance,
  TIPO_DO_ANEXO,
  TIPOS_DA_CAPA,
} from "@/lib/temis/anexos";
import { useApiDaTemis } from "@/modules/temis/api-da-temis";

// OS ANEXOS DO CONTRATO — os PDFs prontos que entram no documento montado.
//
// Lucas (13/09/2026): *"muita peça do contrato são PDF prontos"* (07/09) e, ao ver que não havia
// onde subir, *"tem que fazer o upload hoje / estamos montando os contratos hoje"*.
//
// ⚠️ A POSIÇÃO É ESCOLHIDA AQUI, E ESSA É A DECISÃO CENTRAL DA TELA. Ela não vem da ordem de
// upload: a minuta cita `[anexo_2]`, e se anexar uma peça nova empurrasse as outras, toda minuta já
// publicada passaria a imprimir a peça errada — sem erro, sem log e sem ninguém perceber. Por isso
// o campo de posição é obrigatório e vem antes do arquivo na leitura da linha.
//
// ⚠️ E A POSIÇÃO PODE SE REPETIR ENTRE NÍVEIS, de propósito. Unidade vence categoria, que vence
// empreendimento — é o que permite "planta é do lote, convenção é de todos" sem cadastrar a
// convenção 400 vezes. O banco só impede repetir DENTRO do mesmo nível.

type Props = {
  /** O empreendimento é o alcance padrão desta tela; categoria e unidade entram pela lista. */
  enterpriseId: string;
};

const RASCUNHO_VAZIO = { nome: "", posicao: "" };

function tamanhoLegivel(bytes: null | number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AnexosDoContrato({ enterpriseId }: Props) {
  const [anexos, setAnexos] = useState<AnexoDoContrato[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [enviando, setEnviando] = useState(false);
  const [rascunho, setRascunho] = useState(RASCUNHO_VAZIO);
  const [recarregar, setRecarregar] = useState(0);
  const campoDeArquivo = useRef<HTMLInputElement>(null);
  // Sem provedor, `/api/temis` com o Bearer do hub (o Apolo e a Têmis de sempre); nas minutas do
  // portal que confecciona, `/api/incorporador/temis` com o cookie. Ver `api-da-temis.tsx`.
  const { temisFetch } = useApiDaTemis();

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await temisFetch(
        `/anexos?enterpriseId=${encodeURIComponent(enterpriseId)}`,
        { cache: "no-store" },
      );
      const corpo = (await r.json()) as { anexos?: AnexoDoContrato[]; error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao ler os anexos.");
      setAnexos(corpo.anexos ?? []);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ler os anexos.");
    } finally {
      setCarregando(false);
    }
  }, [enterpriseId, temisFetch]);

  useEffect(() => {
    void carregar();
  }, [carregar, recarregar]);

  /**
   * O envio em três passos, o mesmo caminho da mídia do editor e do documento grande do CAD.
   *
   * ⚠️ O ARQUIVO NÃO PASSA PELO SERVIDOR. Ele vai direto do navegador para o Storage por URL
   * assinada; um PDF de 20MB atravessando a função serverless estoura o limite de corpo da Vercel.
   * A rota só assina o caminho (passo 1) e grava o registro depois que o objeto já existe (passo 3).
   */
  const enviar = async (arquivo: File) => {
    const posicao = Number(rascunho.posicao);
    if (!Number.isInteger(posicao) || posicao < 1 || posicao > POSICAO_MAXIMA) {
      setErro(`A posição vai de 1 a ${POSICAO_MAXIMA}, e é ela que o texto cita como [anexo_N].`);
      return;
    }
    if (!rascunho.nome.trim()) {
      setErro("Dê um nome ao anexo: ele vira o título da linha no contrato.");
      return;
    }
    if (arquivo.size > LIMITE_ANEXO_BYTES) {
      setErro(`O arquivo passa de ${LIMITE_ANEXO_ROTULO}.`);
      return;
    }

    setEnviando(true);
    setErro(null);
    try {
      const cabecalho = { "Content-Type": "application/json" };

      // 1. a URL assinada
      const assinar = await temisFetch("/anexos", {
        body: JSON.stringify({
          acao: "upload",
          contentType: arquivo.type,
          enterpriseId,
          fileName: arquivo.name,
          size: arquivo.size,
        }),
        headers: cabecalho,
        method: "POST",
      });
      const dadosDaUrl = (await assinar.json()) as {
        bucket?: string;
        error?: string;
        path?: string;
        token?: string;
      };
      if (!assinar.ok || !dadosDaUrl.path || !dadosDaUrl.token) {
        throw new Error(dadosDaUrl.error ?? "Não foi possível preparar o envio.");
      }

      // 2. o arquivo, direto para o Storage
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      );
      const subida = await supabase.storage
        .from(dadosDaUrl.bucket ?? "apolo-documents")
        .uploadToSignedUrl(dadosDaUrl.path, dadosDaUrl.token, arquivo);
      if (subida.error) throw new Error("Falha ao enviar o arquivo.");

      // 3. o registro
      const confirmar = await temisFetch("/anexos", {
        body: JSON.stringify({
          acao: "confirmar",
          enterpriseId,
          nome: rascunho.nome.trim(),
          path: dadosDaUrl.path,
          posicao,
        }),
        headers: cabecalho,
        method: "POST",
      });
      const confirmado = (await confirmar.json()) as { error?: string };
      if (!confirmar.ok) throw new Error(confirmado.error ?? "Não foi possível gravar o anexo.");

      setRascunho(RASCUNHO_VAZIO);
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar o anexo.");
    } finally {
      setEnviando(false);
      if (campoDeArquivo.current) campoDeArquivo.current.value = "";
    }
  };

  const desativar = async (id: string) => {
    try {
      const r = await temisFetch(`/anexos?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const corpo = (await r.json()) as { error?: string };
        throw new Error(corpo.error ?? "Não foi possível desativar.");
      }
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao desativar o anexo.");
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
        <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
        <div>
          <h3 className="m-0 font-semibold text-ink text-sm">Anexos do contrato</h3>
          <p className="m-0 text-ink-muted text-xs">
            PDFs prontos que entram no contrato montado. Na minuta, a posição é citada como{" "}
            <code className="rounded bg-subtle px-1">[anexo_1]</code>, e o nome sai sozinho em{" "}
            <code className="rounded bg-subtle px-1">[anexo_1_nome]</code>.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="font-medium text-ink-muted text-xs">Posição</span>
          <input
            className="h-9 w-20 rounded-lg border border-line bg-surface px-2 text-ink text-sm"
            inputMode="numeric"
            onChange={(e) => setRascunho((r) => ({ ...r, posicao: e.target.value }))}
            placeholder="1"
            value={rascunho.posicao}
          />
        </label>

        <label className="flex min-w-[240px] flex-1 flex-col gap-1">
          <span className="font-medium text-ink-muted text-xs">
            Nome do anexo (sai escrito no contrato)
          </span>
          <input
            className="h-9 rounded-lg border border-line bg-surface px-2 text-ink text-sm"
            onChange={(e) => setRascunho((r) => ({ ...r, nome: e.target.value }))}
            placeholder="Convenção de condomínio"
            value={rascunho.nome}
          />
        </label>

        <input
          accept={TIPO_DO_ANEXO}
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) void enviar(arquivo);
          }}
          ref={campoDeArquivo}
          type="file"
        />
        <button
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-subtle px-4 font-semibold text-ink text-sm transition-colors hover:bg-subtle/70 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={enviando}
          onClick={() => campoDeArquivo.current?.click()}
          type="button"
        >
          {enviando ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Upload aria-hidden="true" className="size-4" />
          )}
          {enviando ? "Enviando…" : "Escolher PDF"}
        </button>
      </div>

      {erro ? (
        <p className="m-0 border-b border-line bg-rose-50 px-4 py-2 text-rose-900 text-xs dark:bg-rose-500/10 dark:text-rose-200">
          {erro}
        </p>
      ) : null}

      {carregando ? (
        <p className="m-0 px-4 py-4 text-ink-muted text-sm">Lendo os anexos…</p>
      ) : anexos.length === 0 ? (
        <p className="m-0 px-4 py-4 text-ink-muted text-sm">
          Nenhum anexo ainda. Enquanto não houver, a minuta não tem o que citar em{" "}
          <code className="rounded bg-subtle px-1">[anexo_1]</code>.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {anexos.map((anexo) => (
            <li
              className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
              key={anexo.id}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-subtle font-semibold text-ink text-xs">
                {anexo.posicao}
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate font-medium text-ink text-sm">{anexo.nome}</p>
                <p className="m-0 truncate text-ink-muted text-xs">
                  {rotuloDoAlcance(anexo)} · {anexo.arquivoNome}
                  {tamanhoLegivel(anexo.arquivoBytes)
                    ? ` · ${tamanhoLegivel(anexo.arquivoBytes)}`
                    : ""}
                </p>
              </div>
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-ink-muted text-xs transition-colors hover:bg-subtle"
                onClick={() => void desativar(anexo.id)}
                title="Desativa o anexo. O arquivo continua guardado, para os contratos que já o citam."
                type="button"
              >
                <Power aria-hidden="true" className="size-3.5" />
                Desativar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── A CAPA ──────────────────────────────────────────────────────────────────
//
// ⚠️ A CAPA É DA MINUTA, E OS ANEXOS SÃO DO EMPREENDIMENTO. Não é detalhe de arrumação: a capa
// carrega o título e a identidade daquele contrato, e duas minutas do mesmo loteamento têm capas
// diferentes. Por isso `capa_path` é coluna de `temis_minutas` (0156), e não linha em `temis_anexos`.
//
// Lucas (07/09/2026): *"estamos fazendo nossas capas no canvas"* — ela é desenhada fora e entra
// pronta, como PDF ou imagem.
export function CapaDaMinuta({
  minutaId,
  nomeInicial,
  temCapaInicial,
}: {
  minutaId: string;
  nomeInicial: null | string;
  temCapaInicial: boolean;
}) {
  const [nome, setNome] = useState<null | string>(nomeInicial);
  const [temCapa, setTemCapa] = useState(temCapaInicial);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  const campo = useRef<HTMLInputElement>(null);
  const { temisFetch } = useApiDaTemis();

  const enviar = async (arquivo: File) => {
    if (arquivo.size > LIMITE_ANEXO_BYTES) {
      setErro(`O arquivo passa de ${LIMITE_ANEXO_ROTULO}.`);
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const cabecalho = { "Content-Type": "application/json" };

      // ⚠️ O ALCANCE VAI COMO `enterpriseId` MESMO SENDO CAPA: a rota usa o alcance só para montar a
      // pasta do objeto, e o `capa: true` é o que troca o prefixo e a lista de tipos aceitos.
      const assinar = await temisFetch("/anexos", {
        body: JSON.stringify({
          acao: "upload",
          capa: true,
          contentType: arquivo.type,
          enterpriseId: minutaId,
          fileName: arquivo.name,
          size: arquivo.size,
        }),
        headers: cabecalho,
        method: "POST",
      });
      const dados = (await assinar.json()) as {
        bucket?: string;
        error?: string;
        path?: string;
        token?: string;
      };
      if (!assinar.ok || !dados.path || !dados.token) {
        throw new Error(dados.error ?? "Não foi possível preparar o envio.");
      }

      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      );
      const subida = await supabase.storage
        .from(dados.bucket ?? "apolo-documents")
        .uploadToSignedUrl(dados.path, dados.token, arquivo);
      if (subida.error) throw new Error("Falha ao enviar a capa.");

      const gravar = await temisFetch("/anexos", {
        body: JSON.stringify({
          acao: "capa",
          minutaId,
          nome: arquivo.name,
          path: dados.path,
        }),
        headers: cabecalho,
        method: "POST",
      });
      const gravado = (await gravar.json()) as { error?: string };
      if (!gravar.ok) throw new Error(gravado.error ?? "Não foi possível gravar a capa.");

      setNome(arquivo.name);
      setTemCapa(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar a capa.");
    } finally {
      setEnviando(false);
      if (campo.current) campo.current.value = "";
    }
  };

  const tirar = async () => {
    setEnviando(true);
    try {
      const r = await temisFetch("/anexos", {
        body: JSON.stringify({ acao: "capa", minutaId, path: "" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!r.ok) throw new Error("Não foi possível tirar a capa.");
      setNome(null);
      setTemCapa(false);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao tirar a capa.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-subtle/30 px-3 py-2.5">
      <ImageIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
      <div className="min-w-0 flex-1">
        <p className="m-0 font-medium text-ink text-xs">Capa do contrato</p>
        <p className="m-0 truncate text-ink-muted text-xs">
          {temCapa ? nome : "Nenhuma capa nesta minuta — o contrato sai direto no corpo."}
        </p>
      </div>

      <input
        accept={TIPOS_DA_CAPA.join(",")}
        className="hidden"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          if (arquivo) void enviar(arquivo);
        }}
        ref={campo}
        type="file"
      />
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 font-semibold text-ink text-xs transition-colors hover:bg-subtle disabled:opacity-40"
        disabled={enviando}
        onClick={() => campo.current?.click()}
        type="button"
      >
        {enviando ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <Upload aria-hidden="true" className="size-3.5" />
        )}
        {temCapa ? "Trocar" : "Enviar capa"}
      </button>
      {temCapa ? (
        <button
          className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-ink-muted text-xs transition-colors hover:bg-subtle disabled:opacity-40"
          disabled={enviando}
          onClick={() => void tirar()}
          type="button"
        >
          Tirar
        </button>
      ) : null}

      {erro ? <p className="m-0 w-full text-rose-700 text-xs dark:text-rose-300">{erro}</p> : null}
    </div>
  );
}
