import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { SubmissionStore } from "./domain.js";
import { EscrowProvider, providerConfigurationError } from "./provider.js";
import { ReclaimKeeper } from "./keeper.js";
import { GitHubAppClient, GitHubIntegration, payloadHash, verifyGitHubSignature } from "./github.js";
import { pathToFileURL } from "node:url";
import { encodeFunctionData, keccak256, stringToHex } from "viem";
import { createOAuthStart, issueWalletChallenge, verifyWalletChallenge } from "./identity.js";

export const app = new Hono();
const store = new SubmissionStore();
const provider = new EscrowProvider();
const reclaimKeeper = new ReclaimKeeper(store, provider);
const githubClient = new GitHubAppClient();
const github = new GitHubIntegration(store, githubClient);
const decisionSchema = z.object({
  outcome: z.enum(["valid", "slop", "ignored"]),
  reason: z.string().trim().optional()
});
const bondSchema = z.object({
  payerDid: z.string().min(1).optional(),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  bondId: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  evidenceType: z.enum(["onchain_receipt", "simulation"]).default("onchain_receipt"),
  reference: z.string().min(1)
});
const reclaimSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional()
});

function maintainerAuthorized(request: Request): boolean {
  const expected = process.env.SURETY_MAINTAINER_TOKEN;
  return Boolean(expected && request.headers.get("X-Surety-Maintainer") === expected);
}

function explorerUrl(path: string): string {
  return `${process.env.TEMPO_EXPLORER_URL ?? "https://explore.testnet.tempo.xyz"}/${path}`;
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  const prefix = `${name}=`;
  const entry = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : undefined;
}

function oauthRedirectUri(): string {
  return `${process.env.SURETY_PUBLIC_URL ?? "http://localhost:3000"}/auth/github/callback`;
}

function presentSubmission(submission: ReturnType<SubmissionStore["get"]>) {
  if (!submission) return submission;
  return {
    ...submission,
    contractExplorerUrl: process.env.SURETY_ESCROW_ADDRESS ? explorerUrl(`address/${process.env.SURETY_ESCROW_ADDRESS}`) : null,
    transactionExplorerUrl: submission.transactionHash ? explorerUrl(`tx/${submission.transactionHash}`) : null,
    bondExplorerUrl: submission.providerReceiptId ? explorerUrl(`tx/${submission.providerReceiptId}`) : null
  };
}

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "surety",
    network: "Tempo Moderato",
    chainId: Number(process.env.TEMPO_CHAIN_ID ?? "42431"),
    provider: "escrow_contract",
    paymentMode: process.env.SURETY_PAYMENT_MODE ?? "escrow",
    providerConfigured: process.env.SURETY_PAYMENT_MODE !== "simulation" && !providerConfigurationError()
  })
);

app.get("/api/submissions", (c) => c.json({ submissions: store.list().map(presentSubmission) }));

app.get("/api/submissions/:id", (c) => {
  const submission = store.get(c.req.param("id"));
  return submission ? c.json(presentSubmission(submission)) : c.json({ error: "Submission not found" }, 404);
});

app.get("/auth/github/start", (c) => {
  const submission = store.get(c.req.query("submissionId") ?? "");
  if (!submission) return c.text("Submission not found", 404);
  try {
    const parsed = JSON.parse(createOAuthStart(store, submission, oauthRedirectUri())) as { state: string; url: string };
    c.header("Set-Cookie", `surety_oauth_state=${encodeURIComponent(parsed.state)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return c.redirect(parsed.url);
  } catch (error) {
    return c.text(error instanceof Error ? error.message : "GitHub OAuth is unavailable", 503);
  }
});

app.get("/auth/github/callback", async (c) => {
  const state = c.req.query("state");
  const code = c.req.query("code");
  if (!state || !code || cookieValue(c.req.raw, "surety_oauth_state") !== state) return c.text("Invalid OAuth state", 400);
  const stateRecord = store.consumeOAuthState(await import("node:crypto").then(({ createHash }) => createHash("sha256").update(state).digest("hex")));
  if (!stateRecord) return c.text("OAuth state expired or already used", 400);
  try {
    const identity = await githubClient.exchangeOAuthCode(code, stateRecord.codeVerifier, oauthRedirectUri());
    const sessionId = store.createAuthSession({
      githubUserId: identity.githubUserId,
      githubLogin: identity.githubLogin,
      accessToken: identity.accessToken,
      expiresAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString()
    });
    c.header("Set-Cookie", `surety_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    return c.redirect(`/pay/${stateRecord.submissionId}`);
  } catch (error) {
    return c.text(error instanceof Error ? error.message : "GitHub authentication failed", 502);
  }
});

app.post("/api/submissions/:id/identity/challenge", async (c) => {
  const session = cookieValue(c.req.raw, "surety_session") ? store.getAuthSession(cookieValue(c.req.raw, "surety_session")!) : undefined;
  if (!session) return c.json({ error: "GitHub authentication required" }, 401);
  const submission = store.get(c.req.param("id"));
  const parsed = z.object({ walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).safeParse(await c.req.json().catch(() => undefined));
  if (!submission || !parsed.success) return c.json({ error: "Invalid identity challenge request" }, 400);
  try {
    return c.json(await issueWalletChallenge(store, githubClient, session, submission, parsed.data.walletAddress));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unable to issue identity challenge" }, 422);
  }
});

app.post("/api/submissions/:id/identity/verify", async (c) => {
  const session = cookieValue(c.req.raw, "surety_session") ? store.getAuthSession(cookieValue(c.req.raw, "surety_session")!) : undefined;
  if (!session) return c.json({ error: "GitHub authentication required" }, 401);
  const parsed = z.object({ nonce: z.string().min(20), walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "Invalid wallet signature" }, 400);
  try {
    const linked = await verifyWalletChallenge(store, { ...parsed.data, signature: parsed.data.signature as `0x${string}`, submissionId: c.req.param("id") }, session);
    store.linkWalletIdentity(linked.submissionId, linked.githubUserId, linked.walletAddress, 42431);
    return c.json({ ok: true, walletAddress: linked.walletAddress });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Wallet identity verification failed" }, 422);
  }
});

app.post("/api/webhooks/github", async (c) => {
  const body = await c.req.text();
  if (!verifyGitHubSignature(body, c.req.header("X-Hub-Signature-256"), process.env.GITHUB_WEBHOOK_SECRET)) {
    return c.json({ error: "Invalid GitHub webhook signature" }, 401);
  }
  const deliveryId = c.req.header("X-GitHub-Delivery");
  const eventName = c.req.header("X-GitHub-Event") ?? "unknown";
  if (!deliveryId) return c.json({ error: "X-GitHub-Delivery header required" }, 400);
  let payload: any;
  try { payload = JSON.parse(body); } catch { return c.json({ error: "Invalid webhook JSON" }, 400); }
  if (!store.claimGithubDelivery(deliveryId, eventName, payloadHash(body))) return c.json({ ok: true, duplicate: true }, 202);
  try {
    if (eventName === "pull_request") await github.handlePullRequest(payload);
    else if (eventName === "issues" && payload.action === "opened") await github.handleIssue(payload);
    store.completeGithubDelivery(deliveryId);
    return c.json({ ok: true }, 202);
  } catch (error) {
    store.failGithubDelivery(deliveryId);
    return c.json({ error: error instanceof Error ? error.message : "GitHub webhook processing failed" }, 502);
  }
});

app.post("/api/submissions/:id/bond", async (c) => {
  const raw = c.req.header("content-type")?.includes("application/x-www-form-urlencoded")
    ? Object.fromEntries(new URLSearchParams(await c.req.text()).entries())
    : await c.req.json().catch(() => undefined);
  const parsed = bondSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "Invalid bond proof", details: parsed.error.flatten() }, 400);
  const submission = store.get(c.req.param("id"));
  if (!submission) return c.json({ error: "Submission not found" }, 404);
  try {
    if (process.env.SURETY_PAYMENT_MODE !== "simulation") {
      const sessionId = cookieValue(c.req.raw, "surety_session");
      const session = sessionId ? store.getAuthSession(sessionId) : undefined;
      const identity = store.getWalletIdentity(submission.id);
      if (!session || !identity || identity.githubUserId !== session.githubUserId) return c.json({ error: "Verified GitHub and wallet identity link required" }, 401);
    }
    const identity = store.getWalletIdentity(submission.id);
    const evidence = await provider.verifyBond(submission, { ...parsed.data, expectedPayerAddress: identity?.walletAddress });
    const bonded = store.attachVerifiedPayment(submission.id, {
      payerDid: evidence.payerDid,
      bondId: parsed.data.bondId,
      evidenceType: evidence.evidenceType,
      reference: evidence.reference,
      idempotencyKey: c.req.header("Idempotency-Key") ?? `verify:${submission.id}:${evidence.reference}`
    });
    try { await github.markBondConfirmed(bonded); } catch (error) {
      console.error("GitHub bond confirmation update failed", error instanceof Error ? error.message : error);
    }
    return c.json(presentSubmission(bonded));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Bond verification failed" }, 422);
  }
});

app.post("/api/submissions/:id/decision", async (c) => {
  if (!maintainerAuthorized(c.req.raw)) return c.json({ error: "Maintainer authentication required" }, 401);
  const idempotencyKey = c.req.header("Idempotency-Key");
  if (!idempotencyKey) return c.json({ error: "Idempotency-Key header required" }, 400);
  const prior = store.getIdempotent<ReturnType<SubmissionStore["get"]>>(idempotencyKey);
  if (prior) return c.json(prior);
  const parsed = decisionSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "Invalid decision", details: parsed.error.flatten() }, 400);
  const reviewerId = c.req.header("X-Surety-Maintainer")!;
  try {
    const current = store.get(c.req.param("id"));
    if (!current) return c.json({ error: "Submission not found" }, 404);
    if (current.outcome === "valid" && current.moneyStatus === "refund_pending") {
      const settlement = await provider.settle(current);
      const result = store.settle(current.id, "refund", { ...settlement, idempotencyKey: `${idempotencyKey}:settlement` });
      store.rememberIdempotent(idempotencyKey, "decision", result);
      return c.json(result);
    }
    if (current.outcome === "slop" && current.moneyStatus === "forfeiture_pending" && parsed.data.outcome === "slop") {
      const flag = await provider.flagSlop(current);
      const result = { ...current, settlement: "forfeiture_pending", providerReceiptId: flag.reference };
      store.rememberIdempotent(idempotencyKey, "decision", result);
      return c.json(result);
    }
    const submission = store.decide(current.id, { ...parsed.data, reviewerId, idempotencyKey });
    if (submission.moneyStatus === "refunded" || submission.moneyStatus === "forfeited") {
      store.rememberIdempotent(idempotencyKey, "decision", submission);
      return c.json(submission);
    }
    if (submission.outcome === "ignored") {
      store.rememberIdempotent(idempotencyKey, "decision", submission);
      return c.json(submission);
    }
    if (submission.outcome === "slop") {
      const flag = await provider.flagSlop(submission);
      const result = { ...submission, providerReceiptId: flag.reference, settlement: "forfeiture_pending" };
      store.rememberIdempotent(idempotencyKey, "decision", result);
      return c.json(result);
    }
    const settlement = await provider.settle(submission);
    const result = store.settle(submission.id, "refund", { ...settlement, idempotencyKey: `${idempotencyKey}:settlement` });
    store.rememberIdempotent(idempotencyKey, "decision", result);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Decision failed" }, 409);
  }
});

app.post("/api/submissions/:id/forfeit", async (c) => {
  if (!maintainerAuthorized(c.req.raw)) return c.json({ error: "Maintainer authentication required" }, 401);
  const submission = store.get(c.req.param("id"));
  if (!submission || submission.outcome !== "slop") return c.json({ error: "Slop submission not found" }, 404);
  try {
    const settlement = await provider.finalizeForfeiture(submission);
    return c.json(store.settle(submission.id, "forfeit", { ...settlement, idempotencyKey: c.req.header("Idempotency-Key") ?? `forfeit:${submission.id}` }));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Forfeiture failed" }, 409);
  }
});

app.post("/api/submissions/:id/reclaim", async (c) => {
  const submission = store.get(c.req.param("id"));
  if (!submission) return c.json({ error: "Submission not found" }, 404);
  try {
    const expired = submission.outcome === "pending" ? store.markIgnoredExpired(submission.id) : submission;
    const parsed = reclaimSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "Invalid reclaim transaction proof", details: parsed.error.flatten() }, 400);
    const settlement = await provider.reclaim(expired, parsed.data);
    return c.json(store.settle(expired.id, "reclaim", { ...settlement, idempotencyKey: `reclaim:${expired.id}` }));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Reclaim failed" }, 409);
  }
});

app.get("/api/reputation/:contributorId", (c) => {
  const contributorId = c.req.param("contributorId");
  const submission = store.list().find((item) => item.contributorId === contributorId);
  if (!submission) return c.json({ contributorId, requiredAmountBaseUnits: process.env.SURETY_DEFAULT_BOND_BASE_UNITS ?? "2000000", trusted: false });
  return c.json({ contributorId, payerDid: submission.payerDid, requiredAmountBaseUnits: store.quoteForContributor(contributorId), trusted: store.quoteForContributor(contributorId) === "0" });
});

app.get("/pay/:id", (c) => {
  let submission = store.get(c.req.param("id"));
  const serialized = c.req.query("submission");
  if (!submission && serialized) {
    try {
      const candidate = JSON.parse(Buffer.from(serialized, "base64url").toString("utf8")) as ReturnType<SubmissionStore["get"]>;
      if (candidate && candidate.id === c.req.param("id") && candidate.chainId === 42431) submission = candidate;
    } catch {
      return c.html("<h1>Invalid submission reference</h1>", 400);
    }
  }
  if (!submission) return c.html("<h1>Submission not found</h1>", 404);
  const amount = submission.requiredAmountBaseUnits === "0" ? "$0 (trusted contributor)" : `${submission.requiredAmountBaseUnits} base units`;
  const bondId = keccak256(stringToHex(submission.id));
  const paymentAbi = [
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
    { type: "function", name: "postBond", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }, { name: "project", type: "address" }, { name: "amount", type: "uint256" }, { name: "expiry", type: "uint64" }], outputs: [] }
  ] as const;
  const escrowAddress = process.env.SURETY_ESCROW_ADDRESS ?? "";
  const projectAddress = process.env.SURETY_PROJECT_ADDRESS ?? "";
  const tokenAddress = submission.tokenAddress;
  const config = JSON.stringify({
    id: submission.id,
    chainId: submission.chainId,
    amount: submission.requiredAmountBaseUnits,
    token: submission.tokenAddress,
    escrow: process.env.SURETY_ESCROW_ADDRESS ?? "",
    project: process.env.SURETY_PROJECT_ADDRESS ?? "",
    bondId,
    expiry: Math.floor(Date.parse(submission.reviewDeadlineAt) / 1000),
    approvalData: escrowAddress && tokenAddress ? encodeFunctionData({ abi: paymentAbi, functionName: "approve", args: [escrowAddress as `0x${string}`, BigInt(submission.requiredAmountBaseUnits)] }) : null,
    postBondData: escrowAddress && projectAddress ? encodeFunctionData({ abi: paymentAbi, functionName: "postBond", args: [bondId, projectAddress as `0x${string}`, BigInt(submission.requiredAmountBaseUnits), BigInt(Math.floor(Date.parse(submission.reviewDeadlineAt) / 1000))] }) : null,
    explorer: explorerUrl("tx/")
  }).replace(/</g, "\\u003c");
  return c.html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Surety bond</title><style>body{font:16px system-ui;max-width:680px;margin:40px auto;padding:0 20px;background:#f5f3ef}main{background:#fff;padding:24px;border-radius:12px}button{font:inherit;padding:10px;margin:6px 0;width:100%;box-sizing:border-box;background:#1f5548;color:#fff;border:0;border-radius:8px}button:disabled{opacity:.55}#status{padding:12px;background:#f0eee8;border-radius:8px;white-space:pre-wrap}</style><main><h1>Surety bond</h1><p><strong>${htmlEscape(submission.title)}</strong></p><p>Repository: ${htmlEscape(submission.githubRepository ?? "not linked")} · Pull request: ${submission.githubNumber ?? "not linked"}</p><p>Required bond: ${htmlEscape(amount)} of ${htmlEscape(submission.tokenSymbol)} on Tempo Moderato (chain ${submission.chainId}).</p><p>Payment status: <strong>${htmlEscape(submission.moneyStatus)}</strong>. Trust status: ${submission.requiredAmountBaseUnits === "0" ? "trusted contributor policy" : "bond required"}.</p><p><a href="/auth/github/start?submissionId=${encodeURIComponent(submission.id)}">Sign in with GitHub</a> to prove you authored this pull request.</p><div id="wallet">Wallet: not connected</div><div id="status">Review the amount and network before signing.</div>${submission.transactionHash ? `<p>Verified transaction: <a href="${htmlEscape(explorerUrl(`tx/${submission.transactionHash}`))}" rel="noreferrer">${htmlEscape(submission.transactionHash)}</a></p>` : submission.requiredAmountBaseUnits === "0" ? `<p>No token transfer is required under the current trusted-contributor policy.</p>` : `<button id="connect">Connect wallet and verify identity</button><button id="pay" disabled>Approve and post bond</button><p>Approval and bond posting are separate wallet transactions. The server verifies the confirmed BondPosted event before updating Surety.</p>`}<script>
const config=${config};
let provider=window.ethereum, account;
const status=document.querySelector("#status"), wallet=document.querySelector("#wallet"), pay=document.querySelector("#pay");
function message(value){status.textContent=value}
async function receipt(hash){for(let i=0;i<120;i++){const result=await provider.request({method:"eth_getTransactionReceipt",params:[hash]});if(result){if(result.status!=="0x1")throw new Error("Transaction reverted");return result}await new Promise(resolve=>setTimeout(resolve,2000))}throw new Error("Timed out waiting for confirmation")}
async function connect(){if(!provider)throw new Error("No injected wallet found. Install a supported Tempo-compatible wallet.");const accounts=await provider.request({method:"eth_requestAccounts"});account=accounts[0];const chain=await provider.request({method:"eth_chainId"});if(BigInt(chain)!==BigInt(config.chainId))throw new Error("Wrong network. Switch the wallet to Tempo Moderato (chain 42431).");const challengeResponse=await fetch("/api/submissions/"+config.id+"/identity/challenge",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({walletAddress:account})});const challenge=await challengeResponse.json();if(!challengeResponse.ok)throw new Error(challenge.error||"GitHub identity is not linked");message("Sign the identity challenge in your wallet.");const signature=await provider.request({method:"personal_sign",params:[challenge.message,account]});const verifyResponse=await fetch("/api/submissions/"+config.id+"/identity/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({nonce:challenge.nonce,walletAddress:account,signature})});const verified=await verifyResponse.json();if(!verifyResponse.ok)throw new Error(verified.error||"Identity verification failed");wallet.textContent="Verified wallet: "+account;pay.disabled=false;message("GitHub author and wallet verified. Confirm the exact amount and destination before signing.")}
async function submit(){pay.disabled=true;try{if(!account)await connect();if(!config.escrow||!config.project||!config.token||!config.approvalData||!config.postBondData)throw new Error("Escrow configuration is unavailable.");message("Confirm token approval in your wallet.");const approval=await provider.request({method:"eth_sendTransaction",params:[{from:account,to:config.token,data:config.approvalData}]});await receipt(approval);message("Approval confirmed. Confirm the bond posting transaction.");const post=await provider.request({method:"eth_sendTransaction",params:[{from:account,to:config.escrow,data:config.postBondData}]});message("Bond transaction submitted: "+post+"\\nWaiting for confirmation...");await receipt(post);const response=await fetch("/api/submissions/"+config.id+"/bond",{method:"POST",headers:{"content-type":"application/json","Idempotency-Key":"wallet:"+post},body:JSON.stringify({transactionHash:post,bondId:config.bondId,evidenceType:"onchain_receipt",reference:post})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Server verification failed");message("Bond confirmed and verified. Transaction: "+post);location.reload()}catch(error){pay.disabled=false;message(error instanceof Error?error.message:"Wallet transaction failed")}}
document.querySelector("#connect")?.addEventListener("click",()=>connect().catch(error=>message(error.message)));
pay?.addEventListener("click",()=>submit());
</script></main></html>`);
});

app.get("/", (c) => c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Surety inbox</title><style>
body{font:16px system-ui;margin:0;background:#f5f3ef;color:#20201e}main{max-width:960px;margin:0 auto;padding:32px}
header{display:flex;justify-content:space-between;align-items:center}h1{font-size:32px}.badge{background:#e9dfc6;padding:6px 10px;border-radius:999px}
article{background:white;border:1px solid #dedbd4;border-radius:12px;padding:20px;margin:16px 0;display:flex;justify-content:space-between;gap:16px}
button{border:0;border-radius:8px;padding:10px 14px;background:#1f5548;color:white;cursor:pointer}button.slop{background:#933c31}
</style></head><body><main><header><div><h1>Surety inbox</h1><p>Escrow-backed submission bonds · testnet demo</p></div><span class="badge">Tempo Moderato · 42431</span></header>
<p>Money states only change after a verified contract receipt. Configure <code>SURETY_MAINTAINER_TOKEN</code> before reviewing.</p>
<p><a href="${process.env.SURETY_ESCROW_ADDRESS ? explorerUrl(`address/${process.env.SURETY_ESCROW_ADDRESS}`) : "#"}" target="_blank" rel="noreferrer">Deployed Surety escrow contract</a> · <a href="${explorerUrl("")}" target="_blank" rel="noreferrer">Tempo explorer</a></p>
<section id="inbox"><p>Loading submissions…</p></section>
<script>
async function load(){const r=await fetch('/api/submissions');const d=await r.json();document.querySelector('#inbox').innerHTML=d.submissions.map(s=>\`
<article><div><strong>\${s.title}</strong><p>\${s.contributorLabel} · \${s.moneyStatus} · \${s.requiredAmountBaseUnits==='0'?'$0':s.requiredAmountBaseUnits+' '+s.tokenSymbol}</p>
<small>Review deadline: \${new Date(s.reviewDeadlineAt).toLocaleString()}</small>
<p>\${s.bondExplorerUrl?'<a target="_blank" rel="noreferrer" href="'+s.bondExplorerUrl+'">Bond receipt</a> · ':''}\${s.transactionExplorerUrl?'<a target="_blank" rel="noreferrer" href="'+s.transactionExplorerUrl+'">Settlement receipt</a>':''}</p></div>
<div>\${s.outcome==='pending'&&['bonded','not_required'].includes(s.moneyStatus)?'<button onclick="decide(\\'\${s.id}\\',\\'valid\\')">Valid</button> <button class="slop" onclick="decide(\\'\${s.id}\\',\\'slop\\')">Slop</button>':'<span>'+s.outcome+'</span>'}</div></article>\`).join('')}
async function decide(id,outcome){const reason=outcome==='slop'?prompt('Reason for Slop:'):undefined;if(outcome==='slop'&&!reason)return;const token=prompt('Maintainer token:');if(!token)return;const r=await fetch('/api/submissions/'+id+'/decision',{method:'POST',headers:{'content-type':'application/json','X-Surety-Maintainer':token,'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({outcome,reason})});if(!r.ok)alert((await r.json()).error);load()}load();
</script></main></body></html>`));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (process.env.SURETY_KEEPER_ENABLED === "true") reclaimKeeper.start();
  serve({ fetch: app.fetch, port });
  console.log(`Surety listening on http://localhost:${port}`);
}
