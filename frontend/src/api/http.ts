export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      ...(isForm ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
    ...init,
  });

  const text = await res.text();

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(res.status, text || res.statusText);
  }

  if (!res.ok) {
    const error = (body as { error?: string })?.error;
    throw new ApiError(res.status, error || text || res.statusText);
  }

  return body as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
