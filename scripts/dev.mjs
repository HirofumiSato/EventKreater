import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];

function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

function launch(label, command, cwd) {
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (signal || code === 0 || code === null) return;
    console.error(`[${label}] exited with ${code}`);
  });
}

function shutdown() {
  for (const child of children) {
    if (!child.pid) continue;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { shell: true, stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

if (await listening(8000)) {
  console.log("[flyer] 127.0.0.1:8000 は既に起動しています。そのまま使います（Docker の flyer かもしれません）");
} else {
  launch(
    "flyer",
    "python -m uvicorn src.main:app --host 127.0.0.1 --port 8000",
    path.join(root, "services", "flyer"),
  );
}

if (await listening(3012)) {
  console.error("[web] ポート 3012 は使用中です。Docker の web が動いていないか確認してください（docker compose down で止まります）。");
  shutdown();
} else {
  launch("web", "npm run dev:web", root);
}
