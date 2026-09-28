"use client";

import { AuthGate } from "@/components/auth-gate";
import { AppView } from "@/components/app-view";
import { useCurrentUser } from "@/lib/use-current-user";

function AuthedApp() {
  const { data: user } = useCurrentUser();
  if (!user) return null;
  return <AppView user={user} />;
}

export default function Home() {
  return (
    <AuthGate>
      <AuthedApp />
    </AuthGate>
  );
}
