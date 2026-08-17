import { cadastroEfetivo } from "@/lib/apolo/cadastro-efetivo";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEvolutionDirectText } from "@/lib/iris/evolution-api";

import {
  mensagemCoordenadorHabilitacao,
  mensagemCoordenadorIndeferimento,
  mensagemImobiliariaHabilitada,
  mensagemImobiliariaIndeferida,
  type EmpreendimentoHabilitado,
} from "./credenciamento-mensagens";

// DISPARO DO CREDENCIAMENTO — pelo número do RELACIONAMENTO, nunca pela Meta.
//
// Regra do Lucas (15/08/2026): *"quando for corretor, imobiliária, coordenador, sai do número do
// relacionamento; quando for para o cliente final, sai do número de atendimento"*.
//
// Não é só arrumação. Os avisos à imobiliária hoje saem pelo 4143 com template Meta
// (`disparo-imobiliaria.ts`) e falham em massa: medido em `apolo_disparos`, `imob_pix_enviado`
// falhou em **178 de 188** (95%) e `imob_credito_reprovado` em 78 de 114. Corretor e imobiliária
// não mantêm janela de 24h aberta nem existe template para cada situação. Pelo Evolution não há
// janela nem template, então o aviso simplesmente chega.

const DDI = "55";

// Telefone pronto para o gateway: só dígitos e com DDI. Devolve null quando não dá para enviar,
// em vez de mandar para um número inventado.
export function telefoneParaEnvio(bruto?: null | string): null | string {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos.length < 10) {
    return null;
  }
  // 10 ou 11 dígitos = número nacional sem DDI (o formato que o cadastro guarda).
  if (digitos.length <= 11) {
    return `${DDI}${digitos}`;
  }
  return digitos;
}

/**
 * Escolhe PARA QUEM vai a mensagem da imobiliária, na ordem de preferência.
 *
 * ⚠️ USA `||`, NUNCA `??`. As funções que resolvem telefone devolvem string VAZIA quando não
 * acham (`normalizarTelefone(undefined)` é ""), e `??` só troca null/undefined — então `"" ?? x`
 * continua "". Foi assim que 3 imobiliárias habilitadas em 16/08 receberam "sem telefone" tendo
 * celular cadastrado o tempo todo.
 *
 * A ordem existe por um motivo medido: o contato da EMPRESA é frequentemente FIXO (a LOCAR SP
 * cadastrou (31) 3852-3113) e o WhatsApp não entrega em fixo, então o representante legal vem
 * primeiro. Mas as fichas vindas do C2X não têm `socios[]`, e para elas o contato da empresa é
 * a única fonte — deixá-lo de fora significa não avisar ninguém.
 */
export function telefoneDaImobiliaria(
  fontes: (null | string | undefined)[],
): null | string {
  for (const fonte of fontes) {
    const limpo = (fonte ?? "").trim();
    if (limpo) return limpo;
  }

  return null;
}

type ResultadoEnvio = { erro?: string; ok: boolean; para?: string };

// O COORDENADOR DE VENDAS DE CADA EMPREENDIMENTO.
//
// Ele mora no cadastro do empreendimento no C2X (`players`, relação `coordenador_vendas`) — é o
// mesmo caminho que o aviso de crédito reprovado já usa (`disparo-reprovacao.ts:227`), e por
// isso o disparo `coordenador` funciona bem hoje: 175 lidos de 186.
//
// ⚠️ AGRUPA POR COORDENADOR, e não manda uma mensagem por empreendimento. Cada empreendimento
// tem o SEU coordenador, e a imobiliária pode ser habilitada em vários de uma vez: sem agrupar,
// quem cuida de três produtos receberia três mensagens quase iguais no mesmo segundo. Com o
// agrupamento, cada um recebe uma mensagem com os empreendimentos que são dele.
//
// A ponte `enterpriseId -> code` sai de `apolo_enterprise_settings`, que é onde o Apolo guarda a
// sigla (VOR, GDN…) que o C2X usa como chave do cadastro.
export type CoordenadorComEmpreendimentos = {
  empreendimentos: EmpreendimentoHabilitado[];
  nome: string;
  telefone: null | string;
};

export async function coordenadoresDosEmpreendimentos(
  client: SupabaseClient,
  // O NOME vem junto: `apolo_enterprise_settings` só guarda `enterprise_id` e `code`, e o rótulo
  // que a imobiliária vê já está no vínculo (`apolo_relationships.label`). Buscar o nome de novo
  // no C2X seria uma ida a mais para um dado que quem chama já tem na mão.
  empreendimentos: { enterpriseId: string; label: string }[],
  carregarCadastro: (codes: string[]) => Promise<
    | { cadastros: { code: string; players: { name: string; phone: null | string; relation: string }[] }[]; ok: true }
    | { error: string; ok: false }
  >,
): Promise<CoordenadorComEmpreendimentos[]> {
  const porEnterpriseId = new Map(
    empreendimentos.filter((e) => e.enterpriseId).map((e) => [e.enterpriseId, e.label] as const),
  );
  const ids = [...porEnterpriseId.keys()];
  if (ids.length === 0) {
    return [];
  }

  const { data } = await client
    .from("apolo_enterprise_settings")
    .select("enterprise_id, code")
    .in("enterprise_id", ids);

  const linhas = (data ?? []) as Array<{
    code: null | string;
    enterprise_id: string;
  }>;
  const porCode = new Map(
    linhas
      .filter((l) => l.code)
      .map(
        (l) =>
          [
            String(l.code).toUpperCase(),
            { label: porEnterpriseId.get(l.enterprise_id) ?? String(l.code) },
          ] as const,
      ),
  );

  if (porCode.size === 0) {
    return [];
  }

  const cadastro = await carregarCadastro([...porCode.keys()]);
  if (!cadastro.ok) {
    return [];
  }

  // chave do agrupamento: o telefone do coordenador (é por ele que a mensagem sai).
  const porCoordenador = new Map<string, CoordenadorComEmpreendimentos>();

  for (const emp of cadastro.cadastros) {
    const coordenador = emp.players.find((p) => p.relation === "coordenador_vendas");
    if (!coordenador?.phone) {
      continue;
    }

    const label = porCode.get(emp.code.toUpperCase())?.label ?? emp.code;
    const chave = coordenador.phone.replace(/\D/g, "");
    const atual = porCoordenador.get(chave);

    if (atual) {
      atual.empreendimentos.push({ label });
    } else {
      porCoordenador.set(chave, {
        empreendimentos: [{ label }],
        nome: coordenador.name,
        telefone: coordenador.phone,
      });
    }
  }

  return [...porCoordenador.values()];
}

// O REPRESENTANTE LEGAL: nome E telefone da PESSOA, não da empresa.
//
// ⚠️ O telefone certo é o dele, não o de `apolo_contacts` (Lucas, 15/08). O contato da entidade
// é o telefone comercial, e vários são FIXO — a LOCAR SP cadastrou (31) 3852-3113. WhatsApp não
// entrega em fixo, então metade dos avisos morreria em "falhou" sem ninguém entender por quê.
//
// A fonte é `metadata.cadastro.socios[]`, e o sócio traz `representanteLegal: true`. Uso essa
// flag em vez de pegar `socios[0]`: em sociedade com 2+ pessoas o primeiro do array não é
// necessariamente quem assina (a ATLAS tem 2 sócios). Com fallback para o primeiro, porque
// cadastro antigo pode não ter a flag.
export type RepresentanteLegal = { nome: null | string; telefone: null | string };

export async function representanteDaImobiliaria(
  client: SupabaseClient,
  entityId: string,
): Promise<RepresentanteLegal> {
  const vazio: RepresentanteLegal = { nome: null, telefone: null };

  const { data } = await client
    .from("apolo_entities")
    .select("metadata")
    .eq("id", entityId)
    .maybeSingle<{ metadata: Record<string, unknown> | null }>();

  // ⚠️ `cadastroEfetivo` E NÃO `metadata.cadastro` DIRETO. A correção que o operador faz na tela
  // do Board grava em `metadata.cadastroEditado`; lendo só a camada de baixo, o disparo continua
  // usando o telefone velho depois de alguém ter consertado o cadastro justamente para a
  // mensagem chegar. Aconteceu em 15/08 com a Beatriz Teodora: telefone corrigido na tela, duas
  // tentativas de envio para o número antigo, ambas recusadas pelo Evolution.
  const cadastro = cadastroEfetivo(data?.metadata as Parameters<typeof cadastroEfetivo>[0]);
  const socios = (Array.isArray(cadastro.socios) ? cadastro.socios : []) as Array<{
    nome?: unknown;
    representanteLegal?: unknown;
    telefone?: unknown;
  }>;

  if (socios.length === 0) {
    return vazio;
  }

  const escolhido =
    socios.find((socio) => socio.representanteLegal === true) ?? socios[0];

  const nome = typeof escolhido?.nome === "string" ? escolhido.nome.trim() : "";
  const telefone =
    typeof escolhido?.telefone === "string" ? escolhido.telefone.trim() : "";

  return { nome: nome || null, telefone: telefone || null };
}

async function enviar(
  client: SupabaseClient,
  input: {
    destinatario: string;
    entityId: string;
    telefone: null | string;
    texto: string;
    tipo: string;
  },
): Promise<ResultadoEnvio> {
  const numero = telefoneParaEnvio(input.telefone);

  if (!numero) {
    await registrar(client, { ...input, erro: "sem telefone", status: "falhou" });
    return { erro: "sem telefone", ok: false };
  }

  const r = await sendEvolutionDirectText({ telefone: numero, text: input.texto });

  await registrar(client, {
    ...input,
    erro: r.ok ? undefined : r.error,
    status: r.ok ? "enviado" : "falhou",
    telefone: numero,
  });

  return r.ok ? { ok: true, para: numero } : { erro: r.error, ok: false };
}

// Best-effort: o registro do disparo nunca derruba a habilitação, que já está gravada.
//
// ⚠️ `origem` é NOT NULL e o padrão da tabela é `alvo:canal` (os valores em uso hoje são
// `imobiliaria:whatsapp`, `prevenda:email`, `automatico`, `reenvio`). NÃO existe coluna `canal`:
// o canal vive dentro da origem. `status` segue o vocabulário da tabela
// (enviado | entregue | lido | falhou).
async function registrar(
  client: SupabaseClient,
  input: {
    destinatario: string;
    entityId: string;
    erro?: string;
    status: string;
    telefone?: null | string;
    tipo: string;
  },
): Promise<void> {
  try {
    await client.from("apolo_disparos").insert({
      destinatario: input.destinatario,
      entity_id: input.entityId,
      erro: input.erro ?? null,
      // `relacionamento:whatsapp` diz de QUAL número saiu, que é a informação nova: o
      // `imobiliaria:whatsapp` dos outros disparos é o 4143 (Meta).
      origem: "relacionamento:whatsapp",
      status: input.status,
      telefone: input.telefone ?? null,
      tipo: input.tipo,
    });
  } catch {
    // silencioso de propósito
  }
}

export async function avisarCredenciamentoAprovado(
  client: SupabaseClient,
  input: {
    cnpj?: null | string;
    // Um por coordenador, já com os empreendimentos DELE. Ver `coordenadoresDosEmpreendimentos`.
    coordenadores?: CoordenadorComEmpreendimentos[];
    corretores: number;
    empreendimentos: EmpreendimentoHabilitado[];
    entityId: string;
    imobiliaria: string;
    imobiliariaTelefone?: null | string;
    linkCad?: null | string;
    // true = primeira vez com a Careli; false = já era credenciada e só habilitou mais um
    primeiraVez: boolean;
    representante?: null | string;
    responsavel?: null | string;
  },
): Promise<{ coordenador: ResultadoEnvio; imobiliaria: ResultadoEnvio }> {
  const [imobiliaria, coordenadores] = await Promise.all([
    enviar(client, {
      entityId: input.entityId,
      destinatario: "imobiliaria",
      telefone: input.imobiliariaTelefone ?? null,
      texto: mensagemImobiliariaHabilitada({
        empreendimentos: input.empreendimentos,
        imobiliaria: input.imobiliaria,
        linkCad: input.linkCad ?? null,
        primeiraVez: input.primeiraVez,
        representante: input.representante ?? null,
      }),
      tipo: "credenciamento_aprovado",
    }),
    Promise.all(
      (input.coordenadores ?? []).map((coord) =>
        enviar(client, {
          destinatario: `coordenador:${coord.nome}`,
          entityId: input.entityId,
          telefone: coord.telefone,
          texto: mensagemCoordenadorHabilitacao({
            cnpj: input.cnpj ?? null,
            corretores: input.corretores,
            // Só os empreendimentos DELE: mandar a lista inteira faria o coordenador do Garden
            // ler sobre o Vale do Ouro, que não é problema dele.
            empreendimentos: coord.empreendimentos,
            imobiliaria: input.imobiliaria,
            primeiraVez: input.primeiraVez,
            responsavel: input.responsavel ?? null,
          }),
          tipo: "credenciamento_coordenador",
        }),
      ),
    ),
  ]);

  return {
    // "avisou algum coordenador?" — o que a tela precisa dizer ao operador.
    coordenador: coordenadores.find((r) => r.ok) ?? {
      erro: coordenadores.length === 0 ? "sem coordenador" : coordenadores[0]?.erro,
      ok: false,
    },
    imobiliaria,
  };
}

export async function avisarCredenciamentoIndeferido(
  client: SupabaseClient,
  input: {
    cnpj?: null | string;
    coordenadorTelefone?: null | string;
    empreendimentos: EmpreendimentoHabilitado[];
    entityId: string;
    imobiliaria: string;
    imobiliariaTelefone?: null | string;
    motivos: string[];
    observacao?: null | string;
    representante?: null | string;
    responsavel?: null | string;
  },
): Promise<{ coordenador: ResultadoEnvio; imobiliaria: ResultadoEnvio }> {
  const [imobiliaria, coordenador] = await Promise.all([
    enviar(client, {
      entityId: input.entityId,
      destinatario: "imobiliaria",
      telefone: input.imobiliariaTelefone ?? null,
      texto: mensagemImobiliariaIndeferida({
        imobiliaria: input.imobiliaria,
        motivos: input.motivos,
        observacao: input.observacao ?? null,
        representante: input.representante ?? null,
      }),
      tipo: "credenciamento_indeferido",
    }),
    input.coordenadorTelefone
      ? enviar(client, {
          entityId: input.entityId,
          destinatario: "coordenador",
          telefone: input.coordenadorTelefone,
          texto: mensagemCoordenadorIndeferimento({
            cnpj: input.cnpj ?? null,
            empreendimentos: input.empreendimentos,
            imobiliaria: input.imobiliaria,
            motivos: input.motivos,
            responsavel: input.responsavel ?? null,
          }),
          tipo: "credenciamento_indeferido_coordenador",
        })
      : Promise.resolve<ResultadoEnvio>({ erro: "sem coordenador", ok: false }),
  ]);

  return { coordenador, imobiliaria };
}
