// RELATÓRIO diário por imobiliária: a performance dos clientes DELA num empreendimento.
//
// Escopo pelo vínculo "Imobiliaria da CAD" (entidade). Só STATUS — nunca o valor da análise de
// crédito. Junta 3 fontes: a esteira do Apolo (etapas + PIX), o Asana (Duplicadas e CADs
// Incorretas, com o "Motivo da reprovação"), e apolo_disparos (erros do envio do PIX).
import type { SupabaseClient } from "@supabase/supabase-js";

import { asanaConfigurado, escanearCads } from "@/lib/apolo/asana-import";
import { contatoDaEntidadeImobiliaria } from "@/lib/apolo/disparo-imobiliaria";
import { imobiliariaEntityIdEmLote } from "@/lib/apolo/imobiliaria-do-cliente";
import { toTitleCase } from "@/lib/format/name-case";

export type CredenciadoItem = { cliente: string; corretor: string; pix: string };
export type IncorretaItem = { cliente: string; motivo: string };
export type ErroDisparoItem = { cliente: string; erro: string };

export type RelatorioImob = {
  analiseCredito: string[];
  contato: { email: string | null; telefone: string | null };
  credenciados: CredenciadoItem[];
  duplicadas: string[];
  errosDisparo: ErroDisparoItem[];
  imobEntityId: string;
  imobNome: string;
  incorretas: IncorretaItem[];
  revisao: string[];
  totalCads: number;
  validacao: string[];
  valorPago: number;
};

function normalizar(v: string | null | undefined): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// PIX pago mostra só a DATA (pedido do Lucas), sem hora.
function pixStatus(pagoEm: string | null, temCobranca: boolean): string {
  if (pagoEm) {
    return `Pago ${new Date(pagoEm).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "America/Sao_Paulo",
    })}`;
  }
  return temCobranca ? "Enviado" : "—";
}

// Traduz o erro do disparo do PIX para a imobiliária (o que fazer), sem jargão.
function traduzErroPix(erro: string | null): string {
  const e = (erro ?? "").toLowerCase();
  if (/undeliverable|131026|133010|not registered/.test(e))
    return "WhatsApp: o número não tem WhatsApp — recebeu só por e-mail";
  if (/fora do padrão|invalid.*phone|131009/.test(e))
    return "WhatsApp: o telefone não é um celular válido — recebeu só por e-mail";
  if (/sem telefone/.test(e)) return "sem telefone no cadastro";
  if (/sem e-mail/.test(e)) return "sem e-mail no cadastro";
  if (/mailbox|550|invalid.*recipient|400/.test(e)) return "E-mail inválido (erro de digitação)";
  return "falha no envio";
}

// Refugo do Asana (Duplicadas e CADs Incorretas) por nome-texto de imobiliária. Uma chamada ao
// Asana por empreendimento; só roda em ambiente com o token (produção).
async function carregarRefugoAsana(empreendimento: string): Promise<
  Map<string, { duplicadas: string[]; incorretas: IncorretaItem[] }>
> {
  const mapa = new Map<string, { duplicadas: string[]; incorretas: IncorretaItem[] }>();
  if (!asanaConfigurado()) return mapa;

  let cads: Awaited<ReturnType<typeof escanearCads>>["cads"] = [];
  try {
    const r = await escanearCads({ empreendimento, secoes: [] });
    cads = r.cads;
  } catch {
    return mapa;
  }

  const motivoDaCad = (cad: (typeof cads)[number]): string => {
    const campo = (cad.customFields ?? []).find((c) => {
      const n = normalizar(c.name);
      return n.includes("motivo") && (n.includes("reprov") || n.includes("recus"));
    });
    return (campo?.display_value ?? "").trim() || "Não informado";
  };

  for (const cad of cads) {
    const secao = normalizar(cad.secao);
    const ehDup = secao.includes("duplic");
    const ehInc = secao.includes("incorret");
    if (!ehDup && !ehInc) continue;

    const chave = normalizar(cad.imobiliaria);
    if (!chave) continue;
    const g = mapa.get(chave) ?? { duplicadas: [], incorretas: [] };
    const nome = toTitleCase(cad.nomeProponente || cad.nome) || "Sem nome";
    if (ehDup) g.duplicadas.push(nome);
    else g.incorretas.push({ cliente: nome, motivo: motivoDaCad(cad) });
    mapa.set(chave, g);
  }
  return mapa;
}

export async function montarRelatoriosDoEmpreendimento(
  client: SupabaseClient,
  empreendimento: string,
): Promise<RelatorioImob[]> {
  const alvo = empreendimento.trim();
  if (!alvo) return [];

  // 1) Esteira do empreendimento.
  // Já filtrado por empreendimento (texto): cada linha é uma CAD deste lançamento, que é
  // exatamente o que o relatório da imobiliária conta. Uma pessoa com CAD em outro loteamento não
  // entra aqui — e não deve entrar.
  const { data: esteira } = await client
    .from("apolo_esteira")
    .select("entity_id, etapa, corretor, pago_em, pagamento_ref, imobiliaria")
    .ilike("empreendimento", `%${alvo}%`);
  const fichas = (esteira ?? []) as Array<{
    corretor: string | null;
    entity_id: string;
    etapa: string | null;
    imobiliaria: string | null;
    pagamento_ref: string | null;
    pago_em: string | null;
  }>;
  if (fichas.length === 0) return [];
  const ids = fichas.map((f) => f.entity_id);

  // 2) Vínculo por ENTIDADE -> imobiliária de cada ficha. Reconhece qualquer tipo de vínculo de
  // imobiliária (o "imobiliaria" novo, o "Imobiliaria da CAD" legado, etc.), o mais recente vence.
  const imobPorCliente = await imobiliariaEntityIdEmLote(client, ids);

  // 2b) FALLBACK pelo TEXTO da esteira -> entidade (apolo_imobiliaria_match). A maioria das CADs em
  // revisão só tem a imobiliária como texto de apelido ("mais lotes", "rr solucoes"), sem vínculo
  // por entidade — sem isto elas somem do relatório. Só preenche quem ainda não tem vínculo.
  {
    const { data: matches } = await client
      .from("apolo_imobiliaria_match")
      .select("nome_normalizado, entity_id")
      .not("entity_id", "is", null);
    const porTexto = new Map<string, string>();
    for (const m of (matches ?? []) as { entity_id: string; nome_normalizado: string }[]) {
      porTexto.set(m.nome_normalizado, m.entity_id);
    }
    for (const f of fichas) {
      if (imobPorCliente.has(f.entity_id)) continue;
      const ent = porTexto.get(normalizar(f.imobiliaria));
      if (ent) imobPorCliente.set(f.entity_id, ent);
    }
  }

  // 3) Nomes dos clientes.
  const nomeCliente = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await client
      .from("apolo_entities")
      .select("id, display_name, legal_name")
      .in("id", ids.slice(i, i + 300));
    for (const e of (data ?? []) as Array<{
      display_name: string | null;
      id: string;
      legal_name: string | null;
    }>) {
      nomeCliente.set(e.id, toTitleCase(e.legal_name || e.display_name) || "Sem nome");
    }
  }

  // 4) Erros do envio do PIX (por cliente), da cobrança de pré-venda.
  const errosPorCliente = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await client
      .from("apolo_disparos")
      .select("entity_id, erro")
      .eq("tipo", "prevenda_cobranca")
      .eq("status", "falhou")
      .in("entity_id", ids.slice(i, i + 300));
    for (const d of (data ?? []) as { entity_id: string | null; erro: string | null }[]) {
      if (d.entity_id && !errosPorCliente.has(d.entity_id)) {
        errosPorCliente.set(d.entity_id, traduzErroPix(d.erro));
      }
    }
  }

  // 5) Refugo do Asana (duplicadas/incorretas) por nome-texto de imobiliária.
  const refugo = await carregarRefugoAsana(alvo);

  // 6) Quais nomes-texto (de-para) apontam para cada imobiliária-entidade.
  const nomesPorImob = new Map<string, string[]>();
  const { data: matches } = await client
    .from("apolo_imobiliaria_match")
    .select("nome_normalizado, entity_id")
    .not("entity_id", "is", null);
  for (const m of (matches ?? []) as { entity_id: string; nome_normalizado: string }[]) {
    const arr = nomesPorImob.get(m.entity_id) ?? [];
    arr.push(m.nome_normalizado);
    nomesPorImob.set(m.entity_id, arr);
  }

  // 7) Agrupa a esteira por imobiliária.
  type Acc = Omit<RelatorioImob, "contato" | "imobEntityId" | "imobNome" | "totalCads">;
  const porImob = new Map<string, Acc>();
  const novo = (): Acc => ({
    analiseCredito: [],
    credenciados: [],
    duplicadas: [],
    errosDisparo: [],
    incorretas: [],
    revisao: [],
    validacao: [],
    valorPago: 0,
  });

  for (const f of fichas) {
    const imob = imobPorCliente.get(f.entity_id);
    if (!imob) continue;
    const acc = porImob.get(imob) ?? novo();
    const nome = nomeCliente.get(f.entity_id) ?? "Sem nome";
    const corretor = toTitleCase(f.corretor) || "—";
    const etapa = f.etapa ?? "validacao";

    if (etapa === "credenciado") {
      acc.credenciados.push({ cliente: nome, corretor, pix: pixStatus(f.pago_em, Boolean(f.pagamento_ref)) });
      if (f.pago_em) acc.valorPago += 1000;
    } else if (etapa === "revisao") acc.revisao.push(nome);
    else if (etapa === "credito") acc.analiseCredito.push(nome);
    else acc.validacao.push(nome);

    const erro = errosPorCliente.get(f.entity_id);
    if (erro) acc.errosDisparo.push({ cliente: nome, erro });

    porImob.set(imob, acc);
  }

  // 8) Anexa o refugo do Asana e resolve contato/nome DIRETO da entidade.
  const ordenar = (a: string, b: string) => a.localeCompare(b);
  const relatorios: RelatorioImob[] = [];
  for (const [imob, acc] of porImob) {
    for (const chave of nomesPorImob.get(imob) ?? []) {
      const r = refugo.get(chave);
      if (r) {
        acc.duplicadas.push(...r.duplicadas);
        acc.incorretas.push(...r.incorretas);
      }
    }
    acc.credenciados.sort((a, b) => ordenar(a.cliente, b.cliente));
    acc.revisao.sort(ordenar);
    acc.validacao.sort(ordenar);
    acc.analiseCredito.sort(ordenar);
    acc.duplicadas.sort(ordenar);
    acc.incorretas.sort((a, b) => ordenar(a.cliente, b.cliente));
    acc.errosDisparo.sort((a, b) => ordenar(a.cliente, b.cliente));

    const contato = await contatoDaEntidadeImobiliaria(client, imob);
    const totalCads =
      acc.credenciados.length +
      acc.revisao.length +
      acc.validacao.length +
      acc.analiseCredito.length +
      acc.duplicadas.length +
      acc.incorretas.length;

    relatorios.push({
      ...acc,
      contato: { email: contato.email, telefone: contato.telefone },
      imobEntityId: imob,
      imobNome: contato.nome,
      totalCads,
    });
  }
  return relatorios;
}
