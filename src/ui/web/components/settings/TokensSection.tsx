import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { SECTION_CASCADE } from "@/components/settings/sectionCascade.ts";
import { useSettingsReceipt } from "@/components/settings/useSettingsReceipt.ts";
import { useApiTokenMutations, useApiTokens } from "@/hooks/queries.ts";
import { formatDay, formatRelative } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import type { ApiScope, ApiToken, CreatedApiToken } from "@/lib/types.ts";

/** In the order the create dialog lists them; `admin` last, since it implies the rest. */
const SCOPES: ApiScope[] = ["read", "annotations:write", "push", "mute", "admin"];

/** Each scope's catalog keys, written out whole so the orphan check can see them. */
const SCOPE_TEXT: Record<ApiScope, { label: string; help: string; can: string }> = {
  read: { label: "tokens.scope.read", help: "tokens.scope.read.help", can: "tokens.can.read" },
  "annotations:write": {
    label: "tokens.scope.annotations",
    help: "tokens.scope.annotations.help",
    can: "tokens.can.annotations",
  },
  push: { label: "tokens.scope.push", help: "tokens.scope.push.help", can: "tokens.can.push" },
  mute: { label: "tokens.scope.mute", help: "tokens.scope.mute.help", can: "tokens.can.mute" },
  admin: { label: "tokens.scope.admin", help: "tokens.scope.admin.help", can: "tokens.can.admin" },
};

/** How long "Copied" stays on the button before it says "Copy" again. */
const COPIED_MS = 2000;

const BYPASS_VARIABLE = "API_LOCAL_BYPASS=false";
const ENV_VARIABLE = "API_TOKEN";

/**
 * Settings → API tokens — roadmap 9.11, as agreed in the prototype
 * (design/claude-design-prototypes/api-tokens). A table of the tokens the
 * instance has issued, the `API_TOKEN` from the environment as a row it cannot
 * revoke, a dialog that creates one and shows it exactly once, and a confirm
 * before a revoke — which cannot be taken back, so it asks rather than offering
 * an undo.
 */
export function TokensSection() {
  const { t } = useTranslation();
  const { data, isPending, isError, error, refetch } = useApiTokens();
  const [creating, setCreating] = useState(false);

  const tokens = data?.tokens ?? [];
  const empty = !isPending && !isError && tokens.length === 0 && data?.envToken !== true;

  const section = (children: React.ReactNode) => (
    <SettingsSection
      id="tokens"
      title={t("settings.section.tokens")}
      className="lg:col-span-3"
      delay={stagger(7, SECTION_CASCADE)}
      action={
        // The empty state carries its own button; two "Create token" on one
        // screen would be one too many.
        empty ? undefined : (
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            {t("tokens.create")}
          </Button>
        )
      }
      note={
        <span className="text-sm text-muted-foreground">
          {t("tokens.note", { variable: BYPASS_VARIABLE })}
        </span>
      }
    >
      {children}
      <CreateTokenDialog open={creating} onOpenChange={setCreating} />
    </SettingsSection>
  );

  if (isError) {
    return section(
      <div role="alert" className="flex flex-wrap items-center gap-3 px-5 py-4">
        <p className="text-sm text-destructive">
          {t("tokens.load-failed", { error: error instanceof Error ? error.message : String(error) })}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()}>
          {t("action.retry")}
        </Button>
      </div>,
    );
  }

  if (isPending) {
    return section(
      <div className="flex flex-col gap-3 px-5 py-4" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-3/4" />
      </div>,
    );
  }

  if (empty) {
    return section(
      <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
        <p className="text-base font-medium">{t("tokens.empty.title")}</p>
        <p className="max-w-md text-sm text-muted-foreground">{t("tokens.empty.body")}</p>
        <Button type="button" size="sm" className="mt-2" onClick={() => setCreating(true)}>
          {t("tokens.create")}
        </Button>
      </div>,
    );
  }

  return section(
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-5">{t("tokens.column.name")}</TableHead>
            <TableHead>{t("tokens.column.access")}</TableHead>
            <TableHead>{t("tokens.column.created")}</TableHead>
            <TableHead>{t("tokens.column.used")}</TableHead>
            <TableHead className="px-5 text-right">
              <span className="sr-only">{t("tokens.column.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((token) => (
            <TokenRow key={token.id} token={token} />
          ))}
          {data?.envToken === true && <EnvTokenRow />}
        </TableBody>
      </Table>
    </div>,
  );
}

function ScopeBadges({ scopes }: { scopes: ApiScope[] }) {
  const { t } = useTranslation();
  // Badges are words, not colours: each one says its scope.
  return (
    <span className="flex flex-wrap gap-1.5">
      {scopes.map((scope) => (
        <Badge key={scope} variant="secondary">
          {t(SCOPE_TEXT[scope].label)}
        </Badge>
      ))}
    </span>
  );
}

function TokenRow({ token }: { token: ApiToken }) {
  const { t, i18n } = useTranslation();
  const { revoke } = useApiTokenMutations();
  const receipt = useSettingsReceipt();
  const [confirming, setConfirming] = useState(false);
  const revoked = token.revokedAt !== null;

  const abilities = new Intl.ListFormat(i18n.language, { style: "long", type: "disjunction" }).format(
    (token.scopes.includes("admin") ? SCOPES : token.scopes).map((scope) => t(SCOPE_TEXT[scope].can)),
  );

  return (
    <TableRow className={revoked ? "text-muted-foreground" : undefined}>
      <TableCell className="px-5 py-3 font-medium">{token.name}</TableCell>
      <TableCell className="py-3">
        <ScopeBadges scopes={token.scopes} />
      </TableCell>
      <TableCell className="py-3 text-muted-foreground tabular-nums">
        {formatDay(i18n.language, token.createdAt.slice(0, 10))}
      </TableCell>
      <TableCell className="py-3 text-muted-foreground">
        {token.lastUsedAt === null ? t("tokens.never") : formatRelative(i18n.language, token.lastUsedAt)}
      </TableCell>
      <TableCell className="px-5 py-3 text-right">
        {revoked ? (
          <span className="text-sm text-muted-foreground">
            {t("tokens.revoked-at", { when: formatRelative(i18n.language, token.revokedAt as string) })}
          </span>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t("tokens.revoke.label", { name: token.name })}
              disabled={revoke.isPending}
              onClick={() => setConfirming(true)}
            >
              {t("tokens.revoke")}
            </Button>
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title={t("tokens.revoke.title", { name: token.name })}
              description={t("tokens.revoke.body", { access: abilities })}
              confirmLabel={t("tokens.revoke.confirm")}
              onConfirm={() => {
                const { onSuccess, onError } = receipt("tokens", t("tokens.revoke.done", { name: token.name }));
                revoke.mutate(token.id, { onSuccess, onError });
              }}
            />
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

/** `API_TOKEN` from the environment: a read token only unsetting the variable removes. */
function EnvTokenRow() {
  const { t } = useTranslation();
  return (
    <TableRow>
      <TableCell className="px-5 py-3">
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-xs">{ENV_VARIABLE}</span>
          <span className="text-xs text-muted-foreground">{t("tokens.env.source")}</span>
        </span>
      </TableCell>
      <TableCell className="py-3">
        <ScopeBadges scopes={["read"]} />
      </TableCell>
      <TableCell className="py-3 text-muted-foreground">—</TableCell>
      <TableCell className="py-3 text-muted-foreground">—</TableCell>
      <TableCell className="px-5 py-3 text-right text-sm text-muted-foreground">{t("tokens.env.hint")}</TableCell>
    </TableRow>
  );
}

/**
 * Two steps in one dialog: the form, then — once the server answers — the
 * token, shown this once. Closing a half-filled form asks first; closing the
 * token view does not, because by then nothing is left to lose but the token,
 * and the view says so in its own words.
 */
function CreateTokenDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { create } = useApiTokenMutations();
  const receipt = useSettingsReceipt();
  const ids = { name: useId(), nameError: useId(), scopeError: useId(), formError: useId() };
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<ApiScope>>(() => new Set<ApiScope>(["read"]));
  const [touched, setTouched] = useState({ name: false, submitted: false });
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [created, setCreated] = useState<CreatedApiToken | undefined>(undefined);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const admin = scopes.has("admin");
  const nameError = name.trim() === "" && (touched.name || touched.submitted);
  const scopeError = scopes.size === 0 && touched.submitted;
  const dirty = created === undefined && (name.trim() !== "" || scopes.size !== 1 || !scopes.has("read"));

  const reset = (): void => {
    setName("");
    setScopes(new Set<ApiScope>(["read"]));
    setTouched({ name: false, submitted: false });
    setFailure(undefined);
    setCreated(undefined);
    setCopied(false);
  };

  const close = (): void => {
    setConfirmDiscard(false);
    onOpenChange(false);
    reset();
  };

  const toggle = (scope: ApiScope, on: boolean): void => {
    setScopes((current) => {
      const next = new Set(current);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  };

  const submit = (): void => {
    setTouched((current) => ({ ...current, submitted: true }));
    if (name.trim() === "" || scopes.size === 0) return;
    setFailure(undefined);
    // Admin implies every other scope, so it is the only one sent.
    const body = { name: name.trim(), scopes: admin ? (["admin"] as ApiScope[]) : SCOPES.filter((scope) => scopes.has(scope)) };
    const { onSuccess } = receipt("tokens", t("tokens.created", { name: body.name }));
    create.mutate(body, {
      onSuccess: (token) => {
        setCreated(token);
        onSuccess();
      },
      onError: (error) => setFailure(error instanceof Error ? error.message : String(error)),
    });
  };

  const copy = async (): Promise<void> => {
    if (created === undefined) return;
    await navigator.clipboard.writeText(created.token);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpenChange(true);
          return;
        }
        if (dirty) setConfirmDiscard(true);
        else close();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {created === undefined ? (
          <form
            className="contents"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("tokens.create")}</DialogTitle>
              <DialogDescription>{t("tokens.dialog.body")}</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-6">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={ids.name} className="text-sm font-medium">
                  {t("tokens.dialog.name")}
                </label>
                <Input
                  id={ids.name}
                  value={name}
                  maxLength={80}
                  required
                  autoComplete="off"
                  aria-invalid={nameError}
                  aria-describedby={nameError ? ids.nameError : undefined}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => setTouched((current) => ({ ...current, name: true }))}
                />
                {nameError && (
                  <p id={ids.nameError} className="text-sm text-destructive">
                    {t("tokens.dialog.name-required")}
                  </p>
                )}
              </div>
              <fieldset
                className="flex flex-col gap-3"
                aria-describedby={scopeError ? ids.scopeError : undefined}
              >
                <legend className="mb-3 text-sm font-medium">{t("tokens.dialog.access")}</legend>
                {SCOPES.map((scope) => {
                  const implied = admin && scope !== "admin";
                  return (
                    <label
                      key={scope}
                      className={`flex items-start gap-3 text-sm ${implied ? "opacity-60" : ""}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border border-input accent-primary"
                        checked={implied || scopes.has(scope)}
                        disabled={implied}
                        onChange={(event) => toggle(scope, event.target.checked)}
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium">{t(SCOPE_TEXT[scope].label)}</span>
                        <span className="text-xs text-muted-foreground">
                          {t(SCOPE_TEXT[scope].help)}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {scopeError && (
                  <p id={ids.scopeError} className="text-sm text-destructive">
                    {t("tokens.dialog.scope-required")}
                  </p>
                )}
              </fieldset>
              {failure !== undefined && (
                <p id={ids.formError} role="alert" className="text-sm text-destructive">
                  {failure}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => (dirty ? setConfirmDiscard(true) : close())}
              >
                {t("action.cancel")}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {t("tokens.dialog.submit")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("tokens.shown.title")}</DialogTitle>
              <DialogDescription>{t("tokens.shown.body")}</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <code
                  aria-label={t("tokens.shown.label")}
                  className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-2.5 font-mono text-sm"
                >
                  {created.token}
                </code>
                <Button type="button" variant="outline" onClick={() => void copy()}>
                  {copied ? t("tokens.shown.copied") : t("tokens.shown.copy")}
                </Button>
              </div>
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{created.name}</span>
                <ScopeBadges scopes={created.scopes} />
              </p>
            </DialogBody>
            <DialogFooter>
              <Button type="button" onClick={close}>
                {t("tokens.shown.done")}
              </Button>
            </DialogFooter>
          </>
        )}
        <ConfirmDialog
          open={confirmDiscard}
          onOpenChange={setConfirmDiscard}
          title={t("dialog.discard.title")}
          description={t("dialog.discard.body")}
          confirmLabel={t("action.discard")}
          cancelLabel={t("action.keep-editing")}
          onConfirm={close}
        />
      </DialogContent>
    </Dialog>
  );
}
