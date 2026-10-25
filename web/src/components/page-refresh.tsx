import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Notify } from "../types";

type Refresh = () => Promise<unknown>;
const RefreshContext = createContext<Set<Refresh> | null>(null);

export function PageRefreshProvider({ children }: { children: ReactNode }) {
  const handlers = useRef(new Set<Refresh>());
  return <RefreshContext value={handlers.current}>{children}</RefreshContext>;
}

// A manual refresh reads the mounted page's data without resetting its UI state.
export function usePageRefresh(refresh: Refresh) {
  const handlers = useContext(RefreshContext);
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    const read = () => latest.current();
    handlers?.add(read);
    return () => {
      handlers?.delete(read);
    };
  }, [handlers]);
}

export function PageRefreshButton({
  refresh,
  notify,
}: {
  refresh: Refresh;
  notify: Notify;
}) {
  const handlers = useContext(RefreshContext);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        try {
          const results = await Promise.allSettled([
            refresh(),
            ...Array.from(handlers || [], (read) => read()),
          ]);
          const failed = results.find((result) => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
          notify("页面数据已刷新");
        } catch (error) {
          notify(error instanceof Error ? error.message : String(error), true);
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <RefreshCw
        data-icon="inline-start"
        className={busy ? "motion-safe:animate-spin" : undefined}
      />
      {busy ? "刷新中…" : "刷新"}
    </Button>
  );
}
