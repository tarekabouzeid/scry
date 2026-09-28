import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SignJWT, jwtVerify } from "jose";
import type { SessionClaims } from "./types";

export const SESSION_COOKIE_NAME = "scry_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

@Injectable()
export class SessionService {
  constructor(private readonly config: ConfigService) {}

  get cookieName() {
    return SESSION_COOKIE_NAME;
  }

  private get secret() {
    return new TextEncoder().encode(this.config.getOrThrow<string>("SESSION_SECRET"));
  }

  async sign(claims: SessionClaims): Promise<string> {
    return new SignJWT({ role: claims.role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
      .sign(this.secret);
  }

  async verify(token: string): Promise<SessionClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret);
      if (typeof payload.sub !== "string" || typeof payload.role !== "string") {
        return null;
      }
      return { sub: payload.sub, role: payload.role as SessionClaims["role"] };
    } catch {
      return null;
    }
  }

  cookieOptions(maxAgeSeconds = SESSION_TTL_SECONDS) {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: this.config.get<string>("NODE_ENV") === "production",
      path: "/",
      maxAge: maxAgeSeconds * 1000,
    };
  }
}
