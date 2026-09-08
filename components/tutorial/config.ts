export const TUTORIAL_VERSION = "v2";

export const QUICK_START_SLIDE_IDS = ['first-plant', 'first-care', 'next-step'] as const;

export const TUTORIAL_SLIDE_IDS = [
  "swap",
  "mint",
  "tod-pts",
  "items",
  "mint-land",
  "buildings",
  "stake",
  "help",
  "tasks",
  "finish",
] as const;

export const TASKS_TUTORIAL_SLIDE_ID = "tasks" as const;

export type TutorialSlideId = (typeof TUTORIAL_SLIDE_IDS)[number] | (typeof QUICK_START_SLIDE_IDS)[number];
