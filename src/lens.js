// A `# vonNeuro` comment in a Python file's first lines marks it as a vonNeuro script: the
// extension puts "Run on vonNeuro" (or "Stop the run" while one is going) right above that line.
const vscode = require("vscode");

const MARKER = /^\s*#\s*vonneuro\b/i;
const HEAD_LINES = 5;

class RunLens {
  constructor(isRunning) {
    this.isRunning = isRunning;
    this.changed = new vscode.EventEmitter();
    this.onDidChangeCodeLenses = this.changed.event;
  }

  refresh() { this.changed.fire(); }

  provideCodeLenses(document) {
    for (let i = 0; i < Math.min(HEAD_LINES, document.lineCount); i++) {
      if (!MARKER.test(document.lineAt(i).text)) continue;
      const range = new vscode.Range(i, 0, i, 0);
      return this.isRunning()
        ? [new vscode.CodeLens(range, { title: "■ Stop the run", command: "vonneuro.stop" })]
        : [new vscode.CodeLens(range, { title: "▷ Run on vonNeuro", command: "vonneuro.run", arguments: [document.uri] })];
    }
    return [];
  }
}

module.exports = { RunLens };
