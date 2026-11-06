import type { Catalog } from "../index";
import api from "./api";
import main from "./main";
import shared from "./shared";
import ui from "./ui";
import updates from "./updates";

// English for every Vietnamese UI text, split by where the text lives (renderer, main process, shared rules, agent
// API). A key may appear in more than one part only with the same English (checked by test/i18n-catalog.test.ts).
export const CATALOG_PARTS: Record<string, Catalog> = { shared, main, api, ui, updates };
export const CATALOG: Catalog = Object.assign(Object.create(null) as Catalog, shared, main, api, ui, updates);
