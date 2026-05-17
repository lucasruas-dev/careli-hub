# Contexto operacional do Careli Hub

Este documento e a memoria viva do projeto para novos agentes. Ele deve ser lido antes de qualquer mudanca no `careli-hub`, principalmente em trabalhos envolvendo C2X legado, Guardian, CareDesk, PulseX, Setup, Supabase, Vercel ou integracoes externas.

## Como usar

- Leia este arquivo antes de editar codigo.
- Leia este arquivo tambem antes de analisar bugs, impactos, regras, estabilidade, integracoes ou conflitos entre modulos. Os devs de cada modulo podem atualizar este diario, entao ele e a fonte mais recente para entender se uma mudanca impacta Guardian, CareDesk, PulseX, Setup, Home, Supabase, C2X ou integracoes externas.
- Confirme se a tarefa atual toca Guardian, CareDesk, PulseX, Setup, Home, Supabase, C2X, Asaas, D4Sign ou Meta.
- Respeite a ordem combinada pelo Lucas: quando ele pedir analise, nao implemente; quando ele pedir implementacao, faca de ponta a ponta e valide.
- Nao misture modulos sem necessidade. O CareDesk e modulo do Hub; Guardian usa o CareDesk como atalho/entrada operacional, mas nao e dono do CareDesk.
- Atualize este documento quando uma decisao importante for tomada.
- Trate este arquivo como diario vivo do projeto. Tudo que for combinado, decidido ou validado sobre regra, processo, comportamento, arquitetura, deploy ou operacao deve ser registrado aqui de forma objetiva, principalmente quando houver commit.

## Manifesto operacional da engenharia Careli Hub

Regra permanente definida por Lucas em 2026-05-16: o Careli Hub deve ser tratado como ecossistema operacional enterprise, modular, integrado e orientado a operacao real da Careli. O objetivo da engenharia nao e apenas gerar codigo, mas preservar continuidade arquitetural, estabilidade, contexto de negocio, padrao visual, seguranca, rastreabilidade e qualidade tecnica.

Papel do Lucas:

- Lucas e o orquestrador operacional e estrategico do Hub.
- Lucas define prioridades, aprova direcionamentos, coordena handoffs, controla deploys, aprova mudancas criticas, valida experiencia operacional e decide arquitetura macro.
- Todos os agentes devem considerar Lucas a autoridade central do fluxo operacional.

Filosofia do produto:

- O Hub nao deve virar SaaS generico, dashboard poluido, sistema excessivamente explicativo, produto inchado ou ambiente desconectado da operacao real.
- O Hub deve ser executivo, operacional, compacto, realtime quando fizer sentido, modular, consistente, integrado, enterprise e orientado a produtividade operacional.

Regras gerais obrigatorias:

- Nunca perder contexto operacional: antes de implementar, ler este diario, revisar regras anteriores e validar impactos entre modulos.
- Nao misturar escopos: Guardian nao altera PulseX; Infra nao altera UX; QA nao implementa feature; Security nao redefine regra de negocio; modulo nao redefine arquitetura global sem pedido explicito.
- Nao implementar sem analise: entender impacto, dependencias e riscos antes de editar.
- Registrar tudo que for relevante: melhoria, correcao, decisao, deploy, validacao, descoberta tecnica, integracao ou comportamento operacional.
- Nao expor secrets: nunca expor tokens, senhas, credenciais ou chaves; nao usar secrets client-side.
- Validar antes de concluir: toda entrega deve informar validacao tecnica, impacto operacional, riscos conhecidos e pendencias.

Fluxo operacional oficial:

- Fluxo padrao: Implementacao -> QA -> Revisao Arquitetural -> Infra/Deploy -> Producao -> Monitoramento.
- Nenhum deploy critico deve ocorrer sem validacao minima.
- Producao e ambiente critico: validar antes, evitar alteracoes destrutivas, monitorar depois, preservar estabilidade e manter rastreabilidade.
- Deploys devem preferir homologacao/teste antes de producao quando houver risco operacional.

Regra oficial de commit, validacao e rastreabilidade:

- Todo agente responsavel por implementacao deve realizar o commit da propria alteracao apos validacao basica local.
- Antes do commit, validar obrigatoriamente build, lint, typecheck e possiveis impactos operacionais, salvo quando a mudanca for estritamente documental; nesse caso, registrar o motivo de nao rodar validacoes tecnicas.
- O commit deve ter mensagem semantica, objetiva e representar apenas uma responsabilidade principal.
- Nao misturar multiplos modulos ou responsabilidades no mesmo commit sem necessidade real.
- Se o worktree tiver alteracoes de outra squad, de outro agente ou do Lucas, o agente deve stagear e commitar somente os arquivos do proprio escopo.
- Fluxo operacional oficial de entrega implementada: Implementacao -> validacao basica -> commit -> atualizacao do diario operacional com commit/mensagem/impacto -> handoff -> QA -> deploy.
- Ao concluir uma implementacao, o agente deve informar commit realizado, status operacional, proxima squad recomendada, pendencias e riscos conhecidos.
- Squads de validacao, arquitetura e seguranca normalmente nao devem realizar commits de implementacao, salvo quando executarem correcoes diretamente.

Status operacionais obrigatorios:

- `ANALISANDO`
- `IMPLEMENTANDO`
- `VALIDANDO`
- `AGUARDANDO QA`
- `AGUARDANDO ARCHITECT`
- `AGUARDANDO DEPLOY`
- `FINALIZADO`
- `BLOQUEADO`

Fluxo de comunicacao e handoff:

- Responder de forma objetiva, executiva e operacional.
- Sempre informar o que foi feito, o que falta, dependencias de outro agente, proximo passo, riscos conhecidos e status atual.
- Ao finalizar uma implementacao, indicar o status de handoff. Exemplo: `Status: AGUARDANDO QA`; solicitar validacao desktop, mobile, regressao e performance ao Hub QA; depois da aprovacao, solicitar deploy ao Hub InfraOps.

Regra de orquestracao entre agentes:

- Todo agente faz parte da engenharia coordenada do Careli Hub e nao atua de forma isolada.
- Ao concluir uma etapa, informar claramente a proxima squad recomendada, validacoes necessarias, dependencias, riscos conhecidos e pendencias.
- Squads reconhecidas no fluxo operacional: `Hub Architect`, `Hub InfraOps`, `Hub DataOps`, `Hub QA`, `Hub Security`, `Hub Support Engineer`, `Guardian Core`, `CareDesk Core`, `PulseX Core` e futuras squads do Hub.
- Nunca executar tarefa claramente pertencente a outra squad sem solicitacao explicita do Lucas.
- Exemplos de limite de escopo: QA nao implementa feature; InfraOps nao altera UX; modulo nao redefine arquitetura global; Security nao altera regra operacional; Architect nao realiza deploy operacional.
- Operar sempre considerando continuidade entre sessoes, continuidade entre squads, preservacao do diario operacional, estabilidade do ecossistema e possibilidade de outro agente continuar a etapa seguinte.

Regras de UX e interface:

- Manter o padrao visual executivo, compacto, clean, operacional, consistente e denso sem poluicao visual.
- Evitar excesso de texto, excesso de cards, visual generico de startup, experiencias artificiais e interfaces inchadas.
- Priorizar clareza operacional, velocidade, consistencia visual e produtividade.

Regras de arquitetura:

- Priorizar modularizacao, baixo acoplamento, performance, rastreabilidade, integracao controlada, seguranca e escalabilidade.
- Evitar duplicacao desnecessaria, dependencia circular, regras espalhadas e acoplamento indevido entre modulos.

Regras de seguranca:

- Toda acao sensivel exige validacao, confirmacao humana, rastreabilidade e controle server-side.
- Nunca executar automaticamente envio financeiro, disparos em massa, alteracao financeira ou alteracao critica de producao.

Regra permanente da squad:

- Os agentes nao atuam como ferramentas isoladas; fazem parte da engenharia coordenada do Careli Hub.
- Sempre que houver duvida, analisar antes de agir, validar impacto, priorizar estabilidade e preservar o padrao do ecossistema.

## Perfil do Lucas e forma de trabalho

Lucas conduz o produto de forma bem direta. Ele prefere que o agente execute com cuidado, mantendo o historico das decisoes. Quando ele corrige algo, a correcao vira regra para as proximas tarefas.

Preferencias recorrentes:

- Falar em portugues do Brasil.
- Chamar o usuario de Lucas quando fizer sentido.
- Revisar os topicos ja discutidos antes de agir.
- Evitar textos explicativos desnecessarios dentro da interface.
- Preferir interface executiva, densa, profissional e objetiva.
- Usar dados reais quando o fluxo ja tem fonte real.
- Nao mostrar mockup quando dados reais estiverem carregando; usar traco, skeleton discreto ou ultimo estado conhecido.
- Validar mudancas importantes.
- Nao expor secrets.

## Careli e contexto de negocio

A Careli faz gestao financeira e operacional para empreendimentos imobiliarios, com foco em loteamentos. Incorporadores contratam a Careli para cuidar de backoffice: cadastro de empreendimento, unidades, propostas, contratos, assinaturas, faturamento, boletos, cobranca e gestao de carteira.

Fluxo principal:

1. Cadastra-se o empreendimento.
2. Cadastram-se as unidades a venda, com quadra, lote, metragem, valor e codigo.
3. Registra-se reserva/venda da unidade.
4. Caso a reserva avance, vira proposta.
5. A proposta segue para contrato.
6. O contrato pode ser fechado, reaberto, editado e fechado novamente.
7. O contrato fechado e enviado manualmente para assinatura.
8. Depois da assinatura, a venda segue para faturamento.
9. Depois de faturado, a queda da venda deve ocorrer por rescisao.

A Careli tem dois produtos operacionais importantes:

- Gestao de Lancamento: proposta, contrato, assinatura, organizacao documental e comissoes de lancamento.
- Gestao de Carteira: emissao, acompanhamento, cobranca e gestao dos boletos/parcelas de financiamento.

## C2X legado

O C2X e o sistema legado principal da Careli. O banco conectado ao projeto deve ser tratado como banco C2X. Ele e a referencia operacional e financeira enquanto o Hub evolui.

### Tabela `users`

A tabela `users` concentra todos os cadastros, nao apenas usuarios internos:

- Administradores e colaboradores internos.
- Clientes.
- Imobiliarias.
- Corretores.
- Coordenadores, gerentes e demais envolvidos.

Clientes estao vinculados a uma imobiliaria/corretor dentro da propria `users`, pelo campo `vinculed_by_id` ou equivalente. Quando for pessoa juridica, o nome pode estar em campo diferente: trazer nome fantasia quando existir; se estiver vazio, trazer razao social.

Campos de cliente que devem ser aproveitados no Guardian/CareDesk:

- Nome.
- Documento.
- Tipo de pessoa.
- E-mail.
- Telefone/WhatsApp.
- Endereco completo.
- Cidade.
- Sexo.
- Data de nascimento e idade.
- Estado civil.
- Regime de bens.
- Profissao.
- Renda.
- Escolaridade.
- Nacionalidade/naturalidade.
- Nome da mae.
- Conjuge e dados completos do conjuge, quando houver.

Dados do conjuge devem ficar ocultos por padrao e expansivos.

### Empreendimentos

O cadastro de empreendimentos fica na tabela de empreendimentos do C2X. Cada empreendimento possui uma sigla de tres letras que compoe o codigo da unidade junto com quadra e lote.

Regras combinadas para normalizacao:

- Lavra do Ouro: considerar como um produto unico, mesmo que existam etapas/siglas diferentes.
- Portal dos Vales: considerar como um produto unico, etapas agrupadas.
- MVF Empreendimentos: RDP e RPS representam etapas; tratar como um empreendimento agrupado.
- TSC e SDT: empreendimentos de teste; nao trazer dados deles para o Hub.
- Lagoa Bonita: LBP, LBF e LBR sao produtos/visoes validas e devem aparecer separados.
- Lagoa Bonita deve ser exibido como `Lagoa Bonita - LBR`, `Lagoa Bonita - LBP`, etc. Nao trazer nomes como Paulo/Rocha na exibicao.
- Fora Lagoa Bonita, exibir o nome do empreendimento sem sigla.

### Unidades

O codigo da unidade esta no campo `unities.name`. A regra de formacao e sigla do empreendimento + quadra + lote.

No contexto do Guardian, Lucas tambem usa "unidade" como a carteira/contrato associado ao cliente. Evite trocar a nomenclatura sem alinhamento. Na IA, mantenha o contexto como unidade quando estiver falando da tela; internamente pode haver relacao com contrato.

### Vendas e `acquisition_requests`

A tabela `acquisition_requests` representa o fluxo de reserva/venda/proposta/contrato. Cada reserva gera uma requisicao/venda na tabela principal. Uma mesma unidade pode ter varias movimentacoes historicas.

Fluxo conceitual:

- Reserva de unidade: torna a unidade indisponivel para outros clientes.
- Reserva cancelada: unidade volta a ficar disponivel.
- Proposta: cliente avancou na compra.
- Contrato: proposta foi formalizada.
- Assinatura: contrato enviado e assinado.
- Faturado: venda faturada.
- Rescisao: unica forma correta de derrubar venda faturada.

Existe tabela historica de aquisicao/movimento que registra mudancas de etapa/status.

### Assinaturas e D4Sign

A Careli usa D4Sign para assinatura. O envio para assinatura e manual porque em alguns casos o contrato precisa ser reaberto, editado manualmente e fechado de novo antes do envio.

No Guardian:

- Documento deve aparecer como `Contrato`, nao `Contrato de compra`.
- O botao/codigo da unidade deve abrir o contrato.
- Links expirados da D4Sign nao devem ser persistidos como solucao final.
- O ideal e endpoint server-side que gere/recupere link valido quando o usuario clicar.
- Se credenciais D4Sign nao estiverem configuradas, mostrar erro claro de configuracao, nao 404 generico.
- Status validado em 2026-05-16: a rota interna `/api/guardian/d4sign/contracts/[documentId]` chama a D4Sign server-side e retorna PDF. Em producao, o contrato do cliente Armando foi validado com `200`, `application/pdf` e arquivo real. A tela deve apontar para essa rota, nunca para link bruto/expiravel persistido.

## Pagamentos, carteira e inadimplencia

A tabela foco para Guardian financeiro/cobranca e `payments`.

### Cards principais do Guardian

Cards que devem usar dados reais:

- Carteira total.
- Inadimplencia.
- Valor em atraso.
- Recuperacao mensal.
- Clientes em atraso.
- Contratos criticos.

Regras:

- Carteira total: valor total da carteira conforme parcelas do C2X. Deve ser validado contra o legado.
- Valor em atraso: soma das parcelas vencidas.
- Inadimplencia: valor vencido dividido por `(valor vencido + valor liquidado)`. Nao entram parcelas a vencer.
- Percentual liquidado em detalhe de unidade: valor liquidado dividido pelo total da carteira daquela unidade/contrato.
- Clientes em atraso: clientes distintos inadimplentes.
- Contratos criticos: contratos/unidades com mais de 3 parcelas em atraso.
- Recuperacao mensal: valor pago fora do vencimento original. Ate existir campo de referencia definitivo, considerar parcela recuperada quando paga mais de 10 dias apos o vencimento original.

Quando houver divergencia com o legado, comparar a formula e a origem dos campos antes de concluir que o Hub esta errado. O legado tambem pode estar errado.

### Parcelas

A tela de parcelas deve trazer:

- Referencia, hoje inferida pelo vencimento original enquanto nao existir campo especifico.
- Vencimento original.
- Vencimento atual.
- Data de pagamento.
- Valor.
- Dias de atraso.
- Status visual, mas evitar duplicar status em card separado quando ja houver badge no titulo da parcela.

Preferencias visuais:

- Vencimento original em azul.
- Datas alteradas devem ter diferenca visual.
- Status por badge no titulo.
- Botoes de boleto/fatura com fundo verde quando houver boleto disponivel.
- Quando nao houver link, usar cor/estado diferente e nao permitir acao enganosa.
- Tooltip deve seguir o layout do Hub, sem quebra feia.
- Saldo na fila deve ser compacto: `16k`, `105k`, etc.

### Asaas

A Asaas e usada para boletos, Pix, splits e informacoes de cobranca.

Regras de seguranca:

- Chaves Asaas ficam server-side.
- Nunca expor token no cliente, codigo, commit ou mensagem.

Uso no Guardian:

- Trazer somente o link da fatura/boleto quando solicitado.
- Em respostas da IA, "Boletos em aberto" deve ser a segunda opcao de acao rapida.
- Cada fatura/boleto deve aparecer em um balao separado.
- Quando a IA trouxer link de fatura/boleto, deve perguntar se o operador quer reenviar ao cliente.
- Deve existir confirmacao humana com botao Sim/Nao antes de qualquer envio.
- A resposta apos envio deve ser concreta: `Boleto enviado para o e-mail X e para o telefone Y`. Se faltar e-mail ou telefone, informar o que faltou.
- Se a Asaas permitir, buscar informacao de visualizacao da fatura e exibir com icone de olho: olho cortado para nao visualizado, olho normal para visualizado, tooltip com data/hora.
- Extratos Asaas, taxas, pagamentos e lancamentos ficam para o futuro modulo Financeiro.

## Split de pagamento

O split e uma parte mais nova no C2X. Nem todo empreendimento antigo tera split cadastrado, mas todos os pagamentos dos empreendimentos geridos podem existir.

Conceitos:

- Ato: valor fixo pago no dia do lancamento como compromisso/promessa inicial.
- Sinal: entrada real do empreendimento, definida por politica comercial.
- Parcela/Mensal: financiamento/carteira.

Na politica comercial do empreendimento ha percentuais de entrada e comissionamento. O split define como o valor pago e dividido entre:

- Imobiliaria/corretor.
- Captador.
- Gestora/Careli.
- Coordenacao.
- Gerente comercial.
- Incorporador, quando a Careli tambem faz a gestao dele.

O split deve ser usado futuramente para visoes gerenciais, especialmente valores reais da Careli. Para empreendimentos antigos sem split, Lucas explicara as percentagens quando necessario.

## Guardian

Guardian e o modulo de cobranca/carteira. Ele nao e a central de inteligencia do Hub; e um modulo que usa a inteligencia e o CareDesk.

Decisao operacional de 2026-05-17: Lucas definiu que Codex atuara como dev senior responsavel pela frente Guardian, apoiando arquitetura, planejamento, desenvolvimento, melhorias e validacao do modulo. Antes de qualquer acao no Guardian, revisar este contexto, preservar as regras de negocio registradas e manter alteracoes fora de CareDesk, PulseX e Setup somente quando o escopo pedir.

### Guardian Core

Regra operacional definida por Lucas em 2026-05-16: a frente Guardian deve ser conduzida pelo `Guardian Core` da engenharia Careli Hub.

Escopo do Guardian Core:

- Desenvolver, evoluir e manter o modulo Guardian.
- Construir telas, fluxos operacionais, dashboards, cobranca, detalhes de cliente, inteligencia operacional e integracoes do Guardian.
- Preservar cobranca, carteira, inadimplencia, acordos, parcelas, contratos, atendimento operacional de cobranca e inteligencia de recuperacao.
- Preservar performance, visao operacional, estabilidade, consistencia visual, UX executiva do Hub e regras financeiras.
- Manter integracoes controladas com CareDesk, C2X, Asaas, D4Sign e Caca.

Regras permanentes do Guardian Core:

- Nunca quebrar regras financeiras.
- Nunca alterar comportamento sem validar impacto.
- Nunca mockar dados quando houver fonte real disponivel.
- Priorizar dados reais, velocidade operacional e padrao executivo do Hub.
- Nao alterar CareDesk, PulseX, Setup, Infra ou outros modulos sem solicitacao explicita do Lucas.
- Toda acao sensivel do Guardian, especialmente financeira, envio de boleto, disparo, alteracao de contrato, acordo ou producao, exige confirmacao humana, rastreabilidade e controle server-side.

Quando acionar o Guardian Core:

- Melhoria ou construcao de tela do Guardian.
- Ajuste operacional de cobranca, carteira, inadimplencia, parcelas, contratos ou acordos.
- Dashboard financeiro ou metrica de recuperacao.
- Integracao financeira, C2X, Asaas, D4Sign, CareDesk ou Caca dentro do Guardian.
- UX operacional do Guardian.

Handoff padrao do Guardian:

- Informar: `Lucas, implementacao do Guardian concluida.`
- Listar modulos afetados.
- Listar implementacoes feitas.
- Listar pendencias e riscos conhecidos.
- Encerrar com status operacional: `AGUARDANDO QA` quando houver implementacao a validar, ou `FINALIZADO` quando for apenas decisao/documentacao sem necessidade de QA tecnico.

### Dashboard Guardian

Manter a ideia visual ja validada. Nao alterar estrutura sem pedido.

Painel financeiro:

- Cards reais, sem mockup.
- Atualizacao automatica a cada 30 segundos e sem data/hora visivel.
- Remover paineis mockados que nao agregam.
- Performance por empreendimento com dados reais.
- Carteira acumulada por empreendimento: valor acumulado do primeiro boleto ate o boleto presente, usando a base de inadimplencia acumulada (`vencidas + liquidadas`) e excluindo parcelas futuras.
- Ao clicar em um empreendimento na tabela de performance, os KPIs e o resumo financeiro do dashboard devem refletir o recorte daquele empreendimento. Clicar novamente no mesmo empreendimento volta para `Todos`.
- Nomes com primeira letra maiuscula e normalizados.
- Tabela compacta, com aproximadamente 7 linhas visiveis e restante rolavel.
- Ordenacao por coluna.
- Texto abaixo de recuperacao centralizado.
- Incluir quantidade de parcelas em atraso.
- Aging da inadimplencia com contagens reais.
- Composicao da cobranca com Ato, Sinal e Parcela.

Navegacao interna:

- Decisao de 2026-05-16: enquanto as telas internas do Guardian ainda nao estiverem prontas, esconder da sidebar do Guardian os atalhos `CareDesk`, `Inteligencia`, `Monitoramento`, `Relatorios` e `Setup`.
- Permanecem visiveis somente `Dashboard` e `Cobranca`.
- As rotas podem continuar existindo para acesso direto e desenvolvimento; a regra e nao expor telas incompletas na navegacao operacional.
- Deploy aplicado em 2026-05-16 com validacao `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e Vercel `dpl_5GmikQTKf44NmMdNbzfMLXWhu2JR`, alias em `https://c2x.app.br`.
- Decisao de UX de 2026-05-16: valores monetarios compactados/arredondados no Guardian, como `R$ 7,2 mi`, `R$ 198 mil` ou `R$ 15k`, devem manter a tela compacta, mas exibir o valor completo no hover (`title`) quando o operador passar o mouse.
- Deploy aplicado em 2026-05-16 para hover de valores completos em KPIs, resumo financeiro, performance por empreendimento e saldo compacto da fila. Validado com `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e Vercel `dpl_Dp8DXg9L6fjQVwaEf6NSQYzhps5q`, alias em `https://c2x.app.br`.

### Tela de cobranca

Esta tela e o coracao operacional de cobranca.

Regras:

- A fila operacional deve trazer clientes, nao contratos duplicados.
- A contagem da fila deve refletir clientes inadimplentes reais.
- Ordem padrao da fila: maior quantidade de parcelas vencidas para menor.
- Deve permitir filtro por empreendimento.
- Cards da fila devem mostrar atraso, parcelas vencidas, saldo e risco.
- Saldo deve ser resumido para nao quebrar layout.
- Perfil/status de risco por quantidade de parcelas vencidas:
  - 1 a 2: Baixo.
  - 3 a 6: Medio.
  - 7 a 12: Alto.
  - Mais de 12: Critico.
- Score de risco pode combinar quantidade de parcelas, dias de atraso, saldo e comportamento, mas a faixa de perfil acima e regra combinada.
- Se houver dados ruins ou faltantes, mostrar de forma clara.

Detalhe do cliente:

- Abaixo do nome, trazer tipo de pessoa e empreendimento.
- Incluir indicador de comportamento de pagamento: se antecipa, paga no vencimento ou atrasa, com media de dias. Exemplo: polegar para cima quando antecipa em media 5 dias; polegar para baixo quando atrasa em media X dias.
- Dados do cliente completos do C2X.
- Dados do conjuge completos, mas em bloco recolhido por padrao.
- Unidades/lotes vinculados devem trocar o detalhe principal quando clicadas.
- Documentos devem trazer contrato assinado quando possivel.
- Acordos futuros devem aparecer na area de documentos/operacao.
- Descoberta/correcao de 2026-05-16: quando um cliente deixa de estar inadimplente no C2X, o read-model do Supabase pode ficar temporariamente defasado ate a proxima sync. A tela de detalhe nao pode cair em mock de 60 parcelas para cliente C2X; deve buscar o detalhe direto no C2X mesmo sem parcelas vencidas e, se nao houver parcelas reais, mostrar estado vazio. Caso de referencia: Guilherme Aurelio Doliveira Alves / REPA10, no C2X com 127 parcelas, 6 pagas, 121 aguardando e 0 vencidas.
- Sync executada em producao em 2026-05-16 apos o deploy `dpl_Dp8DXg9L6fjQVwaEf6NSQYzhps5q`: `/api/guardian/sync/c2x` retornou 1119 linhas escritas e o cliente C2X `3806` deixou de ter linha `is_current=true` na fila do Supabase.

### IA do Guardian

A assistente se chama Caca. No cabecalho do chat usar:

- Nome: `Caca`.
- Subtitulo: `Assistente Virtual da Careli`.
- Foto fornecida pelo Lucas quando disponivel.

Regras da IA:

- Deve reconhecer o usuario logado e chamar Lucas pelo nome quando adequado.
- Ao pensar/carregar, usar frases como `So um instante, Lucas.`
- Deve ter acesso ao contexto real do cliente, parcelas, boletos, contrato e dados operacionais.
- Decisao de 2026-05-16: quando a Caca estiver aberta no detalhe de um cliente, esse cliente e a prioridade da resposta, mas ela nao deve ficar presa somente nele. Se o operador perguntar algo maior sobre fila, carteira, empreendimentos, risco, totais ou operacao geral, ela deve responder com o contexto geral disponivel.
- A Caca pode receber contexto server-side do banco/read-model do Guardian para formular respostas melhores, mas sem SQL livre, sem credenciais no cliente e sem acesso irrestrito. O acesso deve ser por consultas controladas, somente leitura, montando snapshots objetivos para o modelo.
- Deploy de 2026-05-16: a Caca passou a enviar para a IA o cliente aberto, o snapshot da fila filtrada/operacional e um contexto server-side `bancoDadosGuardian` gerado a partir do read-model do Guardian. O comportamento esperado e priorizar o cliente aberto quando a pergunta for daquele atendimento, mas responder perguntas gerais usando carteira/fila/empreendimento/risco/totais. Validado com `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e deploy Vercel `dpl_MgxLtm8Wt3NengT66Ab4SGq45UM4`, alias em `https://c2x.app.br`.
- Nao deve ficar presa ao resumo; deve conseguir listar parcelas quando esse dado esta disponivel.
- Nas mensagens sugeridas ao cliente, sempre considerar `equipe Careli`.
- Deve apoiar validacao humana, nao executar acao sensivel sem confirmacao.
- Deve perguntar antes de reenviar boleto/fatura.
- Botoes de acao em mensagens da IA devem ser claros e integrados ao fluxo.

## CareDesk

CareDesk e um modulo do Hub. Guardian usa CareDesk como atalho operacional, mas CareDesk atende outros modulos tambem.

Objetivo: ser o motor multicanal de atendimento da Careli, para cobranca, suporte ao cliente, financeiro, compras e futuras areas.

### CareDesk Core

Regra permanente definida por Lucas em 2026-05-16 23:57:01 -03:00: o CareDesk Core e a frente responsavel por desenvolver, evoluir e manter o modulo CareDesk como motor operacional multicanal da Careli.

Responsabilidades do CareDesk Core:

- Construir e evoluir sistema de tickets.
- Construir filas operacionais.
- Construir tela de atendimento.
- Construir disparos em massa.
- Construir setup operacional do modulo.
- Construir relatorios operacionais.
- Integrar canais de atendimento.
- Integrar WhatsApp/Meta quando autorizado.
- Integrar CareDesk com Guardian e IA.
- Suportar atendimento, tickets, WhatsApp, comunicacao operacional, disparos, templates, SLA, filas e handoff.
- Preservar experiencia operacional, velocidade e performance.

Regras permanentes:

- Nao transformar CareDesk em chat generico.
- Priorizar operacao real, velocidade operacional e comunicacao objetiva.
- Preservar padrao visual executivo, compacto e operacional do Hub.
- Nao alterar modulos externos sem necessidade ou sem solicitacao explicita do Lucas.
- Acoes sensiveis, disparos e integracoes externas devem manter confirmacao humana, rastreabilidade e controle server-side.

Lucas deve acionar o CareDesk Core quando a demanda envolver atendimento, tickets, integracao WhatsApp, disparos, templates, setup operacional, SLA, filas operacionais, handoff ou integracao do atendimento com Guardian/IA.

Handoff padrao do CareDesk Core:

- Informar fluxos implementados.
- Informar integracoes afetadas.
- Informar pendencias.
- Informar riscos conhecidos.
- Fechar com status operacional, como `AGUARDANDO QA` ou `FINALIZADO`.

### Estrutura esperada

CareDesk deve ter sidebar/menu proprio, com padrao visual do Hub:

- Gestao ou Board: painel de gerenciamento de tickets, metricas e fila.
- Atendimento: tela de chat/operacao humana.
- Disparos: comunicacao em massa.
- Setup: filas, setores, regras e direcionamentos.
- Relatorios: indicadores e analise operacional.

Preferencias:

- No menu do Hub, exibir `CareDesk` com badge `live` em minusculo.
- Deve haver forma de voltar ao menu do Hub.
- Deve haver forma de recolher o sidebar, mantendo o mesmo botao/padrao visual usado no Hub.
- Cabecalho deve ser direto; usar `Tickets`, nao `Gestao de tickets` quando Lucas pedir.
- Evitar textos explicativos longos.
- Decisao de 2026-05-16: enquanto o CareDesk ainda estiver em construcao, ocultar o app CareDesk das barras/menus em producao. Em desenvolvimento/local ele continua visivel para construcao e testes. A rota pode continuar existindo para acesso direto quando necessario; a regra e esconder da navegacao publica de producao. Deploy aplicado em producao no mesmo dia para esconder o CareDesk do shell do Hub e da sidebar legada do Guardian.

### Gestao/Board de tickets

Deve mostrar:

- Metricas executivas.
- Fila de tickets.
- Setor.
- Perfil.
- Operador.
- SLA.
- Status.
- Resposta.
- Follow-up.
- Acao de atendimento.

Setores esperados:

- Suporte ao Cliente.
- Financeiro.
- Compras.
- Cobranca.
- Outros setores configuraveis.

### Atendimento

Tela onde operador abre o chat e realiza atendimento.

Deve suportar:

- Historico de conversas.
- Mensagens de texto.
- Anexos.
- Audio.
- Templates.
- Transferencia/handoff.
- Tags.
- Follow-up.
- Contexto do cliente.
- Boletos/faturas.
- Contratos.
- Acordos.
- Acionamento da Caca.

### Setup

Configurar:

- Filas.
- Setores.
- Direcionamentos.
- Regras de SLA.
- Prioridades.
- Perfis de atendimento.
- Templates.
- Regras de distribuicao.
- Permissoes.
- Integracoes.

### Disparos em massa

Lucas usa comunicacao em massa para comunicados aos clientes. O CareDesk deve ter tela especifica para:

- Criar campanhas/disparos.
- Filtrar publico.
- Selecionar canal.
- Usar templates aprovados.
- Validar opt-in e regras de canal.
- Acompanhar entrega, leitura e resposta.

### Meta/WhatsApp

Caminho futuro para integracao com Meta/WhatsApp:

- Usar WhatsApp Business Platform.
- Configurar app Meta, telefone, webhook e token server-side.
- Receber mensagens por webhook.
- Enviar mensagens pela Cloud API.
- Armazenar conversas, mensagens, anexos e eventos no Supabase.
- Separar mensagens humanas, automaticas e IA.
- Usar templates aprovados para disparos e mensagens fora da janela permitida.
- Registrar auditoria e status de entrega/leitura.

## PulseX

PulseX e chat interno corporativo do Hub.

Decisao operacional de 2026-05-16 23:19:39 -03:00: Lucas definiu que Codex atuara como dev senior responsavel pela frente PulseX, apoiando arquitetura, planejamento, desenvolvimento, melhorias, implementacao e validacao do modulo. Antes de qualquer acao no PulseX, revisar este contexto, preservar as regras ja registradas e manter Guardian, CareDesk, Setup e demais modulos fora do escopo, salvo pedido explicito.

Regras principais:

- Setup geral do Hub e setup por modulo; PulseX isolado fora do setup de modulo nao faz sentido.
- Estrutura com departamentos, canais/grupos e pessoas.
- Usuarios devem ser vinculados a grupos/canais.
- Comunicados do departamento devem ser acessiveis a todos que participam de algum grupo daquele departamento.
- Usar `#` para canais.
- Usar megafone para comunicados.
- Remover textos como `canal operacional` quando nao agregarem.
- Mostrar somente departamentos e canais dos quais a pessoa participa, inclusive admin conforme regra de acesso.

Presenca:

- Deve ser macro do Hub, nao exclusiva do PulseX.
- Status: online, offline, ausente, almoco, agenda/em reuniao.
- Ausente automatico depois de 10 minutos sem interacao no Hub.
- Agenda futuramente muda status automaticamente quando houver compromisso.
- Registrar logs de login, logout e mudanca de status.
- Ausente em vermelho.
- Almoco em amarelo.

## Setup Central

Setup deve ser o lugar central para configuracoes do Hub e dos modulos. Evitar solucoes isoladas por modulo quando a configuracao e compartilhada.

Regras:

- Admin nao deve depender de vinculo departamental para acessar setup.
- Role enum canonico: `admin`, `leader`, `operator`, `viewer`.
- Modulos podem ter setup proprio, mas dentro de uma governanca central.

## Home do Hub

Home deve ser operacional e executiva.

Ideias combinadas:

- Perfil admin com informacoes de presenca.
- Indicadores de status de usuarios.
- Reunioes.
- Tasks futuras.
- Atividades do dia.
- Vencidas.
- Novidades do Hub.
- Registro elegante de melhorias feitas.
- Clicar na logo principal deve voltar para Home.
- Remover barra de pesquisa quando nao tiver utilidade.
- Foto do perfil deve poder ser importada como PNG.

## Padrao visual e UX

Padroes fortes:

- Interface executiva, compacta e clara.
- Evitar textos de explicacao obvios dentro da UI.
- Usar icones em vez de botoes textuais quando a acao for conhecida.
- Tooltips devem seguir o layout do Hub.
- Evitar botao/label grande quando icone basta.
- Cards nao devem ficar inchados.
- Usar cores padrao do projeto: destaque dourado/principal e sidebar escuro.

Estado selecionado de menu:

- Lucas gostou do padrao do CareDesk: fundo escuro mais marcado, borda/acento dourado na esquerda e chevron quando aplicavel.
- Esse padrao deve ser replicado modulo por modulo no Hub inteiro.
- Fazer em partes para nao quebrar tudo.

## Dados, performance e arquitetura

O C2X legado pode ser lento para consultas pesadas. A tela de atendimento chegou a demorar cerca de 24 segundos em consultas diretas, o que preocupa para producao.

Direcao combinada:

- Criar estrutura espelhada/agregada no Supabase para acelerar o Hub.
- Usar nomes com prefixo/contexto `c2x` para dados derivados do legado.
- Supabase deve servir dados prontos para tela quando possivel.
- C2X continua como referencia/origem.
- Evitar carregar detalhe completo de todos os clientes na abertura da fila.
- Usar paginacao, filtros server-side e endpoints agregados.
- Preferir snapshots, views/materializacoes ou tabelas de leitura para dashboards.
- Atualizacoes automaticas podem rodar em intervalos controlados quando realtime completo for desnecessario.
- Status validado em 2026-05-16: o read-model `c2x_guardian_attendance_queue` passou a gravar `metadata.units` com dados completos de unidade e contrato (`area`, `quadra`, `lote`, `matricula`, `valorTabela`, `signedContractDocumentId`, `signedContractStatus`, `signedContractUrl`). A sync C2X -> Supabase foi executada em producao e gravou 1125 linhas.

## Supabase, Vercel e Git

Lucas conectou Supabase, Vercel e Git/GitHub e autorizou uso quando necessario.

Supabase:

- Projeto de referencia mencionado: `careli-hub-dev`.
- Usar para banco operacional do Hub.
- Criar migrations/tabelas com cuidado e idempotencia.
- Nao depender de SQL manual no navegador quando uma migration versionada for melhor.

Vercel:

- Deploy do Hub em Vercel.
- Root/output precisam respeitar monorepo.
- Cuidado ao editar dominios.
- Status validado em 2026-05-16: producao em `c2x.app.br` recebeu as variaveis server-side de C2X, D4Sign, Asaas e OpenAI. Depois disso foi feito redeploy, `/api/guardian/db/health` respondeu `200 connected` no banco `prod_careli`, a API de detalhe do Guardian voltou a carregar parcelas e a rota D4Sign retornou PDF. Sempre que variavel de ambiente for adicionada/alterada na Vercel, fazer novo deploy para entrar no runtime.
- `turbo.json` deve declarar variaveis usadas por build/runtime do Hub quando o Turborepo avisar que elas estao ausentes, para evitar cache/build confuso. Em 2026-05-16 foram adicionadas as variaveis `GUARDIAN_DB_*` e `NODE_ENV` ao `globalEnv`.
- Direcao discutida em 2026-05-16: evitar publicar direto em producao durante a construcao. O caminho recomendado e ter dois ambientes do mesmo Hub: homologacao/teste para validar deploy, envs, APIs e fluxos; producao para o time trabalhar. Homologacao deve ter dominio proprio, por exemplo `teste.c2x.app.br` ou `homolog.c2x.app.br`, e o deploy principal so deve acontecer depois de validacao basica no ambiente de teste.
- Para evitar dor de cabeca operacional, homologacao nao deve disparar mensagens reais, boletos, comunicados em massa ou alteracoes financeiras sem uma trava explicita. Integracoes sensiveis devem ter modo seguro por ambiente.

Dominio:

- Lucas quer usar `c2x.app.br`.
- Ele chegou a editar/apagar dominio por engano; agir com cautela e orientar passo a passo quando for DNS.

Git:

- Commits devem ser semanticos.
- Nao incluir `.env.local` ou secrets.
- Nao misturar mudancas nao relacionadas.

## Seguranca

- Nunca salvar chaves em arquivos versionados.
- Nunca repetir tokens em mensagens.
- Integracoes Asaas, D4Sign, Meta e OpenAI devem ser server-side.
- Acoes sensiveis, como reenviar boleto, disparar mensagem em massa ou alterar status financeiro, exigem confirmacao humana.
- Registrar auditoria operacional para acoes de atendimento/cobranca.

## Fila de proximas frentes

Temas pendentes ou em andamento:

- Finalizar padrao visual de sidebar selecionado em todo Hub, por modulo.
- CareDesk: criar tabelas reais no Supabase, substituir mock por dados reais e montar fluxo completo.
- CareDesk: preparar integracao Meta/WhatsApp.
- Guardian: manter/monitorar endpoint D4Sign de contrato e melhorar feedback visual de erro quando credenciais ou documento estiverem ausentes.
- Guardian: completar dados de cliente/conjuge/endereco.
- Guardian: comportamento de pagamento e inteligencia por perfil.
- Guardian: Caca com dados completos e botoes de acao.
- Guardian: reenviar boleto com confirmacao e resposta contendo e-mail/telefone.
- C2X mirror: consolidar arquitetura de sincronizacao C2X -> Supabase.
- Financeiro futuro: extratos Asaas, taxas, pagamentos e visao dos valores reais Careli.

## Como atualizar este documento

Quando uma nova regra for combinada:

1. Adicione no modulo correspondente.
2. Seja objetivo.
3. Inclua a regra de negocio e a razao quando ela evitar erro futuro.
4. Nao adicione secrets.
5. Se a regra substituir uma anterior, marque claramente a nova decisao.

Regra permanente combinada com Lucas em 2026-05-16:

- Este documento deve ser atualizado sempre que houver commit, deploy relevante, decisao de produto, regra de negocio, processo operacional, comportamento de tela, integracao, validacao importante ou descoberta tecnica que ajude outro agente a continuar.
- O objetivo e funcionar como diario vivo de continuidade. Se a conversa definir algo que mudaria o trabalho de um proximo agente, registre aqui.
- Nao registrar tokens, senhas, valores de secrets ou dados sensiveis desnecessarios.
- Se uma pendencia for resolvida, mover ou reescrever a pendencia para refletir o estado real.

Regra permanente combinada com Lucas em 2026-05-16 23:14:08 -03:00 para Guardian:

- Toda melhoria, construcao, implementacao, ajuste relevante, decisao tecnica ou correcao feita no Guardian deve gerar uma entrada neste diario.
- A entrada deve trazer a marcacao `Dev Guardian`, data e hora local da execucao, motivo da mudanca, arquivos/modulos afetados, como foi feito e a logica usada para chegar na solucao.
- Quando houver validacao, registrar os comandos ou checagens executadas. Quando nao houver validacao tecnica, explicar objetivamente o motivo.
- O registro deve ser curto, mas suficiente para outro agente entender o contexto e continuar sem redescobrir a decisao.
- Nao registrar dados sensiveis, secrets, tokens, senhas ou detalhes pessoais desnecessarios de clientes.

Regra permanente combinada com Lucas em 2026-05-16 23:18:29 -03:00 para a frente CareDesk:

- Lucas definiu que toda melhoria, construcao, implementacao, decisao ou correcao conduzida por esta frente deve ser registrada neste diario usando a marcacao `Dev CareDesk`.
- A marcacao `Dev CareDesk` substitui `Dev Guardian` nos registros feitos por este dev/agente para continuidade da frente, mesmo quando a melhoria tocar fluxos do Guardian integrados ao CareDesk.
- Cada registro deve seguir esta estrutura minima:
  - `Dev CareDesk`
  - `data e hora local`
  - `motivo da mudanca`
  - `arquivos/modulos afetados`
  - `como foi feito`
  - `logica usada`
  - `validacao executada ou motivo de nao validar`
- O objetivo e manter um diario vivo que permita outro agente continuar o trabalho sem perder decisoes, regras, comportamento esperado, validacoes e pendencias.
- O registro deve evitar dados sensiveis, secrets, tokens, senhas e dados pessoais desnecessarios.

Regra permanente combinada com Lucas em 2026-05-16 23:19:39 -03:00 para a frente PulseX:

- Lucas definiu que toda melhoria, construcao, implementacao, decisao ou correcao conduzida por esta frente deve ser registrada neste diario usando a marcacao `Dev PulseX`.
- A marcacao `Dev PulseX` deve ser usada nos registros feitos por este dev/agente para continuidade da frente PulseX.
- Cada registro deve seguir esta estrutura minima:
  - `Dev PulseX`
  - `data e hora local`
  - `motivo da mudanca`
  - `arquivos/modulos afetados`
  - `como foi feito`
  - `logica usada`
  - `validacao executada ou motivo de nao validar`
- O objetivo e manter um diario vivo que permita outro agente continuar o trabalho sem perder decisoes, regras, comportamento esperado, validacoes e pendencias.
- O registro deve evitar dados sensiveis, secrets, tokens, senhas e dados pessoais desnecessarios.

Registro de diario:

- `Dev PulseX`
- Data e hora local: 2026-05-16 23:19:39 -03:00.
- Motivo da mudanca: formalizar que Codex sera a frente senior responsavel por PulseX e registrar o formato obrigatorio de diario para proximas melhorias, construcoes, implementacoes e correcoes.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; estudo de `apps/hub/app/pulsex/page.tsx`, `apps/hub/components/pulsex/*`, `apps/hub/lib/pulsex/*`, `apps/hub/app/api/pulsex/messages/route.ts`, `apps/hub/app/setup/page.tsx` e migrations PulseX.
- Como foi feito: leitura do diario operacional, revisao de memorias anteriores do Hub/PulseX e mapeamento dos pontos principais do modulo antes de registrar a decisao.
- Logica usada: separar PulseX como chat interno corporativo do Hub, manter Setup Central como origem de departamentos/canais/pessoas, preservar contratos existentes de mencoes, tags, threads, leitura, presenca e chamadas, e nao misturar Guardian ou CareDesk sem escopo explicito.
- Validacao executada ou motivo de nao validar: nao houve alteracao de codigo de produto; validacao limitada a leitura, mapeamento e atualizacao documental.

Regra permanente combinada com Lucas em 2026-05-16 sobre correcoes:

- Toda alteracao feita pelo agente deve ser registrada neste documento quando fechar o pacote de trabalho.
- Quando a alteracao for correcao de bug, erro de sistema, regra, estabilidade, integracao ou comunicacao entre ferramentas, registrar com a marcacao `Tipo: Correcao`.
- O registro de correcao deve explicar de forma objetiva: erro observado, origem/causa identificada quando houver evidencia, arquivos ou modulos alterados, o que foi feito para corrigir e como foi validado.
- Se a causa ainda nao estiver comprovada, registrar como hipotese ou investigacao pendente, sem cravar conclusao falsa.
- O registro deve evitar dados sensiveis, tokens, senhas, dados pessoais desnecessarios e trechos de log que exponham segredo.

Registro de diario:

- `Dev Guardian`
- Data e hora local: 2026-05-16 23:31:56 -03:00.
- Tipo: Diagnostico de conexoes, banco e performance.
- Motivo da analise: Lucas pediu teste de conexoes, checagem de gargalo no banco de dados e velocidade das telas.
- Arquivos/modulos afetados: leitura de `docs/codex/contexto-operacional.md`; analise de `apps/hub/app/api/guardian/db/health`, `apps/hub/app/api/guardian/attendance/queue/route.ts`, `apps/hub/modules/guardian/attendance/AttendancePage.tsx`, `apps/hub/modules/guardian/attendance/DeskPage.tsx`, `apps/hub/lib/guardian/read-model.ts` e migration `packages/database/migrations/0010_c2x_guardian_read_model.sql`.
- Resultado: conexoes principais responderam. Supabase Auth respondeu HTTP 200; producao `https://c2x.app.br/api/guardian/db/health` respondeu HTTP 200 com banco `prod_careli` conectado; C2X/MySQL direto respondeu ping em 165 ms e sem fila relevante de processos ativos no momento do teste.
- Gargalo encontrado: a API `/api/guardian/attendance/queue` e as telas que consomem `?limit=1000` carregam a fila inteira. Em local, a fila completa retornou 548 clientes e aproximadamente 1,99 MB, levando cerca de 1,4 s em cache quente; em producao, `limit=1000` levou cerca de 2,7 s. Com `limit=20`, a mesma rota ficou em cerca de 0,6-0,8 s e payload perto de 100 KB.
- Banco/read-model: o read-model do Supabase esta ajudando; consulta dos primeiros 50 itens da fila ficou em cerca de 224 ms e o ultimo sync Guardian terminou com sucesso. No C2X/MySQL, a consulta agregada de inadimplencia ficou em 188 ms, mas contagens amplas em `payments` chegaram perto de 1,9 s.
- Risco tecnico identificado: a tabela `c2x_guardian_financial_snapshots` possui coluna `snapshot_at`, mas `apps/hub/lib/guardian/read-model.ts` ainda tipa/mapeia `generated_at`; isso pode deixar `generatedAt` indefinido no overview financeiro.
- Pendencia recomendada: reduzir o limite inicial das telas de atendimento/desk, paginar ou carregar detalhes sob demanda, e corrigir o mapeamento `generated_at` -> `snapshot_at` antes de depender do campo no front.
- Validacao executada: checagem segura de variaveis sem exibir valores, healthcheck Supabase, healthcheck Guardian producao, consultas diretas agregadas no C2X/MySQL, consultas Supabase/read-model e medicao HTTP local/producao das principais rotas e endpoints. Validacao visual com browser nao foi concluida porque a ferramenta de browser nao ficou disponivel e o Playwright local falhou por dependencia ausente.

Registro de diario:

- `Dev PulseX`
- Data e hora local: 2026-05-16 23:34:03 -03:00.
- Tipo: Melhoria e correcao de comunicacao.
- Motivo da mudanca: Lucas pediu melhorias na comunicacao do PulseX para permitir colar prints na mensagem, revisar audio/video, ampliar a tela de video com opcao de tela cheia, editar mensagens ja enviadas e aumentar a lista de emojis em um padrao mais proximo do iPhone.
- Arquivos/modulos afetados: `apps/hub/components/pulsex/message-composer.tsx`, `apps/hub/components/pulsex/message-item.tsx`, `apps/hub/components/pulsex/message-list.tsx`, `apps/hub/components/pulsex/thread-panel.tsx`, `apps/hub/components/pulsex/pulsex-workspace.tsx`, `apps/hub/components/pulsex/call-panel.tsx`, `apps/hub/components/pulsex/call-participant-tile.tsx`, `apps/hub/lib/pulsex/supabase-data.ts` e `apps/hub/app/api/pulsex/messages/route.ts`.
- Como foi feito: o composer passou a capturar imagens coladas do clipboard e anexar o print como imagem; o seletor de emojis foi ampliado e ganhou area rolavel; mensagens proprias ganharam fluxo de edicao com estado otimista e persistencia via PATCH; a API de mensagens passou a validar autor, acesso ao canal e atualizar `body` com `metadata.editedAt`; o painel de chamada foi redesenhado para abrir maior, com tiles mais altos e botao de tela cheia usando Fullscreen API quando disponivel.
- Logica usada: manter o PulseX como chat interno corporativo familiar, preservando contratos atuais de mencoes, anexos, tags, threads, leitura e chamadas. A edicao ficou limitada ao autor para evitar alteracao indevida; o print colado reaproveita o fluxo existente de anexos em data URL com limite de 8 MB; a tela cheia funciona como melhoria progressiva, mantendo layout ampliado mesmo se o navegador negar a Fullscreen API.
- Validacao executada ou motivo de nao validar: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` executados com sucesso. Validacao visual local em `http://localhost:3001/pulsex` confirmou carregamento da tela, botao de editar em mensagem propria, seletor com 116 emojis, painel de video ampliado em 1120x590 e tela cheia ocupando 1280x720; os avisos ja existentes de modules/direct users permaneceram como warnings de carga de dados e nao bloquearam a validacao da UI.

Registro de diario:

- `Dev Guardian`
- Data e hora local: 2026-05-16 23:39:09 -03:00.
- Tipo: Correcao.
- Erro observado: diagnostico anterior encontrou gargalo na API `/api/guardian/attendance/queue` porque as telas de cobranca/desk forcavam `limit=1000`, carregando a fila inteira na abertura, e encontrou divergencia entre o read-model financeiro e o codigo: a migration usa `snapshot_at`, mas `apps/hub/lib/guardian/read-model.ts` lia `generated_at`.
- Origem/causa identificada: o limite padrao e as chamadas client-side buscavam ate 1000 clientes mesmo quando a tela so precisava abrir com um recorte inicial; o tipo `FinancialSnapshotRow` estava desalinhado com `packages/database/migrations/0010_c2x_guardian_read_model.sql`.
- Arquivos/modulos alterados: `apps/hub/app/api/guardian/attendance/queue/route.ts`, `apps/hub/lib/guardian/read-model.ts`, `apps/hub/modules/guardian/attendance/AttendancePage.tsx`, `apps/hub/modules/guardian/attendance/DeskPage.tsx` e este diario.
- O que foi feito para corrigir: o limite inicial/padrao da fila passou para 50; as telas de cobranca e desk deixaram de chamar `limit=1000`; a API passou a retornar `meta.loadedCount` com o carregado e `meta.count` com o total real do read-model; o snapshot financeiro passou a mapear `generatedAt` a partir de `snapshot_at`, com fallback seguro para `created_at`.
- Logica usada: manter a abertura da tela leve usando o read-model do Supabase como fonte pronta para UI, sem voltar a carregar toda a carteira na primeira renderizacao; preservar a possibilidade de consulta maior via parametro explicito da API quando necessario.
- Validacao executada: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` executados com sucesso. Reteste local em `http://localhost:3001/api/guardian/attendance/queue` retornou HTTP 200, `loadedCount=50`, `count=548`, payload aproximado de 239 KB e tempo de 840 ms na primeira medicao; `limit=50` retornou 566 ms; `limit=1000` continuou disponivel para carga completa e retornou 548 itens em 1743 ms. Nao houve deploy neste pacote.

Registro de diario:

- `Engenharia Careli Hub`
- Data e hora local: 2026-05-16 23:46:46 -03:00.
- Tipo: Decisao operacional permanente.
- Motivo da mudanca: Lucas definiu o Manifesto Operacional da Engenharia Careli Hub para coordenar todos os agentes como squad, com escopos claros, handoff, status obrigatorios, regras de producao, UX, arquitetura, seguranca, validacao e documentacao viva.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`.
- Como foi feito: o manifesto foi consolidado em uma secao propria no inicio deste diario, antes dos detalhes por modulo, para que todo agente leia a regra macro antes de atuar em Guardian, PulseX, CareDesk, Setup, Infra, QA ou qualquer frente futura.
- Logica usada: transformar a orientacao do Lucas em regra operacional transversal, sem alterar codigo de produto nem misturar escopos de modulo.
- Validacao executada ou motivo de nao validar: alteracao documental validada por leitura local do arquivo; nao houve alteracao de codigo, build ou deploy.

Registro de diario:

- `Dev Guardian`
- Data e hora local: 2026-05-16 23:46:17 -03:00.
- Tipo: Melhoria visual e padronizacao de UI.
- Motivo da mudanca: Lucas pediu revisar todo o modulo Guardian e colocar os tooltips no mesmo padrao escuro do Hub mostrado na tela, evitando tooltips nativos do navegador ou baloes manuais divergentes.
- Arquivos/modulos alterados: `packages/uix/src/components/tooltip.tsx`, `apps/hub/app/guardian/page.tsx`, `apps/hub/components/guardian/layout/Sidebar.tsx`, `apps/hub/components/guardian/layout/Topbar.tsx`, `apps/hub/components/guardian/dashboard/KpiCard.tsx`, `apps/hub/modules/guardian/attendance/AttendancePage.tsx`, `apps/hub/modules/guardian/attendance/DeskPage.tsx`, `QueuePanel`, `TicketOperationsQueue`, `WhatsAppConversationPanel`, `InstallmentsCard`, `AgreementsCenterCard`, `ClientDetailPanel`, `ClientQueueCard`, `ExpandableDetailSection`, `OperationalTimeline`, `OperationalWorkflowCard` e pontos de monitoramento do Guardian que ja usavam helper visual.
- Como foi feito: substitui `title` nativo e tooltips manuais/brancos por `Tooltip` do `@repo/uix`; removi duplicidade de `title` quando o componente ja tinha `aria-label`; mantive descricoes acessiveis nos botoes; estendi o `Tooltip` compartilhado para aceitar classes no wrapper, trigger e conteudo; recompilei o pacote `@repo/uix` para atualizar o `dist` consumido pelo Hub.
- Logica usada: centralizar o comportamento no componente compartilhado do Hub garante o mesmo visual, posicionamento e estado de hover/focus em todo o Guardian, sem alterar regras de negocio, dados C2X, fluxos Asaas/D4Sign, filas, acordos ou contratos sensiveis. As trocas ficaram restritas a apresentacao e acessibilidade dos controles.
- Validacao executada: `npm.cmd run build --workspace @repo/uix`, `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` executados com sucesso. A rota local `http://localhost:3001/guardian/atendimento` respondeu HTTP 200 usando a instancia dev ja ativa; a varredura por `title` nativo direto em elementos HTML do Guardian nao encontrou ocorrencias. Validacao visual automatizada com Playwright nao foi concluida porque a dependencia `playwright` nao esta instalada no runtime usado pelo Codex.

Registro de diario:

- `Dev CareDesk`
- Data e hora local: 2026-05-16 23:47:02 -03:00.
- Tipo: Decisao operacional e regra de engenharia.
- Motivo da mudanca: Lucas definiu o Manifesto Operacional da Engenharia Careli Hub como regra de atuacao da squad, reforcando modularidade, estabilidade, handoff, validacao, rastreabilidade, seguranca e padrao executivo do produto.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra transversal para Guardian, CareDesk, PulseX, Setup, Infra, QA, Architect, Security e demais frentes do Hub.
- Como foi feito: o manifesto foi mantido no topo do diario como secao oficial de contexto e esta entrada registra sua adocao como regra operacional permanente para continuidade entre agentes.
- Logica usada: centralizar o manifesto no diario evita perda de contexto entre sessoes e obriga cada agente a atuar dentro do proprio escopo, usando status operacionais, fluxo de handoff, validacao minima, protecao de producao e cuidado com secrets.
- Validacao executada ou motivo de nao validar: validacao documental por leitura do `AGENTS.md` e do `docs/codex/contexto-operacional.md`; nao houve teste tecnico porque a mudanca e de processo/documentacao.

Regra permanente combinada com Lucas em 2026-05-16 23:46:52 -03:00 sobre o Manifesto Operacional da Engenharia Careli Hub:

- O Careli Hub deve ser tratado como ecossistema operacional enterprise, modular, integrado, rastreavel, seguro e orientado a produtividade real da Careli.
- Lucas e a autoridade central de orquestracao operacional e estrategica: define prioridades, aprova direcionamentos, coordena handoffs, controla deploys, aprova mudancas criticas e valida a experiencia operacional.
- As frentes de engenharia devem atuar como squad coordenada, com escopo proprio, limite de atuacao, fluxo de handoff e responsabilidade documental. Nenhum agente deve atuar fora do seu escopo sem solicitacao explicita do Lucas.
- Antes de qualquer implementacao, o agente deve ler o contexto operacional, revisar regras anteriores, analisar impacto, dependencias e riscos, e preservar arquitetura, negocio, visual, seguranca e rastreabilidade.
- O Hub nao deve virar SaaS generico, dashboard poluido, sistema excessivamente explicativo, produto inchado ou desconectado da operacao real. O padrao esperado e executivo, operacional, compacto, realtime, modular, consistente, integrado e enterprise.
- Toda mudanca relevante deve ser registrada no diario operacional, incluindo melhoria, correcao, decisao, deploy, validacao, descoberta tecnica, integracao ou comportamento operacional.
- Status oficiais obrigatorios para comunicacao operacional: `ANALISANDO`, `IMPLEMENTANDO`, `VALIDANDO`, `AGUARDANDO QA`, `AGUARDANDO ARCHITECT`, `AGUARDANDO DEPLOY`, `FINALIZADO` e `BLOQUEADO`.
- Fluxo operacional oficial: implementacao -> QA -> revisao arquitetural -> infra/deploy -> producao -> monitoramento. Deploy critico nao deve ocorrer sem validacao minima.
- Handoff padrao deve informar status, o que foi feito, o que falta, dependencias de outro agente, proximo passo, riscos conhecidos e validacoes esperadas.
- Produção e ambiente critico: validar antes do deploy, evitar alteracoes destrutivas, monitorar apos deploy, preservar estabilidade e manter rastreabilidade.
- UX do Hub deve permanecer executiva, compacta, clean, operacional, consistente e densa sem poluicao visual. Evitar excesso de texto, excesso de cards, visual generico de startup, experiencias artificiais e interfaces inchadas.
- Arquitetura deve priorizar modularizacao, baixo acoplamento, performance, rastreabilidade, integracao controlada, seguranca e escalabilidade. Evitar duplicacao desnecessaria, dependencia circular, regras espalhadas e acoplamento entre modulos.
- Acoes sensiveis exigem validacao, confirmacao humana, rastreabilidade e controle server-side. Nunca executar automaticamente envio financeiro, disparos em massa, alteracao financeira ou alteracao critica de producao.

Registro de diario:

- `Dev PulseX`
- Data e hora local: 2026-05-16 23:46:52 -03:00.
- Tipo: Processo operacional e regra de engenharia.
- Motivo da mudanca: Lucas definiu o Manifesto Operacional da Engenharia Careli Hub para alinhar todos os agentes como squad coordenada, preservar escopos, padronizar status/handoff e reforcar estabilidade, seguranca, rastreabilidade, validacao e documentacao viva.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra global aplicavel a todas as frentes do Careli Hub, incluindo PulseX, Guardian, CareDesk, Setup, Infra, QA, Architect, Security e demais modulos.
- Como foi feito: consolidei o manifesto no diario como regra permanente, mantendo os pontos operacionais essenciais sem replicar texto excessivo e preservando o documento como fonte rapida de continuidade.
- Logica usada: registrar a decisao no contexto central evita perda de alinhamento entre sessoes e agentes, deixa claro que Lucas coordena as prioridades e handoffs, e reforca que cada frente deve atuar apenas no proprio escopo com validacao e registro.
- Validacao executada ou motivo de nao validar: validacao limitada a leitura e atualizacao documental, pois nao houve alteracao de codigo, schema, deploy, comportamento de produto ou integracao. Status operacional: `FINALIZADO`.

Registro de diario:

- `Dev Guardian`
- Data e hora local: 2026-05-16 23:56:22 -03:00.
- Tipo: Processo operacional e regra de responsabilidade.
- Motivo da mudanca: Lucas definiu o `Guardian Core` como frente responsavel por desenvolver, evoluir e manter o modulo Guardian, cobrindo cobranca, carteira, inadimplencia, acordos, parcelas, contratos, atendimento operacional de cobranca e inteligencia operacional de recuperacao.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra aplicavel a `apps/hub/app/guardian`, `apps/hub/modules/guardian`, `apps/hub/components/guardian`, APIs e bibliotecas relacionadas ao Guardian, alem das integracoes controladas com CareDesk, C2X, Asaas, D4Sign e Caca.
- Como foi feito: adicionei a secao `Guardian Core` dentro do bloco `## Guardian`, consolidando escopo, responsabilidades, regras permanentes, momentos de acionamento e formato de handoff da frente Guardian.
- Logica usada: manter a regra dentro do bloco do Guardian deixa claro o limite de atuacao do modulo, evita mistura com CareDesk/PulseX/Setup/Infra sem pedido explicito e reforca que toda evolucao do Guardian deve priorizar dados reais, regras financeiras, performance, UX operacional e validacao.
- Validacao executada ou motivo de nao validar: validacao documental por leitura e busca local no diario. Nao houve alteracao de codigo, schema, integracao, build ou deploy. Status operacional: `FINALIZADO`.

Regra permanente combinada com Lucas em 2026-05-16 23:49:24 -03:00 sobre o Diario Operacional da Engenharia:

- Todos os agentes da engenharia Careli Hub devem utilizar obrigatoriamente `docs/codex/contexto-operacional.md` como diario operacional oficial do projeto.
- O diario e a memoria viva da engenharia e deve ser lido antes de iniciar qualquer atividade no repositorio.
- O diario deve ser atualizado ao finalizar entrega relevante, incluindo implementacao, melhoria, correcao, decisao tecnica, deploy, descoberta importante, alteracao arquitetural, integracao, ajuste operacional, validacao relevante, risco identificado ou mudanca de comportamento do sistema.
- Cada novo registro deve ser adicionado ao final do documento, sem apagar, sobrescrever ou reordenar historico anterior.
- Todo registro deve conter, de forma objetiva e operacional: nome da squad/agente, data e hora local, tipo da alteracao, motivo da mudanca, arquivos/modulos afetados, como foi feito, logica utilizada, validacao executada e pendencias ou riscos conhecidos.
- O diario nunca deve registrar tokens, secrets, senhas, credenciais ou dados sensiveis desnecessarios.
- O objetivo do diario e preservar continuidade entre agentes, evitar perda de contexto, evitar retrabalho, registrar decisoes arquiteturais, documentar comportamento do sistema, permitir continuidade futura da engenharia e manter rastreabilidade operacional do Hub.

Registro de diario:

- Nome da squad/agente: `Engenharia Careli Hub`.
- Data e hora local: 2026-05-16 23:49:24 -03:00.
- Tipo da alteracao: Decisao operacional permanente e regra de processo.
- Motivo da mudanca: Lucas definiu oficialmente que `docs/codex/contexto-operacional.md` e o diario operacional obrigatorio da engenharia Careli Hub e que todos os agentes devem le-lo antes de atuar e atualiza-lo ao concluir entregas relevantes.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra transversal para todas as frentes, squads e agentes do Hub.
- Como foi feito: a regra foi adicionada ao final do diario, preservando todo o historico anterior e consolidando os gatilhos de registro, estrutura obrigatoria e restricoes de seguranca.
- Logica utilizada: manter o diario como fonte unica de continuidade operacional evita perda de contexto, retrabalho e decisoes sem rastreabilidade, sem criar novo arquivo paralelo nem acoplar a regra a um modulo especifico.
- Validacao executada: leitura local do diario antes da alteracao e registro documental ao final do arquivo. Nao houve alteracao de codigo, schema, deploy ou comportamento de produto.
- Pendencias ou riscos conhecidos: nenhum risco tecnico imediato. Risco operacional mitigado: agentes deixarem de registrar decisoes ou validacoes relevantes fora do diario oficial.

Regra permanente combinada com Lucas em 2026-05-16 23:50:26 -03:00 sobre o Hub InfraOps:

- O Hub InfraOps e a frente responsavel por estabilidade operacional de deploy, Vercel, CI/CD, ambientes, variaveis, dominio, build, runtime, observabilidade, monitoramento, homologacao e producao.
- O InfraOps deve validar build, ambiente, variaveis sem expor valores, healthchecks e impacto operacional antes de concluir deploy ou validacao de ambiente.
- Producao deve ser protegida: nunca alterar producao sem validacao minima, nunca ignorar erro de build e nunca subir alteracao critica sem rastreabilidade.
- Deploys devem preferir homologacao antes de producao quando houver risco operacional, mantendo ambientes separados e evitando disparos reais em ambiente de teste sem trava explicita.
- Apos deploy ou validacao, o handoff deve informar ambiente, build, healthcheck, pendencias e monitoramento recomendado, usando linguagem objetiva e status operacional.

Registro de diario:

- Nome da squad/agente: `Hub InfraOps`.
- Data e hora local: 2026-05-16 23:50:26 -03:00.
- Tipo da alteracao: Decisao operacional permanente e regra de processo.
- Motivo da mudanca: Lucas definiu o papel do Hub InfraOps como responsavel por deploy, Vercel, CI/CD, ambientes, variaveis, dominio, build, runtime, observabilidade, monitoramento, homologacao e producao.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra transversal para operacao, deploy e estabilidade do Hub.
- Como foi feito: a regra foi adicionada ao final do diario, sem alterar codigo de produto, schema, UX, Guardian, PulseX, CareDesk ou Setup.
- Logica utilizada: registrar o escopo do InfraOps no diario garante continuidade operacional, separacao de responsabilidades, protecao de producao e handoff padronizado apos deploy ou validacao.
- Validacao executada: leitura local do diario operacional e confirmacao de que o manifesto geral ja estava registrado; nao houve build, deploy ou teste tecnico porque a alteracao foi documental.
- Pendencias ou riscos conhecidos: nenhuma pendencia tecnica. Proximos deploys ainda devem executar validacao minima, healthcheck e monitoramento conforme o risco da alteracao.

Regra permanente combinada com Lucas em 2026-05-16 23:57:55 -03:00 sobre o PulseX Core:

- O PulseX Core e a frente responsavel por desenvolver, evoluir e manter o modulo PulseX como sistema de comunicacao interna operacional da Careli.
- O PulseX nao deve ser Slack generico, chat simples ou mensageria comum. Deve ser operacional, realtime, corporativo, integrado ao Hub, rapido, executivo e focado em produtividade.
- Responsabilidades da frente PulseX Core: comunicacao realtime, canais, grupos, mensagens, threads, presenca, chamadas, uploads, notificacoes e experiencia operacional viva integrada ao Hub.
- Ao evoluir PulseX, priorizar velocidade operacional, realtime, identidade visual validada, comunicacao viva, clareza executiva e baixa poluicao visual.
- Lucas deve acionar o PulseX Core quando houver melhoria do chat, realtime, presenca, threads, canais, notificacoes, upload, comunicacao interna ou chamadas.
- A frente PulseX Core deve preservar os contratos locais ja existentes de mensagens, mencoes, reacoes, threads, leitura, presenca, uploads e chamadas, sem substituir o modelo funcional sem necessidade comprovada.
- O PulseX Core nao deve alterar Guardian, CareDesk, Setup, Infra, dados financeiros ou regras globais sem solicitacao explicita do Lucas e sem handoff adequado.
- Handoff padrao do PulseX Core: informar melhorias realizadas, fluxos afetados, pendencias, riscos conhecidos, validacoes executadas e status operacional, normalmente `AGUARDANDO QA` quando houver implementacao funcional ou `FINALIZADO` quando for decisao/documentacao concluida.

Registro de diario:

- `Dev PulseX`
- Data e hora local: 2026-05-16 23:57:55 -03:00.
- Tipo: Processo operacional e regra de responsabilidade.
- Motivo da mudanca: Lucas definiu o `PulseX Core` como frente responsavel por desenvolver, evoluir e manter o modulo PulseX, com foco em comunicacao interna operacional, realtime, produtividade, chamadas, uploads, notificacoes, presenca, canais, grupos, mensagens e threads.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra aplicavel a `apps/hub/app/pulsex`, `apps/hub/components/pulsex`, `apps/hub/lib/pulsex`, `apps/hub/app/api/pulsex`, Setup Central relacionado a canais/pessoas e integracoes controladas de realtime/uploads/notificacoes.
- Como foi feito: adicionei a regra `PulseX Core` ao diario operacional, consolidando escopo, responsabilidades, regras de produto, momentos de acionamento por Lucas e formato de handoff da frente.
- Logica usada: registrar o PulseX Core no diario separa a frente de outros modulos, evita que o PulseX seja tratado como chat generico ou SaaS comum, preserva a identidade operacional validada e fixa o compromisso de evoluir comunicacao realtime sem poluir visual nem quebrar contratos existentes.
- Validacao executada ou motivo de nao validar: validacao documental por leitura do diario e registro ao final do arquivo. Nao houve alteracao de codigo, schema, integracao, build ou deploy. Status operacional: `FINALIZADO`.

Registro de diario:

- Nome da squad/agente: `Dev CareDesk`.
- Data e hora local: 2026-05-16 23:57:01 -03:00.
- Tipo da alteracao: Decisao operacional permanente e regra de responsabilidade.
- Motivo da mudanca: Lucas definiu o `CareDesk Core` como frente responsavel por desenvolver, evoluir e manter o modulo CareDesk, cobrindo atendimento, tickets, WhatsApp, comunicacao operacional, disparos, templates, SLA, filas, handoff e integracoes com Guardian e IA.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra aplicavel a `apps/hub/modules/caredesk`, rotas/telas futuras do CareDesk, APIs de atendimento, integracoes com Guardian, IA, Meta/WhatsApp, filas, tickets, disparos, templates, SLA e relatorios.
- Como foi feito: adicionei a secao `CareDesk Core` dentro do bloco `## CareDesk`, consolidando escopo, responsabilidades, regras permanentes, momentos de acionamento e formato de handoff da frente CareDesk.
- Logica utilizada: manter a regra dentro do bloco do CareDesk deixa claro o limite de atuacao do modulo, evita transformar o CareDesk em chat generico, preserva a operacao real da Careli e reforca que integracoes sensiveis devem ter confirmacao humana, rastreabilidade e controle server-side.
- Validacao executada: leitura local do `AGENTS.md`, busca no diario operacional e confirmacao documental do novo bloco `CareDesk Core`. Nao houve alteracao de codigo, schema, integracao, build ou deploy porque a mudanca foi documental/processual.
- Pendencias ou riscos conhecidos: nenhuma pendencia tecnica imediata. Proximas implementacoes do CareDesk devem passar por analise de impacto, validacao tecnica e handoff para QA quando houver mudanca de produto.

Regra permanente combinada com Lucas em 2026-05-17 00:00:28 -03:00 sobre orquestracao entre agentes:

- Todos os agentes fazem parte da engenharia coordenada do Careli Hub e nao devem atuar como ferramentas isoladas.
- Ao concluir qualquer etapa, o agente deve informar claramente: proximo agente ou squad necessaria, validacoes que devem ocorrer, dependencias, riscos conhecidos e pendencias.
- Squads consideradas no fluxo operacional atual: `Hub Architect`, `Hub InfraOps`, `Hub DataOps`, `Hub QA`, `Hub Security`, `Hub Support Engineer`, `Guardian Core`, `CareDesk Core`, `PulseX Core` e futuras squads do Hub.
- Regra de handoff: quando finalizar uma etapa, sempre orientar Lucas sobre o proximo fluxo operacional, usando status oficial e indicando a proxima squad recomendada quando houver continuidade.
- Regra de escopo: nunca executar tarefa claramente pertencente a outra squad sem solicitacao explicita do Lucas. Exemplos permanentes: QA nao implementa feature; InfraOps nao altera UX; modulo nao redefine arquitetura global; Security nao altera regra operacional; Architect nao realiza deploy operacional.
- Regra de continuidade: todo agente deve operar considerando continuidade entre sessoes, continuidade entre squads, preservacao do contexto operacional, preservacao do diario operacional e estabilidade do ecossistema.
- Sempre considerar que outro agente podera continuar o trabalho depois da etapa atual; por isso, o fechamento deve ser objetivo, rastreavel e util para o proximo agente.

Registro de diario:

- Nome da squad/agente: `Engenharia Careli Hub`.
- Data e hora local: 2026-05-17 00:00:28 -03:00.
- Tipo da alteracao: Decisao operacional permanente e regra de orquestracao.
- Motivo da mudanca: Lucas definiu a regra de orquestracao entre agentes para garantir que toda entrega informe proxima squad, validacoes, dependencias, riscos e pendencias, preservando escopo e continuidade entre frentes.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra transversal para Hub Architect, Hub InfraOps, Hub DataOps, Hub QA, Hub Security, Hub Support Engineer, Guardian Core, CareDesk Core, PulseX Core e futuras squads.
- Como foi feito: a regra foi adicionada ao final do diario como politica permanente, conectando o manifesto operacional, o fluxo de handoff e os limites de escopo entre squads.
- Logica utilizada: registrar a orquestracao no diario reduz risco de agentes concluirem tarefas sem indicar continuidade, evita invasao de escopo entre squads e melhora a passagem de contexto para QA, Architect, InfraOps, Security, DataOps, Support ou modulos especificos.
- Validacao executada: leitura local do diario operacional, busca de regras existentes de handoff/squads e confirmacao documental do novo bloco. Nao houve alteracao de codigo, schema, UX, integracao, build ou deploy porque a mudanca foi documental/processual.
- Pendencias ou riscos conhecidos: nenhuma pendencia tecnica imediata. Proximas entregas devem aplicar esta regra no fechamento, indicando `Hub QA` para validacoes funcionais, `Hub Architect` para revisao arquitetural, `Hub InfraOps` para deploy/ambiente, `Hub Security` para risco sensivel, `Hub DataOps` para dados/schema e a squad de modulo correspondente quando houver continuidade funcional.

Registro de diario:

- Nome da squad/agente: `Dev Guardian`.
- Data e hora local: 2026-05-17 00:00:37 -03:00.
- Tipo da alteracao: Regra de orquestracao e handoff entre agentes.
- Motivo da mudanca: Lucas definiu que todos os agentes fazem parte da engenharia coordenada do Careli Hub e que, ao concluir uma etapa, devem informar proxima squad necessaria, validacoes, dependencias, riscos e pendencias.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra transversal para `Hub Architect`, `Hub InfraOps`, `Hub DataOps`, `Hub QA`, `Hub Security`, `Hub Support Engineer`, `Guardian Core`, `CareDesk Core`, `PulseX Core` e futuras squads do Hub.
- Como foi feito: adicionei a regra de orquestracao entre agentes dentro do manifesto operacional do Hub, junto ao fluxo de comunicacao e handoff, e registrei esta entrada no diario ao final do documento.
- Logica utilizada: deixar a regra no manifesto garante que qualquer squad leia a obrigacao de handoff antes de implementar, evita atuacao isolada, preserva escopo entre frentes e facilita continuidade quando outro agente assumir a proxima etapa.
- Validacao executada: leitura local do diario operacional, busca por regras de handoff/squad existentes e confirmacao documental da nova regra. Nao houve alteracao de codigo, schema, integracao, build ou deploy porque a mudanca foi de processo/documentacao.
- Pendencias ou riscos conhecidos: nenhuma pendencia tecnica. Em proximas implementacoes do Guardian Core, o encerramento deve apontar a proxima squad recomendada, normalmente `Hub QA` quando houver mudanca funcional, e depois `Hub Architect` ou `Hub InfraOps` conforme risco e necessidade de deploy.

Registro de diario:

- Nome da squad/agente: `Dev CareDesk`.
- Data e hora local: 2026-05-17 00:00:42 -03:00.
- Tipo da alteracao: Regra de orquestracao e handoff entre agentes.
- Motivo da mudanca: Lucas definiu que o Careli Hub opera por engenharia coordenada entre squads e que, ao concluir qualquer etapa, cada agente deve informar proxima squad necessaria, validacoes, dependencias, riscos e pendencias.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra transversal para `Hub Architect`, `Hub InfraOps`, `Hub DataOps`, `Hub QA`, `Hub Security`, `Hub Support Engineer`, `Guardian Core`, `CareDesk Core`, `PulseX Core` e futuras squads do Hub.
- Como foi feito: confirmei que a regra de orquestracao foi registrada dentro do manifesto operacional e acrescentei este registro da frente CareDesk ao final do diario, preservando os registros de Engenharia Careli Hub e Guardian Core.
- Logica utilizada: manter a regra global no manifesto e registrar tambem pela frente CareDesk garante que proximas entregas de atendimento, tickets, WhatsApp, disparos, SLA, filas e integracoes indiquem claramente continuidade, QA, riscos e dependencias sem invadir escopo de outras squads.
- Validacao executada: leitura local do `AGENTS.md`, busca no diario por regras de handoff/squads e confirmacao documental da regra de orquestracao no manifesto. Nao houve alteracao de codigo, schema, UX, integracao, build ou deploy porque a mudanca foi documental/processual.
- Pendencias ou riscos conhecidos: nenhuma pendencia tecnica imediata. Proximas implementacoes do CareDesk devem encerrar com proxima squad recomendada, normalmente `Hub QA` para validacao funcional, `Hub Architect` para revisao arquitetural, `Hub InfraOps` para deploy/ambiente, `Hub Security` para risco sensivel e `Hub DataOps` quando envolver dados/schema.

Registro de diario:

- Nome da squad/agente: `Dev Guardian`.
- Data e hora local: 2026-05-17 00:12:21 -03:00.
- Tipo da alteracao: Melhoria funcional de dashboard financeiro.
- Motivo da mudanca: Lucas pediu incluir no painel `Performance por empreendimento` o campo `Carteira acumulada`, entendido como a carteira do primeiro boleto ate o boleto presente.
- Arquivos/modulos afetados: `apps/hub/app/guardian/page.tsx` e `docs/codex/contexto-operacional.md`.
- Como foi feito: adicionei uma coluna ordenavel `Carteira acumulada` na tabela de performance por empreendimento, exibindo o valor via `MoneyValue` com tooltip de valor completo. A coluna usa o campo real `delinquencyBaseAmount`, ja carregado pelo overview/read-model do Guardian.
- Logica utilizada: `delinquencyBaseAmount` representa a base acumulada usada para inadimplencia (`vencidas + liquidadas`), portanto mostra o valor acumulado ate o presente sem somar parcelas futuras da carteira total. A mudanca preserva a fonte real C2X/Supabase e nao altera calculos financeiros existentes, apenas expõe a base acumulada no painel.
- Validacao executada: leitura do contexto operacional e das regras financeiras do Guardian; `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` executados com sucesso. Smoke local em `http://localhost:3001/guardian` retornou HTTP 200 usando a instancia dev ja ativa; a tentativa de iniciar outra instancia apenas indicou `EADDRINUSE` na porta 3001.
- Pendencias ou riscos conhecidos: Hub QA deve validar visualmente a tabela em desktop e mobile para confirmar largura, rolagem horizontal e clareza do novo campo. Hub DataOps pode ser acionado futuramente se Lucas quiser que `Carteira acumulada` inclua parcelas `Aguardando pagamento` vencidas/no dia por `due_date`, em vez de seguir a base atual `vencidas + liquidadas`.

Registro de diario:

- Nome da squad/agente: `Dev Guardian`.
- Data e hora local: 2026-05-17 00:16:47 -03:00.
- Tipo da alteracao: Correcao funcional de filtro do dashboard.
- Motivo da mudanca: Lucas apontou que, ao clicar em um empreendimento no dashboard, os dados do dash deveriam ser filtrados para o empreendimento selecionado.
- Arquivos/modulos afetados: `apps/hub/app/guardian/page.tsx` e `docs/codex/contexto-operacional.md`.
- Como foi feito: mantive a tabela `Performance por empreendimento` com todos os empreendimentos para permitir troca rapida de recorte, mas passei a derivar os KPIs financeiros e o resumo do painel a partir da linha selecionada. O clique no empreendimento aplica o recorte; clicar novamente no mesmo empreendimento volta para `Todos`. O badge do painel financeiro passa a mostrar o empreendimento selecionado.
- Logica utilizada: usei os campos reais ja presentes em `enterprisePerformance` (`totalPortfolioAmount`, `delinquencyBaseAmount`, `overduePrincipalAmount`, `overduePrincipalPayments`, `overdueClients`, `monthlyRecoveryAmount` e `monthlyRecoveryPayments`) para recalcular o snapshot do dash sem criar mock nem nova consulta. A base de inadimplencia continua respeitando `vencidas + liquidadas`. `Contratos criticos` fica sem valor especifico no recorte por empreendimento porque o read-model atual ainda nao entrega essa quebra com rastreabilidade suficiente.
- Validacao executada: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` executados com sucesso. Smoke local em `http://localhost:3001/guardian` retornou HTTP 200 usando a instancia dev ja ativa; a tentativa de iniciar outra instancia apenas indicou `EADDRINUSE` na porta 3001.
- Pendencias ou riscos conhecidos: Hub QA deve validar o clique em empreendimentos, a volta para `Todos`, os KPIs filtrados e a responsividade. Hub DataOps deve ser acionado se Lucas quiser recorte exato por empreendimento tambem para `Contratos criticos`, `Aging da inadimplencia` e `Composicao da cobranca`, pois esses agrupamentos ainda precisam de origem granular por empreendimento.

Registro de diario:

- Nome da squad/agente: `Hub QA`.
- Data e hora local: 2026-05-17.
- Tipo da alteracao: Validacao operacional e regressao visual.
- Motivo da validacao: validar o handoff da coluna `Carteira acumulada` no painel `Performance por empreendimento` do Guardian e o comportamento recente de filtro por empreendimento.
- Arquivos/modulos avaliados: `apps/hub/app/guardian/page.tsx`, `apps/hub/lib/guardian/overview.ts`, `apps/hub/lib/guardian/read-model-sync.ts` e rota local `http://localhost:3001/guardian`.
- Como foi feito: a tela foi aberta localmente no navegador interno em desktop `1280x720` e mobile `390x844`; a coluna `Carteira acumulada` foi inspecionada visualmente, a rolagem horizontal da tabela foi testada, a ordenacao foi clicada em ordem descendente e ascendente, o clique em `Lavra do Ouro` filtrou os KPIs e o segundo clique voltou para `C2X`.
- Logica utilizada: QA validou comportamento existente sem implementar feature; a coluna usa `delinquencyBaseAmount`, que segue a base atual de inadimplencia `vencidas + liquidadas`, sem incluir parcelas futuras nem redefinir regra de DataOps.
- Validacao executada: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` passaram. Desktop sem overflow global; tabela com rolagem interna horizontal e ordenacao da nova coluna funcionando em descendente e ascendente. Filtro por empreendimento funcionou em desktop e voltou para `Todos`/`C2X` ao clicar novamente.
- Problemas encontrados: em viewport mobile `390x844`, o documento apresentou `scrollWidth` maior que a viewport e barra horizontal global no rodape, alem da rolagem interna da tabela. Impacto operacional: operador em celular pode arrastar a pagina inteira lateralmente, reduzindo estabilidade visual e clareza de uso da tabela.
- Pendencias ou riscos conhecidos: confirmar com a operacao se `Carteira acumulada` deve permanecer como `vencidas + liquidadas` ou incluir parcelas `Aguardando pagamento` vencidas/no dia por `due_date`. Se a regra mudar, acionar `Hub DataOps` para ajustar a metrica na origem, nao apenas na UI. Se Lucas quiser recorte exato por empreendimento para `Contratos criticos`, `Aging da inadimplencia` e `Composicao da cobranca`, acionar `Hub DataOps`.
- Status operacional: `APROVADO COM AJUSTES`.

Registro de diario:

- Nome da squad/agente: `Hub InfraOps`.
- Data e hora local: 2026-05-17 00:19:56 -03:00.
- Tipo da alteracao: Deploy operacional controlado, validacao de ambiente Vercel e healthchecks.
- Motivo da mudanca: Lucas iniciou o primeiro deploy seguindo oficialmente a nova metodologia da engenharia Careli Hub, com objetivo de validar fluxo operacional de deploy, build, lint, typecheck, ambiente Vercel, variaveis, healthchecks, riscos e registro no diario antes de qualquer publicacao critica em producao.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; projeto Vercel `careli-hub-hub-i2bs`; deployment Preview `dpl_G9TRUX5eQNhzSgHsH4DQBndnsoUy`; deployment production-target com `--skip-domain` `dpl_BdjTVu3HtuDZ4Cr7vkHiLK7nvCjy`; dominio publico `https://c2x.app.br`.
- Como foi feito: li o diario operacional, conferi `package.json`, `apps/hub/package.json`, `vercel.json`, `turbo.json` e `.vercel/project.json`; rodei validacoes locais; conferi projeto e variaveis Vercel via CLI sem expor valores; criei deploy Preview; criei deploy production-target com `--skip-domain` para validar build com variaveis de Production sem promover o dominio customizado; executei healthchecks no dominio publico e confirmei protecao dos dominios `.vercel.app`.
- Logica utilizada: usar gates locais antes do Vercel, evitar promocao automatica do dominio `c2x.app.br`, preservar producao publica enquanto o artefato novo nao passa por QA/handoff, e validar healthchecks sem imprimir payloads sensiveis ou dados de clientes.
- Validacao executada: `npm.cmd run check-types:hub` passou; `npm.cmd run lint:hub` passou; `npm.cmd run build --workspace @repo/hub` passou localmente com Next 16.2.0; `npx.cmd vercel env ls` confirmou variaveis principais criptografadas em Production; `npx.cmd vercel project inspect careli-hub-hub-i2bs` confirmou Root Directory `.`, Node.js 24.x, Build Command `npx turbo build --filter=@repo/hub`, Output Directory `apps/hub/.next` e Install Command `npm install`; `npx.cmd vercel deploy --yes` criou Preview READY `dpl_G9TRUX5eQNhzSgHsH4DQBndnsoUy`; `npx.cmd vercel deploy --prod --skip-domain --yes` criou production-target READY `dpl_BdjTVu3HtuDZ4Cr7vkHiLK7nvCjy`; `npx.cmd vercel inspect careli-hub-hub-i2bs-6d53g80vl-lucasruas-devs-projects.vercel.app` confirmou target `production` e status Ready; `npx.cmd vercel alias ls` confirmou que `c2x.app.br` continuava apontando para deployment anterior; `npx.cmd vercel logs careli-hub-hub-i2bs-6d53g80vl-lucasruas-devs-projects.vercel.app --since 30m --level error` nao encontrou logs.
- Resultado dos healthchecks: dominios `.vercel.app` do Preview e do production-target retornaram 401 por SSO Protection antes da aplicacao, conforme `npx.cmd vercel project protection careli-hub-hub-i2bs --format json`, que indicou `deploymentType: all_except_custom_domains`; dominio publico `https://c2x.app.br/` retornou 200; `https://c2x.app.br/api/guardian/db/health` retornou 200 com `status=connected`; `https://c2x.app.br/api/guardian/attendance/queue?limit=20` retornou 200 com fonte `supabase-c2x`; `https://c2x.app.br/api/guardian/overview` retornou 401 esperado sem bearer token, confirmando guarda de autenticacao.
- Pendencias ou riscos conhecidos: o artefato novo nao foi promovido para `c2x.app.br`; healthcheck externo direto do artefato novo fica bloqueado por SSO Protection em `.vercel.app` sem bypass autenticado; a arvore local possui muitas alteracoes nao commitadas e o diario ainda aparece como nao rastreado no Git, criando risco de rastreabilidade antes de uma promocao real; build remoto emitiu aviso de 2 vulnerabilidades no `npm audit` e warning do Turbo sobre variaveis Postgres/Supabase configuradas no Vercel mas ausentes em `turbo.json`; variaveis opcionais de TURN/PulseX nao foram encontradas no ambiente listado e devem ser revisadas se chamadas de audio/video forem parte do escopo de homologacao.
- Status operacional: `AGUARDANDO QA`.
- Proxima squad recomendada: `Hub QA` para validacao funcional/visual em `c2x.app.br` e, se Lucas quiser promover o novo artefato, `Hub InfraOps` deve executar promocao controlada apos QA e revisao dos riscos.

Registro de diario:

- Nome da squad/agente: `Engenharia Careli Hub`.
- Data e hora local: 2026-05-17 00:21:56 -03:00.
- Tipo da alteracao: Decisao operacional permanente sobre commits, validacoes e handoff.
- Motivo da mudanca: Lucas oficializou o fluxo padronizado em que agentes de implementacao validam localmente, realizam commit proprio, atualizam o diario operacional, fazem handoff para QA e seguem depois para deploy.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra transversal para todas as squads de implementacao, validacao, arquitetura, seguranca, InfraOps, DataOps e modulos do Hub.
- Como foi feito: confirmei que a regra ja estava consolidada no manifesto operacional do diario e adicionei este registro ao final para preservar rastreabilidade da decisao.
- Logica utilizada: manter commits pequenos, semanticos e com uma responsabilidade principal reduz regressao, preserva continuidade entre squads e evita misturar alteracoes do Lucas ou de outros agentes em um mesmo pacote.
- Validacao executada: leitura local do diario operacional e busca por regras existentes de commit, validacao, handoff, QA e deploy. Nao houve build, lint, typecheck ou commit porque esta etapa foi apenas decisao documental/processual, sem implementacao de produto.
- Pendencias ou riscos conhecidos: proximas implementacoes devem aplicar o fluxo completo: validacao basica, commit semantico, registro do commit no diario, handoff com status, proxima squad, pendencias e riscos. O worktree atual possui alteracoes de outras frentes e qualquer commit futuro deve stagear apenas o escopo proprio.

Regra permanente combinada com Lucas em 2026-05-17 00:21:22 -03:00 sobre commits, validacoes e handoffs:

- A engenharia do Careli Hub passa a seguir oficialmente fluxo padronizado de commits, validacoes e handoffs entre squads.
- Todo agente responsavel por implementacao deve realizar o commit da propria alteracao apos validacao basica local.
- Antes do commit de implementacao, validar obrigatoriamente build, lint, typecheck e possiveis impactos operacionais.
- O commit deve ter mensagem semantica, objetiva e representar apenas uma responsabilidade principal.
- Nao misturar multiplos modulos ou responsabilidades no mesmo commit sem necessidade real e justificavel.
- Fluxo operacional oficial: implementacao -> validacao basica -> commit -> atualizacao do diario operacional `docs/codex/contexto-operacional.md` -> handoff -> QA -> deploy.
- Ao concluir implementacao, o agente deve informar commit realizado, status operacional, proxima squad recomendada, pendencias e riscos conhecidos.
- Squads de validacao, arquitetura e seguranca normalmente nao devem realizar commits de implementacao, salvo quando executarem correcoes diretamente.
- Objetivo da regra: preservar rastreabilidade, melhorar continuidade entre squads, reduzir regressao, melhorar estabilidade do Hub e organizar a engenharia operacional do ecossistema Careli Hub.

Registro de diario:

- Nome da squad/agente: `Engenharia Careli Hub`.
- Data e hora local: 2026-05-17 00:21:22 -03:00.
- Tipo da alteracao: Decisao operacional permanente e padronizacao de commit, validacao e handoff.
- Motivo da mudanca: Lucas definiu oficialmente que agentes de implementacao devem validar localmente, realizar o proprio commit, atualizar o diario operacional e entregar handoff estruturado antes de QA e deploy.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra transversal para todas as squads de implementacao, validacao, arquitetura, seguranca, suporte, dados e infra do Hub.
- Como foi feito: a regra foi adicionada ao final do diario operacional, preservando historico anterior e mantendo a orientacao como decisao global de engenharia, sem alterar codigo de produto, schema, UX, API ou deploy.
- Logica utilizada: registrar o fluxo no diario oficial garante rastreabilidade entre sessoes, impede commits misturando responsabilidades, deixa claro quando a validacao deve ocorrer e padroniza o handoff entre implementacao, QA, arquitetura, infra e futuras squads.
- Validacao executada: leitura local do diario operacional, busca de regras existentes sobre commit/handoff e verificacao de estado Git antes da alteracao. Nao houve validacao de build/lint/typecheck neste registro porque a mudanca foi documental/processual; essas validacoes passam a ser obrigatorias para commits de implementacao.
- Pendencias ou riscos conhecidos: a arvore de trabalho ainda contem varias alteracoes de produto pendentes de commits separados por responsabilidade. O diario operacional tambem deve ser versionado de forma rastreavel no pacote adequado, sem misturar indevidamente com mudancas funcionais de modulos.
- Status operacional: `FINALIZADO`.
- Proxima squad recomendada: nenhuma para esta decisao documental. Para proximas implementacoes, a squad responsavel deve seguir o fluxo implementacao -> validacao -> commit -> diario -> handoff -> QA -> deploy.

Regra permanente combinada com Lucas em 2026-05-17 00:21:45 -03:00 sobre commits, validacoes e handoffs:

- A engenharia do Careli Hub segue oficialmente o fluxo operacional padronizado de commits, validacoes e handoffs entre squads.
- Todo agente responsavel por implementacao deve realizar o commit da propria alteracao apos validacao basica local.
- Antes de commitar uma implementacao, validar obrigatoriamente build, lint, typecheck e possiveis impactos operacionais, registrando qualquer impossibilidade de validacao no handoff e no diario.
- O commit deve ter mensagem semantica, objetiva e representar uma responsabilidade principal. Nao misturar multiplos modulos ou responsabilidades no mesmo commit sem necessidade real.
- Fluxo operacional oficial de implementacao: implementacao -> validacao basica -> commit -> atualizacao do diario operacional `docs/codex/contexto-operacional.md` -> handoff -> QA -> deploy.
- Ao concluir uma implementacao, o agente deve informar obrigatoriamente o commit realizado, status operacional, proxima squad recomendada e pendencias ou riscos conhecidos.
- Squads de validacao, arquitetura e seguranca normalmente nao devem realizar commits de implementacao, salvo quando executarem correcoes diretamente.
- O objetivo da metodologia e preservar rastreabilidade, melhorar continuidade entre squads, reduzir regressoes, melhorar estabilidade do Hub e organizar a engenharia operacional do ecossistema Careli Hub.
- Em alteracoes exclusivamente documentais/processuais sem codigo, schema, UX, API, integracao ou deploy, a validacao pode ser documental. Se o workspace estiver com mudancas nao relacionadas ou o diario ainda nao estiver isolado em commit proprio, nao criar commit misturando responsabilidades; registrar o risco e orientar a regularizacao por commit limpo.

Registro de diario:

- Nome da squad/agente: `Engenharia Careli Hub`.
- Data e hora local: 2026-05-17 00:21:45 -03:00.
- Tipo da alteracao: Decisao operacional permanente e regra de commit/handoff.
- Motivo da mudanca: Lucas definiu oficialmente que agentes responsaveis por implementacao devem validar localmente, commitar a propria alteracao com mensagem semantica, atualizar o diario operacional e entregar handoff com commit, status, proxima squad, pendencias e riscos.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra transversal para todas as squads do Hub e para implementacoes em Guardian, CareDesk, PulseX, Setup, Infra, DataOps, Security, Architect, QA e futuras frentes.
- Como foi feito: registrei a metodologia de commit, validacao e handoff como regra permanente no diario operacional, mantendo a separacao entre implementacoes com commit obrigatorio e mudancas documentais/processuais sem alteracao tecnica.
- Logica utilizada: a regra fortalece rastreabilidade e continuidade entre squads, evita commits mistos, cria um gate minimo de build/lint/typecheck antes de handoff e torna explicita a proxima etapa operacional antes de QA/deploy.
- Validacao executada: leitura local do diario operacional, busca por regras existentes de commit, validacao e handoff, e confirmacao documental deste registro. Nao houve build, lint, typecheck ou deploy porque a mudanca foi apenas documental/processual.
- Pendencias ou riscos conhecidos: o workspace atual possui muitas alteracoes nao relacionadas e `docs/codex/` ainda aparece como nao rastreado, entao nao foi criado commit deste registro para evitar misturar responsabilidades. Proxima squad recomendada: `Hub Architect` para confirmar a regra como politica transversal, ou `Hub InfraOps`/responsavel de Git para regularizar commits limpos do diario e das frentes pendentes antes de nova promocao critica.
- Status operacional: `FINALIZADO`.

Regra permanente combinada com Lucas em 2026-05-17 00:21:37 -03:00 sobre commits, validacoes e handoff:

- Todo agente responsavel por implementacao deve realizar o commit da propria alteracao apos validacao basica local.
- Validacoes obrigatorias antes do commit: build, lint, typecheck e analise dos possiveis impactos operacionais. Em mudancas exclusivamente documentais, registrar o motivo de nao executar validacoes tecnicas.
- O commit deve ter mensagem semantica e objetiva, com uma responsabilidade principal por commit.
- Nao misturar multiplos modulos ou responsabilidades no mesmo commit sem necessidade real.
- Fluxo oficial: implementacao -> validacao basica -> commit -> atualizacao do diario operacional `docs/codex/contexto-operacional.md` -> handoff -> QA -> deploy.
- A resposta final de uma implementacao deve informar o commit realizado, status operacional, proxima squad recomendada, pendencias e riscos conhecidos.
- Squads de validacao, arquitetura e seguranca normalmente nao devem realizar commits de implementacao, salvo quando executarem correcoes diretamente.
- Se houver alteracoes pre-existentes no worktree, o agente deve preservar essas mudancas e commitar apenas os arquivos do proprio escopo.

Registro de diario:

- Nome da squad/agente: `Engenharia Careli Hub`.
- Data e hora local: 2026-05-17 00:21:37 -03:00.
- Tipo da alteracao: Decisao operacional permanente e regra de Git/entrega.
- Motivo da mudanca: Lucas definiu oficialmente o fluxo padronizado de commits, validacoes e handoffs entre squads para preservar rastreabilidade, reduzir regressoes, melhorar continuidade e organizar a engenharia operacional do Careli Hub.
- Arquivos/modulos afetados: `docs/codex/contexto-operacional.md`; regra transversal para todas as squads do Hub.
- Como foi feito: adicionei a regra no manifesto operacional, perto do fluxo oficial do Hub, e registrei esta entrada ao final do diario para continuidade entre agentes.
- Logica utilizada: centralizar a regra no diario garante que agentes futuros saibam quando validar, commitar, registrar o commit, separar escopo e orientar o proximo fluxo operacional sem misturar responsabilidades ou arquivos de outras squads.
- Validacao executada: leitura local do diario operacional, busca por regras existentes de commit/handoff e conferencia do worktree; `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` executados com sucesso.
- Pendencias ou riscos conhecidos: o worktree possui muitas alteracoes pre-existentes de outras frentes. O commit desta decisao deve stagear somente `docs/codex/contexto-operacional.md` para evitar misturar responsabilidades.

Registro de diario:

- Nome da squad/agente: `Dev Guardian`.
- Data e hora local: 2026-05-17 00:32:26 -03:00.
- Tipo da alteracao: Correcao de responsividade mobile no dashboard Guardian.
- Motivo da mudanca: QA aprovou o recorte por empreendimento com ajustes e apontou overflow horizontal global em viewport mobile `390x844`, alem da rolagem interna esperada da tabela `Performance por empreendimento`.
- Arquivos/modulos afetados: `apps/hub/app/guardian/page.tsx`, `apps/hub/components/guardian/layout/MainLayout.tsx`, `apps/hub/styles/globals.css` e `docs/codex/contexto-operacional.md`.
- Como foi feito: medi `documentElement.scrollWidth`, `body.scrollWidth` e `clientWidth` no navegador interno com viewport `390x844`; identifiquei que o `html { min-width: 1024px; }` global mantinha largura minima desktop no shell Guardian mobile e que o drawer fechado de KPI permanecia renderizado fora da tela. O shell Guardian recebeu classe de escopo `guardian-module-shell`, o CSS global passou a remover `min-width` apenas quando esse shell existe, o container Guardian passou a bloquear `overflow-x` global e o drawer de KPI passou a ser renderizado apenas quando houver KPI selecionado.
- Logica utilizada: manter a rolagem horizontal somente dentro dos componentes tabulares e impedir que o documento inteiro ganhe barra horizontal. A tabela principal continua com `scrollWidth` interno para navegacao dos campos largos, mas `documentScrollWidth` e `bodyScrollWidth` passam a acompanhar a largura real da viewport mobile.
- Validacao executada: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` executados com sucesso; smoke local em `http://localhost:3001/guardian` retornou HTTP 200; validacao no navegador interno em `390x844` confirmou `documentScrollWidth=390`, `bodyScrollWidth=390`, `clientWidth=390` e `hasGlobalOverflow=false`, mantendo rolagem interna da tabela com `scrollWidth=1120`.
- Pendencias ou riscos conhecidos: `Contratos criticos`, `Aging da inadimplencia` e `Composicao da cobranca` seguem sem recorte real por empreendimento por falta de origem granular no read model; acionar `Hub DataOps` se Lucas quiser esse nivel de detalhamento. O worktree ainda possui alteracoes nao relacionadas de outras squads/frentes, portanto o commit desta correcao deve stagear apenas os hunks deste ajuste.
- Status operacional: `AGUARDANDO QA`.
- Proxima squad recomendada: `Hub QA` para regressao mobile/desktop do dashboard Guardian.
