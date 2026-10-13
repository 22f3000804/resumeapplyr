// Small building blocks on top of the Modernist classes (.btn, .input, .seg, .tag, .table, .dialog).
import {
  type ButtonHTMLAttributes,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { errorMessage } from "../api";

/* ── buttons ─────────────────────────────────────────────────────────────── */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
  small?: boolean;
}

export function Button({ variant = "secondary", busy, small, className, disabled, children, type, ...rest }: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, small ? "btn-small" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button {...rest} type={type ?? "button"} className={classes} disabled={disabled || busy} aria-busy={busy || undefined}>
      {children}
    </button>
  );
}

/* ── page structure ──────────────────────────────────────────────────────── */

export function PageHeader({
  title,
  lead,
  actions,
  back,
}: {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="page-header">
      {back ? (
        <a className="back-link" href={back.href}>
          {back.label}
        </a>
      ) : null}
      <div className="page-header-row">
        <div className="page-header-text">
          <h1 className="page-title">{title}</h1>
          {lead ? <p className="page-lead">{lead}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section className="section" aria-labelledby={headingId} id={id}>
      <div className="section-head">
        <div>
          <h2 className="section-title" id={headingId}>
            {title}
          </h2>
          {description ? <p className="section-description">{description}</p> : null}
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2 className="empty-title">{title}</h2>
      {children ? <div className="empty-body">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p className="loading" role="status">
      {label}…
    </p>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <p>{errorMessage(error)}</p>
      {onRetry ? (
        <Button small onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/* ── form fields ─────────────────────────────────────────────────────────── */

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ label, hint, error, className, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={["field", className ?? ""].filter(Boolean).join(" ")}>
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: !!error })}
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | null;
  placeholder?: string;
  type?: "text" | "email" | "url" | "tel" | "search";
  className?: string;
  autoFocus?: boolean;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  maxLength?: number;
}

export function TextField({ label, value, onChange, hint, error, className, type = "text", ...rest }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          {...rest}
          id={id}
          type={type}
          className="input"
          value={value}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  hint,
  error,
  className,
  rows = 4,
  placeholder,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          className="input"
          rows={rows}
          value={value}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** A whole-number input that reports a number, or null when blank. */
export function NumberField({
  label,
  value,
  onChange,
  hint,
  error,
  min,
  max,
  className,
  placeholder,
  suffix,
}: {
  label: ReactNode;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: ReactNode;
  error?: string | null;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
  suffix?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value === null ? "" : String(value));
    }
  }, [value]);
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className={suffix ? "input-with-suffix" : undefined}>
          <input
            id={id}
            className="input tnum"
            inputMode="numeric"
            value={text}
            placeholder={placeholder}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              const next = event.target.value.replace(/[^\d]/g, "").slice(0, 7);
              setText(next);
              const parsed = next === "" ? null : Number(next);
              last.current = parsed;
              onChange(parsed);
            }}
            onBlur={() => {
              // Out-of-range numbers are pulled back into range when the field is left.
              if (value === null) return;
              const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
              if (clamped !== value) onChange(clamped);
            }}
          />
          {suffix ? <span className="input-suffix">{suffix}</span> : null}
        </div>
      )}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  error,
  className,
}: {
  label: ReactNode;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  hint?: ReactNode;
  error?: string | null;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          className="input select"
          value={value}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="check-field">
      <label className="check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="box" aria-hidden="true" />
        <span>{label}</span>
      </label>
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The Modernist segmented control: a radio group drawn as joined buttons. */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  hideLabel,
  hint,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  hideLabel?: boolean;
  hint?: ReactNode;
}) {
  const name = useId();
  return (
    <fieldset className="seg-field">
      <legend className={hideLabel ? "sr-only" : "seg-legend"}>{label}</legend>
      <div className="seg">
        {options.map((option) => (
          <label className="seg-opt" key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </fieldset>
  );
}

/* ── tags and numbers ────────────────────────────────────────────────────── */

export type Tone = "accent" | "outline" | "neutral" | "ink" | "quiet" | "error";

export function Tag({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`tag tag-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** A match score in the heading face. At or above the bar it takes the accent. */
export function Score({ value, bar, size = "md" }: { value: number | null; bar: number; size?: "md" | "lg" }) {
  if (value === null) {
    return (
      <span className={`score score-${size} score-none`} aria-label="Not scored">
        –
      </span>
    );
  }
  return (
    <span className={`score score-${size} tnum ${value >= bar ? "score-pass" : "score-below"}`} aria-label={`Match score ${value}`}>
      {value}
    </span>
  );
}

export function Stat({ value, label, accent }: { value: ReactNode; label: ReactNode; accent?: boolean }) {
  return (
    <div className={`stat${accent ? " stat-accent" : ""}`}>
      <p className="stat-value tnum">{value}</p>
      <p className="stat-label">{label}</p>
    </div>
  );
}

/* ── dialogs ─────────────────────────────────────────────────────────────── */

/** A native modal dialog: focus stays inside, Escape closes it, and the page behind is inert. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  actions,
  wide,
  onSubmit,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const body = (
    <>
      <h2 className="dialog-title" id={titleId}>
        {title}
      </h2>
      <div className="dialog-content">{children}</div>
      {actions ? <div className="dialog-actions">{actions}</div> : null}
    </>
  );
  return (
    <dialog
      ref={ref}
      className={`dialog modal${wide ? " modal-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open ? (
        onSubmit ? (
          <form
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )
      ) : null}
    </dialog>
  );
}

/* ── confirmations ───────────────────────────────────────────────────────── */

interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(request: ConfirmRequest) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (next: ConfirmRequest) => new Promise<boolean>((resolve) => setRequest({ ...next, resolve })),
    [],
  );
  const finish = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!request}
        title={request?.title ?? ""}
        onClose={() => finish(false)}
        actions={
          <>
            <Button onClick={() => finish(false)}>Cancel</Button>
            <Button variant={request?.danger ? "danger" : "primary"} onClick={() => finish(true)}>
              {request?.confirmLabel}
            </Button>
          </>
        }
      >
        <div className="dialog-body">{request?.body}</div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

/* ── toasts ──────────────────────────────────────────────────────────────── */

interface ToastItem {
  id: number;
  message: string;
  tone: "info" | "error";
}

const ToastContext = createContext<(message: string, tone?: "info" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (message: string, tone: "info" | "error" = "info") => {
      const id = next.current++;
      setItems((all) => [...all.slice(-3), { id, message, tone }]);
      setTimeout(() => dismiss(id), tone === "error" ? 9000 : 4500);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`}>
            <p>{item.message}</p>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/**
 * Runs a user action: marks it busy, shows a failure as a toast, and optionally confirms success.
 * `busy` holds the key of the action in flight so each button can show its own state.
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string | ((value: T) => string | null)): Promise<T | undefined> => {
      setBusy(key);
      try {
        const value = await fn();
        const message = typeof success === "function" ? success(value) : success;
        if (message) toast(message);
        return value;
      } catch (error) {
        toast(errorMessage(error), "error");
        return undefined;
      } finally {
        setBusy((current) => (current === key ? null : current));
      }
    },
    [toast],
  );
  return { busy, run };
}

/** Re-renders every `ms` so relative times ("4 min ago") stay current. */
export function useTick(ms = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return tick;
}
