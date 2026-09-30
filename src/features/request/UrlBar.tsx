import type { ClipboardEvent, Ref } from "react";
import type { HttpMethod } from "@/types";
import type { VariableContext } from "@/variables";
import { SquareTerminal } from "lucide-react";
import { Kbd, MOD } from "@/components/common/Kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { VariableInput } from "@/features/variables/VariableInput";
import { MethodMenu } from "./MethodMenu";

interface UrlBarProps {
  method: HttpMethod;
  url: string;
  context: VariableContext;
  sending: boolean;
  onMethodChange: (method: HttpMethod) => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
  onCancel: () => void;
  /** Return true when the pasted text was taken (e.g. a curl command) */
  onPasteText: (text: string) => boolean;
  /** Copy the request as a curl command; resolve=false keeps {{variables}} as written */
  onCopyCurl?: (resolve: boolean) => void;
  inputRef?: Ref<HTMLInputElement>;
}

/** Method | URL | Send, in one 36px bordered bar. */
export function UrlBar({ method, url, context, sending, onMethodChange, onUrlChange, onSend, onCancel, onPasteText, onCopyCurl, inputRef }: UrlBarProps) {
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (onPasteText(e.clipboardData.getData("text"))) e.preventDefault();
  };

  return (
    <div className="flex h-9 items-stretch rounded-md border border-line2 bg-bg0 transition-colors duration-150 focus-within:border-brass-line">
      <MethodMenu method={method} onChange={onMethodChange} />
      <div className="min-w-0 flex-1">
        <VariableInput
          value={url}
          onChange={onUrlChange}
          context={context}
          kind="url"
          variant="url"
          placeholder="Enter a URL or paste a cURL"
          inputRef={inputRef}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              onSend();
            }
          }}
          aria-label="URL"
        />
      </div>
      {onCopyCurl && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Copy as cURL"
              onClick={(e) => onCopyCurl(!e.shiftKey)}
              className="my-[3px] grid w-7 flex-none cursor-pointer place-items-center rounded-sm text-fg3 transition-colors duration-150 hover:bg-bg2 hover:text-fg"
            >
              <SquareTerminal className="size-[15px]" strokeWidth={1.8} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4} className="px-2 py-1 text-[11.5px]">
            Copy as cURL
            <span className="ml-1.5 opacity-60">⇧-click keeps {"{{variables}}"}</span>
          </TooltipContent>
        </Tooltip>
      )}
      <button
        type="button"
        onClick={sending ? onCancel : onSend}
        className={cn(
          "m-[3px] flex flex-none items-center gap-2 rounded-sm pr-2.5 pl-3.5 font-semibold transition-[filter] duration-150",
          sending ? "bg-bg3 text-fg" : "bg-brass text-brass-ink hover:brightness-108",
        )}
      >
        {sending ? "Cancel" : "Send"}
        <Kbd className="border-current text-inherit opacity-55">{MOD}↵</Kbd>
      </button>
    </div>
  );
}
