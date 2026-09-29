import { driver, type Driver, type DriveStep } from "driver.js";
import { getActiveLocale, t } from "../../shared/i18n";

/** Bump when step list / copy changes meaningfully so prior completions re-show once. */
export const TOUR_VERSION = 3;
export const TOUR_STORAGE_KEY = "onboardingTour";

export type TourTab = "events" | "request" | "conversation" | "timeline";

export type TourStepId =
  "streams" | "import" | "events" | "request" | "conversation" | "timeline" | "more-help";

export type TourStepDef = {
  id: TourStepId;
  /** CSS selector for the highlight target. */
  selector: string;
  titleKey: string;
  bodyKey: string;
  /** Optional tab to activate before measuring the target. */
  activateTab?: TourTab;
  /** Open the More menu before highlighting (menu items start hidden). */
  openMoreMenu?: boolean;
};

export const TOUR_STEPS: TourStepDef[] = [
  {
    id: "streams",
    selector: '[data-tour="streams"]',
    titleKey: "tourStep1Title",
    bodyKey: "tourStep1Body",
  },
  {
    id: "import",
    selector: '[data-tour="import"]',
    titleKey: "tourStep2Title",
    bodyKey: "tourStep2Body",
  },
  {
    id: "events",
    selector: '[data-tour="tab-events"]',
    titleKey: "tourStep3Title",
    bodyKey: "tourStep3Body",
    activateTab: "events",
  },
  {
    id: "request",
    selector: '[data-tour="tab-request"]',
    titleKey: "tourStep4Title",
    bodyKey: "tourStep4Body",
    activateTab: "request",
  },
  {
    id: "conversation",
    selector: '[data-tour="tab-conversation"]',
    titleKey: "tourStep5Title",
    bodyKey: "tourStep5Body",
    activateTab: "conversation",
  },
  {
    id: "timeline",
    selector: '[data-tour="tab-timeline"]',
    titleKey: "tourStep6Title",
    bodyKey: "tourStep6Body",
    activateTab: "timeline",
  },
  {
    id: "more-help",
    selector: '[data-tour="more-help"]',
    titleKey: "tourStep7Title",
    bodyKey: "tourStep7Body",
    openMoreMenu: true,
  },
];

type TourStorageValue = {
  completedVersion?: number;
};

export async function hasCompletedTour(version = TOUR_VERSION): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get(TOUR_STORAGE_KEY);
    const value = data[TOUR_STORAGE_KEY] as TourStorageValue | undefined;
    return value?.completedVersion === version;
  } catch {
    return false;
  }
}

export async function markTourCompleted(version = TOUR_VERSION): Promise<void> {
  try {
    await chrome.storage.local.set({
      [TOUR_STORAGE_KEY]: { completedVersion: version } satisfies TourStorageValue,
    });
  } catch {
    // ignore storage failures in restricted contexts
  }
}

export type OnboardingTourHooks = {
  activateTab: (tab: TourTab) => void;
  openMoreMenu: () => void;
  closeMenus: () => void;
  onFinished?: () => void;
};

let activeDriver: Driver | null = null;
let hooks: OnboardingTourHooks | null = null;
let persistOnDestroy = true;

function progressText(): string {
  // driver.js replaces {{current}} / {{total}} itself.
  return getActiveLocale() === "zh_CN"
    ? "第 {{current}} / {{total}} 步"
    : "Step {{current}} of {{total}}";
}

function buildSteps(): DriveStep[] {
  return TOUR_STEPS.map((step, index) => ({
    element: step.selector,
    disableActiveInteraction: true,
    data: {
      activateTab: step.activateTab,
      openMoreMenu: step.openMoreMenu === true,
    },
    popover: {
      title: t(step.titleKey),
      description: t(step.bodyKey),
      side: index === 0 ? "right" : index === TOUR_STEPS.length - 1 ? "left" : "bottom",
      align: "start",
      showButtons: ["next", "close"],
      nextBtnText: t("tourNext"),
      doneBtnText: t("tourFinish"),
      progressText: progressText(),
    },
  }));
}

function createTourDriver(): Driver {
  return driver({
    animate: true,
    allowClose: true,
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 10,
    popoverOffset: 12,
    popoverClass: "sse-tour-popover",
    showProgress: true,
    disableActiveInteraction: true,
    progressText: progressText(),
    nextBtnText: t("tourNext"),
    doneBtnText: t("tourFinish"),
    showButtons: ["next", "close"],
    steps: buildSteps(),
    onHighlightStarted: (_element, step) => {
      const openMore = step.data?.openMoreMenu === true;
      if (openMore) {
        hooks?.openMoreMenu();
      } else {
        hooks?.closeMenus();
      }
      const tab = step.data?.activateTab as TourTab | undefined;
      if (tab) hooks?.activateTab(tab);
    },
    onDoneClick: (_element, _step, { driver: instance }) => {
      instance.destroy();
    },
    onCloseClick: (_element, _step, { driver: instance }) => {
      instance.destroy();
    },
    onDestroyed: () => {
      const shouldPersist = persistOnDestroy;
      persistOnDestroy = true;
      activeDriver = null;
      hooks?.closeMenus();
      if (shouldPersist) {
        void markTourCompleted();
      }
      hooks?.onFinished?.();
    },
  });
}

export function isTourActive(): boolean {
  return Boolean(activeDriver?.isActive());
}

export function startOnboardingTour(nextHooks: OnboardingTourHooks, stepIndex = 0): void {
  hooks = nextHooks;
  if (activeDriver?.isActive()) {
    persistOnDestroy = false;
    activeDriver.destroy();
  }
  persistOnDestroy = true;
  activeDriver = createTourDriver();
  activeDriver.drive(stepIndex);
}

export async function maybeStartOnboardingTour(nextHooks: OnboardingTourHooks): Promise<void> {
  if (await hasCompletedTour()) return;
  startOnboardingTour(nextHooks);
}

/** Rebuild popover copy when UI language changes mid-tour. */
export function refreshTourI18n(): void {
  if (!activeDriver?.isActive() || !hooks) return;
  const index = activeDriver.getActiveIndex() ?? 0;
  persistOnDestroy = false;
  activeDriver.destroy();
  startOnboardingTour(hooks, index);
}
