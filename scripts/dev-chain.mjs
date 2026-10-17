// Local EVM chain (Hardhat Network, chain id 31337) on http://127.0.0.1:$DEV_CHAIN_PORT (default 8545).
// Pre-funded test accounts are printed on start. Import one into your wallet for local testing only.
import "dotenv/config";
import { spawn } from "node:child_process";
const port = process.env.DEV_CHAIN_PORT ?? "8545";
const p = spawn("npx", ["hardhat", "node", "--config", "hardhat.config.cjs", "--hostname", "127.0.0.1", "--port", port], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
p.on("exit", (code) => process.exit(code ?? 0));
