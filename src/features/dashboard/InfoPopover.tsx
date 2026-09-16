import { useEffect, useId, useRef } from "react";

export function InfoPopover({ label, children, open, align = "start", onOpenChange }: {
  label: string;
  children: string;
  open: boolean;
  align?: "start" | "end";
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoringFocusRef = useRef(false);
  const pointerTypeRef = useRef("");
  const openedByHoverRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open, onOpenChange]);

  const closeAndRestoreFocus = () => {
    onOpenChange(false);
    restoringFocusRef.current = true;
    triggerRef.current?.focus();
    queueMicrotask(() => { restoringFocusRef.current = false; });
  };

  return (
    <span
      ref={rootRef}
      className={`info-popover info-popover--${align}`}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          openedByHoverRef.current = !open;
          onOpenChange(true);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && !rootRef.current?.contains(document.activeElement)) {
          openedByHoverRef.current = false;
          onOpenChange(false);
        }
      }}
      onFocusCapture={() => {
        if (!restoringFocusRef.current && !["touch", "pen"].includes(pointerTypeRef.current)) {
          onOpenChange(true);
        }
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpenChange(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          closeAndRestoreFocus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="info-popover__trigger"
        aria-label={label}
        aria-controls={id}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerDown={(event) => { pointerTypeRef.current = event.pointerType; }}
        onClick={(event) => {
          if (pointerTypeRef.current === "mouse" && openedByHoverRef.current) onOpenChange(true);
          else onOpenChange(!open);
          openedByHoverRef.current = false;
          pointerTypeRef.current = "";
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span id={id} className="info-popover__content" role="note">
          <span>{children}</span>
          <button type="button" className="info-popover__close" aria-label="Fechar explicação" onClick={closeAndRestoreFocus}>×</button>
        </span>
      )}
    </span>
  );
}
