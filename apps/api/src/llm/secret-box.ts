import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

/**
 * AES-256-GCM for secrets stored in the database (LLM API keys, client
 * secrets, signing keys). The key comes from SETTINGS_ENCRYPTION_KEY, or is
 * derived from SESSION_SECRET when that isn't set — so a database dump alone
 * never reveals them. Changing the key makes stored secrets unreadable
 * (reported to the admin, who re-enters them); it never crashes the api.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(material: string) {
    if (!material) throw new Error("SecretBox needs key material");
    this.key = Buffer.from(
      hkdfSync("sha256", material, "scry-settings", "llm-secrets", 32) as ArrayBuffer,
    );
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(
      ".",
    );
  }

  /** Throws if the payload was tampered with or sealed under another key. */
  open(sealed: string): string {
    const [version, iv, tag, body] = sealed.split(".");
    if (version !== VERSION || !iv || !tag || body === undefined) {
      throw new Error("Unrecognised secret format");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString(
      "utf8",
    );
  }
}
