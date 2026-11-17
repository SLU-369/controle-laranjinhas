# Loja da Gigi · 1.1

Controle de estoque, vendas e fiados em HTML, CSS e JavaScript. A loja salva os dados no navegador e está hospedada no [Cloudflare Pages](https://loja-da-gigi.pages.dev/).

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
- A versão 1.1 abre dados locais dos formatos 2 a 5 e importa backups JSON 4 e 5. IDs e valores históricos são preservados. As vendas das versões 2 e 3, que usavam valores fixos, são recuperadas a R$ 8,00 por unidade e custo de R$ 3,00. Se os dados locais estiverem ilegíveis, a página bloqueia edições e oferece baixar a cópia bruta.
- **Restaurar dados iniciais** repõe o estoque inicial e apaga o histórico após confirmação digitada.

## Armazenamento e acesso

O armazenamento é isolado por endereço, navegador e perfil do navegador. O nome na saudação personaliza a sessão visual. Qualquer pessoa com acesso ao mesmo perfil do navegador pode abrir os dados locais. O app usa Web Locks quando disponível para serializar gravações entre abas. Em navegadores sem esse recurso, use uma aba por vez.

Os dados e arquivos exportados podem conter nome e telefone de compradores. Guarde-os em local privado. O modo privado e a limpeza dos dados do site podem apagar o histórico. A versão 1.1 funciona via HTTPS ou localhost. A instalação como PWA e o funcionamento offline ficaram fora desta versão para manter o carregamento e as atualizações simples.

## Execução local e testes

O site não precisa de instalação nem de build. Rode `py -m http.server 8000 --bind 127.0.0.1` no Windows ou `python3 -m http.server 8000 --bind 127.0.0.1` e abra `http://127.0.0.1:8000`.

Com Node.js 22+ e Edge ou Chrome disponível, rode `node --test tests/browser.test.mjs`. A suíte inicia um servidor temporário e usa um perfil descartável. Defina `BROWSER_PATH` para selecionar o executável do navegador e `LOJA_TEST_URL` para executar os testes contra uma publicação.

## Publicação

O Cloudflare Pages do projeto está ligado ao repositório `SLU-369/controle-laranjinhas` e publica a raiz da branch `main` sem etapa de build. Após um push validado, confira o deploy e o endereço oficial. [Integração Git do Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/git-integration/)
