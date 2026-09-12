import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export type AccessibleSelectOption = { value: string; label: string };
type MenuPosition = {
  direction: "up" | "down";
  left: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  width: number;
};

export function AccessibleSelect({
  options,
  value,
  onChange,
  label,
  autoFocus = false,
  disabled = false,
  className = "",
  invalid = false,
  describedBy,
}: {
  options: AccessibleSelectOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const selected = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectionLock = useRef(false);
  const labelId = useId();
  const valueId = useId();
  const listboxId = useId();

  const calculatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const container = trigger.closest<HTMLElement>(".as-modal, .app-container");
    const bounds = container?.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const leftLimit = Math.max(margin, bounds?.left ?? margin);
    const rightLimit = Math.min(
      window.innerWidth - margin,
      bounds?.right ?? window.innerWidth - margin,
    );
    const topLimit = Math.max(margin, bounds?.top ?? margin);
    const bottomLimit = Math.min(
      window.innerHeight - margin,
      bounds?.bottom ?? window.innerHeight - margin,
    );
    const width = Math.min(rect.width, Math.max(0, rightLimit - leftLimit));
    const left = Math.min(Math.max(rect.left, leftLimit), rightLimit - width);
    const below = Math.max(0, bottomLimit - rect.bottom - gap);
    const above = Math.max(0, rect.top - topLimit - gap);
    const desired = Math.min(320, Math.max(44, options.length * 44 + 10));
    const direction =
      below >= Math.min(desired, 176) || below >= above ? "down" : "up";
    const maxHeight = Math.max(
      0,
      Math.min(desired, direction === "down" ? below : above),
    );
    setPosition({
      direction,
      left,
      maxHeight,
      width,
      ...(direction === "down"
        ? { top: rect.bottom + gap }
        : { bottom: window.innerHeight - rect.top + gap }),
    });
  };

  const focusElement = (element: HTMLButtonElement | null | undefined) => {
    if (!element) return;
    element.focus({ preventScroll: true });
    const menu = menuRef.current;
    if (!menu) return;
    if (element.offsetTop < menu.scrollTop) menu.scrollTop = element.offsetTop;
    else if (
      element.offsetTop + element.offsetHeight >
      menu.scrollTop + menu.clientHeight
    )
      menu.scrollTop =
        element.offsetTop + element.offsetHeight - menu.clientHeight;
  };
  const focusOption = (index: number) => {
    if (!options.length) return;
    const next = (index + options.length) % options.length;
    setActiveIndex(next);
    focusElement(optionRefs.current[next]);
  };
  const openAt = (index?: number) => {
    if (disabled || !options.length) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    const next = index ?? (selectedIndex >= 0 ? selectedIndex : 0);
    selectionLock.current = false;
    setActiveIndex(next);
    calculatePosition();
    setOpen(true);
  };
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const continueTab = (backwards: boolean) => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const scope = trigger.closest<HTMLElement>(".as-modal") ?? document.body;
    const focusable = Array.from(
      scope.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (element) =>
        !element.matches(":disabled") &&
        !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
        !element.closest(".profile-select__menu"),
    );
    const triggerIndex = focusable.indexOf(trigger);
    const target = focusable[triggerIndex + (backwards ? -1 : 1)];
    setOpen(false);
    setTimeout(() => target?.focus(), 0);
  };
  const select = (nextValue: string) => {
    if (selectionLock.current) return;
    selectionLock.current = true;
    if (nextValue !== value) onChange(nextValue);
    close(true);
  };

  useLayoutEffect(() => {
    if (open) calculatePosition();
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    const next = selectedIndex >= 0 ? selectedIndex : 0;
    setActiveIndex(next);
    const frame = requestAnimationFrame(() =>
      focusElement(optionRefs.current[next]),
    );
    const reposition = () => calculatePosition();
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target))
        close(false);
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, value, options.length]);

  const menuStyle: CSSProperties | undefined = position
    ? {
        left: position.left,
        maxHeight: position.maxHeight,
        top: position.top,
        bottom: position.bottom,
        width: position.width,
      }
    : undefined;
  return (
    <div
      ref={rootRef}
      className={`profile-select${className ? ` ${className}` : ""}`}
    >
      <span id={labelId} className="profile-select__label">
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        autoFocus={autoFocus}
        disabled={disabled}
        className="profile-select__trigger"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        title={selected?.label ?? "Selecione uma opção"}
        onClick={() => (open ? close(true) : openAt())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openAt();
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openAt(options.length - 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            openAt(0);
          } else if (event.key === "End") {
            event.preventDefault();
            openAt(options.length - 1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openAt();
          }
        }}
      >
        <span id={valueId} className="profile-select__value">
          {selected?.label ?? "Selecione uma opção"}
        </span>
        <span className="profile-select__chevron" aria-hidden="true" />
      </button>
      {open && position && (
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          className="profile-select__menu"
          data-direction={position.direction}
          style={menuStyle}
        >
          {options.map((option, index) => (
            <button
              key={option.value || `empty-option-${index}`}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={activeIndex === index ? 0 : -1}
              className="profile-select__option"
              title={option.label}
              onFocus={() => setActiveIndex(index)}
              onClick={() => select(option.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusOption(index + 1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  focusOption(index - 1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  focusOption(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  focusOption(options.length - 1);
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select(option.value);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  close(true);
                } else if (event.key === "Tab") {
                  event.preventDefault();
                  continueTab(event.shiftKey);
                }
              }}
            >
              <span>{option.label}</span>
              {option.value === value && (
                <span className="profile-select__selected" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
