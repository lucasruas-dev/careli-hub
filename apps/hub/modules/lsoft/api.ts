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
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

export type CarteiraCarregada = { clientes: ClienteDaCarteira[]; resumo: ResumoDaCarteira };
export type FichaCarregada = { cadastro: CadastroDoCliente; parcelas: ParcelaDaCarteira[] };
export type Gravacao = { alterados?: number; erro?: string; ok: boolean };

export type ApiDoLsoft = {
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
};

const json = async (resposta: Response) =>
  (await resposta.json().catch(() => null)) as null | { data?: unknown; error?: string };

// ── A TELA INTERNA (/lsoft) ─────────────────────────────────────────────────
export const apiInterna: ApiDoLsoft = {
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
};

// ── O PORTAL DO INCORPORADOR (CER) ──────────────────────────────────────────
//
// ⚠️ SEM TOKEN NO CABEÇALHO: o portal se autentica por cookie httpOnly, que o navegador manda
// sozinho. E SEM ENRIQUECIMENTO: quem gasta com a MOST é a Careli, não o cliente.
export const apiDoPortal: ApiDoLsoft = {
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
};
