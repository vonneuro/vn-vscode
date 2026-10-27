// The sidebar: the network's devices, your recent jobs, and the nodes you administer.
const vscode = require("vscode");

const STATUS_ICON = {
  online: ["circle-filled", "testing.iconPassed"], offline: ["circle-filled", "testing.iconFailed"],
  restricted: ["lock", "charts.yellow"], disabled: ["circle-slash", "disabledForeground"],
  queued: ["clock", "charts.yellow"], pending: ["clock", "charts.yellow"], running: ["sync~spin", "charts.blue"],
  done: ["check", "testing.iconPassed"], failed: ["error", "testing.iconFailed"], cancelled: ["circle-slash", "disabledForeground"],
};
const icon = (status) => {
  const [name, color] = STATUS_ICON[status] || ["circle-outline", undefined];
  return new vscode.ThemeIcon(name, color ? new vscode.ThemeColor(color) : undefined);
};
const ACTIVE = new Set(["queued", "pending", "running"]);

const seconds = (s) => s < 60 ? `${s.toFixed(1)} s` : s < 3600 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`
  : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
const utc = (t) => t ? new Date(/Z$|[+-]\d\d:\d\d$/.test(t) ? t : t + "Z") : null;

function item(label, options = {}) {
  const node = new vscode.TreeItem(label, options.children ? vscode.TreeItemCollapsibleState.Collapsed
                                                           : vscode.TreeItemCollapsibleState.None);
  Object.assign(node, options);
  return node;
}

function message(text, iconName = "info") {
  return item(text, { iconPath: new vscode.ThemeIcon(iconName) });
}

class Tree {
  constructor(hub) {
    this.hub = hub;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }
  refresh() { this.emitter.fire(); }
  getTreeItem(element) { return element; }
  async getChildren(element) {
    if (element) return element.children || [];
    if (!this.hub.session) return [];
    try { return await this.roots(); }
    catch (error) { return [message(String(error.message || error), "warning")]; }
  }
}

function operationItems(device) {
  return (device.operations || []).map((op) => {
    const params = Object.entries((op.params && op.params.properties) || op.params || {})
      .map(([name, p]) => `${name}${p && p.unit ? ` (${p.unit})` : ""}`).join(", ");
    return item(op.name, { description: params, tooltip: op.description || params, iconPath: new vscode.ThemeIcon("symbol-method") });
  });
}

class DevicesTree extends Tree {
  constructor(hub) { super(hub); this.managed = new Set(); }
  async roots() {
    const devices = await this.hub.request("GET", "/api/devices");
    if (!devices.length) return [message("No devices you can use yet.")];
    return devices.map((d) => item(d.name, {
      description: `${d.ref} · ${d.status}`, iconPath: icon(d.status), device: d,
      tooltip: new vscode.MarkdownString(`**${d.name}**  \n\`${d.ref}\` · ${d.kind} · ${d.status}\n\n${d.description || ""}`),
      contextValue: this.managed.has(d.ref) ? "device-managed" : "device",
      command: { command: "vonneuro.openDevicePage", title: "Open", arguments: [d] },
      children: operationItems(d),
    }));
  }
}

class JobsTree extends Tree {
  async roots() {
    const jobs = (await this.hub.request("GET", "/api/jobs")).slice(0, 30);
    if (!jobs.length) return [message("No jobs yet.")];
    return jobs.map((j) => {
      const started = utc(j.started_at), ended = utc(j.completed_at), created = utc(j.created_at);
      const took = started && ended ? `ran ${seconds((ended - started) / 1000)}`
        : started ? `running ${seconds((Date.now() - started) / 1000)}` : "";
      const queued = created && started ? `queued ${seconds(Math.max(0, started - created) / 1000)}` : "";
      return item(`#${j.id} ${j.name}`, {
        description: [j.status, took].filter(Boolean).join(" · "), iconPath: icon(j.status), job: j,
        tooltip: [`${j.job_type} · ${j.status}`, queued, took, created ? `sent ${created.toLocaleString()}` : ""].filter(Boolean).join("\n"),
        contextValue: ACTIVE.has(j.status) ? "job-active" : "job",
        command: { command: "vonneuro.showJob", title: "Show", arguments: [j] },
      });
    });
  }
}

class NodesTree extends Tree {
  constructor(hub, devicesTree) { super(hub); this.devicesTree = devicesTree; }
  async roots() {
    const nodes = await this.hub.request("GET", "/api/nodes/mine");
    this.devicesTree.managed = new Set(nodes.flatMap((n) => n.devices.map((d) => d.ref)));
    this.devicesTree.refresh();
    if (!nodes.length) {
      return [message("No nodes yet. Register one on the website (My hardware) to share your hardware.")];
    }
    return nodes.map((n) => item(n.name, {
      description: `${n.role || ""} · ${n.revoked ? "disconnected" : n.online ? "online" : "offline"}`,
      iconPath: icon(n.revoked ? "disabled" : n.online ? "online" : "offline"),
      tooltip: `${n.description || ""}\nOwner ${n.owner || "—"} · admins ${n.admins.join(", ") || "none"} · agent ${n.agent_version || "—"}`,
      children: n.devices.map((d) => this.deviceItem(d)),
    }));
  }

  deviceItem(d) {
    const pending = d.pending_settings || {};
    const settings = Object.entries(d.settings || {}).map(([name, s]) => {
      const range = [s.minimum ?? s.exclusiveMinimum, s.maximum].map((v) => v ?? "…").join(" … ");
      return item(`${name} = ${s.value ?? "—"}${s.unit ? " " + s.unit : ""}`, {
        description: (name in pending ? `→ ${pending[name] ?? "default"} (waiting for the node) · ` : "") + `allowed ${range}`,
        tooltip: `${s.description || ""}\nDefault ${s.default ?? "—"} ${s.unit || ""}`,
        iconPath: new vscode.ThemeIcon("settings-gear"), contextValue: "setting", setting: { ref: d.ref, name, spec: s },
        command: { command: "vonneuro.editSetting", title: "Change", arguments: [{ setting: { ref: d.ref, name, spec: s } }] },
      });
    });
    const rows = [
      item(`Restricted to admins: ${d.restricted ? "yes" : "no"}`, {
        iconPath: new vscode.ThemeIcon(d.restricted ? "lock" : "unlock"), device: d,
        command: { command: "vonneuro.toggleRestricted", title: "Switch", arguments: [{ device: d }] },
        tooltip: "Click to switch. Restricted: only this node's admins can run it; others see it as restricted.",
      }),
      ...(d.settings_error ? [message("The node refused the last change: " + d.settings_error, "warning")] : []),
      ...settings,
    ];
    return item(d.name, {
      description: `${d.ref} · ${d.status}`, iconPath: icon(d.status), device: d, contextValue: "device-managed",
      children: rows,
    });
  }
}

module.exports = { DevicesTree, JobsTree, NodesTree, seconds, utc, ACTIVE };
