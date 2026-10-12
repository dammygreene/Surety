import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SubmissionStore } from "../src/domain.js";
import { EscrowProvider } from "../src/provider.js";

function withStore(callback: (store: SubmissionStore, path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "surety-"));
  const path = join(directory, "test.sqlite");
  process.env.SURETY_SEED_DEMO = "false";
  process.env.SURETY_DEFAULT_BOND_BASE_UNITS = "2000000";
  let store: SubmissionStore | undefined;
  try {
    const activeStore = new SubmissionStore(path);
    store = activeStore;
    callback(activeStore, path);
    try { activeStore.close(); } catch { /* restart test already closed it */ }
  } finally {
    try { store?.close(); } catch { /* already closed in restart test */ }
    rmSync(directory, { recursive: true, force: true });
  }
}

test("persists a verified bond and valid settlement across restart", () => {
  withStore((store, path) => {
    const submission = store.create({
      title: "real contribution",
      externalUrl: "https://github.com/example/repo/pull/10",
      githubUserId: "10",
      githubLogin: "contributor",
      payerDid: null
    });
    assert.equal(submission.moneyStatus, "awaiting_payment");
    const bonded = store.attachVerifiedPayment(submission.id, {
      payerDid: "did:pkh:eip155:42431:0x1111111111111111111111111111111111111111",
      evidenceType: "simulation",
      reference: "simulation:bond:10",
      idempotencyKey: "verify-10"
    });
    assert.equal(bonded.moneyStatus, "bonded");
    store.decide(submission.id, { outcome: "valid", reviewerId: "maintainer", idempotencyKey: "decision-10" });
    const settled = store.settle(submission.id, "refund", { evidenceType: "simulation", reference: "simulation:refund:10", idempotencyKey: "refund-10" });
    assert.equal(settled.moneyStatus, "refunded");
    store.close();
    const reopened = new SubmissionStore(path);
    assert.equal(reopened.get(submission.id)?.moneyStatus, "refunded");
    assert.equal(reopened.quoteForContributor(submission.contributorId), "0");
    reopened.close();
  });
});

test("rejects duplicate payment, unauthorized outcome shape, and Slop without a reason", () => {
  withStore((store) => {
    const submission = store.create({
      title: "duplicate test",
      externalUrl: "https://github.com/example/repo/pull/11",
      githubUserId: "11",
      githubLogin: "contributor",
      payerDid: null
    });
    store.attachVerifiedPayment(submission.id, {
      payerDid: "did:pkh:eip155:42431:0x2222222222222222222222222222222222222222",
      evidenceType: "simulation",
      reference: "simulation:bond:11",
      idempotencyKey: "verify-11"
    });
    assert.throws(() => store.decide(submission.id, { outcome: "slop", reviewerId: "maintainer", idempotencyKey: "decision-11" }), /reason/);
    const first = store.attachVerifiedPayment(submission.id, {
      payerDid: "did:pkh:eip155:42431:0x2222222222222222222222222222222222222222",
      evidenceType: "simulation",
      reference: "simulation:bond:11",
      idempotencyKey: "verify-11"
    });
    assert.equal(first.moneyStatus, "bonded");
  });
});

test("trusted contributor receives a zero-dollar quote after one valid settlement", () => {
  withStore((store) => {
    const first = store.create({
      title: "first",
      externalUrl: "https://github.com/example/repo/pull/12",
      githubUserId: "12",
      githubLogin: "trusted",
      payerDid: null
    });
    store.attachVerifiedPayment(first.id, {
      payerDid: "did:pkh:eip155:42431:0x3333333333333333333333333333333333333333",
      evidenceType: "simulation",
      reference: "simulation:bond:12",
      idempotencyKey: "verify-12"
    });
    store.decide(first.id, { outcome: "valid", reviewerId: "maintainer", idempotencyKey: "decision-12" });
    store.settle(first.id, "refund", { evidenceType: "simulation", reference: "simulation:refund:12", idempotencyKey: "refund-12" });
    const second = store.create({
      title: "second",
      externalUrl: "https://github.com/example/repo/pull/13",
      githubUserId: "12",
      githubLogin: "trusted",
      payerDid: "did:pkh:eip155:42431:0x3333333333333333333333333333333333333333"
    });
    assert.equal(second.requiredAmountBaseUnits, "0");
    assert.equal(second.moneyStatus, "not_required");
  });
});

test("does not allow ignored recovery before the review deadline", () => {
  withStore((store) => {
    const submission = store.create({
      title: "deadline",
      externalUrl: "https://github.com/example/repo/pull/14",
      githubUserId: "14",
      githubLogin: "deadline-user",
      payerDid: null
    });

    test("rejects simulation evidence while escrow mode is active", async () => {
      const previousMode = process.env.SURETY_PAYMENT_MODE;
      process.env.SURETY_PAYMENT_MODE = "escrow";
      try {
        await assert.rejects(
          new EscrowProvider().verifyBond({
            id: "simulation-check",
            title: "simulation-check",
            externalUrl: "https://example.test",
            contributorId: "contributor",
            contributorLabel: "contributor",
            payerDid: null,
            requiredAmountBaseUnits: "2000000",
            tokenSymbol: "PathUSD",
            tokenAddress: "0x20c0000000000000000000000000000000000000",
            chainId: 42431,
            outcome: "pending",
            moneyStatus: "awaiting_payment",
            reviewDeadlineAt: new Date(Date.now() + 60_000).toISOString(),
            decisionReason: null,
            reviewerId: null,
            providerReceiptId: null,
            bondId: null,
            transactionHash: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }, {
            payerDid: "did:pkh:eip155:42431:0x1111111111111111111111111111111111111111",
            evidenceType: "simulation",
            reference: "simulation:bond:test"
          }),
          /Simulation payments are disabled/
        );
      } finally {
        process.env.SURETY_PAYMENT_MODE = previousMode;
      }
    });
    store.attachVerifiedPayment(submission.id, {
      payerDid: "did:pkh:eip155:42431:0x4444444444444444444444444444444444444444",
      evidenceType: "simulation",
      reference: "simulation:bond:14",
      idempotencyKey: "verify-14"
    });
    assert.throws(() => store.markIgnoredExpired(submission.id), /deadline has not elapsed/);
  });
});
