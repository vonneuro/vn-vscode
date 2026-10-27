# vonNeuro for VS Code

Run Python on [vonNeuro](https://www.vonneuro.com) hardware from VS Code. You sign in once, and
your scripts run on your own computer. They send their jobs to the network's devices, and the
results come back to the editor.

Your scripts run the same here as in the website's Python lab. `client` is already signed in, and
`np`, `plt`, `save`, `save_csv` and `run_energy` are already there. A script you write in one
place also runs in the other.

## What it does

- **Sign in once.** Run `vonNeuro: Sign in` with your vonNeuro account. VS Code keeps the sign-in
  in its secret storage and renews it as needed, so scripts never ask for a password.
- **Run on vonNeuro.** Use the ▷ button on a Python file, or right-click the file. The script runs
  with your Python and shows its output in the *vonNeuro run* panel.
  - Figures from `plt.show()` open beside your code.
  - Files from `save()` / `save_csv()` are written next to the script.
- **Run progress.** The status bar shows the run as it goes:
  - the script's running time;
  - its jobs, done and failed;
  - time on the hardware versus in the queue;
  - the average per job;
  - the job it is waiting on.

  The totals stay there when the run ends.
- **Sidebar** (the vonNeuro icon):
  - **Devices**: every device you can use, with its status (online, offline, restricted) and its
    operations. Click a device to read its page.
  - **Jobs**: your recent jobs, with how long each was queued and ran. Click one for its logs, or
    cancel one that is still waiting.
  - **My hardware**: the nodes you own or administer. Change a device's settings, such as its
    pulse limits, and switch *Restricted to admins*, as on the website.

## Setup

1. Install the Python client into the Python you use, together with numpy and matplotlib:

   ```
   pip install "git+https://github.com/vonneuro/messenger-api.git" numpy matplotlib
   ```

   If the client is missing, **Run on vonNeuro** offers to install it.
2. Run `vonNeuro: Sign in`. No account yet? [Create one on vonneuro.com](https://www.vonneuro.com/signup.html).
3. Open [`examples/hello_bench.py`](examples/hello_bench.py) and press ▷ **Run on vonNeuro**.

Without the extension, the same script runs from a terminal:

```
python -m vonneuro_messenger.lab hello_bench.py
```

That command asks for your username and password, unless `MESSENGER_USER` and `MESSENGER_PASSWORD` are set.

## Settings

| Setting | |
|---|---|
| `vonneuro.hubUrl` | The hub to sign in to. |
| `vonneuro.pythonPath` | The Python used for runs. Empty: the interpreter you selected in the Python extension. |
| `vonneuro.maxRequestsPerRun` | How many requests one run may send. 0: your account's Python-lab limit. |
| `vonneuro.figuresInEditor` | Open figures in the editor. Off: matplotlib's own windows. |

## Good to know

- Every job waits its turn on shared hardware, and every request uses part of the hub's monthly
  allowance. Keep loops reasonable and split long experiments into several runs.
- Stopping a run ends your script. A job already sent still finishes on the hardware; cancel it
  from **Jobs** if it is still waiting.
- Pulses above about 0.5 V change a memristor's state, and the change stays for the next user.
  Check the device's page and the Guide before you raise the pulse limits.

MIT licensed.
