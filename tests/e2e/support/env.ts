// Where the stack under test lives. Defaults match scripts/stack.mjs.
export const env = {
  apiUrl: process.env.E2E_API_URL ?? "http://localhost:3001",
  webUrl: process.env.E2E_WEB_URL ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://scry:scry@localhost:5432/scry",
  sessionSecret: process.env.SESSION_SECRET ?? "e2e-session-secret-0123456789abcdef0123456789",
  /** The demo LLM without auth (what the demo uses). */
  llmUrl: process.env.E2E_LLM_URL ?? "http://localhost:4010/v1",
  /** A second demo LLM that requires DEMO_LLM_API_KEY or a JWT (auth-mode tests). */
  securedLlmUrl: process.env.E2E_SECURED_LLM_URL ?? "http://localhost:4011/v1",
  securedLlmKey: "e2e-demo-key",
  /** Stand-in OAuth2 IdP (support/fake-idp.mjs). */
  idpUrl: process.env.E2E_IDP_URL ?? "http://localhost:9998",
};
