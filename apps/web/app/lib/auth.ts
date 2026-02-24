const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export type CurrentUser = {
  id: string;
  email: string;
  full_name: string;
  is_super_admin: boolean;
};

export function getAuthenticatedDestination(user: CurrentUser): string {
  return user.is_super_admin ? "/platform" : "/dashboard";
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const request = () => fetch(`${API_URL}/auth/me`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  let response = await request();
  if (response.status === 401) {
    const refresh = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    if (!refresh.ok) return null;
    response = await request();
  }

  if (!response.ok) return null;
  return response.json() as Promise<CurrentUser>;
}
