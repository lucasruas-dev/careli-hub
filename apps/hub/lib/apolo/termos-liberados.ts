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
export const TERMO_DE_RESCISAO_LIBERADO = false;
export const TERMO_DE_ACORDO_LIBERADO = false;
