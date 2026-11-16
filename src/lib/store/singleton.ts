/** The store the app uses: accounts and data on this device, the real planner, the real clock. */
import { createAppStore } from './createStore';
import { createStoreHooks } from './hooks';
import { createLocalAuthBackend } from './localAuth';
import { createLocalDataBackend } from './localData';

export const store = createAppStore({
  auth: createLocalAuthBackend(),
  data: createLocalDataBackend(),
});

export const actions = store.actions;

export const {
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
} = createStoreHooks(store);
