// CI-6: the Verified / Unverified badge on a commit. No native ADO equivalent, so it is a Pill (like the Required pill) with the signer or reason as its tooltip.
import * as React from "react";
import { Pill, PillSize, PillVariant } from "azure-devops-ui/Pill";
import { Tooltip } from "azure-devops-ui/TooltipEx";
import { signatureBadge, type CommitSignature } from "./lib/signatures";

const GREEN = { red: 16, green: 124, blue: 16 };

export function SignaturePill({ signature }: { signature: CommitSignature | null | undefined }) {
  const badge = signatureBadge(signature);
  if (!badge) return null;
  const verified = badge.kind === "verified";
  return (
    <Tooltip text={badge.detail}>
      <span className="gh-signature" tabIndex={0} aria-label={`${badge.label}: ${badge.detail}`}>
        <Pill size={PillSize.compact} variant={verified ? PillVariant.colored : PillVariant.outlined} color={verified ? GREEN : undefined}>{badge.label}</Pill>
      </span>
    </Tooltip>
  );
}
