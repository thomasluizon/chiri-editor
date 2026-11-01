import { Workspace, type DemoState } from "@/components/Workspace";

/**
 * Design mock: seeded doc and fake suggestions, no AI yet.
 * `?state=ask` and `?state=thinking` show those states for screenshots.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const demo: DemoState = state === "ask" || state === "thinking" ? state : "default";
  return <Workspace key={demo} demo={demo} />;
}
