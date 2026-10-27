// "Run on vonNeuro": the open Python file runs on this computer with a signed-in client, like a
// Python-lab script; the status bar follows the whole run and figures open in the editor.
const vscode = require("vscode");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { seconds, utc } = require("./views");

const CLIENT_SOURCE = "git+https://github.com/vonneuro/messenger-api.git";   // the public client package

async function pythonFor(uri) {
  const configured = vscode.workspace.getConfiguration("vonneuro").get("pythonPath");
  if (configured) return configured;
  const python = vscode.extensions.getExtension("ms-python.python");
  if (python) {
    try {
      const api = python.isActive ? python.exports : await python.activate();
      const environments = api && api.environments;
      if (environments) {
        const active = environments.getActiveEnvironmentPath(uri);
        const resolved = await environments.resolveEnvironment(active);
        if (resolved && resolved.executable && resolved.executable.uri) return resolved.executable.uri.fsPath;
      }
    } catch (_) { /* fall back to `python` */ }
  }
  return process.platform === "win32" ? "python" : "python3";
}

function hasClient(python) {
  return new Promise((resolve) => execFile(python, ["-c", "import vonneuro_messenger.lab"], (error) => resolve(!error)));
}

class Runner {
  constructor(context, hub, onFinished) {
    this.context = context;
    this.hub = hub;
    this.onFinished = onFinished;
    this.output = vscode.window.createOutputChannel("vonNeuro run");
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.status.command = "vonneuro.showOutput";
    this.child = null;
    context.subscriptions.push(this.output, this.status,
      vscode.commands.registerCommand("vonneuro.showOutput", () => this.output.show(true)));
  }

  async run(uri) {
    if (this.child) { vscode.window.showWarningMessage("A vonNeuro run is already going: stop it first."); return; }
    uri = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
    if (!uri || !uri.fsPath.endsWith(".py")) { vscode.window.showWarningMessage("Open a Python file to run it on vonNeuro."); return; }
    if (!this.hub.session && !(await vscode.commands.executeCommand("vonneuro.signIn"))) return;
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open && open.isDirty) await open.save();

    const python = await pythonFor(uri);
    if (!(await hasClient(python))) {
      const choice = await vscode.window.showErrorMessage(
        `${python} does not have the vonNeuro client (vonneuro_messenger).`, "Install it", "Choose another Python");
      if (choice === "Install it") {
        const terminal = vscode.window.createTerminal("vonNeuro: install the client");
        terminal.show();
        terminal.sendText(`"${python}" -m pip install --upgrade "${CLIENT_SOURCE}" numpy matplotlib`);
      } else if (choice === "Choose another Python") {
        vscode.commands.executeCommand("workbench.action.openSettings", "vonneuro.pythonPath");
      }
      return;
    }

    const settings = vscode.workspace.getConfiguration("vonneuro");
    let limit = settings.get("maxRequestsPerRun") || 0;
    if (!limit) {
      const limits = await this.hub.request("GET", "/api/pylab/limits").catch(() => ({ max_requests: 400 }));
      limit = limits.max_requests || 0;          // null: no limit on this account
    }
    const session = await this.hub.tokensForRun();
    const runDir = path.join(this.context.globalStorageUri.fsPath, "runs", String(Date.now()));
    fs.mkdirSync(path.join(runDir, "figures"), { recursive: true });
    const progressFile = path.join(runDir, "progress.jsonl");
    fs.writeFileSync(progressFile, "");

    const env = {
      ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8",
      MESSENGER_URL: this.hub.url(), MESSENGER_TOKEN: session.access, MESSENGER_REFRESH_TOKEN: session.refresh || "",
      MESSENGER_MAX_REQUESTS: limit ? String(limit) : "", MESSENGER_PROGRESS_FILE: progressFile,
      MESSENGER_OUTPUT_DIR: path.dirname(uri.fsPath), MESSENGER_FIGURE_DIR: path.join(runDir, "figures"),
      MESSENGER_FIGURES: settings.get("figuresInEditor") ? "vscode" : "",
    };
    const name = path.basename(uri.fsPath);
    this.output.clear();
    this.output.show(true);
    this.output.appendLine(`▶ ${name} on ${this.hub.url()} as ${session.username}` +
                           (limit ? ` (up to ${limit} requests)` : "") + `  [${python}]`);
    this.track = { started: Date.now(), jobs: 0, done: 0, failed: 0, run_s: 0, queue_s: 0, waiting: null, offset: 0,
                   progressFile, name };
    this.child = spawn(python, ["-m", "vonneuro_messenger.lab", uri.fsPath], { cwd: path.dirname(uri.fsPath), env });
    vscode.commands.executeCommand("setContext", "vonneuro.running", true);
    this.child.stdout.on("data", (data) => this.output.append(data.toString()));
    this.child.stderr.on("data", (data) => this.output.append(data.toString()));
    this.child.on("error", (error) => this.output.appendLine(`Could not start ${python}: ${error.message}`));
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
    this.child.on("close", (code) => this.finish(code));
  }

  stop() {
    if (!this.child) return;
    this.output.appendLine("■ Stopped. A job already sent finishes on the bench (cancel it from the Jobs view).");
    this.stopped = true;
    this.child.kill();
  }

  readProgress() {
    const t = this.track;
    let text;
    try {
      const size = fs.statSync(t.progressFile).size;
      if (size <= t.offset) return;
      const fd = fs.openSync(t.progressFile, "r");
      const buffer = Buffer.alloc(size - t.offset);
      fs.readSync(fd, buffer, 0, buffer.length, t.offset);
      fs.closeSync(fd);
      text = buffer.toString("utf-8");
    } catch (_) { return; }
    const lastBreak = text.lastIndexOf("\n");
    if (lastBreak < 0) return;
    t.offset += Buffer.byteLength(text.slice(0, lastBreak + 1));
    for (const line of text.slice(0, lastBreak).split("\n")) {
      let event;
      try { event = JSON.parse(line); } catch (_) { continue; }
      if (event.phase === "waiting") { t.jobs++; t.waiting = { id: event.id, since: Date.now() }; }
      else if (event.phase === "finished") {
        if (event.status === "done") t.done++; else t.failed++;
        const created = utc(event.created_at), started = utc(event.started_at), ended = utc(event.completed_at);
        if (created && started) t.queue_s += Math.max(0, (started - created) / 1000);
        if (started && ended) t.run_s += Math.max(0, (ended - started) / 1000);
        t.waiting = null;
      } else if (event.phase === "figure") {
        vscode.commands.executeCommand("vscode.open", vscode.Uri.file(event.path),
                                       { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: true });
      } else if (event.phase === "file") {
        this.output.appendLine(`  file: ${event.path}`);
      }
    }
  }

  summary(final) {
    const t = this.track, elapsed = (Date.now() - t.started) / 1000, finished = t.done + t.failed;
    const parts = [`${t.jobs} job${t.jobs === 1 ? "" : "s"}: ${t.done} done${t.failed ? `, ${t.failed} failed` : ""}`];
    if (finished) parts.push(`on the bench ${seconds(t.run_s)}, in the queue ${seconds(t.queue_s)}`,
                             `${seconds(elapsed / finished)} per job overall`);
    if (t.waiting && !final) parts.push(`now: job #${t.waiting.id}, ${seconds((Date.now() - t.waiting.since) / 1000)}`);
    return { elapsed, line: parts.join(" · ") };
  }

  tick() {
    this.readProgress();
    const { elapsed, line } = this.summary(false);
    this.status.text = `$(sync~spin) ${this.track.name} ${seconds(elapsed)} · ${this.track.jobs} jobs`;
    this.status.tooltip = `Script running ${seconds(elapsed)}\n${line}\nClick for the output.`;
    this.status.show();
  }

  finish(code) {
    clearInterval(this.timer);
    this.readProgress();
    const { elapsed, line } = this.summary(true);
    const outcome = this.stopped ? "stopped" : code === 0 ? "finished" : `ended with an error (exit ${code})`;
    this.output.appendLine(`\n${outcome === "finished" ? "✔" : "✖"} ${this.track.name} ${outcome}: script took ${seconds(elapsed)} · ${line}`);
    this.status.text = `${outcome === "finished" ? "$(check)" : "$(error)"} ${this.track.name} took ${seconds(elapsed)} · ${this.track.jobs} jobs`;
    this.status.tooltip = `Script ${outcome} after ${seconds(elapsed)}\n${line}\nClick for the output.`;
    this.child = null;
    this.stopped = false;
    vscode.commands.executeCommand("setContext", "vonneuro.running", false);
    if (this.onFinished) this.onFinished();
  }
}

module.exports = { Runner };
