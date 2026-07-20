import { createApoloEntity } from "@/lib/apolo/cadastro-persist";
import { listEmpreendimentosAtivos } from "@/lib/apolo/credenciamento";
import { consultarImobiliariaCredenciada } from "@/lib/publico/cad/dados";
import {
  cnpjValido,
  emailValido,
  normalizarCnpj,
  normalizarCreci,
  normalizarEmail,
  normalizarNome,
  normalizarTelefone,
  telefoneCompleto,
} from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";

// Auto-cadastro PÚBLICO de imobiliária: "a imobiliária se cadastra e escolhe os
// empreendimentos que quer trabalhar, restrito aos empreendimentos que o Lucas marcou como
// ATIVOS" (regra já existente no sistema).
//
// ⚠️ ISTO É UM PEDIDO, NÃO UM CREDENCIAMENTO. A entidade nasce em `status: 'review'` (padrão
// do createApoloEntity) e as habilitações de empreendimento nascem em `status: 'pending'`.
// Só quando alguém nosso vira a chave para 'active'/'verified' é que:
//   - o CNPJ passa a "credenciada" no formulário do corretor, e
//   - o empreendimento passa a aparecer na lista dele.
//
// ⚠️ MUDANÇA DE SEMÂNTICA em relação ao wizard interno, que grava 'verified' na marra
// (cadastro-persist.ts:414,433) sem ninguém aprovar. Aqui não dá para fazer isso: seria
// auto-aprovação de um formulário aberto ao mundo. Ver pendência 2 do relatório.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Corpo = {
  cnpj?: string;
  creci?: string;
  email?: string;
  empreendimentos?: string[];
  nomeFantasia?: string;
  razaoSocial?: string;
  responsavel?: string;
  telefone?: string;
};

export async function POST(request: Request) {
  const preparo = await prepararRota(request, "imobiliaria");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const corpo = await lerCorpo<Corpo>(request);
  const cnpj = normalizarCnpj(corpo?.cnpj);
  const razaoSocial = normalizarNome(corpo?.razaoSocial);
  const email = normalizarEmail(corpo?.email);
  const telefone = normalizarTelefone(corpo?.telefone);

  const erros: string[] = [];
  if (!cnpjValido(cnpj)) erros.push("Confira o CNPJ: parece que faltou um dígito.");
  if (razaoSocial.length < 3) erros.push("Informe a razão social da imobiliária.");
  if (!emailValido(email)) erros.push("Confira o e-mail: ele precisa ter @ e domínio.");
  if (!telefoneCompleto(telefone)) erros.push("Confira o telefone: informe DDD e número.");
  if (erros.length) return responder(inicio, erro(erros.join(" ")));

  try {
    // Já credenciada: resposta cordial, sem criar entidade duplicada e sem revelar nada além
    // do que a própria pessoa acabou de digitar.
    const existente = await consultarImobiliariaCredenciada(adminClient, cnpj);
    if (existente.credenciada) {
      return responder(inicio, json({ status: "ja-credenciada" }));
    }

    // Só empreendimentos ATIVOS entram. O que o cliente mandar fora dessa lista é descartado
    // em silêncio: ele não escolhe o que não está aberto.
    const ativos = await listEmpreendimentosAtivos(adminClient);
    const permitidos = new Set(ativos.map((emp) => String(emp.id)));
    const escolhidos = (corpo?.empreendimentos ?? [])
      .map(String)
      .filter((id) => permitidos.has(id))
      .slice(0, 30);

    const criado = await createApoloEntity(adminClient, {
      empresa: {
        cnpj,
        creci: normalizarCreci(corpo?.creci),
        email,
        nomeFantasia: normalizarNome(corpo?.nomeFantasia),
        razaoSocial,
        telefone,
      },
      empreendimentos: escolhidos.map((id) => ({
        id,
        label: ativos.find((emp) => String(emp.id) === id)?.name ?? "Empreendimento",
      })),
      origem: "publico-imobiliaria",
      ownerUserId: null,
      persona: "pj",
      role: "imobiliaria",
    });
    if (!criado.ok) return responder(inicio, erro(undefined, 500));

    // ⚠️⚠️ REBAIXA O PAPEL PARA 'review'. `createApoloEntity` grava SEMPRE
    // `apolo_entity_profiles.status = 'active'` (cadastro-persist.ts:281), e é exatamente esse
    // status que `consultarImobiliariaCredenciada` lê como "credenciada". Sem esta linha, uma
    // imobiliária qualquer se auto-credenciaria pelo formulário público e passaria a receber
    // CAD de corretor no mesmo minuto. Esta é a trava do auto-cadastro.
    const { error: papelError } = await adminClient
      .from("apolo_entity_profiles")
      .update({ status: "review" })
      .eq("entity_id", criado.entityId)
      .eq("profile", "imobiliaria");
    if (papelError) return responder(inicio, erro(undefined, 500));

    // Mesma lógica nas habilitações de empreendimento: `createApoloEntity` as cria 'verified',
    // e 'verified' aqui significaria "a imobiliária se auto-habilitou".
    const { error: pendenteError } = await adminClient
      .from("apolo_relationships")
      .update({ status: "pending" })
      .eq("entity_id", criado.entityId)
      .eq("relationship_type", "empreendimento");
    if (pendenteError) return responder(inicio, erro(undefined, 500));

    // O responsável que assinou o pedido, para a central saber com quem falar.
    const responsavel = normalizarNome(corpo?.responsavel);
    if (responsavel) {
      await adminClient.from("apolo_relationships").insert({
        entity_id: criado.entityId,
        label: responsavel,
        metadata: { email, kind: "contato", phone: telefone, role: "responsavel", source: "publico-imobiliaria" },
        related_entity_id: null,
        relationship_type: "representante_legal",
        status: "pending",
      });
    }

    return responder(inicio, json({ protocolo: criado.autenticacao, status: "recebido" }, 201));
  } catch {
    return responder(inicio, erro(undefined, 500));
  }
}
