import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { cpfValido, formatarDocumento, soDigitos } from "@/lib/apolo/documento";
import { createApoloAdminClient } from "@/lib/apolo/server";

// O QUADRO DE ASSINATURA DO EMPREENDIMENTO. Tabela na migration 0158.
//
// Lucas (13/09/2026): *"a vendedora eu posso ter mais de um assinante, então vamos ter que liberar
// para vendedora também a inclusão das assinaturas igual a testemunha (...) Testemunha a mesma
// coisa, e coordenador de vendas a mesma coisa, eu posso ter mais de um como coordenador"*.
//
// ⚠️ TRÊS PAPÉIS, E SÓ TRÊS. Comprador e cônjuge saem da PROPOSTA e nunca daqui: digitar o comprador
// abriria a porta para o contrato dizer uma pessoa e o envelope ir para outra, e o defeito só
// apareceria meses depois. O comprador PJ terá caminho próprio na etapa de validação, apontando
// entre os sócios já cadastrados quem assina. O captador não entra — decisão do Lucas no mesmo dia.
//
// ⚠️ A VENDEDORA VEM COM UMA LINHA QUE NÃO ESTÁ NA TABELA. O representante legal cadastrado na PJ
// (`apolo_relationships`) é devolvido junto, marcado `origem: "representante"` e SEM id: ele é
// derivado do cadastro da empresa, não uma linha daqui. Guardá-lo aqui criaria uma segunda verdade
// sobre quem representa a empresa — e o dia em que o cadastro mudasse, o quadro continuaria com o
// nome antigo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_CACHE = { "Cache-Control": "no-store" } as const;
const POSICAO_MAXIMA = 9;
const ORDEM_MAXIMA = 20;

export const PAPEIS_DO_QUADRO = ["vendedora", "coordenador", "testemunha"] as const;
export type PapelDoQuadro = (typeof PAPEIS_DO_QUADRO)[number];

const COLUNAS =
  "id,enterprise_id,papel,posicao,ordem_assinatura,nome,cpf,email,entity_id,observacao,origem";

type Linha = {
  cpf: null | string;
  email: null | string;
  enterprise_id: string;
  entity_id: null | string;
  id: string;
  nome: string;
  observacao: null | string;
  ordem_assinatura: null | number;
  origem: null | string;
  papel: string;
  posicao: number;
};

export type AssinanteDoQuadro = {
  cpf: null | string;
  email: null | string;
  /** `null` na linha herdada do cadastro da PJ — ela não se edita nem se apaga aqui. */
  id: null | string;
  nome: string;
  ordemAssinatura: null | number;
  origem: null | string;
  papel: PapelDoQuadro;
  posicao: number;
};

function paraATela(l: Linha): AssinanteDoQuadro {
  return {
    cpf: l.cpf,
    email: l.email,
    id: l.id,
    nome: l.nome,
    ordemAssinatura: l.ordem_assinatura,
    origem: l.origem,
    papel: l.papel as PapelDoQuadro,
    posicao: l.posicao,
  };
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const inteiro = (v: unknown): null | number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Os campos, conferidos.
 *
 * ⚠️ O E-MAIL DECIDE SE A PESSOA CONSEGUE ASSINAR, e por isso é exigido aqui. No provedor o
 * signatário É o e-mail — sem endereço próprio, a conferência do envio recusa a pessoa e o envelope
 * não sai. Deixar gravar sem e-mail empurra a descoberta para o momento do envio, que é o pior
 * lugar: o contrato já está pronto e alguém está esperando.
 *
 * ⚠️ O CPF É CONFERIDO MAS NÃO EXIGIDO. A Clicksign pede CPF formatado, então sem ele a pessoa
 * também não assina — mas o operador cadastra antes de ter o documento na mão, e travar aqui o
 * obrigaria a inventar um número. Quando vier, tem de ser válido: dígito errado vira 400 no meio do
 * envio, com o envelope já criado.
 */
function conferir(corpo: Record<string, unknown>) {
  const papel = texto(corpo.papel) as PapelDoQuadro;
  const nome = texto(corpo.nome);
  const email = texto(corpo.email).toLowerCase();
  const cpfCru = soDigitos(texto(corpo.cpf));
  const posicao = inteiro(corpo.posicao);
  const ordem =
    corpo.ordemAssinatura == null || texto(corpo.ordemAssinatura) === ""
      ? null
      : inteiro(corpo.ordemAssinatura);

  if (!PAPEIS_DO_QUADRO.includes(papel)) {
    return { erro: "Papel invalido para o quadro de assinatura." };
  }
  if (nome.split(/\s+/).filter(Boolean).length < 2) {
    return { erro: "Informe o nome COMPLETO: e ele que vai impresso no contrato." };
  }
  if (!email || !email.includes("@") || /\s/.test(email)) {
    return { erro: "Informe o e-mail: sem ele a pessoa nao recebe o convite para assinar." };
  }
  if (cpfCru && !cpfValido(cpfCru)) {
    return { erro: "O CPF nao confere. Deixe em branco se ainda nao tiver o documento." };
  }
  if (posicao === null || posicao < 1 || posicao > POSICAO_MAXIMA) {
    return { erro: `A posicao vai de 1 a ${POSICAO_MAXIMA}: e ela que numera a linha no contrato.` };
  }
  if (ordem !== null && (ordem < 1 || ordem > ORDEM_MAXIMA)) {
    return {
      erro: `A ordem de assinatura vai de 1 a ${ORDEM_MAXIMA}, ou em branco para seguir o papel.`,
    };
  }

  return {
    valores: {
      cpf: cpfCru ? formatarDocumento(cpfCru) : null,
      email,
      nome,
      observacao: texto(corpo.observacao) || null,
      ordem_assinatura: ordem,
      papel,
      posicao,
    },
  };
}

/**
 * O representante legal da vendedora do empreendimento — a linha que o quadro já mostra preenchida.
 *
 * ⚠️ FALHA AQUI NÃO DERRUBA O QUADRO. Se a leitura do representante falhar, o resto da tela ainda
 * vale: as pessoas digitadas continuam aparecendo. Devolver erro faria um cadastro incompleto da
 * empresa esconder as testemunhas, que não têm nada a ver com isso.
 */
async function representanteDaVendedora(
  admin: ReturnType<typeof createApoloAdminClient>,
  enterpriseId: string,
): Promise<AssinanteDoQuadro | null> {
  if (!admin) return null;
  try {
    const { data: settings } = await admin
      .from("apolo_enterprise_settings")
      .select("vendedor_entity_id")
      .eq("enterprise_id", enterpriseId)
      .maybeSingle<{ vendedor_entity_id: null | string }>();

    const vendedora = settings?.vendedor_entity_id;
    if (!vendedora) return null;

    const { data: vinculo } = await admin
      .from("apolo_relationships")
      .select("related_entity_id")
      .eq("entity_id", vendedora)
      .eq("relationship_type", "representante_legal")
      .limit(1)
      .maybeSingle<{ related_entity_id: null | string }>();

    const pessoaId = vinculo?.related_entity_id;
    if (!pessoaId) return null;

    const [{ data: pessoa }, { data: contatos }] = await Promise.all([
      admin
        .from("apolo_entities")
        .select("display_name, document_masked")
        .eq("id", pessoaId)
        .maybeSingle<{ display_name: string; document_masked: null | string }>(),
      admin
        .from("apolo_contacts")
        .select("contact_type, value")
        .eq("entity_id", pessoaId)
        .eq("contact_type", "email")
        .limit(1),
    ]);

    if (!pessoa?.display_name) return null;

    return {
      cpf: pessoa.document_masked,
      email: (contatos ?? [])[0]?.value ?? null,
      id: null,
      nome: pessoa.display_name,
      ordemAssinatura: null,
      origem: "representante",
      papel: "vendedora",
      posicao: 1,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const enterpriseId = (new URL(request.url).searchParams.get("enterpriseId") ?? "").trim();
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const [{ data, error }, representante] = await Promise.all([
    admin
      .from("temis_assinantes")
      .select(COLUNAS)
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId)
      .eq("ativo", true)
      .order("papel", { ascending: true })
      .order("posicao", { ascending: true }),
    representanteDaVendedora(admin, enterpriseId),
  ]);

  if (error) {
    console.warn("[temis/assinantes] leitura falhou:", error.message);
    return NextResponse.json({ error: "Nao foi possivel ler o quadro." }, { status: 500 });
  }

  const gravados = ((data ?? []) as Linha[]).map(paraATela);

  // ⚠️ O REPRESENTANTE SÓ ENTRA SE NINGUÉM OCUPOU A POSIÇÃO 1 DA VENDEDORA. Quem digitou uma linha
  // ali decidiu que é aquela pessoa que assina primeiro; empurrar a herdada por cima faria o quadro
  // mostrar duas pessoas na mesma linha do contrato.
  const posicao1Ocupada = gravados.some((a) => a.papel === "vendedora" && a.posicao === 1);
  const assinantes =
    representante && !posicao1Ocupada ? [representante, ...gravados] : gravados;

  return NextResponse.json({ assinantes }, { headers: SEM_CACHE });
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as null | Record<string, unknown>;
  if (!corpo) return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });

  const enterpriseId = texto(corpo.enterpriseId);
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const { erro, valores } = conferir(corpo);
  if (erro || !valores) return NextResponse.json({ error: erro }, { status: 400 });

  const { data, error } = await admin
    .from("temis_assinantes")
    .insert({ ...valores, criado_por: auth.userId ?? null, enterprise_id: enterpriseId })
    .select(COLUNAS)
    .single<Linha>();

  if (error) {
    // ⚠️ 23505 É A TRAVA DA POSIÇÃO, e ela é POR PAPEL: vendedora 1 e testemunha 1 convivem. Sem
    // dizer isso, o operador lê "posicao ocupada" olhando para um quadro onde aquele número parece
    // livre.
    const ocupada = error.code === "23505";
    console.warn("[temis/assinantes] insert falhou:", error.message);
    return NextResponse.json(
      {
        error: ocupada
          ? `A posicao ${valores.posicao} ja esta ocupada em ${valores.papel} neste empreendimento.`
          : "Nao foi possivel gravar o assinante.",
      },
      { status: ocupada ? 409 : 500 },
    );
  }

  return NextResponse.json({ assinante: paraATela(data) }, { headers: SEM_CACHE });
}

// ⚠️ DESATIVA, NÃO APAGA. Um contrato já enviado carrega o nome no envelope e o diário da assinatura
// aponta para esta linha; apagar deixaria a trilha do que já aconteceu sem o nome de quem assinou.
export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "Informe o assinante." }, { status: 400 });

  const { error } = await admin
    .from("temis_assinantes")
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.warn("[temis/assinantes] desativar falhou:", error.message);
    return NextResponse.json({ error: "Nao foi possivel remover o assinante." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { headers: SEM_CACHE });
}
