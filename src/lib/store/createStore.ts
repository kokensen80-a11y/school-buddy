/**
 * The application store: state, actions and the wiring between accounts, data,
 * planner and persistence. Framework-free; the React hooks live in hooks.ts.
 *
 * How an action runs:
 *   1. actions run one at a time (a queue), so none of them ever works on stale state;
 *   2. a pure recipe (mutations.ts) turns the current data into the next data;
 *   3. when the action can change the plan, the planner runs once on that next data;
 *   4. the result is saved through the DataBackend;
 *   5. only then the state is replaced and subscribers are told, exactly once
 *      (and not at all when the action turned out to change nothing).
 * When saving fails, the state stays as it was and the action returns a friendly
 * error, so what is on screen is always what is in storage.
 */
import type { Account, AttachmentMeta, ID, UserData } from '../../types';
import { minutesOfDay, toISODate } from '../date';
import { createEmptyUserData } from '../defaults';
import { generatePlan } from '../planner';
import { parseBackup, serializeBackup } from './backup';
import { newId } from './ids';
import { MAX_ATTACHMENT_BYTES, MIN_PASSWORD_LENGTH } from './limits';
import { MESSAGES, describeError, fail } from './messages';
import * as mutations from './mutations';
import type { Recipe } from './mutations';
import { cleanText, sanitizeUserData } from './sanitize';
import { reuseEqual } from './structural';
import type {
  Actions,
  AppState,
  AppStore,
  Failure,
  Result,
  StoreDependencies,
  Success,
} from './types';

const LOADING: AppState = { status: 'loading', account: null, data: null };
const SIGNED_OUT: AppState = { status: 'signedOut', account: null, data: null };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FALLBACK_MIME = 'application/octet-stream';
const FALLBACK_FILE_NAME = 'Bijlage';

/** Whether an action re-runs the planner after its change. */
const REPLAN = true;
const KEEP_PLAN = false;

const ok = (): Success => ({ ok: true });

/**
 * Surfaces the error of a subscriber the way an uncaught error is surfaced, without
 * letting it break the action that is being finished or the other subscribers.
 */
function reportSubscriberError(error: unknown): void {
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(error);
  } else {
    setTimeout(() => {
      throw error;
    });
  }
}

const attachmentIdsOf = (data: UserData): ID[] =>
  data.exams.flatMap((exam) => exam.attachments.map((attachment) => attachment.id));

function fileNameOf(file: Blob, name: string | undefined): string {
  const ownName = 'name' in file ? file.name : undefined;
  return cleanText(name) ?? cleanText(ownName) ?? FALLBACK_FILE_NAME;
}

export function createAppStore({
  auth,
  data: backend,
  planner = generatePlan,
  clock = () => new Date(),
}: StoreDependencies): AppStore {
  let state = LOADING;
  const listeners = new Set<() => void>();

  const publish = (next: AppState): void => {
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        reportSubscriberError(error);
      }
    }
  };

  const timestamp = () => clock().toISOString();

  // ───────────── The queue ─────────────

  let queue: Promise<unknown> = Promise.resolve();

  /** Runs `task` after everything that was started earlier; anything it throws becomes a failure result. */
  const run = <T extends object>(task: () => Promise<Result<T>>): Promise<Result<T>> => {
    const result = queue
      .then(task)
      .catch((error: unknown): Failure => fail(describeError(error)));
    queue = result;
    return result;
  };

  // ───────────── Planning and saving (only called from inside a task) ─────────────

  /**
   * The planner gets a copy of the data: the objects in the state are also held by
   * subscribers, so a planner that sorts or edits its input in place may not reach them.
   */
  const plan = (data: UserData): UserData => {
    const now = clock();
    const result = planner({
      today: toISODate(now),
      nowMinutes: minutesOfDay(now),
      ...structuredClone({
        exams: data.exams,
        prefs: data.prefs,
        previous: data.sessions,
        blockedDates: data.blockedDates,
      }),
    });
    return { ...data, sessions: result.sessions, warnings: result.warnings };
  };

  const apply = async <T extends object>(
    replan: boolean,
    recipe: Recipe<T>,
  ): Promise<Result<T>> => {
    const { account, data } = state;
    if (!account || !data) return fail(MESSAGES.notSignedIn);
    const step = recipe(data, { now: timestamp(), newId });
    if (!step.ok) return step;
    // Whatever did not change keeps its identity; when nothing changed at all, nothing happens.
    const next = reuseEqual(data, replan ? plan(step.data) : step.data);
    if (next !== data) {
      await backend.save(account.id, next);
      publish({ status: 'signedIn', account, data: next });
    }
    return { ok: true, ...step.extra };
  };

  const mutate = <T extends object>(replan: boolean, recipe: Recipe<T>): Promise<Result<T>> =>
    run(() => apply(replan, recipe));

  /**
   * Makes `account` the signed-in account. Saving is best effort here: an account
   * without a stored document loads as empty data and the plan is rebuilt at every
   * start, so nothing is lost when it fails. The next real change reports the problem.
   */
  const enter = async (account: Account, data: UserData): Promise<void> => {
    await backend.save(account.id, data).catch(() => undefined);
    publish({ status: 'signedIn', account, data });
  };

  /**
   * Re-planning is best effort here too: a planner that fails must not lock anybody
   * out of their data, so the plan then stays as it was stored. Every action that
   * needs the planner still reports the problem.
   */
  const signIn = async (account: Account): Promise<void> => {
    const stored = sanitizeUserData(await backend.load(account.id), timestamp());
    let planned = stored;
    try {
      planned = plan(stored);
    } catch {
      // Keep the stored plan.
    }
    await enter(account, planned);
  };

  /** Best effort: a file that cannot be deleted now disappears with the account at the latest. */
  const discardFiles = async (accountId: ID, attachmentIds: ID[]): Promise<void> => {
    await Promise.all(
      attachmentIds.map((id) => backend.deleteAttachment(accountId, id).catch(() => undefined)),
    );
  };

  // ───────────── Changes made elsewhere (another tab) ─────────────

  /** Adopts what the backends hold now, without saving or re-planning. */
  const syncWithBackends = (): void => {
    void run(async () => {
      if (state.status === 'loading') return ok();
      const account = await auth.restore();
      if (!account) {
        if (state.status !== 'signedOut') publish(SIGNED_OUT);
        return ok();
      }
      const data = sanitizeUserData(await backend.load(account.id), timestamp());
      const next = {
        account: reuseEqual(state.account ?? account, account),
        data: reuseEqual(state.data ?? data, data),
      };
      if (next.account !== state.account || next.data !== state.data) {
        publish({ status: 'signedIn', ...next });
      }
      return ok();
    });
  };

  const stopListening = [auth.subscribe?.(syncWithBackends), backend.subscribe?.(syncWithBackends)];

  // ───────────── Actions ─────────────

  let initialised: Promise<Result> | undefined;

  const actions: Actions = {
    init: () =>
      (initialised ??= run(async () => {
        try {
          const account = await auth.restore();
          if (account) await signIn(account);
          else publish(SIGNED_OUT);
          return ok();
        } catch (error) {
          // Never leave the app on its loading screen.
          publish(SIGNED_OUT);
          return fail(describeError(error));
        }
      })),

    register: (input) =>
      run(async () => {
        const name = input.name.trim();
        const email = input.email.trim();
        if (!name) return fail(MESSAGES.nameRequired);
        if (!EMAIL_PATTERN.test(email)) return fail(MESSAGES.emailInvalid);
        if (input.password.length < MIN_PASSWORD_LENGTH) return fail(MESSAGES.passwordTooShort);
        const account = await auth.register({ name, email, password: input.password });
        await enter(account, createEmptyUserData());
        return { ok: true, account };
      }),

    login: (input) =>
      run(async () => {
        const account = await auth.login({ email: input.email.trim(), password: input.password });
        await signIn(account);
        return { ok: true, account };
      }),

    logout: () =>
      run(async () => {
        await auth.logout();
        if (state.status !== 'signedOut') publish(SIGNED_OUT);
        return ok();
      }),

    updateAccount: (patch) =>
      run(async () => {
        const { account, data } = state;
        if (!account || !data) return fail(MESSAGES.notSignedIn);
        const name = patch.name?.trim();
        const email = patch.email?.trim();
        if (name === '') return fail(MESSAGES.nameRequired);
        if (email !== undefined && !EMAIL_PATTERN.test(email)) {
          return fail(MESSAGES.emailInvalid);
        }
        const updated = reuseEqual(account, await auth.updateAccount(account.id, { name, email }));
        if (updated !== account) publish({ status: 'signedIn', account: updated, data });
        return { ok: true, account: updated };
      }),

    changePassword: ({ current, next }) =>
      run(async () => {
        const { account } = state;
        if (!account) return fail(MESSAGES.notSignedIn);
        if (next.length < MIN_PASSWORD_LENGTH) return fail(MESSAGES.passwordTooShort);
        await auth.changePassword(account.id, current, next);
        return ok();
      }),

    deleteAccount: ({ password }) =>
      run(async () => {
        const { account } = state;
        if (!account) return fail(MESSAGES.notSignedIn);
        await auth.deleteAccount(account.id, password);
        const removed = await backend.remove(account.id).then(
          () => true,
          () => false,
        );
        publish(SIGNED_OUT);
        return removed ? ok() : fail(MESSAGES.accountDataLeftBehind);
      }),

    updatePrefs: (patch) => mutate(REPLAN, mutations.updatePrefs(patch)),
    completeOnboarding: () => mutate(KEEP_PLAN, mutations.completeOnboarding()),

    addSubject: (input) => mutate(KEEP_PLAN, mutations.addSubject(input)),
    updateSubject: (id, patch) => mutate(KEEP_PLAN, mutations.updateSubject(id, patch)),
    deleteSubject: (id) => mutate(KEEP_PLAN, mutations.deleteSubject(id)),

    addExam: (draft) => mutate(REPLAN, mutations.addExam(draft)),
    updateExam: (id, patch) => mutate(REPLAN, mutations.updateExam(id, patch)),
    deleteExam: (id) =>
      run(async () => {
        const accountId = state.account?.id;
        const exam = state.data?.exams.find((candidate) => candidate.id === id);
        const result = await apply(REPLAN, mutations.deleteExam(id));
        if (result.ok && accountId && exam) {
          await discardFiles(
            accountId,
            exam.attachments.map((attachment) => attachment.id),
          );
        }
        return result;
      }),
    setGrade: (id, grade) => mutate(REPLAN, mutations.setGrade(id, grade)),

    addTopics: (examId, drafts) => mutate(REPLAN, mutations.addTopics(examId, drafts)),
    updateTopic: (examId, topicId, patch) =>
      mutate(REPLAN, mutations.updateTopic(examId, topicId, patch)),
    deleteTopic: (examId, topicId) => mutate(REPLAN, mutations.deleteTopic(examId, topicId)),
    moveTopic: (examId, topicId, toIndex) =>
      mutate(REPLAN, mutations.moveTopic(examId, topicId, toIndex)),

    addAttachment: (examId, file, name) =>
      run(async () => {
        const { account, data } = state;
        if (!account || !data) return fail(MESSAGES.notSignedIn);
        if (!data.exams.some((exam) => exam.id === examId)) return fail(MESSAGES.examNotFound);
        if (file.size > MAX_ATTACHMENT_BYTES) return fail(MESSAGES.attachmentTooLarge);
        const attachment: AttachmentMeta = {
          id: newId(),
          name: fileNameOf(file, name),
          mime: file.type || FALLBACK_MIME,
          size: file.size,
          addedAt: timestamp(),
        };
        // File first, metadata second: the data never points to a file that is not there.
        await backend.putAttachment(account.id, attachment.id, file);
        const result = await apply(KEEP_PLAN, mutations.addAttachment(examId, attachment)).catch(
          (error: unknown): Failure => fail(describeError(error)),
        );
        if (!result.ok) await discardFiles(account.id, [attachment.id]);
        return result;
      }),

    removeAttachment: (examId, attachmentId) =>
      run(async () => {
        const result = await apply(KEEP_PLAN, mutations.removeAttachment(examId, attachmentId));
        const { account, data } = state;
        // The file only goes when no exam points to it any more: `examId` may have been
        // the wrong exam, and then the attachment is still there.
        if (result.ok && account && data && !attachmentIdsOf(data).includes(attachmentId)) {
          await discardFiles(account.id, [attachmentId]);
        }
        return result;
      }),

    getAttachmentBlob: async (attachmentId) => {
      const { account } = state;
      if (!account) return undefined;
      return backend.getAttachment(account.id, attachmentId).catch(() => undefined);
    },

    completeSession: (id) => mutate(REPLAN, mutations.completeSession(id)),
    reopenSession: (id) => mutate(REPLAN, mutations.reopenSession(id)),
    skipSession: (id) => mutate(REPLAN, mutations.skipSession(id)),
    moveSession: (id, to) => mutate(REPLAN, mutations.moveSession(id, to)),
    unpinSession: (id) => mutate(REPLAN, mutations.unpinSession(id)),

    toggleBlockedDate: (date) => mutate(REPLAN, mutations.toggleBlockedDate(date)),
    replan: () => mutate(REPLAN, mutations.keepData()),

    addInboxItems: (items) => mutate(KEEP_PLAN, mutations.addInboxItems(items)),
    markInboxRead: (id) => mutate(KEEP_PLAN, mutations.markInboxRead(id)),
    clearInbox: () => mutate(KEEP_PLAN, mutations.clearInbox()),

    exportData: () => {
      const { account, data } = state;
      if (!account || !data) {
        throw new Error('exportData() needs a signed-in account.');
      }
      return serializeBackup(account.name, data, timestamp());
    },

    importData: (json) =>
      run(async () => {
        const { account, data } = state;
        if (!account || !data) return fail(MESSAGES.notSignedIn);
        const backup = parseBackup(json, timestamp());
        if (!backup.ok) return backup;
        // A backup holds no files. An attachment survives the import only when its
        // file is on this device already, which is the case exactly for the current ones.
        const current = new Map(
          data.exams.flatMap((exam) => exam.attachments).map((meta) => [meta.id, meta]),
        );
        const kept = new Set<ID>();
        const exams = backup.data.exams.map((exam) => ({
          ...exam,
          attachments: exam.attachments.flatMap(({ id }) => {
            const meta = current.get(id);
            if (!meta || kept.has(id)) return [];
            kept.add(id);
            return [meta];
          }),
        }));
        const result = await apply(REPLAN, mutations.replaceData({ ...backup.data, exams }));
        if (result.ok) {
          await discardFiles(
            account.id,
            attachmentIdsOf(data).filter((id) => !kept.has(id)),
          );
        }
        return result;
      }),
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    actions,
    dispose: () => {
      for (const stop of stopListening) stop?.();
    },
  };
}
