/** Browser-side API helper. Throws ApiClientError carrying the server's error envelope. */
export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as { path: string; message: string }[]).map((d) => [d.path, d.message]),
    );
  }
}

export async function api<T = unknown>(
  url: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
    signal: opts.signal,
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiClientError(
      res.status,
      err?.code ?? "HTTP_ERROR",
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return json as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
