import type { UseCase } from "../types";
import { USE_CASE_LIST } from "./usecases";

/** Use cases (R3-UC), in hub order. */
export const USE_CASES: UseCase[] = [...USE_CASE_LIST].sort((a, b) => a.rank - b.rank);

export function useCase(slug: string): UseCase | undefined {
  return USE_CASES.find((u) => u.slug === slug);
}
