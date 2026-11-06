import { busy, type Database } from "./types";

type Command = (command: string, args: Record<string, unknown>) => Promise<unknown>;
const activeWorkError = (error: unknown) => String(error).includes("active turns and sign-in");

/** Called only after explicit removal confirmation, including consent to stop this connection's work. */
export async function removeConnection(account: string, command: Command): Promise<void> {
  try {
    await command("remove_account", { account });
    return;
  } catch (error) {
    if (!activeWorkError(error)) throw error;
  }
  // Read the host's current state rather than relying on the UI's last poll.
  const db = await command("snapshot", {}) as Database;
  await command("cancel_login", { account });
  for (const session of db.sessions.filter(s => s.account === account && busy(s))) {
    try { await command("stop", { session: session.id }); }
    catch (error) { if (String(error) !== "No active turn") throw error; }
  }
  // Stop requests are asynchronous. Let supervisors reap processes before removing the binding.
  // The host remains the authority and refuses removal until active work has actually stopped.
  for (let attempt = 0; ; attempt++) {
    try {
      await command("remove_account", { account });
      return;
    } catch (error) {
      if (!activeWorkError(error) || attempt >= 99) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
