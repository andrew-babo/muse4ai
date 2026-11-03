import { setLocale } from "../src/shared/i18n";

// The product default is English (R120, asserted in i18n.test.ts on a fresh module). Messages are authored in
// Vietnamese, so most suites assert the source strings: every test file starts in Vietnamese unless it switches.
setLocale("vi");
