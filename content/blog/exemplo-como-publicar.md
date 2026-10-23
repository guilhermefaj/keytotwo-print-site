---
title: "Como publicar pelo painel do blog"
description: "Guia de exemplo para escrever, revisar e publicar um artigo pelo admin da KeyToTwo."
date: "2026-10-09"
author: "Equipe KeyToTwo"
coverAlt: ""
tags:
  - Guia de publicação
draft: true
---

Este é um **rascunho de exemplo**, usado nos testes do site. Ele aparece em preview e test, mas fica fora do site live, do sitemap e do RSS live. Os posts de verdade ficam no banco e são escritos no admin; no build da VPS, eles substituem os arquivos desta pasta.

## Escrever no admin

1. Entre em `admin.keytotwo.com.br` com a conta da equipe e o código do app autenticador.
2. Abra **Blog** e clique em **Novo post**. Preencha título, resumo, autor e data. O endereço sai do título e pode mudar até a primeira publicação.
3. Escreva o texto em Markdown. A prévia ao lado mostra o post com o visual do site.
4. Para pôr uma imagem, use o botão **Imagem**. Ela é reduzida, convertida para WebP e enviada ao bucket do blog.

## Publicar

- **Salvar rascunho** guarda o post sem mexer no site.
- **Publicar** confere o post e o coloca no site, que se atualiza sozinho em poucos minutos.
- Um post publicado pode voltar a rascunho. O endereço fica fixo depois da primeira publicação.

## Revisar antes de publicar

- Confira texto, links e as descrições das imagens.
- Use subtítulos a partir de H2. HTML cru não é executado.

> Publicar atualiza o site de verdade. Na dúvida, salve como rascunho e peça uma segunda leitura.
