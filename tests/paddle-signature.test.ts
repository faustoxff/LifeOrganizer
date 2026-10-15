import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaddleSignature } from "@/lib/paddle-signature";

const secret = "pdl_ntfset_test_secret";
const body = '{"event_id":"evt_1","event_type":"subscription.created","data":{"id":"sub_1"}}';
const NOW = 1_700_000_000_000;
const ts = String(NOW / 1000);
const sign = (payload: string, key = secret, stamp = ts) =>
  createHmac("sha256", key).update(`${stamp}:${payload}`).digest("hex");

describe("verifyPaddleSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(
      verifyPaddleSignature({ rawBody: body, header: `ts=${ts};h1=${sign(body)}`, secret, nowMs: NOW })
    ).toBe(true);
  });

  it("rejects a body that changed by one byte", () => {
    expect(
      verifyPaddleSignature({ rawBody: body + " ", header: `ts=${ts};h1=${sign(body)}`, secret, nowMs: NOW })
    ).toBe(false);
  });

  it("rejects a re-serialised body, which is the raw-body bug", () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expect(
      verifyPaddleSignature({ rawBody: pretty, header: `ts=${ts};h1=${sign(body)}`, secret, nowMs: NOW })
    ).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(
      verifyPaddleSignature({ rawBody: body, header: `ts=${ts};h1=${sign(body, "other")}`, secret, nowMs: NOW })
    ).toBe(false);
  });

  it("rejects a signature whose timestamp was swapped", () => {
    expect(
      verifyPaddleSignature({ rawBody: body, header: `ts=${Number(ts) + 1};h1=${sign(body)}`, secret, nowMs: NOW })
    ).toBe(false);
  });

  it("rejects a timestamp outside the window, in either direction", () => {
    const old = String(NOW / 1000 - 3600);
    const future = String(NOW / 1000 + 3600);
    expect(verifyPaddleSignature({ rawBody: body, header: `ts=${old};h1=${sign(body, secret, old)}`, secret, nowMs: NOW })).toBe(false);
    expect(verifyPaddleSignature({ rawBody: body, header: `ts=${future};h1=${sign(body, secret, future)}`, secret, nowMs: NOW })).toBe(false);
  });

  it("accepts any of several h1 values, as during secret rotation", () => {
    const stale = sign(body, "rotated-out");
    expect(
      verifyPaddleSignature({ rawBody: body, header: `ts=${ts};h1=${stale};h1=${sign(body)}`, secret, nowMs: NOW })
    ).toBe(true);
    expect(
      verifyPaddleSignature({ rawBody: body, header: `ts=${ts};h1=${sign(body)};h1=${stale}`, secret, nowMs: NOW })
    ).toBe(true);
  });

  it.each([
    ["missing header", undefined],
    ["empty header", ""],
    ["no h1", "ts=1700000000"],
    ["no ts", "h1=abcd"],
    ["garbage", "not a header"],
    ["non-hex h1", `ts=${ts};h1=zzzz`],
    ["short h1", `ts=${ts};h1=abcd`],
    ["non-numeric ts", `ts=abc;h1=${sign(body)}`]
  ])("rejects %s without throwing", (_name, header) => {
    expect(verifyPaddleSignature({ rawBody: body, header, secret, nowMs: NOW })).toBe(false);
  });

  it("rejects when no secret is configured, even with a signature made from an empty key", () => {
    const forged = sign(body, "");
    expect(verifyPaddleSignature({ rawBody: body, header: `ts=${ts};h1=${forged}`, secret: "", nowMs: NOW })).toBe(false);
    expect(verifyPaddleSignature({ rawBody: body, header: `ts=${ts};h1=${forged}`, secret: undefined, nowMs: NOW })).toBe(false);
  });
});
