import { enrichPerson } from "@/lib/apolo/mostqi";
import { cpfValido, normalizarCpf, normalizarCreci } from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";
import { preSessaoDoRequest } from "@/lib/publico/cad/sessao";

// S3 — "buscamos o CRECI pela MOST ou deixamos ele inserir caso não seja retornado esse valor"
// (palavras do Lucas). Esta rota faz a primeira metade; a segunda é a tela deixar o campo
// editável, que é o comportamento padrão quando aqui volta vazio.
//
// Devolve NOME e CRECI: o corretor digita só o CPF e os dois campos chegam preenchidos
// (Lucas, 20/jul: "o corretor digita o cpf a most traz o nome completo" + "não esquece do
// Creci" + "também vir preenchido").
//
// ⚠️ TORNEIRA PAGA, mas a mais barata possível para o que precisamos:
//   · CARELI_PF_06 = SÓ o dataset class_organization (CRECI) = R$ 0,177.
//     Criada pela MOST em 20/jul justamente para isso. Antes usávamos a CARELI_PF_04, que roda
//     ~9 datasets por ~R$ 1,60 para buscar UM campo. O comentário do cadastro-flow já pedia a
//     troca: "trocar por uma query enxuta só-conselho quando o MOST criar".
//   · CARELI_PF_01 = cadastro básico, de onde sai o nome completo. ~R$ 1,06.
// Total ~R$ 1,24 por corretor, UMA vez (no cadastro dele), nunca por CAD.
//
// As duas rodam EM PARALELO: o corretor está numa tela esperando, e serial dobraria a espera.
//
// Numa rota pública sem trava isso seria dinheiro aberto para a internet. As travas:
//   1. EXIGE pré-sessão: sem CNPJ credenciado aprovado em S1, 403 antes de qualquer chamada
//      paga. O CNPJ credenciado é a autorização que paga a consulta.
//   2. Teto diário por IP (balde 'creci'), 429 seco.
//   3. A tela chama UMA vez por CPF (useRef), nunca no onChange.
//
// "Não encontrado" NÃO é erro: devolve creci vazio e a tela abre o campo para digitação, sem
// mostrar falha. A busca do CRECI nunca pode travar o cadastro — é um campo opcional que
// estamos tentando adivinhar por cortesia.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const QUERY_CRECI = "CARELI_PF_06";
// Cadastro básico: é dela que sai o nome completo (dataset basic_data).
const QUERY_CADASTRO = "CARELI_PF_01";
// Timeout curto: o corretor está em 4G esperando uma tela. Estourou, o campo abre editável.
const TIMEOUT_MS = 6000;

export async function POST(request: Request) {
  const pre = preSessaoDoRequest(request);
  if (!pre.ok) {
    return erro("Confirme o CNPJ da imobiliária antes de continuar.", 403);
  }

  const preparo = await prepararRota(request, "creci");
  if (!preparo.ok) return preparo.response;
  const { inicio } = preparo;

  const corpo = await lerCorpo<{ cpf?: string }>(request);
  const cpf = normalizarCpf(corpo?.cpf);
  if (!cpfValido(cpf)) {
    return responder(inicio, erro("Confira o CPF: parece que faltou um dígito."));
  }

  // Cada consulta tem seu próprio timeout: se o CRECI demorar, o nome ainda chega (e vice-versa).
  // Melhor entregar um campo preenchido do que perder os dois por causa do mais lento.
  const comTeto = <T,>(p: Promise<T>): Promise<T | null> =>
    Promise.race([
      p.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);

  try {
    const [doCreci, doCadastro] = await Promise.all([
      comTeto(enrichPerson(cpf, { query: QUERY_CRECI })),
      comTeto(enrichPerson(cpf, { query: QUERY_CADASTRO })),
    ]);

    // Sem resultado, com timeout ou com a MOST fora do ar: mesma resposta (campo vazio). A tela
    // não distingue, porque para o corretor as três situações significam a mesma coisa: digite.
    // Nenhuma delas pode travar o cadastro — estamos adivinhando por cortesia.
    return responder(
      inicio,
      json({
        creci: normalizarCreci(doCreci?.creci),
        nome: (doCadastro?.nome ?? "").trim(),
      }),
    );
  } catch {
    return responder(inicio, json({ creci: "", nome: "" }));
  }
}
