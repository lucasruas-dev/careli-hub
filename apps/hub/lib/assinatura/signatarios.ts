import type { DadosDoContrato } from "@/lib/temis/preencher-contrato";

import type { PapelNoContrato, Signatario } from "./tipos";
import { nomeDeSignatario } from "./ordem";

// QUEM ASSINA — extraído do CONTRATO, nunca digitado.
//
// ⚠️ ISTO NÃO É UM FORMULÁRIO, E ESSA É A DECISÃO INTEIRA DO ARQUIVO. O operador não digita nome
// nem e-mail de signatário: eles saem de `dadosDaProposta`, a MESMA leitura que imprimiu a
// qualificação no papel. Digitar de novo criaria a possibilidade de o contrato dizer "Henrique
// Sales do Vale, CPF 999.999.004-53" e o envelope ir para outra pessoa — e o defeito só apareceria
// quando alguém comparasse o PDF assinado com o cadastro, meses depois.
//
// ⚠️ E POR ISSO A CONFERÊNCIA ACONTECE AQUI, ANTES DA API. Ver `conferirSignatarios`: e-mail
// repetido e signatário sem e-mail são recusados com nome e sobrenome de quem falha, ANTES de
// existir envelope. A alternativa — deixar a Clicksign recusar — deixaria um envelope criado, pago
// e (depois de ativado) impossível de apagar, com metade dos signatários dentro.
//
// ── DE ONDE SAI CADA UM ──────────────────────────────────────────────────────
//
//     comprador   compradores[i].valores.nome_cliente / email_cliente / cpf_cliente
//     cônjuge     compradores[i].valores.nome_conjuge / email_conjuge / cpf_conjuge
//     imobiliária gerais.nome_vinculado / email_vinculado (a da venda)
//     vendedora, coordenadora e testemunha: SÓ o quadro do empreendimento (`doQuadro`)
//
// ⚠️ A VENDEDORA SAI SÓ DO QUADRO (25/09/2026). Havia uma segunda via, as variáveis
// `gerais.vendedora_representante_*` ("representante legal da ficha"), que nunca foi escrita por
// ninguém (medido por busca no código em 13/09 e de novo em 25/09/2026: zero produtores). Ela saiu
// quando o Lucas decidiu que o quadro é a única fonte de quem assina (*"todas assinaturas eu tenho
// que conseguir excluir e editar"*, *"nao tem que ter mais sync com c2x referente a contrato"*):
// uma segunda via, mesmo morta, é um lugar onde alguém um dia pluga a ficha de novo.
//
// Faltar vendedora NÃO recusa o envio: recusar travaria o primeiro teste do ZZ TESTE por um
// cadastro que ninguém preencheu ainda. Sai como AVISO, que a tela mostra ao lado do botão, e quem
// confirma vê que a vendedora não vai no envelope.

/** Uma pessoa pronta para virar signatário: o `Signatario` sem o número da ordem. */
export type Pessoa = Omit<Signatario, "ordem">;

export type MontagemDosSignatarios = {
  /** O que falta e não impede o envio (a vendedora sem cadastro é o caso de hoje). */
  avisos: string[];
  pessoas: Pessoa[];
};

/**
 * Os signatários deste contrato.
 *
 * ⚠️ A ORDEM DA LISTA É A DO CONTRATO — titular, cônjuge do titular, segundo comprador, cônjuge do
 * segundo… e a vendedora por último. Não é a ordem de ASSINATURA (quem decide isso é
 * `ordenarSignatarios`, por papel): é a ordem em que a tela mostra as pessoas para conferência, e
 * ela tem de bater com a ordem em que os nomes aparecem na qualificação do papel. Ler uma lista
 * fora da ordem do documento é o que faz alguém aprovar o cônjuge errado num contrato de dois
 * casais.
 */
export function signatariosDoContrato(
  dados: DadosDoContrato,
  /**
   * As pessoas do QUADRO do empreendimento — vendedora, coordenador e testemunha.
   *
   * ⚠️ ELAS NÃO SAEM DO CONTRATO, e por isso chegam por fora. Comprador e cônjuge são lidos da
   * proposta (a mesma leitura que imprimiu a qualificação no papel); estas são CADASTRADAS no
   * empreendimento, em `temis_assinantes`, e lidas por `lib/assinatura/quadro-db.ts`. Passar por
   * parâmetro mantém esta função pura — ela roda no navegador junto com a tela de envio.
   */
  doQuadro: Pessoa[] = [],
): MontagemDosSignatarios {
  const pessoas: Pessoa[] = [];
  const avisos: string[] = [];

  for (const comprador of dados.compradores) {
    const v = comprador.valores;

    const nome = texto(v.nome_cliente);
    if (nome) {
      pessoas.push({
        cpf: texto(v.cpf_cliente) || texto(v.cnpj_cliente) || null,
        email: texto(v.email_cliente),
        nome,
        papel: "comprador",
        telefone: texto(v.telefone_cliente) || null,
      });
    }

    // ⚠️ O CÔNJUGE SÓ ENTRA SE `temConjuge`, e não "se tiver nome_conjuge". É a mesma bandeira que
    // liga o bloco `[inicio_dados_conjuge]` no papel: se o contrato NÃO qualificou o cônjuge,
    // mandá-lo assinar poria no envelope alguém que o documento não menciona.
    if (comprador.temConjuge) {
      const nomeDoConjuge = texto(v.nome_conjuge);
      if (nomeDoConjuge) {
        pessoas.push({
          cpf: texto(v.cpf_conjuge) || null,
          email: texto(v.email_conjuge),
          nome: nomeDoConjuge,
          papel: "conjuge",
          telefone: texto(v.telefone_conjuge) || null,
        });
      }
    }
  }

  // ⚠️ A IMOBILIÁRIA VINCULADA VEM DA VENDA, E NÃO DO QUADRO — é a diferença que decide o desenho.
  //
  // O quadro (`temis_assinantes`) guarda quem assina SEMPRE por aquele empreendimento: a vendedora,
  // o coordenador, as testemunhas. A imobiliária muda a cada venda, como o comprador muda, e por
  // isso ela sai dos DADOS DO CONTRATO — das mesmas chaves que o papel já imprime no item VIII.
  // Fosse pelo quadro, seria preciso cadastrar cada imobiliária em cada empreendimento e escolher a
  // certa na hora do envio.
  //
  // ⚠️ QUEM ASSINA É A PESSOA JURÍDICA, e não o corretor. Lucas, 23/09/2026, escolhendo entre as
  // duas: a imobiliária, no e-mail cadastrado dela. É também a via que TEM dado — medido no mesmo
  // dia, 4.929 das 4.947 propostas com imobiliária têm a ponte que preenche `email_vinculado`,
  // contra 18 que têm `imobiliaria_entity_id` (o caminho do representante legal, que a vendedora e
  // o coordenador usavam até 25/09/2026 e que aqui seria um beco).
  //
  // ⚠️ ATÉ 23/09/2026 ELA NUNCA ERA CONVIDADA. O papel `corretor` existia no vocabulário e na tela
  // do Setup — dava para numerá-lo na ordem, e o Villa Paris tem isso gravado —, mas nenhuma função
  // do Panteon produzia um signatário com ele. Medido na venda da VITORIA, que TEM imobiliária
  // vinculada: saíam 11 signatários, nenhum corretor. Nívea, no dia anterior: *"não está trazendo a
  // imobiliária"*.
  const daImobiliaria = texto(dados.gerais.nome_vinculado);
  if (daImobiliaria) {
    const emailDela = texto(dados.gerais.email_vinculado);

    // ⚠️ A MESMA EMPRESA NÃO ASSINA DUAS VEZES. A coordenadora de vendas costuma ser uma
    // imobiliária também (no Vale do Ouro é a Gurgel), e ela já entra pelo quadro: repetir o mesmo
    // e-mail poria a mesma pessoa duas vezes no envelope, o que a própria `conferirSignatarios`
    // recusa logo abaixo — e a recusa apareceria como defeito, não como duplicata evitada.
    const jaEstaNoEnvelope = emailDela
      ? [...pessoas, ...doQuadro].some((p) => p.email.toLowerCase() === emailDela.toLowerCase())
      : false;

    if (!jaEstaNoEnvelope) {
      pessoas.push({
        cpf: texto(dados.gerais.cpf_cnpj_vinculado) || null,
        email: emailDela,
        nome: daImobiliaria,
        papel: "corretor",
        telefone: texto(dados.gerais.telefone_vinculado) || null,
      });
    }
  }

  // As pessoas cadastradas no quadro: vendedora, coordenador de vendas e testemunha.
  for (const p of doQuadro) pessoas.push(p);

  // ⚠️ O NOME SAI NO PADRÃO DA CASA, e é aqui que ele passa. Ver `nomeDeSignatario`: as fontes são
  // diferentes (o cadastro guarda em caixa alta, o usuário do hub não) e o documento é um só.
  for (const p of pessoas) p.nome = nomeDeSignatario(p.nome);

  // ⚠️ O AVISO É SOBRE O ENVELOPE SAIR SEM A PARTE VENDEDORA, e isso já aconteceu: dos três
  // envelopes de produção medidos em 13/09/2026, nenhum tinha vendedora, e um deles fechou como
  // assinado com um único signatário.
  if (!pessoas.some((p) => p.papel === "vendedora")) {
    avisos.push(
      "Ninguém assina pela VENDEDORA, então o envelope sai só com o comprador. " +
        "Cadastre quem assina por ela no Quadro de assinatura do empreendimento.",
    );
  }

  // ⚠️ A COORDENADORA IMPRESSA NO CONTRATO SEM NINGUÉM PARA ASSINAR POR ELA (25/09/2026). É o
  // defeito do VOR: *"o fabricio não aparece para assinar"*. Enquanto o quadro herdava da ficha, um
  // papel vazio ainda levava alguém; sem a herança, papel vazio é envelope sem a coordenação, e o
  // único jeito de o operador saber antes de clicar é esta frase. Só avisa quando o contrato
  // QUALIFICA uma coordenadora (o texto imprime a razão social dela): empreendimento sem coordenação
  // de vendas não tem de quem sentir falta.
  const coordenadoraNoContrato = coordenadoraSemQuemAssine(dados, pessoas);
  if (coordenadoraNoContrato) {
    avisos.push(
      `O contrato qualifica a COORDENADORA DE VENDAS (${coordenadoraNoContrato}), mas ninguém assina por ela. ` +
        "Cadastre quem assina no bloco Coordenador de Vendas do Quadro de assinatura do empreendimento.",
    );
  }

  // ⚠️ A TESTEMUNHA TEM LINHA NO PAPEL MESMO SEM GENTE NO QUADRO, e um contrato com linha de
  // testemunha em branco volta do cartório. O aviso é barato; descobrir depois de assinado não é.
  if (!pessoas.some((p) => p.papel === "testemunha")) {
    avisos.push(
      "Nenhuma TESTEMUNHA cadastrada neste empreendimento: o contrato vai para assinatura sem elas.",
    );
  }

  return { avisos, pessoas };
}

/**
 * A coordenadora que o contrato QUALIFICA e por quem ninguém assina: a razão social dela, ou `null`.
 *
 * ⚠️ UMA FUNÇÃO, E NÃO A CONTA DENTRO DO AVISO, porque são dois leitores com a mesma pergunta: o
 * aviso de `signatariosDoContrato` e a trava da virada da 0191 (`impedimentoDaVirada0191`, em
 * `quadro-db.ts`), que só vale enquanto a migration não foi aplicada. Duas contas iguais escritas
 * em dois lugares divergem no primeiro ajuste, e foi uma divergência dessas (tela e envio com regras
 * diferentes) que deixou o Fabricio fora do contrato no VOR.
 */
export function coordenadoraSemQuemAssine(
  dados: DadosDoContrato,
  pessoas: readonly Pessoa[],
): null | string {
  const coordenadora =
    texto(dados.gerais.razao_social_coordenadora_vendas) ||
    texto(dados.gerais.nome_fantasia_coordenadora_vendas);
  if (!coordenadora) return null;
  return pessoas.some((p) => p.papel === "coordenadora") ? null : coordenadora;
}

// ── A CONFERÊNCIA, ANTES DE EXISTIR ENVELOPE ────────────────────────────────

export type Veredito = { ok: true } | { erro: string; ok: false };

/**
 * Dá para mandar esta lista para a Clicksign?
 *
 * A ordem das checagens é a ordem em que elas ajudam quem lê: primeiro "não há ninguém", depois
 * "falta e-mail de fulano", depois "fulano e beltrano têm o mesmo e-mail", e por último o formato do
 * nome. Uma mensagem por vez, com NOMES — "2 signatários inválidos" manda a pessoa procurar.
 */
export function conferirSignatarios(pessoas: readonly Pessoa[]): Veredito {
  if (pessoas.length === 0) {
    return {
      erro:
        "Este contrato não tem nenhum signatário: a proposta não trouxe comprador com nome. " +
        "Confira o cadastro do comprador e gere o contrato de novo.",
      ok: false,
    };
  }

  // ⚠️ SEM E-MAIL NÃO HÁ SIGNATÁRIO. É o campo por onde o convite sai, e a Clicksign cadastra o
  // signatário sem ele (o e-mail é "condicional" na doc) — o que produziria uma pessoa dentro do
  // envelope que NUNCA recebe o link e trava o contrato para sempre, sem erro nenhum.
  const semEmail = pessoas.filter((p) => !p.email);
  if (semEmail.length > 0) {
    return {
      erro:
        `${listar(semEmail.map((p) => `${p.nome} (${rotulo(p.papel)})`))} ${semEmail.length === 1 ? "está" : "estão"} sem e-mail, ` +
        "e é por ele que a Clicksign manda o convite de assinatura. Preencha o e-mail no cadastro e tente de novo.",
      ok: false,
    };
  }

  // ⚠️ E-MAIL REPETIDO É A ARMADILHA CONHECIDA, e ela tem um dono: o cônjuge que compartilha a caixa
  // do titular. Está catalogada nas armadilhas do D4Sign da casa
  // ([[reference_d4sign_escrita_armadilhas]]) e é a razão de a CAD ter passado a travar e-mail
  // repetido (`lib/apolo/email-unico.ts`).
  //
  // ⚠️ A COMPARAÇÃO É EM MINÚSCULAS E SEM ESPAÇO, porque é assim que os dois provedores comparam.
  // "Joao@X.com" e "joao@x.com " são o MESMO endereço lá; conferir letra a letra aqui deixaria
  // passar exatamente o caso que esta função existe para pegar.
  const porEmail = new Map<string, Pessoa[]>();
  for (const p of pessoas) {
    const chave = p.email.trim().toLowerCase();
    porEmail.set(chave, [...(porEmail.get(chave) ?? []), p]);
  }

  for (const [email, donos] of porEmail) {
    if (donos.length > 1) {
      return {
        erro:
          `${listar(donos.map((p) => `${p.nome} (${rotulo(p.papel)})`))} usam o MESMO e-mail (${email}), ` +
          "e a Clicksign não aceita dois signatários com o mesmo endereço — o envelope sairia com uma pessoa a menos. " +
          "Cadastre um e-mail próprio para cada um e tente de novo.",
        ok: false,
      };
    }
  }

  // ⚠️ NOME DE UMA PALAVRA SÓ É RECUSADO PELA CLICKSIGN, e isso é da doc deles, não invenção nossa:
  // *"Informe ao menos um `Nome` e um `Sobrenome`"*, e o campo não aceita numerais. Descobrir isso
  // no meio do cadastro dos signatários deixaria o envelope criado com os primeiros dentro.
  const nomeCurto = pessoas.filter((p) => p.nome.trim().split(/\s+/).length < 2);
  if (nomeCurto.length > 0) {
    return {
      erro:
        `${listar(nomeCurto.map((p) => `"${p.nome}" (${rotulo(p.papel)})`))} ${nomeCurto.length === 1 ? "está" : "estão"} sem sobrenome no cadastro, ` +
        "e a Clicksign exige nome e sobrenome. Complete o nome no cadastro e tente de novo.",
      ok: false,
    };
  }

  const nomeComNumero = pessoas.filter((p) => /\d/.test(p.nome));
  if (nomeComNumero.length > 0) {
    return {
      erro:
        `${listar(nomeComNumero.map((p) => `"${p.nome}" (${rotulo(p.papel)})`))} ${nomeComNumero.length === 1 ? "tem" : "têm"} número no nome, ` +
        "e a Clicksign recusa. Corrija o nome no cadastro e tente de novo.",
      ok: false,
    };
  }

  return { ok: true };
}

// ── AUXILIARES ──────────────────────────────────────────────────────────────

/**
 * ⚠️ `?? ""` NÃO SERVE AQUI. `dados-do-contrato.ts` promete não escrever string vazia ("ou a chave
 * tem valor de verdade, ou ela não é escrita"), mas quem chama esta função pode montar o objeto de
 * outro jeito — e o nullish deixaria `""` passar como se fosse um e-mail
 * ([[reference_nullish_nao_troca_string_vazia]]).
 */
function texto(bruto: undefined | string): string {
  return String(bruto ?? "").trim();
}

/** "A", "A e B", "A, B e C" — a lista como uma pessoa lê, não como um array. */
function listar(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * O papel em minúsculas, para caber no meio da frase.
 *
 * ⚠️ NÃO REUSA `rotuloDoPapel`: aquele é o rótulo de TELA ("Coordenadora de vendas"), com
 * maiúscula, e no meio de uma frase ele sairia como "Fulano (Coordenadora de vendas) está sem
 * e-mail". Dois usos diferentes do mesmo dado.
 */
function rotulo(papel: PapelNoContrato): string {
  const mapa: Record<PapelNoContrato, string> = {
    careli: "Careli",
    comprador: "comprador",
    conjuge: "cônjuge",
    coordenadora: "coordenadora",
    corretor: "corretor",
    testemunha: "testemunha",
    vendedora: "vendedora",
  };
  return mapa[papel];
}
