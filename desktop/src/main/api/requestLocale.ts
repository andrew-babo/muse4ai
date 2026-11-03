import { AsyncLocalStorage } from "node:async_hooks";
import { getLocale, type Locale } from "../../shared/i18n";

// R122: everything an API request returns in words (problem `detail`, job `label`/`note`/`error.message`, chain
// `stop_reason`, MCP text) uses the caller's language — Accept-Language vi/en, else the app language. The server runs
// each request inside this store, so the job views built deep in the service (including long waits) pick it up.
const store = new AsyncLocalStorage<Locale>();

export function runWithApiLocale<T>(locale: Locale, fn: () => T): T {
  return store.run(locale, fn);
}

/** The current API request's language; outside a request, the app language. */
export function apiLocale(): Locale {
  return store.getStore() ?? getLocale();
}
