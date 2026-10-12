import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { SubmissionStore } from "../src/domain.js";
import { issueWalletChallenge, verifyWalletChallenge } from "../src/identity.js";

test("binds the authenticated GitHub author to a wallet and rejects replay or wrong wallet", async () => {
  const directory = mkdtempSync(join(tmpdir(), "surety-identity-"));
  const store = new SubmissionStore(join(directory, "test.sqlite"));
  const account = privateKeyToAccount("0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a4a4f4f9f0e5e6f7a8b");
  const submission = store.create({
    title: "Identity PR", externalUrl: "https://github.com/acme/repo/pull/4",
    githubUserId: "42", githubLogin: "alice", payerDid: null,
    githubRepository: "acme/repo", githubNumber: 4, githubHeadSha: "a".repeat(40)
  });
  const session = store.createAuthSession({
    githubUserId: "42", githubLogin: "alice", accessToken: "server-only",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  const github = { async getPullRequest() { return { repositoryId: "123", number: 4, headSha: "a".repeat(40), authorId: "42" }; } };
  try {
    const challenge = await issueWalletChallenge(store, github as never, { id: session, githubUserId: "42", accessToken: "server-only" }, submission, account.address);
    const signature = await account.signMessage({ message: challenge.message });
    const linked = await verifyWalletChallenge(store, { nonce: challenge.nonce, signature, walletAddress: account.address, submissionId: submission.id }, { id: session, githubUserId: "42" });
    assert.equal(linked.walletAddress, account.address);
    store.linkWalletIdentity(linked.submissionId, linked.githubUserId, linked.walletAddress, 42431);
    assert.equal(store.getWalletIdentity(submission.id)?.githubUserId, "42");
    await assert.rejects(() => verifyWalletChallenge(store, { nonce: challenge.nonce, signature, walletAddress: account.address, submissionId: submission.id }, { id: session, githubUserId: "42" }));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a GitHub account that is not the pull request author", async () => {
  const directory = mkdtempSync(join(tmpdir(), "surety-identity-author-"));
  const store = new SubmissionStore(join(directory, "test.sqlite"));
  const submission = store.create({
    title: "Wrong author", externalUrl: "https://github.com/acme/repo/pull/5",
    githubUserId: "42", githubLogin: "alice", payerDid: null,
    githubRepository: "acme/repo", githubNumber: 5, githubHeadSha: "b".repeat(40)
  });
  const session = store.createAuthSession({ githubUserId: "42", githubLogin: "alice", accessToken: "server-only", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  try {
    await assert.rejects(() => issueWalletChallenge(store, { async getPullRequest() { return { repositoryId: "123", number: 5, headSha: "b".repeat(40), authorId: "99" }; } } as never, { id: session, githubUserId: "42", accessToken: "server-only" }, submission, "0x1111111111111111111111111111111111111111"));
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
