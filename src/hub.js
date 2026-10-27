// The hub's HTTP API, signed in with the account's tokens (kept in VS Code's secret storage).
const vscode = require("vscode");

// The hub is published through an ngrok tunnel whose free plan shows browsers a warning page;
// this header tells ngrok the caller is a program.
const TUNNEL = { "ngrok-skip-browser-warning": "1" };

class HubError extends Error {
  constructor(status, detail) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.status = status;
  }
}

class Hub {
  constructor(context) {
    this.context = context;
    this.changed = new vscode.EventEmitter();   // fires on sign-in and sign-out
    this.session = null;                        // { access, refresh, username, is_admin }
  }

  url() {
    return (vscode.workspace.getConfiguration("vonneuro").get("hubUrl") || "").replace(/\/+$/, "");
  }

  key() { return "vonneuro.session:" + this.url(); }

  async load() {
    const stored = await this.context.secrets.get(this.key());
    this.session = stored ? JSON.parse(stored) : null;
    await vscode.commands.executeCommand("setContext", "vonneuro.signedIn", !!this.session);
    return this.session;
  }

  async store(session) {
    const before = this.session && this.session.username;
    this.session = session;
    if (session) await this.context.secrets.store(this.key(), JSON.stringify(session));
    else await this.context.secrets.delete(this.key());
    await vscode.commands.executeCommand("setContext", "vonneuro.signedIn", !!session);
    if (before !== (session && session.username)) this.changed.fire(session);   // not on token renewals
  }

  async signIn(username, password) {
    const response = await fetch(this.url() + "/api/auth/login", {
      method: "POST", headers: { ...TUNNEL, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new HubError(response.status, body.detail || response.statusText);
    this.session = { access: body.access_token, refresh: body.refresh_token };
    const me = await this.request("GET", "/api/auth/me");
    await this.store({ ...this.session, username: me.username, is_admin: !!me.is_admin });
    return me;
  }

  async signOut() { await this.store(null); }

  async renew() {
    if (!this.session || !this.session.refresh) return false;
    const response = await fetch(this.url() + "/api/auth/refresh?refresh_token=" + encodeURIComponent(this.session.refresh),
                                 { method: "POST", headers: TUNNEL }).catch(() => null);
    if (!response || !response.ok) return false;
    const body = await response.json();
    await this.store({ ...this.session, access: body.access_token, refresh: body.refresh_token });
    return true;
  }

  // A fresh access token for a run (the run renews it by itself when it expires).
  async tokensForRun() {
    await this.renew();
    return this.session;
  }

  async request(method, path, body, { text = false } = {}) {
    if (!this.session) throw new HubError(401, "Not signed in: run 'vonNeuro: Sign in'.");
    const send = () => fetch(this.url() + path, {
      method,
      headers: { ...TUNNEL, Authorization: "Bearer " + this.session.access,
                 ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let response = await send();
    if (response.status === 401 && await this.renew()) response = await send();
    if (response.status === 401) {
      await this.store(null);
      throw new HubError(401, "Your sign-in expired: sign in again.");
    }
    if (!response.ok) {
      const detail = await response.json().then((b) => b.detail, () => response.statusText);
      throw new HubError(response.status, detail || response.statusText);
    }
    if (response.status === 204) return null;
    return text ? response.text() : response.json();
  }
}

module.exports = { Hub, HubError };
