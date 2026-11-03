import type { DocArticle } from "../types";
import { DOCS_ACCOUNT } from "./account";
import { DOCS_ACCOUNTS } from "./accounts";
import { DOCS_AGENTS } from "./agents";
import { DOCS_BATCH } from "./batch";
import { DOCS_CREDITS } from "./credits";
import { DOCS_HELP } from "./help";
import { DOCS_LIBRARY } from "./library";
import { DOCS_QUEUE } from "./queue";
import { DOCS_SETTINGS } from "./settings";
import { DOCS_START } from "./start";
import { DOCS_STUDIO } from "./studio";

/**
 * Guide articles (R3-CNT). One file per chapter keeps parallel writing safe;
 * this index is the only list both the app and the website read.
 */
export const DOCS: DocArticle[] = [
  ...DOCS_START,
  ...DOCS_ACCOUNT,
  ...DOCS_STUDIO,
  ...DOCS_QUEUE,
  ...DOCS_BATCH,
  ...DOCS_LIBRARY,
  ...DOCS_ACCOUNTS,
  ...DOCS_AGENTS,
  ...DOCS_SETTINGS,
  ...DOCS_HELP,
  ...DOCS_CREDITS,
];

export function doc(slug: string): DocArticle | undefined {
  return DOCS.find((d) => d.slug === slug);
}
