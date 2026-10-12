import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

export const outcomes = ["pending", "valid", "slop", "ignored"] as const;
export type Outcome = (typeof outcomes)[number];
export const moneyStatuses = [
  "not_required",
  "awaiting_payment",
  "bonded",
  "refund_pending",
  "refunded",
  "forfeiture_pending",
  "forfeited",
  "reclaimable",
  "failed"
] as const;
export type MoneyStatus = (typeof moneyStatuses)[number];

export type Submission = {
  id: string;
  title: string;
  externalUrl: string;
  contributorId: string;
  contributorLabel: string;
  payerDid: string | null;
  requiredAmountBaseUnits: string;
  tokenSymbol: string;
  tokenAddress: string;
  chainId: number;
  outcome: Outcome;
  moneyStatus: MoneyStatus;
  reviewDeadlineAt: string;
  decisionReason: string | null;
  reviewerId: string | null;
  providerReceiptId: string | null;
  bondId: string | null;
  transactionHash: string | null;
  createdAt: string;
  updatedAt: string;
  githubRepository: string | null;
  githubInstallationId: string | null;
  githubNumber: number | null;
  githubHeadSha: string | null;
  githubCheckRunId: number | null;
  githubCommentId: number | null;
};

export type Decision = {
  outcome: Exclude<Outcome, "pending">;
  reason?: string;
  reviewerId: string;
  idempotencyKey: string;
};

type Row = Record<string, string | number | null>;

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS contributors (
  id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  payer_did TEXT UNIQUE,
  identity_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  external_url TEXT NOT NULL,
  contributor_id TEXT NOT NULL REFERENCES contributors(id),
  required_amount_base_units TEXT NOT NULL CHECK (CAST(required_amount_base_units AS INTEGER) >= 0),
  token_symbol TEXT NOT NULL,
  token_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('pending','valid','slop','ignored')),
  money_status TEXT NOT NULL CHECK (money_status IN ('not_required','awaiting_payment','bonded','refund_pending','refunded','forfeiture_pending','forfeited','reclaimable','failed')),
  review_deadline_at TEXT NOT NULL,
  decision_reason TEXT,
  reviewer_id TEXT,
  provider_receipt_id TEXT UNIQUE,
  bond_id TEXT UNIQUE,
  transaction_hash TEXT UNIQUE,
  github_repository TEXT,
  github_installation_id TEXT,
  github_number INTEGER,
  github_head_sha TEXT,
  github_check_run_id INTEGER,
  github_comment_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settlement_attempts (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  operation TEXT NOT NULL CHECK (operation IN ('verify','refund','forfeit','reclaim')),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed')),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('onchain_receipt','mpp_receipt','simulation')),
  reference TEXT,
  error_safe TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS reputation_events (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL REFERENCES contributors(id),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('valid_settled','slop_finalized','ignored_refund')),
  source_event_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT REFERENCES submissions(id),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  before_state_json TEXT,
  after_state_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS github_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  github_access_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_challenges (
  nonce_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES auth_sessions(id),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  github_user_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS identity_links (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id),
  github_user_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

function now(): string {
  return new Date().toISOString();
}

function asSubmission(row: Row): Submission {
  return {
    id: String(row.id),
    title: String(row.title),
    externalUrl: String(row.external_url),
    contributorId: String(row.contributor_id),
    contributorLabel: String(row.github_login),
    payerDid: row.payer_did === null ? null : String(row.payer_did),
    requiredAmountBaseUnits: String(row.required_amount_base_units),
    tokenSymbol: String(row.token_symbol),
    tokenAddress: String(row.token_address),
    chainId: Number(row.chain_id),
    outcome: String(row.outcome) as Outcome,
    moneyStatus: String(row.money_status) as MoneyStatus,
    reviewDeadlineAt: String(row.review_deadline_at),
    decisionReason: row.decision_reason === null ? null : String(row.decision_reason),
    reviewerId: row.reviewer_id === null ? null : String(row.reviewer_id),
    providerReceiptId: row.provider_receipt_id === null ? null : String(row.provider_receipt_id),
    bondId: row.bond_id === null ? null : String(row.bond_id),
    transactionHash: row.transaction_hash === null ? null : String(row.transaction_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
    ,githubRepository: row.github_repository === null ? null : String(row.github_repository)
    ,githubInstallationId: row.github_installation_id === null ? null : String(row.github_installation_id)
    ,githubNumber: row.github_number === null ? null : Number(row.github_number)
    ,githubHeadSha: row.github_head_sha === null ? null : String(row.github_head_sha)
    ,githubCheckRunId: row.github_check_run_id === null ? null : Number(row.github_check_run_id)
    ,githubCommentId: row.github_comment_id === null ? null : Number(row.github_comment_id)
  };
}

function databasePath(): string {
  const configured = process.env.SURETY_DATABASE_PATH;
  if (!process.env.VERCEL) return configured ?? "surety.sqlite";
  if (configured && isAbsolute(configured)) return configured;
  return "/tmp/surety.sqlite";
}

export class SubmissionStore {
  readonly db: DatabaseSync;
  private readonly defaultBond: string;
  private readonly tokenAddress: string;

  constructor(filename = databasePath()) {
    this.db = new DatabaseSync(filename);
    this.db.exec(schema);
    try { this.db.exec("ALTER TABLE submissions ADD COLUMN bond_id TEXT"); } catch (error) {
      if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) throw error;
    }

    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS submissions_bond_id_unique ON submissions(bond_id) WHERE bond_id IS NOT NULL");
    for (const column of [
      "github_repository TEXT", "github_installation_id TEXT", "github_number INTEGER",
      "github_head_sha TEXT", "github_check_run_id INTEGER", "github_comment_id INTEGER"
    ]) {
      try { this.db.exec(`ALTER TABLE submissions ADD COLUMN ${column}`); } catch (error) {
        if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) throw error;
      }
    }
    try { this.db.exec("ALTER TABLE github_deliveries ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'"); } catch (error) {
      if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) throw error;
    }
    this.defaultBond = process.env.SURETY_DEFAULT_BOND_BASE_UNITS ?? "2000000";
    this.tokenAddress = process.env.TEMPO_TOKEN_ADDRESS ?? "UNCONFIGURED";
    this.db.prepare("UPDATE submissions SET token_symbol=? WHERE lower(token_symbol)=lower(?)").run(process.env.TEMPO_TOKEN_SYMBOL ?? "PathUSD", "pathUSD");
    if (this.list().length === 0 && process.env.SURETY_SEED_DEMO !== "false") {
      this.create({
        id: process.env.SURETY_DEMO_SUBMISSION_ID ?? "00000000-0000-4000-8000-000000000001",
        title: "Improve parser error message",
        externalUrl: "https://github.com/surety-demo/example/pull/1",
        githubUserId: "1001",
        githubLogin: "first-contributor",
        payerDid: null,
        requiredAmountBaseUnits: this.defaultBond,
        reviewWindowSeconds: 7 * 24 * 60 * 60
      });
    }
  }

  close(): void {
    this.db.close();
  }

  list(): Submission[] {
    return (this.db.prepare("SELECT s.*, c.github_login, c.payer_did FROM submissions s JOIN contributors c ON c.id=s.contributor_id ORDER BY s.created_at DESC").all() as Row[]).map(asSubmission);
  }

  listReclaimCandidates(): Submission[] {
    return (this.db.prepare(`SELECT s.*, c.github_login, c.payer_did
      FROM submissions s JOIN contributors c ON c.id=s.contributor_id
      WHERE (s.outcome='pending' AND s.money_status='bonded' AND s.review_deadline_at <= ?)
         OR (s.outcome='ignored' AND s.money_status='reclaimable')
      ORDER BY s.review_deadline_at`).all(now()) as Row[]).map(asSubmission);
  }

  get(id: string): Submission | undefined {
    const row = this.db.prepare("SELECT s.*, c.github_login, c.payer_did FROM submissions s JOIN contributors c ON c.id=s.contributor_id WHERE s.id=?").get(id) as Row | undefined;
    return row ? asSubmission(row) : undefined;
  }

  getSubmissionGithubUserId(id: string): string | undefined {
    const row = this.db.prepare("SELECT c.github_user_id FROM submissions s JOIN contributors c ON c.id=s.contributor_id WHERE s.id=?").get(id) as Row | undefined;
    return row?.github_user_id === null || row?.github_user_id === undefined ? undefined : String(row.github_user_id);
  }

  getIdempotent<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT response_json FROM idempotency_keys WHERE key=?").get(key) as Row | undefined;
    return row ? JSON.parse(String(row.response_json)) as T : undefined;
  }

  rememberIdempotent(key: string, operation: string, value: unknown): void {
    this.db.prepare("INSERT OR IGNORE INTO idempotency_keys (key,operation,response_json,created_at) VALUES (?,?,?,?)")
      .run(key, operation, JSON.stringify(value), now());
  }

  create(input: {
    id?: string;
    title: string;
    externalUrl: string;
    githubUserId: string;
    githubLogin: string;
    payerDid: string | null;
    requiredAmountBaseUnits?: string;
    reviewWindowSeconds?: number;
    githubRepository?: string;
    githubInstallationId?: string;
    githubNumber?: number;
    githubHeadSha?: string;
  }): Submission {
    const id = input.id ?? randomUUID();
    const contributorId = this.upsertContributor(input.githubUserId, input.githubLogin, input.payerDid);
    const amount = input.requiredAmountBaseUnits ?? this.quoteForContributor(contributorId);
    const timestamp = now();
    const moneyStatus: MoneyStatus = amount === "0" ? "not_required" : "awaiting_payment";
    this.db.prepare(`INSERT INTO submissions
      (id,title,external_url,contributor_id,required_amount_base_units,token_symbol,token_address,chain_id,outcome,money_status,review_deadline_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.title, input.externalUrl, contributorId, amount, process.env.TEMPO_TOKEN_SYMBOL ?? "TEST",
      this.tokenAddress, Number(process.env.TEMPO_CHAIN_ID ?? "42431"), "pending", moneyStatus,
      new Date(Date.now() + (input.reviewWindowSeconds ?? 7 * 24 * 60 * 60) * 1000).toISOString(), timestamp, timestamp
    );
    this.db.prepare(`UPDATE submissions SET github_repository=?, github_installation_id=?, github_number=?, github_head_sha=? WHERE id=?`)
      .run(input.githubRepository ?? null, input.githubInstallationId ?? null, input.githubNumber ?? null, input.githubHeadSha ?? null, id);
    if (amount === "0") {
      this.audit(id, "system", "zero_dollar_submission", "Trusted policy qualified contributor");
    }
    return this.get(id)!;
  }

  findGithubSubmission(repository: string, number: number): Submission | undefined {
      const row = this.db.prepare("SELECT s.*, c.github_login, c.payer_did FROM submissions s JOIN contributors c ON c.id=s.contributor_id WHERE github_repository=? AND github_number=? ORDER BY s.created_at DESC LIMIT 1").get(repository, number) as Row | undefined;
      return row ? asSubmission(row) : undefined;
  }

  updateGithubLink(id: string, input: { repository?: string; installationId?: string; number?: number; headSha?: string; checkRunId?: number; commentId?: number }): Submission {
      this.db.prepare(`UPDATE submissions SET github_repository=COALESCE(?,github_repository), github_installation_id=COALESCE(?,github_installation_id),
        github_number=COALESCE(?,github_number), github_head_sha=COALESCE(?,github_head_sha),
        github_check_run_id=COALESCE(?,github_check_run_id), github_comment_id=COALESCE(?,github_comment_id), updated_at=? WHERE id=?`)
        .run(input.repository ?? null, input.installationId ?? null, input.number ?? null, input.headSha ?? null, input.checkRunId ?? null, input.commentId ?? null, now(), id);
      return this.get(id)!;
  }

  claimGithubDelivery(deliveryId: string, eventName: string, payloadHash: string): boolean {
      const existing = this.db.prepare("SELECT status FROM github_deliveries WHERE delivery_id=?").get(deliveryId) as Row | undefined;
      if (existing?.status === "completed") return false;
      if (existing) {
        this.db.prepare("UPDATE github_deliveries SET event_name=?, payload_hash=?, status='pending' WHERE delivery_id=?")
          .run(eventName, payloadHash, deliveryId);
        return true;
      }
      try {
          this.db.prepare("INSERT INTO github_deliveries (delivery_id,event_name,payload_hash,status,created_at) VALUES (?,?,?,'pending',?)")
            .run(deliveryId, eventName, payloadHash, now());
          return true;
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return false;
        throw error;
      }
  }

  completeGithubDelivery(deliveryId: string): void {
    this.db.prepare("UPDATE github_deliveries SET status='completed' WHERE delivery_id=?").run(deliveryId);
  }

  failGithubDelivery(deliveryId: string): void {
    this.db.prepare("UPDATE github_deliveries SET status='failed' WHERE delivery_id=?").run(deliveryId);
  }

  createOAuthState(input: { stateHash: string; codeVerifier: string; submissionId: string; expiresAt: string }): void {
    this.db.prepare("INSERT INTO oauth_states (state_hash,code_verifier,submission_id,created_at,expires_at) VALUES (?,?,?,?,?)")
      .run(input.stateHash, input.codeVerifier, input.submissionId, now(), input.expiresAt);
  }

  consumeOAuthState(stateHash: string): { codeVerifier: string; submissionId: string } | undefined {
    const row = this.db.prepare("SELECT code_verifier, submission_id, expires_at, consumed_at FROM oauth_states WHERE state_hash=?").get(stateHash) as Row | undefined;
    if (!row || row.consumed_at !== null || String(row.expires_at) <= now()) return undefined;
    this.db.prepare("UPDATE oauth_states SET consumed_at=? WHERE state_hash=? AND consumed_at IS NULL").run(now(), stateHash);
    return { codeVerifier: String(row.code_verifier), submissionId: String(row.submission_id) };
  }

  createAuthSession(input: { githubUserId: string; githubLogin: string; accessToken: string; expiresAt: string }): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO auth_sessions (id,github_user_id,github_login,github_access_token,created_at,expires_at) VALUES (?,?,?,?,?,?)")
      .run(id, input.githubUserId, input.githubLogin, input.accessToken, now(), input.expiresAt);
    return id;
  }

  getAuthSession(id: string): { id: string; githubUserId: string; githubLogin: string; accessToken: string } | undefined {
    const row = this.db.prepare("SELECT id,github_user_id,github_login,github_access_token,expires_at FROM auth_sessions WHERE id=?").get(id) as Row | undefined;
    if (!row || String(row.expires_at) <= now()) return undefined;
    return { id: String(row.id), githubUserId: String(row.github_user_id), githubLogin: String(row.github_login), accessToken: String(row.github_access_token) };
  }

  createWalletChallenge(input: {
    nonceHash: string; sessionId: string; submissionId: string; githubUserId: string; repository: string;
    repositoryId: string; pullRequestNumber: number; headSha: string; walletAddress: string; chainId: number;
    message: string; expiresAt: string;
  }): void {
    this.db.prepare(`INSERT INTO wallet_challenges
      (nonce_hash,session_id,submission_id,github_user_id,repository,repository_id,pull_request_number,head_sha,wallet_address,chain_id,message,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.nonceHash, input.sessionId, input.submissionId, input.githubUserId, input.repository,
      input.repositoryId, input.pullRequestNumber, input.headSha, input.walletAddress, input.chainId,
      input.message, now(), input.expiresAt
    );
  }

  consumeWalletChallenge(nonceHash: string): {
    sessionId: string; submissionId: string; githubUserId: string; repository: string; repositoryId: string;
    pullRequestNumber: number; headSha: string; walletAddress: string; chainId: number; message: string;
  } | undefined {
    const row = this.getWalletChallenge(nonceHash);
    if (!row) return undefined;
    const changed = this.db.prepare("UPDATE wallet_challenges SET consumed_at=? WHERE nonce_hash=? AND consumed_at IS NULL").run(now(), nonceHash);
    if (Number(changed.changes) !== 1) return undefined;
    return row;
  }

  getWalletChallenge(nonceHash: string): {
    sessionId: string; submissionId: string; githubUserId: string; repository: string; repositoryId: string;
    pullRequestNumber: number; headSha: string; walletAddress: string; chainId: number; message: string;
  } | undefined {
    const row = this.db.prepare("SELECT * FROM wallet_challenges WHERE nonce_hash=?").get(nonceHash) as Row | undefined;
    if (!row || row.consumed_at !== null || String(row.expires_at) <= now()) return undefined;
    return {
      sessionId: String(row.session_id), submissionId: String(row.submission_id), githubUserId: String(row.github_user_id),
      repository: String(row.repository), repositoryId: String(row.repository_id), pullRequestNumber: Number(row.pull_request_number),
      headSha: String(row.head_sha), walletAddress: String(row.wallet_address), chainId: Number(row.chain_id), message: String(row.message)
    };
  }

  linkWalletIdentity(submissionId: string, githubUserId: string, walletAddress: string, chainId: number): void {
    this.db.prepare(`INSERT INTO identity_links (submission_id,github_user_id,wallet_address,chain_id,created_at)
      VALUES (?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET github_user_id=excluded.github_user_id,
      wallet_address=excluded.wallet_address, chain_id=excluded.chain_id`).run(submissionId, githubUserId, walletAddress, chainId, now());
  }

  getWalletIdentity(submissionId: string): { githubUserId: string; walletAddress: string; chainId: number } | undefined {
    const row = this.db.prepare("SELECT github_user_id,wallet_address,chain_id FROM identity_links WHERE submission_id=?").get(submissionId) as Row | undefined;
    return row ? { githubUserId: String(row.github_user_id), walletAddress: String(row.wallet_address), chainId: Number(row.chain_id) } : undefined;
  }

  quoteForContributor(contributorId: string): string {
    const validRow = this.db.prepare("SELECT COUNT(*) AS count FROM reputation_events WHERE contributor_id=? AND event_type='valid_settled'").get(contributorId) as Row | undefined;
    const slopRow = this.db.prepare("SELECT COUNT(*) AS count FROM reputation_events WHERE contributor_id=? AND event_type='slop_finalized'").get(contributorId) as Row | undefined;
    const valid = Number(validRow?.count ?? 0);
    const slop = Number(slopRow?.count ?? 0);
    return valid > 0 && slop === 0 ? "0" : this.defaultBond;
  }

  attachVerifiedPayment(id: string, input: { payerDid: string; bondId?: string; evidenceType: "onchain_receipt" | "mpp_receipt" | "simulation"; reference: string; idempotencyKey: string }): Submission {
    const submission = this.get(id);
    if (!submission) throw new Error("Submission not found");
    if (submission.requiredAmountBaseUnits === "0") throw new Error("Zero-dollar submissions do not accept payment");
    const existing = this.db.prepare("SELECT response_json FROM idempotency_keys WHERE key=?").get(input.idempotencyKey) as Row | undefined;
    if (existing) return JSON.parse(String(existing.response_json)) as Submission;
    if (submission.moneyStatus !== "awaiting_payment") throw new Error("Submission is not awaiting payment");
    const timestamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE contributors SET payer_did=?, identity_verified_at=?, updated_at=? WHERE id=?").run(input.payerDid, timestamp, timestamp, submission.contributorId);
      this.db.prepare("UPDATE submissions SET money_status='bonded', provider_receipt_id=?, bond_id=?, updated_at=? WHERE id=?").run(input.reference, input.bondId ?? null, timestamp, id);
      this.db.prepare("INSERT INTO settlement_attempts (id,submission_id,operation,idempotency_key,status,evidence_type,reference,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), id, "verify", input.idempotencyKey, "confirmed", input.evidenceType, input.reference, timestamp, timestamp);
      this.audit(id, input.payerDid, "bond_verified", "Payment evidence verified");
      const result = this.get(id)!;
      this.db.prepare("INSERT INTO idempotency_keys (key,operation,response_json,created_at) VALUES (?,?,?,?)").run(input.idempotencyKey, "verify", JSON.stringify(result), timestamp);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  decide(id: string, decision: Decision): Submission {
    const submission = this.get(id);
    if (!submission) throw new Error("Submission not found");
    if (submission.outcome !== "pending") throw new Error("Submission already has an outcome");
    if (submission.moneyStatus !== "bonded" && submission.moneyStatus !== "not_required") throw new Error("Submission must have a verified bond before a decision");
    if (decision.outcome === "slop" && !decision.reason?.trim()) throw new Error("A Slop decision requires a reason");
    const timestamp = now();
    const nextMoney: MoneyStatus = decision.outcome === "valid" ? (submission.moneyStatus === "not_required" ? "refunded" : "refund_pending") :
      decision.outcome === "slop" ? (submission.moneyStatus === "not_required" ? "forfeited" : "forfeiture_pending") : "reclaimable";
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE submissions SET outcome=?, money_status=?, decision_reason=?, reviewer_id=?, updated_at=? WHERE id=? AND outcome='pending'")
        .run(decision.outcome, nextMoney, decision.reason?.trim() ?? null, decision.reviewerId, timestamp, id);
      this.audit(id, decision.reviewerId, `decision_${decision.outcome}`, decision.reason?.trim() ?? null);
      this.db.exec("COMMIT");
      return this.get(id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  settle(id: string, operation: "refund" | "forfeit" | "reclaim", input: { evidenceType: "onchain_receipt" | "mpp_receipt" | "simulation"; reference: string; idempotencyKey: string }): Submission {
    const prior = this.getIdempotent<Submission>(input.idempotencyKey);
    if (prior) return prior;
    const submission = this.get(id);
    if (!submission) throw new Error("Submission not found");
    const expected: Record<string, MoneyStatus[]> = { refund: ["refund_pending"], forfeit: ["forfeiture_pending"], reclaim: ["reclaimable"] };
    if (!expected[operation].includes(submission.moneyStatus)) throw new Error(`Cannot ${operation} submission in ${submission.moneyStatus} state`);
    const next: MoneyStatus = operation === "forfeit" ? "forfeited" : "refunded";
    const timestamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE submissions SET money_status=?, transaction_hash=?, updated_at=? WHERE id=?").run(next, input.reference, timestamp, id);
      this.db.prepare("INSERT INTO settlement_attempts (id,submission_id,operation,idempotency_key,status,evidence_type,reference,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), id, operation, input.idempotencyKey, "confirmed", input.evidenceType, input.reference, timestamp, timestamp);
      const eventType = operation === "forfeit" ? "slop_finalized" : operation === "reclaim" ? "ignored_refund" : "valid_settled";
      if (operation !== "reclaim" || submission.outcome === "ignored") {
        this.db.prepare("INSERT OR IGNORE INTO reputation_events (id,contributor_id,submission_id,event_type,source_event_id,created_at) VALUES (?,?,?,?,?,?)")
          .run(randomUUID(), submission.contributorId, id, eventType, input.reference, timestamp);
      }
      this.audit(id, "settlement", `${operation}_confirmed`, input.reference);
      this.rememberIdempotent(input.idempotencyKey, operation, this.get(id));
      this.db.exec("COMMIT");
      return this.get(id)!;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markIgnoredExpired(id: string): Submission {
    const submission = this.get(id);
    if (!submission) throw new Error("Submission not found");
    if (submission.outcome !== "pending" || submission.moneyStatus !== "bonded") throw new Error("Submission is not eligible for ignored recovery");
    if (Date.parse(submission.reviewDeadlineAt) > Date.now()) throw new Error("Review deadline has not elapsed");
    this.db.prepare("UPDATE submissions SET outcome='ignored', money_status='reclaimable', updated_at=? WHERE id=?").run(now(), id);
    this.audit(id, "system", "ignored_deadline_elapsed", "No maintainer decision before deadline");
    return this.get(id)!;
  }

  private upsertContributor(githubUserId: string, githubLogin: string, payerDid: string | null): string {
    const existing = this.db.prepare("SELECT id FROM contributors WHERE github_user_id=? OR (? IS NOT NULL AND payer_did=?)")
      .get(githubUserId, payerDid, payerDid) as Row | undefined;
    const id = existing ? String(existing.id) : randomUUID();
    const timestamp = now();
    if (existing) {
      this.db.prepare("UPDATE contributors SET github_login=?, payer_did=COALESCE(?,payer_did), updated_at=? WHERE id=?").run(githubLogin, payerDid, timestamp, id);
    } else {
      this.db.prepare("INSERT INTO contributors (id,github_user_id,github_login,payer_did,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id, githubUserId, githubLogin, payerDid, timestamp, timestamp);
    }
    return id;
  }

  private audit(submissionId: string, actorId: string, action: string, reason: string | null): void {
    this.db.prepare("INSERT INTO audit_events (id,submission_id,actor_id,action,reason,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), submissionId, actorId, action, reason, now());
  }
}

export function hashReason(reason: string): string {
  return createHash("sha256").update(reason).digest("hex");
}
