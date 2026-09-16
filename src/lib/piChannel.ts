import type { JsonValue } from "@elgato/utils";

// Conexão interna do SDK (mesmo módulo que o SDK usa; o rollup resolve pelo caminho do arquivo).
// eslint-disable-next-line import/no-relative-packages
import { connection } from "../../node_modules/@elgato/streamdeck/dist/plugin/connection.js";

/**
 * Envia uma mensagem para o Property Inspector de uma tecla específica.
 *
 * `streamDeck.ui.sendToPropertyInspector` só envia para a tecla que o SDK acha que está
 * com a tela aberta — e descarta tudo se o evento `propertyInspectorDidAppear` chegou antes
 * do `willAppear` (acontece ao colar uma tecla copiada). Endereçar pelo contexto evita isso.
 */
export function sendToPI(context: string, payload: JsonValue): Promise<void> {
	return connection.send({ event: "sendToPropertyInspector", context, payload });
}
