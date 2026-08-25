// DE ONDE A TELA DO LSOFT TIRA (E ONDE GRAVA) OS DADOS.
//
// Existe porque a MESMA tela roda em dois lugares com portas de entrada diferentes:
//   • `/lsoft` — time da Careli, autenticado pelo token do Apolo no cabeçalho;
//   • portal do incorporador (CER) — usuário do cliente, autenticado pelo cookie de sessão.
//
// ⚠️ SEM ISTO, A TELA SERIA DUPLICADA. São ~900 linhas de dash, ficha, parcelas e histórico; manter
// duas cópias garantiria que uma delas ficaria para trás — e a que fica para trás é justamente a
// que o cliente usa.
import type { CadastroDoCliente, ClienteDaCarteira, EdicaoDoLsoft, ParcelaDaCarteira, ResumoDaCarteira, StatusDaValidacao } from "@/lib/lsoft/carteira";
import type { DocumentoDoLsoft } from "@/lib/lsoft/documentos-tipos";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

export type CarteiraCarregada = { clientes: ClienteDaCarteira[]; resumo: ResumoDaCarteira };
export type FichaCarregada = { cadastro: CadastroDoCliente; parcelas: ParcelaDaCarteira[] };
export type Gravacao = { alterados?: number; erro?: string; ok: boolean };

export type Assinatura = { bucket: string; caminho: string; token: string };

export type ApiDeDocumentos = {
  abrir: (codigo: string, id: string) => Promise<null | string>;
  enviar: (
    codigo: string,
    arquivo: File,
    extras: { categoria: string; observacao: string },
  ) => Promise<Gravacao>;
  listar: (codigo: string) => Promise<DocumentoDoLsoft[]>;
  remover: (codigo: string, id: string) => Promise<Gravacao>;
};

export type ApiDoLsoft = {
  documentos: ApiDeDocumentos;
  /** Só o time interno enriquece: é operação que gasta dinheiro. */
  enriquecer: null | {
    rodarLote: () => Promise<null | { enriquecidos: number; falhas: number; restam: number; terminou: boolean }>;
    situacao: () => Promise<null | { custoEstimado: number; pendentes: number }>;
  };
  historico: (codigo: string) => Promise<EdicaoDoLsoft[]>;
  lerCarteira: (filtro: { busca: string; empreendimento: string }) => Promise<CarteiraCarregada | null>;
  lerFicha: (codigo: string) => Promise<FichaCarregada | null>;
  salvarCliente: (
    codigo: string,
    campos: Record<string, string>,
    status?: StatusDaValidacao,
  ) => Promise<Gravacao>;
  salvarParcela: (id: string, campos: Record<string, string>) => Promise<Gravacao>;
  /**
   * O botao de validar o subsidio da Caixa (MCMV / Vale do Sol).
   *
   * ⚠️ SO A CARELI DECIDE, por enquanto: no portal do CER isto e `null` e a tela esconde o botao.
   * A classificacao move dinheiro de lugar na visao do cliente, entao quem confirma e quem
   * conhece o contrato — o Lucas ainda nao definiu se a equipe do Cecilio entra nessa.
   */
  validarClassificacao:
    | null
    | ((parcelaId: string, decisao: "a_validar" | "confirmada" | "rejeitada") => Promise<Gravacao>);
};

const json = async (resposta: Response) =>
  (await resposta.json().catch(() => null)) as null | { data?: unknown; error?: string };

/**
 * O envio de UM documento, nas duas etapas, comum às duas portas de entrada.
 *
 * ⚠️ O ARQUIVO NÃO PASSA PELO SERVIDOR DO PANTEON. O servidor só assina a permissão de gravar um
 * caminho; os bytes vão do navegador direto para o Supabase. Em base64 dentro do JSON eles
 * estourariam o limite de 4,5MB da Vercel e voltariam como 413, sem explicação nenhuma.
 *
 * ⚠️ SE O REGISTRO FALHAR DEPOIS DO UPLOAD, o arquivo fica órfão no bucket e nenhuma ficha o mostra.
 * É o lado seguro de errar: o contrário (registrar antes de gravar) daria uma linha com botão de
 * abrir que não abre.
 */
async function enviarDocumento(input: {
  arquivo: File;
  extras: { categoria: string; observacao: string };
  preparar: (nomeArquivo: string, tamanhoBytes: number) => Promise<Assinatura | null>;
  registrar: (dados: {
    caminho: string;
    categoria: string;
    mimeType: string;
    nomeArquivo: string;
    observacao: string;
    tamanhoBytes: number;
  }) => Promise<Gravacao>;
}): Promise<Gravacao> {
  const client = getHubSupabaseClient();
  if (!client) return { erro: "Envio de arquivos indisponível agora.", ok: false };

  const assinatura = await input.preparar(input.arquivo.name, input.arquivo.size);
  if (!assinatura?.bucket || !assinatura.caminho || !assinatura.token) {
    return { erro: "Não foi possível preparar o envio.", ok: false };
  }

  const upload = await client.storage
    .from(assinatura.bucket)
    .uploadToSignedUrl(assinatura.caminho, assinatura.token, input.arquivo, {
      contentType: input.arquivo.type || "application/octet-stream",
    });

  if (upload.error) {
    return { erro: `Não foi possível enviar "${input.arquivo.name}".`, ok: false };
  }

  return input.registrar({
    caminho: assinatura.caminho,
    categoria: input.extras.categoria,
    mimeType: input.arquivo.type || "",
    nomeArquivo: input.arquivo.name,
    observacao: input.extras.observacao,
    tamanhoBytes: input.arquivo.size,
  });
}

// ── A TELA INTERNA (/lsoft) ─────────────────────────────────────────────────
export const apiInterna: ApiDoLsoft = {
  documentos: {
    async abrir(codigo, id) {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/lsoft/documentos?cliente=${encodeURIComponent(codigo)}&abrir=${encodeURIComponent(id)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const corpo = await json(r);
      return r.ok ? ((corpo?.data as { url?: string })?.url ?? null) : null;
    },

    async enviar(codigo, arquivo, extras) {
      const token = await getApoloAccessToken();
      const cabecalho = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      return enviarDocumento({
        arquivo,
        extras,
        async preparar(nomeArquivo, tamanhoBytes) {
          const r = await fetch("/api/lsoft/documentos", {
            body: JSON.stringify({ acao: "preparar", cliente: codigo, nomeArquivo, tamanhoBytes }),
            headers: cabecalho,
            method: "POST",
          });
          const corpo = await json(r);
          return r.ok ? ((corpo?.data as Assinatura) ?? null) : null;
        },
        async registrar(dados) {
          const r = await fetch("/api/lsoft/documentos", {
            body: JSON.stringify({ acao: "registrar", cliente: codigo, ...dados }),
            headers: cabecalho,
            method: "POST",
          });
          const corpo = await json(r);
          return { erro: corpo?.error, ok: r.ok };
        },
      });
    },

    async listar(codigo) {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/lsoft/documentos?cliente=${encodeURIComponent(codigo)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = await json(r);
      return ((corpo?.data as { documentos?: DocumentoDoLsoft[] })?.documentos ?? []);
    },

    async remover(codigo, id) {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/lsoft/documentos?cliente=${encodeURIComponent(codigo)}&id=${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${token}` }, method: "DELETE" },
      );
      const corpo = await json(r);
      return { erro: corpo?.error, ok: r.ok };
    },
  },

  enriquecer: {
    async rodarLote() {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/lsoft/enriquecer", {
        body: "{}",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = await json(r);
      return r.ok ? (corpo?.data as never) : null;
    },
    async situacao() {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/lsoft/enriquecer", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = await json(r);
      return r.ok ? (corpo?.data as never) : null;
    },
  },

  async historico(codigo) {
    const token = await getApoloAccessToken();
    const r = await fetch(`/api/lsoft/cliente/${codigo}`, {
      body: "{}",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      method: "POST",
    });
    const corpo = await json(r);
    return ((corpo?.data as { edicoes?: EdicaoDoLsoft[] })?.edicoes ?? []) as EdicaoDoLsoft[];
  },

  async lerCarteira({ busca, empreendimento }) {
    const token = await getApoloAccessToken();
    const parametros = new URLSearchParams();
    if (busca) parametros.set("q", busca);
    if (empreendimento) parametros.set("emp", empreendimento);
    const r = await fetch(`/api/lsoft/carteira?${parametros}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const corpo = await json(r);
    return r.ok ? ((corpo?.data as CarteiraCarregada) ?? null) : null;
  },

  async lerFicha(codigo) {
    const token = await getApoloAccessToken();
    const r = await fetch(`/api/lsoft/cliente/${codigo}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const corpo = await json(r);
    return r.ok ? ((corpo?.data as FichaCarregada) ?? null) : null;
  },

  async salvarCliente(codigo, campos, status) {
    const token = await getApoloAccessToken();
    const r = await fetch(`/api/lsoft/cliente/${codigo}`, {
      body: JSON.stringify({ campos, status }),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      method: "PATCH",
    });
    const corpo = await json(r);
    return {
      alterados: (corpo?.data as { alterados?: number })?.alterados,
      erro: corpo?.error,
      ok: r.ok,
    };
  },

  async salvarParcela(id, campos) {
    const token = await getApoloAccessToken();
    const r = await fetch(`/api/lsoft/parcela/${id}`, {
      body: JSON.stringify({ campos }),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      method: "PATCH",
    });
    const corpo = await json(r);
    return { erro: corpo?.error, ok: r.ok };
  },
  async validarClassificacao(parcelaId, decisao) {
    const token = await getApoloAccessToken();
    const r = await fetch("/api/lsoft/classificacao", {
      body: JSON.stringify({ decisao, parcelaId }),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      method: "POST",
    });
    const corpo = await json(r);
    return { erro: corpo?.error, ok: r.ok };
  },
};

// ── O PORTAL DO INCORPORADOR (CER) ──────────────────────────────────────────
//
// ⚠️ SEM TOKEN NO CABEÇALHO: o portal se autentica por cookie httpOnly, que o navegador manda
// sozinho. E SEM ENRIQUECIMENTO: quem gasta com a MOST é a Careli, não o cliente.
export const apiDoPortal: ApiDoLsoft = {
  documentos: {
    async abrir(codigo, id) {
      const r = await fetch(
        `/api/incorporador/lsoft?cliente=${encodeURIComponent(codigo)}&abrir=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const corpo = await json(r);
      return r.ok ? ((corpo?.data as { url?: string })?.url ?? null) : null;
    },

    async enviar(codigo, arquivo, extras) {
      const cabecalho = { "Content-Type": "application/json" };

      return enviarDocumento({
        arquivo,
        extras,
        async preparar(nomeArquivo, tamanhoBytes) {
          const r = await fetch("/api/incorporador/lsoft", {
            body: JSON.stringify({ acao: "preparar", cliente: codigo, nomeArquivo, tamanhoBytes }),
            headers: cabecalho,
            method: "POST",
          });
          const corpo = await json(r);
          return r.ok ? ((corpo?.data as Assinatura) ?? null) : null;
        },
        async registrar(dados) {
          const r = await fetch("/api/incorporador/lsoft", {
            body: JSON.stringify({ acao: "registrar", cliente: codigo, ...dados }),
            headers: cabecalho,
            method: "POST",
          });
          const corpo = await json(r);
          return { erro: corpo?.error, ok: r.ok };
        },
      });
    },

    async listar(codigo) {
      const r = await fetch(
        `/api/incorporador/lsoft?cliente=${encodeURIComponent(codigo)}&documentos=1`,
        { cache: "no-store" },
      );
      const corpo = await json(r);
      return ((corpo?.data as { documentos?: DocumentoDoLsoft[] })?.documentos ?? []);
    },

    async remover(codigo, id) {
      const r = await fetch(
        `/api/incorporador/lsoft?cliente=${encodeURIComponent(codigo)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const corpo = await json(r);
      return { erro: corpo?.error, ok: r.ok };
    },
  },

  enriquecer: null,

  async historico() {
    // O histórico é ferramenta de auditoria interna; no portal a aba nem aparece.
    return [];
  },

  async lerCarteira({ busca, empreendimento }) {
    const parametros = new URLSearchParams();
    if (busca) parametros.set("q", busca);
    if (empreendimento) parametros.set("emp", empreendimento);
    const r = await fetch(`/api/incorporador/lsoft?${parametros}`, { cache: "no-store" });
    const corpo = await json(r);
    return r.ok ? ((corpo?.data as CarteiraCarregada) ?? null) : null;
  },

  async lerFicha(codigo) {
    const r = await fetch(`/api/incorporador/lsoft?cliente=${encodeURIComponent(codigo)}`, {
      cache: "no-store",
    });
    const corpo = await json(r);
    return r.ok ? ((corpo?.data as FichaCarregada) ?? null) : null;
  },

  async salvarCliente(codigo, campos, status) {
    const r = await fetch("/api/incorporador/lsoft", {
      body: JSON.stringify({ acao: "cliente", campos, cliente: codigo, status }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const corpo = await json(r);
    return {
      alterados: (corpo?.data as { alterados?: number })?.alterados,
      erro: corpo?.error,
      ok: r.ok,
    };
  },

  async salvarParcela(id, campos) {
    const r = await fetch("/api/incorporador/lsoft", {
      body: JSON.stringify({ acao: "parcela", campos, parcela: id }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const corpo = await json(r);
    return { erro: corpo?.error, ok: r.ok };
  },
  // Decisao pendente do Lucas: se a equipe do Cecilio pode classificar. Ate la, so a Careli.
  validarClassificacao: null,
};
