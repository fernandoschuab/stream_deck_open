import streamDeck from "@elgato/streamdeck";

import { OpenWith } from "./actions/open-with";

streamDeck.logger.setLevel("info");
const openWith = new OpenWith();
streamDeck.actions.registerAction(openWith);
streamDeck.connect();

// Aquece a lista de apps e os ícones depois que as teclas já apareceram:
// quando a tela de configuração abrir, tudo já está pronto.
const warm = setTimeout(() => void openWith.prewarm(), 5000);
warm.unref?.();
