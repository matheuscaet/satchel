import { ChevronDown, Paperclip } from "lucide-react";
import { toast } from "sonner";
import type { FormField } from "@/types";
import type { VariableContext } from "@/variables";
import { isTauri } from "@/platform";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MenuContent, MenuItem } from "@/features/shell/menu";
import { formatSize } from "@/features/response/format";
import { KeyValueTable } from "../KeyValueTable";
import { pickFile } from "./pickFile";
import { errorMessage } from "@/lib/errors";

const newField = (): FormField => ({ key: "", value: "", enabled: true, type: "text" });

interface FormDataTableProps {
  fields: FormField[];
  onChange: (fields: FormField[]) => void;
  context: VariableContext;
}

export function FormDataTable({ fields, onChange, context }: FormDataTableProps) {
  return (
    <KeyValueTable
      rows={fields}
      onChange={onChange}
      context={context}
      createRow={newField}
      keyHeader="Field"
      keyPlaceholder="Field"
      addPlaceholder="Add field"
      aria-label="Form fields"
      typeColumn={{ header: "Type", render: (row, update) => <TypeMenu row={row} update={update} /> }}
      renderValue={(row, update) => (row.type === "file" ? <FileCell row={row} update={update} /> : undefined)}
    />
  );
}

function TypeMenu({ row, update }: { row: FormField; update: (row: FormField) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-[22px] w-full items-center justify-between rounded-sm pr-1.5 pl-2 text-xs text-fg2 hover:bg-bg3 hover:text-fg data-[state=open]:bg-bg3"
        >
          {row.type === "file" ? "File" : "Text"}
          <ChevronDown className="size-2.5 text-fg3" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <MenuContent align="start">
        {(["text", "file"] as const).map((t) => (
          <MenuItem key={t} className={row.type === t ? "bg-bg3 text-fg" : undefined} onSelect={() => update({ ...row, type: t })}>
            {t === "file" ? "File" : "Text"}
          </MenuItem>
        ))}
      </MenuContent>
    </DropdownMenu>
  );
}

function FileCell({ row, update }: { row: FormField; update: (row: FormField) => void }) {
  const choose = async () => {
    try {
      const picked = await pickFile();
      if (picked) update({ ...row, type: "file", fileName: picked.fileName, filePath: picked.filePath, fileSize: picked.fileSize });
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't open the file picker."));
    }
  };

  if (!row.fileName && !row.filePath)
    return (
      <div className="flex h-[30px] items-center gap-[7px] overflow-hidden px-2.5 whitespace-nowrap">
        <button type="button" onClick={choose} className="h-[22px] rounded-sm border border-dashed border-line2 px-2 font-sans text-xs text-fg2 hover:text-fg">
          Choose file…
        </button>
      </div>
    );

  const name = row.fileName ?? row.filePath!.split(/[/\\]/).pop();
  // Picked in the browser: we know the name and size, but can't read it at send time.
  const browserOnly = !row.filePath && row.fileSize !== undefined && !isTauri();
  const missing = !row.filePath && !browserOnly;
  return (
    <div className="flex h-[30px] items-center gap-[7px] overflow-hidden px-2.5 font-mono text-[12.5px] whitespace-nowrap text-fg">
      <Paperclip className="size-[13px] shrink-0 text-fg3" strokeWidth={1.6} />
      <span className="min-w-12 shrink truncate" title={row.filePath ?? name}>
        {name}
      </span>
      {missing ? (
        <span className="min-w-0 shrink-[100] overflow-hidden font-sans text-[11.5px] text-err">not on this machine</span>
      ) : browserOnly ? (
        <span className="min-w-0 shrink-[100] overflow-hidden text-[11.5px] text-fg3" title="Sending files needs the desktop app">
          {formatSize(row.fileSize!)} <span className="font-sans text-err">· needs the desktop app to send</span>
        </span>
      ) : (
        <span className="min-w-0 shrink-[100] overflow-hidden text-[11.5px] text-fg3">{row.fileSize !== undefined ? formatSize(row.fileSize) : ""}</span>
      )}
      <button type="button" onClick={choose} className="ml-auto shrink-0 font-sans text-xs text-fg2 hover:text-fg">
        {missing ? "Choose…" : "Replace"}
      </button>
    </div>
  );
}
