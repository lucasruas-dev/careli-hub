// OS TERMOS REDESENHADOS VÃO NO PACOTE, MAS SEM BOTÃO NA TELA.
//
// Decisão do Lucas (16/09/2026), ao autorizar o deploy do portal da Cecílio: *"Portal + planos,
// termos escondidos"*. A Simulação de Rescisão (extrato do cliente, no Apolo) e o Termo de Acordo
// (propostas, no Hades) foram redesenhados e aprovados na conferência, mas ainda esperam quatro
// respostas dele: o nome do papel da rescisão, a leitura do jurídico, se o acordo exige aprovação e
// a régua de atualização do acordo.
//
// ⚠️ POR QUE UMA CHAVE EM CÓDIGO, E NÃO SEPARAR OS ARQUIVOS DO DEPLOY. O código dos termos divide
// arquivos com o portal e com a hierarquia de planos (auth.ts, por exemplo), então ele sobe junto.
// O que não pode subir é a PORTA: com as chaves desligadas, nenhum operador vê o botão. As rotas
// continuam no ar atrás do login do hub, como qualquer rota interna sem tela.
//
// Ligar é trocar para `true` depois das respostas, com deploy e changelog.
export const TERMO_DE_RESCISAO_LIBERADO = false;
export const TERMO_DE_ACORDO_LIBERADO = false;
