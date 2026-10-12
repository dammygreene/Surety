import { createHash, randomBytes } from "node:crypto";
import { getAddress, verifyMessage } from "viem";
import type { Submission, SubmissionStore } from "./domain.js";
import { GitHubAppClient } from "./github.js";

const chainId = 42431;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

export function createOAuthStart(store: SubmissionStore, submission: Submission, redirectUri: string): string {
  if (!submission.githubRepository || !submission.githubNumber) throw new Error("Submission is not linked to a GitHub pull request");
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  store.createOAuthState({
    stateHash: hash(state),
    codeVerifier: verifier,
    submissionId: submission.id,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
  });
  return JSON.stringify({ state, url: GitHubAppClient.oauthAuthorizationUrl(state, challenge, redirectUri) });
}

export function walletChallengeMessage(input: {
  submissionId: string; githubUserId: string; repository: string; repositoryId: string;
  pullRequestNumber: number; headSha: string; walletAddress: string; expiresAt: string; nonce: string;
}): string {
  return [
    "Surety identity link",
    `Submission: ${input.submissionId}`,
    `GitHub user ID: ${input.githubUserId}`,
    `Repository: ${input.repository}`,
    `Repository ID: ${input.repositoryId}`,
    `Pull request: ${input.pullRequestNumber}`,
    `Head SHA: ${input.headSha}`,
    `Wallet: ${getAddress(input.walletAddress)}`,
    `Tempo chain ID: ${chainId}`,
    `Nonce: ${input.nonce}`,
    `Expires at: ${input.expiresAt}`
  ].join("\n");
}

export async function issueWalletChallenge(
  store: SubmissionStore,
  github: GitHubAppClient,
  session: { id: string; githubUserId: string; accessToken: string },
  submission: Submission,
  walletAddress: string
): Promise<{ nonce: string; message: string; expiresAt: string }> {
  if (!submission.githubRepository || !submission.githubNumber || !submission.githubHeadSha) throw new Error("Submission is not linked to a current GitHub pull request");
  const address = getAddress(walletAddress);
  const pull = await github.getPullRequest(session.accessToken, submission.githubRepository, submission.githubNumber);
  if (pull.authorId !== session.githubUserId || store.getSubmissionGithubUserId(submission.id) !== session.githubUserId) {
    throw new Error("Authenticated GitHub account is not the pull request author for this submission");
  }
  if (pull.headSha !== submission.githubHeadSha) throw new Error("Pull request head changed; refresh the submission");
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const nonce = base64Url(randomBytes(32));
  const message = walletChallengeMessage({
    submissionId: submission.id, githubUserId: session.githubUserId, repository: submission.githubRepository,
    repositoryId: pull.repositoryId, pullRequestNumber: submission.githubNumber, headSha: pull.headSha,
    walletAddress: address, expiresAt, nonce
  });
  store.createWalletChallenge({
    nonceHash: hash(nonce), sessionId: session.id, submissionId: submission.id, githubUserId: session.githubUserId,
    repository: submission.githubRepository, repositoryId: pull.repositoryId, pullRequestNumber: submission.githubNumber,
    headSha: pull.headSha, walletAddress: address, chainId, message, expiresAt
  });
  return { nonce, message, expiresAt };
}

export async function verifyWalletChallenge(
  store: SubmissionStore,
  input: { nonce: string; signature: `0x${string}`; walletAddress: string; submissionId: string },
  session: { id: string; githubUserId: string }
): Promise<{ walletAddress: string; githubUserId: string; submissionId: string }> {
  const challenge = store.getWalletChallenge(hash(input.nonce));
  if (!challenge || challenge.sessionId !== session.id || challenge.githubUserId !== session.githubUserId || challenge.submissionId !== input.submissionId) {
    throw new Error("Wallet challenge is invalid, expired, or already used");
  }
  if (challenge.chainId !== chainId || getAddress(input.walletAddress) !== getAddress(challenge.walletAddress)) throw new Error("Wallet or chain does not match the challenge");
  if (!await verifyMessage({ address: getAddress(challenge.walletAddress), message: challenge.message, signature: input.signature })) throw new Error("Wallet signature is invalid");
  if (!store.consumeWalletChallenge(hash(input.nonce))) throw new Error("Wallet challenge was already used");
  return { walletAddress: getAddress(challenge.walletAddress), githubUserId: challenge.githubUserId, submissionId: challenge.submissionId };
}
