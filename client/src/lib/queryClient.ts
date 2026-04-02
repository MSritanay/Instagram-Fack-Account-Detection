import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { clearAuthToken, getAuthToken } from "@/lib/token-store";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    const error = new Error(`${res.status}: ${text}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  try {
    const token = getAuthToken();
    const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    console.error("apiRequest error:", error); // Also log to browser for immediate visibility

    // Log the error to the server
    if (error instanceof Error) {
      try {
        await fetch('/api/log-client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: error.message,
            stack: error.stack,
          }),
        });
      } catch (loggingError) {
        console.error("Failed to log error to server:", loggingError);
      }
    }
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      headers: (() => {
        const token = getAuthToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      })(),
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
      onError: (error: any) => {
        if (error && typeof error.status === 'number' && (error.status === 401 || error.status === 403)) {
          clearAuthToken();
          sessionStorage.removeItem('user');
          window.location.href = '/login';
        }
      },
    },
    mutations: {
      retry: false,
    },
  },
});
