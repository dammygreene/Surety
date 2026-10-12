import { createPublicClient, decodeFunctionResult, defineChain, encodeFunctionData, http, parseEventLogs, keccak256, stringToHex, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createClient as createTempoClient } from "viem/tempo";
import type { Submission } from "./domain.js";

const escrowAbi = [
  { type: "event", name: "BondPosted", inputs: [
    { indexed: true, name: "id", type: "bytes32" }, { indexed: true, name: "contributor", type: "address" },
    { indexed: true, name: "project", type: "address" }, { indexed: false, name: "amount", type: "uint256" },
    { indexed: false, name: "expiry", type: "uint64" }
  ], anonymous: false },
  { type: "event", name: "BondReclaimed", inputs: [
    { indexed: true, name: "id", type: "bytes32" }, { indexed: true, name: "contributor", type: "address" }, { indexed: false, name: "amount", type: "uint256" }
  ], anonymous: false },
  { type: "event", name: "BondReleased", inputs: [
    { indexed: true, name: "id", type: "bytes32" }, { indexed: true, name: "contributor", type: "address" }, { indexed: false, name: "amount", type: "uint256" }
  ], anonymous: false },
  { type: "function", name: "bonds", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [
    { name: "contributor", type: "address" }, { name: "project", type: "address" }, { name: "amount", type: "uint256" },
    { name: "expiry", type: "uint64" }, { name: "slopUnlockAt", type: "uint64" }, { name: "reasonHash", type: "bytes32" }, { name: "status", type: "uint8" }
  ] },
  { type: "function", name: "release", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] },
  { type: "function", name: "flagSlop", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }, { name: "reasonHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "finalizeForfeit", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] },
  { type: "function", name: "reclaim", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] }
  ,{ type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

const chain = defineChain({
  id: Number(process.env.TEMPO_CHAIN_ID ?? "42431"),
  name: "Tempo Moderato",
  nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
  rpcUrls: { default: { http: [process.env.TEMPO_RPC_URL ?? "https://rpc.moderato.tempo.xyz"] } }
});

export type BondEvidence = {
  payerDid: string;
  evidenceType: "onchain_receipt" | "simulation";
  reference: string;
};

export function providerConfigurationError(): string | undefined {
  if (process.env.SURETY_PAYMENT_MODE === "simulation") return undefined;
  for (const key of ["SURETY_ESCROW_ADDRESS", "SURETY_ESCROW_PRIVATE_KEY", "SURETY_PROJECT_ADDRESS", "TEMPO_TOKEN_ADDRESS"]) {
    if (!process.env[key]) return `${key} is required for escrow payments`;
  }
  return undefined;
}

function readConfigurationError(): string | undefined {
  if (!process.env.SURETY_ESCROW_ADDRESS) return "SURETY_ESCROW_ADDRESS is required for escrow verification";
  if (!process.env.SURETY_PROJECT_ADDRESS) return "SURETY_PROJECT_ADDRESS is required for escrow verification";
  if (!process.env.TEMPO_TOKEN_ADDRESS) return "TEMPO_TOKEN_ADDRESS is required for escrow verification";
  return undefined;
}

function reclaimConfigurationError(): string | undefined {
  if (!process.env.SURETY_ESCROW_ADDRESS) return "SURETY_ESCROW_ADDRESS is required for escrow verification";
  if (!process.env.TEMPO_TOKEN_ADDRESS) return "TEMPO_TOKEN_ADDRESS is required for escrow verification";
  return undefined;
}

function keeperConfigurationError(): string | undefined {
  const error = reclaimConfigurationError();
  if (error) return error;
  if (!process.env.SURETY_KEEPER_PRIVATE_KEY) return "SURETY_KEEPER_PRIVATE_KEY is required for the reclaim keeper";
  return undefined;
}

function tempoWalletClient(privateKey: string) {
  const account = privateKeyToAccount(`0x${privateKey}`);
  return createTempoClient({
    account,
    chain,
    transport: http(),
    feeToken: process.env.TEMPO_TOKEN_ADDRESS as `0x${string}`
  });
}

function payerAddress(did: string): `0x${string}` {
  const match = /^did:pkh:eip155:\d+:(0x[0-9a-fA-F]{40})$/.exec(did);
  if (!match) throw new Error("payerDid must be a verified EVM DID");
  return getAddress(match[1]) as `0x${string}`;
}

async function readEscrowToken(client: ReturnType<typeof createPublicClient>): Promise<string> {
  const data = encodeFunctionData({ abi: escrowAbi, functionName: "token" });
  const result = await client.request({ method: "eth_call", params: [{ to: process.env.SURETY_ESCROW_ADDRESS as `0x${string}`, data }, "latest"] });
  if (typeof result !== "string") throw new Error("Escrow token call returned an invalid result");
  return decodeFunctionResult({ abi: escrowAbi, functionName: "token", data: result as `0x${string}` });
}

export class EscrowProvider {
  async verifyBond(submission: Submission, input: { payerDid?: string; expectedPayerAddress?: string; transactionHash?: string; bondId?: string; evidenceType: "onchain_receipt" | "simulation"; reference: string }): Promise<BondEvidence> {
    if (input.evidenceType === "simulation") {
      if (process.env.SURETY_PAYMENT_MODE !== "simulation") throw new Error("Simulation payments are disabled");
      if (!input.reference.startsWith("simulation:")) throw new Error("Simulation reference must be explicit");
      if (!input.payerDid) throw new Error("Simulation evidence requires a payer identity");
      return { payerDid: input.payerDid, evidenceType: "simulation", reference: input.reference };
    }
    if (!input.transactionHash || !input.bondId) throw new Error("transactionHash and bondId are required");
    const configurationError = readConfigurationError();
    if (configurationError) throw new Error(configurationError);
    const client = createPublicClient({ chain, transport: http() });
    if (await client.getChainId() !== chain.id) throw new Error("Configured RPC chain ID does not match Tempo Moderato");
    const configuredToken = await readEscrowToken(client);
    if (configuredToken.toLowerCase() !== process.env.TEMPO_TOKEN_ADDRESS!.toLowerCase()) throw new Error("Escrow token does not match configured Tempo token");
    const receipt = await client.getTransactionReceipt({ hash: input.transactionHash as `0x${string}` });
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== process.env.SURETY_ESCROW_ADDRESS!.toLowerCase()) throw new Error("Escrow transaction is not confirmed for the configured contract");
    const logs = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: "BondPosted" });
    const event = logs.find((log) => log.args.id.toLowerCase() === input.bondId!.toLowerCase());
    if (!event) throw new Error("Confirmed receipt does not contain the requested BondPosted event");
    if (event.args.amount.toString() !== submission.requiredAmountBaseUnits) throw new Error("Bond amount does not match the quoted amount");
    if (event.args.project.toLowerCase() !== process.env.SURETY_PROJECT_ADDRESS!.toLowerCase()) throw new Error("Bond project does not match Surety configuration");
    if (input.payerDid && event.args.contributor.toLowerCase() !== payerAddress(input.payerDid).toLowerCase()) throw new Error("Bond contributor does not match verified payer identity");
    if (input.expectedPayerAddress && event.args.contributor.toLowerCase() !== input.expectedPayerAddress.toLowerCase()) throw new Error("Bond contributor does not match linked wallet");
    return {
      payerDid: `did:pkh:eip155:${chain.id}:${event.args.contributor}`,
      evidenceType: "onchain_receipt",
      reference: input.transactionHash
    };
  }

  async readBondPosted(transactionHash: string): Promise<{ bondId: string; contributor: string; amount: string }> {
    const configurationError = readConfigurationError();
    if (configurationError) throw new Error(configurationError);
    const client = createPublicClient({ chain, transport: http() });
    const receipt = await client.getTransactionReceipt({ hash: transactionHash as `0x${string}` });
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== process.env.SURETY_ESCROW_ADDRESS!.toLowerCase()) {
      throw new Error("Bond post receipt is not confirmed for the configured contract");
    }
    const events = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: "BondPosted" });
    if (events.length !== 1) throw new Error("Bond post receipt must contain exactly one BondPosted event");
    const event = events[0];
    return { bondId: event.args.id, contributor: event.args.contributor, amount: event.args.amount.toString() };
  }

  async verifySettlement(submission: Submission, operation: "refund" | "reclaim", transactionHash: string): Promise<{ evidenceType: "onchain_receipt"; reference: string }> {
    const configurationError = reclaimConfigurationError();
    if (configurationError) throw new Error(configurationError);
    if (!submission.bondId) throw new Error("Submission has no verified contract bond ID");
    const client = createPublicClient({ chain, transport: http() });
    if (await client.getChainId() !== chain.id) throw new Error("Configured RPC chain ID does not match Tempo Moderato");
    const receipt = await client.getTransactionReceipt({ hash: transactionHash as `0x${string}` });
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== process.env.SURETY_ESCROW_ADDRESS!.toLowerCase()) {
      throw new Error("Settlement receipt is not confirmed for the configured contract");
    }
    const eventName = operation === "refund" ? "BondReleased" : "BondReclaimed";
    const events = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName });
    const event = events.find((entry) =>
      entry.args.id.toLowerCase() === submission.bondId!.toLowerCase() &&
      entry.args.amount.toString() === submission.requiredAmountBaseUnits
    );
    if (!event) throw new Error(`Confirmed receipt does not prove ${operation} for this submission`);
    return { evidenceType: "onchain_receipt", reference: transactionHash };
  }

  async settle(submission: Submission): Promise<{ evidenceType: "onchain_receipt" | "simulation"; reference: string }> {
    if (process.env.SURETY_PAYMENT_MODE === "simulation") return { evidenceType: "simulation", reference: `simulation:settlement:${submission.id}` };
    if (!submission.providerReceiptId) throw new Error("No verified bond receipt is attached");
    const configurationError = providerConfigurationError();
    if (configurationError) throw new Error(configurationError);
    const wallet = tempoWalletClient(process.env.SURETY_ESCROW_PRIVATE_KEY!);
    const id = (submission.bondId ?? keccak256(stringToHex(submission.id))) as `0x${string}`;
    if (submission.outcome !== "valid") throw new Error("Slop requires flagging and timelock finalization");
    const hash = await wallet.writeContract({ address: process.env.SURETY_ESCROW_ADDRESS as `0x${string}`, abi: escrowAbi, functionName: "release", args: [id], account: wallet.account, chain });
    const client = createPublicClient({ chain, transport: http() });
    await client.waitForTransactionReceipt({ hash });
    return { evidenceType: "onchain_receipt", reference: hash };
  }

  async flagSlop(submission: Submission): Promise<{ evidenceType: "onchain_receipt" | "simulation"; reference: string }> {
    if (process.env.SURETY_PAYMENT_MODE === "simulation") return { evidenceType: "simulation", reference: `simulation:slop-flag:${submission.id}` };
    const configurationError = readConfigurationError();
    if (configurationError) throw new Error(configurationError);
    if (!submission.decisionReason) throw new Error("Slop reason is required");
    const wallet = tempoWalletClient(process.env.SURETY_ESCROW_PRIVATE_KEY!);
    const hash = await wallet.writeContract({
      address: process.env.SURETY_ESCROW_ADDRESS as `0x${string}`,
      abi: escrowAbi,
      functionName: "flagSlop",
      args: [(submission.bondId ?? keccak256(stringToHex(submission.id))) as `0x${string}`, keccak256(stringToHex(submission.decisionReason))],
      account: wallet.account,
      chain
    });
    const client = createPublicClient({ chain, transport: http() });
    await client.waitForTransactionReceipt({ hash });
    return { evidenceType: "onchain_receipt", reference: hash };
  }

  async finalizeForfeiture(submission: Submission): Promise<{ evidenceType: "onchain_receipt" | "simulation"; reference: string }> {
    if (process.env.SURETY_PAYMENT_MODE === "simulation") return { evidenceType: "simulation", reference: `simulation:forfeit:${submission.id}` };
    const configurationError = providerConfigurationError();
    if (configurationError) throw new Error(configurationError);
    const wallet = tempoWalletClient(process.env.SURETY_ESCROW_PRIVATE_KEY!);
    const hash = await wallet.writeContract({ address: process.env.SURETY_ESCROW_ADDRESS as `0x${string}`, abi: escrowAbi, functionName: "finalizeForfeit", args: [(submission.bondId ?? keccak256(stringToHex(submission.id))) as `0x${string}`], account: wallet.account, chain });
    const client = createPublicClient({ chain, transport: http() });
    await client.waitForTransactionReceipt({ hash });
    return { evidenceType: "onchain_receipt", reference: hash };
  }

  async reclaim(submission: Submission, input?: { transactionHash?: string }): Promise<{ evidenceType: "onchain_receipt" | "simulation"; reference: string }> {
    if (process.env.SURETY_PAYMENT_MODE === "simulation") return { evidenceType: "simulation", reference: `simulation:reclaim:${submission.id}` };
    const configurationError = reclaimConfigurationError();
    if (configurationError) throw new Error(configurationError);
    if (!input?.transactionHash) throw new Error("A confirmed permissionless reclaim transaction is required");
    const client = createPublicClient({ chain, transport: http() });
    if (await client.getChainId() !== chain.id) throw new Error("Configured RPC chain ID does not match Tempo Moderato");
    const configuredToken = await readEscrowToken(client);
    if (configuredToken.toLowerCase() !== process.env.TEMPO_TOKEN_ADDRESS!.toLowerCase()) throw new Error("Escrow token does not match configured Tempo token");
    const receipt = await client.getTransactionReceipt({ hash: input.transactionHash as `0x${string}` });
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== process.env.SURETY_ESCROW_ADDRESS!.toLowerCase()) throw new Error("Reclaim transaction is not confirmed for the configured contract");
    const logs = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: "BondReclaimed" });
    const event = logs.find((log) => log.args.id.toLowerCase() === (submission.bondId ?? keccak256(stringToHex(submission.id))).toLowerCase());
    if (!event || event.args.amount.toString() !== submission.requiredAmountBaseUnits) {
      throw new Error("Confirmed receipt does not prove reclaim of this submission");
    }
    return { evidenceType: "onchain_receipt", reference: input.transactionHash };
  }

  async triggerReclaim(submission: Submission): Promise<string> {
    if (process.env.SURETY_PAYMENT_MODE === "simulation") return `simulation:reclaim:${submission.id}`;
    const configurationError = keeperConfigurationError();
    if (configurationError) throw new Error(configurationError);
    const client = createPublicClient({ chain, transport: http() });
    if (await client.getChainId() !== chain.id) throw new Error("Configured RPC chain ID does not match Tempo Moderato");
    const id = (submission.bondId ?? keccak256(stringToHex(submission.id))) as `0x${string}`;
    const prior = await client.getLogs({
      address: process.env.SURETY_ESCROW_ADDRESS as `0x${string}`,
      event: escrowAbi[1],
      args: { id },
      fromBlock: 0n,
      toBlock: "latest"
    });
    if (prior.length > 0 && prior[0].transactionHash) return prior[0].transactionHash;
    const wallet = tempoWalletClient(process.env.SURETY_KEEPER_PRIVATE_KEY!);
    const hash = await wallet.writeContract({
      address: process.env.SURETY_ESCROW_ADDRESS as `0x${string}`,
      abi: escrowAbi,
      functionName: "reclaim",
      args: [id],
      account: wallet.account,
      chain
    });
    await client.waitForTransactionReceipt({ hash });
    return hash;
  }
}
