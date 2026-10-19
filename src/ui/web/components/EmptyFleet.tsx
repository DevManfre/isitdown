import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { ServiceDialog } from "@/components/ServiceDialog.tsx";

/**
 * The first-run state of a view that lists the fleet: nothing is configured
 * yet, so the page says why it is empty and hands over the one action that
 * fixes it — the same add-service dialog Settings opens — instead of a line of
 * muted text pointing somewhere else.
 */
export function EmptyFleet() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3">
        <h3 className="text-base font-semibold">{t("providers.empty-title")}</h3>
        <p className="max-w-[60ch] text-sm text-muted-foreground">{t("providers.empty-body")}</p>
        <ServiceDialog
          mode="add"
          trigger={
            <Button type="button" size="sm">
              {t("action.add-service")}
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
