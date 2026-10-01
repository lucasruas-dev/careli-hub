// OS TERMOS REDESENHADOS VÃO NO PACOTE, MAS SEM BOTÃO NA TELA.
//
// Decisão do Lucas (16/09/2026), ao autorizar o deploy do portal da Cecílio: *"Portal + planos,
// termos escondidos"*. A Simulação de Rescisão (extrato do cliente, no Apolo) e o Termo de Acordo
// (propostas, no Hades) foram redesenhados e aprovados na conferência, mas ainda esperam quatro
// respostas dele: o nome do papel da rescisão, a leitura do jurídico, se o acordo exige aprovação e
// a régua de atualização do acordo.
//
// ⚠️ DUAS DESSAS RESPOSTAS CHEGARAM EM 20/09/2026, E A CHAVE CONTINUA `false`. O Lucas mandou o
// TEXTO LEGAL do jurídico para entrar literal no termo, e respondeu a pergunta da aprovação com
// todas as letras: *"o acordo so pode ficar disponivel para envio depois da aprovacao"*. No mesmo
// dia o termo ganhou o caminho de ir para a assinatura na Clicksign (comprador, incorporador e
// Nívea Careli). ⚠️ O BOTÃO DE ENVIAR NASCE ATRÁS DESTA MESMA CHAVE, e não de uma nova: mandar para
// assinatura é o passo seguinte de emitir o termo, e uma segunda chave criaria o estado impossível
// de "não pode baixar, mas pode assinar". Ligar continua sendo decisão do Lucas.
//
// ⚠️ E DESDE 20/09/2026 ELA FECHA A ROTA, E NÃO SÓ O BOTÃO. `TERMO_DE_ACORDO_LIBERADO` é conferida
// no POST e no PATCH de `app/api/guardian/termo-de-acordo/assinatura` (os dois métodos que mandam
// e-mail para o cliente), que recusam com 503 enquanto ela estiver `false`. Esconder botão protege a
// TELA; o que protege a CONTA da Clicksign, que é de produção e onde cada envelope custa e o ativado
// não se apaga, é a rota recusar. O GET e o DELETE ficam de fora de propósito: o GET não cria nada e
// é como a tela mostra um envelope que já existe, e o DELETE é o gesto corretivo.
//
// ⚠️ POR QUE UMA CHAVE EM CÓDIGO, E NÃO SEPARAR OS ARQUIVOS DO DEPLOY. O código dos termos divide
// arquivos com o portal e com a hierarquia de planos (auth.ts, por exemplo), então ele sobe junto.
// O que não pode subir é a PORTA: com as chaves desligadas, nenhum operador vê o botão. As rotas
// continuam no ar atrás do login do hub, como qualquer rota interna sem tela.
//
// Ligar é trocar para `true` depois das respostas, com deploy e changelog.
//
// ⚠️ O ACORDO FOI LIGADO EM 21/09/2026. Lucas, respondendo ao chamado TI-000146 da Cinthia
// (*"hoje o acordo não vem em formato de documento, mas precisamos gerar esse documento"*):
// *"pode ligar o termo de acordo"*.
//
// ⚠️ E LIGAR ABRE AS DUAS COISAS, porque a chave é uma só, de propósito (ver a nota acima):
// baixar o PDF do termo E mandar para a assinatura na Clicksign, que é conta de PRODUÇÃO, onde
// cada envelope custa e o ativado não se apaga. O que protege daqui em diante não é mais a
// chave, é o gate: `motivoParaNaoEnviarParaAssinatura` exige acordo APROVADO (regra do Lucas em
// 20/09/2026, *"o acordo so pode ficar disponivel para envio depois da aprovacao"*, valendo
// também para reenvio) e recusa o que já foi assinado. Medido em 21/09/2026: dos 40 acordos
// vivos, 18 estão aprovados e 22 reprovados; para os 22 o botão nasce apagado com a frase do
// motivo. E nenhum cron toca nisso: não existe envio automático, só clique de gente.
//
// ⚠️ A RESCISÃO CONTINUOU DESLIGADA EM 21/09, e a decisão foi só sobre o acordo.
//
// ⚠️ A RESCISÃO FOI LIGADA EM 30/09/2026. As duas respostas que ela esperava chegaram do Lucas no
// mesmo dia: o nome fica "Simulação de Rescisão", e o texto sai como está (os quatro tópicos
// curtos de 16/09; o texto do jurídico de 20/09 era do ACORDO, não desta). Três coisas vieram
// junto, e são elas que protegem daqui em diante, não a chave:
//   • SEM PREMISSA, NÃO EMITE. `carregarTermoDeRescisao` recusa com 422 quando qualquer linha do
//     papel sairia pela praxe. Ligado com cadastro para Lavra do Ouro (LOU e LOS), Morada da Serra,
//     Vale do Ouro e Recanto do Pará; os demais respondem com a frase até serem cadastrados.
//   • `viewer` NÃO BAIXA: a rota do PDF passou para o portão de escrita do Apolo.
//   • RUBRICA DESLIGADA NÃO CAI MAIS NA PRAXE (`premissasDoRecorte`), senão Vale do Ouro e
//     Recanto pagariam publicidade e tributos que os contratos deles não preveem.
// E ligar não abre envio nenhum: a rescisão não tem Clicksign nem e-mail. É só o GET do PDF, que
// o operador baixa e entrega. Cliente sem vínculo com o C2X (a carteira da Cecílio, que mora no
// Panteon) nem vê o botão: o painel do extrato para antes, em "Cadastro sem vinculo com o C2X".
export const TERMO_DE_RESCISAO_LIBERADO = true;
export const TERMO_DE_ACORDO_LIBERADO = true;
