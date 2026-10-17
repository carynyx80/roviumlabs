import { describe, expect, it } from "vitest";
import { htmlToText, isPublicIp, SsrfError, validateUrlShape } from "@/lib/security/ssrf";

describe("isPublicIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
  ])("blocks %s", (ip) => expect(isPublicIp(ip)).toBe(false));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isPublicIp(ip)).toBe(true),
  );
});

describe("validateUrlShape", () => {
  it("accepts plain https URLs", () => {
    expect(validateUrlShape("https://example.com/page?x=1").hostname).toBe("example.com");
  });
  it.each([
    ["http://example.com", "https"],
    ["ftp://example.com", "https"],
    ["https://user:pass@example.com", "credentials"],
    ["https://example.com:8443", "port"],
    ["https://localhost/", "Internal"],
    ["https://metadata.internal/", "Internal"],
    ["https://127.0.0.1/", "Private"],
    ["https://[::1]/", "Private"],
    ["https://169.254.169.254/latest/meta-data", "Private"],
    ["not a url", "Invalid"],
  ])("rejects %s", (url, msg) => {
    expect(() => validateUrlShape(url)).toThrow(SsrfError);
    expect(() => validateUrlShape(url)).toThrow(new RegExp(msg, "i"));
  });
});

describe("htmlToText", () => {
  it("strips scripts, styles and tags", () => {
    const text = htmlToText("<style>x{}</style><script>alert(1)</script><p>Hello <b>world</b></p><!-- hidden -->");
    expect(text).toBe("Hello world");
  });
  it("truncates long content", () => {
    expect(htmlToText("<p>" + "a".repeat(20_000) + "</p>", 100)).toHaveLength(100);
  });
});
