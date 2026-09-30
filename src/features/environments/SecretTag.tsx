import { cn } from "@/lib/utils";

/** The small "secret" tag after a variable name (mockup `.mx .sec`). */
export function SecretTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ml-1.5 inline-block rounded-[3px] border border-line2 px-1 align-middle font-sans text-[10.5px] leading-[15px] font-normal text-fg3",
        className,
      )}
    >
      secret
    </span>
  );
}
