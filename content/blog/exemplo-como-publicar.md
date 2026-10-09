---
title: "Como publicar pelo painel do blog"
description: "Guia de exemplo para editar um artigo no repositório local ou entrar no painel com um token do GitHub."
date: "2026-10-09"
coverAlt: ""
tags:
  - Guia de publicação
draft: true
---

Este é um **rascunho de exemplo** para quem cuida do blog. Ele aparece em preview e test, mas fica fora do site live, do sitemap e do RSS live. Mantenha este guia como rascunho.

## Editar no repositório local, com Chrome ou Edge

1. Com o projeto no computador, inicie o servidor com `npm run dev -- --port 5179`.
2. Abra `http://127.0.0.1:5179/admin/index.html` no Chrome ou Edge. Escolha **Work with Local Repository** (trabalhar com repositório local).
3. Selecione a pasta raiz do projeto, que contém `.git`, `content` e `public`, e permita o acesso solicitado pelo navegador.
4. Na coleção **Blog**, abra um artigo ou crie um novo. Preencha título, resumo e data. A capa é opcional; se usar uma, descreva seu conteúdo no campo de descrição.
5. Escreva o texto, confira a prévia e salve com **Rascunho** ativado. Atualize `/blog` no ambiente de teste para conferir o resultado.

O painel altera os arquivos locais. Para publicar, revise as alterações e faça o commit e o envio ao GitHub pelo seu cliente Git. O painel local não executa essas etapas.

## Entrar com um token do GitHub

1. Abra `/admin/` no site e escolha **Sign In with Token** (entrar com token).
2. Gere um token pessoal com acesso apenas a `guilhermefaj/keytotwo-print-site`, permissão **Contents: Read and write** e prazo de validade. Sua conta precisa ter acesso de escrita ao repositório.
3. Cole o token apenas na janela de entrada do painel. Nunca o escreva no artigo, no código ou em uma captura de tela.
4. Edite a coleção **Blog** e salve. Nesse modo, o painel grava os arquivos no GitHub, na branch `main`. Confira o destino antes de salvar.

> O token é guardado no navegador para manter o acesso. Use um computador de confiança e saia do painel ao terminar.

## Revisar antes de publicar

- Confira texto, links e descrições das imagens. As imagens ficam em `public/images/blog`; no artigo, seus endereços começam com `/images/blog/`.
- Use subtítulos a partir de H2. HTML cru não é executado.
- Em um artigo revisado, desative **Rascunho**, salve e aguarde um novo build e a publicação do site. Salvar no GitHub não publica o site por si só: a implantação precisa estar configurada.
- O build live continua bloqueado se houver marcações **PENDENTE** em conteúdo publicado ou outras pendências exigidas pela trava de release.

Consulte os guias oficiais do Sveltia sobre [edição local](https://sveltiacms.app/en/docs/workflows/local) e [acesso pelo GitHub](https://sveltiacms.app/en/docs/backends/github).
