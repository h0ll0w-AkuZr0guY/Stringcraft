import { createContext, useContext } from "react";
import type { useWorkbench } from "./useWorkbench";
export const WorkbenchContext = createContext<ReturnType<
  typeof useWorkbench
> | null>(null);
export function useWorkbenchContext() {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error("Workbench provider missing");
  return value;
}
