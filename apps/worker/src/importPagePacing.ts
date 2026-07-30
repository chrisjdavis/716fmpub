/**
 * Per-import-job pacing between Last.fm page fetches to limit API and downstream load.
 *
 * After `burstPages` pages complete without an enforced gap, each subsequent page
 * waits `minIntervalMs` before the next iterator pull (the next network request).
 * `minIntervalMs === 0` disables pacing (tests / emergency override).
 */

export type ImportLastfmPagePaceConfig = Readonly<{
  minIntervalMs: number;
  burstPages: number;
}>;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createImportLastfmPagePacer(
  config: ImportLastfmPagePaceConfig,
  sleepMs: (ms: number) => Promise<void> = defaultSleep,
  onPacingWait?: (input: Readonly<{ waitedMs: number; pagesCompleted: number }>) => void,
  initialCompletedPages = 0,
): Readonly<{
  beforeNextPage: () => Promise<void>;
  afterPageCompleted: () => void;
}> {
  let completedPages = initialCompletedPages;
  return {
    async beforeNextPage(): Promise<void> {
      if (config.minIntervalMs <= 0) {
        return;
      }
      if (completedPages >= config.burstPages) {
        onPacingWait?.({
          waitedMs: config.minIntervalMs,
          pagesCompleted: completedPages,
        });
        await sleepMs(config.minIntervalMs);
      }
    },
    afterPageCompleted(): void {
      completedPages += 1;
    },
  };
}
