import fs from "node:fs";
import path from "node:path";
import { parseAst } from "rolldown/parseAst";

// Build 2.0 AC-I18N-03 — finds every Vietnamese UI text in desktop/src the same way the catalog keys were made:
// string literals, JSX text, and template literals (each ${expr} becomes a named {placeholder}).

export const VI = /[À-ỹĐđ]/;
const SRC = path.resolve(__dirname, "../src");
const SKIP = [/[\\/]i18n[\\/]/, /testSeed\.ts$/, /\.d\.ts$/];

type Node = { type: string; start: number; end: number; parent?: Node | null; [k: string]: unknown };

export interface Found {
  key: string;
  file: string;
  line: number;
  kind: "lit" | "jsx" | "tpl" | "attr";
  /** For renderer files: the text is rendered without going through t() (JSX text or a plain attribute). */
  raw: boolean;
}

function* kids(n: Node): Generator<Node> {
  for (const k of Object.keys(n)) {
    if (k === "parent") continue;
    const v = n[k] as unknown;
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof (c as Node).type === "string") yield c as Node;
    } else if (v && typeof (v as Node).type === "string") yield v as Node;
  }
}

function nameFor(e: Node): string | null {
  const x = e as Record<string, any>;
  switch (e.type) {
    case "Identifier":
      return x.name;
    case "MemberExpression":
      if (!x.computed && x.property.type === "Identifier") {
        const p = x.property.name as string;
        return p === "length" || p === "size" ? (nameFor(x.object) ?? "items") + "Count" : p;
      }
      return null;
    case "CallExpression": {
      const a = x.arguments[0];
      const c = x.callee.type === "Identifier" ? x.callee.name : x.callee.property?.name;
      if (a && /^format|^String$|^Number$|^round$|^mask/.test(c ?? "")) return nameFor(a);
      if (["join", "toFixed", "slice", "trim"].includes(c)) return nameFor(x.callee.object);
      return a ? nameFor(a) : c;
    }
    case "ChainExpression":
    case "TSNonNullExpression":
    case "TSAsExpression":
      return nameFor(x.expression);
    case "LogicalExpression":
    case "BinaryExpression":
      return nameFor(x.left);
    case "ConditionalExpression":
      return nameFor(x.consequent);
    default:
      return null;
  }
}

const SKIP_ATTRS = new Set(["className", "key", "id", "href", "src", "type", "role", "name", "htmlFor", "rel", "target"]);

export function sourceFiles(): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !SKIP.some((r) => r.test(p))) out.push(p);
    }
  })(SRC);
  return out;
}

export function findTexts(files = sourceFiles()): Found[] {
  const found: Found[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const ast = parseAst(src, { lang: f.endsWith(".tsx") ? "tsx" : "ts" }, f) as unknown as Node;
    const rel = path.relative(SRC, f).replace(/\\/g, "/");
    const renderer = rel.startsWith("renderer/");
    const line = (p: number) => src.slice(0, p).split("\n").length;
    const stack: [Node, Node | null][] = [[ast, null]];
    while (stack.length) {
      const [n, p] = stack.pop()!;
      Object.defineProperty(n, "parent", { value: p, enumerable: false });
      for (const c of kids(n)) stack.push([c, n]);
    }
    (function visit(n: Node) {
      const p = n.parent as Record<string, any> | null | undefined;
      const x = n as Record<string, any>;
      if ((n.type === "Literal" || n.type === "StringLiteral") && typeof x.value === "string" && VI.test(x.value)) {
        const isKey = p && (p.type === "Property" || p.type === "PropertyDefinition") && p.key === n && !p.computed;
        const isImport = p && /Import|Export/.test(p.type);
        const isType = p && p.type.startsWith("TS") && !["TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression"].includes(p.type);
        if (!isKey && !isImport && !isType) {
          const attr = p?.type === "JSXAttribute" ? (p.name?.name as string) : null;
          const raw = renderer && attr !== null && !SKIP_ATTRS.has(attr) && !attr.startsWith("data-");
          found.push({ key: x.value, file: rel, line: line(n.start), kind: attr !== null ? "attr" : "lit", raw });
        }
      }
      if (n.type === "JSXText" && VI.test(x.value)) found.push({ key: (x.value as string).trim(), file: rel, line: line(n.start), kind: "jsx", raw: renderer });
      if (n.type === "TemplateLiteral" && p?.type !== "TaggedTemplateExpression" && (x.quasis as any[]).some((q) => VI.test(q.value.cooked ?? ""))) {
        const used = new Map<string, string>();
        let key = "";
        (x.quasis as any[]).forEach((q, i) => {
          key += q.value.cooked ?? q.value.raw;
          const e = (x.expressions as Node[])[i];
          if (e) {
            let nm = (nameFor(e) ?? "value").replace(/\W/g, "") || "value";
            if (/^\d/.test(nm)) nm = "value";
            const base = nm;
            let k = 2;
            const srcE = src.slice(e.start, e.end);
            while (used.has(nm) && used.get(nm) !== srcE) nm = base + k++;
            used.set(nm, srcE);
            key += `{${nm}}`;
          }
        });
        found.push({ key, file: rel, line: line(n.start), kind: "tpl", raw: false });
      }
      for (const c of kids(n)) visit(c);
    })(ast);
  }
  return found;
}
