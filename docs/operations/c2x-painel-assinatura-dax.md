# Painel Assinatura (Power BI): as medidas, extraídas do .pbit

> Extraído em 13/08/2026 de `Careli - Dashboard Vista Alegre.pbit` (Arquivo > Exportar > Modelo do
> Power BI). O .pbix não serve: o DataModel vem comprimido em VertiPaq. O .pbit traz o
> `DataModelSchema` em JSON, com todo o DAX legível.
>
> Guardado aqui porque o painel é a definição operacional de "contrato assinado" que a Careli já
> usa, e portar isso para o Panteon exige seguir as MESMAS regras, incluindo as que estão erradas.

## Leia isto antes de portar

**1. O filtro oficial de "saiu para assinar" é `send_document_signature = true` e status ≠ 6.**
É o que a consulta M usa. No Vale do Ouro dá o mesmo conjunto que `uuidDoc` preenchido: 179 dos
210 contratos. Confere com o estudo em [c2x-assinatura-contratos.md](c2x-assinatura-contratos.md).

**2. "Comprador" no painel é o perfil `Cliente` do C2X.** A consulta M troca o rótulo:
`if _ = "cliente" then "Comprador"`.

**3. "Backoffice" NÃO existe no C2X.** É regra da tela: quem tem e-mail `@careli.adm.br` tem o
perfil sobrescrito para Backoffice, qualquer que seja o perfil real. Por isso Nívea aparece como
Backoffice no painel e como Corretor no banco.

**4. ⚠️ Três medidas têm uma lista de unidades escrita à mão, e as listas DIVERGEM.**
O autor deixou o comentário `🔧 Gambiarra: forçar inclusão manual das unidades que a API não
atualizou corretamente`:

| Medida | Lista embutida |
|---|---|
| `Unidades 100% Assinadas (Sem Pendência)` | LABC1224, LABC1111, **LABL0306**, LABC1214 |
| `Unidades com Todos os Compradores Assinados` | LABC1224, LABC1111, **LABL0705**, LABC1214 |
| `Unidades com Comprador Pendente` | LABC1224, LABC1111, **LABL0705**, LABC1214 |

A terceira unidade é diferente na primeira medida. **LABL0306** e **LABL0705** são unidades
distintas da Lagoa Bonita (ids 4946 e 4982), e as duas existem no C2X com **zero** linhas de
assinatura. Efeito: os cards do painel não fecham entre si, e uma unidade entra como finalizada
num card e não no outro. Ao portar, isso vira uma regra explícita ou uma correção do dado, nunca
uma lista no código.

**5. O prazo é de 7 dias**, e só vale para o Comprador (`DiasLimite = 7` em `Prazo Assinatura`).

## De onde vem o dado (Power Query M)

### partition Assinatura_Data · m

```
let
    // 1. Fonte principal
    Fonte = #"prod_careli acquisition_request_contracts",

    // 2. Filtra apenas os contratos enviados para assinatura e com status diferente de 6
    LinhasFiltradas = Table.SelectRows(
        Fonte,
        each 
            [prod_careli.contract_signatures.send_document_signature] = true and
            [prod_careli.contract_signatures.contract_signature_status_id] <> 6
    ),

    // 3. Renomeia colunas desejadas (incluindo id_assinante)
    Renomeado = Table.RenameColumns(
        LinhasFiltradas,
        {
            {"prod_careli.contract_signatures.id", "id_ass"},
            {"prod_careli.contract_signatures.created_at", "Envio do Contrato"},
            {"prod_careli.acquisition_requests.prod_careli.enterprise_unities.name", "Unidade"},
            {"prod_careli.acquisition_requests.prod_careli.enterprise_unities.prod_careli.en.1", "Empreendimento"},
            {"prod_careli.contract_signers.prod_careli.signers.name", "Usuário"},
            {"prod_careli.contract_signers.prod_careli.signers.email", "Email"},
            {"prod_careli.contract_signers.prod_careli.signers.prod_careli.users.prod_careli.1", "Perfil"},
            {"prod_careli.contract_signers.id", "id_assinante"}
        }
    ),

    // 4. Substitui "cliente" por "Comprador"
    SubstituirPerfil = Table.TransformColumns(
        Renomeado,
        {{"Perfil", each if _ = "cliente" then "Comprador" else _, type text}}
    ),

    // 4.1. Ajusta perfil apenas para usuários da Careli (domínio careli.adm.br)
    AdicionarPerfilAjustado = Table.AddColumn(
        SubstituirPerfil,
        "Perfil_Ajustado",
        each 
            if Text.EndsWith(Text.Lower([Email]), "@careli.adm.br") 
            then "Backoffice" 
            else [Perfil],
        type text
    ),

    RemoverPerfilOriginal = Table.RemoveColumns(
        AdicionarPerfilAjustado,
        {"Perfil"}
    ),

    RenomearPerfilAjustado = Table.RenameColumns(
        RemoverPerfilOriginal,
        {{"Perfil_Ajustado", "Perfil"}}
    ),

    // 5. Carrega a tabela de signers (assinaturas)
    FonteSigners = #"prod_careli contract_signature_signers",

    // 6. Junção para trazer 'after_position' usando id_assinante
    ComAfterPosition = Table.NestedJoin(
        RenomearPerfilAjustado,
        {"id_assinante"},
        FonteSigners,
        {"contract_signer_id"},
        "AfterPositionDados",
        JoinKind.LeftOuter
    ),

    ExpandidoAfter = Table.ExpandTableColumn(
        ComAfterPosition,
        "AfterPositionDados",
        {"after_position"},
        {"Posição Após"}
    ),

    // 7. Junção para trazer dados de assinatura (date_signed e signed)
    MescladoAssinatura = Table.NestedJoin(
        ExpandidoAfter,
        {"id_assinante"},
        FonteSigners,
        {"contract_signer_id"},
        "DadosAssinatura",
        JoinKind.LeftOuter
    ),

    ExpandidoAssinatura = Table.ExpandTableColumn(
        MescladoAssinatura,
        "DadosAssinatura",
        {"date_signed", "signed"},
        {"Data de Assinatura", "Assinado"}
    ),

    // 8. Converte booleano em Sim/Não
    AssinadoFormatado = Table.TransformColumns(
        ExpandidoAssinatura,
        {{"Assinado", each if _ = true then "Sim" else "Não", type text}}
    ),

    // 9. Cria coluna de dias desde envio
    DiasDesdeEnvio = Table.AddColumn(
        AssinadoFormatado,
        "Dias desde Envio",
        each Duration.Days(
            Duration.From(
                if [Assinado] = "Sim" then 
                    [Data de Assinatura] - [Envio do Contrato] 
                else 
                    DateTime.LocalNow() - [Envio do Contrato]
            )
        ),
        Int64.Type
    ),

    // 10. Cria coluna de status com base em 7 dias (para todos os perfis)
    StatusAssinatura = Table.AddColumn(
        DiasDesdeEnvio,
        "Status Assinatura no Prazo",
        each
            if [Assinado] = "Sim" and [Dias desde Envio] <= 7 then "Assinado no prazo"
            else if [Assinado] = "Sim" and [Dias desde Envio] > 7 then "Assinado fora do prazo"
            else if [Assinado] = "Não" and [Dias desde Envio] <= 7 then "Pendente dentro do prazo"
            else if [Assinado] = "Não" and [Dias desde Envio] > 7 then "Pendente e em atraso"
            else null
    ),

    // 11. Seleciona colunas finais
    Assinatura_Data = Table.SelectColumns(
        StatusAssinatura,
        {
            "id_ass", "id_assinante", "Unidade", "Empreendimento", "Usuário", "Email", "Perfil",
            "Envio do Contrato", "Data de Assinatura", "Assinado", "Dias desde Envio",
            "Status Assinatura no Prazo", "Posição Após"
        }
    )
in
    Assinatura_Data
```

## As colunas calculadas

### Prazo Assinatura

```
VAR DiasLimite = 7
VAR DataEnvio = 'Assinatura_Data'[Envio do Contrato]
VAR DataAssinatura = 'Assinatura_Data'[Data de Assinatura]
VAR DiasDecorridos = 
    IF(
        'Assinatura_Data'[Assinado] = "Sim",
        DATEDIFF(DataEnvio, DataAssinatura, DAY),
        DATEDIFF(DataEnvio, TODAY(), DAY)
    )
RETURN
IF(
    'Assinatura_Data'[Perfil] = "Comprador",
    SWITCH(
        TRUE(),
        'Assinatura_Data'[Assinado] = "Sim" && DiasDecorridos <= DiasLimite, "Assinado no prazo",
        'Assinatura_Data'[Assinado] = "Sim" && DiasDecorridos > DiasLimite, "Assinado fora do prazo",
        'Assinatura_Data'[Assinado] = "Não" && DiasDecorridos <= DiasLimite, "Pendente dentro do prazo",
        'Assinatura_Data'[Assinado] = "Não" && DiasDecorridos > DiasLimite, "Pendente e em atraso",
        BLANK()
    ),
    BLANK()
)
```

### Status Assinatura Sequencial

```
VAR UnidadeAtual = 'Assinatura_Data'[Unidade]
VAR ContratoAtual = 'Assinatura_Data'[id_ass]
VAR PosicaoAtual = 'Assinatura_Data'[Posição Após]
VAR AssinouAtual = 'Assinatura_Data'[Assinado]

-- Filtra todas as linhas da mesma unidade e contrato
VAR LinhasMesmoContrato =
    FILTER(
        'Assinatura_Data',
        'Assinatura_Data'[Unidade] = UnidadeAtual &&
        'Assinatura_Data'[id_ass] = ContratoAtual
    )

-- Filtra os que têm posição anterior
VAR AssinaturasAnteriores =
    FILTER(
        LinhasMesmoContrato,
        'Assinatura_Data'[Posição Após] < PosicaoAtual
    )

-- Verifica se todos os anteriores assinaram
VAR TodosAssinaramAntes =
    COUNTROWS(
        FILTER(
            AssinaturasAnteriores,
            'Assinatura_Data'[Assinado] <> "Sim"
        )
    ) = 0

RETURN
SWITCH(
    TRUE(),
    AssinouAtual = "Sim", "Assinado",
    TodosAssinaramAntes, "Pendente – assinatura liberada",
    NOT TodosAssinaramAntes, "Pendente – aguardando assinatura anterior",
    BLANK()
)
```

### Ordem_Assinatura_Unica

```
'Assinatura_Data'[Unidade] & "-" & 
FORMAT('Assinatura_Data'[Posição Após], "00") & "-" & 
FORMAT('Assinatura_Data'[id_assinante], "00000")
```

### OrdemID_Numérica

```
RANKX(
    ALL('Assinatura_Data'),
    'Assinatura_Data'[Ordem_Assinatura_Unica],
    ,
    ASC,
    DENSE
)
```

### Status_Assinatura_Simplificado

```
SWITCH(
    TRUE(),
    'Assinatura_Data'[Status Assinatura Sequencial] = "Assinado", "Assinado",
    'Assinatura_Data'[Status Assinatura Sequencial] = "Pendente – assinatura liberada", "Assinar",
    TRUE(), "Aguardando"
)
```

### Status Finalização Unidade

```
VAR UnidadeAtual = 'Assinatura_Data'[Unidade]

VAR TotalPendencias = 
    CALCULATE (
        COUNTROWS('Assinatura_Data'),
        ALLEXCEPT('Assinatura_Data', 'Assinatura_Data'[Unidade]),
        'Assinatura_Data'[Unidade] = UnidadeAtual,
        'Assinatura_Data'[Assinado] <> "Sim"
    )

RETURN
    IF(TotalPendencias = 0, "Finalizada", "Pendente")
```

### StatusAssinatura

```
IF (
    Assinatura_Data[Assinado] = "Sim",
    "Assinado",
    "Assinar"
)
```

## As medidas

### % Compradores Assinaram

```
VAR TotalCompradores =
    CALCULATE(
        COUNTROWS('Assinatura_Data'),
        'Assinatura_Data'[Perfil] = "Comprador",
        NOT ISBLANK('Assinatura_Data'[Assinado])
    )

VAR CompradoresAssinaram =
    CALCULATE(
        COUNTROWS('Assinatura_Data'),
        'Assinatura_Data'[Perfil] = "Comprador",
        'Assinatura_Data'[Assinado] = "Sim"
    )

RETURN
    COALESCE(DIVIDE(CompradoresAssinaram, TotalCompradores), 0)
```

### % Unidades Finalizadas (Sem Pendência)

```
VAR Total = [Total de Unidades]
VAR Finalizadas = [Unidades 100% Assinadas (Sem Pendência)]
RETURN
IF(
    Total = 0,
    0,
    DIVIDE(Finalizadas, Total)
)
```

### % Unidades com Todos os Compradores Assinados

```
VAR UnidadesFinalizadas =
    [Unidades com Todos os Compradores Assinados]

VAR TotalUnidades =
    [Total de Unidades]

RETURN
    IF(
        TotalUnidades = 0,
        0,
        DIVIDE(UnidadesFinalizadas, TotalUnidades)
    )
```

### Tempo Médio (dias)

```
AVERAGEX(
    FILTER(
        'Assinatura_Data',
        'Assinatura_Data'[Assinado] = "Sim"
    ),
    DATEDIFF('Assinatura_Data'[Envio do Contrato], 'Assinatura_Data'[Data de Assinatura], DAY)
)
```

### Total Compradores

```
CALCULATE(
    COUNTROWS('Assinatura_Data'),
    'Assinatura_Data'[Perfil] = "Comprador"
)
```

### Total Compradores Atrasados

```
CALCULATE(
    COUNTROWS('Assinatura_Data'),
    'Assinatura_Data'[Prazo Assinatura] = "Pendente e em atraso"
)
```

### Total Compradores Pendentes

```
COALESCE(
    CALCULATE(
        COUNTROWS('Assinatura_Data'),
        'Assinatura_Data'[Perfil] = "Comprador",
        'Assinatura_Data'[Assinado] = "Não"
    ),
    0
)
```

### Total de Unidades

```
CALCULATE(
    DISTINCTCOUNT('Assinatura_Data'[Unidade]),
    REMOVEFILTERS('Assinatura_Data'[Perfil])  // Remove filtro por perfil (ex: Comprador)
)
```

### Unidades 100% Assinadas (Sem Pendência)

```
VAR Unidades = 
    SUMMARIZE('Assinatura_Data', 'Assinatura_Data'[Unidade])

VAR UnidadesSemPendencia =
    FILTER(
        Unidades,
        CALCULATE(
            COUNTROWS(
                FILTER(
                    'Assinatura_Data',
                    'Assinatura_Data'[Assinado] = "Não"
                )
            )
        ) = 0
    )

-- 🔧 Gambiarra: incluir unidades manualmente
VAR UnidadesAPIComErro = {
    "LABC1224",
    "LABC1111",
    "LABL0306",
    "LABC1214"
}

VAR UnidadesCompletas =
    UNION(
        UnidadesSemPendencia,
        SELECTCOLUMNS(
            FILTER(
                Unidades,
                'Assinatura_Data'[Unidade] IN UnidadesAPIComErro
            ),
            "Unidade", 'Assinatura_Data'[Unidade]
        )
    )

RETURN
COALESCE(COUNTROWS(UnidadesCompletas), 0)
```

### Unidades Faltando Finalizar

```
VAR UnidadesTotais =
    CALCULATETABLE(
        VALUES('Assinatura_Data'[Unidade]),
        ALL('Assinatura_Data')
    )

VAR UnidadesComPendencia =
    FILTER(
        UnidadesTotais,
        CALCULATE(
            COUNTROWS(
                FILTER(
                    'Assinatura_Data',
                    'Assinatura_Data'[Assinado] = "Não"
                )
            )
        ) > 0
    )

RETURN
    COUNTROWS(UnidadesComPendencia)
```

### Unidades com Comprador Pendente

```
VAR TodasUnidades =
    SUMMARIZE(
        FILTER('Assinatura_Data', 'Assinatura_Data'[Perfil] = "Comprador"),
        'Assinatura_Data'[Unidade]
    )

-- 🔧 Lista das unidades que a API não atualizou corretamente
VAR UnidadesAPIComErro = {
    "LABC1224",
    "LABC1111",
    "LABL0705",
    "LABC1214"
}

VAR UnidadesPendentes =
    FILTER(
        TodasUnidades,
        NOT('Assinatura_Data'[Unidade] IN UnidadesAPIComErro) && -- ignora as unidades da gambiarra
        CALCULATE(
            COUNTROWS(
                FILTER(
                    'Assinatura_Data',
                    'Assinatura_Data'[Perfil] = "Comprador" &&
                    'Assinatura_Data'[Assinado] <> "Sim"
                )
            )
        ) > 0
    )

RETURN
COALESCE(COUNTROWS(UnidadesPendentes), 0)
```

### Unidades com Todos os Compradores Assinados

```
VAR TodasUnidades =
    SUMMARIZE(
        FILTER('Assinatura_Data', 'Assinatura_Data'[Perfil] = "Comprador"),
        'Assinatura_Data'[Unidade]
    )

VAR UnidadesCompletas =
    FILTER(
        TodasUnidades,
        CALCULATE(
            COUNTROWS('Assinatura_Data'),
            'Assinatura_Data'[Perfil] = "Comprador"
        ) =
        CALCULATE(
            COUNTROWS('Assinatura_Data'),
            'Assinatura_Data'[Perfil] = "Comprador",
            'Assinatura_Data'[Assinado] = "Sim"
        )
    )

-- 🔧 Gambiarra: forçar inclusão manual das unidades que a API não atualizou corretamente
VAR UnidadesAPIComErro = {
     "LABC1224",
    "LABC1111",
    "LABL0705",
    "LABC1214"
}

VAR UnidadesCorrigidas =
    UNION(
        UnidadesCompletas,
        SELECTCOLUMNS(
            FILTER(
                TodasUnidades,
                'Assinatura_Data'[Unidade] IN UnidadesAPIComErro
            ),
            "Unidade", 'Assinatura_Data'[Unidade]
        )
    )

RETURN
COALESCE(COUNTROWS(UnidadesCorrigidas), 0)
```
