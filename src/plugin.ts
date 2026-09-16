import streamDeck from "@elgato/streamdeck";

import { OpenWith } from "./actions/open-with";

streamDeck.logger.setLevel("info");
streamDeck.actions.registerAction(new OpenWith());
streamDeck.connect();
