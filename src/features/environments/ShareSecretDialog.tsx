import { useRef } from "react";
import { Modal, ModalBody, ModalFooter, PrimaryButton, SecondaryButton } from "@/components/common/Modal";

interface ShareSecretDialogProps {
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirms turning a secret variable with values back into a shared one. */
export function ShareSecretDialog({ name, onConfirm, onClose }: ShareSecretDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      size="sm"
      title="Share values?"
      onClose={onClose}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        cancelRef.current?.focus();
      }}
    >
      <ModalBody className="text-[13px] leading-[1.5] text-fg2">
        <p className="m-0">
          Share the values of <span className="font-mono text-fg">{`{{${name}}}`}</span>? They'll be written to the workspace
          files, and anyone with access to the repository will see them.
        </p>
      </ModalBody>
      <ModalFooter>
        <SecondaryButton ref={cancelRef} onClick={onClose}>
          Cancel
        </SecondaryButton>
        <PrimaryButton
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          Share values
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}
