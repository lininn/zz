import { useZCodeIntl } from "@/i18n/index.js";

export function useCrewText() {
  const { intl } = useZCodeIntl();
  return (key: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `crew.${key}` }, values);
}
