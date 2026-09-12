import { Button, Modal } from "@apps-simples/ui";

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = "Confirmar",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      footer={
        <div className="button-row">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Processando…" : confirmLabel}
          </Button>
        </div>
      }
    >
      {children}
    </Modal>
  );
}
