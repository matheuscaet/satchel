import type { ComponentProps, ReactNode } from "react";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/common/Kbd";
import { cn } from "@/lib/utils";

/**
 * The mockup's `.menu` look on top of shadcn's DropdownMenu:
 * bg1 surface, pop shadow, 28px items with a bg3 highlight.
 */

export function MenuContent({ className, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      className={cn("min-w-[200px] rounded-lg border-0 bg-bg1 p-1 text-[13px] text-fg shadow-pop", className)}
      {...props}
    />
  );
}

interface MenuItemProps extends ComponentProps<typeof DropdownMenuItem> {
  /** Right-aligned hint (fg3, 11.5px) */
  sub?: ReactNode;
  /** Right-aligned shortcut */
  kbd?: string;
  danger?: boolean;
}

export function MenuItem({ className, children, sub, kbd, danger, ...props }: MenuItemProps) {
  return (
    <DropdownMenuItem
      className={cn(
        "h-7 gap-2 rounded-[5px] px-2 py-0 text-[13px] whitespace-nowrap text-fg2 focus:bg-bg3 focus:text-fg [&_svg:not([class*='text-'])]:text-current",
        danger && "focus:text-err",
        className,
      )}
      {...props}
    >
      {children}
      {(sub || kbd) && <span className="min-w-3 flex-1" />}
      {sub && <span className="text-[11.5px] text-fg3">{sub}</span>}
      {kbd && <Kbd>{kbd}</Kbd>}
    </DropdownMenuItem>
  );
}

export function MenuHead({ className, ...props }: ComponentProps<typeof DropdownMenuLabel>) {
  return <DropdownMenuLabel className={cn("px-2 pt-1.5 pb-1 text-[11px] font-normal text-fg3", className)} {...props} />;
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuSeparator>) {
  return <DropdownMenuSeparator className={cn("mx-0.5 my-1 bg-line", className)} {...props} />;
}

export const MenuSub = DropdownMenuSub;

export function MenuSubTrigger({ className, ...props }: ComponentProps<typeof DropdownMenuSubTrigger>) {
  return (
    <DropdownMenuSubTrigger
      className={cn(
        "h-7 gap-2 rounded-[5px] px-2 py-0 text-[13px] whitespace-nowrap text-fg2 focus:bg-bg3 focus:text-fg data-[state=open]:bg-bg3 data-[state=open]:text-fg [&_svg]:size-3.5 [&_svg:not([class*='text-'])]:text-current",
        className,
      )}
      {...props}
    />
  );
}

export function MenuSubContent({ className, ...props }: ComponentProps<typeof DropdownMenuSubContent>) {
  return (
    <DropdownMenuSubContent className={cn("min-w-[220px] rounded-lg border-0 bg-bg1 p-1 text-[13px] text-fg shadow-pop", className)} {...props} />
  );
}
