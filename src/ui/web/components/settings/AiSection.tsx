import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { SECTION_CASCADE } from "@/components/settings/sectionCascade.ts";
import { useDeferredWrite } from "@/components/settings/SettingsToasts.tsx";
import { useSettingsReceipt } from "@/components/settings/useSettingsReceipt.ts";
import { useAiModels, useAiMutations, useAiSettings } from "@/hooks/queries.ts";
import { stagger } from "@/lib/stagger.ts";
import type { AiCredential, AiProvider } from "@/lib/types.ts";
import type { AiCredentialId } from "@/lib/api.ts";

const PROVIDERS: AiProvider[] = ["off", "anthropic", "openai", "claude-cli"];
/** What a blank base URL means — a URL, not prose, so it is not a catalog key. */
const OPENAI_ENDPOINT = "https://api.openai.com/v1";

/**
 * Settings → AI implementation — roadmap 6.10. Which model, if any, writes the
 * plain-language summary on an incident's page.
 *
 * Rows appear only for the provider chosen: a base URL means nothing to the
 * Anthropic API, a key nothing to the local CLI, and an operator who leaves it
 * off sees one row and the sentence under it. The key box works like a
 * channel's credential: typed once, sent one way, never shown again.
 */
export function AiSection() {
  const { t } = useTranslation();
  const { data: ai, isError, error, refetch } = useAiSettings();
  const { patch } = useAiMutations();
  const receipt = useSettingsReceipt();
  const ids = { model: useId(), baseUrl: useId() };

  // Text fields commit on blur, not per keystroke: a half-typed model name sent
  // to the server is a setting nobody asked for.
  const [baseUrl, setBaseUrl] = useState("");
  useEffect(() => {
    if (ai === undefined) return;
    setBaseUrl(ai.baseUrl);
  }, [ai?.baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const section = (children: React.ReactNode) => (
    <SettingsSection
      id="ai"
      title={t("settings.section.ai")}
      className="lg:col-span-3"
      delay={stagger(6, SECTION_CASCADE)}
      note={<span className="text-sm text-muted-foreground">{t("ai.subscriptions.note")}</span>}
    >
      {children}
    </SettingsSection>
  );

  if (isError) {
    return section(
      <div role="alert" className="flex flex-wrap items-center gap-3 px-1">
        <p className="text-sm text-destructive">
          {t("ai.load-failed", { error: error instanceof Error ? error.message : String(error) })}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()}>
          {t("action.retry")}
        </Button>
      </div>,
    );
  }
  if (ai === undefined) {
    return section(
      <div className="flex flex-col gap-3 py-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-3/4" />
      </div>,
    );
  }

  const provider = ai.provider;
  const needsKey = provider === "anthropic" || provider === "openai";
  const defaultModel = provider === "off" ? "" : ai.defaults[provider];
  const modelHint =
    provider === "claude-cli"
      ? t("ai.model.hint-cli")
      : defaultModel === ""
        ? t("ai.model.hint-required")
        : t("ai.model.hint", { model: defaultModel });

  const commitText = (field: "baseUrl", value: string): void => {
    if (value.trim() === ai[field]) return;
    const { onSuccess, onError } = receipt("ai");
    patch.mutate(
      { [field]: value.trim() },
      {
        onSuccess,
        // A refused value goes back to what is stored, so the box never shows
        // a setting the server does not hold.
        onError: (failure) => {
          setBaseUrl(ai.baseUrl);
          onError(failure);
        },
      },
    );
  };

  return section(
    <>
      <SettingRow label={t("ai.provider.label")} description={t("ai.provider.hint")} align="top">
        <Select
          value={provider}
          onValueChange={(value) => patch.mutate({ provider: value as AiProvider }, receipt("ai"))}
        >
          <SelectTrigger id="ai-provider" className="w-56" aria-label={t("ai.provider.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((id) => (
              <SelectItem key={id} value={id}>
                {t(`ai.provider.${id}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      {provider === "claude-cli" && (
        <SettingRow
          label={t("ai.cli.label")}
          description={ai.claudeCli ? t("ai.cli.found") : t("ai.cli.missing")}
          align="top"
        >
          <span className="text-sm text-muted-foreground">
            {ai.claudeCli ? t("ai.cli.found-short") : t("ai.cli.missing-short")}
          </span>
        </SettingRow>
      )}

      {provider !== "off" && (
        <SettingRow label={<label htmlFor={ids.model}>{t("ai.model.label")}</label>} description={modelHint} align="top">
          <ModelSelect
            id={ids.model}
            provider={provider}
            baseUrl={ai.baseUrl}
            value={ai.model}
            defaultModel={defaultModel}
            onChange={(next) => patch.mutate({ model: next }, receipt("ai"))}
          />
        </SettingRow>
      )}

      {provider === "openai" && (
        <SettingRow label={<label htmlFor={ids.baseUrl}>{t("ai.base-url.label")}</label>} description={t("ai.base-url.hint")} align="top">
          <Input
            id={ids.baseUrl}
            type="url"
            className="w-72 font-mono"
            placeholder={OPENAI_ENDPOINT}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            onBlur={() => commitText("baseUrl", baseUrl)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitText("baseUrl", baseUrl);
            }}
          />
        </SettingRow>
      )}

      {provider === "claude-cli" && (
        <CredentialRow
          id="cli-token"
          label={t("ai.cli-token.label")}
          description={t("ai.cli-token.hint", { envVar: ai.cliToken.envVar })}
          credential={ai.cliToken}
          clearedText={t("ai.cli-token.cleared")}
        />
      )}

      {needsKey && (
        <CredentialRow
          id="key"
          label={t("ai.key.label")}
          description={t(provider === "openai" ? "ai.key.hint-optional" : "ai.key.hint", { envVar: ai.key.envVar })}
          credential={ai.key}
          clearedText={t("ai.key.cleared")}
        />
      )}
    </>,
  );
}

/**
 * One write-only credential: typed once, sent one way, never shown again —
 * the same box a channel's credential uses. Clearing is held behind an undo
 * toast, and offered only for what the dashboard itself saved.
 */
function CredentialRow({
  id,
  label,
  description,
  credential,
  clearedText,
}: {
  id: AiCredentialId;
  label: string;
  description: string;
  credential: AiCredential;
  clearedText: string;
}) {
  const { t } = useTranslation();
  const { saveCredential, clearCredential } = useAiMutations();
  const receipt = useSettingsReceipt();
  const defer = useDeferredWrite();
  const inputId = useId();
  const [value, setValue] = useState("");
  const state = !credential.set ? t("ai.key.missing") : credential.saved ? t("ai.key.set") : t("ai.key.from-env");

  return (
    <SettingRow
      label={<label htmlFor={inputId}>{label}</label>}
      description={description}
      meta={<span className="text-sm text-muted-foreground">{state}</span>}
      align="top"
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() === "") return;
          const { onSuccess, onError } = receipt("ai");
          saveCredential.mutate(
            { id, value: value.trim() },
            {
              onSuccess: () => {
                setValue("");
                onSuccess();
              },
              onError,
            },
          );
        }}
      >
        <Input
          id={inputId}
          type="password"
          autoComplete="new-password"
          className="w-56 font-mono"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={value.trim() === "" || saveCredential.isPending}>
          {t("action.save")}
        </Button>
        {credential.saved && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={clearCredential.isPending}
            onClick={() =>
              defer("ai", {
                text: clearedText,
                commit: () => clearCredential.mutateAsync(id).catch((failure: unknown) => receipt("ai").onError(failure)),
              })
            }
          >
            {t("action.clear")}
          </Button>
        )}
      </form>
    </SettingRow>
  );
}

/** What "no model named" is stored as; Radix's Select cannot hold an empty value. */
const DEFAULT_CHOICE = "__default";

/**
 * The model menu: the provider's own list — live from the Anthropic API or an
 * OpenAI-compatible server's /models, Claude Code's aliases for the CLI — with
 * "default" first wherever the provider has one. A model saved earlier that the
 * list no longer offers stays as a choice, so opening the menu never silently
 * changes the setting.
 */
function ModelSelect({
  id,
  provider,
  baseUrl,
  value,
  defaultModel,
  onChange,
}: {
  id: string;
  provider: Exclude<AiProvider, "off">;
  baseUrl: string;
  value: string;
  defaultModel: string;
  onChange: (model: string) => void;
}) {
  const { t } = useTranslation();
  const { data, isPending, isError, error, refetch, isFetching } = useAiModels(provider, baseUrl);

  if (isPending) return <Skeleton className="h-9 w-56" aria-busy="true" />;

  const listed = data?.models ?? [];
  const hasDefault = provider !== "openai";
  const choices = value !== "" && !listed.some((model) => model.id === value) ? [{ id: value, label: value }, ...listed] : listed;
  const failure = isError ? (error instanceof Error ? error.message : String(error)) : data?.error;

  return (
    <div className="flex flex-col items-end gap-2">
      <Select
        // Nothing chosen and no default to stand for it: leave the value unset
        // so the trigger shows its placeholder instead.
        {...(value === "" && !hasDefault ? {} : { value: value === "" ? DEFAULT_CHOICE : value })}
        onValueChange={(next) => onChange(next === DEFAULT_CHOICE ? "" : next)}
      >
        <SelectTrigger id={id} className="w-56" aria-label={t("ai.model.label")}>
          <SelectValue placeholder={t("ai.model.choose")} />
        </SelectTrigger>
        <SelectContent>
          {hasDefault && (
            <SelectItem value={DEFAULT_CHOICE}>
              {defaultModel === "" ? t("ai.model.default-cli") : t("ai.model.default", { model: defaultModel })}
            </SelectItem>
          )}
          {choices.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {failure !== undefined && (
        <div role="alert" className="flex items-center gap-2">
          <span className="text-sm text-destructive">{t("ai.model.list-failed", { error: failure })}</span>
          <Button type="button" variant="ghost" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            {t("action.retry")}
          </Button>
        </div>
      )}
      {failure === undefined && choices.length === 0 && !hasDefault && (
        <span className="text-sm text-muted-foreground">{t("ai.model.none")}</span>
      )}
    </div>
  );
}
