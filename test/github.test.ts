import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { SubmissionStore } from "../src/domain.js";
import { GitHubIntegration, verifyGitHubSignature } from "../src/github.js";

test("verifies GitHub signatures with constant-time comparison inputs", () => {
  const body = '{"action":"opened"}';
  const secret = "test-secret";
  const valid = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyGitHubSignature(body, valid, secret), true);
  assert.equal(verifyGitHubSignature(body, "sha256=8f2c6f4b8c0d4ee0dcb9a66f25f6d7d0a0e5a4ce5de7cc3f4b3f2a0a9bdc6e11", secret), false);
  assert.equal(verifyGitHubSignature(body, null, secret), false);
  assert.equal(verifyGitHubSignature(body, "sha256=invalid", secret), false);
});

test("creates a pending check and upgrades it only after bond confirmation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "surety-github-"));
  const store = new SubmissionStore(join(directory, "test.sqlite"));
  const calls: string[] = [];
  let nextId = 10;
  const client = {
    async request() { return undefined; },
    async createCheck() { calls.push("create-check"); return { id: nextId++ }; },
    async updateCheck(input: { status: string; conclusion?: string }) { calls.push(`update-check:${input.status}:${input.conclusion ?? ""}`); },
    async upsertComment() { calls.push("comment"); return { id: 20 }; },
    async addLabel() { calls.push("add-label"); },
    async removeLabel() { calls.push("remove-label"); }
  };
  try {
    const integration = new GitHubIntegration(store, client);
    const payload = {
      action: "opened",
      number: 7,
      installation: { id: 42 },
      repository: { full_name: "acme/demo" },
      pull_request: {
        title: "Improve parser",
        html_url: "https://github.com/acme/demo/pull/7",
        user: { id: 99, login: "contributor" },
        head: { sha: "a".repeat(40) }
      }
    };
    const pending = await integration.handlePullRequest(payload);
    assert.equal(pending?.moneyStatus, "awaiting_payment");
    assert.deepEqual(calls, ["create-check", "comment", "add-label"]);
    const bonded = store.attachVerifiedPayment(pending!.id, {
      payerDid: "did:pkh:eip155:42431:0x1111111111111111111111111111111111111111",
      evidenceType: "simulation",
      reference: "simulation:test",
      idempotencyKey: "bond:test"
    });
    await integration.markBondConfirmed(bonded);
    assert.deepEqual(calls.slice(3), ["update-check:completed:success", "remove-label", "comment"]);
    const duplicate = await integration.handlePullRequest(payload);
    assert.equal(duplicate?.id, pending?.id);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delivery keys are durable and duplicate-safe", () => {
  const directory = mkdtempSync(join(tmpdir(), "surety-github-delivery-"));
  const store = new SubmissionStore(join(directory, "test.sqlite"));
  try {
    assert.equal(store.claimGithubDelivery("delivery-1", "pull_request", "hash"), true);
    store.completeGithubDelivery("delivery-1");
    assert.equal(store.claimGithubDelivery("delivery-1", "pull_request", "hash"), false);
    assert.equal(store.claimGithubDelivery("delivery-2", "pull_request", "hash"), true);
    store.failGithubDelivery("delivery-2");
    assert.equal(store.claimGithubDelivery("delivery-2", "pull_request", "hash"), true);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
