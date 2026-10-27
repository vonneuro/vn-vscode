# vonNeuro
# A first script for "Run on vonNeuro" (or the website's Python lab: it runs unchanged in both).
# `client` is already signed in; np, plt, save and save_csv are there as in the lab.

me = client.me()
print("signed in as", me.username)

for device in client.devices():
    print(f"{device.ref:28s} {device.status:10s} {device.name}")

# One harmless read: 0.1 V across RC channel 2 for 20 ms (pulse limits: see the Guide).
reply = client.pulse("rc:2", 0.1, 20)
current = np.array(reply["result"]["value"])
plt.plot(current * 1e6, "o-")
plt.xlabel("window")
plt.ylabel("current (uA)")
plt.title("rc:2 at 0.1 V for 20 ms")
plt.show()

save_csv("rc2_read.csv", [[k, i] for k, i in enumerate(current)], header=["window", "current_a"])
