import { createHmac, createPrivateKey, createHash, timingSafeEqual, sign } from "node:crypto";
import type { Submission, SubmissionStore } from "./domain.js";

export type GitHubRequest = { method?: string; path: string; body?: unknown };
export type GitHubClient = {
  request(input: GitHubRequest): Promise<any>;
  createCheck(input: { owner: string; repo: string; installationId?: string; headSha: string; status: "queued" | "in_progress" | "completed"; conclusion?: "success" | "neutral"; detailsUrl: string }): Promise<{ id: number }>;
  updateCheck(input: { owner: string; repo: string; installationId?: string; checkRunId: number; headSha: string; status: "queued" | "in_progress" | "completed"; conclusion?: "success" | "neutral"; detailsUrl: string }): Promise<void>;
  upsertComment(input: { owner: string; repo: string; installationId?: string; number: number; marker: string; body: string; commentId?: number | null }): Promise<{ id: number }>;
  addLabel(input: { owner: string; repo: string; installationId?: string; number: number; label: string }): Promise<void>;
  removeLabel(input: { owner: string; repo: string; installationId?: string; number: number; label: string }): Promise<void>;
};

export function verifyGitHubSignature(body: string, signature: string | null | undefined, secret: string | undefined): boolean {
  if (!signature || !secret || !signature.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const supplied = signature.slice(7);
  const suppliedBuffer = /^[0-9a-f]{64}$/i.test(supplied) ? Buffer.from(supplied, "hex") : Buffer.alloc(0);
  const expectedBuffer = Buffer.from(expected, "hex");
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function ownerRepo(repository: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length) throw new Error("Invalid GitHub repository name");
  return { owner, repo };
}

export class GitHubAppClient implements GitHubClient {
  private installationToken: { installationId: string; token: string; expiresAt: number } | undefined;
  constructor(private readonly appId = process.env.GITHUB_APP_ID, private readonly privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n"), private readonly fetchImpl: typeof fetch = fetch) {}

  static oauthAuthorizationUrl(state: string, codeChallenge: string, redirectUri: string): string {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    if (!clientId) throw new Error("GitHub OAuth client ID is not configured");
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: "read:user",
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    });
    return `https://github.com/login/oauth/authorize?${query}`;
  }

  async exchangeOAuthCode(code: string, verifier: string, redirectUri: string): Promise<{ accessToken: string; githubUserId: string; githubLogin: string }> {
    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("GitHub OAuth credentials are not configured");
    const tokenResponse = await this.fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, code_verifier: verifier })
    });
    if (!tokenResponse.ok) throw new Error(`GitHub OAuth token exchange failed (${tokenResponse.status})`);
    const token = await tokenResponse.json() as { access_token?: string; error?: string };
    if (!token.access_token) throw new Error(token.error ?? "GitHub OAuth token response was invalid");
    const userResponse = await this.fetchImpl("https://api.github.com/user", {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token.access_token}`, "X-GitHub-Api-Version": "2022-11-28" }
    });
    if (!userResponse.ok) throw new Error(`GitHub user lookup failed (${userResponse.status})`);
    const user = await userResponse.json() as { id?: number; login?: string };
    if (!user.id || !user.login) throw new Error("GitHub user response was invalid");
    return { accessToken: token.access_token, githubUserId: String(user.id), githubLogin: user.login };
  }

  async getPullRequest(accessToken: string, repository: string, number: number): Promise<{ repositoryId: string; number: number; headSha: string; authorId: string }> {
    const response = await this.fetchImpl(`https://api.github.com/repos/${repository}/pulls/${number}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${accessToken}`, "X-GitHub-Api-Version": "2022-11-28" }
    });
    if (!response.ok) throw new Error(`GitHub pull request lookup failed (${response.status})`);
    const pull = await response.json() as { number?: number; base?: { repo?: { id?: number } }; head?: { sha?: string }; user?: { id?: number } };
    if (!pull.number || !pull.base?.repo?.id || !pull.head?.sha || !pull.user?.id) throw new Error("GitHub pull request response was invalid");
    return { repositoryId: String(pull.base.repo.id), number: pull.number, headSha: pull.head.sha, authorId: String(pull.user.id) };
  }

  private async token(installationId: string): Promise<string> {
    if (this.installationToken?.installationId === installationId && this.installationToken.expiresAt > Date.now() + 60_000) return this.installationToken.token;
    if (!this.appId || !this.privateKey || !installationId) throw new Error("GitHub App credentials are not configured");
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.appId })).toString("base64url");
    const unsigned = `${header}.${payload}`;
    const jwt = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(this.privateKey)).toString("base64url")}`;
    const response = await this.fetchImpl(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + jwt, "X-GitHub-Api-Version": "2022-11-28" }
    });
    if (!response.ok) throw new Error(`GitHub installation token request failed (${response.status})`);
    const data = await response.json() as { token?: string; expires_at?: string };
    if (!data.token) throw new Error("GitHub installation token response was invalid");
    this.installationToken = { installationId, token: data.token, expiresAt: data.expires_at ? Date.parse(data.expires_at) : Date.now() + 50 * 60_000 };
    return data.token;
  }

  async request(input: GitHubRequest & { installationId?: string }): Promise<any> {
    const token = await this.token(input.installationId ?? "");
    const response = await this.fetchImpl(`https://api.github.com${input.path}`, {
      method: input.method ?? "GET",
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28", ...(input.body ? { "Content-Type": "application/json" } : {}) },
      body: input.body ? JSON.stringify(input.body) : undefined
    });
    if (!response.ok) throw new Error(`GitHub API request failed (${response.status})`);
    return response.status === 204 ? undefined : response.json();
  }

  async createCheck(input: { owner: string; repo: string; installationId?: string; headSha: string; status: "queued" | "in_progress" | "completed"; conclusion?: "success" | "neutral"; detailsUrl: string }): Promise<{ id: number }> {
    const data = await this.request({ method: "POST", path: `/repos/${input.owner}/${input.repo}/check-runs`, body: { name: "Surety Bond", head_sha: input.headSha, status: input.status, conclusion: input.conclusion, details_url: input.detailsUrl }, installationId: input.installationId ?? process.env.GITHUB_INSTALLATION_ID });
    return { id: Number(data.id) };
  }
  async updateCheck(input: { owner: string; repo: string; installationId?: string; checkRunId: number; headSha: string; status: "queued" | "in_progress" | "completed"; conclusion?: "success" | "neutral"; detailsUrl: string }): Promise<void> {
    await this.request({ method: "PATCH", path: `/repos/${input.owner}/${input.repo}/check-runs/${input.checkRunId}`, body: { head_sha: input.headSha, status: input.status, conclusion: input.conclusion, details_url: input.detailsUrl }, installationId: input.installationId ?? process.env.GITHUB_INSTALLATION_ID });
  }
  async upsertComment(input: { owner: string; repo: string; installationId?: string; number: number; marker: string; body: string; commentId?: number | null }): Promise<{ id: number }> {
    if (input.commentId) {
      const data = await this.request({ method: "PATCH", path: `/repos/${input.owner}/${input.repo}/issues/comments/${input.commentId}`, body: { body: input.body }, installationId: input.installationId ?? process.env.GITHUB_INSTALLATION_ID });
      return { id: Number(data.id) };
    }
    const comments = await this.request({ path: `/repos/${input.owner}/${input.repo}/issues/${input.number}/comments`, installationId: input.installationId ?? process.env.GITHUB_INSTALLATION_ID }) as Array<{ id: number; body?: string }>;
    const existing = comments.find((comment) => comment.body?.includes(input.marker));
    const path = existing ? `/repos/${input.owner}/${input.repo}/issues/comments/${existing.id}` : `/repos/${input.owner}/${input.repo}/issues/${input.number}/comments`;
    const data = await this.request({ method: existing ? "PATCH" : "POST", path, body: { body: input.body }, installationId: input.installationId ?? process.env.GITHUB_INSTALLATION_ID });
    return { id: Number(data.id) };
  }
  async addLabel(input: { owner: string; repo: string; installationId?: string; number: number; label: string }): Promise<void> {
    await this.request({ method: "POST", path: `/repos/${input.owner}/${input.repo}/issues/${input.number}/labels`, body: { labels: [input.label] }, installationId: input.installationId ?? process.env.GITHUB_INSTALLATION_ID });
  }
  async removeLabel(input: { owner: string; repo: string; installationId?: string; number: number; label: string }): Promise<void> {
    try {
      await this.request({ method: "DELETE", path: `/repos/${input.owner}/${input.repo}/issues/${input.number}/labels/${encodeURIComponent(input.label)}`, installationId: input.installationId ?? process.env.GITHUB_INSTALLATION_ID });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("(404)")) throw error;
    }
  }
}

export class GitHubIntegration {
  constructor(private readonly store: SubmissionStore, private readonly client: GitHubClient) {}
  async handlePullRequest(payload: any): Promise<Submission | undefined> {
    const repository = String(payload.repository?.full_name ?? "");
    const number = Number(payload.number);
    const action = String(payload.action);
    if (!repository || !number || !["opened", "reopened", "synchronize", "closed"].includes(action)) return undefined;
    let submission = this.store.findGithubSubmission(repository, number);
    if (!submission && action !== "closed") submission = this.store.create({ title: String(payload.pull_request?.title ?? `Pull request #${number}`), externalUrl: String(payload.pull_request?.html_url ?? `https://github.com/${repository}/pull/${number}`), githubUserId: String(payload.pull_request?.user?.id ?? "unknown"), githubLogin: String(payload.pull_request?.user?.login ?? "unknown"), payerDid: null, githubRepository: repository, githubInstallationId: String(payload.installation?.id ?? process.env.GITHUB_INSTALLATION_ID ?? ""), githubNumber: number, githubHeadSha: String(payload.pull_request?.head?.sha ?? "") });
    if (!submission) return undefined;
    const parts = ownerRepo(repository);
    submission = this.store.updateGithubLink(submission.id, { repository, installationId: String(payload.installation?.id ?? process.env.GITHUB_INSTALLATION_ID ?? ""), number, headSha: String(payload.pull_request?.head?.sha ?? submission.githubHeadSha ?? "") });
    const githubContext = { ...parts, installationId: submission.githubInstallationId ?? undefined };
    if (action === "closed") return submission;
    const trusted = submission.moneyStatus === "not_required";
    const check = submission.githubCheckRunId && action === "synchronize" ? (await this.client.updateCheck({ ...githubContext, checkRunId: submission.githubCheckRunId, headSha: submission.githubHeadSha!, status: trusted ? "completed" : "queued", conclusion: trusted ? "success" : undefined, detailsUrl: this.paymentUrl(submission) }), { id: submission.githubCheckRunId }) : submission.githubCheckRunId ? { id: submission.githubCheckRunId } : await this.client.createCheck({ ...githubContext, headSha: submission.githubHeadSha!, status: trusted ? "completed" : "queued", conclusion: trusted ? "success" : undefined, detailsUrl: this.paymentUrl(submission) });
    const comment = await this.client.upsertComment({ ...githubContext, number, marker: `<!-- surety-submission:${submission.id} -->`, body: this.commentBody(submission), commentId: submission.githubCommentId });
    if (trusted) await this.client.removeLabel({ ...githubContext, number, label: "bond-pending" }); else await this.client.addLabel({ ...githubContext, number, label: "bond-pending" });
    return this.store.updateGithubLink(submission.id, { checkRunId: check.id, commentId: comment.id });
  }
  async handleIssue(payload: any): Promise<Submission | undefined> {
    const repository = String(payload.repository?.full_name ?? "");
    const number = Number(payload.issue?.number ?? payload.number);
    if (!repository || !number) return undefined;
    const submission = this.store.findGithubSubmission(repository, number) ?? this.store.create({ title: String(payload.issue?.title ?? `Issue #${number}`), externalUrl: String(payload.issue?.html_url ?? `https://github.com/${repository}/issues/${number}`), githubUserId: String(payload.issue?.user?.id ?? "unknown"), githubLogin: String(payload.issue?.user?.login ?? "unknown"), payerDid: null, githubRepository: repository, githubInstallationId: String(payload.installation?.id ?? process.env.GITHUB_INSTALLATION_ID ?? ""), githubNumber: number });
    const parts = { ...ownerRepo(repository), installationId: submission.githubInstallationId ?? undefined };
    const comment = await this.client.upsertComment({ ...parts, number, marker: `<!-- surety-submission:${submission.id} -->`, body: this.commentBody(submission), commentId: submission.githubCommentId });
    await this.client.addLabel({ ...parts, number, label: "bond-pending" });
    return this.store.updateGithubLink(submission.id, { repository, number, commentId: comment.id });
  }
  async markBondConfirmed(submission: Submission): Promise<void> {
    if (!submission.githubRepository || !submission.githubHeadSha || !submission.githubCheckRunId || !submission.githubNumber) return;
    const parts = { ...ownerRepo(submission.githubRepository), installationId: submission.githubInstallationId ?? undefined };
    await this.client.updateCheck({ ...parts, checkRunId: submission.githubCheckRunId, headSha: submission.githubHeadSha, status: "completed", conclusion: "success", detailsUrl: this.paymentUrl(submission) });
    await this.client.removeLabel({ ...parts, number: submission.githubNumber, label: "bond-pending" });
    await this.client.upsertComment({ ...parts, number: submission.githubNumber, marker: `<!-- surety-submission:${submission.id} -->`, body: this.commentBody(submission), commentId: submission.githubCommentId });
  }
  private paymentUrl(submission: Submission): string { return `${process.env.SURETY_PUBLIC_URL ?? "http://localhost:3000"}/pay/${submission.id}`; }
  private commentBody(submission: Submission): string { const status = submission.moneyStatus === "bonded" || submission.moneyStatus === "not_required" ? "verified" : "pending"; return `<!-- surety-submission:${submission.id} -->\n**Surety Bond:** ${status}\n\nRequired bond: ${submission.requiredAmountBaseUnits} base units of ${submission.tokenSymbol} on Tempo Moderato. [Open Surety payment page](${this.paymentUrl(submission)}).`; }
}

export function payloadHash(body: string): string { return createHash("sha256").update(body).digest("hex"); }
