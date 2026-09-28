import { describe, expect, it } from "vitest";
import type { ServerMetadata } from "openid-client";
import { withReachableBackchannel } from "./oidc.service";

const publicBase = "http://localhost:8080/realms/scry";
const issuer: ServerMetadata = {
  issuer: publicBase,
  authorization_endpoint: `${publicBase}/protocol/openid-connect/auth`,
  token_endpoint: `http://keycloak:8080/realms/scry/protocol/openid-connect/token`,
  userinfo_endpoint: `${publicBase}/protocol/openid-connect/userinfo`,
  jwks_uri: `${publicBase}/protocol/openid-connect/certs`,
};

describe("withReachableBackchannel", () => {
  it("routes server-to-server endpoints via the host the api discovered from", () => {
    const fixed = withReachableBackchannel(issuer, "http://keycloak:8080/realms/scry");
    expect(fixed.userinfo_endpoint).toBe(
      "http://keycloak:8080/realms/scry/protocol/openid-connect/userinfo",
    );
    expect(fixed.jwks_uri).toBe("http://keycloak:8080/realms/scry/protocol/openid-connect/certs");
    expect(fixed.token_endpoint).toBe(issuer.token_endpoint);
  });

  it("leaves browser-facing endpoints and the issuer alone", () => {
    const fixed = withReachableBackchannel(issuer, "http://keycloak:8080/realms/scry");
    expect(fixed.issuer).toBe(publicBase);
    expect(fixed.authorization_endpoint).toBe(issuer.authorization_endpoint);
  });

  it("is a no-op when the api reaches the IdP at its public address", () => {
    expect(withReachableBackchannel(issuer, publicBase)).toBe(issuer);
  });
});
