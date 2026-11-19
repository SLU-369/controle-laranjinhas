# Loja da Gigi · 1.2

Controle de estoque, vendas e fiados em HTML, CSS e JavaScript, instalável como PWA e com uso offline após a preparação inicial. A loja salva os dados no navegador e está hospedada no [Cloudflare Pages](https://loja-da-gigi.pages.dev/).

## Vendas e estoque

1. Escolha Samuel ou Giovanna no primeiro acesso. O seletor no topo permite trocar a saudação.
2. Cadastre, edite ou reponha sabores em **Estoque e sabores**. A primeira abertura contém 13 sabores e 26 unidades de exemplo. Ajuste os saldos antes de iniciar a operação.
3. Em **Nova venda**, escolha os sabores e as quantidades. Em **Como definir o preço**, use **Preço por unidade** para editar o valor de cada sabor ou **Total manual** para informar um valor combinado. Nos dois casos é possível aplicar desconto no total.
4. **Promoção por quantidade** aplica R$ 15,00 para uma unidade, R$ 26,00 para duas e R$ 30,00 para três. A quantidade é a soma de todos os sabores na venda. A partir de quatro unidades, escolha uma das opções manuais. A prévia mostra quantidade, preço, desconto, total e ganho estimado.
5. Selecione Pix, crédito, débito, dinheiro ou fiado. O fiado exige telefone com DDD e aceita nome opcional. Em **Fiados em aberto**, selecione como recebeu e informe o valor para registrar uma parcela. Deixe o valor vazio para quitar o saldo. O histórico mantém cada valor, modalidade e data de recebimento.
6. Cancelar uma venda devolve todas as unidades ao estoque e mantém seu registro. Estorne os pagamentos externamente antes de cancelar, inclusive parcelas de fiado já recebidas.

O custo padrão é R$ 3,00 por unidade e pode ser alterado. Cada item guarda o nome do sabor, preço, desconto e custo aplicados na venda. No total manual, o valor combinado é rateado pela quantidade. O desconto manual é rateado pelo subtotal de cada item. O rateio preserva o valor exato em centavos.

## Indicadores e fechamento de caixa

| Indicador | Regra |
| --- | --- |
| Receita bruta | Valor vendido após descontos, incluindo fiados. |
| Total recebido | Pagamentos registrados por Pix, crédito, débito, dinheiro e modalidades legadas desconhecidas. O app registra valores de cartão antes de taxas e sem conciliação de repasses. |
| Custo dos produtos vendidos | Quantidade vendida × custo unitário registrado em cada item. |
| Ganho estimado nas vendas | Receita bruta menos o custo dos produtos vendidos, antes de taxas e outras despesas. |
| Fiados pendentes | Saldo em aberto após os recebimentos contabilizados. |
| Receita potencial do estoque | Quantidade disponível × preço atual de cada sabor. |

Use **Hoje**, **Semana** (segunda a domingo), **Mês** ou **Período personalizado**. Os intervalos são inclusivos e usam o fuso do aparelho. Vendas entram pela data da venda, pagamentos pela data do recebimento. A linha de fiados anteriores ao período destaca pagamentos de vendas feitas antes da data inicial. O saldo pendente considera o fim do período, inclusive para vendas anteriores. Para registros antigos com recebimento sem data, o valor entra no saldo e aparece como recebido na consulta sem datas.

Cancelamentos ficam no histórico, mas saem dos indicadores, inclusive nos períodos anteriores. O fechamento é uma consulta ao histórico atual. Os gráficos mostram os cinco sabores mais vendidos e até 12 datas ou meses com vendas.

## Exportação e backup

- **CSV** usa o intervalo selecionado no fechamento, UTF-8 com BOM e ponto e vírgula como separador. O intervalo faz parte do nome do arquivo. Cada item de venda tem sua própria linha de receita e custo, e cada pagamento tem sua própria linha de recebimento. Para consolidar relatórios sobrepostos de Samuel e Giovanna, use **ID do registro** como chave e mantenha a linha da exportação mais recente. Use **ID da venda** para relacionar itens e recebimentos. As vendas canceladas preservam os valores originais para consulta e têm zero nas colunas financeiras.
- **JSON** guarda estoque, preços, configurações, perfil, vendas e pagamentos. O nome do arquivo inclui data e hora. O formato 6 valida os campos e usa SHA-256 para detectar alterações no conteúdo. A página mostra quando o último download foi iniciado neste navegador. Confirme que o arquivo foi salvo e guarde uma cópia antes de trocar de aparelho, limpar o navegador ou mudar de endereço.
- **Restauração** valida o arquivo e mostra quantos sabores, vendas e pagamentos serão carregados. Baixe a cópia local antes de confirmar a substituição digitando **RESTAURAR**. Restaurar o mesmo arquivo novamente mantém os mesmos IDs e quantidades.
- A versão 1.2 mantém o formato 6, abre dados locais dos formatos 2 a 5 e importa backups JSON 4 e 5. IDs e valores históricos são preservados. As vendas das versões 2 e 3, que usavam valores fixos, são recuperadas a R$ 8,00 por unidade e custo de R$ 3,00. Se os dados locais estiverem ilegíveis, a página bloqueia edições e oferece baixar a cópia bruta.
- **Restaurar dados iniciais** repõe o estoque inicial e apaga o histórico após confirmação digitada.

## Armazenamento e acesso

O armazenamento é isolado por endereço, navegador e perfil do navegador. O nome na saudação personaliza a sessão visual. Qualquer pessoa com acesso ao mesmo perfil do navegador pode abrir os dados locais. O app usa Web Locks quando disponível para serializar gravações entre abas. Em navegadores sem esse recurso, use uma aba por vez.

Os dados e arquivos exportados podem conter nome e telefone de compradores. Guarde-os em local privado. O modo privado, a limpeza dos dados do site e as políticas de armazenamento do navegador podem apagar o histórico. Instalar como PWA não cria sincronização nem substitui o backup JSON. A versão 1.2 funciona via HTTPS ou localhost.

## Instalação e uso offline

1. Abra o endereço oficial com internet e aguarde **Pronto para usar sem internet neste aparelho**. A preparação precisa ser feita em cada navegador ou aplicativo instalado que for utilizado. Abrir a página pela primeira vez já sem conexão não prepara o modo offline.
2. Antes de instalar, exporte um backup JSON e confirme que o arquivo foi salvo.
3. No Android, use **Instalar aplicativo**, quando disponível, ou a opção de instalação do menu do Chrome. No iPhone/iPad, abra no Safari e escolha **Compartilhar → Adicionar à Tela de Início → Adicionar**. No computador, use o botão de instalação ou a opção na barra de endereços do Edge/Chrome.
4. Abra pelo ícone e confira o histórico. Dependendo da plataforma, o armazenamento do aplicativo instalado pode ficar separado do navegador. Se necessário, importe o backup no aplicativo, conferindo os registros antes de confirmar a substituição.
5. Aguarde novamente a confirmação de uso offline no aplicativo instalado. Depois disso, vendas, estoque, recebimentos, relatórios e exportação/restauração de backups funcionam sem conexão, inclusive ao fechar e reabrir o aplicativo.

O aplicativo informa quando está sem conexão e pronto para continuar. Se a preparação falhar por falta de espaço, permissão ou download incompleto, o uso online permanece disponível. Reconectar tenta preparar novamente uma instalação que não foi concluída. Se os arquivos offline forem apagados, o aplicativo precisa ser preparado novamente; preserve seus backups antes de qualquer limpeza de dados do site.

## Atualizações

Uma nova versão é baixada em segundo plano como um conjunto completo. Quando aparecer **Atualização pronta**, conclua seus registros, feche todas as abas e janelas da loja, incluindo o aplicativo instalado, e abra novamente. Recarregar uma aba enquanto outra permanece aberta pode manter a versão anterior. Campos apenas preenchidos e ainda não confirmados não são salvos ao fechar a tela.

A atualização não recarrega a tela automaticamente e mantém os dados locais e os backups no formato atual. Se o download da nova versão falhar, a versão anterior continua disponível. O cache guarda somente os arquivos do aplicativo; os registros de vendas continuam no armazenamento local já utilizado pela versão 1.1.

## Execução local e testes

O site não precisa de instalação nem de build. Rode `py -m http.server 8000 --bind 127.0.0.1` no Windows ou `python3 -m http.server 8000 --bind 127.0.0.1` e abra `http://127.0.0.1:8000`.

Com Node.js 22+ e Edge ou Chrome disponível, rode `node --test tests/browser.test.mjs tests/pwa.test.mjs`. As suítes iniciam servidores locais e usam perfis descartáveis com dados sintéticos. A abertura do navegador admite até 20 segundos e informa erros de inicialização; a conexão com o Edge/Chrome em `127.0.0.1` precisa estar permitida pelo ambiente. Não é necessário desativar o sandbox do navegador.

Defina `BROWSER_PATH` para selecionar o executável. `LOJA_TEST_URL` direciona somente a suíte de operações (`tests/browser.test.mjs`) para uma publicação; a suíte PWA sempre utiliza seus próprios servidores para simular indisponibilidade e atualizações, sem alterar a publicação. `LOJA_SCREENSHOT_DIR` pode apontar para uma pasta de artefatos para salvar as capturas da interface PWA em 390 e 1280 pixels.

A suíte PWA verifica manifesto e critérios de instalação do Chromium, raiz e subdiretório, instruções para iOS e estado instalado simulados, uso offline e reabertura, backup/restauração, falhas de preparação, atualização com duas abas e preservação de caches de outras aplicações. A emulação no Edge não comprova instalação real no Android ou Safari/iPhone; confira esses aparelhos no endereço HTTPS antes de declarar a validação móvel concluída.

## Publicação

O Cloudflare Pages do projeto está ligado ao repositório `SLU-369/controle-laranjinhas` e publica a raiz da branch `main` sem etapa de build. Após um push validado, confira o deploy e o endereço oficial. [Integração Git do Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/git-integration/)

O arquivo `_headers` exige revalidação do HTML, manifesto e service worker. Os demais arquivos são baixados com revalidação na preparação do cache. Ao mudar qualquer arquivo listado em `ASSETS` ou o comportamento do worker, incremente `VERSION` em `service-worker.js` antes de publicar. O endereço do worker permanece o mesmo. Cada versão e escopo têm seu próprio cache; nunca reutilize o identificador de uma versão para conteúdo diferente nem reverta para uma versão anterior do worker. Para rollback, publique o conteúdo anterior com um identificador de cache novo.

Antes de publicar uma versão autorizada, execute as duas suítes. No endereço publicado, confirme HTTPS, manifesto com `Content-Type: application/manifest+json`, ícones PNG e os cabeçalhos `Cache-Control: no-cache` do HTML, manifesto e worker. Valide a instalação em Edge/Chrome, Android e Safari/iPhone; depois de preparar o offline, feche o app, ative o modo avião e reabra. Confira também a atualização com todas as abas fechadas e a preservação do histórico no navegador e no aplicativo instalado. Use dados sintéticos ou um perfil de teste.
