/**
 * School Buddy store — public API.
 *
 * Screens use the hooks and `actions` of the default store. Everything else is for
 * tests and for a future cloud backend: build a store with `createAppStore` from an
 * AuthBackend and a DataBackend of your own.
 */
export {
  store,
  actions,
  useAppState,
  useAuthStatus,
  useAccount,
  useData,
  useExams,
  useSessions,
  useSubjects,
  usePrefs,
  useWarnings,
  useInbox,
} from './singleton';

export { createAppStore } from './createStore';
export { createStoreHooks, type StoreHooks } from './hooks';
export { createLocalAuthBackend, type LocalAuthOptions } from './localAuth';
export { createLocalDataBackend } from './localData';
export { sanitizeUserData } from './sanitize';
export { BACKUP_FORMAT, type BackupFile } from './backup';
export { DEFAULT_PBKDF2_ITERATIONS } from './password';
export {
  MAX_ATTACHMENT_BYTES,
  MAX_EXAM_WEIGHT,
  MAX_INBOX_ITEMS,
  MAX_TOPIC_MINUTES,
  MIN_PASSWORD_LENGTH,
} from './limits';
export { BackendError } from './types';
export type {
  AccountPatch,
  Actions,
  AppState,
  AppStore,
  AuthBackend,
  AuthStatus,
  BackendErrorCode,
  DataBackend,
  ExamDraft,
  ExamPatch,
  Failure,
  LoginInput,
  Planner,
  PrefsPatch,
  RegisterInput,
  Result,
  StoreDependencies,
  SubjectInput,
  SubjectPatch,
  Success,
  TopicDraft,
  TopicPatch,
} from './types';
