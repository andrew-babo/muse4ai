import type { IncomingMessage, ServerResponse } from "node:http";
import {
  SCOPE_LABEL,
  authorizationServerMetadata,
  bearerChallenge,
  parseForm,
  protectedResourceMetadata,
  type OAuthScope,
} from "../../../shared/api/oauth";
import { tl, type Locale } from "../../../shared/i18n";
import { OAuthError, oauthProblem, type ConsentView, type OAuthService } from "./service";

// The browser half of the authorization server (spec rev 8 R131–R141). Every page here is self-contained:
// no external script, style or font, so nothing a registered app says can reach the user's machine.
// Texts are Vietnamese source strings (R120–R122); the request's locale is already set by the API server.

const HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
};

const OAUTH_BODY_MAX = 64 * 1024;

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const page = (locale: Locale, title: string, body: string): string => `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px; font: 15px/1.55 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
         background: #f6f7fb; color: #14161f; display: flex; justify-content: center; }
  .card { width: 100%; max-width: 430px; background: #fff; border: 1px solid #e6e8f0; border-radius: 18px;
          padding: 26px 24px; box-shadow: 0 12px 34px rgba(20,22,31,.08); }
  h1 { font-size: 19px; margin: 0 0 6px; letter-spacing: -0.2px; }
  p { margin: 8px 0; color: #4a4f61; }
  .tag { display: inline-block; font-size: 11.5px; text-transform: uppercase; letter-spacing: .08em;
         color: #6b7280; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-top: 1px solid #eef0f6; font-size: 14px; }
  .row b { font-weight: 600; text-align: right; word-break: break-all; }
  ul { margin: 6px 0 0; padding: 0; list-style: none; }
  li { padding: 7px 0 7px 22px; position: relative; color: #2a2e3b; font-size: 14px; }
  li:before { content: ""; position: absolute; left: 2px; top: 13px; width: 8px; height: 8px; border-radius: 50%; background: #6c5ce7; }
  .code { margin: 18px 0 4px; }
  .code label { display: block; font-size: 13px; color: #4a4f61; margin-bottom: 6px; }
  input { width: 100%; padding: 11px 13px; font-size: 19px; letter-spacing: .28em; text-align: center;
          border: 1px solid #d5d9e6; border-radius: 11px; background: #fbfbfe; }
  input:focus { outline: 2px solid #6c5ce7; outline-offset: 1px; }
  .hint { font-size: 12.5px; color: #6b7280; margin: 6px 0 0; }
  .btns { display: flex; gap: 10px; margin-top: 18px; }
  button { flex: 1; padding: 11px 14px; font: inherit; font-weight: 600; border-radius: 11px; cursor: pointer; }
  .ok { background: #6c5ce7; color: #fff; border: 1px solid #6c5ce7; }
  .no { background: #fff; color: #4a4f61; border: 1px solid #d5d9e6; }
  .warn { background: #fff7ed; border: 1px solid #fed7aa; color: #7c2d12; border-radius: 11px; padding: 10px 12px; font-size: 13.5px; margin: 14px 0 0; }
  .foot { margin-top: 18px; padding-top: 12px; border-top: 1px solid #eef0f6; font-size: 12px; color: #9aa0b0; text-align: center; }
  .mark { font-weight: 700; color: #6c5ce7; }
</style></head><body><main class="card">${body}</main></body></html>`;

const shell = (locale: Locale, title: string, inner: string): string =>
  page(locale, title, `${inner}<div class="foot"><span class="mark">Muse4AI</span> · Made by Andrew Babo</div>`);

function consentHtml(locale: Locale, v: ConsentView, error: string | null): string {
  const title = tl(locale, "Kết nối {client} với Muse4AI", { client: v.clientName });
  const scopes = v.scopes.map((sc: OAuthScope) => `<li>${esc(tl(locale, SCOPE_LABEL[sc]))}</li>`).join("");
  const body = `<div class="tag">Muse4AI · MCP</div>
<h1>${esc(title)}</h1>
<p>${esc(tl(locale, "{client} muốn dùng Muse4AI theo tài khoản của bạn.", { client: v.clientName }))}</p>
<p>${esc(tl(locale, "Bạn đang ra quyết định trên máy tính của mình, nơi Muse4AI đang chạy."))}</p>
<div class="row"><span>${esc(tl(locale, "Nhà phát triển ứng dụng"))}</span><b>${esc(v.clientName)}</b></div>
<div class="row"><span>${esc(tl(locale, "Ứng dụng sẽ quay về"))}</span><b>${esc(v.redirectHost)}</b></div>
<div style="padding-top:10px"><b style="font-size:13px">${esc(tl(locale, "Quyền được xin"))}</b><ul>${scopes || `<li>${esc(tl(locale, SCOPE_LABEL.read))}</li>`}</ul></div>
${error ? `<div class="warn">${esc(error)}</div>` : ""}
<form method="post" action="/oauth/authorize">
  <input type="hidden" name="authorization_id" value="${esc(v.id)}">
  <div class="code">
    <label for="pairing">${esc(tl(locale, "Mã xác nhận"))}</label>
    <input id="pairing" name="pairing" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"
           placeholder="123456" required autofocus>
    <p class="hint">${esc(tl(locale, "Nhập đúng 6 số đang hiện trong cửa sổ Muse4AI."))}</p>
  </div>
  <div class="btns">
    <button class="ok" name="decision" value="approve">${esc(tl(locale, "Cho phép kết nối"))}</button>
    <button class="no" name="decision" value="deny">${esc(tl(locale, "Hủy kết nối"))}</button>
  </div>
</form>
<p class="hint" style="margin-top:14px">${esc(tl(locale, "Muse4AI vẫn tự quyết định quyền theo cài đặt và chính sách của bạn; ứng dụng không vượt qua được điều đó."))}</p>`;
  return shell(locale, title, body);
}

function messageHtml(locale: Locale, title: string, text: string): string {
  return shell(locale, title, `<div class="tag">Muse4AI · MCP</div><h1>${esc(title)}</h1><p>${esc(text)}</p>`);
}

export interface OAuthHttpDeps {
  svc: OAuthService;
  log: (level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;
}

/** Protocol paths this server owns; the API server dispatches exactly these before any key check. */
const OAUTH_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
  "/oauth/jwks",
  "/oauth/register",
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/revoke",
]);
export function isOAuthPath(pathname: string): boolean {
  return OAUTH_PATHS.has(pathname);
}

export class OAuthHttp {
  constructor(private d: OAuthHttpDeps) {}

  /** True when this module answered — the caller must then write nothing more. */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    base: string,
    locale: Locale,
    readBody: (req: IncomingMessage, res: ServerResponse, max: number) => Promise<Buffer>,
  ): Promise<boolean> {
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
      if (method === "GET" && path === "/.well-known/oauth-protected-resource") return this.json(res, 200, protectedResourceMetadata(base));
      if (method === "GET" && path === "/.well-known/oauth-authorization-server") return this.json(res, 200, authorizationServerMetadata(base));
      if (method === "GET" && path === "/oauth/jwks") return this.json(res, 200, this.d.svc.jwks());
      if (method === "POST" && path === "/oauth/register") {
        const buf = await readBody(req, res, OAUTH_BODY_MAX);
        let body: unknown = {};
        if (buf.length) {
          try {
            body = JSON.parse(buf.toString("utf8"));
          } catch {
            throw new OAuthError(400, "invalid_client_metadata", "Thân yêu cầu phải là JSON");
          }
        }
        return this.json(res, 201, this.d.svc.register(body));
      }
      if (method === "GET" && path === "/oauth/authorize") {
        const { consent } = this.d.svc.authorize(url.searchParams);
        return this.html(res, 200, consentHtml(locale, this.d.svc.consentView(consent), null));
      }
      if (method === "POST" && path === "/oauth/authorize") {
        const buf = await readBody(req, res, OAUTH_BODY_MAX);
        const form = parseForm(buf.toString("utf8"));
        const id = form.authorization_id ?? "";
        const decision = form.decision === "approve" ? "approve" : "deny";
        try {
          const out = this.d.svc.decide(id, decision, form.pairing ?? null, locale);
          if (out.decision === "deny")
            return this.html(res, 200, messageHtml(locale, tl(locale, "Đã hủy kết nối"), tl(locale, "Không có quyền nào được cấp. Bạn có thể thử lại bất cứ lúc nào.")));
          return this.redirect(res, out.redirect);
        } catch (e) {
          if (e instanceof OAuthError) {
            // A wrong code is recoverable on the same page; anything else means the request is gone.
            if (e.retryable) {
              const waiting = this.d.svc.pending().find((c) => c.id === id);
              if (waiting)
                return this.html(res, 400, consentHtml(locale, waiting, tl(locale, "Mã chưa đúng — hãy xem lại cửa sổ Muse4AI rồi nhập lại.")));
            }
            return this.html(
              res,
              400,
              messageHtml(locale, tl(locale, "Không kết nối được"), tl(locale, "Yêu cầu kết nối này đã hết hạn hoặc đã được trả lời. Hãy bật lại kết nối trong ứng dụng.")),
            );
          }
          throw e;
        }
      }
      if (method === "POST" && (path === "/oauth/token" || path === "/oauth/revoke")) {
        const buf = await readBody(req, res, OAUTH_BODY_MAX);
        const form = parseForm(buf.toString("utf8"));
        if (path === "/oauth/token") return this.json(res, 200, this.d.svc.token(form, base));
        this.d.svc.revoke(form);
        return this.json(res, 200, {});
      }
      return false;
    } catch (e) {
      if (e instanceof OAuthError) {
        this.d.log("warn", "oauth request refused", { path, error: e.code });
        if (path === "/oauth/authorize") return this.html(res, e.status, messageHtml(locale, tl(locale, "Không kết nối được"), tl(locale, e.description)));
        return this.json(res, e.status, oauthProblem(e, locale));
      }
      this.d.log("error", "oauth handler failed", { path, error: String(e) });
      return this.json(res, 500, { error: "server_error", error_description: tl(locale, "Muse4AI không hoàn thành được yêu cầu này") });
    }
  }

  /** The `WWW-Authenticate` header a client needs to discover how to authorize (RFC 9728 §5.1). */
  challenge(base: string, error: "missing_token" | "invalid_token"): string {
    return bearerChallenge(base, error);
  }

  private json(res: ServerResponse, status: number, body: unknown): boolean {
    res.writeHead(status, { ...HEADERS, "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
    return true;
  }
  private html(res: ServerResponse, status: number, body: string): boolean {
    res.writeHead(status, { ...HEADERS, "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
    return true;
  }
  private redirect(res: ServerResponse, location: string): boolean {
    res.writeHead(302, { ...HEADERS, Location: location });
    res.end();
    return true;
  }
}
