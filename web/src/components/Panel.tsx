import type { ReactNode } from "react";

/** One bordered surface holding several sections, rather than a separate
 *  floating card per thing on the page. */
export function Surface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-[3px] border border-rule bg-card ${className}`}>
      {children}
    </section>
  );
}

/** Section heading inside a surface. `divided` draws the rule that separates
 *  it from the section above. */
export function SectionHead({
  title, aside, divided = false,
}: {
  title: string;
  aside?: ReactNode;
  divided?: boolean;
}) {
  return (
    <header
      className={`flex h-11 shrink-0 items-center justify-between gap-3 border-b border-rule px-4
                  ${divided ? "border-t" : ""}`}
    >
      <h2 className="text-[13px] font-semibold tracking-[-0.005em]">{title}</h2>
      {aside}
    </header>
  );
}
