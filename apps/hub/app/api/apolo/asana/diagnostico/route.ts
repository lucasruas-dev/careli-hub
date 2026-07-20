import { NextResponse } from "next/server";

import { asanaConfigurado, escanearCads } from "@/lib/apolo/asana-import";
import { classificarCad, type VereditoCad } from "@/lib/apolo/cad-diagnostico";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// DIAGNÓSTICO das CADs importadas — CUSTO ZERO e NÃO altera cadastro nenhum.
//
// Responde a pergunta que só o Asana sabe: de quem é cada ficha? O formulário separa
// proponente de cônjuge; o documento lido diz apenas os DADOS de quem foi lido. Quando a
// leitura pegou o documento do cônjuge (o primeiro do PDF do casal), a ficha nasceu com a
// identidade da pessoa errada — e ninguém consegue perceber isso olhando só o Apolo.
//
// O resultado é gravado em `apolo_audit_events` (action = 'diagnostico_cad'), NÃO no cadastro:
// diagnóstico é leitura, correção é outro passo, com confirmação. Gravar em audit permite
// conferir os 392 por SQL antes de mexer em um dado sequer.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Casado (2) e União Estável (6) — ids do C2X.
const ESTADOS_CASADO = new Set(["2", "6"]);

// O veredito vira o `status` da auditoria, que tem CHECK ('mapped','pending','blocked').
const STATUS_POR_VEREDITO: Record<VereditoCad, string> = {
  conferir: "pending",
  falta_conjuge: "pending",
  ok: "mapped",
  trocado: "blocked",
};

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json(
      { error: "ASANA_ACCESS_TOKEN nao configurado neste ambiente." },
      { status: 503 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    empreendimento?: string | null;
    secoes?: string[];
  };
  const empreendimento = body.empreendimento?.trim() || "Vale do Ouro";
  const secoes = body.secoes?.length ? body.secoes : ["Finalizado", "Em Cadastro"];

  try {
    const { cads } = await escanearCads({ empreendimento, secoes });

    // gid da task -> entidade criada.
    const gids = cads.map((c) => c.gid);
    const entidadePorGid = new Map<string, string>();
    for (let i = 0; i < gids.length; i += 200) {
      const { data } = await client
        .from("apolo_source_links")
        .select("source_id, entity_id")
        .eq("source_system", "asana")
        .eq("source_table", "cad_task")
        .in("source_id", gids.slice(i, i + 200));
      for (const l of (data ?? []) as { entity_id: string; source_id: string }[]) {
        entidadePorGid.set(l.source_id, l.entity_id);
      }
    }

    const entityIds = [...new Set(entidadePorGid.values())];
    if (entityIds.length === 0) {
      return NextResponse.json({ data: { cads: cads.length, semVinculo: cads.length } });
    }

    // Nome atual no Apolo + estado civil da ficha + cônjuge já registrado.
    const nomePorEntidade = new Map<string, string>();
    const tipoPorEntidade = new Map<string, string>();
    const casadoPorEntidade = new Map<string, boolean>();
    const conjugePorEntidade = new Map<string, string>();

    for (let i = 0; i < entityIds.length; i += 200) {
      const bloco = entityIds.slice(i, i + 200);
      const [{ data: entidades }, { data: esteiras }, { data: relacoes }] = await Promise.all([
        client
          .from("apolo_entities")
          .select("id, display_name, legal_name, entity_kind")
          .in("id", bloco),
        client.from("apolo_esteira").select("entity_id, ficha").in("entity_id", bloco),
        client
          .from("apolo_relationships")
          .select("entity_id, label")
          .eq("relationship_type", "conjuge")
          .in("entity_id", bloco),
      ]);

      for (const e of (entidades ?? []) as {
        display_name: string;
        entity_kind: string;
        id: string;
        legal_name: string | null;
      }[]) {
        nomePorEntidade.set(e.id, e.legal_name || e.display_name);
        tipoPorEntidade.set(e.id, e.entity_kind);
      }
      for (const s of (esteiras ?? []) as {
        entity_id: string;
        ficha: Record<string, unknown> | null;
      }[]) {
        casadoPorEntidade.set(
          s.entity_id,
          ESTADOS_CASADO.has(String(s.ficha?.estadoCivilId ?? "")),
        );
      }
      for (const r of (relacoes ?? []) as { entity_id: string; label: string | null }[]) {
        if (r.label?.trim()) conjugePorEntidade.set(r.entity_id, r.label.trim());
      }
    }

    // Classifica e monta as linhas de auditoria.
    const resumo: Record<VereditoCad, number> = {
      conferir: 0,
      falta_conjuge: 0,
      ok: 0,
      trocado: 0,
    };
    const linhas: Record<string, unknown>[] = [];
    // O Asana diz PF ou PJ no campo "Perfil" (custom field, com a descrição de reforço). A JFL
    // entrou como pessoa física com o CPF do representante porque isso nunca era conferido.
    let tipoDivergente = 0;

    for (const cad of cads) {
      const entityId = entidadePorGid.get(cad.gid);
      if (!entityId) continue;

      const tituloApolo = nomePorEntidade.get(entityId) ?? "";
      const diag = classificarCad({
        casado: casadoPorEntidade.get(entityId) ?? false,
        conjugeAsana: cad.conjuge?.nome ?? null,
        conjugeRegistrado: conjugePorEntidade.get(entityId) ?? null,
        proponenteAsana: cad.nomeProponente || cad.nome || null,
        tituloApolo,
      });

      // "Pessoa Jurídica" -> pj. Qualquer outra coisa (ou vazio) fica como pf.
      const perfil = (cad.perfilAsana ?? "").toLowerCase();
      const tipoNoAsana = perfil.includes("jurid") ? "pj" : perfil.includes("fisic") ? "pf" : null;
      const tipoNoApolo = tipoPorEntidade.get(entityId) ?? null;
      const divergeTipo = Boolean(tipoNoAsana && tipoNoApolo && tipoNoAsana !== tipoNoApolo);
      if (divergeTipo) tipoDivergente += 1;

      resumo[diag.veredito] += 1;
      linhas.push({
        action: "diagnostico_cad",
        actor_user_id: /^[0-9a-f-]{36}$/i.test(auth.userId) ? auth.userId : null,
        entity_id: entityId,
        field_name: "identidade",
        metadata: {
          conjugeAsana: cad.conjuge?.nome ?? null,
          conjugeRegistrado: conjugePorEntidade.get(entityId) ?? null,
          detalhe: diag.detalhe,
          gid: cad.gid,
          divergeTipo,
          perfilAsana: cad.perfilAsana ?? null,
          proponenteAsana: cad.nomeProponente || cad.nome || null,
          tipoNoApolo,
          tipoNoAsana,
          similaridade: Number(diag.similaridade.toFixed(3)),
          tituloApolo,
          veredito: diag.veredito,
        },
        status: STATUS_POR_VEREDITO[diag.veredito],
      });
    }

    // Insere em lotes. `insert` puro (nunca upsert): id é gerado pelo banco e cada rodada é um
    // retrato novo — o histórico de diagnósticos é justamente o que mostra o que mudou.
    let gravadas = 0;
    for (let i = 0; i < linhas.length; i += 100) {
      const { error } = await client
        .from("apolo_audit_events")
        .insert(linhas.slice(i, i + 100));
      if (!error) gravadas += Math.min(100, linhas.length - i);
    }

    return NextResponse.json({
      data: {
        analisadas: linhas.length,
        cads: cads.length,
        gravadas,
        resumo,
        semVinculo: cads.length - linhas.length,
        tipoDivergente,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
