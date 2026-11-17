# Loja da Gigi

Aplicação estática em HTML5, CSS3 e JavaScript para controlar estoque de geladinhos, vendas e fiados. Abre no celular ou no computador e salva os dados no `localStorage` do navegador.

## Uso

1. Escolha Samuel ou Giovana para personalizar a saudação. O seletor no topo permite trocar o nome.
2. Em **Estoque e sabores**, cadastre sabores e defina quantidade e preço. Use **+1 un.** para repor uma unidade ou **Editar** para alterar nome, preço e saldo disponível. A primeira abertura mostra 13 sabores e 26 unidades de exemplo, que podem ser ajustados antes de começar.
3. Em **Nova venda**, selecione o sabor e a quantidade. Use o preço sugerido pelo cadastro ou defina um preço para a venda. Para desconto por quantidade, ajuste o preço unitário ou informe um desconto no total. O total deve ficar acima de zero.
4. Escolha Pix, crédito, débito, dinheiro ou fiado. Para fiado, informe o telefone do comprador com DDD. Quando receber, selecione a modalidade em **Fiados em aberto** e confirme a quitação.
5. Use **Histórico de vendas** para consultar valores e pagamentos. O cancelamento devolve as unidades ao estoque, mantém o registro da operação e retira seus valores dos indicadores. Para vendas pagas, faça o estorno pelo meio utilizado antes de confirmar o cancelamento no app.

## Indicadores

| Indicador | Como é calculado |
| --- | --- |
| Receita bruta de vendas | Quantidade × preço aplicado − desconto. Inclui fiados em aberto e exclui cancelamentos. |
| Custo dos produtos vendidos | Quantidade vendida × custo registrado na venda. O custo começa em R$ 3,00 por unidade e pode ser alterado em **Configuração de valores**. |
| Lucro bruto estimado | Receita bruta − custo dos produtos vendidos. Taxas, transporte e outras despesas ficam fora do cálculo. |
| Recebido e a receber | Os pagamentos imediatos e os fiados quitados compõem o recebido. Os fiados em aberto compõem o saldo a receber. A quitação altera esses saldos sem gerar uma segunda receita. Cobranças de cartão são registradas pelo valor da venda, sem conciliação de taxas ou repasses. |
| Estoque potencial | A receita potencial usa o preço atual de cada sabor. O custo estimado usa o custo unitário atual para as unidades disponíveis. A diferença é o lucro bruto potencial. |

Cada venda guarda o preço, o desconto, o custo e o nome do sabor no momento do registro. Alterações de cadastro afetam as próximas vendas.

## Relatórios e backup

- **CSV** exporta o histórico com um intervalo inclusivo no fuso do aparelho. Para um único dia, use a mesma data em **De** e **Até**. Limpe os dois campos para exportar tudo. O filtro usa a data da venda e o arquivo mostra a situação atual, a data de recebimento e o cancelamento. Cancelamentos mantêm o valor original para consulta e têm zero nas colunas dos indicadores. O CSV usa UTF-8 com BOM e ponto e vírgula como separador.
- **Backup JSON** guarda estoque, preços, custo, perfil e histórico completo, incluindo fiados quitados e vendas canceladas. Baixe uma cópia periodicamente e antes de trocar de aparelho, limpar o navegador ou mudar o endereço do site.
- **Importar backup** valida primeiro o arquivo e rejeita inconsistências e IDs repetidos. A prévia mostra quantos registros serão substituídos e oferece baixar os dados locais. Para aplicar, digite **RESTAURAR** e confirme. A restauração carrega o conteúdo integral do arquivo. Importar o mesmo arquivo novamente mantém a mesma quantidade de registros.
- O app lê dados locais das versões 2 a 4 e aceita backups JSON da versão 4. Nas versões 2 e 3, que usavam valores fixos, as vendas são recuperadas com os valores originais de R$ 8,00 por unidade e R$ 3,00 de custo. Quando falta a modalidade de um registro antigo, ela aparece como desconhecida. Se o app não conseguir ler os dados locais, ele bloqueia as edições e oferece baixar a cópia bruta antes de restaurar.
- **Restaurar dados iniciais** reinicia estoque e configurações e apaga o histórico depois de confirmação explícita. Faça backup antes.

### Armazenamento e privacidade

O armazenamento é separado por origem, navegador e perfil do navegador. A versão local e a publicada têm dados separados. A limpeza dos dados do site e o modo privado podem apagar registros. Web Locks serializa as escritas entre abas nos navegadores que oferecem esse recurso. Use uma aba por vez se o recurso estiver indisponível.

O site pode ser aberto publicamente, e qualquer pessoa com acesso ao mesmo perfil do navegador pode acessar os dados locais. A seleção de Samuel ou Giovana personaliza a saudação; ambos usam o mesmo cadastro naquele navegador. O app não transmite nem criptografa o histórico. Guarde os arquivos CSV e JSON de forma privada, especialmente porque podem conter telefones de clientes. Nunca coloque arquivos de produção no repositório.

Uma evolução para backend, banco de dados e SaaS poderia oferecer contas individuais, sincronização, backups administrados e controle de acesso.

## Execução local e testes

O site não precisa de instalação nem de build. Com Python disponível, abra um terminal na raiz do projeto, execute `py -m http.server 8000 --bind 127.0.0.1` (Windows) ou `python3 -m http.server 8000 --bind 127.0.0.1` e abra `http://127.0.0.1:8000`. Use o mesmo endereço ao voltar para acessar os mesmos dados.

Para rodar os testes de interface, use Node.js 22+ e Microsoft Edge ou Chrome com Chromium instalado. Execute `node --test tests/browser.test.mjs`. O teste inicia um servidor temporário e um perfil descartável. Se o navegador estiver fora dos caminhos padrão, informe o executável na variável `BROWSER_PATH`. Opcionalmente, defina `LOJA_TEST_URL` para testar uma publicação HTTPS. Todas as operações de teste ficam no perfil descartável.

## Publicação no GitHub Pages

No repositório, abra **Settings → Pages**. Em **Build and deployment**, selecione **Deploy from a branch**, escolha **main** e **/(root)** e clique em **Save**. Confira a execução em **Actions** e abra o endereço que aparecer em **Settings → Pages**. Os caminhos do CSS e do JavaScript são relativos, adequados ao subdiretório do repositório. [Documentação do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
