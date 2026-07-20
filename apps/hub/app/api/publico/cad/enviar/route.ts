import { createApoloEntity } from "@/lib/apolo/cadastro-persist";
import { uploadApoloDocument } from "@/lib/apolo/documentos";
import { montarFichaCad, type FichaPublica } from "@/lib/publico/cad/cad-doc";
import {
  gravarVinculoEsteira,
  nomeDoEmpreendimento,
  registrarOrigemPublica,
} from "@/lib/publico/cad/dados";
import {
  cpfValido,
  emailValido,
  nomeCompletoValido,
  normalizarCpf,
  normalizarEmail,
  normalizarNome,
  normalizarTelefone,
  protocoloDaAutenticacao,
  telefoneCompleto,
} from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";
import { sessaoDoRequest } from "@/lib/publico/cad/sessao";
import { montarCadPdf } from "@/modules/apolo/blocks/cadastro/cad-pdf";

// S10 — a CAD é gravada. É aqui que o vínculo nasce, e ele nasce EXCLUSIVAMENTE do token.
//
// ⚠️ NADA DE VÍNCULO VEM DO CORPO. O browser não manda (e se mandasse, seria descartado)
// imobiliária, corretor ou empreendimento. No wizard interno o `CadDoc` inteiro é montado no
// browser e a rota apenas repassa; num formulário anônimo isso significaria o corretor
// escolhendo em que imobiliária a CAD nasce vinculada. Aqui os três ids saem do token
// assinado, que ele não tem como forjar por não ter o segredo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Tetos do público, bem abaixo do interno (20MB / 40 arquivos): foto de celular cabe folgada
// em 8MB, e base64 infla ~33% rodando inteiro na memória da function.
const MAX_ARQUIVOS = 6;
const MAX_BASE64 = 11_000_000;

type Anexo = {
  categoria?: string;
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
};

type Corpo = { documentos?: Anexo[]; ficha?: FichaPublica };

const CATEGORIAS = new Set([
  "certidao",
  "comprovante_endereco",
  "identificacao",
  "identificacao_conjuge",
  "outros",
  "renda",
]);

export async function POST(request: Request) {
  const verificacao = sessaoDoRequest(request);
  if (!verificacao.ok) return erro("Sua sessão expirou. Informe o CPF novamente.", 401);
  const sessao = verificacao.sessao;

  // Sem empreendimento escolhido não existe CAD. É a mesma regra da CHECK constraint da
  // migration 0061: não existe CAD pública sem vínculo completo.
  if (!sessao.enterpriseId) {
    return erro("Escolha o empreendimento antes de enviar a CAD.", 400);
  }

  const preparo = await prepararRota(request, "enviar");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const corpo = await lerCorpo<Corpo>(request);
  const ficha = corpo?.ficha;
  if (!ficha?.identidade) return responder(inicio, erro("Preencha os dados do cliente."));

  const nome = normalizarNome(ficha.identidade.nome);
  const cpf = normalizarCpf(ficha.identidade.cpf);
  const email = normalizarEmail(ficha.perfil?.email);
  const telefone = normalizarTelefone(ficha.perfil?.telefone);

  const erros: string[] = [];
  if (!nomeCompletoValido(nome)) erros.push("Informe o nome completo do cliente, com sobrenome.");
  if (!cpfValido(cpf)) erros.push("Confira o CPF do cliente: parece que faltou um dígito.");
  if (email && !emailValido(email)) erros.push("Confira o e-mail do cliente.");
  if (telefone && !telefoneCompleto(telefone)) {
    erros.push("Confira o telefone do cliente: informe DDD e número.");
  }
  if (erros.length) return responder(inicio, erro(erros.join(" ")));

  const documentos = (corpo?.documentos ?? []).filter((doc) => doc?.fileBase64);
  if (documentos.length > MAX_ARQUIVOS) {
    return responder(inicio, erro(`Envie no máximo ${MAX_ARQUIVOS} arquivos por CAD.`, 413));
  }
  for (const doc of documentos) {
    if ((doc.fileBase64?.length ?? 0) > MAX_BASE64) {
      return responder(
        inicio,
        erro("Uma das fotos ficou grande demais. Tire outra com menos zoom.", 413),
      );
    }
  }

  try {
    const empreendimentoNome =
      (await nomeDoEmpreendimento(adminClient, sessao.enterpriseId)) || "Empreendimento";

    // 1) A entidade do prospect.
    const criado = await createApoloEntity(adminClient, {
      endereco: ficha.endereco ?? null,
      identidade: {
        cpf,
        dataNascimento: ficha.identidade.dataNascimento,
        nacionalidade: ficha.identidade.nacionalidade,
        naturalidade: ficha.identidade.naturalidade,
        nome,
        nomeMae: ficha.identidade.nomeMae,
        nomePai: ficha.identidade.nomePai,
        orgaoEmissor: ficha.identidade.orgaoEmissor,
      },
      origem: "publico-cad",
      ownerUserId: null,
      // A imobiliária vem do TOKEN. É o ponto exato que fecha o furo do wizard interno.
      perfil: {
        email,
        imobiliariaId: sessao.imobiliariaEntityId,
        imobiliariaLabel: sessao.imobiliariaNome,
        telefone,
      },
      persona: "pf",
      role: "prospect",
    });
    if (!criado.ok) return responder(inicio, erro(undefined, 500));

    const vinculo = {
      corretorEmail: sessao.corretorEmail,
      corretorEntityId: sessao.corretorEntityId,
      corretorNome: sessao.corretorNome,
      empreendimentoNome,
      enterpriseId: sessao.enterpriseId,
      imobiliariaEntityId: sessao.imobiliariaEntityId,
      imobiliariaNome: sessao.imobiliariaNome,
      prospectEntityId: criado.entityId,
      sessaoId: sessao.sessaoId,
    };

    // 2) O VÍNCULO. Não é best-effort: se falhar, a CAD não é aceita. Documento que falta pode
    //    ser reenviado; CAD órfã de vínculo é dado corrompido.
    const esteira = await gravarVinculoEsteira(adminClient, vinculo);
    if (!esteira.ok) return responder(inicio, erro(undefined, 500));

    // 3) O empreendimento no grafo (o relacionamento com a imobiliária já veio do
    //    createApoloEntity, via perfil.imobiliariaId).
    const { error: relError } = await adminClient.from("apolo_relationships").insert({
      entity_id: criado.entityId,
      label: empreendimentoNome,
      metadata: {
        enterpriseId: sessao.enterpriseId,
        kind: "trabalho",
        role: "empreendimento",
        source: "publico-cad",
      },
      related_entity_id: null,
      relationship_type: "empreendimento",
      status: "verified",
    });
    if (relError) return responder(inicio, erro(undefined, 500));

    // 4) O corretor no grafo do prospect: quem trouxe este cliente.
    await adminClient.from("apolo_relationships").insert({
      entity_id: criado.entityId,
      label: sessao.corretorNome,
      metadata: { kind: "trabalho", role: "corretor", source: "publico-cad" },
      related_entity_id: sessao.corretorEntityId,
      relationship_type: "corretor",
      status: "verified",
    });

    const protocolo = protocoloDaAutenticacao(criado.autenticacao) || criado.autenticacao;
    const avisos: string[] = [];
    const trilha = await registrarOrigemPublica(adminClient, vinculo, protocolo);
    if (trilha) avisos.push(trilha);

    // 5) Documentos: best-effort (a entidade e o vínculo já existem).
    for (const doc of documentos) {
      const categoria = CATEGORIAS.has(String(doc.categoria)) ? String(doc.categoria) : "outros";
      const upload = await uploadApoloDocument({
        adminClient,
        documentType: categoria,
        fileBase64: doc.fileBase64 as string,
        fileName: doc.fileName || `${categoria}.jpg`,
        label: `${nome} - ${categoria}`,
        mimeType: doc.mimeType ?? null,
        ownerId: criado.entityId,
        scope: "entidade",
        uploadedByName: `${sessao.corretorNome} (${sessao.imobiliariaNome})`,
      });
      if (!upload.ok) avisos.push(`documento ${categoria}: ${upload.error}`);
    }

    // 6) A CAD em PDF, montada AQUI com o código de autenticação, a logo do C2X, a
    //    imobiliária e o nome do corretor.
    let cadBase64: string | null = null;
    try {
      const cad = montarFichaCad(ficha, {
        corretorNome: sessao.corretorNome,
        empreendimentoNome,
        imobiliariaNome: sessao.imobiliariaNome,
      });
      const bytes = await montarCadPdf({ ...cad, autenticacao: criado.autenticacao });
      cadBase64 = Buffer.from(bytes).toString("base64");

      const upload = await uploadApoloDocument({
        adminClient,
        documentType: "cad",
        fileBase64: cadBase64,
        fileName: `${cad.arquivo}.pdf`,
        label: `CAD - ${nome}`,
        mimeType: "application/pdf",
        ownerId: criado.entityId,
        scope: "entidade",
        uploadedByName: `${sessao.corretorNome} (${sessao.imobiliariaNome})`,
      });
      if (!upload.ok) avisos.push(`CAD: ${upload.error}`);
    } catch (error) {
      avisos.push(`CAD: falha ao gerar o PDF (${(error as Error).message})`);
    }

    // `avisos` fica só no log do servidor: mensagem interna não vai para tela pública.
    if (avisos.length) console.warn("[publico-cad] avisos", avisos);

    return responder(inicio, json({ cadBase64, ok: true, protocolo }, 201));
  } catch {
    return responder(inicio, erro(undefined, 500));
  }
}
