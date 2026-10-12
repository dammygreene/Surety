import { randomBytes } from "node:crypto";
import { createPublicClient, decodeFunctionResult, defineChain, encodeFunctionData, http, keccak256, stringToHex, parseEventLogs, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Chain, createClient as createTempoClient } from "viem/tempo";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1)];
}));
const token = getAddress(env.TEMPO_TOKEN_ADDRESS);
const escrow = getAddress(env.SURETY_ESCROW_ADDRESS);
const rpcUrl = env.TEMPO_RPC_URL;
const chain = defineChain({
  id: Number(env.TEMPO_CHAIN_ID),
  name: "Tempo Moderato",
  nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }
});
const tempoChain = Chain.tempoTestnet.extend({ feeToken: token });
const project = privateKeyToAccount(`0x${env.SURETY_ESCROW_PRIVATE_KEY}`);
const keeper = privateKeyToAccount(`0x${env.SURETY_KEEPER_PRIVATE_KEY}`);
const contributor = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const contributorClient = createTempoClient({ account: contributor, chain: tempoChain, transport: http(rpcUrl) });
const projectClient = createTempoClient({ account: project, chain: tempoChain, transport: http(rpcUrl) });
const keeperClient = createTempoClient({ account: keeper, chain: tempoChain, transport: http(rpcUrl) });
const tokenAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "pure", inputs: [], outputs: [{ type: "uint8" }] }
] as const;
const escrowAbi = [
  { type: "event", name: "BondPosted", inputs: [{ indexed: true, name: "id", type: "bytes32" }, { indexed: true, name: "contributor", type: "address" }, { indexed: true, name: "project", type: "address" }, { indexed: false, name: "amount", type: "uint256" }, { indexed: false, name: "expiry", type: "uint64" }], anonymous: false },
  { type: "event", name: "BondReleased", inputs: [{ indexed: true, name: "id", type: "bytes32" }, { indexed: true, name: "contributor", type: "address" }, { indexed: false, name: "amount", type: "uint256" }], anonymous: false },
  { type: "event", name: "SlopFlagged", inputs: [{ indexed: true, name: "id", type: "bytes32" }, { indexed: true, name: "reasonHash", type: "bytes32" }, { indexed: false, name: "unlockAt", type: "uint64" }], anonymous: false },
  { type: "event", name: "BondReclaimed", inputs: [{ indexed: true, name: "id", type: "bytes32" }, { indexed: true, name: "contributor", type: "address" }, { indexed: false, name: "amount", type: "uint256" }], anonymous: false },
  { type: "function", name: "postBond", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }, { name: "project", type: "address" }, { name: "amount", type: "uint256" }, { name: "expiry", type: "uint64" }], outputs: [] },
  { type: "function", name: "release", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] },
  { type: "function", name: "flagSlop", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }, { name: "reasonHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "finalizeForfeit", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] },
  { type: "function", name: "reclaim", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] }
] as const;

async function faucet(): Promise<void> {
  await publicClient.request({ method: "tempo_fundAddress", params: [contributor.address] });
}

async function balance(address: `0x${string}`): Promise<bigint> {
  const client = createTempoClient({ chain: tempoChain, transport: http(rpcUrl) });
  return (await client.token.getBalance({ token, account: address })).amount;
}

async function readTokenMetadata(functionName: "symbol" | "decimals"): Promise<string | number> {
  const data = encodeFunctionData({ abi: tokenAbi, functionName });
  const result = await publicClient.request({ method: "eth_call", params: [{ to: token, data }, "latest"] });
  if (typeof result !== "string") throw new Error("Token metadata call returned an invalid result");
  return decodeFunctionResult({ abi: tokenAbi, functionName, data: result as `0x${string}` });
}

async function post(label: string, expirySeconds: number): Promise<{ id: `0x${string}`; hash: `0x${string}` }> {
  const id = keccak256(stringToHex(`surety-${label}-${Date.now()}`));
  const amount = 2_000_000n;
  const approval = await contributorClient.writeContract({
    address: token,
    abi: tokenAbi,
    functionName: "approve",
    args: [escrow, amount],
    account: contributor,
    chain: tempoChain
  });
  await publicClient.waitForTransactionReceipt({ hash: approval });
  const hash = await contributorClient.writeContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "postBond",
    args: [id, project.address, amount, BigInt(Math.floor(Date.now() / 1000) + expirySeconds)],
    account: contributor,
    chain: tempoChain
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} post failed`);
  const events = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: "BondPosted" });
  if (events.length !== 1) throw new Error(`${label} BondPosted event missing`);
  return { id, hash };
}

async function main(): Promise<void> {
  if (await publicClient.getChainId() !== 42431) throw new Error("Refusing non-Moderato chain");
  if (project.address.toLowerCase() === keeper.address.toLowerCase()) throw new Error("Project and keeper must differ");
  const symbol = await readTokenMetadata("symbol");
  if (symbol !== "PathUSD") throw new Error(`Unexpected token symbol: ${String(symbol)}`);
  if ((await readTokenMetadata("decimals")) !== 6) throw new Error("Unexpected token decimals");
  while ((await balance(contributor.address)) < 6_000_000n) await faucet();

  const validBefore = await balance(contributor.address);
  const valid = await post("valid", 300);
  const validBonded = await balance(escrow);
  const releaseHash = await projectClient.writeContract({ address: escrow, abi: escrowAbi, functionName: "release", args: [valid.id], account: project, chain: tempoChain });
  const releaseReceipt = await publicClient.waitForTransactionReceipt({ hash: releaseHash });
  const releaseEvents = parseEventLogs({ abi: escrowAbi, logs: releaseReceipt.logs, eventName: "BondReleased" });

  const slop = await post("slop", 300);
  const reasonHash = keccak256(stringToHex("testnet slop decision"));
  const flagHash = await projectClient.writeContract({ address: escrow, abi: escrowAbi, functionName: "flagSlop", args: [slop.id, reasonHash], account: project, chain: tempoChain });
  const flagReceipt = await publicClient.waitForTransactionReceipt({ hash: flagHash });
  const flagEvents = parseEventLogs({ abi: escrowAbi, logs: flagReceipt.logs, eventName: "SlopFlagged" });
  let earlyFinalizationRejected = false;
  try {
    await projectClient.writeContract({ address: escrow, abi: escrowAbi, functionName: "finalizeForfeit", args: [slop.id], account: project, chain: tempoChain });
  } catch {
    earlyFinalizationRejected = true;
  }

  const ignored = await post("ignored", 20);
  const beforeExpiryRejected = await (async () => {
    try {
      await keeperClient.writeContract({ address: escrow, abi: escrowAbi, functionName: "reclaim", args: [ignored.id], account: keeper, chain: tempoChain });
      return false;
    } catch {
      return true;
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 25_000));
  const reclaimHash = await keeperClient.writeContract({ address: escrow, abi: escrowAbi, functionName: "reclaim", args: [ignored.id], account: keeper, chain: tempoChain });
  const reclaimReceipt = await publicClient.waitForTransactionReceipt({ hash: reclaimHash });
  const reclaimEvents = parseEventLogs({ abi: escrowAbi, logs: reclaimReceipt.logs, eventName: "BondReclaimed" });

  console.log(JSON.stringify({
    chainId: 42431,
    token,
    contributor: contributor.address,
    project: project.address,
    keeper: keeper.address,
    valid: { postHash: valid.hash, releaseHash, bondBalanceAfterPost: validBonded.toString(), contributorBalanceBefore: validBefore.toString(), contributorBalanceAfter: (await balance(contributor.address)).toString(), releaseEvents: releaseEvents.length },
    slop: { postHash: slop.hash, flagHash, flagEvents: flagEvents.length, earlyFinalizationRejected, finalization: "blocked until 604800-second timelock" },
    ignored: { postHash: ignored.hash, reclaimHash, beforeExpiryRejected, reclaimEvents: reclaimEvents.length, contributorBalanceAfter: (await balance(contributor.address)).toString(), keeperBalanceAfter: (await balance(keeper.address)).toString() }
  }, null, 2));
}

await main();
