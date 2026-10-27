// vonNeuro for VS Code: sign in once, run Python on vonNeuro hardware, follow your jobs and
// manage the devices you administer. Everything goes through the hub's API, as the website does.
const vscode = require("vscode");
const { Hub } = require("./src/hub");
const { DevicesTree, JobsTree, NodesTree, ACTIVE } = require("./src/views");
const { Runner } = require("./src/run");
const { RunLens } = require("./src/lens");

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function activate(context) {
  const hub = new Hub(context);
  await hub.load();
  const devices = new DevicesTree(hub), jobs = new JobsTree(hub), nodes = new NodesTree(hub, devices);
  const refreshAll = () => { devices.refresh(); jobs.refresh(); nodes.refresh(); };
  let lens;
  const runner = new Runner(context, hub, () => { jobs.refresh(); lens.refresh(); });
  lens = new RunLens(() => !!runner.child);

  const fail = (error) => vscode.window.showErrorMessage("vonNeuro: " + (error.message || error));
  const command = (name, handler) => context.subscriptions.push(vscode.commands.registerCommand(name, async (...args) => {
    try { return await handler(...args); } catch (error) { fail(error); return undefined; }
  }));

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("vonneuro.devices", devices),
    vscode.window.registerTreeDataProvider("vonneuro.jobs", jobs),
    vscode.window.registerTreeDataProvider("vonneuro.nodes", nodes),
    hub.changed.event(refreshAll),
    vscode.languages.registerCodeLensProvider({ language: "python" }, lens),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("vonneuro.hubUrl")) { await hub.load(); refreshAll(); }
    }),
  );

  command("vonneuro.signIn", async () => {
    const username = await vscode.window.showInputBox({ title: `Sign in to ${hub.url()}`, prompt: "Username", ignoreFocusOut: true });
    if (!username) return false;
    const password = await vscode.window.showInputBox({ title: `Sign in as ${username}`, prompt: "Password", password: true, ignoreFocusOut: true });
    if (!password) return false;
    const me = await hub.signIn(username.trim(), password);
    vscode.window.showInformationMessage(`vonNeuro: signed in as ${me.username}.`);
    return true;
  });
  command("vonneuro.signOut", async () => { await hub.signOut(); vscode.window.showInformationMessage("vonNeuro: signed out."); });
  command("vonneuro.run", async (uri) => { await runner.run(uri); lens.refresh(); });
  command("vonneuro.stop", () => runner.stop());
  command("vonneuro.refresh", refreshAll);
  command("vonneuro.openWebsite", () => vscode.env.openExternal(vscode.Uri.parse(hub.url() + "/devices")));

  command("vonneuro.openDevicePage", async (arg) => {
    const device = (arg && arg.device) || arg;
    const page = await hub.request("GET", `/api/devices/${encodeURI(device.ref)}/page`);
    const panel = vscode.window.createWebviewPanel("vonneuro.device", device.name, vscode.ViewColumn.Active,
                                                   { enableScripts: false });
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline';">
      <style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);max-width:820px;margin:1rem auto;padding:0 1rem;line-height:1.55}
      code,pre{font-family:var(--vscode-editor-font-family);background:var(--vscode-textCodeBlock-background);border-radius:4px}
      code{padding:.1em .3em}pre{padding:.7rem;overflow-x:auto}pre code{padding:0;background:none}
      table{border-collapse:collapse}td,th{border:1px solid var(--vscode-panel-border);padding:.25rem .5rem;text-align:left}
      .meta{color:var(--vscode-descriptionForeground)}</style></head><body>
      <p class="meta">${escapeHtml(device.ref)} · ${escapeHtml(device.kind)} · ${escapeHtml(device.status)}</p>
      ${page.html}</body></html>`;   // the hub sanitises device pages (no scripts); this webview runs none either
  });
  command("vonneuro.copyDeviceRef", async (arg) => {
    const device = (arg && arg.device) || arg;
    await vscode.env.clipboard.writeText(device.ref);
    vscode.window.setStatusBarMessage(`Copied ${device.ref}`, 3000);
  });

  command("vonneuro.showJob", async (arg) => {
    const job = await hub.request("GET", `/api/jobs/${((arg && arg.job) || arg).id}`);
    const header = [`#${job.id} ${job.name}`, `${job.job_type} · ${job.status}`,
                    `sent ${job.created_at || "—"} · started ${job.started_at || "—"} · ended ${job.completed_at || "—"}`];
    const doc = await vscode.workspace.openTextDocument({
      language: "log", content: header.join("\n") + "\n\n" + (job.logs || "(no logs)") });
    await vscode.window.showTextDocument(doc, { preview: true });
  });
  command("vonneuro.cancelJob", async (arg) => {
    const job = (arg && arg.job) || arg;
    if (!ACTIVE.has(job.status)) return;
    await hub.request("DELETE", `/api/jobs/${job.id}`);
    jobs.refresh();
  });

  command("vonneuro.editSetting", async (arg) => {
    const { ref, name, spec } = (arg && arg.setting) || arg;
    const low = spec.minimum ?? spec.exclusiveMinimum, high = spec.maximum;
    const value = await vscode.window.showInputBox({
      title: `${ref}: ${name}`, value: spec.value == null ? "" : String(spec.value), ignoreFocusOut: true,
      prompt: `${spec.description || name}. Allowed ${low ?? "…"} … ${high ?? "…"} ${spec.unit || ""}; default ${spec.default ?? "—"}. Empty: back to the default.`,
      validateInput: (text) => {
        if (!text.trim()) return null;
        const n = Number(text);
        if (!Number.isFinite(n)) return "A number, please";
        if (spec.type === "integer" && !Number.isInteger(n)) return "A whole number, please";
        if (spec.minimum != null && n < spec.minimum) return `At least ${spec.minimum}`;
        if (spec.exclusiveMinimum != null && n <= spec.exclusiveMinimum) return `More than ${spec.exclusiveMinimum}`;
        if (high != null && n > high) return `At most ${high}`;
        return null;
      },
    });
    if (value === undefined) return;
    await hub.request("PUT", `/api/devices/${encodeURI(ref)}/settings`, { [name]: value.trim() ? Number(value) : null });
    vscode.window.setStatusBarMessage(`vonNeuro: ${name} sent to the node; it applies between jobs`, 5000);
    nodes.refresh();
    setTimeout(() => nodes.refresh(), 3000);   // show the value in force once the node has applied it
  });
  command("vonneuro.toggleRestricted", async (arg) => {
    const device = (arg && arg.device) || arg;
    const next = !device.restricted;
    const ok = await vscode.window.showWarningMessage(
      next ? `Restrict ${device.name} to this node's admins? Everyone else will see it as restricted and cannot run it.`
           : `Open ${device.name} again to everyone who can use it?`, { modal: true }, next ? "Restrict" : "Open");
    if (!ok) return;
    await hub.request("PATCH", `/api/devices/${encodeURI(device.ref)}`, { restricted: next });
    nodes.refresh();
    devices.refresh();
  });
}

function deactivate() {}

module.exports = { activate, deactivate };
