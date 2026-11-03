// VW-10: the one date display. Relative under a week, a short date after, and the full UK-format date and time in the tooltip (lib/dateFormat.ts).
import * as React from "react";
import { Time } from "azure-devops-ui/Time";
import { fullDateTime, relativeOrShortDate } from "./lib/dateFormat";

export function RelDate({ date, className }: { date: Date | string; className?: string }) {
  const d = React.useMemo(() => (date instanceof Date ? date : new Date(date)), [date]);
  return <Time className={className} dateTime={d} getTimeString={() => relativeOrShortDate(d, new Date())} getNextInterval={() => 60_000} tooltipProps={{ text: fullDateTime(d) }} />;
}
