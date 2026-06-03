import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt, generateOpaqueToken } from "@/lib/crypto/aes-gcm";

describe("aes-gcm", () => {
  it("roundtrips arbitrary UTF-8 plaintext", () => {
    const plaintext = "बोलना — propertypilot 🚀 बिजनेस‚ कोल्ड लीड!";
    const ct = encrypt(plaintext);
    expect(ct).not.toBe(plaintext);
    const decrypted = decrypt(ct);
    expect(decrypted).toBe(plaintext);
  });

  it("produces a different ciphertext each time (IV is random)", () => {
    const a = encrypt("hello");
    const b = encrypt("hello");
    expect(a).not.toBe(b);
  });

  it("throws when ciphertext is tampered (auth tag fails)", () => {
    const ct = encrypt("secret");
    const tampered = ct.slice(0, -4) + "AAAA";
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when ciphertext is too short to contain iv+tag", () => {
    expect(() => decrypt("Zm9v")).toThrow(/too short/i);
  });

  it("throws when KMS_KEY_B64 is not 32 bytes", () => {
    const original = process.env.KMS_KEY_B64;
    process.env.KMS_KEY_B64 = randomBytes(16).toString("base64");
    try {
      expect(() => encrypt("anything")).toThrow(/32 bytes/);
    } finally {
      process.env.KMS_KEY_B64 = original;
    }
  });

  it("throws when KMS_KEY_B64 is absent", () => {
    const original = process.env.KMS_KEY_B64;
    delete process.env.KMS_KEY_B64;
    try {
      expect(() => encrypt("anything")).toThrow(/KMS_KEY_B64/);
    } finally {
      process.env.KMS_KEY_B64 = original;
    }
  });
});

describe("generateOpaqueToken", () => {
  it("returns base64url with the expected byte length", () => {
    const tok = generateOpaqueToken(32);
    // base64url for 32 bytes is 43 chars (no padding).
    expect(tok.length).toBe(43);
    // base64url alphabet
    expect(tok).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a different value each time", () => {
    const a = generateOpaqueToken(32);
    const b = generateOpaqueToken(32);
    expect(a).not.toBe(b);
  });
});
