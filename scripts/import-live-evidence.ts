import { SubmissionStore, type Submission } from "../src/domain.js";
import { EscrowProvider } from "../src/provider.js";
import { ReclaimKeeper } from "../src/keeper.js";

const validPost = "0x6eb710a119911e606a1ac9376ce2440059981d0e8f62d6a5a2c4c52e72f47cf8";
const validRelease = "0x721e4ab435990df8b990b252128827a84c571170727076259de66bc4f659c631";
const ignoredPost = "0xaf228b7c203ec0182df02b2934002d3fbeea6bb4e24b8c9f870bda48f3bf8963";
const ignoredReclaim = "0x80c0c416ea23000cda06c655cc5d1500c5865db2d2b816bf3a6aa717a50aa256";
const contributor = "0x553AFd88E2d2Cb5839E409eb3C996Cd0Af7BBd9B";
const payerDid = `did:pkh:eip155:42431:${contributor}`;

function existingOrCreate(store: SubmissionStore, title: string, reviewWindowSeconds?: number): Submission {
  const existing = store.list().find((item) => item.title === title);
  return existing ?? store.create({
    title,
    externalUrl: "https://explore.testnet.tempo.xyz/address/0x9eb4ffc29d5d5c636616225b3bb7d296ab5f8f95",
    githubUserId: "moderato-demo-contributor",
    githubLogin: "moderato-demo-contributor",
    payerDid,
    reviewWindowSeconds
  });
}

async function main(): Promise<void> {
  if (process.env.SURETY_PAYMENT_MODE === "simulation") throw new Error("Refusing live evidence import in simulation mode");
  if (process.env.TEMPO_CHAIN_ID !== "42431") throw new Error("Refusing non-Moderato configuration");
  const store = new SubmissionStore();
  const provider = new EscrowProvider();
  try {
    let valid = existingOrCreate(store, "Moderato proof: Valid release");
    const validPosted = await provider.readBondPosted(validPost);
    if (valid.moneyStatus === "awaiting_payment") {
      const evidence = await provider.verifyBond(valid, {
        payerDid,
        transactionHash: validPost,
        bondId: validPosted.bondId,
        evidenceType: "onchain_receipt",
        reference: validPost
      });
      valid = store.attachVerifiedPayment(valid.id, { ...evidence, bondId: validPosted.bondId, idempotencyKey: `live:verify:${valid.id}` });
    }
    if (valid.moneyStatus === "bonded") {
      valid = store.decide(valid.id, { outcome: "valid", reviewerId: "live-demo-maintainer", reason: "Confirmed existing Moderato Valid receipt", idempotencyKey: `live:decision:${valid.id}` });
    }
    if (valid.moneyStatus === "refund_pending") {
      const evidence = await provider.verifySettlement(valid, "refund", validRelease);
      valid = store.settle(valid.id, "refund", { ...evidence, idempotencyKey: `live:refund:${valid.id}` });
    }

    store.db.prepare("DELETE FROM audit_events WHERE submission_id IN (SELECT id FROM submissions WHERE title=? AND bond_id IS NULL)").run("Moderato proof: Ignored reclaim");
    store.db.prepare("DELETE FROM submissions WHERE title=? AND bond_id IS NULL AND money_status='not_required'").run("Moderato proof: Ignored reclaim");
    let ignored = store.list().find((item) => item.title === "Moderato proof: Ignored reclaim") ?? store.create({
      title: "Moderato proof: Ignored reclaim",
      externalUrl: "https://explore.testnet.tempo.xyz/address/0x9eb4ffc29d5d5c636616225b3bb7d296ab5f8f95",
      githubUserId: "moderato-demo-contributor",
      githubLogin: "moderato-demo-contributor",
      payerDid,
      requiredAmountBaseUnits: "2000000",
      reviewWindowSeconds: -1
    });
    const ignoredPosted = await provider.readBondPosted(ignoredPost);
    if (ignored.moneyStatus === "awaiting_payment") {
      const evidence = await provider.verifyBond(ignored, {
        payerDid,
        transactionHash: ignoredPost,
        bondId: ignoredPosted.bondId,
        evidenceType: "onchain_receipt",
        reference: ignoredPost
      });
      ignored = store.attachVerifiedPayment(ignored.id, { ...evidence, bondId: ignoredPosted.bondId, idempotencyKey: `live:verify:${ignored.id}` });
    }
    if (ignored.outcome === "pending") ignored = store.markIgnoredExpired(ignored.id);
    if (ignored.moneyStatus === "reclaimable") {
      store.rememberIdempotent(`keeper:reclaim:${ignored.id}`, "keeper_reclaim", { transactionHash: ignoredReclaim });
      store.close();
      const restartedStore = new SubmissionStore(process.env.SURETY_DATABASE_PATH ?? "surety.sqlite");
      await new ReclaimKeeper(restartedStore, provider).runOnce();
      ignored = restartedStore.get(ignored.id)!;
      restartedStore.close();
      ignored = store.get(ignored.id)!;
    }
    await new ReclaimKeeper(store, provider).runOnce();

    console.log(JSON.stringify({
      network: "Tempo Moderato",
      chainId: 42431,
      contract: process.env.SURETY_ESCROW_ADDRESS,
      valid: { id: valid.id, bondId: valid.bondId, moneyStatus: valid.moneyStatus, post: validPost, settlement: validRelease },
      ignored: { id: ignored.id, bondId: ignored.bondId, outcome: ignored.outcome, moneyStatus: ignored.moneyStatus, post: ignoredPost, settlement: ignoredReclaim },
      keeperResume: "existing reclaim hash verified and persisted before settlement; rerun is idempotent"
    }, null, 2));
  } finally {
    try { store.close(); } catch { /* restart proof intentionally closes the original store first */ }
  }
}

await main();
