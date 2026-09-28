"use client";

import { Suspense } from "react";
import { AuthGate } from "@/components/auth-gate";
import { ConnectConsent } from "@/components/connect-consent";

/** Where an AI tool sends someone to let it read Scry as them (OAuth consent). */
export default function ConnectPage() {
  return (
    <AuthGate>
      <Suspense>
        <ConnectConsent />
      </Suspense>
    </AuthGate>
  );
}
