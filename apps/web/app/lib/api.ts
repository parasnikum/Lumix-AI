const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

const PUBLIC_AUTH_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/accept-invitation",
  "/auth/refresh",
];

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const request = () =>
    fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(typeof FormData !== "undefined" && init.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...init.headers,
      },
      cache: "no-store",
    });

  let response = await request();

  if (response.status === 401 && !PUBLIC_AUTH_PATHS.includes(path)) {
    const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });

    if (refreshResponse.ok) {
      response = await request();
    } else if (typeof window !== "undefined") {
      window.location.assign("/login");
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

export type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  visibility: "tenant" | "restricted";
  embedding_provider_id: string | null;
  embedding_model: string;
  embedding_dimensions: number | null;
  chunk_size: number;
  chunk_overlap: number;
  retrieval_top_k: number;
  created_at: string;
};
