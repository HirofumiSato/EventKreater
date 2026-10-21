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
  console.log("[flyer] already listening on 127.0.0.1:8000");
} else {
  launch(
    "flyer",
    "python -m uvicorn src.main:app --host 127.0.0.1 --port 8000",
    path.join(root, "services", "flyer"),
  );
}

if (await listening(3012)) {
  console.error("[web] port 3012 is already in use");
  shutdown();
} else {
  launch("web", "npm run dev:web", root);
}
