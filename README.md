# Open With (Abrir Com) — plugin Stream Deck (macOS)

Abre **uma ou várias pastas/arquivos** no programa que você escolher (Antigravity, VS Code, Cursor, Finder…) direto do Stream Deck, sem Terminal e sem digitar comando.

<img src="docs/preview.png" width="260"> <img src="docs/preview-en.png" width="260"> <img src="docs/preview-es.png" width="260">

## Instalar

1. Dê dois cliques em `dist/com.fernandoschuab.openwith.streamDeckPlugin`.
2. No Stream Deck, arraste a ação **Open With › Open folders in…** para uma tecla. Com o Stream Deck em espanhol, ela aparece como **Abrir con › Abrir carpetas en…**.

Requisitos: Stream Deck **7.1+** e macOS **12+**.

## Usar

| Campo | O que faz |
|---|---|
| **Programa** | Lista os apps instalados, com busca e ícones (↑/↓ e Enter funcionam). “Outro app no Finder…” abre o seletor do macOS. |
| **+ Pastas / + Arquivos** | Abre o seletor nativo do Finder. Dá para escolher várias de uma vez (⌘-clique). |
| **Caminho** | Digite ou cole um caminho (`~/…`, `Working\ Files` e `file://` são aceitos). Colar várias linhas adiciona todas. |
| Lista | Arraste pelos pontinhos ou use ↑ ↓ para reordenar e × para remover. Itens que não existem aparecem em vermelho. |
| **Como abrir** | *Uma janela por item*: um `open` por pasta, na ordem, com o intervalo escolhido. *Tudo de uma vez*: uma única chamada com todos os caminhos. |
| **Nova instância `-n --args`** | Usa `open -n -a App --args <pasta>`, igual ao seu comando atual. Liga sozinho para apps Electron (VS Code, Cursor, Antigravity). |
| **Ícone do app na tecla** | Usa o ícone do programa como imagem da tecla. |
| **Testar agora** | Executa sem precisar apertar a tecla. |
| **Comando equivalente** | Mostra o comando de shell que será executado. |

Sem pastas na lista, a tecla apenas abre o programa.
Se algum caminho não existir, os demais abrem normalmente e a tecla mostra ⚠️.

Seu caso antigo (Terminal + delay + comando) vira: **Programa** = Antigravity IDE, **Pastas** = `DOMUS_API` e `DOMUS_ADMIN`, modo *Uma janela por item*, *Nova instância* ligada.

## Idiomas

A tela de configuração está em **português, inglês e espanhol**. Para trocar, use o seletor **Idioma** no rodapé da tela. A escolha vale para todas as teclas.

- **Automático** (padrão): segue o idioma do macOS. Se o macOS estiver num idioma sem tradução, usa o idioma do Stream Deck e, por último, inglês.
- Os títulos das janelas do Finder ("Escolha uma ou mais pastas") acompanham o idioma escolhido.
- O nome da ação na lista do Stream Deck vem de `en.json` e `es.json`. O Stream Deck não tem português entre os idiomas do app, então com ele em inglês o nome aparece em inglês.

Para adicionar um idioma, siga três passos:

1. Crie o bloco do idioma em `ui/i18n.js`.
2. Adicione o idioma em `src/lib/i18n.ts`.
3. Se o Stream Deck suportar esse idioma (de, fr, ja, ko, zh_CN, zh_TW), crie também o `<código>.json` do manifest.

## Problemas

- **Logs:** `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.fernandoschuab.openwith.sdPlugin/logs/`
- **O seletor do Finder abriu atrás de outras janelas:** procure-o com ⌘-Tab (o processo se chama *osascript*).
- **Um app aparece com uma letra no lugar do ícone:** o macOS não forneceu o ícone. É só visual; a ação funciona normalmente.
- **Cache de ícones:** `~/Library/Caches/com.fernandoschuab.openwith/`. Apague para gerar os ícones de novo.

## Publicação (Elgato Marketplace)

Imagens prontas em `marketing/out/`:

| Arquivo | Uso no Maker Console |
|---|---|
| `thumbnail-1920x960.png` | Thumbnail (1920×960, texto em inglês) |
| `app-icon-288.png` | App icon (288×288) |
| `plugin-icon-512.png` / `logo.svg` | Logo em alta resolução |

O ícone do plugin dentro do pacote fica em `imgs/plugin/marketplace.png` (256×256) e `@2x` (512×512).

Para regenerar as imagens, edite os arquivos `.html`/`.svg` em `marketing/` e rode:

```bash
python3 marketing/render.py thumb.html out/thumbnail-1920x960.png 1920 960
```

Esse comando precisa do Playwright para Python.

## Desenvolvimento

```bash
npm install
npm run build                      # compila src/ → .sdPlugin/bin/plugin.js
npx streamdeck link com.fernandoschuab.openwith.sdPlugin   # instala em modo dev
npm run watch                      # recompila e reinicia o plugin a cada alteração
npm run pack                       # gera dist/*.streamDeckPlugin
```

Estrutura:

```
src/actions/open-with.ts     ação (tecla, mensagens da UI, ícone da tecla)
src/lib/mac.ts               open, seletores, lista de apps, ícones
*.sdPlugin/ui/open.*         Property Inspector (HTML/CSS/JS puro, sem dependências)
*.sdPlugin/ui/i18n.js        traduções da UI (pt/en/es)
*.sdPlugin/en.json, es.json  nomes localizados do manifest
src/lib/i18n.ts              idioma do sistema + textos dos seletores do Finder
*.sdPlugin/scripts/pick.js   seletor nativo (JXA)
*.sdPlugin/scripts/icons.js  extração de ícones via NSWorkspace (JXA)
test/pi_test.py              teste da UI com Playwright (WebSocket simulado)
test/plugin_e2e.mjs          teste do backend com um Stream Deck simulado (cd test && ln -s ../node_modules && node plugin_e2e.mjs)
```
