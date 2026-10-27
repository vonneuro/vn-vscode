# Changelog

## 0.1.3

- A `# vonNeuro` comment in a Python file's first five lines puts **▷ Run on vonNeuro** (or **■ Stop the run**) right above it.
- The extension has the vonNeuro icon.

## 0.1.2

- A run opens with a vonNeuro banner in the *vonNeuro run* panel.

## 0.1.1

- **Install it** (for a missing client) now runs pip directly instead of typing the command into a shell. It works in PowerShell, which ran the old command as a string.
- The client installs from the GitHub zip archive, so it no longer needs git on the computer.

## 0.1.0

- Sign in to a vonNeuro hub. The sign-in is kept in VS Code's secret storage and renewed automatically.
- **Run on vonNeuro**: runs Python-lab scripts locally with a signed-in client. The run's progress shows in the status bar, and figures open in the editor.
- Sidebar:
  - **Devices**, with status, operations and device pages.
  - **Jobs**, with queue and run times, logs, and cancel.
  - **My hardware**, with device settings and the *Restricted to admins* switch.
