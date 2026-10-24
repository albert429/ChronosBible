// Port blocks: three consecutive ports per worktree (PW_PORT and the next two
// for AI tests). The registry leases blocks; availability is always probed.
import { createServer } from "node:net";

const HOSTS = ["127.0.0.1", "0.0.0.0"];
const MAX_BLOCKS = 64;

function canBind(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (/** @type {NodeJS.ErrnoException} */ error) =>
      // A host without that address family cannot conflict.
      resolve(error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT"),
    );
    server.listen({ port, host, exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}

export async function isPortFree(port) {
  for (const host of HOSTS) if (!(await canBind(port, host))) return false;
  return true;
}

export const blockOf = (start) => [start, start + 1, start + 2];

/** Ports in a block that are currently bound by something. */
export async function busyPorts(ports) {
  const busy = [];
  for (const port of ports) if (!(await isPortFree(port))) busy.push(port);
  return busy;
}

/** Lowest block from `base` that is neither leased nor in use. */
export async function findPortBlock(base, leased) {
  const taken = new Set(leased.flat());
  for (let i = 0; i < MAX_BLOCKS; i++) {
    const ports = blockOf(base + i * 3);
    if (ports[2] > 65535) break;
    if (ports.some((p) => taken.has(p))) continue;
    if ((await busyPorts(ports)).length === 0) return ports;
  }
  return null;
}
