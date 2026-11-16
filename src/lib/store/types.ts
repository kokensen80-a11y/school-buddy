/**
 * Public types of the store: the state, action results, action inputs and the two
 * backend interfaces behind which all persistence lives.
 */
import type {
  Account,
  AttachmentMeta,
  Exam,
  ID,
  InboxItem,
  ISODate,
  NotificationPrefs,
  PlanInput,
  PlanResult,
  Preferences,
  Subject,
  SubjectColor,
  TimeOfDay,
  Topic,
  UserData,
} from '../../types';

// ───────────────────────── State ─────────────────────────

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/** `account` and `data` are both set when `status` is 'signedIn', and both null otherwise. */
export interface AppState {
  status: AuthStatus;
  account: Account | null;
  data: UserData | null;
}

// ───────────────────────── Results ─────────────────────────

/** `error` is a friendly Dutch sentence that can be shown to the user as it is. */
export type Failure = { ok: false; error: string };
export type Success<T extends object = object> = { ok: true } & T;
export type Result<T extends object = object> = Success<T> | Failure;

// ───────────────────────── Action inputs ─────────────────────────

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AccountPatch {
  name?: string;
  email?: string;
}

/** A partial update of the preferences; `notifications` is merged field by field. */
export type PrefsPatch = Partial<Omit<Preferences, 'notifications'>> & {
  notifications?: Partial<NotificationPrefs>;
};

export interface SubjectInput {
  name: string;
  color: SubjectColor;
}

export type SubjectPatch = Partial<SubjectInput>;

export type TopicDraft = Omit<Topic, 'id'>;

export type TopicPatch = Partial<TopicDraft>;

export type ExamDraft = Omit<Exam, 'id' | 'createdAt' | 'updatedAt' | 'attachments' | 'topics'> & {
  topics: TopicDraft[];
};

/**
 * A partial update of an exam. A key that is present with the value `undefined`
 * (or an empty string) clears that optional field. When `topics` is given it
 * replaces the whole list: entries with the id of an existing topic keep that id,
 * all other entries become new topics.
 */
export type ExamPatch = Partial<Omit<ExamDraft, 'topics'>> & {
  topics?: Array<TopicDraft & { id?: ID }>;
};

// ───────────────────────── Actions ─────────────────────────

export interface Actions {
  /** Restores the session at app start. Safe to call more than once: later calls return the first result. */
  init(): Promise<Result>;
  register(input: RegisterInput): Promise<Result<{ account: Account }>>;
  login(input: LoginInput): Promise<Result<{ account: Account }>>;
  logout(): Promise<Result>;
  updateAccount(patch: AccountPatch): Promise<Result<{ account: Account }>>;
  changePassword(input: { current: string; next: string }): Promise<Result>;
  deleteAccount(input: { password: string }): Promise<Result>;

  updatePrefs(patch: PrefsPatch): Promise<Result>;
  completeOnboarding(): Promise<Result>;

  /** Returns the existing subject when one with the same name (ignoring case) already exists. */
  addSubject(input: SubjectInput): Promise<Result<{ subject: Subject }>>;
  updateSubject(id: ID, patch: SubjectPatch): Promise<Result<{ subject: Subject }>>;
  deleteSubject(id: ID): Promise<Result>;

  addExam(draft: ExamDraft): Promise<Result<{ exam: Exam }>>;
  updateExam(id: ID, patch: ExamPatch): Promise<Result<{ exam: Exam }>>;
  deleteExam(id: ID): Promise<Result>;
  setGrade(id: ID, grade: number | undefined): Promise<Result<{ exam: Exam }>>;

  addTopics(examId: ID, drafts: TopicDraft[]): Promise<Result<{ topics: Topic[] }>>;
  updateTopic(examId: ID, topicId: ID, patch: TopicPatch): Promise<Result<{ topic: Topic }>>;
  deleteTopic(examId: ID, topicId: ID): Promise<Result>;
  moveTopic(examId: ID, topicId: ID, toIndex: number): Promise<Result>;

  /** `name` is only needed for a plain Blob; a File brings its own name. */
  addAttachment(
    examId: ID,
    file: Blob,
    name?: string,
  ): Promise<Result<{ attachment: AttachmentMeta }>>;
  removeAttachment(examId: ID, attachmentId: ID): Promise<Result>;
  /** The stored file, or undefined when it does not exist (any more) for the signed-in account. */
  getAttachmentBlob(attachmentId: ID): Promise<Blob | undefined>;

  completeSession(id: ID): Promise<Result>;
  reopenSession(id: ID): Promise<Result>;
  skipSession(id: ID): Promise<Result>;
  moveSession(id: ID, to: { date: ISODate; start: TimeOfDay }): Promise<Result>;
  unpinSession(id: ID): Promise<Result>;

  /** `blocked` tells whether the date is blocked after the toggle. */
  toggleBlockedDate(date: ISODate): Promise<Result<{ blocked: boolean }>>;
  replan(): Promise<Result>;

  addInboxItems(items: InboxItem[]): Promise<Result>;
  markInboxRead(id: string | 'all'): Promise<Result>;
  clearInbox(): Promise<Result>;

  /** Pretty-printed backup of the signed-in account. Throws when nobody is signed in. */
  exportData(): string;
  importData(json: string): Promise<Result>;
}

// ───────────────────────── Store ─────────────────────────

export type Planner = (input: PlanInput) => PlanResult;

export interface AppStore {
  getState(): AppState;
  /** Calls `listener` after every state change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  actions: Actions;
  /** Stops listening to the backends (other tabs). Only needed for stores that are thrown away. */
  dispose(): void;
}

export interface StoreDependencies {
  auth: AuthBackend;
  data: DataBackend;
  /** Defaults to `generatePlan` from src/lib/planner.ts. */
  planner?: Planner;
  /** Defaults to `() => new Date()`. */
  clock?: () => Date;
}

// ───────────────────────── Backends ─────────────────────────

export type BackendErrorCode =
  | 'email-taken'
  | 'invalid-credentials'
  | 'wrong-password'
  | 'account-not-found'
  | 'storage-full'
  | 'storage-unavailable'
  | 'crypto-unavailable';

/** The one error type backends throw for failures the user can do something about. */
export class BackendError extends Error {
  readonly code: BackendErrorCode;

  constructor(code: BackendErrorCode) {
    super(code);
    this.name = 'BackendError';
    this.code = code;
  }
}

/**
 * Accounts and the current session. Methods reject with a BackendError for expected
 * failures. The store validates the input (name, e-mail format, password length)
 * before calling; the backend guards what only it can know (unique e-mail, passwords).
 */
export interface AuthBackend {
  /** Creates the account and signs it in. Rejects with 'email-taken'. */
  register(input: RegisterInput): Promise<Account>;
  /** Rejects with 'invalid-credentials'. */
  login(input: LoginInput): Promise<Account>;
  logout(): Promise<void>;
  /** The account of the current session, or null when nobody is signed in. */
  restore(): Promise<Account | null>;
  /** Rejects with 'email-taken' or 'account-not-found'. */
  updateAccount(accountId: ID, patch: AccountPatch): Promise<Account>;
  /** Rejects with 'wrong-password' or 'account-not-found'. */
  changePassword(accountId: ID, current: string, next: string): Promise<void>;
  /** Removes the account and ends its session. Rejects with 'wrong-password' or 'account-not-found'. */
  deleteAccount(accountId: ID, password: string): Promise<void>;
  /** Optional: calls `listener` when accounts or the session changed outside this store (another tab). */
  subscribe?(listener: () => void): () => void;
}

/**
 * One account's data and attachment files. Methods reject with a BackendError
 * ('storage-full', 'storage-unavailable') when saving is not possible.
 */
export interface DataBackend {
  /**
   * The stored document exactly as it was found, or null when there is none.
   * The store runs it through `sanitizeUserData`, so it may be old or damaged.
   */
  load(accountId: ID): Promise<unknown>;
  save(accountId: ID, data: UserData): Promise<void>;
  /** Removes everything stored for the account: its data and all its attachment files. */
  remove(accountId: ID): Promise<void>;
  putAttachment(accountId: ID, attachmentId: ID, blob: Blob): Promise<void>;
  /** Undefined when the file does not exist or belongs to another account. */
  getAttachment(accountId: ID, attachmentId: ID): Promise<Blob | undefined>;
  deleteAttachment(accountId: ID, attachmentId: ID): Promise<void>;
  /** Optional: calls `listener` when stored data changed outside this store (another tab). */
  subscribe?(listener: () => void): () => void;
}
