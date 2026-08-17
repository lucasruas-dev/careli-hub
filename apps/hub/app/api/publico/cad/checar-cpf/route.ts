import { lerCadsDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import {
  conflitoDeNucleoFamiliar,
  cpfValidoParaNucleo,
  mensagemDeConflito,
} from "@/lib/apolo/nucleo-familiar";
import { hashIdentifier } from "@/lib/apolo/server";
import { anotarContexto } from "@/lib/publico/cad/log-erros";
import {
  erro,
  json,
  lerCorpo,
  prepararRota,
  recusar,
  registrarBarreira,
  responder,
} from "@/lib/publico/cad/rotas";
import { sessaoDoRequest } from "@/lib/publico/cad/sessao";

// CHECAGEM DO CPF NA IDENTIFICAÇÃO, antes de preencher a CAD.
//
// Lucas, 12/08/2026: "prefiro na identificação do cpf (pode ser via most ou digitação)". A trava
// no salvar continua existindo e é a que vale, mas descobrir a duplicidade só no último passo faz
// o corretor perder a ficha inteira. Foi assim que o caso Alcimar e Sirlei chegou até o fim.
//
// SÓ LEITURA, não grava nada. Responde duas perguntas:
//   • este CPF já tem CAD neste empreendimento?
//   • este CPF pertence a um núcleo familiar que já tem CAD neste empreendimento?
//
// ⚠️ O EMPREENDIMENTO VEM DO TOKEN, nunca do corpo. Mesma regra do /salvar: no formulário anônimo,
// aceitar empreendimento do corpo deixaria consultar a carteira de qualquer loteamento.
//
// ⚠️ NÃO DEVOLVE NOME DE IMOBILIÁRIA. Dizer que "a imobiliária X já cadastrou" entrega carteira de
// concorrente. A resposta diz que existe e manda falar com a central.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Corpo = { cpf?: unknown; cpfConjuge?: unknown };

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export async function POST(request: Request) {
  const verificacao = sessaoDoRequest(request);
  if (!verificacao.ok) {
    return recusar(
      request,
      erro("Sua sessão expirou. Reabra o link e informe o seu CPF de corretor.", 401),
    );
  }
  const { sessao } = verificacao;

  // Quem está tentando, para o Log Erros. Anotado ANTES de qualquer recusa desta rota.
  anotarContexto(request, {
    corretorNome: sessao.corretorNome,
    empreendimentoId: sessao.enterpriseId,
    imobiliariaEntityId: sessao.imobiliariaEntityId,
    imobiliariaNome: sessao.imobiliariaNome,
  });

  // Sem empreendimento não há recorte para comparar: a CAD é duplicada POR EMPREENDIMENTO.
  if (!sessao.enterpriseId) {
    return json({ data: { conferido: false, conflito: null } });
  }

  // Balde `identificacao`: esta rota responde se um CPF tem cadastro, então sem teto de uso ela
  // vira um oráculo para varrer CPF e descobrir quem é cliente da Careli.
  const preparo = await prepararRota(request, "identificacao");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const corpo = await lerCorpo<Corpo>(request);
  const cpf = digitos(corpo?.cpf);
  const cpfConjuge = digitos(corpo?.cpfConjuge);

  // CPF incompleto não é erro: o corretor ainda está digitando, ou o MOST ainda não leu direito.
  // Responde "não conferido" e a tela pergunta de novo quando o número fechar.
  if (!cpfValidoParaNucleo(cpf)) {
    return responder(request, inicio, json({ data: { conferido: false, conflito: null } }));
  }

  const enterpriseId = normalizarEnterpriseId(sessao.enterpriseId);
  if (!enterpriseId) {
    return responder(request, inicio, json({ data: { conferido: false, conflito: null } }));
  }

  // 1) O próprio CPF já tem CAD aqui. Lê TODAS as fichas do documento, porque a mesma pessoa tem
  //    mais de uma ficha em 516 casos na base e olhar só uma foi o que deixou passar as três CADs
  //    duplicadas de agosto.
  const docHash = hashIdentifier("cpf", cpf);
  const [{ data: porIdentificador }, { data: porDocumento }] = await Promise.all([
    adminClient
      .from("apolo_entity_identifiers")
      .select("entity_id")
      .eq("identifier_type", "cpf")
      .eq("value_hash", docHash),
    adminClient.from("apolo_entities").select("id").eq("document_hash", docHash),
  ]);

  const idsDoDocumento = [
    ...new Set([
      ...(porIdentificador ?? []).map((l: { entity_id: string }) => l.entity_id),
      ...(porDocumento ?? []).map((l: { id: string }) => l.id),
    ]),
  ].filter(Boolean);

  for (const id of idsDoDocumento) {
    let cads: { empreendimento: null | string; enterprise_id: null | string }[];
    try {
      cads = await lerCadsDaEsteira<{
        empreendimento: null | string;
        enterprise_id: null | string;
      }>(adminClient, id, "empreendimento, enterprise_id");
    } catch {
      // Não dá para afirmar que está livre. Esta rota é conveniência, não autoridade: deixa
      // seguir e a trava do salvar decide, que aquela é fail-closed.
      return responder(request, inicio, json({ data: { conferido: false, conflito: null } }));
    }

    const aqui = cads.find((c) => normalizarEnterpriseId(c.enterprise_id) === enterpriseId);
    if (aqui) {
      const onde = aqui.empreendimento?.trim();

      // Parede de 200: o corretor descobre AQUI, na identificação, que a ficha já existe. Ele para
      // e não preenche. Esta é a recusa mais comum do primeiro passo, e sem registrá-la a tela
      // mostraria o funil saudável justamente onde ele mais vaza. Motivo canônico, sem nome nem
      // empreendimento: o "quem" já vem do contexto anotado.
      registrarBarreira(request, "CPF já possui CAD neste empreendimento.");

      return responder(
        request,
        inicio,
        json({
          data: {
            conferido: true,
            conflito: {
              mensagem:
                `Este CPF já possui CAD ${onde ? `para o empreendimento ${onde}` : "para esse empreendimento"}.`,
              tipo: "cpf-ja-tem-cad",
            },
          },
        }),
      );
    }
  }

  // 2) Núcleo familiar: o casal usa um cadastro só por empreendimento, e a quantidade de unidades
  //    é livre.
  const conflito = await conflitoDeNucleoFamiliar({
    adminClient,
    cpfConjuge,
    cpfTitular: cpf,
    enterpriseId,
    ignorarEntityIds: idsDoDocumento,
  });

  if (conflito) {
    // ⚠️ MOTIVO CANÔNICO, NUNCA `mensagemDeConflito`. Aquela frase nomeia TERCEIRO ("o CPF do
    // cônjuge do JOÃO DA SILVA já possui CAD..."), e o JOÃO é outro cliente. O corretor precisa
    // ver o nome para entender; o log, não.
    registrarBarreira(request, "Núcleo familiar já possui CAD neste empreendimento.");
  }

  return responder(
    request,
    inicio,
    json({
      data: {
        conferido: true,
        conflito: conflito
          ? { mensagem: mensagemDeConflito(conflito), tipo: conflito.motivo }
          : null,
      },
    }),
  );
}
