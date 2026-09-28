// A minimal OAuth2 client-credentials IdP for the e2e suites: POST /token
// issues RS256 JWTs (audience "litellm") to client scry-llm / llm-secret, and
// GET /certs serves the public key — what a real IdP does for LiteLLM's JWT
// auth. Port from PORT (default 9998).
import http from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "idp-1", alg: "RS256", use: "sig" };
http
  .createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    if (req.url === "/certs") return res.end(JSON.stringify({ keys: [jwk] }));
    if (req.url === "/token" && req.method === "POST") {
      const form = new URLSearchParams(raw);
      const basic = req.headers.authorization?.replace(/^Basic /, "");
      const [id, secret] = basic
        ? Buffer.from(basic, "base64").toString().split(":").map(decodeURIComponent)
        : [form.get("client_id"), form.get("client_secret")];
      if (id !== "scry-llm" || secret !== "llm-secret") {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            error: "invalid_client",
            error_description: "Invalid client credentials",
          }),
        );
      }
      const token = await new SignJWT({ scope: form.get("scope") ?? "" })
        .setProtectedHeader({ alg: "RS256", kid: "idp-1" })
        .setIssuer("http://localhost:9998")
        .setSubject(id)
        .setAudience("litellm")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return res.end(
        JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: 300 }),
      );
    }
    res.writeHead(404);
    res.end();
  })
  .listen(Number(process.env.PORT ?? 9998), () =>
    console.log(`fake idp on ${process.env.PORT ?? 9998}`),
  );
