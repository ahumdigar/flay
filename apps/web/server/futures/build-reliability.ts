import type { FuturesVenue } from '../../shared/futures.js';

export interface VenueBuildReliability {
  attempts: number;
  successes: number;
}

const reliability: Record<FuturesVenue, VenueBuildReliability> = {
  phoenix: { attempts: 0, successes: 0 },
  gmtrade: { attempts: 0, successes: 0 },
};

export async function observeVenueBuild<T>(venue: FuturesVenue, operation: () => Promise<T>): Promise<T> {
  reliability[venue].attempts += 1;
  try {
    const result = await operation();
    reliability[venue].successes += 1;
    return result;
  } catch (error) {
    throw error;
  }
}

export function futuresBuildReliability(): Record<FuturesVenue, VenueBuildReliability> {
  return structuredClone(reliability);
}
