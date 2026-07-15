// src/state — interaction store and persistence around the pure core.
// The UI consumes AppViewModel/AppHandlers; main.ts creates the store.

export type {
  ActiveSkillView,
  AppHandlers,
  AppViewModel,
  GroupProgressView,
  IntroView,
} from './view';
export type { BestQbf, StorageLike } from './persistence';
export { STORAGE_KEY } from './persistence';
export type { TutorStoreOptions } from './store';
export { TutorStore, createTutorStore } from './store';
