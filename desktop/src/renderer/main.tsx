import { createRoot } from "react-dom/client";
import { isLocale, setLocale } from "@shared/i18n";
import { App } from "./App";
import "./styles.css";

// R120: main passes the saved UI language in the hash so the loading screen already uses it.
const lang = /(?:^#|&)lang=(\w+)/.exec(location.hash)?.[1];
if (isLocale(lang)) {
  setLocale(lang);
  document.documentElement.lang = lang;
}

createRoot(document.getElementById("root")!).render(<App />);
